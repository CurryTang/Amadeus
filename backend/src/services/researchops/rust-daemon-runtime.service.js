'use strict';

const http = require('node:http');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readRustDaemonConfig(env = process.env) {
  const endpoint = cleanString(env?.RESEARCHOPS_RUST_DAEMON_URL);
  if (endpoint) {
    return {
      enabled: true,
      transport: 'http',
      endpoint,
      socketPath: null,
    };
  }
  const socketPath = cleanString(env?.RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET);
  if (socketPath) {
    return {
      enabled: true,
      transport: 'unix',
      endpoint: null,
      socketPath,
    };
  }
  return {
    enabled: false,
    transport: null,
    endpoint: null,
    socketPath: null,
  };
}

function requestJson({ transport, endpoint, socketPath, requestPath = '/runtime', timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = transport === 'http' ? new URL(requestPath, endpoint) : null;
    const request = http.request({
      method: 'GET',
      ...(transport === 'http'
        ? {
            hostname: targetUrl.hostname,
            port: targetUrl.port || 80,
            path: `${targetUrl.pathname}${targetUrl.search}`,
          }
        : {
            socketPath,
            path: requestPath,
          }),
      headers: {
        Accept: 'application/json',
        Connection: 'close',
      },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`rust daemon probe failed (${response.statusCode || 0})`));
          return;
        }
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('rust daemon probe timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function probeRustDaemonRuntime({
  env = process.env,
  timeoutMs = 1500,
} = {}) {
  const config = readRustDaemonConfig(env);
  if (!config.enabled) {
    return {
      enabled: false,
      status: 'disabled',
      transport: null,
      endpoint: null,
      socketPath: null,
      runtime: null,
      error: null,
    };
  }

  try {
    const runtime = await requestJson({
      transport: config.transport,
      endpoint: config.endpoint,
      socketPath: config.socketPath,
      requestPath: '/runtime',
      timeoutMs,
    });
    return {
      enabled: true,
      status: 'ok',
      transport: config.transport,
      endpoint: config.endpoint,
      socketPath: config.socketPath,
      runtime,
      error: null,
    };
  } catch (error) {
    return {
      enabled: true,
      status: 'error',
      transport: config.transport,
      endpoint: config.endpoint,
      socketPath: config.socketPath,
      runtime: null,
      error: cleanString(error?.message) || 'Failed to probe rust daemon runtime',
    };
  }
}

module.exports = {
  probeRustDaemonRuntime,
  readRustDaemonConfig,
};
