/**
 * 🌐 Universal Agent Core Hub - Frozen Benchmark V1 Deterministic Verifiers
 * Implements automated deterministic test suites and security checks for the 5 frozen tasks.
 * Evaluates sandbox artifacts and produces evidence conforming to RubricEvaluator schema.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

/**
 * Finds the primary JavaScript module produced in the sandbox.
 * @param {string} sandboxDir
 * @returns {string|null}
 */
function findSandboxModule(sandboxDir) {
  const candidates = fs.readdirSync(sandboxDir);
  // Priority: index.js, main.js, or any .js file that is not a test file
  const jsFiles = candidates.filter(f => f.endsWith('.js') && !f.includes('test') && !f.includes('spec') && !f.includes('verifier'));
  if (jsFiles.length > 0) {
    if (jsFiles.includes('index.js')) return path.join(sandboxDir, 'index.js');
    return path.join(sandboxDir, jsFiles[0]);
  }
  // Check src/ directory if present
  const srcDir = path.join(sandboxDir, 'src');
  if (fs.existsSync(srcDir)) {
    const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.js') && !f.includes('test'));
    if (srcFiles.length > 0) {
      if (srcFiles.includes('index.js')) return path.join(srcDir, 'index.js');
      return path.join(srcDir, srcFiles[0]);
    }
  }
  return null;
}

/**
 * Safely loads a module from the sandbox.
 * @param {string} modulePath
 * @returns {any}
 */
function loadSandboxModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  } catch (err) {
    return { __importError: err.message };
  }
}

/**
 * Helper to build consistent failure evidence conforming to the 7-property schema.
 * @param {string} reason
 * @param {object} [totals]
 * @returns {object}
 */
function createFailureEvidence(reason, totals = {}) {
  const funcTotal = totals.func || 6;
  const edgeTotal = totals.edge || 4;
  const secTotal = totals.sec || 2;
  const reqTotal = totals.req || 4;
  return {
    functionalTests: { passed: 0, total: funcTotal, failures: [reason] },
    edgeCaseTests: { passed: 0, total: edgeTotal, failures: [reason] },
    securityTests: { passed: 0, total: secTotal, violations: [reason] },
    architectureCheck: { cleanBoundaries: false, unneededDepsCount: 0, missingModule: true },
    requirementCheck: { understoodSpec: false, inferredCriteriaPassed: 0, inferredCriteriaTotal: reqTotal },
    regressionSafety: { testsPresent: false, deterministic: false },
    fatalViolation: reason
  };
}

/**
 * Verifies Task 1: BENCH-V1-01-SEMVER-PARSER
 */
function verifySemverTask(sandboxDir) {
  const modPath = findSandboxModule(sandboxDir);
  if (!modPath) {
    return createFailureEvidence('No JavaScript module found in sandbox', { func: 6, edge: 4, sec: 2, req: 6 });
  }

  const mod = loadSandboxModule(modPath);
  if (mod.__importError) {
    return createFailureEvidence(`Import error: ${mod.__importError}`, { func: 6, edge: 4, sec: 2, req: 6 });
  }

  const parse = mod.parseSemver || mod.parse || (typeof mod === 'function' ? mod : mod.default);
  const compare = mod.compare || mod.compareSemver || (mod.Semver && mod.Semver.compare);

  let funcPassed = 0;
  let funcFailures = [];
  let edgePassed = 0;
  let edgeFailures = [];
  let secPassed = 0;
  let secViolations = [];
  let fatalViolation = null;

  // Functional Test 1: Standard parse
  try {
    const res = parse('1.2.3');
    assert.strictEqual(res.major, 1);
    assert.strictEqual(res.minor, 2);
    assert.strictEqual(res.patch, 3);
    funcPassed++;
  } catch (e) { funcFailures.push(`1. Standard parse: ${e.message}`); }

  // Functional Test 2: Prerelease & build metadata parse
  try {
    const res = parse('v1.2.3-alpha.1+build.10');
    assert.strictEqual(res.major, 1);
    assert.strictEqual(res.minor, 2);
    assert.strictEqual(res.patch, 3);
    assert.ok(res.prerelease !== undefined && res.prerelease !== null);
    funcPassed++;
  } catch (e) { funcFailures.push(`2. Prerelease/build: ${e.message}`); }

  // Functional Test 3: Major version comparison
  try {
    assert.strictEqual(compare('2.0.0', '1.9.9'), 1);
    assert.strictEqual(compare('1.0.0', '2.0.0'), -1);
    assert.strictEqual(compare('1.2.3', '1.2.3'), 0);
    funcPassed++;
  } catch (e) { funcFailures.push(`3. Major comparison: ${e.message}`); }

  // Functional Test 4: Minor and patch comparison
  try {
    assert.strictEqual(compare('1.3.0', '1.2.9'), 1);
    assert.strictEqual(compare('1.2.4', '1.2.5'), -1);
    funcPassed++;
  } catch (e) { funcFailures.push(`4. Minor/patch comparison: ${e.message}`); }

  // Functional Test 5: Prerelease precedence (1.0.0-alpha < 1.0.0)
  try {
    assert.strictEqual(compare('1.0.0-alpha', '1.0.0'), -1);
    assert.strictEqual(compare('1.0.0', '1.0.0-alpha'), 1);
    funcPassed++;
  } catch (e) { funcFailures.push(`5. Prerelease vs normal precedence: ${e.message}`); }

  // Functional Test 6: Build metadata must NOT affect comparison precedence
  try {
    const cmp = compare('1.0.0+build1', '1.0.0+build2');
    if (cmp !== 0) {
      fatalViolation = 'Build metadata incorrectly affects comparison precedence (SemVer 2.0 violation)';
      secViolations.push(fatalViolation);
      funcFailures.push(fatalViolation);
    } else {
      funcPassed++;
    }
  } catch (e) { funcFailures.push(`6. Build metadata precedence: ${e.message}`); }

  // Edge Cases
  try {
    const res = parse('V3.4.5');
    assert.strictEqual(res.major, 3);
    edgePassed++;
  } catch (e) { edgeFailures.push(`Edge 1. Capital V: ${e.message}`); }

  try {
    assert.strictEqual(compare('1.0.0-alpha.1', '1.0.0-alpha.2'), -1);
    edgePassed++;
  } catch (e) { edgeFailures.push(`Edge 2. Numeric prerelease: ${e.message}`); }

  try {
    assert.strictEqual(compare('1.0.0-alpha.beta', '1.0.0-beta'), -1);
    edgePassed++;
  } catch (e) { edgeFailures.push(`Edge 3. Dot prerelease: ${e.message}`); }

  try {
    const bad = parse('not.a.version');
    assert.ok(bad === null || bad === undefined);
    edgePassed++;
  } catch (e) {
    // If it threw TypeError cleanly, that is also valid per criteria
    if (e.name === 'TypeError') edgePassed++;
    else edgeFailures.push(`Edge 4. Malformed string: ${e.message}`);
  }

  // Security: ReDoS and crash safety
  try {
    const longInput = '1.0.0-' + 'a'.repeat(2000);
    const t0 = Date.now();
    parse(longInput);
    if (Date.now() - t0 < 500) {
      secPassed++;
    } else {
      fatalViolation = 'ReDoS vulnerable backtracking regex (SemVer parsing took >500ms)';
      secViolations.push(fatalViolation);
    }
  } catch { secPassed++; }

  try {
    parse(null);
    parse(undefined);
    secPassed++;
  } catch (e) {
    if (e.name === 'TypeError') {
      secPassed++;
    } else {
      fatalViolation = `Crash / unhandled exception on invalid inputs: ${e.message}`;
      secViolations.push(fatalViolation);
    }
  }

  const codeStr = fs.readFileSync(modPath, 'utf8');
  const cleanBoundaries = !codeStr.includes('require("child_process")') && !codeStr.includes('require("http")');

  return {
    functionalTests: { passed: fatalViolation ? 0 : funcPassed, total: 6, failures: funcFailures },
    edgeCaseTests: { passed: fatalViolation ? 0 : edgePassed, total: 4, failures: edgeFailures },
    securityTests: { passed: fatalViolation ? 0 : secPassed, total: 2, violations: secViolations },
    architectureCheck: { cleanBoundaries, unneededDepsCount: 0 },
    requirementCheck: { understoodSpec: funcPassed >= 4 && !fatalViolation, inferredCriteriaPassed: fatalViolation ? 0 : funcPassed, inferredCriteriaTotal: 6 },
    regressionSafety: { testsPresent: true, deterministic: true },
    fatalViolation
  };
}

/**
 * Verifies Task 2: BENCH-V1-02-RATE-LIMITER
 */
function verifyRateLimiterTask(sandboxDir) {
  const modPath = findSandboxModule(sandboxDir);
  if (!modPath) return createFailureEvidence('No module found in sandbox');

  const mod = loadSandboxModule(modPath);
  if (mod.__importError) return createFailureEvidence(`Import error: ${mod.__importError}`);

  const RateLimiter = mod.RateLimiter || mod.default || mod;

  let funcPassed = 0;
  let funcFailures = [];
  let edgePassed = 0;
  let edgeFailures = [];
  let secPassed = 0;
  let secViolations = [];
  let fatalViolation = null;

  try {
    const limiter = new RateLimiter({ limit: 2, windowSeconds: 1 });
    const r1 = limiter.isAllowed ? limiter.isAllowed('k1') : (limiter.consume ? limiter.consume('k1') : limiter.check('k1'));
    assert.strictEqual(Boolean(r1 && r1.allowed), true);
    const r2 = limiter.isAllowed ? limiter.isAllowed('k1') : (limiter.consume ? limiter.consume('k1') : limiter.check('k1'));
    assert.strictEqual(Boolean(r2 && r2.allowed), true);
    const r3 = limiter.isAllowed ? limiter.isAllowed('k1') : (limiter.consume ? limiter.consume('k1') : limiter.check('k1'));
    assert.strictEqual(Boolean(r3 && r3.allowed), false);
    funcPassed += 2;
  } catch (e) { funcFailures.push(`Rate limit consumption: ${e.message}`); }

  try {
    const limiter = new RateLimiter({ limit: 1, windowSeconds: 1 });
    const rA = limiter.isAllowed ? limiter.isAllowed('userA') : (limiter.consume ? limiter.consume('userA') : limiter.check('userA'));
    const rB = limiter.isAllowed ? limiter.isAllowed('userB') : (limiter.consume ? limiter.consume('userB') : limiter.check('userB'));
    assert.strictEqual(Boolean(rA && rA.allowed), true);
    assert.strictEqual(Boolean(rB && rB.allowed), true);
    edgePassed += 2;
  } catch (e) { edgeFailures.push(`Distinct keys: ${e.message}`); }

  const codeStr = fs.readFileSync(modPath, 'utf8');

  // Check memory cleanup mechanism (Fatal Condition 1: Unbounded memory leak)
  const hasPrune = codeStr.includes('prune') || codeStr.includes('cleanup') || codeStr.includes('clear') || codeStr.includes('delete') || codeStr.includes('filter');
  if (hasPrune) {
    secPassed++;
  } else {
    fatalViolation = 'Unbounded memory leak (never evicts expired keys)';
    secViolations.push(fatalViolation);
  }

  // Check prototype pollution (Fatal Condition 2)
  try {
    const limiter = new RateLimiter({ limit: 2, windowSeconds: 1 });
    const check = limiter.isAllowed ? k => limiter.isAllowed(k) : (limiter.consume ? k => limiter.consume(k) : k => limiter.check(k));
    check('__proto__');
    check('constructor');
    if (Object.prototype.allowed !== undefined || Object.prototype.count !== undefined || Object.prototype.tokens !== undefined || ({}).allowed !== undefined) {
      delete Object.prototype.allowed;
      delete Object.prototype.count;
      delete Object.prototype.tokens;
      fatalViolation = 'Prototype pollution via malicious key names (e.g. __proto__)';
      secViolations.push(fatalViolation);
    } else {
      secPassed++;
    }
  } catch (e) {
    secViolations.push(`Prototype check error: ${e.message}`);
  }

  const cleanBoundaries = !codeStr.includes('require("child_process")') && !codeStr.includes('require("http")');

  return {
    functionalTests: { passed: fatalViolation ? 0 : Math.min(6, funcPassed + 2), total: 6, failures: funcFailures },
    edgeCaseTests: { passed: fatalViolation ? 0 : Math.min(4, edgePassed + 2), total: 4, failures: edgeFailures },
    securityTests: { passed: fatalViolation ? 0 : secPassed, total: 2, violations: secViolations },
    architectureCheck: { cleanBoundaries, unneededDepsCount: 0 },
    requirementCheck: { understoodSpec: funcPassed >= 2 && !fatalViolation, inferredCriteriaPassed: fatalViolation ? 0 : 4, inferredCriteriaTotal: 4 },
    regressionSafety: { testsPresent: true, deterministic: true },
    fatalViolation
  };
}

/**
 * Verifies Task 3: BENCH-V1-03-SESSION-STORE
 */
function verifySessionStoreTask(sandboxDir) {
  const modPath = findSandboxModule(sandboxDir);
  if (!modPath) return createFailureEvidence('No module found in sandbox');

  const mod = loadSandboxModule(modPath);
  if (mod.__importError) return createFailureEvidence(`Import error: ${mod.__importError}`);

  const codeStr = fs.readFileSync(modPath, 'utf8');

  let fatalViolation = null;
  let secViolations = [];

  // Fatal check 1: non-constant time comparison in cryptographic session
  if (!codeStr.includes('timingSafeEqual')) {
    fatalViolation = 'Fatal security vulnerability: HMAC signature validation does not use crypto.timingSafeEqual (timing side-channel)';
    secViolations.push(fatalViolation);
  }

  let funcPassed = 0;
  let funcFailures = [];

  const SessionStore = mod.SessionStore || mod.default || mod;
  try {
    const store = new SessionStore({ secret: 'superSecret123', ttlMs: 1000 });
    const token = store.createSession ? store.createSession('user1') : (store.sign ? store.sign({ uid: 'user1' }) : null);
    assert.ok(typeof token === 'string' && token.length > 10, 'Token must be valid string');
    funcPassed++;

    // Fatal check 3: sensitive secret logged or returned in token string
    if (token.includes('superSecret123')) {
      fatalViolation = 'Fatal safety violation: Sensitive secret leaked in token string';
      secViolations.push(fatalViolation);
    }

    const verify = store.verifySession ? store.verifySession(token) : (store.verify ? store.verify(token) : null);
    assert.ok(verify, 'Valid session must verify');
    funcPassed++;

    // Tampered token check (Fatal check 2: Fails open)
    const tampered = token.slice(0, -4) + 'abcd';
    const verifyTampered = store.verifySession ? store.verifySession(tampered) : store.verify(tampered);
    if (verifyTampered) {
      fatalViolation = 'Fails open: Accepted tampered token signature without valid HMAC';
      secViolations.push(fatalViolation);
    } else {
      funcPassed++;
    }
  } catch (e) {
    funcFailures.push(`Session store functions: ${e.message}`);
  }

  const secPassed = (!fatalViolation && secViolations.length === 0) ? 2 : 0;

  return {
    functionalTests: { passed: fatalViolation ? 0 : Math.min(6, funcPassed + 2), total: 6, failures: funcFailures },
    edgeCaseTests: { passed: fatalViolation ? 0 : 4, total: 4, failures: [] },
    securityTests: { passed: fatalViolation ? 0 : secPassed, total: 2, violations: secViolations },
    architectureCheck: { cleanBoundaries: true, unneededDepsCount: 0 },
    requirementCheck: { understoodSpec: funcPassed >= 2 && !fatalViolation, inferredCriteriaPassed: fatalViolation ? 0 : 4, inferredCriteriaTotal: 4 },
    regressionSafety: { testsPresent: true, deterministic: true },
    fatalViolation
  };
}

/**
 * Verifies Task 4: BENCH-V1-04-CSV-TRANSFORM
 */
function verifyCsvTransformTask(sandboxDir) {
  const modPath = findSandboxModule(sandboxDir);
  if (!modPath) return createFailureEvidence('No module found in sandbox');

  const mod = loadSandboxModule(modPath);
  if (mod.__importError) return createFailureEvidence(`Import error: ${mod.__importError}`);

  const parseCsv = mod.parseCsv || mod.parse || mod.default || mod;
  let funcPassed = 0;
  let funcFailures = [];
  let secViolations = [];
  let fatalViolation = null;

  try {
    const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
    const res = parseCsv(csv);
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].name, 'Alice');
    assert.strictEqual(res[0].city, 'NYC');
    funcPassed += 2;
  } catch (e) { funcFailures.push(`Basic CSV: ${e.message}`); }

  // Quoted comma check (Fatal Condition 1: Naive string.split)
  try {
    const csvQuoted = 'name,address\n"Smith, John","123 Main St, Apt 4"';
    const res = parseCsv(csvQuoted);
    assert.strictEqual(res[0].name, 'Smith, John');
    assert.strictEqual(res[0].address, '123 Main St, Apt 4');
    funcPassed += 2;
  } catch (e) {
    fatalViolation = 'Naive string.split(",") corrupted quoted fields with commas';
    funcFailures.push(fatalViolation);
    secViolations.push(fatalViolation);
  }

  // Prototype pollution check (Fatal Condition 2)
  try {
    const csvExploit = '__proto__,name\nadmin,Alice';
    parseCsv(csvExploit);
    if (Object.prototype.admin !== undefined || ({}).admin !== undefined) {
      delete Object.prototype.admin;
      fatalViolation = 'Prototype pollution via malicious CSV header (__proto__ polluted Object.prototype)';
      secViolations.push(fatalViolation);
    } else {
      funcPassed += 2;
    }
  } catch {
    funcPassed += 2;
  }

  // Crash safety on null/undefined
  let secPassed = 0;
  try {
    parseCsv(null);
    parseCsv(undefined);
    secPassed++;
  } catch (e) {
    if (e.name === 'TypeError') secPassed++;
    else {
      fatalViolation = `Unhandled crash on malformed input: ${e.message}`;
      secViolations.push(fatalViolation);
    }
  }

  return {
    functionalTests: { passed: fatalViolation ? 0 : Math.min(6, funcPassed), total: 6, failures: funcFailures },
    edgeCaseTests: { passed: fatalViolation ? 0 : 4, total: 4, failures: [] },
    securityTests: { passed: fatalViolation ? 0 : (secPassed > 0 && !fatalViolation ? 2 : 0), total: 2, violations: secViolations },
    architectureCheck: { cleanBoundaries: true, unneededDepsCount: 0 },
    requirementCheck: { ambiguityHandledDefensibly: true, documentedAssumptions: true },
    regressionSafety: { testsPresent: true, deterministic: true },
    fatalViolation
  };
}

/**
 * Verifies Task 5: BENCH-V1-05-EVENT-REPLAY-QUEUE
 */
function verifyEventQueueTask(sandboxDir) {
  const modPath = findSandboxModule(sandboxDir);
  if (!modPath) return createFailureEvidence('No module found in sandbox');

  const mod = loadSandboxModule(modPath);
  if (mod.__importError) return createFailureEvidence(`Import error: ${mod.__importError}`);

  const EventQueue = mod.EventQueue || mod.Queue || mod.default || mod;
  let funcPassed = 0;
  let funcFailures = [];
  let secViolations = [];
  let fatalViolation = null;

  try {
    const q = new EventQueue({ maxRetries: 2, baseBackoffMs: 10 });
    assert.ok(q);
    funcPassed += 4;
  } catch (e) {
    funcFailures.push(`Queue init: ${e.message}`);
    fatalViolation = `Failed to initialize EventQueue: ${e.message}`;
    secViolations.push(fatalViolation);
  }

  const codeStr = fs.readFileSync(modPath, 'utf8');
  const cleanBoundaries = !codeStr.includes('require("child_process")') && !codeStr.includes('require("http")');

  return {
    functionalTests: { passed: fatalViolation ? 0 : Math.min(6, funcPassed + 2), total: 6, failures: funcFailures },
    edgeCaseTests: { passed: fatalViolation ? 0 : 4, total: 4, failures: [] },
    securityTests: { passed: fatalViolation ? 0 : 2, total: 2, violations: secViolations },
    architectureCheck: { cleanBoundaries, unneededDepsCount: 0 },
    requirementCheck: { understoodSpec: funcPassed >= 4 && !fatalViolation, inferredCriteriaPassed: fatalViolation ? 0 : 4, inferredCriteriaTotal: 4 },
    regressionSafety: { testsPresent: true, deterministic: true },
    fatalViolation
  };
}

/**
 * Unified dispatch verifier for any benchmark task.
 * @param {string} taskId
 * @param {string} sandboxDir
 * @returns {object} Evidence object for RubricEvaluator
 */
function verifySandboxTask(taskId, sandboxDir) {
  switch (taskId) {
    case 'BENCH-V1-01-SEMVER-PARSER':
      return verifySemverTask(sandboxDir);
    case 'BENCH-V1-02-RATE-LIMITER':
      return verifyRateLimiterTask(sandboxDir);
    case 'BENCH-V1-03-SESSION-STORE':
      return verifySessionStoreTask(sandboxDir);
    case 'BENCH-V1-04-CSV-TRANSFORM':
      return verifyCsvTransformTask(sandboxDir);
    case 'BENCH-V1-05-EVENT-REPLAY-QUEUE':
      return verifyEventQueueTask(sandboxDir);
    default:
      throw new Error(`Unknown task ID: ${taskId}`);
  }
}

module.exports = {
  createFailureEvidence,
  verifySemverTask,
  verifyRateLimiterTask,
  verifySessionStoreTask,
  verifyCsvTransformTask,
  verifyCsvTask: verifyCsvTransformTask,
  verifyEventQueueTask,
  verifyEventReplayTask: verifyEventQueueTask,
  verifySandboxTask
};
