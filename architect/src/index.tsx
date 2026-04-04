import React, { useState, useCallback, useRef, useEffect } from 'react';
import { SidebarTab, Editor, Command, useCurrentPath, type XplorerAPI } from '@xplorer/extension-sdk';

// ── Types ────────────────────────────────────────────────────────────────────

interface ArchNode {
  id: string;
  label: string;
  kind: 'folder' | 'file' | 'group';
  children: ArchNode[];
  filePath?: string;
  depth: number;
  fileCount?: number;
}

interface ArchData {
  projectName: string;
  generatedAt: string;
  rootPath: string;
  tree: ArchNode[];
}

interface ArchAnalysis {
  projectName: string;
  generatedAt: string;
  rootPath: string;
  content: string;
}

/** Runtime API includes an `ai` namespace not declared in the SDK types */
type AiApi = {
  chat: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  getProvider: () => Promise<{ model: string; provider: string }>;
};

type ExtendedAPI = XplorerAPI & { ai: AiApi };

// ── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'target',
  '.cache', '.turbo', '__pycache__', '.venv', 'venv',
  '.orchestrate', '.husky', '.vscode', '.idea',
]);

const GROUP_LABELS: Record<string, string> = {
  src: 'Source',
  lib: 'Library',
  components: 'Components',
  pages: 'Pages',
  hooks: 'Hooks',
  utils: 'Utilities',
  api: 'API',
  routes: 'Routes',
  models: 'Models',
  services: 'Services',
  styles: 'Styles',
  tests: 'Tests',
  __tests__: 'Tests',
  public: 'Public Assets',
  assets: 'Assets',
  config: 'Configuration',
  types: 'Types',
  contexts: 'Contexts',
  locales: 'Locales',
};

const KIND_COLORS: Record<string, string> = {
  folder: 'rgba(122, 162, 247, 0.85)',
  file: 'rgba(192, 202, 245, 0.6)',
  group: 'rgba(187, 154, 247, 0.85)',
};

/** Config files to read and send to the LLM for analysis */
const CONFIG_FILES = [
  'package.json', 'Cargo.toml', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
  'next.config.js', 'next.config.ts', 'next.config.mjs', 'tailwind.config.js', 'tailwind.config.ts',
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'go.sum',
  'pnpm-workspace.yaml', 'turbo.json', 'lerna.json',
  '.env.example', 'prisma/schema.prisma', 'drizzle.config.ts',
  'webpack.config.js', 'rollup.config.js', 'esbuild.config.js',
  'Makefile', 'CMakeLists.txt', 'build.gradle', 'pom.xml',
];

// ── Shared state (between sidebar and editor) ────────────────────────────────

let sharedArchData: ArchData | null = null;
let sharedAnalysis: ArchAnalysis | null = null;
let sharedApi: ExtendedAPI | null = null;
const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach((fn) => fn());
};

// ── Scanner ──────────────────────────────────────────────────────────────────

const scanDirectory = async (
  api: XplorerAPI,
  dirPath: string,
  depth: number,
  maxDepth: number,
): Promise<ArchNode[]> => {
  if (depth >= maxDepth) return [];

  try {
    const entries = await api.files.list(dirPath);
    const nodes: ArchNode[] = [];

    const dirs = entries.filter((e: { is_dir: boolean; name: string }) =>
      e.is_dir && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')
    );
    const files = entries.filter((e: { is_dir: boolean; name: string }) =>
      !e.is_dir && !e.name.startsWith('.')
    );

    for (const dir of dirs) {
      const children = await scanDirectory(api, dir.path, depth + 1, maxDepth);
      const label = GROUP_LABELS[dir.name] || dir.name;
      nodes.push({
        id: dir.path,
        label,
        kind: children.length > 0 ? 'group' : 'folder',
        children,
        filePath: dir.path,
        depth,
        fileCount: countFiles(children) + files.length,
      });
    }

    if (depth > 0 && files.length > 0 && files.length <= 8) {
      for (const file of files) {
        nodes.push({
          id: file.path,
          label: file.name,
          kind: 'file',
          children: [],
          filePath: file.path,
          depth,
        });
      }
    }

    return nodes;
  } catch {
    return [];
  }
};

const countFiles = (nodes: ArchNode[]): number => {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'file') count++;
    count += countFiles(node.children);
  }
  return count;
};

// ── Build text tree for LLM prompt ──────────────────────────────────────────

const buildTextTree = (nodes: ArchNode[], indent: string = ''): string => {
  let result = '';
  for (const node of nodes) {
    const prefix = node.kind === 'file' ? '  ' : (node.children.length > 0 ? '+ ' : '  ');
    result += `${indent}${prefix}${node.label}${node.kind === 'folder' || node.kind === 'group' ? '/' : ''}\n`;
    if (node.children.length > 0) {
      result += buildTextTree(node.children, indent + '  ');
    }
  }
  return result;
};

// ── Read config files for LLM context ───────────────────────────────────────

const readConfigFiles = async (
  api: XplorerAPI,
  rootPath: string,
): Promise<Array<{ name: string; content: string }>> => {
  const results: Array<{ name: string; content: string }> = [];
  const normalizedRoot = rootPath.replace(/\/$/, '');

  for (const configFile of CONFIG_FILES) {
    const filePath = `${normalizedRoot}/${configFile}`;
    try {
      const content = await api.files.readText(filePath);
      if (content && content.trim().length > 0) {
        // Truncate very large files to avoid overwhelming the LLM
        const truncated = content.length > 3000
          ? content.slice(0, 3000) + '\n... (truncated)'
          : content;
        results.push({ name: configFile, content: truncated });
      }
    } catch {
      // File doesn't exist or can't be read, skip it
    }
  }

  // Also scan for workspace package.json files (monorepo detection)
  try {
    const entries = await api.files.list(normalizedRoot);
    const dirs = entries.filter((e: { is_dir: boolean; name: string }) =>
      e.is_dir && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')
    );
    for (const dir of dirs) {
      const pkgPath = `${dir.path}/package.json`;
      try {
        const content = await api.files.readText(pkgPath);
        if (content && content.trim().length > 0) {
          const truncated = content.length > 1500
            ? content.slice(0, 1500) + '\n... (truncated)'
            : content;
          results.push({ name: `${dir.name}/package.json`, content: truncated });
        }
      } catch {
        // Skip
      }
      // Check for nested Cargo.toml in workspace members
      const cargoPath = `${dir.path}/Cargo.toml`;
      try {
        const content = await api.files.readText(cargoPath);
        if (content && content.trim().length > 0) {
          const truncated = content.length > 1500
            ? content.slice(0, 1500) + '\n... (truncated)'
            : content;
          results.push({ name: `${dir.name}/Cargo.toml`, content: truncated });
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip workspace scanning
  }

  return results;
};

// ── Build LLM prompt ────────────────────────────────────────────────────────

const buildAnalysisPrompt = (
  projectName: string,
  textTree: string,
  configFiles: Array<{ name: string; content: string }>,
): Array<{ role: string; content: string }> => {
  const configSection = configFiles.map(
    (f) => `--- ${f.name} ---\n${f.content}`
  ).join('\n\n');

  const systemPrompt = `You are an expert software architect. Analyze the given project structure and configuration files to produce a comprehensive architecture overview. Be specific and concrete based on the actual files you see.

Format your response using these exact section headers with ## markdown headings. Use bullet points within sections. Be concise but thorough.

## Project Overview
One paragraph describing what this project is and its purpose.

## Architecture Pattern
What pattern is used (monorepo, microservices, fullstack, SPA, etc.) and why.

## Frontend Stack
- Framework and version
- State management approach
- Routing solution
- Styling approach (CSS framework, preprocessor, etc.)
- Build tooling

## Backend Stack
- Language and runtime
- Framework
- Database and ORM (if detected)
- API style (REST, GraphQL, IPC, etc.)

## Storage & Data Layer
How data flows and where it's stored.

## Key Entry Points
List the main entry files and what they do.

## Component Communication
How the different parts of the system communicate (API calls, IPC, events, message passing, etc.)

## Architecture Diagram
Create a text diagram showing the high-level component relationships. Use box-drawing characters or simple ASCII art.

## Dependencies & Tooling
Notable dependencies, dev tools, testing frameworks, CI/CD setup.

## Observations
Any notable patterns, potential concerns, or architectural decisions worth highlighting.

If a section doesn't apply (e.g., no backend), write "Not detected" and move on. Do not fabricate information not evident from the provided files.`;

  const userPrompt = `Analyze the architecture of the project "${projectName}".

## Directory Structure
${textTree}

## Configuration Files
${configSection || 'No configuration files found.'}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
};

// ── Markdown Renderer ───────────────────────────────────────────────────────

const MarkdownSection: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let codeBlock: string[] | null = null;
  let codeLanguage = '';

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} style={{
          margin: '8px 0', paddingLeft: 20, listStyleType: 'disc',
        }}>
          {listItems.map((item, i) => (
            <li key={i} style={{
              fontSize: 13, lineHeight: 1.6,
              color: 'var(--xp-text, #c0caf5)',
              marginBottom: 2,
            }}>
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const renderInlineMarkdown = (text: string): React.ReactNode => {
    // Handle bold, italic, inline code, and links
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      // Inline code
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        parts.push(
          <code key={key++} style={{
            backgroundColor: 'rgba(122, 162, 247, 0.12)',
            padding: '1px 5px', borderRadius: 3,
            fontSize: 12, fontFamily: 'monospace',
            color: 'var(--xp-blue, #7aa2f7)',
          }}>
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }
      // Bold
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }
      // Italic
      const italicMatch = remaining.match(/^\*([^*]+)\*/);
      if (italicMatch) {
        parts.push(<em key={key++}>{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }
      // Plain text up to next special char
      const nextSpecial = remaining.search(/[`*]/);
      if (nextSpecial === -1) {
        parts.push(remaining);
        break;
      }
      if (nextSpecial === 0) {
        // Special char that didn't match a pattern, treat as literal
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        parts.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trimStart().startsWith('```')) {
      if (codeBlock === null) {
        flushList();
        codeBlock = [];
        codeLanguage = line.trimStart().slice(3).trim();
      } else {
        elements.push(
          <pre key={`code-${elements.length}`} style={{
            margin: '12px 0', padding: '12px 16px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: 8, overflow: 'auto',
            border: '1px solid rgba(var(--xp-border-rgb, 41, 46, 66), 0.5)',
          }}>
            <code style={{
              fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5,
              color: 'var(--xp-text, #c0caf5)',
              whiteSpace: 'pre',
            }}>
              {codeBlock.join('\n')}
            </code>
          </pre>
        );
        codeBlock = null;
        codeLanguage = '';
      }
      continue;
    }

    if (codeBlock !== null) {
      codeBlock.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${elements.length}`} style={{
          fontSize: 16, fontWeight: 600, marginTop: 24, marginBottom: 8,
          color: 'var(--xp-blue, #7aa2f7)',
          borderBottom: '1px solid rgba(122, 162, 247, 0.2)',
          paddingBottom: 6,
        }}>
          {line.slice(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${elements.length}`} style={{
          fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 6,
          color: 'var(--xp-purple, #bb9af7)',
        }}>
          {line.slice(4)}
        </h3>
      );
      continue;
    }

    // Bullet points
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[2]);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${elements.length}`} style={{
        fontSize: 13, lineHeight: 1.7, marginBottom: 8,
        color: 'var(--xp-text, #c0caf5)',
      }}>
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  flushList();

  return <>{elements}</>;
};

// ── Tab button component ────────────────────────────────────────────────────

const TabButton: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1, padding: '6px 8px', fontSize: 11, fontWeight: 500,
      border: 'none', cursor: 'pointer',
      backgroundColor: active ? 'rgba(122, 162, 247, 0.15)' : 'transparent',
      color: active ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-text-muted, #565f89)',
      borderBottom: active ? '2px solid var(--xp-blue, #7aa2f7)' : '2px solid transparent',
      transition: 'all 0.15s',
    }}
    onMouseEnter={(e) => {
      if (!active) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
    }}
    onMouseLeave={(e) => {
      if (!active) e.currentTarget.style.backgroundColor = 'transparent';
    }}
  >
    {label}
  </button>
);

// ── Sidebar Component ───────────────────────────────────────────────────────

const ArchitectSidebar: React.FC = () => {
  const currentPath = useCurrentPath();
  const [analysis, setAnalysis] = useState<ArchAnalysis | null>(sharedAnalysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = () => {
      setAnalysis(sharedAnalysis);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!sharedApi || !currentPath) return;

    // Check if AI API is available
    if (!sharedApi.ai || typeof sharedApi.ai.chat !== 'function') {
      setError('AI API not available. Make sure an AI provider is configured in Settings > AI.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      // Step 1: Scan tree for LLM context (not displayed)
      const tree = await scanDirectory(sharedApi, currentPath, 0, 4);
      const projectName = currentPath.split('/').pop() || currentPath.split('\\').pop() || 'Project';
      const data: ArchData = {
        projectName,
        generatedAt: new Date().toISOString(),
        rootPath: currentPath,
        tree,
      };
      sharedArchData = data;

      // Step 2: Build text tree
      const textTree = buildTextTree(tree);

      // Step 3: Read config files
      const configFiles = await readConfigFiles(sharedApi, currentPath);

      // Step 4: Build prompt and call LLM
      const messages = buildAnalysisPrompt(projectName, textTree, configFiles);
      const response = await sharedApi.ai.chat(messages);

      const analysisResult: ArchAnalysis = {
        projectName,
        generatedAt: new Date().toISOString(),
        rootPath: currentPath,
        content: response,
      };
      sharedAnalysis = analysisResult;
      setAnalysis(analysisResult);
      notifyListeners();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Analysis failed';
      if (errMsg.includes('missing permission')) {
        setError('AI permission not granted. The extension needs the "ai:chat" permission.');
      } else if (errMsg.includes('API key') || errMsg.includes('api_key') || errMsg.includes('401')) {
        setError('No AI API key configured. Go to Settings > AI to set up a provider.');
      } else {
        setError(errMsg);
      }
    } finally {
      setAnalyzing(false);
    }
  }, [currentPath]);

  const hasAiApi = sharedApi && (sharedApi as ExtendedAPI).ai && typeof (sharedApi as ExtendedAPI).ai.chat === 'function';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      color: 'var(--xp-text, #c0caf5)', fontSize: 13,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 12px 8px',
        borderBottom: '1px solid rgba(var(--xp-border-rgb, 41, 46, 66), 0.5)',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const,
          letterSpacing: '0.05em', color: 'var(--xp-text-muted, #565f89)',
          marginBottom: 8,
        }}>
          Architecture
        </div>

        {/* Generate button */}
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !hasAiApi}
          title={!hasAiApi ? 'AI API not available' : 'Generate AI architecture analysis'}
          style={{
            width: '100%', padding: '7px 8px', fontSize: 11, fontWeight: 500,
            borderRadius: 6, border: 'none',
            cursor: (analyzing || !hasAiApi) ? (analyzing ? 'wait' : 'not-allowed') : 'pointer',
            backgroundColor: analyzing ? 'rgba(187, 154, 247, 0.3)' : 'rgba(187, 154, 247, 0.85)',
            color: '#fff', transition: 'opacity 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            opacity: !hasAiApi ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (!analyzing && hasAiApi) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = !hasAiApi ? '0.5' : '1'; }}
        >
          {analyzing ? (
            <>
              <span style={{
                width: 10, height: 10, border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              Analyzing...
            </>
          ) : (
            <>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.4V11h3a3 3 0 0 1 3 3v1" />
                <path d="M12 2a4 4 0 0 0-4 4c0 1.5.8 2.8 2 3.4V11H7a3 3 0 0 0-3 3v1" />
                <circle cx="12" cy="18" r="3" />
                <path d="M12 15v-4" />
              </svg>
              Generate Architecture
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '8px 12px', fontSize: 11, color: '#f87171',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.15)',
        }}>
          {error}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', paddingTop: 4, paddingBottom: 8 }}>
        {/* Empty state */}
        {!analysis && !analyzing && (
          <div style={{
            padding: '24px 16px', textAlign: 'center' as const,
            color: 'var(--xp-text-muted, #565f89)', fontSize: 12,
          }}>
            <div style={{ marginBottom: 12 }}>
              <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, margin: '0 auto' }}>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>Architecture Analyzer</div>
            <div style={{ lineHeight: 1.5 }}>
              Click <strong>Generate Architecture</strong> to scan your project and generate a comprehensive AI architecture overview.
            </div>
          </div>
        )}

        {/* Analyzing loading state */}
        {analyzing && (
          <div style={{
            padding: '32px 16px', textAlign: 'center' as const,
            color: 'var(--xp-text-muted, #565f89)', fontSize: 12,
          }}>
            <div style={{
              width: 24, height: 24, margin: '0 auto 12px',
              border: '2px solid rgba(187, 154, 247, 0.3)',
              borderTopColor: 'rgba(187, 154, 247, 0.85)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            <div style={{ marginBottom: 4, fontWeight: 500, color: 'var(--xp-purple, #bb9af7)' }}>
              Analyzing Architecture...
            </div>
            <div style={{ lineHeight: 1.5 }}>
              Reading project files and querying the AI model. This may take a moment.
            </div>
          </div>
        )}

        {/* Analysis result */}
        {!analyzing && analysis && (
          <div ref={analysisRef} style={{ padding: '8px 12px' }}>
            <MarkdownSection content={analysis.content} />
          </div>
        )}
      </div>

      {/* Footer */}
      {analysis && (
        <div style={{
          padding: '6px 12px', fontSize: 10, color: 'var(--xp-text-muted, #565f89)',
          borderTop: '1px solid rgba(var(--xp-border-rgb, 41, 46, 66), 0.3)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{analysis.projectName}</span>
          <span>
            {new Date(analysis.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* Keyframe animation for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Main Area Graph Component ────────────────────────────────────────────────

const GraphNode: React.FC<{
  node: ArchNode;
  isRoot?: boolean;
  onNavigate: (path: string) => void;
}> = ({ node, isRoot, onNavigate }) => {
  const [hovered, setHovered] = useState(false);
  const hasChildren = node.children.filter((c) => c.kind !== 'file').length > 0;
  const fileChildren = node.children.filter((c) => c.kind === 'file');
  const dirChildren = node.children.filter((c) => c.kind !== 'file');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: isRoot ? 32 : 16,
    }}>
      {/* Node card */}
      <div
        onClick={() => node.filePath && onNavigate(node.filePath)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 6, padding: isRoot ? '16px 24px' : '10px 16px',
          borderRadius: isRoot ? 12 : 8,
          backgroundColor: hovered
            ? 'rgba(122, 162, 247, 0.15)'
            : isRoot
              ? 'rgba(122, 162, 247, 0.08)'
              : 'rgba(var(--xp-border-rgb, 41, 46, 66), 0.3)',
          border: `1px solid ${isRoot ? 'rgba(122, 162, 247, 0.25)' : 'rgba(var(--xp-border-rgb, 41, 46, 66), 0.4)'}`,
          cursor: 'pointer',
          transition: 'all 0.15s',
          minWidth: isRoot ? 160 : 100,
          maxWidth: isRoot ? 300 : 180,
        }}
      >
        <span style={{
          width: isRoot ? 10 : 8, height: isRoot ? 10 : 8,
          borderRadius: node.kind === 'file' ? 2 : '50%',
          backgroundColor: KIND_COLORS[node.kind] || KIND_COLORS.folder,
        }} />
        <span style={{
          fontSize: isRoot ? 15 : 12, fontWeight: isRoot ? 600 : 500,
          color: 'var(--xp-text, #c0caf5)', textAlign: 'center' as const,
          lineHeight: 1.3,
        }}>
          {node.label}
        </span>
        {fileChildren.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--xp-text-muted, #565f89)' }}>
            {fileChildren.length} file{fileChildren.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Connector line */}
      {hasChildren && (
        <div style={{
          width: 1, height: 16,
          backgroundColor: 'rgba(var(--xp-border-rgb, 41, 46, 66), 0.4)',
        }} />
      )}

      {/* Children row */}
      {hasChildren && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          gap: 12, position: 'relative',
        }}>
          {/* Horizontal connector */}
          {dirChildren.length > 1 && (
            <div style={{
              position: 'absolute', top: -9, left: '15%', right: '15%',
              height: 1,
              backgroundColor: 'rgba(var(--xp-border-rgb, 41, 46, 66), 0.3)',
            }} />
          )}
          {dirChildren.map((child) => (
            <GraphNode key={child.id} node={child} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Editor: Tabbed view with Graph + Analysis ───────────────────────────────

const ArchitectEditor: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [data, setData] = useState<ArchData | null>(sharedArchData);
  const [analysis, setAnalysis] = useState<ArchAnalysis | null>(sharedAnalysis);
  const [activeTab, setActiveTab] = useState<'graph' | 'analysis'>(
    sharedAnalysis ? 'analysis' : 'graph'
  );

  useEffect(() => {
    if (sharedArchData) {
      setData(sharedArchData);
    } else if (sharedApi && filePath) {
      sharedApi.files.readText(filePath).then((text) => {
        try {
          const parsed = JSON.parse(text) as ArchData;
          sharedArchData = parsed;
          setData(parsed);
          notifyListeners();
        } catch { /* invalid file */ }
      }).catch(() => {});
    }
    setAnalysis(sharedAnalysis);
  }, [filePath]);

  useEffect(() => {
    const listener = () => {
      setData(sharedArchData);
      setAnalysis(sharedAnalysis);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const handleNavigate = useCallback((path: string) => {
    if (sharedApi) sharedApi.navigation.navigateTo(path);
  }, []);

  if (!data && !analysis) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--xp-text-muted, #565f89)', fontSize: 13,
      }}>
        No architecture data. Use the sidebar to generate one.
      </div>
    );
  }

  const rootNode: ArchNode | null = data ? {
    id: '__root__',
    label: data.projectName,
    kind: 'group',
    children: data.tree,
    depth: 0,
    filePath: data.rootPath,
  } : null;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      backgroundColor: 'var(--xp-bg, #1a1b26)',
    }}>
      {/* Tab bar */}
      {(data && analysis) && (
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(var(--xp-border-rgb, 41, 46, 66), 0.5)',
          backgroundColor: 'rgba(var(--xp-border-rgb, 41, 46, 66), 0.15)',
        }}>
          <TabButton label="Graph View" active={activeTab === 'graph'} onClick={() => setActiveTab('graph')} />
          <TabButton label="AI Analysis" active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'graph' && rootNode && (
          <div style={{
            padding: 32,
            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            minHeight: '100%',
          }}>
            <GraphNode node={rootNode} isRoot onNavigate={handleNavigate} />
          </div>
        )}

        {activeTab === 'analysis' && analysis && (
          <div style={{
            padding: '24px 32px', maxWidth: 800, margin: '0 auto',
          }}>
            <div style={{
              marginBottom: 20, paddingBottom: 12,
              borderBottom: '1px solid rgba(var(--xp-border-rgb, 41, 46, 66), 0.4)',
            }}>
              <h1 style={{
                fontSize: 20, fontWeight: 700,
                color: 'var(--xp-text, #c0caf5)',
                marginBottom: 4,
              }}>
                {analysis.projectName} - Architecture Analysis
              </h1>
              <span style={{
                fontSize: 11, color: 'var(--xp-text-muted, #565f89)',
              }}>
                Generated {new Date(analysis.generatedAt).toLocaleString()}
              </span>
            </div>
            <MarkdownSection content={analysis.content} />
          </div>
        )}

        {activeTab === 'analysis' && !analysis && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--xp-text-muted, #565f89)', fontSize: 13,
          }}>
            No analysis yet. Click "AI Analyze" in the sidebar to generate one.
          </div>
        )}
      </div>
    </div>
  );
};

// ── Extension Registration ───────────────────────────────────────────────────

SidebarTab.register({
  id: 'xplorer-architect',
  title: 'Architecture',
  icon: 'network',
  permissions: ['file:read', 'directory:list', 'ui:panels', 'ai:chat'],
  render: () => <ArchitectSidebar />,
  onActivate: (api) => {
    sharedApi = api as ExtendedAPI;
  },
});

Editor.register({
  id: 'xplorer-architect-editor',
  title: 'Architecture View',
  extensions: ['xparch'],
  priority: 50,
  permissions: ['file:read'],
  render: (props) => <ArchitectEditor filePath={props.filePath} />,
  onActivate: (api) => {
    sharedApi = api as ExtendedAPI;
  },
});

Command.register({
  id: 'xplorer-architect.generate',
  title: 'Generate Architecture',
  shortcut: 'ctrl+shift+a',
  permissions: ['file:read', 'directory:list'],
  action: async (api) => {
    const path = api.navigation.getCurrentPath();
    if (!path) return;
    sharedApi = api as ExtendedAPI;
    const tree = await scanDirectory(api, path, 0, 4);
    const projectName = path.split('/').pop() || path.split('\\').pop() || 'Project';
    sharedArchData = {
      projectName,
      generatedAt: new Date().toISOString(),
      rootPath: path,
      tree,
    };
    notifyListeners();
    try {
      const archFilePath = path.replace(/\/$/, '') + '/.xparch';
      await api.files.write(archFilePath, JSON.stringify(sharedArchData, null, 2));
      api.navigation.openFile(archFilePath);
    } catch {
      api.ui.showMessage('Architecture generated — check the sidebar', 'info');
    }
  },
});
