'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, Loader2, AlertCircle } from 'lucide-react';

// ============================================================
// Docker Container Terminal — xterm.js + WebSocket
// ============================================================
// Connects to /ws/terminal on the server, which proxies via
// SSH2 → docker exec into the container.
//
// Props:
//   containerId — Docker container ID (from service.getContainers)
//   serverId    — Node ID where the container runs
// ============================================================

interface DockerTerminalProps {
  containerId: string;
  serverId: string;
  onClose?: () => void;
}

export function DockerTerminal({ containerId, serverId, onClose }: DockerTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const [shell, setShell] = useState<'bash' | 'sh'>('bash');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!termRef.current || !containerId) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let term: any = null;
    let fitAddon: any = null;

    const init = async () => {
      // Dynamic imports for client-only xterm modules
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { AttachAddon } = await import('@xterm/addon-attach');
      // Import xterm CSS
      await import('@xterm/xterm/css/xterm.css');

      if (cancelled || !termRef.current) return;

      // Clear any previous terminal
      termRef.current.innerHTML = '';

      term = new Terminal({
        cursorBlink: true,
        lineHeight: 1.4,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
        convertEol: true,
        theme: {
          cursor: '#a78bfa',
          cursorAccent: '#0a0a0f',
          background: 'rgba(0, 0, 0, 0)',
          foreground: '#e2e8f0',
          selectionBackground: 'rgba(167, 139, 250, 0.3)',
          black: '#1e1e2e',
          red: '#f38ba8',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#cba6f7',
          cyan: '#94e2d5',
          white: '#cdd6f4',
          brightBlack: '#585b70',
          brightRed: '#f38ba8',
          brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af',
          brightBlue: '#89b4fa',
          brightMagenta: '#cba6f7',
          brightCyan: '#94e2d5',
          brightWhite: '#a6adc8',
        },
      });

      termInstanceRef.current = term;
      fitAddon = new FitAddon();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/terminal?containerId=${encodeURIComponent(containerId)}&serverId=${encodeURIComponent(serverId)}&shell=${shell}`;

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setStatus('connected');
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus('error');
        setError('WebSocket connection failed');
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        if (status !== 'error') {
          setStatus('closed');
        }
      };

      const attachAddon = new AttachAddon(ws);

      term.open(termRef.current);
      term.loadAddon(fitAddon);
      term.loadAddon(attachAddon);

      // Fit after a short delay for DOM rendering
      setTimeout(() => {
        if (!cancelled && fitAddon) {
          fitAddon.fit();
        }
      }, 100);

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddon && !cancelled) {
          try { fitAddon.fit(); } catch {}
        }
      });
      if (termRef.current) {
        resizeObserver.observe(termRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    };

    init();

    return () => {
      cancelled = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (term) {
        term.dispose();
      }
    };
  }, [containerId, serverId, shell]);

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-brand-400" />
            <span className="text-sm font-medium">Terminal</span>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-emerald-400 animate-pulse' :
              status === 'connecting' ? 'bg-amber-400 animate-pulse' :
              status === 'error' ? 'bg-red-400' :
              'bg-white/20'
            }`} />
            <span className="text-xs text-white/40 capitalize">{status}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Shell selector */}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {(['bash', 'sh'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setShell(s)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  shell === s
                    ? 'bg-brand-500/15 text-brand-400'
                    : 'text-white/40 hover:bg-white/5'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg border border-white/10 text-xs text-white/40 hover:bg-white/5 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {status === 'error' && error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Terminal container */}
      <div className="relative rounded-lg border border-white/10 bg-black/80 overflow-hidden" style={{ minHeight: 350 }}>
        {status === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
            <div className="flex items-center gap-2 text-sm text-white/40">
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting to container...
            </div>
          </div>
        )}
        <div ref={termRef} className="w-full h-full p-2" style={{ minHeight: 350 }} />
      </div>

      <p className="text-[10px] text-white/20">
        Connected to <code className="text-white/30">{containerId.slice(0, 12)}</code> via SSH
      </p>
    </div>
  );
}
