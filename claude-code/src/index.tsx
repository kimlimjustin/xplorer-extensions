import React from 'react';
import { Sidebar, Command, useCurrentPath, useSelectedFiles, type XplorerAPI } from '@xplorer/extension-sdk';

let api: XplorerAPI;

interface Msg { id: string; role: 'user' | 'assistant' | 'system'; content: string; streaming?: boolean; }

let _msgs: Msg[] = [];
let _loading = false;
let _input = '';
let _rerender: (() => void) | null = null;
let _sessionContinue = false;
let _currentStreamId = '';
let _unlistenOutput: (() => void) | null = null;
let _unlistenExit: (() => void) | null = null;

const SESSION = 'claude-code-stream';
const notify = () => { if (_rerender) _rerender(); };

const push = (role: Msg['role'], content: string, streaming = false): string => {
  const id = `${Date.now()}-${Math.random()}`;
  _msgs = [..._msgs, { id, role, content, streaming }];
  notify();
  return id;
};

const updateMsg = (id: string, content: string, streaming = true) => {
  _msgs = _msgs.map((m) => m.id === id ? { ...m, content, streaming } : m);
  notify();
};

const setupListeners = async () => {
  if (_unlistenOutput) return;
  const { listen } = await import('@tauri-apps/api/event');

  _unlistenOutput = await listen('pty-output', (event: { payload: { session_id: string; data: string } }) => {
    if (event.payload.session_id !== SESSION) return;
    const data = event.payload.data;

    if (_currentStreamId) {
      const current = _msgs.find((m) => m.id === _currentStreamId);
      const existing = current?.content || '';
      updateMsg(_currentStreamId, existing + data);
    }
  });

  _unlistenExit = await listen('pty-exit', (event: { payload: string }) => {
    if (event.payload !== SESSION) return;
    if (_currentStreamId) {
      // Clean ANSI codes from final message
      const msg = _msgs.find((m) => m.id === _currentStreamId);
      if (msg) {
        const clean = msg.content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '').trim();
        updateMsg(_currentStreamId, clean || 'No response', false);
      }
    }
    _loading = false;
    _currentStreamId = '';
    notify();
  });
};

const runClaude = async (prompt: string, cwd: string) => {
  _input = '';
  push('user', prompt);
  _loading = true;
  notify();

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await setupListeners();

    // Kill any existing session
    await invoke('pty_kill', { sessionId: SESSION }).catch(() => {});

    // Start new PTY
    await invoke('pty_spawn', { sessionId: SESSION, cwd, cols: 120, rows: 40 });

    // Create streaming assistant message
    _currentStreamId = push('assistant', '', true);

    // Build command
    const escaped = prompt.replace(/'/g, "'\\''");
    const continueFlag = _sessionContinue ? ' --continue' : '';
    const cmd = `claude --print${continueFlag} '${escaped}'\n`;

    _sessionContinue = true;

    // Send command to PTY
    await invoke('pty_write', { sessionId: SESSION, data: cmd });

  } catch (err: unknown) {
    _loading = false;
    _currentStreamId = '';
    push('system', `Error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const c = {
  bg: 'var(--xp-bg, #1a1b26)',
  surface: 'var(--xp-surface, #1e1e2e)',
  border: 'rgba(var(--xp-border-rgb, 41,46,66), 0.5)',
  text: 'var(--xp-text, #c0caf5)',
  muted: 'var(--xp-text-muted, #565f89)',
  blue: 'var(--xp-blue, #7aa2f7)',
  orange: '#d97706',
};

const ClaudeCodePanel = () => {
  const currentPath = useCurrentPath();
  const selectedFiles = useSelectedFiles();
  const [, setTick] = React.useState(0);
  const endRef = React.useRef<HTMLDivElement>(null);
  _rerender = () => { setTick((n) => n + 1); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 30); };

  const send = (text?: string) => {
    const prompt = (text || _input).trim();
    if (!prompt || _loading) return;
    if (selectedFiles.length > 0) {
      runClaude(`${prompt}\n\nContext files:\n${selectedFiles.map((f) => f.path).join('\n')}`, currentPath || '.');
    } else {
      runClaude(prompt, currentPath || '.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: c.text, fontSize: 13, backgroundColor: c.bg }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, ${c.orange}, #f59e0b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', fontWeight: 700 }}>C</div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Claude Code</span>
        {_msgs.length > 0 && (
          <button onClick={() => {
            _msgs = []; _loading = false; _sessionContinue = false; _currentStreamId = '';
            import('@tauri-apps/api/core').then(({ invoke }) => invoke('pty_kill', { sessionId: SESSION }).catch(() => {}));
            setTick((n) => n + 1);
          }}
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 10, borderRadius: 4, border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.muted, cursor: 'pointer' }}>
            New Chat
          </button>
        )}
      </div>

      {/* File chips */}
      {selectedFiles.length > 0 && (
        <div style={{ padding: '6px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {selectedFiles.map((f) => (
            <span key={f.path} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, backgroundColor: 'rgba(122,162,247,0.1)', border: '1px solid rgba(122,162,247,0.2)', color: c.blue }}>{f.name}</span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 0' }}>
        {_msgs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${c.orange}, #f59e0b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 700 }}>C</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Claude Code</div>
            <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.6, maxWidth: 280 }}>
              Runs the real Claude Code CLI.<br />Streams responses as they come.<br />Uses your existing Claude auth.
            </div>
          </div>
        ) : (
          _msgs.map((m) => (
            <div key={m.id} style={{ padding: '8px 14px', margin: '2px 0' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: m.role === 'user' ? c.blue : m.role === 'system' ? '#f87171' : c.orange, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Claude' : 'System'}
                {m.streaming && <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.6 }}>streaming...</span>}
              </div>
              <div style={{
                fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: m.role === 'system' ? '#f87171' : c.text,
                fontFamily: m.role === 'assistant' ? 'inherit' : 'inherit',
                ...(m.role === 'assistant' ? { padding: '10px 12px', borderRadius: 8, backgroundColor: 'rgba(var(--xp-border-rgb, 41,46,66), 0.2)', border: `1px solid ${c.border}` } : {}),
              }}>
                {m.content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '') || (m.streaming ? '...' : '')}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${c.border}`, display: 'flex', gap: 8 }}>
        <input
          value={_input}
          onChange={(e) => { _input = e.target.value; setTick((n) => n + 1); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask Claude..."
          disabled={_loading}
          style={{ flex: 1, padding: '9px 12px', fontSize: 12, borderRadius: 8, border: `1px solid ${c.border}`, backgroundColor: c.surface, color: c.text, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        <button onClick={() => send()} disabled={!_input.trim() || _loading}
          style={{ padding: '9px 16px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: _input.trim() && !_loading ? 'pointer' : 'default', backgroundColor: _input.trim() && !_loading ? c.orange : `${c.orange}40`, color: '#fff', flexShrink: 0 }}>
          ↑
        </button>
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
