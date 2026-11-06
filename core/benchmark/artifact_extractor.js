/**
 * 🌐 Universal Agent Core Hub - Benchmark Artifact Extractor
 * Deterministically extracts valid implementation artifacts from provider responses.
 *
 * Invariant: Prose is NEVER written as executable JavaScript.
 * Reliably handles:
 * - Pure JavaScript output
 * - Fenced code blocks (```js, ```javascript, ````, etc.)
 * - Multiple code sections (separating bash/config/examples from primary implementation)
 * - Explicit failure on malformed/no-code responses
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ARTIFACT_COLLECTION_STATUS } = require('./contracts');

/**
 * Validates whether a code string is syntactically valid JavaScript.
 * Supports both CommonJS and ES module declarations.
 *
 * @param {string} code
 * @returns {{ valid: boolean, error?: string, isEsm?: boolean }}
 */
function checkSyntax(code) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    return { valid: false, error: 'Empty code' };
  }

  try {
    new vm.Script(code);
    return { valid: true };
  } catch (err) {
    // If the error is specifically 'Unexpected token export' or 'Cannot use import statement',
    // verify if it is valid ES module syntax:
    if (/Unexpected token 'export'|Cannot use import statement outside a module/.test(err.message)) {
      try {
        const esmNeutralized = code
          .replace(/^\s*export\s+default\s+/gm, 'const __default__ = ')
          .replace(/^\s*export\s+(?:async\s+)?function\s+/gm, 'function ')
          .replace(/^\s*export\s+class\s+/gm, 'class ')
          .replace(/^\s*export\s+(?:const|let|var)\s+/gm, 'const ')
          .replace(/^\s*export\s*\{[^}]*\}\s*;?/gm, '')
          .replace(/^\s*import\s+[^;]*;?/gm, '');
        new vm.Script(esmNeutralized);
        return { valid: true, isEsm: true };
      } catch (esmErr) {
        return { valid: false, error: esmErr.message };
      }
    }
    return { valid: false, error: err.message };
  }
}

/**
 * Strips known CLI telemetry and metadata headers/footers from provider output.
 * @param {string} text
 * @returns {string}
 */
function stripCliMetadata(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^OpenAI Codex [^\n\r]+/gim, '')
    .replace(/^(?:model|reasoning effort|session id|provider|cost|elapsed):\s*[^\n\r]+/gim, '')
    .replace(/^tokens used\s*(?::\s*[0-9,]+|\r?\n\s*[0-9,]+)?/gim, '')
    .trim();
}

/**
 * Extracts the best valid JavaScript implementation code from raw provider output text.
 *
 * @param {string} text Raw text output from provider
 * @returns {{
 *   success: boolean,
 *   code: string | null,
 *   status: string,
 *   error: string | null
 * }}
 */
function extractCode(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      success: false,
      code: null,
      status: ARTIFACT_COLLECTION_STATUS.NO_CODE_FOUND,
      error: 'Empty or non-string provider output'
    };
  }

  // Pre-strip CLI metadata headers and footers to ensure clean separation
  const cleanedText = stripCliMetadata(text);
  if (!cleanedText) {
    return {
      success: false,
      code: null,
      status: ARTIFACT_COLLECTION_STATUS.NO_CODE_FOUND,
      error: 'Output contained only CLI metadata without model content'
    };
  }

  // Match all markdown fenced code blocks (3 or more backticks)
  const fenceRegex = /[ \t]*`{3,}([a-zA-Z0-9_+-]*)[^\n\r]*\r?\n([\s\S]*?)[ \t]*`{3,}/g;
  const blocks = [];
  let m;
  while ((m = fenceRegex.exec(cleanedText)) !== null) {
    blocks.push({
      lang: (m[1] || '').trim().toLowerCase(),
      code: m[2].trim()
    });
  }

  if (blocks.length > 0) {
    const ignoredLangs = new Set([
      'bash', 'sh', 'shell', 'zsh', 'terminal',
      'json', 'yaml', 'yml', 'toml',
      'markdown', 'md', 'diff',
      'html', 'css', 'text', 'txt'
    ]);

    const scoredCandidates = [];

    for (const b of blocks) {
      if (ignoredLangs.has(b.lang)) continue;

      const syntax = checkSyntax(b.code);
      if (!syntax.valid) continue;

      let score = 10;
      if (b.lang === 'js' || b.lang === 'javascript') score += 50;
      if (/\bmodule\.exports\b|\bexports\.\b|\bexport\b/.test(b.code)) score += 100;
      if (/\bfunction\b|\bclass\b/.test(b.code)) score += 30;
      score += Math.min(20, Math.floor(b.code.length / 100));

      // Penalize usage examples or test invocations requiring the local module
      if (/require\s*\(\s*['"]\.\/index['"]\s*\)|require\s*\(\s*['"]\.\/['"]\s*\)/.test(b.code)) {
        score -= 80;
      }
      if (b.code.startsWith('console.log') && !b.code.includes('function') && !b.code.includes('class')) {
        score -= 50;
      }

      scoredCandidates.push({ code: b.code, score, lang: b.lang });
    }

    if (scoredCandidates.length > 0) {
      scoredCandidates.sort((a, b) => b.score - a.score);
      return {
        success: true,
        code: scoredCandidates[0].code,
        status: ARTIFACT_COLLECTION_STATUS.EXTRACTED,
        error: null
      };
    }

    return {
      success: false,
      code: null,
      status: ARTIFACT_COLLECTION_STATUS.SYNTAX_INVALID,
      error: 'Code blocks found but none contain valid JavaScript syntax'
    };
  }

  // Case: No markdown code fences found in response
  const trimmed = cleanedText;

  // Guard against treating conversational greetings or prose as JS code
  if (/^(?:here|sure|i have|please|note|certainly|hello|hi|as requested|below is)\b/i.test(trimmed)) {
    return {
      success: false,
      code: null,
      status: ARTIFACT_COLLECTION_STATUS.NO_CODE_FOUND,
      error: 'Output is conversational prose without code blocks'
    };
  }

  // Validate pure JS candidate
  const syntax = checkSyntax(trimmed);
  const hasCodeConstructs = /(?:function\b|class\b|const\b|let\b|var\b|module\.exports|exports\b|=>|\breturn\b)/.test(trimmed);

  if (syntax.valid && hasCodeConstructs) {
    return {
      success: true,
      code: trimmed,
      status: ARTIFACT_COLLECTION_STATUS.EXTRACTED,
      error: null
    };
  }

  return {
    success: false,
    code: null,
    status: ARTIFACT_COLLECTION_STATUS.NO_CODE_FOUND,
    error: 'No valid JavaScript code block or syntax found in provider output'
  };
}

/**
 * Extracts and writes the implementation artifact to the target directory.
 * If the sandbox directory already contains an agent-created JS file, validates it.
 *
 * @param {string} text Raw provider text output
 * @param {string} targetDir Sandbox directory
 * @param {string} [defaultFileName='index.js'] Target filename
 * @returns {{
 *   success: boolean,
 *   filePath: string | null,
 *   status: string,
 *   error: string | null
 * }}
 */
function extractAndWriteArtifact(text, targetDir, defaultFileName = 'index.js') {
  if (!targetDir || !fs.existsSync(targetDir)) {
    return {
      success: false,
      filePath: null,
      status: ARTIFACT_COLLECTION_STATUS.NO_CODE_FOUND,
      error: `Target directory '${targetDir}' does not exist`
    };
  }

  const resolvedTarget = path.resolve(targetDir);
  const defaultPath = path.resolve(resolvedTarget, defaultFileName);
  const relFile = path.relative(resolvedTarget, defaultPath);
  if (!relFile || relFile.startsWith('..') || path.isAbsolute(relFile)) {
    return {
      success: false,
      filePath: null,
      status: ARTIFACT_COLLECTION_STATUS.NO_CODE_FOUND,
      error: `Path traversal attempt blocked: '${defaultFileName}'`
    };
  }

  // 1. Check if the sandbox already has an agent-created file on disk
  if (fs.existsSync(defaultPath)) {
    try {
      const existingContent = fs.readFileSync(defaultPath, 'utf8');
      const syntax = checkSyntax(existingContent);
      if (syntax.valid) {
        return {
          success: true,
          filePath: defaultPath,
          status: ARTIFACT_COLLECTION_STATUS.FOUND_ON_DISK,
          error: null
        };
      }
    } catch {}
  }

  // Check for any other .js file in sandbox
  const entries = fs.readdirSync(targetDir);
  const otherJs = entries.find(f => f.endsWith('.js') && !f.includes('test') && !f.includes('verifier'));
  if (otherJs) {
    const otherPath = path.join(targetDir, otherJs);
    try {
      const otherContent = fs.readFileSync(otherPath, 'utf8');
      const syntax = checkSyntax(otherContent);
      if (syntax.valid) {
        return {
          success: true,
          filePath: otherPath,
          status: ARTIFACT_COLLECTION_STATUS.FOUND_ON_DISK,
          error: null
        };
      }
    } catch {}
  }

  // 2. Extract code from provider text output
  const extraction = extractCode(text);
  if (!extraction.success || !extraction.code) {
    // Invariant: Do NOT write anything to disk on failure!
    return {
      success: false,
      filePath: null,
      status: extraction.status,
      error: extraction.error
    };
  }

  // 3. Write clean, validated code to destination
  fs.writeFileSync(defaultPath, extraction.code, 'utf8');
  return {
    success: true,
    filePath: defaultPath,
    status: ARTIFACT_COLLECTION_STATUS.EXTRACTED,
    error: null
  };
}

module.exports = {
  checkSyntax,
  extractCode,
  extractAndWriteArtifact
};
