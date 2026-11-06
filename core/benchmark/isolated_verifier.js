/**
 * 🌐 Universal Agent Core Hub - Isolated Sandbox Verifier Wrapper
 * Runs verifySandboxTask in an isolated child node process with hard timeouts,
 * sanitized environment, and fail-closed result guarantees.
 *
 * Note: This provides process-level execution isolation, NOT OS-level sandboxing (e.g. Docker/seccomp).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Creates a normalized fail-closed 7-property evidence object.
 *
 * @param {string} reason
 * @param {string} [fatalViolation]
 * @returns {object}
 */
function createFailClosedEvidence(reason, fatalViolation = null) {
  const fatal = fatalViolation || reason;
  return {
    functionalTests: { passed: 0, total: 6, failures: [reason] },
    edgeCaseTests: { passed: 0, total: 4, failures: [reason] },
    securityTests: { passed: 0, total: 2, violations: [fatal] },
    architectureCheck: { cleanBoundaries: false, unneededDepsCount: 0, missingModule: true },
    requirementCheck: { understoodSpec: false, inferredCriteriaPassed: 0, inferredCriteriaTotal: 6 },
    regressionSafety: { testsPresent: false, deterministic: false },
    fatalViolation: fatal,
    securityViolations: [fatal],
    executionValid: false
  };
}

/**
 * Runs verifySandboxTask in a separate child node process.
 *
 * @param {string} taskId
 * @param {string} sandboxDir
 * @param {object} [options]
 * @param {number} [options.timeoutMs=20000]
 * @returns {object} VerificationEvidence
 */
function verifySandboxTaskIsolated(taskId, sandboxDir, options = {}) {
  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  const resolvedSandbox = path.resolve(sandboxDir);
  const parentDir = path.dirname(resolvedSandbox);

  // Snapshot parent directory to detect escape writes outside sandbox
  let parentEntriesBefore = new Set();
  try {
    if (fs.existsSync(parentDir)) {
      parentEntriesBefore = new Set(fs.readdirSync(parentDir));
    }
  } catch {}

  const verifierScriptPath = path.resolve(__dirname, 'task_verifiers.js');

  // Minimal sanitized environment (no secrets, no provider API keys)
  const sanitizedEnv = {
    PATH: process.env.PATH || '',
    HOME: resolvedSandbox,
    TMPDIR: resolvedSandbox,
    NODE_ENV: 'test',
    NODE_PATH: process.env.NODE_PATH || ''
  };

  const runnerScript = `
    'use strict';
    try {
      const { verifySandboxTask } = require(${JSON.stringify(verifierScriptPath)});
      const result = verifySandboxTask(${JSON.stringify(taskId)}, ${JSON.stringify(resolvedSandbox)});
      process.stdout.write(JSON.stringify(result));
    } catch (err) {
      process.stderr.write(err.message || 'Verifier error');
      process.exit(1);
    }
  `;

  const spawnArgs = [];
  // Enable Node.js permission model if supported to restrict filesystem writes strictly to sandbox
  if (process.permission) {
    spawnArgs.push(
      '--permission',
      '--allow-fs-read=*',
      `--allow-fs-write=${resolvedSandbox}/*`,
      `--allow-fs-write=/private${resolvedSandbox}/*`
    );
  }
  spawnArgs.push('-e', runnerScript);

  let res;
  try {
    res = childProcess.spawnSync(process.execPath, spawnArgs, {
      cwd: resolvedSandbox,
      env: sanitizedEnv,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (spawnErr) {
    return createFailClosedEvidence(
      `Failed to spawn isolated verifier process: ${spawnErr.message}`,
      'SPAWN_FAILURE'
    );
  }

  // Check if artifact created files outside sandbox in parent directory
  try {
    if (fs.existsSync(parentDir)) {
      const parentEntriesAfter = fs.readdirSync(parentDir);
      for (const entry of parentEntriesAfter) {
        if (!parentEntriesBefore.has(entry) && entry !== path.basename(resolvedSandbox)) {
          // Escaped file detected! Clean it up and fail closed
          try {
            fs.rmSync(path.join(parentDir, entry), { recursive: true, force: true });
          } catch {}
          return createFailClosedEvidence(
            `Security violation: Artifact created unauthorized file outside sandbox (${entry})`,
            'FILESYSTEM_ESCAPE_VIOLATION'
          );
        }
      }
    }
  } catch {}

  // 1. Timeout detection (process was killed by timeout)
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return createFailClosedEvidence(
      `Verifier execution timed out (exceeded ${timeoutMs}ms limit)`,
      'EXECUTION_TIMEOUT'
    );
  }

  // 2. Nonzero exit or premature exit by artifact
  if (res.status !== 0) {
    const errMsg = (res.stderr && res.stderr.trim()) || `Exit code ${res.status}`;
    const isPermissionEscape = errMsg.includes('ERR_ACCESS_DENIED') && (errMsg.includes('FileSystemWrite') || errMsg.includes('FileSystemRead'));
    const fatalViolation = isPermissionEscape ? 'FILESYSTEM_ESCAPE_VIOLATION' : 'PREMATURE_PROCESS_EXIT';
    return createFailClosedEvidence(
      `Verifier process exited abnormally (${errMsg})`,
      fatalViolation
    );
  }

  // 3. Premature exit without output (e.g. process.exit(0) by artifact)
  if (!res.stdout || !res.stdout.trim()) {
    return createFailClosedEvidence(
      'Verifier process exited prematurely without producing evidence (process.exit)',
      'PREMATURE_PROCESS_EXIT'
    );
  }

  // 4. Parse output
  try {
    const parsed = JSON.parse(res.stdout.trim());
    if (parsed.executionValid === undefined) {
      parsed.executionValid = !parsed.fatalViolation;
    }
    return parsed;
  } catch (parseErr) {
    return createFailClosedEvidence(
      `Verifier output was unparsable: ${parseErr.message}`,
      'CORRUPTED_VERIFIER_OUTPUT'
    );
  }
}

module.exports = {
  verifySandboxTaskIsolated,
  createFailClosedEvidence,
  DEFAULT_TIMEOUT_MS
};
