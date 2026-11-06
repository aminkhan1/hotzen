/**
 * 🌐 Universal Agent Core Hub - File Target Resolver
 * Deterministic, offline file-target inference and workspace discovery.
 *
 * Responsibilities:
 * 1. Preserves explicit file targets provided via options, task object, or CLI flags.
 * 2. Extracts and validates file paths mentioned in task prompt text.
 * 3. Deterministically discovers candidate files in standard workspace source folders
 *    matching task keywords (without broad repository indexing).
 * 4. Strictly validates candidate files against active project languages and workspace evidence:
 *    never claims 'index.js' unless supported by genuine JavaScript evidence.
 * 5. Returns an explicit unresolved representation when evidence is insufficient,
 *    ensuring truthfulness at the human approval gate.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const UNRESOLVED_TARGET = '(unresolved — to be determined during inspection)';

const CODE_EXTENSIONS = new Set([
  '.dart',
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
  '.py',
  '.go',
  '.rs',
  '.java', '.kt', '.kts',
  '.swift',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.json', '.yaml', '.yml',
  '.html', '.css', '.scss',
  '.sql', '.sh'
]);

const STANDARD_SOURCE_ROOTS = [
  'lib', 'test', 'tests', 'src', 'app', 'pkg', 'internal', 'cmd', 'bin', 'pages'
];

const IGNORED_SCAN_DIRS = new Set([
  '.git', 'node_modules', '.dart_tool', 'build', '.agents', '.gradle',
  'dist', 'target', '.idea', '.vscode', 'coverage', '.cache', 'vendor'
]);

const TASK_KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'have', 'make',
  'should', 'validate', 'verification', 'test', 'tests', 'update', 'implement',
  'feature', 'build', 'create', 'core', 'agent', 'task', 'code', 'file', 'files',
  'patch', 'patched', 'check', 'ensure', 'support', 'using', 'based', 'only',
  'real', 'work', 'working', 'upgrade', 'consumer'
]);

/**
 * Extracts path-like tokens from arbitrary text (prompts, goals, descriptions).
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractPathTokens(text) {
  if (!text || typeof text !== 'string') return [];

  const tokens = [];
  const regex = /(?:^|[\s"'`(\[<])([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_-]+|[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.\/]+)(?:$|[\s"'`)\]>:;,])/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    let raw = match[1].trim();

    // Strip leading/trailing quote/bracket/punctuation
    raw = raw.replace(/^["'`(\[<]+/, '').replace(/["'`)\]>:;,]+$/, '').trim();
    raw = raw.replace(/\\/g, '/');
    if (raw.startsWith('./')) {
      raw = raw.slice(2);
    }

    if (!raw || raw.startsWith('http://') || raw.startsWith('https://')) continue;
    if (raw.includes('..')) continue;
    if (raw.endsWith('.bak') || raw.includes('.bak.')) continue;
    if (/^v?\d+(\.\d+)+$/.test(raw)) continue; // Version numbers like v2.4.0 or 1.0.0

    const ext = path.extname(raw).toLowerCase();
    const firstSegment = raw.split('/')[0];

    const hasRecognizedExt = CODE_EXTENSIONS.has(ext);
    const startsWithStandardDir = STANDARD_SOURCE_ROOTS.includes(firstSegment);

    if (hasRecognizedExt || startsWithStandardDir) {
      tokens.push(raw);
    }
  }

  return Array.from(new Set(tokens));
}

/**
 * Checks whether candidate path is supported by workspace evidence.
 *
 * @param {string} candidate
 * @param {string} targetDir
 * @param {string[]} languages
 * @returns {boolean}
 */
function isCandidateSupportedByWorkspace(candidate, targetDir, languages = []) {
  if (!targetDir || typeof targetDir !== 'string') return true;

  try {
    const fullPath = path.resolve(targetDir, candidate);

    // 1. Existing file
    if (fs.existsSync(fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) return true;
      } catch {}
    }

    // 2. Parent directory exists in workspace
    const parentDir = path.dirname(fullPath);
    if (fs.existsSync(parentDir)) {
      try {
        const stat = fs.statSync(parentDir);
        if (stat.isDirectory()) return true;
      } catch {}
    }

    // 3. Starts with recognized source root in workspace
    const firstSegment = candidate.split('/')[0];
    const rootDir = path.join(targetDir, firstSegment);
    if (fs.existsSync(rootDir)) {
      return true;
    }
  } catch {}

  return false;
}

/**
 * Checks whether targetDir is an explicitly non-JavaScript workspace (e.g. Flutter, Go, Rust).
 *
 * @param {string} targetDir
 * @param {string[]} languages
 * @returns {boolean}
 */
function isExplicitlyNonJsWorkspace(targetDir, languages = []) {
  if (Array.isArray(languages) && languages.length > 0) {
    const hasJs = languages.some(l => {
      const norm = String(l).toLowerCase();
      return norm.includes('javascript') || norm.includes('node') || norm.includes('typescript');
    });
    if (!hasJs) {
      const hasNonJs = languages.some(l => {
        const norm = String(l).toLowerCase();
        return norm.includes('dart') || norm.includes('flutter') || norm.includes('python') || norm.includes('go') || norm.includes('rust');
      });
      if (hasNonJs) return true;
    }
  }

  if (targetDir && typeof targetDir === 'string' && fs.existsSync(targetDir)) {
    if (fs.existsSync(path.join(targetDir, 'pubspec.yaml'))) return true;
    if (fs.existsSync(path.join(targetDir, 'Cargo.toml'))) return true;
    if (fs.existsSync(path.join(targetDir, 'go.mod'))) return true;
  }

  return false;
}

/**
 * Checks whether 'index.js' has genuine evidence in the given workspace.
 *
 * @param {string} targetDir
 * @param {string[]} languages
 * @returns {boolean}
 */
function hasGenuineIndexJsEvidence(targetDir, languages = []) {
  if (!targetDir || typeof targetDir !== 'string') return false;

  // 1. If index.js actually exists on disk, that's definitive evidence
  if (fs.existsSync(path.join(targetDir, 'index.js'))) return true;

  return false;
}

/**
 * Deterministically scans standard source directories for files matching task keywords.
 * Scans max 3 levels deep and max 100 files to avoid broad indexing.
 *
 * @param {string} targetDir
 * @param {string[]} keywords
 * @param {string[]} languages
 * @returns {string[]}
 */
function discoverMatchingWorkspaceFiles(targetDir, keywords = [], languages = []) {
  if (!targetDir || !keywords || keywords.length === 0) return [];
  if (!fs.existsSync(targetDir)) return [];

  const isDart = languages.some(l => String(l).toLowerCase().includes('dart') || String(l).toLowerCase().includes('flutter'));
  const searchRoots = isDart ? ['lib', 'test'] : STANDARD_SOURCE_ROOTS.filter(r => fs.existsSync(path.join(targetDir, r)));

  const matched = [];
  let scannedCount = 0;
  const maxScan = 100;

  function walk(dir, relPrefix, depth) {
    if (depth > 3 || scannedCount >= maxScan) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (scannedCount >= maxScan) break;
        const name = entry.name;
        if (name.startsWith('.') || IGNORED_SCAN_DIRS.has(name)) continue;

        const relPath = relPrefix ? `${relPrefix}/${name}` : name;
        const fullPath = path.join(dir, name);

        if (entry.isDirectory()) {
          walk(fullPath, relPath, depth + 1);
        } else if (entry.isFile()) {
          scannedCount++;
          const ext = path.extname(name).toLowerCase();
          if (CODE_EXTENSIONS.has(ext)) {
            const lowerPath = relPath.toLowerCase();
            let score = 0;
            for (const kw of keywords) {
              if (lowerPath.includes(kw)) {
                score++;
              }
            }
            if (score > 0) {
              matched.push({ path: relPath, score, isTest: relPath.startsWith('test') });
            }
          }
        }
      }
    } catch {}
  }

  for (const root of searchRoots) {
    const fullRoot = path.join(targetDir, root);
    if (fs.existsSync(fullRoot)) {
      walk(fullRoot, root, 1);
    }
  }

  // Sort: highest score first, non-test before test, then alphabetical
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isTest !== b.isTest) return a.isTest ? 1 : -1;
    return a.path.localeCompare(b.path);
  });

  return matched.map(m => m.path);
}

/**
 * Extracts meaningful keyword tokens from task prompt.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractTaskKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !TASK_KEYWORD_STOPWORDS.has(w));

  return Array.from(new Set(words));
}

/**
 * Authoritative, deterministic file-target resolver.
 *
 * @param {string|object} input Raw task prompt, task object, or parsed plan object
 * @param {object} [options]
 * @param {string} [options.cwd] Consumer workspace path
 * @param {string} [options.targetDir] Consumer workspace path alias
 * @param {string[]} [options.languages] Active project languages
 * @param {string[]|string} [options.filesToModify] Explicitly requested files
 * @param {string} [options.taskPrompt] Explicit task prompt string
 * @returns {string[]} Truthful array of files to modify
 */
function resolvePlanFilesToModify(input, options = {}) {
  const targetDir = options.targetDir || options.cwd || process.cwd();
  const languages = Array.isArray(options.languages) ? options.languages : [];

  // 1. Explicit files provided via options
  const explicit = options.filesToModify || options.files;
  if (Array.isArray(explicit) && explicit.length > 0) {
    const cleaned = explicit.map(f => String(f).trim()).filter(Boolean);
    if (cleaned.length > 0) return Array.from(new Set(cleaned));
  } else if (typeof explicit === 'string' && explicit.trim()) {
    const split = explicit.split(',').map(s => s.trim()).filter(Boolean);
    if (split.length > 0) return Array.from(new Set(split));
  }

  // 2. Input object may contain explicit filesToModify or files
  if (input && typeof input === 'object') {
    const rawFiles = input.filesToModify || input.files;
    if (Array.isArray(rawFiles) && rawFiles.length > 0) {
      const candidates = rawFiles.map(f => String(f).trim()).filter(Boolean);

      // Validate candidates: if only ['index.js'] is present, verify it is not contradicting a non-JS workspace
      const hasOnlyIndexJs = candidates.length === 1 && candidates[0] === 'index.js';
      if (hasOnlyIndexJs) {
        if (isExplicitlyNonJsWorkspace(targetDir, languages) && !fs.existsSync(path.join(targetDir, 'index.js'))) {
          // index.js contradicts this workspace (e.g. Flutter); do not trust it, fall through to discovery
        } else {
          return ['index.js'];
        }
      } else {
        const filtered = candidates.filter(c => c !== UNRESOLVED_TARGET);
        if (filtered.length > 0) {
          return Array.from(new Set(filtered));
        }
      }
    }
  }

  // 3. Extract candidate paths from task text / prompt
  const promptText = (typeof input === 'string')
    ? input
    : (options.taskPrompt || (input && (input.userPrompt || input.goal || input.title)) || '');

  const extractedTokens = extractPathTokens(promptText);
  if (extractedTokens.length > 0) {
    const validated = extractedTokens.filter(t => isCandidateSupportedByWorkspace(t, targetDir, languages));
    if (validated.length > 0) {
      return validated;
    }
    // If not on disk yet but recognized source paths (e.g. lib/counter.dart), keep them
    return extractedTokens;
  }

  // 4. Deterministic workspace inspection matching task keywords
  const keywords = extractTaskKeywords(promptText);
  if (keywords.length > 0 && fs.existsSync(targetDir)) {
    const discovered = discoverMatchingWorkspaceFiles(targetDir, keywords, languages);
    if (discovered.length > 0) {
      return discovered;
    }
  }

  // 5. If genuine index.js evidence exists in a JS project, allow index.js
  if (hasGenuineIndexJsEvidence(targetDir, languages)) {
    return ['index.js'];
  }

  // 6. Insufficient evidence: return explicit unresolved representation
  return [UNRESOLVED_TARGET];
}

module.exports = {
  UNRESOLVED_TARGET,
  CODE_EXTENSIONS,
  extractPathTokens,
  hasGenuineIndexJsEvidence,
  discoverMatchingWorkspaceFiles,
  resolvePlanFilesToModify
};
