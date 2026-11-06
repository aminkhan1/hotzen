/**
 * 🌐 Universal Agent Core Hub - Deterministic Workspace Critic
 * Task 4B2B3B1 Implementation: Standalone Objective Workspace Safety & Invariant Critic
 *
 * Responsibilities:
 * 1. Evaluates ONLY objective workspace safety, security, and verification-consistency conditions.
 * 2. Never claims to evaluate subjective architectural taste, SOLID design, KISS simplicity,
 *    naming quality, or full 7-question semantic review.
 * 3. Enforces 9 objective blocking checks:
 *    - Verifier consistency (Verifier Contradiction Guard)
 *    - Unresolved Git merge conflict markers
 *    - Secret / credential leakage
 *    - Blocked sensitive files (with public certificate exemption)
 *    - Anti-lazy code placeholders
 *    - Dangerous dynamic execution (eval / new Function)
 *    - Prohibited live network calls in test / scratch scope (Zero External Side-Effects)
 *    - Unauthorized protected governance-path modifications (.agents/rules/, .agents/security/)
 *    - Zero-edit anomaly when changed-workspace verification was expected
 * 4. Completely read-only: never modifies workspace files or git status.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isFetchCall } = require('../benchmark/static_security_scanner');
const { discoverWorkspaceChanges } = require('../workflow/verification_workspace');

/**
 * High-confidence secret patterns (minimal equivalent subset of security_scanner.py).
 * Excludes safe documentation placeholders.
 */
const SECRET_PATTERNS = [
  { name: 'OpenAI API Key', pattern: /\bsk-[a-zA-Z0-9]{20,}\b|\bsk-proj-[a-zA-Z0-9_\-]{20,}\b/ },
  { name: 'Anthropic API Key', pattern: /\bsk-ant-(api03-)?[a-zA-Z0-9_\-]{20,}\b/ },
  { name: 'Google / Gemini API Key', pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: 'AWS Access Key ID', pattern: /\b(AKIA|ASIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/ },
  { name: 'AWS Secret Key', pattern: /aws_secret_access_key\s*[:=]\s*['"][0-9a-zA-Z/+=]{40}['"]/i },
  { name: 'GitHub Token', pattern: /\b(gh[pousr]_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})\b/ },
  { name: 'Stripe API Secret', pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'Slack Token', pattern: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/ },
  { name: 'Slack Webhook URL', pattern: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9a-zA-Z]+/ },
  { name: 'Generic Private Key', pattern: /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/ },
  { name: 'Database Connection String with Password', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s]+@[^/\s]+/ }
];

/**
 * Blocked sensitive file patterns that must never be added to workspace code.
 */
const BLOCKED_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /.*\.pem$/i,
  /.*\.key$/i,
  /.*\.p12$/i,
  /.*\.pfx$/i,
  /^id_rsa.*$/i,
  /^id_ed25519.*$/i,
  /^id_ecdsa.*$/i,
  /.*credentials.*\.json$/i,
  /.*service_account.*\.json$/i,
  /.*service-account.*\.json$/i,
  /^secrets?\.ya?ml$/i,
  /.*\.keystore$/i,
  /.*\.jks$/i
];

/**
 * Anti-lazy code patterns (prohibits incomplete code placeholders).
 */
const LAZY_CODE_PATTERNS = [
  { name: 'Lazy code ellipsis', pattern: /(?:\/\/|#)\s*\.\.\.\s*(?:rest of|remaining|existing)\s+(?:code|implementation)/i },
  { name: 'Lazy implementation placeholder', pattern: /(?:\/\/|#)\s*TODO:?\s*(?:implement\s+(?:this|later|here)|code\s+here)/i },
  { name: 'Incomplete code block', pattern: /\/\*+\s*\.\.\.\s*(?:rest of|remaining)?\s*code\s*\.\.\.\s*\*+\//i }
];

/**
 * Known safe mock documentation placeholders.
 */
const KNOWN_SAFE_SUBSTRINGS = [
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'your_api_key_here',
  'your_token_here',
  'your-api-key',
  '<your-api-key>',
  '<api_key>',
  '<token>',
  'insert_secret_here',
  'sk-ant-api03-placeholder',
  '00000000000000000000',
  'xxxxxxxxxxxxxxxxxxxx'
];

/**
 * Source code file extensions subject to lazy placeholder inspection.
 */
const SOURCE_CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.dart', '.rs', '.go',
  '.sol', '.php', '.cs', '.java', '.kt', '.swift', '.cpp', '.c', '.h'
]);

/**
 * Protected Core governance directories and files.
 */
const PROTECTED_GOVERNANCE_PREFIXES = [
  '.agents/rules/',
  '.agents/security/',
  '.agents/hooks/',
  '.git/'
];

/**
 * Strips comments from code while preserving string literals, regular expression literals,
 * and exact line count (by converting comment characters to spaces).
 *
 * @param {string} code Source code string
 * @param {boolean} [isHashComment=false] Whether single-line comments use # (Python, Shell, Ruby)
 * @returns {string} Cleaned code string with line count preserved
 */
function stripCommentsPreservingLines(code, isHashComment = false) {
  if (typeof code !== 'string') return '';
  if (isHashComment) {
    return code.replace(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|"""[\s\S]*?"""|'''[\s\S]*?''')|(#.*$)/gm, (match, str, comment) => {
      if (str) return str;
      return comment ? comment.replace(/[^\n\r]/g, ' ') : '';
    });
  }
  return code.replace(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/(?![*\/])(?:\\.|[^\/\n\r\\])+\/[gimsuy]*)|(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)/g, (match, strOrRegex, comment) => {
    if (strOrRegex) return strOrRegex;
    return comment ? comment.replace(/[^\n\r]/g, ' ') : '';
  });
}

/**
 * Checks whether matched secret text is a known documentation placeholder.
 *
 * @param {string} matchedText
 * @param {string} lineText
 * @returns {boolean}
 */
function isSafePlaceholder(matchedText, lineText) {
  const lowerMatched = matchedText.toLowerCase();
  const lowerLine = lineText.toLowerCase();
  return KNOWN_SAFE_SUBSTRINGS.some(safe => {
    const s = safe.toLowerCase();
    return lowerMatched.includes(s) || lowerLine.includes(s);
  });
}

/**
 * Determines whether a file is strictly a public certificate / public key.
 * Allows synthetic/standard public certificates (.pem, .crt, .key) while strictly
 * blocking private keys, encrypted keys, and embedded secrets.
 *
 * @param {string} content File content string
 * @returns {boolean}
 */
function isPublicCertificate(content) {
  if (typeof content !== 'string') return false;
  // Reject if it contains ANY private key or encrypted key declarations
  if (/-----BEGIN[ A-Z0-9_-]*(PRIVATE KEY|ENCRYPTED)-----/i.test(content)) {
    return false;
  }
  // Accept if it declares standard public certificate or public key headers
  if (/-----BEGIN CERTIFICATE-----/.test(content) || /-----BEGIN PUBLIC KEY-----/.test(content)) {
    // Ensure no other secret leaks are present alongside the certificate
    for (const { pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Determines if a file path belongs to test or scratch scope.
 *
 * @param {string} relPath Normalized relative path
 * @returns {boolean}
 */
function isTestOrScratchScope(relPath) {
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  const parts = norm.split('/');
  const filename = parts[parts.length - 1];

  if (parts.includes('test') || parts.includes('tests') || parts.includes('spec') || parts.includes('specs') || parts.includes('scratch')) {
    return true;
  }
  if (norm.startsWith('test/') || norm.startsWith('tests/') || norm.startsWith('scratch/')) {
    return true;
  }
  if (/(\.|\b)(test|spec)\.[a-z0-9]+$/i.test(filename)) {
    return true;
  }
  if (/^test_.*\.py$/i.test(filename) || /.*_test\.(py|dart|go|rs)$/i.test(filename)) {
    return true;
  }
  return false;
}

/**
 * Deterministically checks whether targetDir is a Flutter workspace.
 *
 * @param {string} targetDir
 * @returns {boolean}
 */
function isFlutterWorkspace(targetDir) {
  if (!targetDir || typeof targetDir !== 'string') return false;
  try {
    const { detectStack } = require('../../cli');
    const detected = detectStack(targetDir);
    if (detected && detected.stack === 'flutter') return true;
  } catch (_) {}
  try {
    const pubspec = path.join(targetDir, 'pubspec.yaml');
    if (fs.existsSync(pubspec)) {
      const content = fs.readFileSync(pubspec, 'utf8');
      return content.includes('flutter:');
    }
  } catch (_) {}
  return false;
}

/**
 * Checks whether a relative path represents a top-level Flutter build artifact
 * that should be excluded from source/security critic scanning.
 *
 * @param {string} relPath
 * @param {string} targetDir
 * @param {string|null} [stack]
 * @returns {boolean}
 */
function isFlutterBuildArtifact(relPath, targetDir, stack = null) {
  if (typeof relPath !== 'string') return false;
  const norm = relPath.replace(/\\/g, '/');
  if (norm !== 'build' && !norm.startsWith('build/')) {
    return false;
  }
  if (stack === 'flutter') return true;
  return isFlutterWorkspace(targetDir);
}

function expandFiles(targetDir, fileList, isFlutter = false) {
  const result = [];
  for (const f of fileList) {
    const norm = f.replace(/\\/g, '/');
    if (isFlutter && (norm === 'build' || norm.startsWith('build/'))) continue;
    const full = path.resolve(targetDir, f);
    if (!fs.existsSync(full)) {
      result.push(f);
      continue;
    }
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const walk = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            if (isFlutter && (entry.name === 'build' || entry.name === '.dart_tool')) continue;
            const sub = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(sub);
            } else {
              const rel = path.relative(targetDir, sub).replace(/\\/g, '/');
              if (!(isFlutter && (rel === 'build' || rel.startsWith('build/')))) {
                result.push(rel);
              }
            }
          }
        };
        walk(full);
      } else {
        result.push(f);
      }
    } catch (_) {
      result.push(f);
    }
  }
  return Array.from(new Set(result));
}

/**
 * Discovers modified and untracked files in the target directory using git.
 *
 * @param {string} targetDir Target workspace directory
 * @param {boolean} [isFlutter=false]
 * @returns {string[]} List of relative file paths
 */
function discoverChangedFiles(targetDir, isFlutter = false) {
  return expandFiles(targetDir, discoverWorkspaceChanges(targetDir), isFlutter);
}

/**
 * Evaluates the Deterministic Workspace Critic over a target workspace.
 *
 * @param {string} targetDir Absolute or relative path to consumer workspace
 * @param {object} [options]
 * @param {object} [options.verifierResult] Verification matrix result from runVerify
 * @param {object} [options.verificationEvidence] Normalized verification evidence
 * @param {string[]} [options.changedFiles] Explicit file list override (bypasses git diff discovery)
 * @param {string} [options.scope='changed'] Verification scope ('changed' | 'full')
 * @param {boolean} [options.allowEmptyDiff=false] Whether 0 changed files is permitted
 * @returns {{
 *   passed: boolean,
 *   criticType: string,
 *   evaluatedAt: string,
 *   scope: {
 *     targetDir: string,
 *     scope: string,
 *     filesExamined: string[],
 *     linesScanned: number
 *   },
 *   checks: {
 *     verifierConsistency: { passed: boolean, fatalViolation?: string|null },
 *     mergeConflictMarkers: { passed: boolean, violations: string[] },
 *     secretsAndBlockedFiles: { passed: boolean, violations: string[] },
 *     antiLazyPlaceholders: { passed: boolean, violations: string[] },
 *     dynamicExecution: { passed: boolean, violations: string[] },
 *     prohibitedLiveNetworkCalls: { passed: boolean, violations: string[] },
 *     protectedGovernancePaths: { passed: boolean, violations: string[] },
 *     workingTreeNonEmpty: { passed: boolean, message?: string }
 *   },
 *   concerns: string[]
 * }}
 */
function evaluateDeterministicWorkspaceCritic(targetDir = process.cwd(), options = {}) {
  const resolvedDir = path.resolve(targetDir);
  const scope = options.scope || 'changed';
  const evaluatedAt = new Date().toISOString();
  const concerns = [];
  const defaultCanonicalAgentsDir = path.resolve(__dirname, '..', '..', '.agents');
  const canonicalAgentsDir = (typeof options.canonicalAgentsDir === 'string' && options.canonicalAgentsDir.trim())
    ? path.resolve(options.canonicalAgentsDir.trim())
    : defaultCanonicalAgentsDir;

  // Structure check results
  const checks = {
    verifierConsistency: { passed: true, fatalViolation: null },
    mergeConflictMarkers: { passed: true, violations: [] },
    secretsAndBlockedFiles: { passed: true, violations: [] },
    antiLazyPlaceholders: { passed: true, violations: [] },
    dynamicExecution: { passed: true, violations: [] },
    prohibitedLiveNetworkCalls: { passed: true, violations: [] },
    protectedGovernancePaths: { passed: true, violations: [] },
    workingTreeNonEmpty: { passed: true }
  };

  // 1. Verifier Consistency (Contradiction Guard)
  const verifierResult = options.verifierResult || options.verificationEvidence;
  if (verifierResult) {
    let verifierFailed = false;
    let failureReason = null;

    if (typeof verifierResult.allPassed === 'boolean' && !verifierResult.allPassed) {
      verifierFailed = true;
      failureReason = 'Verifier test suite reported failures';
    } else if (verifierResult.isClean === false) {
      verifierFailed = true;
      failureReason = verifierResult.fatalViolation || 'Verifier evidence reported isClean = false';
    } else if (Array.isArray(verifierResult.checks) && verifierResult.checks.some(c => c.status === 'FAILED')) {
      verifierFailed = true;
      const failedCheck = verifierResult.checks.find(c => c.status === 'FAILED');
      failureReason = `Verifier check failed: ${failedCheck.name}`;
    } else if (verifierResult.fatalViolation) {
      verifierFailed = true;
      failureReason = `Verifier fatal violation: ${verifierResult.fatalViolation}`;
    } else if (Array.isArray(verifierResult.securityViolations) && verifierResult.securityViolations.length > 0) {
      verifierFailed = true;
      failureReason = `Verifier security violations: ${verifierResult.securityViolations.join('; ')}`;
    }

    if (verifierFailed) {
      checks.verifierConsistency.passed = false;
      checks.verifierConsistency.fatalViolation = failureReason;
      concerns.push(`Verifier Contradiction: Deterministic verifier failed (${failureReason}). Critic approval prohibited.`);
    }
  }

  const detectedStack = (typeof options.stack === 'string' && options.stack.trim())
    ? options.stack.trim()
    : ((verifierResult && typeof verifierResult.stack === 'string' && verifierResult.stack.trim()) ? verifierResult.stack.trim() : null);
  const isFlutter = detectedStack === 'flutter' || isFlutterWorkspace(resolvedDir);

  // 2. Discover Changed Files Scope
  const rawFilesExamined = Array.isArray(options.changedFiles)
    ? options.changedFiles.map(f => f.replace(/\\/g, '/'))
    : discoverChangedFiles(resolvedDir, isFlutter);

  const filesExamined = isFlutter
    ? rawFilesExamined.filter(f => f !== 'build' && !f.startsWith('build/'))
    : rawFilesExamined;

  // 3. Working Tree Non-Empty Guard
  if (filesExamined.length === 0 && !options.allowEmptyDiff && scope === 'changed') {
    checks.workingTreeNonEmpty.passed = false;
    checks.workingTreeNonEmpty.message = 'Zero modified or staged files detected in workspace when changes were expected.';
    concerns.push('Zero Changes Anomaly: No modified files detected in workspace.');
  }

  let linesScanned = 0;

  // Scan each changed file
  for (const relPath of filesExamined) {
    const normalizedRelPath = relPath.replace(/\\/g, '/');
    if (isFlutter && (normalizedRelPath === 'build' || normalizedRelPath.startsWith('build/'))) {
      continue;
    }
    const basename = path.basename(normalizedRelPath);
    const fullPath = path.resolve(resolvedDir, normalizedRelPath);

    // 4. Protected Governance Path Guard
    for (const prefix of PROTECTED_GOVERNANCE_PREFIXES) {
      if (normalizedRelPath === prefix.slice(0, -1) || normalizedRelPath.startsWith(prefix)) {
        let isAllowedCanonicalUpgrade = false;

        // .git/ is VCS internal and strictly never canonical
        if (prefix !== '.git/' && normalizedRelPath.startsWith('.agents/')) {
          const relFromAgents = path.relative('.agents', normalizedRelPath);
          // Path traversal guard: ensure relFromAgents does not escape with '..'
          if (!relFromAgents.startsWith('..') && !path.isAbsolute(relFromAgents)) {
            const canonicalFullPath = path.resolve(canonicalAgentsDir, relFromAgents);
            // Ensure canonicalFullPath is strictly contained within canonicalAgentsDir
            const relCheck = path.relative(canonicalAgentsDir, canonicalFullPath);
            if (!relCheck.startsWith('..') && !path.isAbsolute(relCheck)) {
              try {
                if (fs.existsSync(canonicalFullPath) && fs.existsSync(fullPath)) {
                  const canonicalStat = fs.statSync(canonicalFullPath);
                  const consumerStat = fs.statSync(fullPath);
                  if (canonicalStat.isFile() && consumerStat.isFile()) {
                    const canonicalBuf = fs.readFileSync(canonicalFullPath);
                    const consumerBuf = fs.readFileSync(fullPath);
                    if (canonicalBuf.equals(consumerBuf)) {
                      isAllowedCanonicalUpgrade = true;
                    }
                  }
                }
              } catch (_) {
                isAllowedCanonicalUpgrade = false;
              }
            }
          }
        }

        if (!isAllowedCanonicalUpgrade) {
          const msg = `Unauthorized modification to protected governance path: '${normalizedRelPath}'`;
          checks.protectedGovernancePaths.passed = false;
          checks.protectedGovernancePaths.violations.push(msg);
          concerns.push(`Governance Integrity Violation: ${msg}`);
        }
      }
    }

    // Skip inspection if file does not exist (e.g. deleted files)
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    // Skip directories and files over 2MB
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() || stat.size > 2 * 1024 * 1024) {
      continue;
    }

    let rawContent = '';
    try {
      rawContent = fs.readFileSync(fullPath, 'utf8');
    } catch (_) {
      continue;
    }

    const rawLines = rawContent.split(/\r?\n/);
    linesScanned += rawLines.length;

    // 5. Blocked Sensitive Files Guard
    for (const pattern of BLOCKED_FILE_PATTERNS) {
      if (pattern.test(basename)) {
        // Special exemption check for public certificates (.pem, .crt, .key)
        if (basename.toLowerCase().endsWith('.pem') || basename.toLowerCase().endsWith('.crt') || basename.toLowerCase().endsWith('.key')) {
          if (isPublicCertificate(rawContent)) {
            break; // Public certificate permitted
          }
        }
        const msg = `Blocked sensitive file detected: '${normalizedRelPath}'`;
        checks.secretsAndBlockedFiles.passed = false;
        checks.secretsAndBlockedFiles.violations.push(msg);
        concerns.push(`Sensitive File Policy: ${msg}`);
        break;
      }
    }

    // 6. Merge Conflict Markers Check (scanned on raw lines)
    for (let idx = 0; idx < rawLines.length; idx++) {
      const line = rawLines[idx];
      if (/^(<{7}(?:\s.*)?|={7}|>{7}(?:\s.*)?)$/.test(line.trim())) {
        const msg = `Unresolved merge conflict marker detected in ${normalizedRelPath}:${idx + 1}`;
        checks.mergeConflictMarkers.passed = false;
        checks.mergeConflictMarkers.violations.push(msg);
        concerns.push(`Merge Conflict: ${msg}`);
        break; // One marker in file is sufficient to fail check
      }
    }

    const ext = path.extname(basename).toLowerCase();
    const isHashCommentLang = ['.py', '.sh', '.rb', '.yaml', '.yml'].includes(ext);
    const cleanContent = stripCommentsPreservingLines(rawContent, isHashCommentLang);
    const cleanLines = cleanContent.split(/\r?\n/);

    // 7. Secret Leaks Check
    for (let idx = 0; idx < rawLines.length; idx++) {
      const cleanLine = cleanLines[idx];
      if (!cleanLine || !cleanLine.trim()) continue;

      for (const { name, pattern } of SECRET_PATTERNS) {
        const match = cleanLine.match(pattern);
        if (match) {
          const matchedToken = match[0];
          if (!isSafePlaceholder(matchedToken, cleanLine)) {
            const masked = matchedToken.length > 12
              ? `${matchedToken.slice(0, 6)}...${matchedToken.slice(-4)}`
              : '***';
            const msg = `Hardcoded secret detected [${name}] in ${normalizedRelPath}:${idx + 1} (${masked})`;
            checks.secretsAndBlockedFiles.passed = false;
            checks.secretsAndBlockedFiles.violations.push(msg);
            concerns.push(`Credential Leak: ${msg}`);
          }
        }
      }
    }

    // 8. Anti-Lazy Code Check (scanned on source files outside test/mock scope)
    const isSourceCode = SOURCE_CODE_EXTENSIONS.has(ext) && !isTestOrScratchScope(normalizedRelPath);
    if (isSourceCode) {
      for (let idx = 0; idx < rawLines.length; idx++) {
        const rawLine = rawLines[idx];
        for (const { name, pattern } of LAZY_CODE_PATTERNS) {
          if (pattern.test(rawLine)) {
            const msg = `Lazy code placeholder [${name}] in ${normalizedRelPath}:${idx + 1}: '${rawLine.trim()}'`;
            checks.antiLazyPlaceholders.passed = false;
            checks.antiLazyPlaceholders.violations.push(msg);
            concerns.push(`Anti-Lazy Code Policy: ${msg}`);
          }
        }
      }
    }

    // 9. Dangerous Dynamic Execution Check (eval / new Function)
    for (let idx = 0; idx < cleanLines.length; idx++) {
      const cleanLine = cleanLines[idx];
      if (!cleanLine || !cleanLine.trim()) continue;

      if (/\beval\s*\(/.test(cleanLine) || /\bnew\s+Function\s*\(/.test(cleanLine) || /\bFunction\s*\([^)]*\)\s*\(/.test(cleanLine)) {
        const msg = `Dangerous dynamic code execution (eval/Function) in ${normalizedRelPath}:${idx + 1}`;
        checks.dynamicExecution.passed = false;
        checks.dynamicExecution.violations.push(msg);
        concerns.push(`Security Policy Violation: ${msg}`);
      }
    }

    // 10. Prohibited Live Network Calls in Test / Scratch Scope Only
    // Strict invariant: Normal production networking is permitted. Only test/scratch live calls are blocked.
    if (isTestOrScratchScope(normalizedRelPath)) {
      let hasNetworkCall = false;
      let networkSnippet = '';

      if (isFetchCall(cleanContent)) {
        hasNetworkCall = true;
        networkSnippet = 'fetch() call';
      } else if (/\b(axios|superagent|XMLHttpRequest|WebSocket)\b/.test(cleanContent)) {
        hasNetworkCall = true;
        networkSnippet = 'network library call';
      } else if (/\brequire\s*\(\s*['"`](node:)?(http|https|net|dgram)['"`]\s*\)/.test(cleanContent)) {
        hasNetworkCall = true;
        networkSnippet = 'Node network module require';
      } else if (/\bimport\s+.*?\s+from\s+['"`](node:)?(http|https|net|dgram)['"`]/.test(cleanContent)) {
        hasNetworkCall = true;
        networkSnippet = 'Node network module import';
      } else if (/\brequests\.(get|post|put|delete|patch)\b/.test(cleanContent)) {
        hasNetworkCall = true;
        networkSnippet = 'Python requests call';
      }

      if (hasNetworkCall) {
        const msg = `Live external network call detected in test/scratch scope: ${normalizedRelPath} (${networkSnippet})`;
        checks.prohibitedLiveNetworkCalls.passed = false;
        checks.prohibitedLiveNetworkCalls.violations.push(msg);
        concerns.push(`Zero Side-Effects Red Line: ${msg}`);
      }
    }
  }

  // Deduplicate concerns
  const uniqueConcerns = Array.from(new Set(concerns));
  const passed = uniqueConcerns.length === 0;

  return {
    passed,
    criticType: 'deterministic_workspace_critic',
    evaluatedAt,
    scope: {
      targetDir: resolvedDir,
      scope,
      filesExamined,
      linesScanned
    },
    checks,
    concerns: uniqueConcerns
  };
}

class DeterministicWorkspaceCritic {
  constructor(options = {}) {
    this.options = options;
  }

  evaluate(targetDir = process.cwd(), options = {}) {
    return evaluateDeterministicWorkspaceCritic(targetDir, { ...this.options, ...options });
  }
}

module.exports = {
  DeterministicWorkspaceCritic,
  evaluateDeterministicWorkspaceCritic,
  isPublicCertificate,
  isTestOrScratchScope,
  stripCommentsPreservingLines,
  isFlutterWorkspace,
  isFlutterBuildArtifact,
  SECRET_PATTERNS,
  BLOCKED_FILE_PATTERNS,
  LAZY_CODE_PATTERNS
};
