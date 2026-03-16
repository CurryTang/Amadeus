import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function WebTerminal({ sessionId, serverId, apiUrl }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitAddonRef = useRef(null);
  const cleaningUpRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;
    cleaningUpRef.current = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
      },
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Build WebSocket URL
    let wsBase;
    if (apiUrl && /^https?:\/\//.test(apiUrl)) {
      const apiUrlObj = new URL(apiUrl);
      const wsProt = apiUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      wsBase = `${wsProt}//${apiUrlObj.host}/api`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const backendPort = '3000';
      wsBase = `${protocol}//${window.location.hostname}:${backendPort}/api`;
    }
    const params = new URLSearchParams();
    if (serverId) params.set('serverId', String(serverId));
    const qs = params.toString();
    const fullWsUrl = `${wsBase}/ws/terminal/${sessionId}${qs ? `?${qs}` : ''}`;

    const ws = new WebSocket(fullWsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln('\x1b[32mConnected to session.\x1b[0m\r\n');
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      if (cleaningUpRef.current) return;
      term.writeln('\r\n\x1b[33mDisconnected. Click "Back" to return.\x1b[0m');
    };

    ws.onerror = () => {
      if (cleaningUpRef.current) return;
      term.writeln('\r\n\x1b[31mWebSocket error.\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(handleResize);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cleaningUpRef.current = true;
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
  // sessionId, serverId, apiUrl are the only real dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, serverId, apiUrl]);

  return (
    <div
      ref={containerRef}
      className="session-mirror-terminal"
      data-testid="web-terminal"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        background: '#1e1e2e',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    />
  );
}
