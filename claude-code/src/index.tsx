import React from 'react';
import { Sidebar, Command, useCurrentPath, useSelectedFiles, type XplorerAPI } from '@xplorer/extension-sdk';

let api: XplorerAPI;

// Module-level state — survives sandbox re-renders, no hooks needed
let _messages: Array<{ id: string; role: string; content: string }> = [];
let _isLoading = false;
let _input = '';
let _rerender: (() => void) | null = null;

const notify = () => { if (_rerender) _rerender(); };

const addMsg = (role: string, content: string) => {
  _messages = [..._messages, { id: `${Date.now()}-${Math.random()}`, role, content }];
  notify();
};

const sendMessage = async (text: string, currentPath: string, selectedFiles: Array<{ name: string; path: string }>) => {
  const msg = text.trim();
  if (!msg || _isLoading) return;
  _input = '';
  addMsg('user', msg);
  _isLoading = true;
  notify();

  try {
    const history = _messages.filter((m) => m.role !== 'system').slice(-10);
    const aiMessages = [
      { role: 'system', content: `You are Claude Code, an AI assistant in Xplorer. Path: ${currentPath}. ${selectedFiles.length > 0 ? `Files: ${selectedFiles.map((f) => f.name).join(', ')}` : ''}. Be concise.` },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: msg },
    ];
    const response = await api.ai.chat(aiMessages);
    addMsg('assistant', response);
  } catch (err: unknown) {
    addMsg('system', `Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    _isLoading = false;
    notify();
  }
};

const SUGGESTIONS = ['Explain the selected file', 'Find bugs in this code', 'Refactor for readability', 'Add error handling', 'Write tests for this'];

const st = {
  box: { display: 'flex', flexDirection: 'column' as const, height: '100%', color: 'var(--xp-text, #c0caf5)', fontSize: 13 },
  hdr: { padding: '10px 12px', borderBottom: '1px solid rgba(var(--xp-border-rgb, 41,46,66), 0.5)', display: 'flex', alignItems: 'center', gap: 8 },
  icon: { width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #d97706, #f59e0b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, color: '#fff', fontWeight: 700 as const },
  msgs: { flex: 1, overflow: 'auto' as const, padding: '8px 0' },
  msg: { padding: '6px 12px', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  usr: { backgroundColor: 'rgba(122,162,247,0.08)', borderLeft: '2px solid var(--xp-blue, #7aa2f7)', margin: '2px 0' },
  ast: { margin: '2px 0' },
  sys: { color: 'var(--xp-text-muted, #565f89)', fontSize: 11, fontStyle: 'italic' as const, margin: '2px 0', padding: '4px 12px' },
  inp: { borderTop: '1px solid rgba(var(--xp-border-rgb, 41,46,66), 0.5)', padding: '8px 10px', display: 'flex', gap: 6 },
  ta: { flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(var(--xp-border-rgb), 0.5)', backgroundColor: 'rgba(var(--xp-bg-rgb), 0.5)', color: 'var(--xp-text)', outline: 'none', fontFamily: 'inherit', resize: 'none' as const },
  btn: { padding: '7px 12px', fontSize: 12, fontWeight: 500 as const, borderRadius: 6, border: 'none', cursor: 'pointer', backgroundColor: 'rgba(217,119,6,0.85)', color: '#fff', flexShrink: 0 },
  sug: { padding: '6px 12px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(var(--xp-border-rgb), 0.4)', backgroundColor: 'rgba(var(--xp-border-rgb), 0.15)', cursor: 'pointer', color: 'var(--xp-text-muted)', textAlign: 'left' as const },
};

const ClaudeCodePanel = () => {
  const currentPath = useCurrentPath();
  const selectedFiles = useSelectedFiles();
  // Force re-render trick: increment counter on state changes
  const [, setTick] = React.useState(0);
  _rerender = () => setTick((n) => n + 1);

  const msgs = _messages; // plain array, never undefined
  const loading = _isLoading;

  const doSend = (text?: string) => {
    sendMessage(text || _input, currentPath, selectedFiles);
  };

  if (msgs.length === 0 && !loading) {
    return (
      <div style={st.box}>
        <div style={st.hdr}><div style={st.icon}>C</div><span style={{ fontSize: 12, fontWeight: 600 }}>Claude Code</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 24, textAlign: 'center' }}>
          <div style={st.icon}>C</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Claude Code</div>
          <div style={{ fontSize: 12, color: 'var(--xp-text-muted)', lineHeight: 1.5 }}>Ask Claude to edit files, explain code, fix bugs, and more.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 260 }}>
            {SUGGESTIONS.map((s) => <button key={s} style={st.sug} onClick={() => doSend(s)}>{s}</button>)}
          </div>
        </div>
        <div style={st.inp}>
          <input value={_input} onChange={(e) => { _input = e.target.value; setTick((n) => n + 1); }} onKeyDown={(e) => { if (e.key === 'Enter') doSend(); }} placeholder="Ask Claude..." style={st.ta as React.CSSProperties} />
          <button onClick={() => doSend()} disabled={!_input.trim()} style={{ ...st.btn, opacity: _input.trim() ? 1 : 0.5 }}>Send</button>
        </div>
      </div>
    );
  }

  return (
    <div style={st.box}>
      <div style={st.hdr}>
        <div style={st.icon}>C</div>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Claude Code</span>
        <button onClick={() => { _messages = []; _isLoading = false; setTick((n) => n + 1); }} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(var(--xp-border-rgb), 0.4)', backgroundColor: 'transparent', color: 'var(--xp-text-muted)', cursor: 'pointer' }}>Clear</button>
      </div>
      {(selectedFiles.length > 0 || currentPath) && (
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--xp-text-muted)', borderBottom: '1px solid rgba(var(--xp-border-rgb), 0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ctx: {selectedFiles.length > 0 ? selectedFiles.map((f) => f.name).join(', ') : currentPath?.split(/[/\\]/).pop()}
        </div>
      )}
      <div style={st.msgs}>
        {msgs.map((m) => (
          <div key={m.id} style={{ ...st.msg, ...(m.role === 'user' ? st.usr : m.role === 'assistant' ? st.ast : st.sys) }}>{m.content}</div>
        ))}
        {loading && <div style={{ ...st.msg, ...st.ast, opacity: 0.5 }}>Thinking...</div>}
      </div>
      <div style={st.inp}>
        <input value={_input} onChange={(e) => { _input = e.target.value; setTick((n) => n + 1); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) doSend(); }} placeholder="Ask Claude..." style={st.ta as React.CSSProperties} disabled={loading} />
        <button onClick={() => doSend()} disabled={!_input.trim() || loading} style={{ ...st.btn, opacity: !_input.trim() || loading ? 0.5 : 1 }}>{loading ? '...' : 'Send'}</button>
      </div>
    </div>
  );
};

Sidebar.register({
  id: 'claude-code',
  title: 'Claude Code',
  icon: 'terminal',
  location: 'right',
  permissions: ['file:read', 'ui:panels', 'ai:chat', 'ai:read'],
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
