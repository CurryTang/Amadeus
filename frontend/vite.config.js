import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function autoStartBackendPlugin() {
  let backendProcess = null;

  return {
    name: 'auto-start-backend',
    apply: 'serve',
    configureServer(server) {
      const logger = server.config.logger;
      const backendDir = path.resolve(__dirname, '../backend');

      const cleanup = () => {
        if (backendProcess && !backendProcess.killed) {
          backendProcess.kill('SIGTERM');
          backendProcess = null;
        }
      };

      server.httpServer?.once('close', cleanup);

      void (async () => {
        const alreadyRunning = await isPortOpen(3000);
        if (alreadyRunning) {
          logger.info('[auto-backend] Reusing backend on http://localhost:3000');
          return;
        }

        logger.info('[auto-backend] Backend not detected on :3000. Starting local backend...');
        backendProcess = spawn(
          process.execPath,
          ['--no-deprecation', 'src/index.js'],
          {
            cwd: backendDir,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );

        backendProcess.stdout?.on('data', (chunk) => {
          const text = chunk.toString().trim();
          if (text) logger.info(`[backend] ${text}`);
        });

        backendProcess.stderr?.on('data', (chunk) => {
          const text = chunk.toString().trim();
          if (text) logger.error(`[backend] ${text}`);
        });

        backendProcess.on('exit', (code, signal) => {
          logger.warn(`[auto-backend] Backend exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
          backendProcess = null;
        });

        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if (await isPortOpen(3000)) {
            logger.info('[auto-backend] Backend is ready on http://localhost:3000');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        logger.warn('[auto-backend] Backend did not become ready within 10s');
      })();
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), autoStartBackendPlugin()],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Mermaid is lazy-loaded via dynamic import() to reduce initial bundle
        // and build memory usage. Group its deps together when loaded.
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('mermaid') ||
                id.includes('dagre') ||
                id.includes('cytoscape') ||
                id.includes('d3') ||
                id.includes('elkjs') ||
                id.includes('khroma') ||
                id.includes('lodash')) {
              return 'mermaid-vendor';
            }
            if (id.includes('react')) {
              return 'react-vendor';
            }
          }
        },
      },
    },
  },
});
