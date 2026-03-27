import React from 'react';
import { Sidebar, Command, useCurrentPath, useSelectedFiles, type XplorerAPI } from '@xplorer/extension-sdk';

let api: XplorerAPI;

interface Msg { id: string; role: 'user' | 'assistant' | 'system'; content: string; }

let _msgs: Msg[] = [];
let _loading = false;
let _input = '';
let _rerender: (() => void) | null = null;
const notify = () => { if (_rerender) _rerender(); };

const push = (role: Msg['role'], content: string) => {
  _msgs = [..._msgs, { id: `${Date.now()}-${Math.random()}`, role, content }];
  notify();
};

const runClaude = async (prompt: string, cwd: string) => {
  _input = '';
  push('user', prompt);
  _loading = true;
  notify();

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // Run claude --print "prompt" as a one-shot command
    const result: { stdout: string; stderr: string; exit_code: number } = await invoke('execute_command', {
      command: `claude --print "${prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      workingDir: cwd,
    });

    if (result.stdout?.trim()) {
      push('assistant', result.stdout.trim());
    } else if (result.stderr?.trim()) {
      push('system', result.stderr.trim());
    } else if (result.exit_code !== 0) {
      push('system', `Claude exited with code ${result.exit_code}`);
    } else {
      push('system', 'No response');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not on the allowlist') || msg.includes('not found')) {
      push('system', 'Claude CLI not found or blocked.\n\nInstall: npm i -g @anthropic-ai/claude-code\nThen run `claude` in the terminal to log in.');
    } else {
      push('system', `Error: ${msg}`);
    }
  } finally {
    _loading = false;
    notify();
  }
};

const SLASH = [
  { cmd: '/explain', prompt: 'Explain this code in detail' },
  { cmd: '/fix', prompt: 'Find and fix bugs in this code' },
  { cmd: '/test', prompt: 'Write tests for this code' },
  { cmd: '/refactor', prompt: 'Refactor this code for readability' },
  { cmd: '/review', prompt: 'Code review: check for bugs, security issues' },
  { cmd: '/doc', prompt: 'Add documentation comments' },
  { cmd: '/optimize', prompt: 'Optimize this code for performance' },
  { cmd: '/security', prompt: 'Audit this code for security vulnerabilities' },
];

let _slashOpen = false;
let _slashFilter = '';

const ClaudeCodePanel = () => {
  const currentPath = useCurrentPath();
  const selectedFiles = useSelectedFiles();
  const [, setTick] = React.useState(0);
  const endRef = React.useRef<HTMLDivElement>(null);
  _rerender = () => { setTick((n) => n + 1); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); };

  const send = (text?: string) => {
    let prompt = (text || _input).trim();
    if (!prompt || _loading) return;
    const match = SLASH.find((s) => prompt.startsWith(s.cmd));
    if (match) {
      const extra = prompt.slice(match.cmd.length).trim();
      prompt = extra ? `${match.prompt}: ${extra}` : match.prompt;
    }
    if (selectedFiles.length > 0) {
      prompt += `\n\nFiles:\n${selectedFiles.map((f) => f.path).join('\n')}`;
    }
    _slashOpen = false;
    runClaude(prompt, currentPath || '.');
  };

  const onInput = (v: string) => {
    _input = v;
    _slashOpen = v.startsWith('/') && !v.includes(' ');
    _slashFilter = v.startsWith('/') ? v.slice(1) : '';
    setTick((n) => n + 1);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (_slashOpen && e.key === 'Tab') {
      e.preventDefault();
      const f = SLASH.filter((s) => s.cmd.startsWith('/' + _slashFilter));
      if (f[0]) { _input = f[0].cmd + ' '; _slashOpen = false; setTick((n) => n + 1); }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      _slashOpen = false;
      setTick((n) => n + 1);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: c.text, fontSize: 13, backgroundColor: c.bg }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, ${c.orange}, #f59e0b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', fontWeight: 700 }}>C</div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Claude Code</span>
        {_msgs.length > 0 && (
          <button onClick={() => { _msgs = []; _loading = false; setTick((n) => n + 1); }}
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 10, borderRadius: 4, border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.muted, cursor: 'pointer' }}>
            New Chat
          </button>
        )}
      </div>

      {/* File context chips */}
      {selectedFiles.length > 0 && (
        <div style={{ padding: '6px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {selectedFiles.map((f) => (
            <span key={f.path} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, backgroundColor: 'rgba(122,162,247,0.1)', border: '1px solid rgba(122,162,247,0.2)', color: c.blue }}>
              {f.name}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 0' }}>
        {_msgs.length === 0 && !_loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${c.orange}, #f59e0b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 700 }}>C</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Claude Code</div>
            <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.6, maxWidth: 280 }}>
              Powered by the Claude Code CLI.<br />Select files for context, type <span style={{ color: c.blue }}>/</span> for commands.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 300 }}>
              {SLASH.slice(0, 4).map((s) => (
                <button key={s.cmd} onClick={() => { _input = s.cmd + ' '; setTick((n) => n + 1); }}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 12, border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.muted, cursor: 'pointer' }}>
                  {s.cmd}
                </button>
              ))}
            </div>
          </div>
        ) : (
          _msgs.map((m) => (
            <div key={m.id} style={{ padding: '8px 14px', margin: '2px 0' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: m.role === 'user' ? c.blue : m.role === 'system' ? '#f87171' : c.orange, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Claude' : 'System'}
              </div>
              <div style={{
                fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: m.role === 'system' ? '#f87171' : c.text,
                ...(m.role === 'assistant' ? { padding: '8px 12px', borderRadius: 8, backgroundColor: 'rgba(var(--xp-border-rgb, 41,46,66), 0.2)', border: `1px solid ${c.border}` } : {}),
              }}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {_loading && (
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: c.orange, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Claude</div>
            <div style={{ fontSize: 12, color: c.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: c.orange, animation: 'pulse 1.5s infinite' }} />
              Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Slash command menu */}
      {_slashOpen && (
        <div style={{ borderTop: `1px solid ${c.border}`, maxHeight: 180, overflow: 'auto' }}>
          {SLASH.filter((s) => s.cmd.startsWith('/' + _slashFilter)).map((s) => (
            <div key={s.cmd} onClick={() => { _input = s.cmd + ' '; _slashOpen = false; setTick((n) => n + 1); }}
              style={{ padding: '6px 14px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(122,162,247,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
              <span style={{ fontWeight: 600, color: c.blue, minWidth: 70 }}>{s.cmd}</span>
              <span style={{ color: c.muted, fontSize: 11 }}>{s.prompt}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${c.border}`, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={_input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask Claude or type / for commands..."
            disabled={_loading}
            style={{
              width: '100%', padding: '9px 12px', fontSize: 12, borderRadius: 8,
              border: `1px solid ${_loading ? c.border : c.blue}40`,
              backgroundColor: c.surface, color: c.text, outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>
        <button
          onClick={() => send()}
          disabled={!_input.trim() || _loading}
          style={{
            padding: '9px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8,
            border: 'none', cursor: _input.trim() && !_loading ? 'pointer' : 'default',
            backgroundColor: _input.trim() && !_loading ? c.orange : `${c.orange}40`,
            color: '#fff', flexShrink: 0, transition: 'background-color 0.15s',
          }}>
          {_loading ? '...' : '↑'}
        </button>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
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
