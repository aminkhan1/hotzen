/**
 * 🌐 Universal Agent Core Hub - Static Security Scanner (D4 Layer-1)
 *
 * Scans generated trial code for suspicious patterns (process spawning,
 * dynamic code evaluation, network calls, filesystem path traversal) without
 * altering Verifier functional evaluation scores.
 *
 * Rules:
 * - Read-only inspection; produces staticFlags array.
 * - Comments are stripped prior to pattern matching to prevent false positives.
 * - Negative cases like RegExp.prototype.exec must NEVER trigger false positives.
 */

'use strict';

/**
 * Strips single-line and multi-line comments from JavaScript source code.
 * @param {string} code
 * @returns {string}
 */
/**
 * Strips single-line and multi-line comments from JavaScript source code,
 * preserving string literals and regular expression literals.
 * @param {string} code
 * @returns {string}
 */
function stripComments(code) {
  if (typeof code !== 'string') return '';
  return code.replace(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/(?:\\.|[^\/\n\r\\])+\/[gimsuy]*)|(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)/g, (match, strOrRegex, comment) => {
    if (strOrRegex) return strOrRegex;
    return '';
  });
}

/**
 * Checks whether code contains a call to fetch (rather than a method or function declaration).
 * @param {string} code
 * @returns {boolean}
 */
function isFetchCall(code) {
  if (/(?:globalThis|window)\.fetch\s*\(/.test(code)) return true;
  if (/\bfetch\s*\(\s*['"`]http/.test(code)) return true;
  const matches = [...code.matchAll(/(?<!function\s+|async\s+)\bfetch\s*\(([^)]*)\)(\s*\{)?/g)];
  for (const m of matches) {
    if (!m[2]) return true; // not followed by { body -> call
  }
  return false;
}

/**
 * Static security patterns and their flag identifiers.
 */
const SCANNER_RULES = [
  {
    flag: 'CHILD_PROCESS_REQUIRE',
    test: (code) => /\brequire\s*\(\s*['"`](node:)?child_process['"`]\s*\)/.test(code)
  },
  {
    flag: 'DYNAMIC_REQUIRE',
    test: (code) => /\brequire\s*\([^)]*\+[^)]*\)/.test(code) ||
                    /\brequire\s*\(\s*`[^`]*\$\{/.test(code) ||
                    /\brequire\s*\(\s*[^'"`\s)]/.test(code)
  },
  {
    flag: 'IMPORT_SENSITIVE_MODULE',
    test: (code) => /\bimport\s+.*?\s+from\s+['"`](node:)?(child_process|fs(\/promises)?|net|http|https|dgram)['"`]/.test(code) ||
                    /\bimport\s*\(\s*['"`](node:)?(child_process|fs(\/promises)?|net|http|https|dgram)['"`]\s*\)/.test(code)
  },
  {
    flag: 'ABSOLUTE_PATH_LITERAL',
    test: (code) => /['"`]\/(?:Users|home|tmp|var|private|etc|opt|Volumes)(?:\/|['"`])/.test(code)
  },
  {
    flag: 'NETWORK_CALL',
    test: (code) => isFetchCall(code) ||
                    /\b(XMLHttpRequest|WebSocket)\s*\(/.test(code) ||
                    /\brequire\s*\(\s*['"`](node:)?(http|https|net|dgram)['"`]\s*\)/.test(code)
  },
  {
    flag: 'DYNAMIC_EVAL',
    test: (code) => /\bglobalThis\s*\[[^\]]*\+[^\]]*\]/.test(code) ||
                    /\bwindow\s*\[[^\]]*\+[^\]]*\]/.test(code) ||
                    /\bglobal\s*\[[^\]]*\+[^\]]*\]/.test(code) ||
                    /\b(eval|Function)\s*\(/.test(code) ||
                    /\bnew\s+Function\s*\(/.test(code)
  },
  {
    flag: 'FS_PATH_TRAVERSAL',
    test: (code) => {
      const hasFs = /\brequire\s*\(\s*['"`](node:)?fs(\/promises)?['"`]\s*\)/.test(code);
      const hasTraversal = /['"`]\.\.['"`]|\.\.[/\\]/.test(code);
      return hasFs && hasTraversal;
    }
  },
  {
    flag: 'SUSPICIOUS_PROCESS_ACCESS',
    test: (code) => /\bprocess\.(binding|dlopen)\b/.test(code)
  }
];

/**
 * Scans source code and returns detected static flags.
 * Also scans unstripped raw code; flags appearing only in unstripped text
 * are appended with _UNSTRIPPED_ONLY suffix.
 *
 * @param {string} code - Source code to scan
 * @returns {string[]} Array of detected flags (empty if clean)
 */
function scanCode(code) {
  if (!code || typeof code !== 'string') return [];
  const cleanCode = stripComments(code);
  const flags = [];
  const cleanMatched = new Set();

  for (const rule of SCANNER_RULES) {
    if (rule.test(cleanCode)) {
      flags.push(rule.flag);
      cleanMatched.add(rule.flag);
    }
  }

  // Dual-scan unstripped raw code to detect patterns concealed in or around comments
  for (const rule of SCANNER_RULES) {
    if (!cleanMatched.has(rule.flag) && rule.test(code)) {
      flags.push(`${rule.flag}_UNSTRIPPED_ONLY`);
    }
  }

  return flags;
}

module.exports = {
  scanCode,
  stripComments,
  isFetchCall,
  SCANNER_RULES
};
