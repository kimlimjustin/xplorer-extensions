import React from 'react';
import { Sidebar, Command, useCurrentPath, type XplorerAPI } from '@xplorer/extension-sdk';

let api: XplorerAPI;

// The Claude Code extension embeds a real PTY running `claude` CLI.
// It uses the same PTY system as the built-in terminal.
// The user interacts with Claude Code exactly as they would in a terminal.

const SESSION_ID = 'claude-code-pty';
let _spawned = false;
let _output = '';
let _rerender: (() => void) | null = null;

const notify = () => { if (_rerender) _rerender(); };

const ClaudeCodePanel = () => {
  const currentPath = useCurrentPath();
  const [, setTick] = React.useState(0);
  const outputRef = React.useRef<HTMLPreElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  _rerender = () => setTick((n) => n + 1);

  // Spawn claude CLI on first render
  React.useEffect(() => {
    if (_spawned) return;
    _spawned = true;

    const cwd = currentPath || '.';

    // Use the PTY commands via Tauri invoke
    const spawn = async () => {
      try {
        // Import transport dynamically to call Tauri commands directly
        const { invoke } = await import('@tauri-apps/api/core');

        // Spawn a PTY running claude in interactive mode
        await invoke('pty_spawn', {
          sessionId: SESSION_ID,
          cwd,
          cols: 80,
          rows: 24,
        });

        // Write "claude\n" to start the CLI
        await invoke('pty_write', { sessionId: SESSION_ID, data: 'claude\n' });

        // Listen to output
        const { listen } = await import('@tauri-apps/api/event');
        listen('pty-output', (event: { payload: { session_id: string; data: string } }) => {
          if (event.payload.session_id === SESSION_ID) {
            _output += event.payload.data;
            // Keep last 50KB of output
            if (_output.length > 50000) _output = _output.slice(-40000);
            notify();
            setTimeout(() => {
              if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
            }, 30);
          }
        });

        listen('pty-exit', (event: { payload: string }) => {
          if (event.payload === SESSION_ID) {
            _output += '\n[Claude Code session ended]\n';
            _spawned = false;
            notify();
          }
        });
      } catch (err) {
        _output = `Failed to start Claude Code: ${err instanceof Error ? err.message : String(err)}\n\nMake sure Claude Code CLI is installed:\n  npm install -g @anthropic-ai/claude-code`;
        notify();
      }
    };

    spawn();

    return () => {
      // Don't kill on unmount — keep session alive for re-opening
    };
  }, [currentPath]);

  // Send input to the PTY
  const sendInput = async (text: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('pty_write', { sessionId: SESSION_ID, data: text });
    } catch { /* ignore */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = (e.target as HTMLInputElement).value;
      sendInput(val + '\n');
      (e.target as HTMLInputElement).value = '';
    }
  };

  // Strip ANSI escape codes for display
  const cleanOutput = _output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      color: 'var(--xp-text, #c0caf5)', fontSize: 12,
      backgroundColor: 'var(--xp-bg, #1a1b26)',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid rgba(var(--xp-border-rgb, 41,46,66), 0.5)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4,
          background: 'linear-gradient(135deg, #d97706, #f59e0b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#fff', fontWeight: 700,
        }}>C</div>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Claude Code</span>
        <button
          onClick={() => {
            _output = '';
            _spawned = false;
            notify();
            // Kill and respawn
            import('@tauri-apps/api/core').then(({ invoke }) => {
              invoke('pty_kill', { sessionId: SESSION_ID }).catch(() => {});
            });
          }}
          style={{
            marginLeft: 'auto', padding: '2px 8px', fontSize: 10,
            borderRadius: 4, border: '1px solid rgba(var(--xp-border-rgb), 0.4)',
            backgroundColor: 'transparent', color: 'var(--xp-text-muted)',
            cursor: 'pointer',
          }}
        >Restart</button>
      </div>

      {/* Output */}
      <pre ref={outputRef} style={{
        flex: 1, margin: 0, padding: '8px 12px',
        overflow: 'auto', fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
        fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        color: 'var(--xp-text, #c0caf5)',
        backgroundColor: 'transparent',
      }}>
        {cleanOutput || 'Starting Claude Code...'}
      </pre>

      {/* Input */}
      <div style={{
        padding: '8px 10px',
        borderTop: '1px solid rgba(var(--xp-border-rgb, 41,46,66), 0.5)',
        display: 'flex', gap: 6,
      }}>
        <input
          ref={inputRef}
          onKeyDown={handleKeyDown}
          placeholder="Type a message to Claude..."
          style={{
            flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 6,
            border: '1px solid rgba(var(--xp-border-rgb), 0.5)',
            backgroundColor: 'rgba(var(--xp-bg-rgb), 0.5)',
            color: 'var(--xp-text)', outline: 'none',
            fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
          }}
        />
        <button
          onClick={() => {
            if (inputRef.current) {
              sendInput(inputRef.current.value + '\n');
              inputRef.current.value = '';
            }
          }}
          style={{
            padding: '7px 12px', fontSize: 12, fontWeight: 500, borderRadius: 6,
            border: 'none', cursor: 'pointer',
            backgroundColor: 'rgba(217,119,6,0.85)', color: '#fff',
          }}
        >Send</button>
      </div>
    </div>
  );
};

Sidebar.register({
  id: 'claude-code',
  title: 'Claude Code',
  icon: 'terminal',
  location: 'right',
  permissions: ['file:read', 'ui:panels', 'system:exec'],
  render: () => <ClaudeCodePanel />,
  onActivate: (xplorerApi) => { api = xplorerApi; },
});

Command.register({
  id: 'claude-code.open',
  title: 'Open Claude Code',
  shortcut: 'ctrl+shift+c',
  permissions: ['ui:panels'],
  action: async () => { api?.ui.showMessage('Claude Code panel is in the right sidebar', 'info'); },
});
