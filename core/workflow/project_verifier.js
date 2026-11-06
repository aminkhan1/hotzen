/**
 * 🌐 Universal Agent Core Hub - Project Workspace Verifier
 * Verifies non-benchmark workspace projects using their native toolchains
 * (e.g. flutter analyze & flutter test for Flutter projects).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { safeResolveWorkspacePath } = require('./project_artifact_extractor');

function inspectWorkspaceGitMetadata(targetDir) {
  let current;
  try {
    current = fs.realpathSync(path.resolve(targetDir));
    if (!fs.statSync(current).isDirectory()) return { status: 'unknown' };
  } catch {
    return { status: 'unknown' };
  }

  while (true) {
    try {
      fs.lstatSync(path.join(current, '.git'));
      return { status: 'present' };
    } catch (error) {
      if (!error || error.code !== 'ENOENT') return { status: 'unknown' };
    }

    const parent = path.dirname(current);
    if (parent === current) return { status: 'absent' };
    current = parent;
  }
}

/**
 * Verifies a project workspace using stack-specific verification commands.
 *
 * @param {string} taskId Task identifier
 * @param {string} targetDir Workspace directory
 * @param {object} [options]
 * @param {Function} [options.execRunner] Mock runner for testing
 * @param {string} [options.stack] Explicit stack override (e.g. 'flutter')
 * @param {number} [options.timeoutMs=60000] Timeout per command in ms
 * @param {boolean} [options.hasTests] Whether test directory is expected
 * @returns {{
 *   testsPassed: number,
 *   testsTotal: number,
 *   functionalTests: { passed: number, total: number, failures: string[] },
 *   edgeCaseTests: { passed: number, total: number, failures: string[] },
 *   securityTests: { passed: number, total: number, violations: string[] },
 *   fatalViolation: string|null,
 *   isInfrastructureError: boolean,
 *   isClean: boolean,
 *   failures: string[],
 *   checks: Array<{ name: string, status: string, cmd: string, error?: string }>,
 *   stack: string
 * }}
 */
function verifyProjectWorkspace(taskId, targetDir, options = {}) {
  const resolvedDir = path.resolve(targetDir);
  const timeoutMs = options.timeoutMs || 60000;
  const computedDeliveryEvidence = evaluateProjectArtifactDelivery(resolvedDir, options);
  const suppliedDeliveryEvidence = options.artifactDeliveryEvidence;
  const deliveryEvidence = suppliedDeliveryEvidence
    ? {
        ...computedDeliveryEvidence,
        passed: computedDeliveryEvidence.passed && suppliedDeliveryEvidence.passed === true,
        failures: Array.from(new Set([
          ...computedDeliveryEvidence.failures,
          ...(Array.isArray(suppliedDeliveryEvidence.failures) ? suppliedDeliveryEvidence.failures : [])
        ]))
      }
    : computedDeliveryEvidence;
  const hasDeliveryCheck = deliveryEvidence.required;

  // Resolve stack
  let stack = options.stack;
  if (!stack) {
    try {
      const { detectStack } = require('../../cli');
      stack = detectStack(resolvedDir).stack;
    } catch {
      stack = 'unknown';
    }
  }

  // Define commands for stack
  let checksToRun = [];
  let reportedChecks = [];
  let hasReportedChecks = false;
  if (options.verificationContract) {
    if (inspectWorkspaceGitMetadata(resolvedDir).status === 'unknown') {
      reportedChecks = [{ name: 'Workspace Git metadata', status: 'FAILED',
        isInfrastructureError: true, error: 'Unable to determine safely whether the workspace has Git metadata.' }];
    } else {
      const { runVerify } = require('../../cli');
      const verifyRes = runVerify(resolvedDir, {
        verificationContract: options.verificationContract,
        expectedFiles: options.expectedFiles || [],
        execRunner: options.execRunner,
        timeoutMs
      });
      reportedChecks = verifyRes.checks;
    }
    hasReportedChecks = true;
  } else {
  for (const rel of Array.isArray(options.expectedFiles) ? options.expectedFiles : []) {
    const ext = path.extname(rel).toLowerCase();
    const fullPath = safeResolveWorkspacePath(resolvedDir, rel);
    if (!fullPath) continue;
    if (['.js', '.cjs', '.mjs'].includes(ext)) {
      checksToRun.push({ name: `Syntax: ${rel}`, cmd: `node --check ${JSON.stringify(fullPath)}`, executable: 'node', args: ['--check', fullPath] });
    } else if (ext === '.py') {
      const parser = 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), filename=sys.argv[1])';
      checksToRun.push({ name: `Syntax: ${rel}`, cmd: `python3 -c ${JSON.stringify(parser)} ${JSON.stringify(fullPath)}`, executable: 'python3', args: ['-c', parser, fullPath] });
    }
  }
  if (stack === 'flutter') {
    checksToRun.push({ name: 'Analyze', cmd: 'flutter analyze' });
    const testDir = path.join(resolvedDir, 'test');
    if (fs.existsSync(testDir) || options.hasTests !== false) {
      checksToRun.push({ name: 'Tests', cmd: 'flutter test' });
    }
  } else if (stack === 'dart-backend') {
    checksToRun.push({ name: 'Analyze', cmd: 'dart analyze' });
    const testDir = path.join(resolvedDir, 'test');
    if (fs.existsSync(testDir) || options.hasTests !== false) {
      checksToRun.push({ name: 'Tests', cmd: 'dart test' });
    }
  } else {
    // Fall back to CLI runVerify if available
    try {
      const { runVerify } = require('../../cli');
      const gitMetadata = inspectWorkspaceGitMetadata(resolvedDir);
      if (gitMetadata.status === 'unknown') {
        reportedChecks = [{
          name: 'Workspace Git metadata',
          status: 'FAILED',
          cmd: 'inspect workspace metadata',
          isInfrastructureError: true,
          error: 'Unable to determine safely whether the workspace has Git metadata.'
        }];
        hasReportedChecks = true;
      } else {
        const verifyOptions = gitMetadata.status === 'absent'
          ? { ...options, scope: 'full' }
          : options;
        const verifyRes = runVerify(resolvedDir, verifyOptions);
        if (verifyRes && Array.isArray(verifyRes.checks) && verifyRes.checks.length > 0) {
          reportedChecks = verifyRes.checks;
          hasReportedChecks = true;
        }
      }
    } catch {}
  }

  }

  if (checksToRun.length === 0 && !hasReportedChecks) {
    const deliveryFailures = hasDeliveryCheck && !deliveryEvidence.passed ? deliveryEvidence.failures : [];
    const checks = [{ name: 'Default Verification', status: 'SKIPPED', cmd: 'none', message: 'No executable verifier is configured' }];
    if (hasDeliveryCheck) {
      checks.push({
        name: 'Planned Artifact Delivery',
        status: deliveryEvidence.passed ? 'PASSED' : 'FAILED',
        cmd: 'workspace artifacts',
        ...(deliveryFailures.length ? { error: deliveryFailures.join('; ') } : {})
      });
    }
    const failures = ['No executable verifier is configured', ...deliveryFailures];
    return {
      testsPassed: hasDeliveryCheck && deliveryEvidence.passed ? 1 : 0,
      testsTotal: 1 + (hasDeliveryCheck ? 1 : 0),
      functionalTests: {
        passed: hasDeliveryCheck && deliveryEvidence.passed ? 1 : 0,
        total: 1 + (hasDeliveryCheck ? 1 : 0),
        failures
      },
      edgeCaseTests: { passed: 0, total: 0, failures: [] },
      securityTests: { passed: 0, total: 0, violations: [] },
      fatalViolation: 'VERIFIER_INFRASTRUCTURE_FAILURE: No executable verifier is configured',
      isInfrastructureError: true,
      isClean: false,
      failures,
      checks,
      stack,
      deliveryEvidence
    };
  }

  const checks = [];
  const failures = [];
  let passedCount = 0;
  let isInfraError = false;
  let fatalViolation = null;

  for (const check of reportedChecks) {
    checks.push(check);
    if (check.status === 'PASSED') {
      passedCount++;
    } else if (check.status === 'SKIPPED') {
      isInfraError = true;
      fatalViolation = fatalViolation || `VERIFIER_INFRASTRUCTURE_FAILURE: ${check.message || `${check.name} was skipped`}`;
      failures.push(fatalViolation);
    } else if (check.status === 'FAILED') {
      const error = check.error || `${check.name} check failed`;
      failures.push(`${check.name} failed: ${error}`);
      if (check.isInfrastructureError) {
        isInfraError = true;
        fatalViolation = fatalViolation || `VERIFIER_INFRASTRUCTURE_FAILURE: ${error}`;
      }
    } else {
      isInfraError = true;
      fatalViolation = fatalViolation || `VERIFIER_INFRASTRUCTURE_FAILURE: Unknown verifier status for ${check.name}`;
      failures.push(fatalViolation);
    }
  }

  for (const step of checksToRun) {
    if (typeof options.execRunner === 'function') {
      try {
        const res = options.execRunner(step.cmd, { cwd: resolvedDir, name: step.name });
        if (res && res.isInfrastructureError) {
          isInfraError = true;
          fatalViolation = res.error || `Infrastructure failure executing ${step.cmd}`;
          checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: fatalViolation });
          failures.push(fatalViolation);
          break;
        } else if (res && (res.status === 0 || res.ok === true || res.code === 0)) {
          passedCount++;
          checks.push({ name: step.name, status: 'PASSED', cmd: step.cmd });
        } else {
          const err = (res && (res.stderr || res.error || res.message)) || `${step.name} check failed`;
          failures.push(`${step.name} failed: ${err}`);
          checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: err });
        }
      } catch (err) {
        isInfraError = true;
        fatalViolation = err.message;
        failures.push(`${step.name} crash: ${err.message}`);
        checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: err.message });
        break;
      }
    } else {
      try {
        const parts = step.cmd.split(/\s+/);
        const bin = step.executable || parts[0];
        const args = step.args || parts.slice(1);
        const res = childProcess.spawnSync(bin, args, {
          cwd: resolvedDir,
          encoding: 'utf8',
          timeout: timeoutMs,
          stdio: 'pipe',
          env: {
            ...process.env,
            PATH: process.env.PATH || ''
          }
        });

        if (res.error) {
          isInfraError = true;
          if (res.error.code === 'ENOENT') {
            fatalViolation = `Executable '${bin}' not found in PATH`;
          } else {
            fatalViolation = res.error.message;
          }
          failures.push(`${step.name} infrastructure error: ${fatalViolation}`);
          checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: fatalViolation });
          break;
        } else if (res.status === 0) {
          passedCount++;
          checks.push({ name: step.name, status: 'PASSED', cmd: step.cmd });
        } else {
          const errMsg = (res.stderr && res.stderr.trim()) || (res.stdout && res.stdout.trim()) || `Exit code ${res.status}`;
          failures.push(`${step.name} failed: ${errMsg}`);
          checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: errMsg });
        }
      } catch (err) {
        isInfraError = true;
        fatalViolation = `Crash executing ${step.cmd}: ${err.message}`;
        failures.push(fatalViolation);
        checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: err.message });
        break;
      }
    }
  }

  if (hasDeliveryCheck) {
    checks.push({
      name: 'Planned Artifact Delivery',
      status: deliveryEvidence.passed ? 'PASSED' : 'FAILED',
      cmd: 'workspace artifacts',
      ...(deliveryEvidence.failures.length ? { error: deliveryEvidence.failures.join('; ') } : {})
    });
    if (!deliveryEvidence.passed) failures.push(...deliveryEvidence.failures);
  }
  const testsTotal = checksToRun.length + reportedChecks.length + (hasDeliveryCheck ? 1 : 0);
  const testsPassed = passedCount + (hasDeliveryCheck && deliveryEvidence.passed ? 1 : 0);
  const isClean = !isInfraError && !fatalViolation && failures.length === 0 && testsPassed === testsTotal;

  return {
    testsPassed,
    testsTotal,
    functionalTests: {
      passed: testsPassed,
      total: testsTotal,
      failures
    },
    edgeCaseTests: { passed: 0, total: 0, failures: [] },
    securityTests: { passed: 0, total: 0, violations: [] },
    fatalViolation,
    isInfrastructureError: isInfraError,
    isClean,
    failures,
    checks,
    stack,
    deliveryEvidence
  };
}

function evaluateProjectArtifactDelivery(targetDir, options = {}) {
  const expectedFiles = Array.isArray(options.expectedFiles) ? options.expectedFiles : [];
  if (expectedFiles.length === 0) {
    return { required: false, passed: true, expectedFiles: [], deliveredFiles: [], failures: [] };
  }

  const artifactResult = options.artifactResult;
  const failures = [];
  const normalizedExpected = [];
  for (const rel of expectedFiles) {
    const fullPath = safeResolveWorkspacePath(targetDir, rel);
    if (!fullPath) {
      failures.push(`Invalid or out-of-workspace planned file: ${rel}`);
      continue;
    }
    const normalized = path.relative(path.resolve(targetDir), fullPath).split(path.sep).join('/');
    if (!normalizedExpected.includes(normalized)) normalizedExpected.push(normalized);
  }

  const reportedFiles = new Set();
  if (artifactResult && Array.isArray(artifactResult.allTargetFiles)) {
    for (const rel of artifactResult.allTargetFiles) {
      const fullPath = safeResolveWorkspacePath(targetDir, rel);
      if (fullPath) reportedFiles.add(path.relative(path.resolve(targetDir), fullPath).split(path.sep).join('/'));
    }
  }
  if (!artifactResult || artifactResult.success !== true) {
    failures.push('Artifact extractor did not confirm successful planned-file delivery');
  }

  const deliveredFiles = [];
  for (const rel of normalizedExpected) {
    const fullPath = safeResolveWorkspacePath(targetDir, rel);
    let validFile = false;
    try {
      const stat = fs.statSync(fullPath);
      validFile = stat.isFile() && stat.size > 0;
    } catch {}
    if (reportedFiles.has(rel) && validFile) deliveredFiles.push(rel);
    else failures.push(`Required planned artifact is missing or not delivered: ${rel}`);
  }

  return {
    required: true,
    passed: failures.length === 0 && deliveredFiles.length === normalizedExpected.length,
    expectedFiles: normalizedExpected,
    deliveredFiles,
    failures: Array.from(new Set(failures))
  };
}

module.exports = {
  verifyProjectWorkspace,
  evaluateProjectArtifactDelivery
};
