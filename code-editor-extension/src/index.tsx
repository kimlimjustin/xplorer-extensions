/**
 * Xplorer Code Editor Extension
 *
 * A syntax-highlighted code editor powered by CodeMirror 6.
 * Registers via Editor.register() to provide the default editor for text/code files.
 * Renders in the main content pane when editor tabs are opened.
 */

import React from 'react';
import { Editor, type XplorerAPI } from '@xplorer/extension-sdk';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import { EditorView, keymap, ViewPlugin, Decoration, drawSelection, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, getIndentUnit } from '@codemirror/language';
import { gotoLine } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFileExtension(filePath: string): string {
  return (filePath.split('.').pop() || '').toLowerCase();
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || 'Untitled';
}

function getLanguageName(filePath: string): string {
  const ext = getFileExtension(filePath);
  const map: Record<string, string> = {
    js: 'JavaScript', jsx: 'JavaScript JSX', ts: 'TypeScript', tsx: 'TypeScript JSX',
    py: 'Python', rb: 'Ruby', rs: 'Rust', go: 'Go', java: 'Java',
    c: 'C', cpp: 'C++', h: 'C Header', hpp: 'C++ Header', cs: 'C#',
    swift: 'Swift', kt: 'Kotlin', lua: 'Lua', r: 'R', sql: 'SQL',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', bat: 'Batch',
    html: 'HTML', css: 'CSS', scss: 'SCSS', xml: 'XML', svg: 'SVG',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    md: 'Markdown', txt: 'Plain Text', ini: 'INI', cfg: 'Config',
    graphql: 'GraphQL', proto: 'Protobuf',
  };
  return map[ext] || 'Plain Text';
}

function getLanguageExtension(filePath: string) {
  const ext = getFileExtension(filePath);
  switch (ext) {
    case 'js': case 'jsx': return javascript({ jsx: true });
    case 'ts': return javascript({ typescript: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'html': case 'htm': case 'svg': return html();
    case 'css': case 'scss': case 'less': return css();
    case 'json': return json();
    case 'py': return python();
    case 'md': case 'markdown': return markdown();
    case 'rs': return rust();
    case 'c': case 'h': case 'cpp': case 'hpp': case 'cc': case 'cxx': return cpp();
    case 'java': return java();
    case 'xml': case 'xsl': case 'xslt': return xml();
    case 'sql': return sql();
    default: return [];
  }
}

// ── Indentation Guides ───────────────────────────────────────────────────────

const indentGuideMark = Decoration.mark({ class: 'cm-indent-guide' });

const indentationGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const indentUnit = getIndentUnit(view.state);
      const { from, to } = view.viewport;

      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const text = line.text;

        // Count leading spaces
        let spaces = 0;
        for (let i = 0; i < text.length; i++) {
          if (text[i] === ' ') spaces++;
          else if (text[i] === '\t') spaces += indentUnit;
          else break;
        }

        // Skip blank lines and lines with no indent
        if (spaces > 0 && spaces < text.length) {
          const levels = Math.floor(spaces / indentUnit);
          for (let lvl = 0; lvl < levels; lvl++) {
            const charPos = lvl * indentUnit;
            if (charPos < text.length) {
              builder.add(line.from + charPos, line.from + charPos + 1, indentGuideMark);
            }
          }
        }

        pos = line.to + 1;
      }

      return builder.finish();
    }
  },
  { decorations: v => v.decorations },
);

// ── CodeMirror Theme (CSS variable-based) ────────────────────────────────────

const xplorerTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--xp-bg)',
    color: 'var(--xp-text)',
    height: '100%',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--xp-surface)',
    color: 'var(--xp-text-muted)',
    border: 'none',
    borderRight: '1px solid var(--xp-border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--xp-surface-light)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--xp-surface-light)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--xp-text)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(122, 162, 247, 0.3) !important',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(122, 162, 247, 0.15) !important',
  },
  '.cm-content': {
    caretColor: 'var(--xp-text)',
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
  },
  '.cm-line': {
    padding: '0 4px',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--xp-surface-light)',
    border: 'none',
    color: 'var(--xp-text-muted)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--xp-surface)',
    border: '1px solid var(--xp-border)',
    color: 'var(--xp-text)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--xp-surface)',
    color: 'var(--xp-text)',
    borderTop: '1px solid var(--xp-border)',
  },
  '.cm-panel.cm-search': {
    backgroundColor: 'var(--xp-surface)',
    padding: '6px 10px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  '.cm-panel.cm-search input': {
    backgroundColor: 'var(--xp-bg)',
    color: 'var(--xp-text)',
    border: '1px solid var(--xp-border)',
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 12,
    outline: 'none',
  },
  '.cm-panel.cm-search input:focus': {
    borderColor: '#7aa2f7',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'var(--xp-surface-light)',
    color: 'var(--xp-text)',
    border: '1px solid var(--xp-border)',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': {
    backgroundColor: 'rgba(122, 162, 247, 0.15)',
    borderColor: '#7aa2f7',
  },
  '.cm-panel.cm-search label': {
    fontSize: 12,
    color: 'var(--xp-text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
  },
  '.cm-panel.cm-search .cm-panel-close': {
    marginLeft: 'auto',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(224, 175, 104, 0.25)',
    borderRadius: 2,
    outline: '1px solid rgba(224, 175, 104, 0.5)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(224, 175, 104, 0.5)',
    outline: '1px solid #e0af68',
  },
  // Bracket matching
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(122, 162, 247, 0.2)',
    outline: '1px solid rgba(122, 162, 247, 0.6)',
    borderRadius: 2,
  },
  '.cm-nonmatchingBracket': {
    backgroundColor: 'rgba(247, 118, 142, 0.2)',
    outline: '1px solid rgba(247, 118, 142, 0.5)',
    borderRadius: 2,
  },
  // Indentation guides
  '.cm-indent-guide': {
    borderLeft: '1px solid rgba(86, 95, 137, 0.35)',
    marginLeft: '-1px',
  },
  // Fold gutter
  '.cm-foldGutter': {
    width: '1em',
  },
  '.cm-foldGutter .cm-gutterElement': {
    cursor: 'pointer',
    padding: '0 2px',
    color: 'var(--xp-text-muted)',
    opacity: 0.7,
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: 'var(--xp-text)',
    opacity: 1,
  },
  // Autocompletion dropdown
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--xp-surface)',
    border: '1px solid var(--xp-border)',
    borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    padding: 0,
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    fontSize: 13,
    maxHeight: 200,
    overflowY: 'auto',
    margin: 0,
    padding: '2px 0',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 12px',
    cursor: 'pointer',
    color: 'var(--xp-text)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(122, 162, 247, 0.2)',
    color: 'var(--xp-text)',
  },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: 600,
    color: '#7aa2f7',
  },
  // Word highlight (selection matches)
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(122, 162, 247, 0.15)',
    borderRadius: 2,
    outline: '1px solid rgba(122, 162, 247, 0.35)',
  },
  // Go-to-line dialog
  '.cm-gotoLine': {
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
  },
  '.cm-gotoLine input': {
    backgroundColor: 'var(--xp-bg)',
    color: 'var(--xp-text)',
    border: '1px solid var(--xp-border)',
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 12,
    width: 80,
    outline: 'none',
  },
  '.cm-gotoLine input:focus': {
    borderColor: '#7aa2f7',
  },
  '.cm-gotoLine button': {
    backgroundColor: 'var(--xp-surface-light)',
    color: 'var(--xp-text)',
    border: '1px solid var(--xp-border)',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
}, { dark: true });

// ── Syntax Highlighting (fixed colors for dark themes) ───────────────────────

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#bb9af7' },
  { tag: tags.controlKeyword, color: '#bb9af7', fontStyle: 'italic' },
  { tag: tags.moduleKeyword, color: '#bb9af7' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.operatorKeyword, color: '#89ddff' },
  { tag: tags.variableName, color: '#c0caf5' },
  { tag: tags.function(tags.variableName), color: '#7aa2f7' },
  { tag: tags.function(tags.propertyName), color: '#7aa2f7' },
  { tag: tags.string, color: '#9ece6a' },
  { tag: tags.special(tags.string), color: '#9ece6a' },
  { tag: tags.number, color: '#ff9e64' },
  { tag: tags.integer, color: '#ff9e64' },
  { tag: tags.float, color: '#ff9e64' },
  { tag: tags.bool, color: '#ff9e64' },
  { tag: tags.null, color: '#ff9e64' },
  { tag: tags.atom, color: '#ff9e64' },
  { tag: tags.self, color: '#e0af68' },
  { tag: tags.comment, color: '#565f89', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#565f89', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#565f89', fontStyle: 'italic' },
  { tag: tags.docComment, color: '#565f89', fontStyle: 'italic' },
  { tag: tags.typeName, color: '#2ac3de' },
  { tag: tags.typeOperator, color: '#2ac3de' },
  { tag: tags.namespace, color: '#2ac3de' },
  { tag: tags.className, color: '#2ac3de' },
  { tag: tags.propertyName, color: '#73daca' },
  { tag: tags.tagName, color: '#f7768e' },
  { tag: tags.attributeName, color: '#bb9af7' },
  { tag: tags.attributeValue, color: '#9ece6a' },
  { tag: tags.punctuation, color: '#89ddff' },
  { tag: tags.bracket, color: '#c0caf5' },
  { tag: tags.angleBracket, color: '#c0caf5' },
  { tag: tags.definition(tags.variableName), color: '#c0caf5' },
  { tag: tags.definition(tags.propertyName), color: '#73daca' },
  { tag: tags.special(tags.variableName), color: '#7dcfff' },
  { tag: tags.local(tags.variableName), color: '#c0caf5' },
  { tag: tags.regexp, color: '#b4f9f8' },
  { tag: tags.meta, color: '#565f89' },
  { tag: tags.derefOperator, color: '#89ddff' },
  { tag: tags.separator, color: '#89ddff' },
  { tag: tags.labelName, color: '#7dcfff' },
  { tag: tags.name, color: '#c0caf5' },
  { tag: tags.heading, color: '#89ddff', fontWeight: 'bold' },
  { tag: tags.heading1, color: '#f7768e', fontWeight: 'bold' },
  { tag: tags.heading2, color: '#ff9e64', fontWeight: 'bold' },
  { tag: tags.heading3, color: '#e0af68', fontWeight: 'bold' },
  { tag: tags.link, color: '#7aa2f7', textDecoration: 'underline' },
  { tag: tags.url, color: '#73daca', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: '#9ece6a' },
  { tag: tags.changed, color: '#e0af68' },
  { tag: tags.inserted, color: '#9ece6a' },
  { tag: tags.deleted, color: '#f7768e' },
  { tag: tags.invalid, color: '#f7768e', textDecoration: 'underline wavy' },
]);

// ── Font Size ────────────────────────────────────────────────────────────────

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
const DEFAULT_FONT_SIZE = 14;

const makeFontSizeTheme = (size: number) =>
  EditorView.theme({
    '.cm-content': { fontSize: `${size}px` },
    '.cm-gutters': { fontSize: `${size}px` },
  });

// ── CodeMirrorEditor Component ───────────────────────────────────────────────

function CodeMirrorEditor(props: { filePath: string; api: XplorerAPI }) {
  const { filePath, api } = props;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const languageComp = React.useRef(new Compartment());
  const wrapComp = React.useRef(new Compartment());
  const fontSizeComp = React.useRef(new Compartment());
  const originalContentRef = React.useRef('');
  const saveInProgressRef = React.useRef(false);

  const [dirty, setDirty] = React.useState(false);
  const [cursorLine, setCursorLine] = React.useState(1);
  const [cursorCol, setCursorCol] = React.useState(1);
  const [lineCount, setLineCount] = React.useState(0);
  const [wordWrap, setWordWrap] = React.useState(false);
  const [fontSize, setFontSize] = React.useState(DEFAULT_FONT_SIZE);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Save function
  const save = React.useCallback(async () => {
    const view = viewRef.current;
    if (!view || saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    try {
      const content = view.state.doc.toString();
      await api.files.write(filePath, content);
      originalContentRef.current = content;
      setDirty(false);
    } catch (err: any) {
      api.ui.showMessage(`Failed to save: ${err?.message || err}`, 'error');
    } finally {
      saveInProgressRef.current = false;
    }
  }, [filePath, api]);

  // Revert function
  const revert = React.useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const content = await api.files.readText(filePath);
      originalContentRef.current = content;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
      setDirty(false);
    } catch (err: any) {
      api.ui.showMessage(`Failed to revert: ${err?.message || err}`, 'error');
    }
  }, [filePath, api]);

  // Copy file content to clipboard
  const copyContent = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    navigator.clipboard.writeText(content).catch(() => {
      api.ui.showMessage('Failed to copy to clipboard', 'error');
    });
  }, [api]);

  // Toggle word wrap
  const toggleWordWrap = React.useCallback(() => {
    setWordWrap(prev => {
      const next = !prev;
      const view = viewRef.current;
      if (view) {
        view.dispatch({
          effects: wrapComp.current.reconfigure(next ? EditorView.lineWrapping : []),
        });
      }
      return next;
    });
  }, []);

  // Change font size
  const changeFontSize = React.useCallback((delta: 1 | -1) => {
    setFontSize(prev => {
      const idx = FONT_SIZES.indexOf(prev);
      const nextIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta));
      const next = FONT_SIZES[nextIdx];
      if (next === prev) return prev;
      const view = viewRef.current;
      if (view) {
        view.dispatch({
          effects: fontSizeComp.current.reconfigure(makeFontSizeTheme(next)),
        });
      }
      api.settings.set('fontSize', next).catch(() => {/* ignore */});
      return next;
    });
  }, [api]);

  // Keep font size ref current so the editor-creation effect can read it
  const fontSizeRef = React.useRef(fontSize);
  fontSizeRef.current = fontSize;

  // Keep save ref current for the keymap
  const saveRef = React.useRef(save);
  saveRef.current = save;

  // Load persisted font size once on mount
  React.useEffect(() => {
    api.settings.get('fontSize').then((stored: unknown) => {
      if (typeof stored === 'number' && FONT_SIZES.includes(stored)) {
        setFontSize(stored);
      }
    }).catch(() => {/* ignore */});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for "xplorer-apply-to-editor" events from the AI chat and replace the current selection
  React.useEffect(() => {
    const handleApply = (e: Event) => {
      const view = viewRef.current;
      if (!view) return;
      const code = (e as CustomEvent<{ code: string }>).detail?.code;
      if (typeof code !== 'string') return;

      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: code },
        // Move cursor to end of inserted text
        selection: { anchor: sel.from + code.length },
      });
      view.focus();
      setDirty(true);
    };

    window.addEventListener('xplorer-apply-to-editor', handleApply);
    return () => window.removeEventListener('xplorer-apply-to-editor', handleApply);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Create / recreate editor when filePath changes
  React.useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    setLoading(true);
    setError(null);
    setDirty(false);
    setCursorLine(1);
    setCursorCol(1);

    // Destroy previous view
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    // Create new compartments for this view instance
    const langComp = new Compartment();
    const wrapC = new Compartment();
    const fontC = new Compartment();
    languageComp.current = langComp;
    wrapComp.current = wrapC;
    fontSizeComp.current = fontC;

    // Snapshot font size at creation time so it is stable inside the closure
    const currentFontSize = fontSizeRef.current;

    api.files.readText(filePath).then(content => {
      if (destroyed || !containerRef.current) return;

      originalContentRef.current = content;
      setLineCount(content.split('\n').length);
      setLoading(false);

      const state = EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          drawSelection(),
          xplorerTheme,
          syntaxHighlighting(highlightStyle),
          langComp.of(getLanguageExtension(filePath)),
          wrapC.of(wordWrap ? EditorView.lineWrapping : []),
          fontC.of(makeFontSizeTheme(currentFontSize)),
          indentationGuides,
          keymap.of([
            indentWithTab,
            { key: 'Mod-g', run: gotoLine },
            {
              key: 'Mod-s',
              run: () => {
                saveRef.current();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const newContent = update.state.doc.toString();
              setDirty(newContent !== originalContentRef.current);
              setLineCount(update.state.doc.lines);
            }
            if (update.selectionSet || update.docChanged) {
              const sel = update.state.selection.main;
              const pos = sel.head;
              const line = update.state.doc.lineAt(pos);
              setCursorLine(line.number);
              setCursorCol(pos - line.from + 1);

              // Publish selection to host app so AI chat can use it as context
              const xState = (window as unknown as {
                __xplorer_state__?: {
                  editorSelection?: {
                    text: string;
                    filePath: string;
                    startLine: number;
                    endLine: number;
                  } | null;
                };
              }).__xplorer_state__;
              if (xState) {
                if (!sel.empty) {
                  const selectedText = update.state.sliceDoc(sel.from, sel.to);
                  const fromLine = update.state.doc.lineAt(sel.from);
                  const toLine = update.state.doc.lineAt(sel.to);
                  xState.editorSelection = {
                    text: selectedText,
                    filePath,
                    startLine: fromLine.number,
                    endLine: toLine.number,
                  };
                } else {
                  xState.editorSelection = null;
                }
              }
            }
          }),
        ],
      });

      const view = new EditorView({ state, parent: containerRef.current! });
      viewRef.current = view;

      requestAnimationFrame(() => {
        if (!destroyed) view.focus();
      });
    }).catch(err => {
      if (!destroyed) {
        setLoading(false);
        setError(err?.message || 'Failed to load file');
      }
    });

    return () => {
      destroyed = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  const fileName = getFileName(filePath);
  const langName = getLanguageName(filePath);

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--xp-text-muted)',
        backgroundColor: 'var(--xp-bg)', fontFamily: 'sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#f7768e', marginBottom: 8 }}>Failed to open file</div>
          <div style={{ fontSize: 12, color: 'var(--xp-text-muted)' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      backgroundColor: 'var(--xp-bg)', color: 'var(--xp-text)',
      fontFamily: 'sans-serif', overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', minHeight: 36,
        backgroundColor: 'var(--xp-surface)',
        borderBottom: '1px solid var(--xp-border)',
        fontSize: 12, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--xp-text)', marginRight: 4 }}>
          {fileName}
        </span>
        {dirty && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            backgroundColor: 'rgba(255, 158, 100, 0.2)', color: '#ff9e64',
            fontWeight: 600,
          }}>
            Modified
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Font size controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          border: '1px solid var(--xp-border)', borderRadius: 4, overflow: 'hidden',
        }}>
          <button
            onClick={() => changeFontSize(-1)}
            title="Decrease font size"
            disabled={FONT_SIZES.indexOf(fontSize) === 0}
            style={{
              padding: '2px 6px', fontSize: 13, cursor: FONT_SIZES.indexOf(fontSize) === 0 ? 'default' : 'pointer',
              border: 'none', borderRight: '1px solid var(--xp-border)',
              backgroundColor: 'transparent',
              color: FONT_SIZES.indexOf(fontSize) === 0 ? 'var(--xp-border)' : 'var(--xp-text-muted)',
              lineHeight: 1,
            }}
          >
            −
          </button>
          <span style={{
            padding: '2px 5px', fontSize: 11, color: 'var(--xp-text-muted)',
            minWidth: 24, textAlign: 'center', userSelect: 'none',
          }}>
            {fontSize}
          </span>
          <button
            onClick={() => changeFontSize(1)}
            title="Increase font size"
            disabled={FONT_SIZES.indexOf(fontSize) === FONT_SIZES.length - 1}
            style={{
              padding: '2px 6px', fontSize: 13, cursor: FONT_SIZES.indexOf(fontSize) === FONT_SIZES.length - 1 ? 'default' : 'pointer',
              border: 'none', borderLeft: '1px solid var(--xp-border)',
              backgroundColor: 'transparent',
              color: FONT_SIZES.indexOf(fontSize) === FONT_SIZES.length - 1 ? 'var(--xp-border)' : 'var(--xp-text-muted)',
              lineHeight: 1,
            }}
          >
            +
          </button>
        </div>

        <button
          onClick={toggleWordWrap}
          title="Toggle Word Wrap"
          style={{
            padding: '3px 8px', fontSize: 11, cursor: 'pointer',
            border: '1px solid var(--xp-border)', borderRadius: 4,
            backgroundColor: wordWrap ? 'rgba(122, 162, 247, 0.2)' : 'transparent',
            color: wordWrap ? '#7aa2f7' : 'var(--xp-text-muted)',
          }}
        >
          Wrap
        </button>
        <button
          onClick={copyContent}
          title="Copy file content"
          style={{
            padding: '3px 8px', fontSize: 11, cursor: 'pointer',
            border: '1px solid var(--xp-border)', borderRadius: 4,
            backgroundColor: 'transparent', color: 'var(--xp-text-muted)',
          }}
        >
          Copy
        </button>
        <button
          onClick={revert}
          title="Revert to last saved"
          disabled={!dirty}
          style={{
            padding: '3px 8px', fontSize: 11, cursor: dirty ? 'pointer' : 'default',
            border: '1px solid var(--xp-border)', borderRadius: 4,
            backgroundColor: 'transparent',
            color: dirty ? 'var(--xp-text-muted)' : 'var(--xp-border)',
            opacity: dirty ? 1 : 0.5,
          }}
        >
          Revert
        </button>
        <button
          onClick={save}
          title="Save (Ctrl+S)"
          disabled={!dirty}
          style={{
            padding: '3px 10px', fontSize: 11, cursor: dirty ? 'pointer' : 'default',
            border: 'none', borderRadius: 4,
            backgroundColor: dirty ? '#7aa2f7' : 'var(--xp-surface-light)',
            color: dirty ? '#fff' : 'var(--xp-text-muted)',
            fontWeight: 600,
          }}
        >
          Save
        </button>
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'var(--xp-bg)', color: 'var(--xp-text-muted)',
            fontSize: 13, zIndex: 1,
          }}>
            Loading...
          </div>
        )}
        <div ref={containerRef} style={{ height: '100%', overflow: 'auto' }} />
      </div>

      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '2px 12px', minHeight: 24,
        backgroundColor: 'var(--xp-surface)',
        borderTop: '1px solid var(--xp-border)',
        fontSize: 11, color: 'var(--xp-text-muted)',
        flexShrink: 0,
      }}>
        <span>Ln {cursorLine}, Col {cursorCol}</span>
        <span>{langName}</span>
        <span>{lineCount} lines</span>
      </div>
    </div>
  );
}

// ── Register Editor ──────────────────────────────────────────────────────────

let api: XplorerAPI;

Editor.register({
  id: 'code-editor',
  title: 'Code Editor',
  extensions: [
    'ts', 'tsx', 'js', 'jsx', 'json', 'py', 'rs', 'go', 'java', 'c', 'cpp',
    'h', 'hpp', 'cs', 'html', 'css', 'scss', 'md', 'yaml', 'yml', 'toml',
    'xml', 'sql', 'sh', 'bash', 'lua', 'rb', 'php', 'svg', 'txt', 'log',
    'env', 'gitignore', 'dockerfile', 'makefile', 'ini', 'cfg', 'conf',
    'graphql', 'proto', 'vim', 'cmake', 'gradle', 'properties', 'csv', 'tsv',
  ],
  priority: 20,
  permissions: ['file:read', 'file:write'],
  render: ({ filePath }) => React.createElement(CodeMirrorEditor, { filePath, api }),
  onActivate: (injectedApi) => { api = injectedApi; },
});
