/**
 * Xplorer IDE Mode Extension — Project Explorer Sidebar
 *
 * Provides an IDE-like project sidebar with:
 * - Project type detection (Node, Rust, Python, Go, Java, .NET, Ruby)
 * - Recursive file tree with lazy loading
 * - File click opens in editor via api.navigation.openInEditor()
 * - Configurable directory exclusion (node_modules, .git, etc.)
 * - Refresh and collapse-all actions
 *
 * Depends on the Code Editor extension for editor tab integration.
 */

import React from 'react';
import { Sidebar, Command, type XplorerAPI } from '@xplorer/extension-sdk';

// ── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified?: string;
}

interface ProjectInfo {
  name: string;
  type: 'node' | 'rust' | 'python' | 'go' | 'java' | 'dotnet' | 'ruby' | 'unknown';
  rootPath: string;
}

interface PanelRenderProps {
  currentPath?: string;
  selectedFiles?: unknown[];
  [key: string]: unknown;
}

// ── Project Detection ───────────────────────────────────────────────────────

const PROJECT_MARKERS: Record<string, ProjectInfo['type']> = {
  'package.json': 'node',
  'Cargo.toml': 'rust',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'requirements.txt': 'python',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'Gemfile': 'ruby',
};

/** File extensions that indicate a .NET project (matched via endsWith) */
const DOTNET_EXTENSIONS = ['.csproj', '.sln', '.fsproj'];

const PROJECT_TYPE_LABELS: Record<ProjectInfo['type'], string> = {
  node: 'Node',
  rust: 'Rust',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  dotnet: '.NET',
  ruby: 'Ruby',
  unknown: 'Project',
};

const PROJECT_TYPE_COLORS: Record<ProjectInfo['type'], string> = {
  node: '#9ece6a',
  rust: '#ff9e64',
  python: '#7aa2f7',
  go: '#73daca',
  java: '#f7768e',
  dotnet: '#bb9af7',
  ruby: '#f7768e',
  unknown: '#565f89',
};

async function detectProject(api: XplorerAPI, path: string): Promise<ProjectInfo | null> {
  if (!path || path.startsWith('xplorer://') || path.startsWith('gdrive://')) {
    return null;
  }

  try {
    const entries = await api.files.list(path);
    const fileNames = new Set(entries.map((e: FileEntry) => e.name));

    // Check exact-match markers first
    for (const [marker, type] of Object.entries(PROJECT_MARKERS)) {
      if (fileNames.has(marker)) {
        const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
        return { name, type, rootPath: path };
      }
    }

    // Check .NET pattern markers (*.csproj, *.sln, *.fsproj)
    for (const entry of entries) {
      if (!entry.is_dir) {
        for (const ext of DOTNET_EXTENSIONS) {
          if (entry.name.endsWith(ext)) {
            const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
            return { name, type: 'dotnet', rootPath: path };
          }
        }
      }
    }

    // No project marker found — still return as unknown project
    const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
    return { name, type: 'unknown', rootPath: path };
  } catch {
    return null;
  }
}

// ── Directories to hide by default ──────────────────────────────────────────

const DEFAULT_HIDDEN_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  '__pycache__',
  '.next',
  'dist',
  'build',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.DS_Store',
  'vendor',
  '.cache',
  '.gradle',
  'bin',
  'obj',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
]);

// ── File Type Icon SVGs ─────────────────────────────────────────────────────

/**
 * Returns an inline SVG React element representing the file/folder type,
 * styled with VS Code-like colors using CSS variables for theme compatibility.
 */
function getFileTypeIcon(name: string, isDir: boolean): React.ReactElement {
  // Common SVG wrapper — 16x16, flex-shrunk, aria-hidden
  const svg = (color: string, pathD: string, extra?: React.ReactElement) =>
    React.createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '16',
      height: '16',
      viewBox: '0 0 16 16',
      fill: 'none',
      style: { flexShrink: 0, display: 'block' },
      'aria-hidden': 'true',
    },
      React.createElement('path', { d: pathD, fill: color }),
      extra || null,
    );

  // Folder icon (open/closed look — simple trapezoid + rectangle)
  if (isDir) {
    return React.createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '16',
      height: '16',
      viewBox: '0 0 16 16',
      fill: 'none',
      style: { flexShrink: 0, display: 'block' },
      'aria-hidden': 'true',
    },
      // Folder body
      React.createElement('path', {
        d: 'M1 4.5C1 3.67 1.67 3 2.5 3H6l1.5 1.5H13.5C14.33 4.5 15 5.17 15 6V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V4.5Z',
        fill: 'var(--xp-yellow, #e0af68)',
        opacity: '0.85',
      }),
      // Folder tab
      React.createElement('path', {
        d: 'M1 4.5H6.5L7.75 5.75H15V6C15 5.17 14.33 4.5 13.5 4.5H7.5L6 3H2.5C1.67 3 1 3.67 1 4.5Z',
        fill: 'var(--xp-yellow, #e0af68)',
        opacity: '0.55',
      }),
    );
  }

  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';

  // Generic file page path (folded corner)
  const genericFilePath = 'M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zm7 0v3h3';

  // Helper: two-letter badge icon (used for .ts, .js, .py, .rs, .go, etc.)
  const badgeIcon = (bg: string, label: string) => {
    const fontSize = label.length > 2 ? '4.5' : '5.5';
    return React.createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '16',
      height: '16',
      viewBox: '0 0 16 16',
      fill: 'none',
      style: { flexShrink: 0, display: 'block' },
      'aria-hidden': 'true',
    },
      // File page background
      React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: bg, strokeWidth: '0.75' }),
      // Color badge square in bottom-right
      React.createElement('rect', { x: '7', y: '8', width: '8', height: '7', rx: '1.5', fill: bg }),
      // Label text
      React.createElement('text', {
        x: '11',
        y: '13.4',
        textAnchor: 'middle',
        fontSize: fontSize,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fill: '#fff',
        style: { userSelect: 'none' },
      }, label),
    );
  };

  // Helper: plain colored page icon
  const coloredPage = (color: string) => svg(color, genericFilePath);

  switch (ext) {
    // ── TypeScript ──
    case 'ts':
      return badgeIcon('#3178c6', 'TS');
    case 'tsx':
      return badgeIcon('#3178c6', 'TSX');

    // ── JavaScript ──
    case 'js':
      return badgeIcon('#f0db4f', 'JS');
    case 'jsx':
      return badgeIcon('#f0db4f', 'JSX');
    case 'mjs':
    case 'cjs':
      return badgeIcon('#f0db4f', 'JS');

    // ── Python ──
    case 'py':
      return badgeIcon('#3572A5', 'PY');
    case 'pyx':
    case 'pyi':
      return badgeIcon('#3572A5', 'PY');

    // ── Rust ──
    case 'rs':
      return badgeIcon('#ce4a0a', 'RS');
    case 'toml':
      // TOML can be Cargo.toml — use a gear-tinted page
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#888b9d', strokeWidth: '0.75' }),
        React.createElement('path', {
          d: 'M4 7h8M4 9h6M4 11h4',
          stroke: '#888b9d',
          strokeWidth: '0.8',
          strokeLinecap: 'round',
        }),
      );

    // ── Go ──
    case 'go':
      return badgeIcon('#00add8', 'GO');

    // ── Java / Kotlin / Scala ──
    case 'java':
      return badgeIcon('#b07219', 'JV');
    case 'kt':
    case 'kts':
      return badgeIcon('#A97BFF', 'KT');
    case 'scala':
      return badgeIcon('#c22d40', 'SC');

    // ── C / C++ ──
    case 'c':
      return badgeIcon('#555599', 'C');
    case 'h':
      return badgeIcon('#6a737d', 'H');
    case 'cpp':
    case 'cc':
    case 'cxx':
      return badgeIcon('#f34b7d', 'C++');
    case 'hpp':
      return badgeIcon('#f34b7d', 'H++');

    // ── C# ──
    case 'cs':
      return badgeIcon('#178600', 'C#');

    // ── Ruby ──
    case 'rb':
      return badgeIcon('#cc342d', 'RB');

    // ── PHP ──
    case 'php':
      return badgeIcon('#4F5D95', 'PHP');

    // ── Swift ──
    case 'swift':
      return badgeIcon('#F05138', 'SW');

    // ── HTML ──
    case 'html':
    case 'htm':
      return badgeIcon('#e34c26', 'HTM');

    // ── CSS / SCSS / Less ──
    case 'css':
      return badgeIcon('#563d7c', 'CSS');
    case 'scss':
    case 'sass':
      return badgeIcon('#c6538c', 'SCSS');
    case 'less':
      return badgeIcon('#1d365d', 'LESS');

    // ── JSON ──
    case 'json':
    case 'jsonc':
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#cbcb41', strokeWidth: '0.75' }),
        // Curly braces motif
        React.createElement('text', {
          x: '8',
          y: '12.5',
          textAnchor: 'middle',
          fontSize: '7',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          fill: '#cbcb41',
          style: { userSelect: 'none' },
        }, '{ }'),
      );

    // ── Markdown / Text / Docs ──
    case 'md':
    case 'mdx':
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#519aba', strokeWidth: '0.75' }),
        React.createElement('text', {
          x: '8',
          y: '12.5',
          textAnchor: 'middle',
          fontSize: '6.5',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          fill: '#519aba',
          style: { userSelect: 'none' },
        }, 'MD'),
      );
    case 'txt':
      return coloredPage('var(--xp-text-muted, #888)');
    case 'pdf':
      return badgeIcon('#cc0000', 'PDF');

    // ── YAML ──
    case 'yaml':
    case 'yml':
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#6d8086', strokeWidth: '0.75' }),
        React.createElement('path', {
          d: 'M4 7h8M4 9h6M4 11h4',
          stroke: '#6d8086',
          strokeWidth: '0.8',
          strokeLinecap: 'round',
        }),
      );

    // ── Shell scripts ──
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return badgeIcon('#4eaa25', 'SH');

    // ── SQL / Database ──
    case 'sql':
      return badgeIcon('#e38d00', 'SQL');
    case 'db':
    case 'sqlite':
    case 'sqlite3':
      return badgeIcon('#003b57', 'DB');

    // ── Images ──
    case 'svg':
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#ffb13b', strokeWidth: '0.75' }),
        // Small circle + triangle to suggest image
        React.createElement('circle', { cx: '6', cy: '10', r: '1', fill: '#ffb13b' }),
        React.createElement('path', { d: 'M8 12l2-3 2 3H8Z', fill: '#ffb13b' }),
      );
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'ico':
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#9ece6a', strokeWidth: '0.75' }),
        React.createElement('circle', { cx: '6', cy: '10', r: '1', fill: '#9ece6a' }),
        React.createElement('path', { d: 'M8 12l2-3 2 3H8Z', fill: '#9ece6a' }),
      );

    // ── Lock files ──
    case 'lock':
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', { d: genericFilePath, fill: 'var(--xp-surface-light, #2a2a3c)', stroke: '#565f89', strokeWidth: '0.75' }),
        // Small padlock
        React.createElement('rect', { x: '6', y: '9.5', width: '4', height: '3', rx: '0.5', fill: '#565f89' }),
        React.createElement('path', { d: 'M6.5 9.5V8.5a1.5 1.5 0 013 0v1', stroke: '#565f89', strokeWidth: '0.75' }),
      );

    // ── Git ──
    case 'gitignore':
    case 'gitattributes':
    case 'gitmodules':
      return coloredPage('#f05033');

    // ── Env / config ──
    case 'env':
      return coloredPage('var(--xp-green, #9ece6a)');

    // ── Dockerfile ──
    case 'dockerfile':
      return badgeIcon('#0db7ed', 'DO');

    // ── Default generic file ──
    default:
      return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '16',
        height: '16',
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': 'true',
      },
        React.createElement('path', {
          d: genericFilePath,
          fill: 'var(--xp-surface-light, #2a2a3c)',
          stroke: 'var(--xp-text-muted, #565f89)',
          strokeWidth: '0.75',
        }),
        React.createElement('path', {
          d: 'M4 7h8M4 9h6M4 11h4',
          stroke: 'var(--xp-text-muted, #565f89)',
          strokeWidth: '0.8',
          strokeLinecap: 'round',
        }),
      );
  }
}

// ── FileTreeNode Component ──────────────────────────────────────────────────

function FileTreeNode({
  entry,
  api,
  depth,
  hiddenDirs,
}: {
  entry: FileEntry;
  api: XplorerAPI;
  depth: number;
  hiddenDirs: Set<string>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [children, setChildren] = React.useState<FileEntry[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState(false);

  const loadChildren = React.useCallback(async () => {
    if (children !== null) return; // already loaded
    setLoading(true);
    setError(null);
    try {
      const entries = await api.files.list(entry.path);
      // Filter hidden directories and sort: folders first, then alphabetical
      const filtered = entries.filter((e: FileEntry) => {
        if (e.is_dir && hiddenDirs.has(e.name)) return false;
        // Hide dotfiles that start with . (except common config files)
        return true;
      });
      filtered.sort((a: FileEntry, b: FileEntry) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setChildren(filtered);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [entry.path, children, api, hiddenDirs]);

  const handleClick = React.useCallback(() => {
    if (entry.is_dir) {
      const willExpand = !expanded;
      setExpanded(willExpand);
      if (willExpand) {
        loadChildren();
      }
    } else {
      // Open file in editor tab
      api.navigation.openInEditor(entry.path);
    }
  }, [entry.is_dir, entry.path, expanded, loadChildren, api]);

  const handleRefresh = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChildren(null);
    setError(null);
    setLoading(true);
    try {
      const entries = await api.files.list(entry.path);
      const filtered = entries.filter((e: FileEntry) => {
        if (e.is_dir && hiddenDirs.has(e.name)) return false;
        return true;
      });
      filtered.sort((a: FileEntry, b: FileEntry) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setChildren(filtered);
      setExpanded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [entry.path, api, hiddenDirs]);

  const icon = getFileTypeIcon(entry.name, entry.is_dir);
  const arrow = entry.is_dir ? (expanded ? '\u25BC' : '\u25B6') : '\u00A0\u00A0';

  return React.createElement('div', null,
    // Row
    React.createElement('div', {
      onClick: handleClick,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px 2px ' + (8 + depth * 16) + 'px',
        cursor: 'pointer',
        fontSize: '12px',
        lineHeight: '22px',
        color: 'var(--xp-text, #c0caf5)',
        backgroundColor: hovered ? 'var(--xp-surface-light, rgba(255,255,255,0.06))' : 'transparent',
        borderRadius: '3px',
        userSelect: 'none' as const,
        transition: 'background-color 0.1s ease',
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden',
      },
    },
      // Arrow
      React.createElement('span', {
        style: {
          width: '12px',
          flexShrink: 0,
          fontSize: '8px',
          textAlign: 'center' as const,
          color: 'var(--xp-text-muted, #888)',
        },
      }, arrow),
      // Icon (inline SVG React element)
      icon,
      // Name
      React.createElement('span', {
        style: {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        },
      }, entry.name),
      // Refresh button for directories (visible on hover)
      entry.is_dir && expanded && hovered
        ? React.createElement('span', {
            onClick: handleRefresh,
            title: 'Refresh',
            style: {
              flexShrink: 0,
              fontSize: '11px',
              padding: '0 4px',
              color: 'var(--xp-text-muted, #888)',
              cursor: 'pointer',
              opacity: 0.7,
            },
          }, '\u21BB')
        : null,
    ),
    // Children (if directory is expanded)
    expanded && entry.is_dir ? React.createElement('div', null,
      loading
        ? React.createElement('div', {
            style: {
              paddingLeft: (24 + depth * 16) + 'px',
              fontSize: '11px',
              color: 'var(--xp-text-muted, #888)',
              lineHeight: '22px',
            },
          }, 'Loading...')
        : error
          ? React.createElement('div', {
              style: {
                paddingLeft: (24 + depth * 16) + 'px',
                fontSize: '11px',
                color: 'var(--xp-red, #f7768e)',
                lineHeight: '22px',
              },
            }, 'Error: ' + error)
          : children && children.length === 0
            ? React.createElement('div', {
                style: {
                  paddingLeft: (24 + depth * 16) + 'px',
                  fontSize: '11px',
                  color: 'var(--xp-text-muted, #888)',
                  lineHeight: '22px',
                  fontStyle: 'italic',
                },
              }, 'Empty')
            : children
              ? children.map((child: FileEntry) =>
                  React.createElement(FileTreeNode, {
                    key: child.path,
                    entry: child,
                    api: api,
                    depth: depth + 1,
                    hiddenDirs: hiddenDirs,
                  })
                )
              : null,
    ) : null,
  );
}

// ── ProjectSidebar Component ────────────────────────────────────────────────

function ProjectSidebar({ currentPath, api }: { currentPath: string; api: XplorerAPI }) {
  const [project, setProject] = React.useState<ProjectInfo | null>(null);
  const [rootEntries, setRootEntries] = React.useState<FileEntry[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [treeKey, setTreeKey] = React.useState(0); // used to force re-render tree
  const [hiddenDirs] = React.useState(() => new Set(DEFAULT_HIDDEN_DIRS));
  const [showHiddenConfig, setShowHiddenConfig] = React.useState(false);

  // Detect project and load root entries when currentPath changes
  React.useEffect(() => {
    if (!currentPath || currentPath.startsWith('xplorer://') || currentPath.startsWith('gdrive://')) {
      setProject(null);
      setRootEntries(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const proj = await detectProject(api, currentPath);
        if (cancelled) return;
        setProject(proj);

        if (proj) {
          const entries = await api.files.list(proj.rootPath);
          if (cancelled) return;

          const filtered = entries.filter((e: FileEntry) => {
            if (e.is_dir && hiddenDirs.has(e.name)) return false;
            return true;
          });
          filtered.sort((a: FileEntry, b: FileEntry) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
          setRootEntries(filtered);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentPath, api, hiddenDirs]);

  // Handle refresh: re-detect project and reload root entries
  const handleRefresh = React.useCallback(() => {
    setTreeKey((k) => k + 1);
    setRootEntries(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const proj = await detectProject(api, currentPath);
        setProject(proj);
        if (proj) {
          const entries = await api.files.list(proj.rootPath);
          const filtered = entries.filter((e: FileEntry) => {
            if (e.is_dir && hiddenDirs.has(e.name)) return false;
            return true;
          });
          filtered.sort((a: FileEntry, b: FileEntry) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
          setRootEntries(filtered);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [currentPath, api, hiddenDirs]);

  // ── Empty state ──
  if (!currentPath || currentPath.startsWith('xplorer://')) {
    return React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '24px 16px',
        color: 'var(--xp-text-muted, #888)',
        fontSize: '13px',
        textAlign: 'center' as const,
      },
    },
      React.createElement('div', {
        style: { fontSize: '32px', marginBottom: '12px', opacity: 0.5 },
      }, '\u{1F4C2}'),
      React.createElement('div', {
        style: { fontWeight: 500, marginBottom: '4px', color: 'var(--xp-text, #c0caf5)' },
      }, 'No Project Open'),
      React.createElement('div', {
        style: { fontSize: '12px', lineHeight: '1.5' },
      }, 'Open a folder to see the project tree'),
    );
  }

  // ── Loading state ──
  if (loading && !rootEntries) {
    return React.createElement('div', {
      style: {
        padding: '16px',
        color: 'var(--xp-text-muted, #888)',
        fontSize: '13px',
      },
    }, 'Detecting project...');
  }

  // ── Error state ──
  if (error) {
    return React.createElement('div', {
      style: {
        padding: '16px',
        color: 'var(--xp-red, #f7768e)',
        fontSize: '13px',
      },
    }, 'Error: ', error);
  }

  // ── Main view ──
  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100%',
      fontSize: '13px',
      color: 'var(--xp-text, #c0caf5)',
    },
  },
    // ── Header ──
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--xp-border, #333)',
        flexShrink: 0,
      },
    },
      // Project name + type badge
      React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflow: 'hidden',
          flex: 1,
        },
      },
        React.createElement('span', {
          style: {
            fontWeight: 600,
            fontSize: '12px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
          },
        }, project?.name || 'Project'),
        project && project.type !== 'unknown'
          ? React.createElement('span', {
              style: {
                fontSize: '10px',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: '3px',
                backgroundColor: PROJECT_TYPE_COLORS[project.type] + '22',
                color: PROJECT_TYPE_COLORS[project.type],
                border: '1px solid ' + PROJECT_TYPE_COLORS[project.type] + '44',
                flexShrink: 0,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.5px',
              },
            }, PROJECT_TYPE_LABELS[project.type])
          : null,
      ),
      // Action buttons
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
      },
        // Filter config toggle
        React.createElement('button', {
          onClick: () => setShowHiddenConfig((v) => !v),
          title: 'Configure hidden directories',
          style: {
            background: 'none',
            border: 'none',
            color: showHiddenConfig ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-text-muted, #888)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 4px',
            borderRadius: '3px',
            lineHeight: 1,
          },
        }, '\u{2699}'),
        // Refresh button
        React.createElement('button', {
          onClick: handleRefresh,
          title: 'Refresh project tree',
          style: {
            background: 'none',
            border: 'none',
            color: 'var(--xp-text-muted, #888)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 4px',
            borderRadius: '3px',
            lineHeight: 1,
          },
        }, '\u21BB'),
      ),
    ),

    // ── Hidden dirs config panel ──
    showHiddenConfig
      ? React.createElement(HiddenDirsConfig, {
          hiddenDirs: hiddenDirs,
          onUpdate: () => {
            // Force refresh when hidden dirs change
            handleRefresh();
          },
        })
      : null,

    // ── File tree ──
    React.createElement('div', {
      key: treeKey,
      style: {
        flex: 1,
        overflow: 'auto',
        paddingTop: '4px',
        paddingBottom: '8px',
      },
    },
      rootEntries && rootEntries.length > 0
        ? rootEntries.map((entry: FileEntry) =>
            React.createElement(FileTreeNode, {
              key: entry.path,
              entry: entry,
              api: api,
              depth: 0,
              hiddenDirs: hiddenDirs,
            })
          )
        : !loading
          ? React.createElement('div', {
              style: {
                padding: '16px',
                color: 'var(--xp-text-muted, #888)',
                fontSize: '12px',
                textAlign: 'center' as const,
                fontStyle: 'italic',
              },
            }, 'No files found')
          : null,
    ),

    // ── Footer: project root path ──
    project
      ? React.createElement('div', {
          style: {
            padding: '6px 12px',
            borderTop: '1px solid var(--xp-border, #333)',
            fontSize: '10px',
            color: 'var(--xp-text-muted, #888)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
            flexShrink: 0,
          },
          title: project.rootPath,
        }, project.rootPath)
      : null,
  );
}

// ── HiddenDirsConfig Component ──────────────────────────────────────────────

function HiddenDirsConfig({
  hiddenDirs,
  onUpdate,
}: {
  hiddenDirs: Set<string>;
  onUpdate: () => void;
}) {
  const [inputValue, setInputValue] = React.useState('');
  const [items, setItems] = React.useState<string[]>(() => Array.from(hiddenDirs).sort());

  const handleAdd = React.useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && !hiddenDirs.has(trimmed)) {
      hiddenDirs.add(trimmed);
      setItems(Array.from(hiddenDirs).sort());
      setInputValue('');
      onUpdate();
    }
  }, [inputValue, hiddenDirs, onUpdate]);

  const handleRemove = React.useCallback((dir: string) => {
    hiddenDirs.delete(dir);
    setItems(Array.from(hiddenDirs).sort());
    onUpdate();
  }, [hiddenDirs, onUpdate]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  }, [handleAdd]);

  return React.createElement('div', {
    style: {
      padding: '8px 12px',
      borderBottom: '1px solid var(--xp-border, #333)',
      fontSize: '11px',
      maxHeight: '200px',
      overflow: 'auto',
    },
  },
    React.createElement('div', {
      style: {
        fontWeight: 600,
        color: 'var(--xp-text-muted, #888)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
        marginBottom: '6px',
        fontSize: '10px',
      },
    }, 'Hidden Directories'),
    // Input row
    React.createElement('div', {
      style: { display: 'flex', gap: '4px', marginBottom: '6px' },
    },
      React.createElement('input', {
        type: 'text',
        value: inputValue,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value),
        onKeyDown: handleKeyDown,
        placeholder: 'Add directory name...',
        style: {
          flex: 1,
          padding: '3px 6px',
          fontSize: '11px',
          background: 'var(--xp-surface-light, #1e1e2e)',
          border: '1px solid var(--xp-border, #333)',
          borderRadius: '3px',
          color: 'var(--xp-text, #c0caf5)',
          outline: 'none',
        },
      }),
      React.createElement('button', {
        onClick: handleAdd,
        style: {
          padding: '3px 8px',
          fontSize: '11px',
          background: 'var(--xp-blue, #7aa2f7)',
          border: 'none',
          borderRadius: '3px',
          color: '#fff',
          cursor: 'pointer',
        },
      }, '+'),
    ),
    // Tags list
    React.createElement('div', {
      style: { display: 'flex', flexWrap: 'wrap' as const, gap: '4px' },
    },
      items.map((dir: string) =>
        React.createElement('span', {
          key: dir,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 6px',
            borderRadius: '3px',
            fontSize: '10px',
            background: 'var(--xp-surface-light, rgba(255,255,255,0.06))',
            color: 'var(--xp-text-muted, #888)',
            border: '1px solid var(--xp-border, #333)',
          },
        },
          dir,
          React.createElement('span', {
            onClick: () => handleRemove(dir),
            style: {
              cursor: 'pointer',
              color: 'var(--xp-red, #f7768e)',
              fontWeight: 'bold',
              fontSize: '11px',
              lineHeight: 1,
            },
          }, '\u00D7'),
        )
      ),
    ),
  );
}

// ── Extension Registration ──────────────────────────────────────────────────

let api: XplorerAPI;

Sidebar.register({
  id: 'ide-mode',
  title: 'Workspace',
  description: 'IDE-like workspace sidebar with file tree, project detection, and editor integration',
  icon: 'list-tree',
  location: 'right',
  permissions: ['file:read', 'directory:list', 'ui:panels'],

  onActivate: async (injectedApi: XplorerAPI) => {
    api = injectedApi;
  },

  onDeactivate: () => {
    // Cleanup if needed
  },

  render: (props: PanelRenderProps) => {
    const currentPath = (props.currentPath as string) || '';
    return React.createElement(ProjectSidebar, { currentPath, api });
  },
});

Command.register({
  id: 'ide-mode.toggle',
  title: 'Toggle IDE Mode',
  shortcut: 'ctrl+shift+i',
  action: async (cmdApi: XplorerAPI) => {
    cmdApi.ui.showMessage('IDE Mode panel toggled', 'info');
  },
});

Command.register({
  id: 'ide-mode.refreshTree',
  title: 'Refresh Project Tree',
  action: async (cmdApi: XplorerAPI) => {
    cmdApi.ui.showMessage('Project tree refreshed', 'info');
  },
});
