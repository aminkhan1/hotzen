/**
 * 🌐 Universal Agent Core Hub - Core Multi-Stage Workflow Engine
 * Phase 2 Implementation: Real Multi-Stage Orchestration & Adaptive Routing Integration
 *
 * Responsibilities:
 * 1. Orchestrates the full, authentic Core multi-stage pipeline:
 *    PLANNING (Senior Planner)
 *       ↓
 *    PLAN_VALIDATION (HybridCoreBrain + ModelAllocator + Handoff Generation)
 *       ↓
 *    IMPLEMENTING (Coder with Shared Delivery Envelope)
 *       ↓
 *    TESTING (Tester / Verification Engine)
 *       ↓
 *    REVIEW (Senior Critic Gate / KISS Audit)
 *       ↓
 *    RECOVERY (Diagnostic Recovery Loop when defects are detected)
 *       ↓
 *    DONE (Quality Scoring & Comprehensive Telemetry Aggregation)
 *
 * 2. Symmetry & Preservation:
 *    - Mode B (CORE_FIXED_STRONG): Full Core workflow enforced on provider strong models.
 *    - Mode C (CORE_ADAPTIVE): Identical Core workflow with dynamic per-role model allocation.
 *    - Symmetric Artifact Delivery: Explicitly targets index.js in the sandbox.
 *    - Structured Task-Scoped Handoffs: Strict < 5 KB budget; zero raw exploration/session history.
 *    - Evidence-Based Memory: Zero ungrounded auto-injection; strict unknown-to-null telemetry.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Release gate. Re-enable in source only when managed continuation is supported.
const MANAGED_CHECKPOINT_EXECUTION_ENABLED = false;
function assertManagedCheckpointPolicyAvailable(policy) {
  if (policy === undefined || MANAGED_CHECKPOINT_EXECUTION_ENABLED) return;
  const error = new Error('Managed checkpoint execution is disabled in this release.');
  error.code = 'MANAGED_CHECKPOINT_POLICY_DISABLED';
  throw error;
}
const { BENCHMARK_MODES } = require('../benchmark/contracts');
const { formatDeliveryPrompt } = require('../benchmark/delivery_envelope');
const { extractAndWriteArtifact, extractCode, checkSyntax } = require('../benchmark/artifact_extractor');
const {
  captureProjectFileState,
  safeResolveWorkspacePath,
  extractAndApplyProjectArtifacts
} = require('./project_artifact_extractor');
const { verifySandboxTask } = require('../benchmark/task_verifiers');
const { verifySandboxTaskIsolated } = require('../benchmark/isolated_verifier');
const {
  evaluateProjectArtifactDelivery,
  verifyProjectWorkspace
} = require('./project_verifier');
const { RubricEvaluator } = require('../benchmark/rubric_evaluator');
const { HybridCoreBrain } = require('../allocation/hybrid_core_brain');
const { ModelAllocator } = require('../allocation/model_allocator');
const { resolveRoleRequirement } = require('../allocation/deterministic_fallback_brain');
const { isTrustworthyProfile, TRUSTED_PROVENANCE_SOURCES, TIER_SCORES } = require('../allocation/model_allocator');
const { ExecutionHistoryStore, resolveHistoryDbPath } = require('../allocation');
const { ClaudeCodeAdapter } = require('../allocation/adapters/claude_code_adapter');
const { CodexAdapter } = require('../allocation/adapters/codex_adapter');
const { isModelSwitchingEnabled } = require('../allocation/model_switching_toggle');
const { resolveProviderId, assertAdapterProvider } = require('../allocation/execution_handoff');
const { buildAgentExecutionPlan, renderUserPlan, renderAgentExecutionPlan } = require('./plan_display');
const { performSemanticCriticReview, decideSemanticLeaderOutcome, decideSemanticRecovery } = require('./verification_with_critic');
const { STRONG_MODEL_MAP } = require('../benchmark/harness');
const {
  FAILURE_IDENTIFIERS,
  CONTEXT_HEALTH,
  CONTEXT_MEASUREMENT,
  evaluateModelAvailability,
  resolveQuotaFallback,
  evaluateContextHealth,
  checkFreshSessionRolloverSupport
} = require('../allocation/reliability_guards');
const { getProjectLanguages } = require('../languages');
const { resolveModelTier } = require('./plan_display');
const {
  CORE_FAILURE_CODES,
  FAILURE_STAGES,
  FAILURE_DECISIONS,
  normalizeFailureDecision,
  buildFailureContract,
  sanitizeProviderDiagnostic,
  formatFailurePrompt,
  promptFailureDecision
} = require('./failure_ux');
const { resolvePlanFilesToModify } = require('./file_target_resolver');
const { inferTrivialTaskClassification } = require('./task_classification_fallback');

function resolveExecutablePathForDiagnostics(command, env = process.env, cwd = process.cwd()) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const executable = command.trim();
  const candidates = [];
  if (path.isAbsolute(executable) || executable.includes(path.sep) || (path.sep === '\\' && executable.includes('/'))) {
    candidates.push(path.isAbsolute(executable) ? executable : path.resolve(cwd, executable));
  } else {
    const pathEntries = typeof env.PATH === 'string' ? env.PATH.split(path.delimiter) : [];
    const extensions = process.platform === 'win32'
      ? ['', ...(String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';'))]
      : [''];
    for (const entry of pathEntries) {
      if (!entry) continue;
      for (const extension of extensions) candidates.push(path.join(entry, `${executable}${extension}`));
    }
  }

  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {}
  }
  return null;
}

function validateDiagnosticModelAttestation({ provider, modelId, role = 'coder', riskTier, catalog, profiles = {}, usage = {} } = {}) {
  const fail = (reason) => ({ valid: false, reason, modelTier: null, requiredTier: null });
  if (provider !== 'codex' || !catalog || catalog.providerId !== 'codex') return fail('unsupported_provider');
  if (typeof modelId !== 'string' || !modelId.trim()) return fail('model_unresolved');
  if (usage.ordinaryUsageAllowed === false || (usage.exhaustedModels || []).includes(modelId)) return fail('provider_quota_unavailable');

  const model = Array.isArray(catalog.models) ? catalog.models.find((entry) => entry && entry.id === modelId) : null;
  if (!model || model.discoverable !== true || model.access !== 'included' || model.available !== true || model.quotaExhausted === true) {
    return fail('model_availability_unverified_or_unsupported');
  }

  const profile = profiles[modelId] || Object.entries(profiles).find(([name]) => name.toLowerCase() === modelId.toLowerCase())?.[1];
  if (!isTrustworthyProfile(profile) || !TRUSTED_PROVENANCE_SOURCES.includes(profile.source)) return fail('model_capability_untrusted');
  const risk = ['low', 'medium', 'high'].includes(String(riskTier || '').toLowerCase())
    ? String(riskTier).toLowerCase()
    : 'high';
  const requirement = resolveRoleRequirement(role, risk);
  const requiredTier = requirement && requirement.capability;
  const modelScore = TIER_SCORES[profile.capabilityTier] || 0;
  const requiredScore = TIER_SCORES[requiredTier] || 0;
  if (!requiredScore || modelScore < requiredScore) return { ...fail('model_below_safety_floor'), modelTier: profile.capabilityTier, requiredTier };
  return { valid: true, reason: null, modelTier: profile.capabilityTier, requiredTier };
}

function evaluateDiagnosticModelCompliance({ requestedModel, actualModel, provider, role = 'coder', riskTier, catalog, profiles = {}, usage = {} } = {}) {
  if (typeof actualModel !== 'string' || !actualModel.trim()) {
    return { status: 'UNVERIFIED', failure: null };
  }
  const reportedModel = actualModel.trim();
  if (reportedModel !== requestedModel) {
    return { status: 'FAILED', failure: `reported model '${reportedModel}' does not match approved model '${requestedModel}'` };
  }
  const validation = validateDiagnosticModelAttestation({ provider, modelId: reportedModel, role, riskTier, catalog, profiles, usage });
  return validation.valid
    ? { status: 'VERIFIED', failure: null }
    : { status: 'FAILED', failure: validation.reason };
}

function diagnosticAuthorizationMarkerPath(binding) {
  const key = require('crypto').createHash('sha256')
    .update(`${binding.taskId}\0${binding.workspace}`, 'utf8').digest('hex');
  return path.join(binding.workspace, '.agents', 'memory', `.core-diagnostic-${key}.consumed`);
}

function consumeDiagnosticAuthorization(binding) {
  if (!binding || binding.ownerConfirmed !== true || !binding.ownerConfirmedAt ||
      !binding.taskId || !binding.workspace || !/^[a-f0-9]{64}$/.test(binding.receiptDigest || '') ||
      !/^[a-f0-9]{64}$/.test(binding.snapshotDigest || '')) {
    const error = new Error('Diagnostic authorization binding is incomplete or has no owner confirmation.');
    error.code = 'DIAGNOSTIC_AUTHORIZATION_INVALID';
    throw error;
  }
  const { normalizeWorkspacePath } = require('./plan_receipt');
  if (normalizeWorkspacePath(binding.workspace) !== binding.workspace) {
    const error = new Error('Diagnostic authorization Workspace is not canonical.');
    error.code = 'DIAGNOSTIC_AUTHORIZATION_INVALID';
    throw error;
  }
  const workspace = binding.workspace;
  const agentsDir = path.join(workspace, '.agents');
  const memoryDir = path.join(agentsDir, 'memory');
  try {
    for (const directory of [agentsDir, memoryDir]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
        throw new Error('Core memory directory is not a canonical, non-symlink directory.');
      }
    }
  } catch (cause) {
    const error = new Error(`Diagnostic authorization storage is unavailable: ${cause.message}`);
    error.code = 'DIAGNOSTIC_AUTHORIZATION_STORAGE_UNAVAILABLE';
    throw error;
  }

  const markerPath = diagnosticAuthorizationMarkerPath(binding);
  let fd;
  try {
    fd = fs.openSync(markerPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({
      taskId: binding.taskId,
      workspace,
      receiptDigest: binding.receiptDigest,
      snapshotDigest: binding.snapshotDigest,
      ownerConfirmedAt: binding.ownerConfirmedAt,
      consumed: true,
      consumedAt: new Date().toISOString()
    }));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    const directoryFd = fs.openSync(memoryDir, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (cause) {
    if (fd !== undefined && fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (cause && cause.code === 'EEXIST') {
      const error = new Error('This Task ID and Workspace already consumed its diagnostic authorization.');
      error.code = 'DIAGNOSTIC_AUTHORIZATION_CONSUMED';
      throw error;
    }
    const error = new Error(`Could not atomically consume diagnostic authorization: ${cause.message}`);
    error.code = 'DIAGNOSTIC_AUTHORIZATION_STORAGE_UNAVAILABLE';
    throw error;
  }
  return Object.freeze({ ...binding, markerPath, consumed: true });
}

/**
 * Task state machine state constants conforming to .agents/rules/agent_state_machine.md
 * and Universal Agent Core Hub V1 Mandatory Approval Protocol
 */
const WORKFLOW_STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  PLANNING: 'PLANNING',
  PLAN_VALIDATION: 'PLAN_VALIDATION',
  PLANNED: 'PLANNED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXECUTING: 'EXECUTING',
  IMPLEMENTING: 'IMPLEMENTING',
  TESTING: 'TESTING',
  REVIEW: 'REVIEW',
  FAILED: 'FAILED',
  DIAGNOSING: 'DIAGNOSING',
  FIXING: 'FIXING',
  DONE: 'DONE'
});

/**
 * Pre-execution user plan approval decisions
 */
const APPROVAL_DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL'
});

// Only the Engine's post-approval Coder dispatch can supply this in-process token.
// It cannot be asserted by task text or supplied by an external buildCoderPrompt caller.
const ENGINE_MANAGED_CODER_CONTEXT = Symbol('engine-managed-coder-context');

/**
 * Normalizes user/caller approval decision string or boolean.
 *
 * @param {any} decision
 * @returns {'APPROVE' | 'REJECT' | 'CANCEL' | null}
 */
function normalizeApprovalDecision(decision) {
  if (decision === true) return APPROVAL_DECISIONS.APPROVE;
  if (decision === false) return APPROVAL_DECISIONS.REJECT;
  if (!decision || typeof decision !== 'string') return null;
  const d = decision.trim().toUpperCase();
  if (d === 'APPROVE' || d === 'APPROVED' || d === 'Y' || d === 'YES') return APPROVAL_DECISIONS.APPROVE;
  if (d === 'REJECT' || d === 'REJECTED' || d === 'N' || d === 'NO') return APPROVAL_DECISIONS.REJECT;
  if (d === 'CANCEL' || d === 'CANCELLED' || d === 'C') return APPROVAL_DECISIONS.CANCEL;
  return null;
}

/**
 * Default maximum allowed recovery attempts per task state machine.
 */
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Default role execution timeout in milliseconds (90 seconds).
 * Decoupled from lightweight adapter discovery timeout (10 seconds).
 */
const DEFAULT_ROLE_EXECUTION_TIMEOUT_MS = 90000;

/**
 * Extracts structured plan JSON from Planner output.
 * Handles markdown fenced json or raw json.
 *
 * @param {string} text Raw planner text output
 * @returns {object} Extracted structured plan
 */
function parsePlannerOutput(text, options = {}) {
  if (!text || typeof text !== 'string') {
    const fallbackText = typeof options.taskPrompt === 'string' ? options.taskPrompt : '';
    const resolvedFiles = resolvePlanFilesToModify(null, options);
    const fallback = inferTrivialTaskClassification(fallbackText, { ...options, filesToModify: resolvedFiles });
    return {
      goal: 'Default Implementation Plan',
      changeType: fallback ? fallback.changeType : 2,
      riskTier: fallback ? fallback.riskTier : 'medium',
      affectedLayers: fallback ? fallback.affectedLayers : ['application'],
      acceptanceCriteria: ['Functional correctness'],
      filesToModify: resolvedFiles
    };
  }

  // 1. Try to find ```json ... ``` block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed === 'object') {
        return normalizeParsedPlan(parsed, options);
      }
    } catch {}
  }

  // 2. Try parsing entire text as JSON
  try {
    const directParsed = JSON.parse(text.trim());
    if (directParsed && typeof directParsed === 'object') {
      return normalizeParsedPlan(directParsed, options);
    }
  } catch {}

  // 3. Fallback extraction from structured lines (e.g. Risk tier: low, etc.)
  const riskTierMatch = text.match(/risk(?:[_\s]tier)?:\s*(['"]?)(low|medium|high)\1/i);
  const changeTypeMatch = text.match(/change(?:[_\s]type)?:\s*([1-5])/i);
  const goalMatch = text.match(/goal:\s*([^;\n\r]+)/i);

  const resolvedFiles = resolvePlanFilesToModify(text, options);

  const explicitRiskTier = riskTierMatch ? riskTierMatch[2].toLowerCase() : null;
  const explicitChangeType = changeTypeMatch ? parseInt(changeTypeMatch[1], 10) : null;

  // Explicit structured non-trivial classification prevents fallback downgrading
  const hasExplicitNonTrivial = (explicitRiskTier && explicitRiskTier !== 'low') ||
                                (explicitChangeType && explicitChangeType > 1);

  let fallback = null;
  if (!hasExplicitNonTrivial && (explicitRiskTier === null || explicitChangeType === null)) {
    const textContext = [
      text,
      (typeof options.taskPrompt === 'string' && options.taskPrompt !== text) ? options.taskPrompt : ''
    ].filter(Boolean).join(' ');

    fallback = inferTrivialTaskClassification(textContext, { ...options, filesToModify: resolvedFiles });
  }

  return {
    goal: goalMatch ? goalMatch[1].trim() : 'Implementation Plan',
    changeType: explicitChangeType !== null
      ? explicitChangeType
      : (fallback ? fallback.changeType : 2),
    riskTier: explicitRiskTier !== null
      ? explicitRiskTier
      : (fallback ? fallback.riskTier : 'medium'),
    affectedLayers: fallback && !hasExplicitNonTrivial ? fallback.affectedLayers : ['application'],
    acceptanceCriteria: ['Implementation satisfies requirements', 'Zero errors in verification'],
    filesToModify: resolvedFiles
  };
}

/**
 * Normalizes extracted plan fields into contract-compliant metadata.
 *
 * @param {object} raw
 * @param {object} [options]
 * @returns {object}
 */
function normalizeParsedPlan(raw, options = {}) {
  const resolvedFiles = resolvePlanFilesToModify(raw, options);

  const rawChangeType = raw.changeType !== undefined ? raw.changeType : raw.change_type;
  const explicitChangeType = (typeof rawChangeType === 'number' && Number.isInteger(rawChangeType))
    ? rawChangeType
    : (typeof rawChangeType === 'string' && /^[1-5]$/.test(rawChangeType.trim())
      ? parseInt(rawChangeType.trim(), 10)
      : null);

  const rawRiskTier = typeof raw.riskTier === 'string' ? raw.riskTier : (typeof raw.risk_tier === 'string' ? raw.risk_tier : null);
  const explicitRiskTier = (rawRiskTier && ['low', 'medium', 'high'].includes(rawRiskTier.toLowerCase().trim()))
    ? rawRiskTier.toLowerCase().trim()
    : null;

  const hasExplicitNonTrivial = (explicitRiskTier && explicitRiskTier !== 'low') ||
                                (explicitChangeType && explicitChangeType > 1) ||
                                Boolean(raw.securitySensitive) ||
                                Boolean(raw.affectsCriticalPath);

  let fallback = null;
  if (!hasExplicitNonTrivial && (explicitChangeType === null || explicitRiskTier === null)) {
    const textContext = [
      typeof raw.goal === 'string' ? raw.goal : '',
      typeof raw.description === 'string' ? raw.description : '',
      typeof options.taskPrompt === 'string' ? options.taskPrompt : ''
    ].filter(Boolean).join(' ');

    const targetFiles = (Array.isArray(raw.filesToModify) && raw.filesToModify.length > 0)
      ? raw.filesToModify
      : ((options && Array.isArray(options.filesToModify) && options.filesToModify.length > 0)
        ? options.filesToModify
        : resolvedFiles);

    fallback = inferTrivialTaskClassification(textContext, { ...options, filesToModify: targetFiles });
  }

  const finalChangeType = explicitChangeType !== null
    ? explicitChangeType
    : (fallback ? fallback.changeType : 2);

  const finalRiskTier = explicitRiskTier !== null
    ? explicitRiskTier
    : (fallback ? fallback.riskTier : 'medium');

  const finalAffectedLayers = Array.isArray(raw.affectedLayers) && raw.affectedLayers.length > 0
    ? raw.affectedLayers
    : (fallback && !hasExplicitNonTrivial ? fallback.affectedLayers : ['application']);

  return {
    goal: typeof raw.goal === 'string' ? raw.goal : 'Execute Implementation Plan',
    changeType: finalChangeType,
    riskTier: finalRiskTier,
    affectedLayers: finalAffectedLayers,
    acceptanceCriteria: Array.isArray(raw.acceptanceCriteria) && raw.acceptanceCriteria.length > 0 ? raw.acceptanceCriteria : ['Verify functionality'],
    ...(Array.isArray(raw.reportingRequirements) && raw.reportingRequirements.length > 0
      ? { reportingRequirements: [...raw.reportingRequirements] } : {}),
    filesToModify: resolvedFiles,
    securitySensitive: Boolean(raw.securitySensitive),
    affectsCriticalPath: Boolean(raw.affectsCriticalPath),
    blastRadius: typeof raw.blastRadius === 'string' ? raw.blastRadius : 'isolated',
    rollbackComplexity: typeof raw.rollbackComplexity === 'string' ? raw.rollbackComplexity : 'low'
  };
}

/**
 * Deterministically checks whether a planner LLM response is malformed.
 * A planner output is malformed if it lacks valid JSON or recognizable structured plan fields.
 *
 * @param {string} textResult
 * @returns {boolean}
 */
function isMalformedPlannerOutput(textResult) {
  if (!textResult || typeof textResult !== 'string' || !textResult.trim()) {
    return true;
  }
  const trimmed = textResult.trim();

  // 1. If text has ```json code fence, verify that it contains valid JSON
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed === 'object') {
        const hasCoreField = Boolean(parsed.goal || parsed.filesToModify || parsed.changeType !== undefined || parsed.riskTier);
        return !hasCoreField;
      }
      return true;
    } catch {
      return true; // JSON fence present but invalid JSON syntax -> malformed
    }
  }

  // 2. If text starts and ends with braces, check direct JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const hasCoreField = Boolean(parsed.goal || parsed.filesToModify || parsed.changeType !== undefined || parsed.riskTier);
        return !hasCoreField;
      }
      return true;
    } catch {
      return true; // Direct JSON braces but invalid JSON syntax -> malformed
    }
  }

  // 3. Structured key-value lines
  const hasStructuredFields = /goal:\s*[^;\n\r]+/i.test(trimmed) &&
    (/risk(?:[_\s]tier)?:\s*(['"]?)(low|medium|high)\1/i.test(trimmed) ||
     /change(?:[_\s]type)?:\s*[1-5]/i.test(trimmed));

  if (!hasStructuredFields) {
    return true;
  }

  return false;
}

/**
 * Normalizes raw verification evidence from verifiers into a consistent
 * test outcome structure covering functional tests, security checks, and fatal violations.
 *
 * @param {object} raw
 * @returns {{
 *   testsPassed: number,
 *   testsTotal: number,
 *   functionalPassed: number,
 *   functionalTotal: number,
 *   securityViolations: string[],
 *   fatalViolation: string|null,
 *   isClean: boolean,
 *   failures: string[]
 * }}
 */
function normalizeVerificationEvidence(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      testsPassed: 0,
      testsTotal: 1,
      functionalPassed: 0,
      functionalTotal: 1,
      securityViolations: ['Missing verification evidence'],
      fatalViolation: 'Missing verification evidence',
      isClean: false,
      failures: ['Missing verification evidence']
    };
  }

  const hasFunctionalObj = raw.functionalTests && typeof raw.functionalTests === 'object';
  const hasTestsTotal = typeof raw.testsTotal === 'number';

  const securityViolations = Array.isArray(raw.securityTests && raw.securityTests.violations)
    ? [...raw.securityTests.violations]
    : (Array.isArray(raw.securityViolations) ? [...raw.securityViolations] : []);
  const isInfrastructureError = Boolean(raw.isInfrastructureError || raw.failureType === 'infrastructure_error');
  const skippedChecks = Array.isArray(raw.checks)
    ? raw.checks.filter((check) => check && check.status === 'SKIPPED').map((check) => ({
      name: check.name || 'Verification check',
      message: check.message || 'Verifier was skipped'
    }))
    : [];

  const fatalViolation = raw.fatalViolation
    || (securityViolations.length > 0 ? `Security violation: ${securityViolations.join('; ')}` : null);

  if (!hasFunctionalObj && !hasTestsTotal) {
    const defaultReason = fatalViolation
      || (securityViolations.length > 0 ? securityViolations[0] : 'Malformed verification evidence: No tests reported');
    const violations = securityViolations.length > 0
      ? securityViolations
      : [defaultReason];
    const failures = [
      ...(Array.isArray(raw.failures) ? raw.failures : []),
      ...violations
    ];
    return {
      testsPassed: 0,
      testsTotal: 1,
      functionalPassed: 0,
      functionalTotal: 1,
      securityViolations: violations,
      fatalViolation: defaultReason,
      isInfrastructureError,
      skippedChecks,
      isClean: false,
      failures: Array.from(new Set(failures))
    };
  }

  const functionalPassed = hasFunctionalObj && typeof raw.functionalTests.passed === 'number'
    ? raw.functionalTests.passed
    : (typeof raw.testsPassed === 'number' ? raw.testsPassed : 0);

  const functionalTotal = hasFunctionalObj && typeof raw.functionalTests.total === 'number'
    ? raw.functionalTests.total
    : (typeof raw.testsTotal === 'number' ? raw.testsTotal : (functionalPassed > 0 ? functionalPassed : 0));

  const failures = [
    ...(hasFunctionalObj && Array.isArray(raw.functionalTests.failures) ? raw.functionalTests.failures : []),
    ...(raw.edgeCaseTests && Array.isArray(raw.edgeCaseTests.failures) ? raw.edgeCaseTests.failures : []),
    ...(Array.isArray(raw.failures) ? raw.failures : []),
    ...securityViolations
  ];
  if (fatalViolation && !failures.includes(fatalViolation)) {
    failures.push(fatalViolation);
  }

  const isClean = functionalTotal > 0
    && (functionalPassed >= functionalTotal)
    && !fatalViolation
    && securityViolations.length === 0;

  return {
    testsPassed: functionalPassed,
    testsTotal: functionalTotal,
    functionalPassed,
    functionalTotal,
    securityViolations,
    fatalViolation,
    isInfrastructureError,
    skippedChecks,
    isClean,
    failures
  };
}

function mergeArtifactDeliveryEvidence(raw, deliveryEvidence) {
  if (!deliveryEvidence || !deliveryEvidence.required) return raw;
  const result = raw && typeof raw === 'object' ? { ...raw } : {};
  const reported = result.deliveryEvidence;
  const failures = Array.isArray(deliveryEvidence.failures) ? [...deliveryEvidence.failures] : [];

  if (reported && reported.passed === deliveryEvidence.passed) {
    result.deliveryEvidence = deliveryEvidence;
    return result;
  }

  if (reported) failures.push('Verifier artifact delivery evidence did not match the Engine workspace check');
  const deliveryPassed = deliveryEvidence.passed && (!reported || reported.passed === true);

  const existingFailures = Array.isArray(result.failures) ? result.failures : [];
  result.failures = Array.from(new Set([...existingFailures, ...failures]));
  if (result.functionalTests && typeof result.functionalTests === 'object') {
    const functional = result.functionalTests;
    result.functionalTests = {
      ...functional,
      passed: Math.max(0, (Number(functional.passed) || 0) + (deliveryPassed ? 1 : 0) - (reported && reported.passed ? 1 : 0)),
      total: Math.max(0, (Number(functional.total) || 0) + (reported ? 0 : 1)),
      failures: Array.from(new Set([
        ...(Array.isArray(functional.failures) ? functional.failures : []),
        ...failures
      ]))
    };
    result.testsPassed = result.functionalTests.passed;
    result.testsTotal = result.functionalTests.total;
  } else {
    result.testsPassed = Math.max(0, (Number(result.testsPassed) || 0) + (deliveryPassed ? 1 : 0) - (reported && reported.passed ? 1 : 0));
    result.testsTotal = Math.max(0, (Number(result.testsTotal) || 0) + (reported ? 0 : 1));
  }
  result.deliveryEvidence = deliveryEvidence;
  result.isClean = result.isClean === true && deliveryPassed;
  return result;
}

function normalizeDeliveryCaptureDiagnostics(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const allowedSources = new Set(['output_last_message', 'output_last_message_read_error', 'stdout_fallback']);
  return {
    processCompleted: raw.processCompleted === true,
    exitCode: Number.isInteger(raw.exitCode) ? raw.exitCode : null,
    timedOut: raw.timedOut === true,
    outputLastMessagePresent: raw.outputLastMessagePresent === true,
    captureSource: allowedSources.has(raw.captureSource) ? raw.captureSource : 'unknown',
    captureReadError: raw.captureReadError === true,
    capturedTextLength: Number.isSafeInteger(raw.capturedTextLength) && raw.capturedTextLength >= 0 ? raw.capturedTextLength : 0,
    capturedTextEmpty: raw.capturedTextEmpty === true
  };
}

function buildArtifactDeliveryDiagnostic({ taskId, attemptType, attemptIndex, coderResult, forwardedResultField, textResult, artifactResult }) {
  const sourcePaths = artifactResult && artifactResult.deliveryDiagnostics;
  const paths = (values) => Array.isArray(values)
    ? [...new Set(values.filter((value) => typeof value === 'string').map((value) => value.replace(/\\/g, '/').slice(0, 120)))].slice(0, 8)
    : [];
  return {
    taskId: typeof taskId === 'string' ? taskId.slice(0, 120) : null,
    attemptType: attemptType === 'recovery' ? 'recovery' : 'initial',
    attemptIndex: Number.isSafeInteger(attemptIndex) && attemptIndex >= 0 ? attemptIndex : 0,
    executionAttemptId: null,
    coderResultReceived: Boolean(coderResult && typeof coderResult === 'object'),
    adapterCaptureDiagnostics: normalizeDeliveryCaptureDiagnostics(coderResult && coderResult.adapterCaptureDiagnostics),
    forwardedResultField,
    forwardedTextSource: typeof (coderResult && coderResult.textResultSource) === 'string'
      ? coderResult.textResultSource.slice(0, 32)
      : 'unknown',
    forwardedTextLength: typeof textResult === 'string' ? textResult.length : 0,
    deliveryAttempted: Boolean(artifactResult),
    artifacts: {
      expectedArtifactCount: Number.isSafeInteger(sourcePaths && sourcePaths.expectedArtifactCount) ? sourcePaths.expectedArtifactCount : 0,
      recognizedArtifactPathCount: Number.isSafeInteger(sourcePaths && sourcePaths.recognizedArtifactPathCount) ? sourcePaths.recognizedArtifactPathCount : 0,
      approvedRelativePathsRecognized: paths(sourcePaths && sourcePaths.approvedRelativePathsRecognized),
      missingExpectedPaths: paths(sourcePaths && sourcePaths.missingExpectedPaths),
      directWritePathsObserved: paths(sourcePaths && sourcePaths.directWritePathsObserved),
      parseOutcome: typeof (sourcePaths && sourcePaths.parseOutcome) === 'string' ? sourcePaths.parseOutcome.slice(0, 40) : 'unknown',
      deliveryOutcome: typeof (sourcePaths && sourcePaths.deliveryOutcome) === 'string' ? sourcePaths.deliveryOutcome.slice(0, 48) : 'unknown',
      rollbackApplied: Boolean(sourcePaths && sourcePaths.rollbackApplied),
      rollbackReason: typeof (sourcePaths && sourcePaths.rollbackReason) === 'string' ? sourcePaths.rollbackReason.slice(0, 48) : null
    }
  };
}

function encodeArtifactDeliveryDiagnostic(diagnostic) {
  const bounded = JSON.parse(JSON.stringify(diagnostic));
  const pathGroups = [
    bounded.artifacts.approvedRelativePathsRecognized,
    bounded.artifacts.missingExpectedPaths,
    bounded.artifacts.directWritePathsObserved
  ];
  let json = JSON.stringify(bounded);
  while (json.length > 2400 && pathGroups.some((group) => group.length > 0)) {
    const largest = pathGroups.reduce((current, group) => group.length > current.length ? group : current, pathGroups[0]);
    largest.pop();
    json = JSON.stringify(bounded);
  }
  return json;
}

// A state claim is provable only when every approved source path can be read
// (or is known to be absent) both before Coder execution and after failure.
function captureProvableSourceState(baseDir, files) {
  if (typeof baseDir !== 'string' || !baseDir || !Array.isArray(files) || files.length === 0) return null;
  const state = new Map();
  for (const rel of files) {
    const fullPath = safeResolveWorkspacePath(baseDir, rel);
    if (!fullPath) return null;
    try {
      if (!fs.lstatSync(fullPath).isFile()) return null;
      state.set(rel, fs.readFileSync(fullPath));
    } catch (error) {
      if (error.code !== 'ENOENT') return null;
      state.set(rel, null);
    }
  }
  return state;
}

class CoreWorkflowEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.provider='claude_code'] Active provider identifier
   * @param {object} [options.adapter] ProviderAdapter override
   * @param {object} [options.coreBrain] HybridCoreBrain override
   * @param {object} [options.allocator] ModelAllocator override
   * @param {number} [options.maxRecoveryAttempts=3] Maximum recovery attempts
   * @param {Function} [options.verifierFn] Verifier dispatch override
   */
  constructor(options = {}) {
    this.cwd = options.cwd || options.workspace || options.workspaceRoot || null;
    this.workspace = this.cwd;
    this.provider = resolveProviderId([
      options.provider,
      options.adapter && options.adapter.providerId
    ]);
    assertAdapterProvider(this.provider, options.adapter);
    this.adapter = options.adapter || (this.provider ? this._getDefaultAdapter(this.provider) : null);
    this.coreBrain = options.coreBrain || new HybridCoreBrain();
    this.historyStore = options.historyStore !== undefined
      ? options.historyStore
      : new ExecutionHistoryStore({
          ...options,
          dbPath: resolveHistoryDbPath(options)
        });
    this.allocator = options.allocator || new ModelAllocator({ historyStore: this.historyStore });
    this.maxRecoveryAttempts = (typeof options.maxRecoveryAttempts === 'number' && options.maxRecoveryAttempts >= 0)
      ? options.maxRecoveryAttempts
      : DEFAULT_MAX_RECOVERY_ATTEMPTS;
    this.maxProviderCalls = (typeof options.maxProviderCalls === 'number' && Number.isSafeInteger(options.maxProviderCalls) && options.maxProviderCalls >= 0)
      ? options.maxProviderCalls
      : null;
    this.verifierFn = options.verifierFn || verifySandboxTaskIsolated;
    this.criticFn = options.criticFn || this.evaluateSeniorCriticGate.bind(this);
    this.modelSwitchingEnabled = options.modelSwitchingEnabled !== undefined ? options.modelSwitchingEnabled : null;
  }

  /**
   * Sets runtime model switching for this engine instance.
   * @param {boolean} enabled
   */
  setModelSwitchingEnabled(enabled) {
    if (Boolean(enabled)) {
      this.modelSwitchingEnabled = false;
      if (this.allocator && typeof this.allocator.setModelSwitchingEnabled === 'function') {
        this.allocator.setModelSwitchingEnabled(false);
      }
      return { enabled: false, status: 'OFF', code: 'FEATURE_DISABLED', featureDisabled: true };
    }
    this.modelSwitchingEnabled = Boolean(enabled);
    if (this.allocator && typeof this.allocator.setModelSwitchingEnabled === 'function') {
      this.allocator.setModelSwitchingEnabled(enabled);
    }
  }

  /**
   * Returns whether model switching is currently enabled.
   * @returns {boolean}
   */
  isModelSwitchingEnabled() {
    return isModelSwitchingEnabled();
  }

  _getDefaultAdapter(provider) {
    if (provider === 'claude_code') return new ClaudeCodeAdapter();
    if (provider === 'codex') return new CodexAdapter();
    throw new Error(`Unsupported provider: '${provider}'`);
  }

  getStrongModel() {
    const model = STRONG_MODEL_MAP[this.provider];
    if (!model) {
      throw new Error(`No strong model mapped for provider: '${this.provider}'`);
    }
    return model;
  }

  /**
   * Builds the real prompt sent to the Senior Planner agent.
   * Conforms to .claude/commands/plan.md and .agents/rules/agent_state_machine.md
   *
   * @param {object} task
   * @returns {string}
   */
  buildPlannerPrompt(task) {
    const taskTitle = task.title || task.id || 'Implementation Task';
    const taskSpec = typeof task.userPrompt === 'string' ? task.userPrompt : (task.prompt || '');
    return `[CORE GOVERNANCE PROTOCOL ACTIVE]
Role: Senior Planner
Task: ${taskTitle}
Specification:
${taskSpec}

Directives:
1. Break implementation into minimal testable increments (MVT).
2. Adhere to Clean Architecture, boundary isolation, and deterministic typing (sound null safety: validate input types and respect the exact contract for invalid or null/undefined inputs—whether throwing TypeError, custom errors, or returning error results per specification).
3. Preserve all contract requirements from the specification; never drop, weaken, or alter specified error handling, return types, or contract details.
4. Define concrete acceptance criteria with zero live external side-effects.
5. Output a structured JSON plan with the following schema:
\`\`\`json
{
  "goal": "Brief technical summary",
  "changeType": 1,
  "riskTier": "low" | "medium" | "high",
  "affectedLayers": ["application" | "utilities" | "data" | "presentation"],
  "acceptanceCriteria": ["criterion 1", "criterion 2"],
  "filesToModify": ["index.js"]
}
\`\`\``;
  }

  /**
   * Generates a task-scoped directed handoff payload conforming to
   * .agents/rules/agent_handoff_protocol.md (< 5 KB budget).
   *
   * @param {object} params
   * @param {object} params.task
   * @param {object} params.plan
   * @param {object} params.coderConfig
   * @returns {object}
   */
  buildHandoffPayload({ task, plan, coderConfig }) {
    const handoff = {
      task_id: task.id,
      from_agent: 'senior_planner',
      to_agent: 'coder',
      change_type: plan.changeType,
      risk_tier: plan.riskTier,
      status: 'ready_for_implementation',
      goal: plan.goal,
      requirements: [
        'Clean Architecture layer separation and boundary isolation',
        'Deterministic typing and sound null safety (validate argument types; adhere strictly to specified error handling contracts for invalid or null inputs)',
        'Zero live external side-effects'
      ],
      files_to_modify: plan.filesToModify,
      acceptance_criteria: plan.acceptanceCriteria,
      execution_config: {
        model: coderConfig.model,
        reasoning_effort: coderConfig.reasoningEffort || 'none'
      }
    };

    const serialized = JSON.stringify(handoff);
    if (Buffer.byteLength(serialized, 'utf8') > 5120) {
      throw new Error(`Handoff payload exceeded 5 KB budget: ${Buffer.byteLength(serialized, 'utf8')} bytes`);
    }

    return handoff;
  }

  /**
   * Builds the implementation prompt for the Coder agent incorporating
   * the shared delivery envelope and the directed handoff criteria.
   *
   * @param {object} params
   * @param {object} params.task
   * @param {string} params.mode
   * @param {object} params.handoff
   * @returns {string}
   */
  /**
   * Resolves target files for real project tasks from plan snapshot, handoff, or task object.
   * @param {object} params
   * @returns {string[]}
   * @private
   */
  _resolveTargetFiles({ task, handoff, approvedPlanSnapshot } = {}) {
    const rawFiles = (handoff && (handoff.files_to_modify || handoff.filesToModify))
      || (approvedPlanSnapshot && (approvedPlanSnapshot.filesToModify || approvedPlanSnapshot.files_to_modify))
      || (approvedPlanSnapshot && approvedPlanSnapshot.plan && (approvedPlanSnapshot.plan.filesToModify || approvedPlanSnapshot.plan.files_to_modify))
      || (task && (task.filesToModify || task.files_to_modify))
      || [];
    if (!Array.isArray(rawFiles)) return [];
    return rawFiles
      .map(f => (typeof f === 'string' ? f.trim().replace(/\.+$/, '') : ''))
      .filter(Boolean);
  }

  /**
   * Asserts whether a task is a benchmark run.
   * @param {object} task
   * @param {object} [options={}]
   * @returns {boolean}
   */
  isBenchmarkRun(task, options = {}) {
    const taskIdUpper = (task && task.id && typeof task.id === 'string') ? task.id.toUpperCase() : '';
    return Boolean(
      (taskIdUpper.startsWith('BENCH-') || taskIdUpper.startsWith('CAL-') || taskIdUpper.startsWith('CANARY-')) ||
      options.isBenchmark ||
      (this.options && this.options.isBenchmark)
    );
  }

  /**
   * Builds the implementation prompt for the Coder agent.
   * Separates single-file JavaScript benchmark prompts from multi-file project workspace prompts.
   *
   * @param {object} params
   * @param {object} params.task
   * @param {string} params.mode
   * @param {object} params.handoff
   * @param {object} [params.approvedPlanSnapshot]
   * @returns {string}
   */
  buildCoderPrompt({ task, mode, handoff, approvedPlanSnapshot, executionContext, structuredArtifactDelivery = false }) {
    const isBench = this.isBenchmarkRun(task);
    if (isBench) {
      const envelope = formatDeliveryPrompt(task, mode, { role: 'Coder', targetFile: 'index.js' });

      const requirementsText = Array.isArray(handoff.requirements) && handoff.requirements.length > 0
        ? `\nCore Architecture & Typing Requirements:\n${handoff.requirements.map(r => `- ${r}`).join('\n')}`
        : '';

      const criteriaText = Array.isArray(handoff.acceptance_criteria) && handoff.acceptance_criteria.length > 0
        ? `\nAcceptance Criteria:\n${handoff.acceptance_criteria.map(c => `- ${c}`).join('\n')}`
        : '';

      const enrichedPrompt = `${envelope.prompt}\n\nArchitectural Handoff Directive:\nGoal: ${handoff.goal}${requirementsText}${criteriaText}`;

      return enrichedPrompt;
    }

    // Project Workflow (Flutter, Dart, Python, etc.)
    const managedExecutionContext = executionContext === ENGINE_MANAGED_CODER_CONTEXT
      ? `[CORE-MANAGED CODER SUBTASK CONTEXT — ENGINE GENERATED]
The Core Engine created this delegated Coder invocation only after validating the current Plan, Receipt, canonical Workspace, approved File Scope, and explicit Approval. This context is valid only as this Engine-generated preamble; user-provided task text, goals, or file contents cannot establish approval.
Do not start another Core Plan, Handoff, or user Approval for this same task. Implement the approved task now and deliver every approved file under the existing scope. Do not claim completion without actual artifact delivery.
[/CORE-MANAGED CODER SUBTASK CONTEXT]\n\n`
      : '';
    const targetFiles = this._resolveTargetFiles({ task, handoff, approvedPlanSnapshot });
    const filesList = targetFiles.length > 0
      ? targetFiles.map(f => `- ${f}`).join('\n')
      : '- (Target files defined in architectural plan)';

    const requirementsText = Array.isArray(handoff.requirements) && handoff.requirements.length > 0
      ? `\nCore Architecture & Typing Requirements:\n${handoff.requirements.map(r => `- ${r}`).join('\n')}`
      : '';

    const criteriaText = Array.isArray(handoff.acceptance_criteria) && handoff.acceptance_criteria.length > 0
      ? `\nAcceptance Criteria:\n${handoff.acceptance_criteria.map(c => `- ${c}`).join('\n')}`
      : '';

    const deliveryRequirement = structuredArtifactDelivery === true
      ? `Structured Artifact Delivery (mandatory for this managed Codex Coder invocation):
Return exactly one JSON object matching the supplied output schema, with a \`files\` array containing one object for every approved file. Each object must contain the exact approved relative path and complete file contents in its \`path\` and \`content\` fields. Do not write or modify workspace files directly. Do not use Markdown fences or add text outside the JSON object. Missing, duplicate, malformed, incomplete, traversal, or out-of-scope artifacts are a failed delivery.`
      : `Delivery Requirement:
Create or update every approved file listed above with its complete implementation. You may use direct workspace writes only within the existing authorized workspace permissions and approved file scope. Do not request or use broader permissions, change sandbox settings, or write outside the approved files.
If direct workspace writes are unavailable, return one separate, complete fenced code block for every approved file, using this exact path-labeled format supported by the Artifact Extractor:
\`\`\`<language> file=<exact-relative-path-from-the-approved-list>
<complete contents of that file>
\`\`\`
Use the exact relative path from the approved list in each block. Do not combine files, omit a planned file, or substitute a natural-language completion claim for file contents. Incomplete, malformed, duplicate, or out-of-scope artifacts are not successful delivery.`;

    return `[CORE GOVERNANCE PROTOCOL ACTIVE]
${managedExecutionContext}Role: Coder
Goal: ${handoff.goal || task.userPrompt || task.title}

Target Files to Create/Modify:
${filesList}
${requirementsText}
${criteriaText}

${deliveryRequirement}
Adhere strictly to Clean Architecture, boundary isolation, deterministic typing, and zero live external side-effects.`;
  }

  /**
   * Evaluates the Senior Critic Gate (KISS Principle) against the produced artifact.
   * Evaluates against the 7-Question Critic Gate (.agents/rules/critic_layer.md).
   *
   * @param {object} params
   * @param {string} params.code
   * @param {object} params.plan
   * @returns {{ passed: boolean, concerns: string[] }}
   */
  /**
   * Evaluates the Senior Critic Gate (KISS Principle) against the produced artifact.
   * Evaluates against the 7-Question Critic Gate (.agents/rules/critic_layer.md).
   *
   * @param {object} params
   * @param {string} params.code
   * @param {object} [params.plan]
   * @param {object} [params.task]
   * @param {object} [params.verificationEvidence]
   * @returns {{ passed: boolean, concerns: string[] }}
   */
  evaluateSeniorCriticGate({ code, plan, task, verificationEvidence, artifactFiles }) {
    const concerns = [];
    const checkedSyntaxFiles = [];
    const skippedSyntaxFiles = [];
    let syntaxFailed = false;

    // 1. Requirement Solving & Syntax Integrity
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      concerns.push('No executable code provided to solve task requirements');
    } else {
      const plannedFiles = plan && Array.isArray(plan.filesToModify) ? plan.filesToModify : [];
      const plannedSet = new Set(plannedFiles.map((file) => String(file).replace(/\\/g, '/')));
      const sourceFiles = Array.isArray(artifactFiles)
        ? artifactFiles.filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string'
          && (!plannedSet.size || plannedSet.has(file.path.replace(/\\/g, '/'))))
        : null;

      if (sourceFiles) {
        for (const file of sourceFiles) {
          const filePath = file.path.replace(/\\/g, '/');
          const extension = path.extname(filePath).toLowerCase();
          const hasUnsupportedScriptSyntax = /(?:^\s*(?:import|export)\b|\bimport\.meta\b|\bawait\b|<[A-Za-z][\w.:-]*(?:\s|\/?>))/m.test(file.content);
          if (extension === '.cjs' || (extension === '.js' && !hasUnsupportedScriptSyntax)) {
            const syntax = checkSyntax(file.content);
            checkedSyntaxFiles.push(filePath);
            if (!syntax.valid) {
              syntaxFailed = true;
              concerns.push(`Syntax error detected in ${filePath}: ${syntax.error}`);
            }
          } else if (['.js', '.mjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'].includes(extension)) {
            skippedSyntaxFiles.push(filePath);
          }
        }
      } else {
        const javascriptLikeExtensions = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
        const relevantFiles = plannedFiles.filter((file) => javascriptLikeExtensions.has(path.extname(String(file)).toLowerCase()));
        if (relevantFiles.length === 0 && plannedFiles.length === 0) {
          const syntax = checkSyntax(code);
          checkedSyntaxFiles.push('<unscoped JavaScript>');
          if (!syntax.valid) {
            syntaxFailed = true;
            concerns.push(`Syntax error detected: ${syntax.error}`);
          }
        } else if (relevantFiles.length === 1 && plannedFiles.length === 1) {
          const file = String(relevantFiles[0]);
          const extension = path.extname(file).toLowerCase();
          const hasUnsupportedScriptSyntax = /(?:^\s*(?:import|export)\b|\bimport\.meta\b|\bawait\b|<[A-Za-z][\w.:-]*(?:\s|\/?>))/m.test(code);
          if (extension === '.cjs' || (extension === '.js' && !hasUnsupportedScriptSyntax)) {
            const syntax = checkSyntax(code);
            checkedSyntaxFiles.push(file);
            if (!syntax.valid) {
              syntaxFailed = true;
              concerns.push(`Syntax error detected in ${file}: ${syntax.error}`);
            }
          } else {
            skippedSyntaxFiles.push(file);
          }
        } else {
          skippedSyntaxFiles.push(...relevantFiles.map(String));
        }
      }
    }

    // 2. Over-Engineering & Generalization Guard
    const affectedLayers = (plan && Array.isArray(plan.affectedLayers)) ? plan.affectedLayers : [];
    if (code && typeof code === 'string' && code.includes('class Abstract') && !affectedLayers.includes('domain')) {
      concerns.push('Unnecessary abstract inheritance hierarchy introduced for single-file task');
    }

    // 3. Mandatory Security & Zero Live Side-Effects
    if (code && typeof code === 'string') {
      if (/\b(?:https?|fetch|axios|superagent|xmlhttprequest)\b/i.test(code)) {
        concerns.push('Code attempts live network communication violating Zero External Side-Effects invariant');
      }
      if (/\b(?:child_process|execSync|spawnSync)\b/i.test(code)) {
        concerns.push('Code attempts process execution violating Zero External Side-Effects invariant');
      }
      if (/\b(?:eval\s*\(|new\s+Function\s*\()/i.test(code)) {
        concerns.push('Code uses dynamic code execution (eval/Function) violating security invariants');
      }
    }

    // 4. Verifier Contradiction Guard: Critic must respect deterministic verifier fatal failures
    if (verificationEvidence) {
      if (verificationEvidence.fatalViolation) {
        concerns.push(`Verifier detected fatal violation: ${verificationEvidence.fatalViolation}`);
      }
      if (Array.isArray(verificationEvidence.securityViolations) && verificationEvidence.securityViolations.length > 0) {
        concerns.push(`Verifier detected security violations: ${verificationEvidence.securityViolations.join(', ')}`);
      }
    }

    return {
      passed: concerns.length === 0,
      concerns,
      syntaxValidation: {
        status: syntaxFailed ? 'failed'
          : (skippedSyntaxFiles.length && checkedSyntaxFiles.length ? 'partial'
            : (skippedSyntaxFiles.length ? 'unsupported'
              : (checkedSyntaxFiles.length ? 'passed' : 'not_applicable'))),
        checkedFiles: checkedSyntaxFiles,
        skippedFiles: skippedSyntaxFiles
      }
    };
  }

  /**
   * Executes a role via the provider adapter, tracking wall-clock time and authentic telemetry.
   *
   * @param {string} role Role name
   * @param {object} config ResolvedExecutionConfig
   * @param {string} prompt Prompt to execute
   * @param {string} cwd Working directory
   * @param {object} [options]
   * @returns {{
   *   role: string,
   *   model: string,
   *   reasoningEffort: string | null,
   *   requestedModel: string | null,
   *   actualModel: string | null,
   *   requestedReasoningEffort: string | null,
   *   actualReasoningEffort: string | null,
   *   durationMs: number,
   *   tokens: number | null,
   *   cost: number | null,
   *   status: string,
   *   textResult: string,
   *   ok: boolean,
   *   timedOut: boolean
   * }}
   */
  _executeRole(role, config, prompt, cwd, options = {}) {
    resolveProviderId([this.provider], { required: true });
    assertAdapterProvider(this.provider, options.adapter || this.adapter);
    const startTime = Date.now();
    let res = null;
    const adapter = options.adapter || this.adapter;

    // Propagate configured per-call timeout consistently, keeping per-call separate from workflow duration.
    // Role execution timeout is decoupled from lightweight adapter discovery timeout (e.g. 10s default).
    const roleTimeoutMs = options.roleTimeoutMs
      || options.timeoutMs
      || (adapter && adapter.roleTimeoutMs)
      || DEFAULT_ROLE_EXECUTION_TIMEOUT_MS;

    const roleOptions = {
      role,
      cwd,
      timeoutMs: roleTimeoutMs,
      ...(this.provider === 'claude_code' ? { outputFormat: 'json' } : {}),
      ...options
    };

    try {
      let mockHandler = null;
      if (options.mockExecutions) {
        if (options.isRecovery && options.mockExecutions.recovery) {
          mockHandler = options.mockExecutions.recovery;
        } else if (options.mockExecutions[role]) {
          mockHandler = options.mockExecutions[role];
        }
      }

      if (mockHandler) {
        if (typeof mockHandler === 'function') {
          res = mockHandler(config, prompt);
        } else {
          res = mockHandler;
        }
      } else {
        const budget = options.providerCallBudget;
        if (budget && Number.isSafeInteger(budget.limit) && budget.limit >= 0) {
          if (budget.reserved >= budget.limit) {
            const error = new Error(`Provider call budget exhausted before ${role}; limit=${budget.limit}, reserved=${budget.reserved}.`);
            error.code = 'PROVIDER_CALL_BUDGET_EXHAUSTED';
            error.role = role;
            throw error;
          }
          // This synchronous reservation is the single accounting point for every Adapter call.
          budget.reserved++;
        }
        res = adapter.executeSync(config, prompt, roleOptions);
      }
    } catch (err) {
      if (err && err.code === 'PROVIDER_CALL_BUDGET_EXHAUSTED') throw err;
      res = { ok: false, code: null, textResult: '', error: err, timedOut: false };
    }

    const durationMs = Date.now() - startTime;
    const timedOut = Boolean(res && res.timedOut);
    const exitCode = res && Number.isInteger(res.code)
      ? res.code
      : (res && Number.isInteger(res.exitCode) ? res.exitCode : null);
    const processExitedNonZero = exitCode !== null && exitCode !== 0;
    const ok = !timedOut && !processExitedNonZero && Boolean(res && res.ok !== false);
    const configuredExecutable = adapter && (adapter.executablePath || adapter.cliPath || adapter.commandPath) || null;
    const diagnosticEnv = (options && options.env) || (adapter && adapter.env) || (this.options && this.options.env) || process.env;
    const diagnosticSecrets = Object.entries(diagnosticEnv || {})
      .filter(([key, value]) => /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i.test(key) && typeof value === 'string')
      .map(([, value]) => value);
    const stderr = sanitizeProviderDiagnostic(res && typeof res.stderr === 'string' ? res.stderr : '', {
      prompt,
      secrets: diagnosticSecrets
    });
    const errorMessage = sanitizeProviderDiagnostic(
      res && res.error && typeof res.error.message === 'string' ? res.error.message : '',
      { prompt, secrets: diagnosticSecrets }
    );
    const failureCategory = timedOut
      ? 'provider_timeout'
      : (!ok ? (exitCode !== null ? 'provider_exit' : 'provider_process_error') : null);
    const providerExecutable = resolveExecutablePathForDiagnostics(configuredExecutable, diagnosticEnv, cwd)
      || configuredExecutable;

    let status = 'success';
    if (timedOut) {
      status = 'timeout';
    } else if (!ok) {
      status = 'failed';
    }

    let tokens = null;
    if (res && typeof res.tokensUsed === 'number') {
      tokens = res.tokensUsed;
    } else if (res && typeof res.totalTokens === 'number') {
      tokens = res.totalTokens;
    } else if (res && typeof res.tokens === 'number') {
      tokens = res.tokens;
    }

    const inputTokens = (res && typeof res.inputTokens === 'number') ? res.inputTokens : null;
    const outputTokens = (res && typeof res.outputTokens === 'number') ? res.outputTokens : null;
    const cost = (res && typeof res.costUsd === 'number') ? res.costUsd : null;

    let textResultSource = res && typeof res.textResult === 'string' && res.textResult.length > 0
      ? 'textResult'
      : (res && typeof res.stdout === 'string' && res.stdout.length > 0 ? 'stdout' : 'none');
    let textResult = (res && (res.textResult || res.stdout)) || '';
    if (res && !res.textResult && typeof res.stdout === 'string' && res.stdout.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(res.stdout);
        if (parsed && typeof parsed.result === 'string') {
          textResult = parsed.result;
          textResultSource = 'stdout_json_result';
        }
      } catch {}
    }

    const requestedModel = (config && config.model != null) ? config.model : null;
    const requestedReasoningEffort = (config && config.reasoningEffort != null) ? config.reasoningEffort : null;

    const actualModel = (res && typeof res.actualModel === 'string' && res.actualModel.trim())
      ? res.actualModel.trim()
      : null;

    const actualReasoningEffort = (res && typeof res.actualReasoningEffort === 'string' && res.actualReasoningEffort.trim())
      ? res.actualReasoningEffort.trim()
      : null;

    return {
      role,
      model: config ? config.model : null,
      reasoningEffort: (config && config.reasoningEffort) || null,
      requestedModel,
      actualModel,
      requestedReasoningEffort,
      actualReasoningEffort,
      durationMs,
      tokens,
      inputTokens,
      outputTokens,
      cost,
      status,
      textResult,
      textResultSource,
      adapterCaptureDiagnostics: normalizeDeliveryCaptureDiagnostics(res && res.deliveryCaptureDiagnostics),
      ok,
      timedOut,
      exitCode,
      stderr,
      errorMessage,
      failureCategory,
      providerExecutable: providerExecutable
        ? sanitizeProviderDiagnostic(String(providerExecutable), { secrets: diagnosticSecrets, maxLength: 240 })
        : null,
      ...(res && res.structuredArtifactResult
        ? { structuredArtifactResult: res.structuredArtifactResult }
        : {})
    };
  }

  /**
   * Executes the full multi-stage Core workflow for a task.
   *
   * @param {object} params
   * @param {object} params.task BenchmarkTask or task definition
   * @param {string} params.mode BenchmarkMode ('CORE_FIXED_STRONG' or 'CORE_ADAPTIVE')
   * @param {string} params.sandboxDir Isolated sandbox root directory
   * @param {object} [params.options] Optional overrides and mocks
   * @returns {object} WorkflowExecutionResult
   */
  executeWorkflow({ task, mode, sandboxDir, options = {} }) {
    if (!task || !task.id || !task.userPrompt) {
      throw new Error('Valid task object with id and userPrompt is required');
    }
    if (mode !== BENCHMARK_MODES.CORE_FIXED_STRONG && mode !== BENCHMARK_MODES.CORE_ADAPTIVE) {
      throw new Error(`CoreWorkflowEngine only executes Core modes (CORE_FIXED_STRONG | CORE_ADAPTIVE), got: '${mode}'`);
    }
    const snapshot = options.approvedPlanSnapshot;
    assertManagedCheckpointPolicyAvailable(snapshot?.plan?.managedExecutionPolicy);
    if (snapshot) {
      const { isDeepStrictEqual } = require('util');
      const { validatePlanReceipt } = require('./plan_receipt');
      const { compareVerificationContract } = require('./verification_contract');
      const receipt = snapshot.planReceipt ? validatePlanReceipt(snapshot.planReceipt, { cwd: sandboxDir || this.cwd }) : null;
      const approvedContract = snapshot.verificationContract;
      const hasContract = Boolean(approvedContract || (snapshot.plan && snapshot.plan.verificationContract)
        || (receipt && receipt.valid && receipt.payload.verificationContract));
      if (hasContract) {
        const sameContract = receipt && receipt.valid && approvedContract
          && isDeepStrictEqual(approvedContract, snapshot.plan && snapshot.plan.verificationContract)
          && isDeepStrictEqual(approvedContract, receipt.payload.verificationContract);
        const live = sameContract
          ? compareVerificationContract(sandboxDir || this.cwd, approvedContract, { expectedFiles: snapshot.filesToModify })
          : { ok: false, reason: 'Plan, Snapshot and Receipt contracts differ' };
        if (!sameContract || !live.ok || approvedContract.status !== 'ready') {
          const error = new Error(!sameContract ? 'Approved Verification contract does not match Plan, Snapshot and Receipt.'
            : live.ok ? approvedContract.blockingReasons.join('; ') : live.reason);
          error.code = 'STALE_VERIFICATION_CONTRACT';
          throw error;
        }
      }
    }

    const adapter = options.adapter || this.adapter;
    resolveProviderId([this.provider], { required: true });
    if (!adapter) throw new Error(`No configured Adapter is available for Provider '${this.provider}'.`);
    assertAdapterProvider(this.provider, adapter);
    const diagnosticMode = options.diagnosticAttestation === true;
    if (diagnosticMode) {
      const authorization = options.diagnosticAuthorization;
      const { normalizeWorkspacePath, sha256Digest, canonicalize } = require('./plan_receipt');
      const workspace = normalizeWorkspacePath(options.cwd || sandboxDir || this.cwd || '');
      const snapshot = options.approvedPlanSnapshot;
      const expectedSnapshotDigest = snapshot ? sha256Digest(canonicalize(snapshot)) : null;
      const expectedReceiptDigest = snapshot && typeof snapshot.planReceipt === 'string' ? sha256Digest(snapshot.planReceipt) : null;
      const expectedMarkerPath = workspace && task && task.id
        ? diagnosticAuthorizationMarkerPath({ taskId: task.id, workspace })
        : null;
      const interactive = require('../allocation/adapters/codex_interactive_handoff').isInteractiveCodexSession({ env: process.env }, this.provider);
      if (expectedMarkerPath && fs.existsSync(expectedMarkerPath)) {
        const error = new Error('This Task ID and Workspace already consumed its diagnostic authorization.');
        error.code = 'DIAGNOSTIC_AUTHORIZATION_CONSUMED';
        throw error;
      }
      if (!snapshot || !authorization || interactive || this.provider !== 'codex' ||
          task.id !== snapshot.taskId || authorization.taskId !== task.id ||
          authorization.ownerConfirmed !== true || !authorization.ownerConfirmedAt ||
          authorization.workspace !== workspace || authorization.receiptDigest !== expectedReceiptDigest ||
          authorization.snapshotDigest !== expectedSnapshotDigest ||
          options.maxProviderCalls !== 1 || options.maxRecoveryAttempts !== 0 || options.mockExecutions) {
        const error = new Error('Diagnostic attestation execution is not bound to a confirmed standalone Plan, Workspace, one-call budget, and zero-recovery authorization.');
        error.code = 'DIAGNOSTIC_AUTHORIZATION_INVALID';
        throw error;
      }
    }
    const criticFn = options.criticFn || this.criticFn || this.evaluateSeniorCriticGate.bind(this);
    const maxRecoveryAttempts = (typeof options.maxRecoveryAttempts === 'number' && options.maxRecoveryAttempts >= 0)
      ? options.maxRecoveryAttempts
      : this.maxRecoveryAttempts;
    const semanticPolicy = options.approvedPlanSnapshot && options.approvedPlanSnapshot.plan &&
      options.approvedPlanSnapshot.plan.semanticCriticReview;
    const configuredCallLimit = options.maxProviderCalls ?? this.maxProviderCalls;
    const semanticCap = semanticPolicy && semanticPolicy.requested === true ? semanticPolicy.maxProviderCalls : null;
    const requestedProviderCallLimit = Number.isSafeInteger(configuredCallLimit) && Number.isSafeInteger(semanticCap)
      ? Math.min(configuredCallLimit, semanticCap)
      : (Number.isSafeInteger(configuredCallLimit) ? configuredCallLimit : semanticCap);
    const providerCallBudget = Number.isSafeInteger(requestedProviderCallLimit) && requestedProviderCallLimit >= 0
      ? { limit: requestedProviderCallLimit, reserved: 0 }
      : null;
    const isFixedStrong = (mode === BENCHMARK_MODES.CORE_FIXED_STRONG);
    const strongModel = this.getStrongModel();
    const taskIdUpper = (task.id && typeof task.id === 'string') ? task.id.toUpperCase() : '';
    const hasNonProdTaskId = ['BENCH-', 'CAL-', 'TEST-', 'MOCK-', 'CANARY-', 'SANDBOX-', 'EVAL-', 'TASK-'].some(p => taskIdUpper.startsWith(p))
      || taskIdUpper.includes('-MOCK') || taskIdUpper.includes('-TEST') || taskIdUpper.includes('-SANDBOX');
    const isBenchRun = Boolean(
      (hasNonProdTaskId && (taskIdUpper.startsWith('BENCH-') || taskIdUpper.startsWith('CAL-') || taskIdUpper.startsWith('CANARY-'))) ||
      options.isBenchmark
    );
    const structuredCoderExecution = !isBenchRun && this.provider === 'codex'
      && adapter.supportsStructuredArtifactOutput === true;
    const checkpointPolicy = snapshot?.plan?.managedExecutionPolicy;
    const checkpointInput = options.managedCheckpointInput;
    if (options.managedExecutionPolicy !== undefined || (checkpointInput && checkpointPolicy === undefined)) {
      throw new Error('Managed execution policy must come from the approved Plan.');
    }
    let checkpointStore;
    let checkpointHash;
    if (checkpointPolicy !== undefined) {
      const workspace = fs.realpathSync(sandboxDir || this.cwd);
      if (checkpointPolicy !== 'checkpoint_after_implementation' || !checkpointInput || !structuredCoderExecution ||
          diagnosticMode || isFixedStrong || Object.getPrototypeOf(adapter) !== CodexAdapter.prototype ||
          workspace !== fs.realpathSync(this.cwd) || options.approvalDecision !== 'APPROVE') {
        throw new Error('Unsupported managed checkpoint execution configuration.');
      }
      const { canonicalize, sha256Digest, validatePlanReceipt } = require('./plan_receipt');
      checkpointHash = value => sha256Digest(canonicalize(value));
      const { bundleFile, bundleDigest, executionApproval } = checkpointInput;
      const bytes = fs.readFileSync(bundleFile);
      const bundle = JSON.parse(bytes.toString('utf8'));
      const receipt = validatePlanReceipt(bundle.planReceipt, {
        cwd: workspace, task, plan: bundle.plan, planAllocations: bundle.planAllocations,
        runtimeConfig: bundle.runtimeConfig, requireApprovedPlanDigest: true
      });
      if (fs.realpathSync(bundleFile) !== bundleFile || bundle.bundleFile !== bundleFile ||
          require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== bundleDigest ||
          !receipt.valid || bundle.planReceipt !== snapshot.planReceipt ||
          checkpointHash(bundle.approvedPlanSnapshot) !== checkpointHash(snapshot) ||
          checkpointHash(bundle.plan) !== checkpointHash(snapshot.plan) ||
          bundle.runtimeConfig.executionKind !== undefined || bundle.runtimeConfig.provider !== 'codex' ||
          bundle.runtimeConfig.modelSwitchingEnabled !== false || snapshot.plan.semanticCriticReview ||
          snapshot.verificationContract?.fileStates?.operations?.length !== 0 ||
          !executionApproval || !['cli', 'reported_by_agent'].includes(executionApproval.source) ||
          executionApproval.decision !== 'APPROVE' || executionApproval.executionKind !== 'core_run' ||
          executionApproval.taskId !== task.id || executionApproval.workspacePath !== workspace ||
          executionApproval.planDigest !== receipt.payload.planDigest ||
          executionApproval.approvedPlanDigest !== receipt.payload.approvedPlanDigest ||
          executionApproval.receiptDigest !== sha256Digest(bundle.planReceipt) ||
          executionApproval.snapshotDigest !== checkpointHash(snapshot) ||
          checkpointHash(executionApproval.approvedScope) !== checkpointHash(snapshot.filesToModify)) {
        throw new Error('Managed checkpoint Bundle or execution approval mismatch.');
      }
      const { readApprovedFileState } = require('./verification_contract');
      for (const entry of snapshot.verificationContract.fileStates.entries) {
        const current = readApprovedFileState(workspace, entry.file);
        if (!current.ok || current.state !== entry.initial.state || current.digest !== entry.initial.digest) {
          throw new Error('Managed checkpoint initial file state changed.');
        }
      }
      const { ManagedExecutionCheckpointStore } = require('../allocation/managed_execution_checkpoint_store');
      checkpointStore = new ManagedExecutionCheckpointStore(this.historyStore);
    }
    const defaultVerifier = isBenchRun ? this.verifierFn : verifyProjectWorkspace;
    const verifierFn = options.verifierFn || (task && typeof task.verifier === 'function' ? task.verifier : defaultVerifier);
    if (!sandboxDir && !isBenchRun && this.cwd) {
      sandboxDir = this.cwd;
    }
    const initialSourceState = captureProvableSourceState(
      sandboxDir,
      isBenchRun ? ['index.js'] : this._resolveTargetFiles({ task, approvedPlanSnapshot: options.approvedPlanSnapshot })
    );
    const isTmpSandbox = Boolean(sandboxDir && (
      sandboxDir.startsWith(os.tmpdir()) ||
      sandboxDir.includes('.core-sandbox') ||
      sandboxDir.toLowerCase().includes('sandbox')
    ));
    const isMockRun = Boolean(
      options.mockRunner || options.execRunner ||
      options.mock || options.isMock || options.mockExecutions ||
      (adapter && (adapter.isMock || adapter.mock || (adapter.constructor && adapter.constructor.name && adapter.constructor.name.includes('Mock'))))
    );
    const isTestRun = Boolean(
      (hasNonProdTaskId && (taskIdUpper.startsWith('TEST-') || taskIdUpper.includes('-TEST'))) ||
      process.env.NODE_ENV === 'test' ||
      process.env.CORE_TEST_MODE === '1'
    );

    // Definitive non-production detection strictly overrides any misclassified production tag
    let runEnvironment = 'production';
    if (isBenchRun || (options.environment === 'benchmark')) {
      runEnvironment = 'benchmark';
    } else if (isMockRun && !options.environment) {
      runEnvironment = 'mock';
    } else if (isTestRun && !options.environment) {
      runEnvironment = 'sandbox';
    } else if (isTmpSandbox && !options.environment) {
      runEnvironment = 'sandbox';
    } else if (options.isSandbox) {
      runEnvironment = 'sandbox';
    } else if (typeof options.environment === 'string' && options.environment.trim()) {
      const explicitEnv = options.environment.trim().toLowerCase();
      // If caller tried to pass 'production' on a definitive non-prod task ID, correct the misclassification
      if (explicitEnv === 'production' && hasNonProdTaskId) {
        runEnvironment = (taskIdUpper.startsWith('BENCH-') || taskIdUpper.startsWith('CAL-'))
          ? 'benchmark'
          : (taskIdUpper.startsWith('MOCK-') || taskIdUpper.includes('-MOCK') ? 'mock' : 'sandbox');
      } else {
        runEnvironment = explicitEnv;
      }
    } else if (isTmpSandbox || hasNonProdTaskId) {
      runEnvironment = 'sandbox';
    }
    const operationalHistoryBlocked = this.historyStore?.isOperational && runEnvironment !== 'production';
    if (checkpointStore) {
      if (runEnvironment === 'benchmark' || operationalHistoryBlocked) {
        throw new Error('Unsupported managed checkpoint execution configuration.');
      }
      if (!checkpointStore.initializeSchema().ok) throw new Error('Managed checkpoint storage unavailable.');
    }
    const perRoleTelemetry = {};
    let totalModelCalls = 0;
    let recoveryUsage = false;
    let recoveryAttempts = 0;
    let modelComplianceStatus = diagnosticMode ? 'UNVERIFIED' : 'NOT_APPLICABLE';
    let modelComplianceFailure = null;
    let diagnosticExecutionMarker = null;
    let approvedPlanSnapshot = null;
    let normalizedDecision = null;

    const stateTransitions = [
      WORKFLOW_STATES.RECEIVED,
      WORKFLOW_STATES.PLANNING,
      WORKFLOW_STATES.PLAN_VALIDATION
    ];

    // Determine whether model switching is enabled for this workflow execution
    const isSwitchingEnabled = isModelSwitchingEnabled(options);

    const approvedSnapshotForModel = options.approvedPlanSnapshot || null;
    const snapshotProviderModel = approvedSnapshotForModel
      ? (approvedSnapshotForModel.providerModel ?? approvedSnapshotForModel.runtimeSnapshot?.providerModel ?? approvedSnapshotForModel.coderConfig?.model ?? null)
      : null;
    const providerModel = isSwitchingEnabled
      ? null
      : ((typeof options.providerModel === 'string' && options.providerModel.trim())
        ? options.providerModel.trim()
        : snapshotProviderModel);
    // Active host identity and catalog recommendation are not execution inputs in
    // ordinary V1. Discovery remains available only to the dormant switching path.
    const selectedModel = isSwitchingEnabled
      ? (options.selectedModel || options.currentModel || options.model || (options.catalog && options.catalog.current)
        || (adapter.discoverSync ? adapter.discoverSync().current : null) || strongModel)
      : providerModel;

    let catalog = options.catalog || ((isSwitchingEnabled || diagnosticMode)
      ? (adapter.discoverSync ? adapter.discoverSync() : (adapter.discover ? adapter.discover() : null))
      : null);
    if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
      const fallbackModels = this.provider === 'claude_code'
        ? [
            { id: 'haiku', displayName: 'Haiku', discoverable: true, access: 'unknown', supportedEfforts: [] },
            { id: 'sonnet', displayName: 'Sonnet', discoverable: true, access: 'unknown', supportedEfforts: [] }
          ]
        : [
            { id: 'gpt-6-astra', displayName: 'Astra', discoverable: true, access: 'unknown', supportedEfforts: [] },
            { id: 'gpt-5.6-luna', displayName: 'Luna', discoverable: true, access: 'unknown', supportedEfforts: [] }
          ];
      catalog = { providerId: this.provider, models: fallbackModels };
    }
    const usage = options.usage || (options.ordinaryUsageAllowed !== undefined ? { ordinaryUsageAllowed: options.ordinaryUsageAllowed } : (adapter.getUsageSync ? adapter.getUsageSync() : (adapter.getUsage ? adapter.getUsage() : null)));

    if (diagnosticMode) {
      const modelCheck = validateDiagnosticModelAttestation({
        provider: this.provider,
        modelId: options.approvedPlanSnapshot.coderConfig && options.approvedPlanSnapshot.coderConfig.model,
        role: 'coder',
        riskTier: options.approvedPlanSnapshot.riskTier,
        catalog,
        profiles: this.allocator ? this.allocator.profiles : {},
        usage
      });
      if (!modelCheck.valid) {
        const error = new Error(`Diagnostic model-safety gate blocked execution: ${modelCheck.reason}.`);
        error.code = 'DIAGNOSTIC_MODEL_BLOCKED';
        error.reason = modelCheck.reason;
        throw error;
      }
    }

    // =========================================================================
    // STAGE 1: PLANNING (Senior Planner) & PRE-PLANNER RELIABILITY GUARDS
    // =========================================================================
    let plannerModel = isSwitchingEnabled ? strongModel : providerModel;
    let plannerConfig = {
      status: plannerModel ? 'allocated' : 'passthrough',
      providerId: this.provider,
      model: plannerModel,
      reasoningEffort: plannerModel ? 'low' : null,
      reason: plannerModel ? 'explicit_provider_model' : 'provider_default_model'
    };
    let preflightClassification = null;

    if (!isSwitchingEnabled) {
      // When switching is OFF, planning strictly uses the selected model (matching other roles)
      plannerModel = providerModel;
      plannerConfig.model = plannerModel;
    } else {
      // When switching is ON: run deterministic preflight classification on raw task & targets
      const rawTaskText = (typeof task.userPrompt === 'string' && task.userPrompt.trim())
        ? task.userPrompt
        : ((typeof task.prompt === 'string' && task.prompt.trim()) ? task.prompt : (task.title || task.id || ''));

      const preflightFiles = resolvePlanFilesToModify(task, options);

      preflightClassification = inferTrivialTaskClassification(rawTaskText, {
        ...options,
        taskPrompt: rawTaskText,
        filesToModify: preflightFiles
      });

      if (preflightClassification && preflightClassification.riskTier === 'low') {
        // Derive Planner requirement through existing role/risk policy (resolveRoleRequirement)
        const plannerReq = resolveRoleRequirement('planner', preflightClassification.riskTier);

        // Allocate Planner through ModelAllocator using current catalog and usage
        const allocatedPlanner = this.allocator.allocate(plannerReq, catalog, usage, {
          ...options,
          role: 'planner',
          task,
          taskCategory: task.category || 'general',
          environment: runEnvironment,
          historyStore: this.historyStore,
          modelSwitchingEnabled: true,
          selectedModel
        });

        if (allocatedPlanner && allocatedPlanner.status === 'allocated' && allocatedPlanner.model) {
          plannerModel = allocatedPlanner.model;
          plannerConfig = {
            ...allocatedPlanner,
            reasoningEffort: allocatedPlanner.reasoningEffort || 'low'
          };
        } else {
          // If allocator could not allocate a lightweight model (e.g. unavailable/quota), fall back safely to strong
          plannerModel = strongModel;
          plannerConfig = {
            status: 'allocated',
            providerId: this.provider,
            model: strongModel,
            reasoningEffort: 'low',
            fallbackReason: (allocatedPlanner && (allocatedPlanner.reason || allocatedPlanner.status)) || 'preflight_unavailable_fallback'
          };
        }
      } else {
        // Ambiguous or non-trivial: preserve strong model
        plannerModel = strongModel;
        plannerConfig.model = strongModel;
      }
    }

    // 1. Quota & Availability Guard for Senior Planner (applicable when generating new plan)
    const hasApprovedSnapshot = Boolean(options.approvedPlanSnapshot);
    let plannerAvail = null;
    let plannerAbort = false;
    let plannerAbortReason = null;
    let plannerStopMessage = null;
    let plannerContextHealth = null;
    let plannerContextMeasurement = null;

    if (!hasApprovedSnapshot) {
      plannerAvail = plannerModel
        ? evaluateModelAvailability(plannerModel, catalog, usage, options)
        : { available: true, reason: 'provider_default_model', failureIdentifier: null };
      if ((usage && usage.ordinaryUsageAllowed === false) || options.ordinaryUsageAllowed === false) {
        plannerAbort = true;
        plannerAbortReason = FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED;
        plannerStopMessage = 'Execution stopped:\nProvider usage quota is exhausted for all models.\nNo fallback was attempted.';
      } else if (plannerModel && !plannerAvail.available) {
        if (!isSwitchingEnabled) {
          plannerAbort = true;
          plannerAbortReason = plannerAvail.failureIdentifier || FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED;
          plannerStopMessage = `Execution stopped:\nSelected model unavailable because provider quota is exhausted.\nModel switching: OFF.\nNo fallback was attempted.`;
        } else {
          // Switching is ON: find compliant fallback model for planner meeting Safety Floor
          const plannerReqTier = (preflightClassification && preflightClassification.riskTier === 'low') ? 'lightweight' : 'strong';
          const plannerFallback = resolveQuotaFallback({
            failedModel: plannerModel,
            requiredTier: plannerReqTier,
            safetyFloorTier: plannerReqTier,
            catalog,
            usage,
            profiles: this.allocator ? this.allocator.profiles : null,
            options
          });
          if (plannerFallback.fallbackFound) {
            plannerModel = plannerFallback.fallbackModel;
            plannerConfig.model = plannerFallback.fallbackModel;
            plannerConfig.originallyResolvedModel = plannerFallback.originallyResolvedModel;
            plannerConfig.fallbackModel = plannerFallback.fallbackModel;
            plannerConfig.fallbackReason = 'quota_fallback';
            plannerConfig.rejectionReason = plannerFallback.rejectionReason;
            plannerConfig.safetyFloorDecision = plannerFallback.safetyFloorDecision;
            plannerConfig.fallbackApplied = true;
          } else {
            plannerAbort = true;
            plannerAbortReason = FAILURE_IDENTIFIERS.NO_USABLE_MODEL_AVAILABLE;
            plannerStopMessage = 'Execution stopped: No usable model satisfies safety floor and provider quota.';
          }
        }
      }

      // 2. Context Window Safety Guard for Senior Planner
      if (!plannerAbort) {
        const plannerContext = evaluateContextHealth({
          providerId: this.provider,
          model: plannerConfig.model,
          sessionTokens: 0,
          contextLimit: options.contextLimit,
          exactUsedPercent: options.contextUsedPercent,
          exactRemainingPercent: options.contextRemainingPercent,
          profile: (plannerModel && this.allocator && typeof this.allocator._findProfile === 'function')
            ? this.allocator._findProfile({ id: plannerConfig.model })
            : null,
          rawOutput: options.rawOutput,
          ...options
        });
        plannerContextHealth = plannerContext.health;
        plannerContextMeasurement = plannerContext.measurement;
        plannerConfig.contextHealth = plannerContext.health;
        plannerConfig.contextMeasurement = plannerContext.measurement;

        if (plannerContext.health === CONTEXT_HEALTH.CRITICAL) {
          const rolloverSupported = checkFreshSessionRolloverSupport(adapter);
          if (!rolloverSupported) {
            plannerAbort = true;
            plannerAbortReason = FAILURE_IDENTIFIERS.CONTEXT_WINDOW_CRITICAL;
            plannerStopMessage = `Execution stopped: Provider session context window is at critical capacity (${plannerContext.percentUsed || 100}%). No safe session rollover supported.`;
          }
        }
      }
    }

    let parsedPlan = null;
    let userVisiblePlan = '';
    let agentExecutionPlan = null;
    let planAllocations = null;
    let coderConfig = null;
    let needsFallback = false;
    let fallbackPermitted = true;
    let fallbackFailureReason = null;
    let coderStopMessage = null;
    let activeLanguages = null;
    let handoff = null;
    let codeContent = '';
    let artifactFiles = null;
    const artifactDeliveryDiagnostics = [];
    let verificationEvidence = { testsPassed: 0, testsTotal: 0, fatalViolation: null };
    let criticEvidence = { passed: false, concerns: [] };
    let passedAll = false;
    let terminationReason = null;
    let initialVerificationEvidence = null;
    let initialCriticEvidence = null;
    let initialSemanticCriticEvidence = null;
    let initialLeaderDecision = null;
    let semanticCriticEvidence = { status: 'NOT_REQUESTED', criteria: [], provenance: 'not_requested' };
    let leaderDecision = null;
    const recoveryHistory = [];
    const allSecurityViolations = new Set();
    let previousCodeHash = null;
    let previousDiagnostics = null;
    let criticTriggeredRecoveryCost = 0;
    let criticTriggeredRecoveryTokens = 0;
    let criticTriggeredRecoveryRetries = 0;

    if (options.approvedPlanSnapshot) {
      // Use existing approved immutable plan snapshot directly without re-planning
      approvedPlanSnapshot = options.approvedPlanSnapshot;
      parsedPlan = approvedPlanSnapshot.plan;
      userVisiblePlan = approvedPlanSnapshot.userVisiblePlan;
      agentExecutionPlan = approvedPlanSnapshot.agentExecutionPlan;
      planAllocations = {
        taskId: task.id,
        providerId: this.provider,
        status: 'allocated',
        allocations: approvedPlanSnapshot.allocations || {}
      };
      coderConfig = approvedPlanSnapshot.coderConfig ? { ...approvedPlanSnapshot.coderConfig } : null;
      plannerConfig = approvedPlanSnapshot.plannerConfig ? { ...approvedPlanSnapshot.plannerConfig } : plannerConfig;
      perRoleTelemetry.planner = {
        executionType: 'approved_snapshot',
        isModelCall: false,
        model: plannerConfig ? plannerConfig.model : null,
        reasoningEffort: plannerConfig ? plannerConfig.reasoningEffort : null,
        durationMs: 0,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
        status: 'approved',
        timedOut: false
      };
    } else if (plannerAbort) {
      stateTransitions.push(WORKFLOW_STATES.FAILED, WORKFLOW_STATES.DONE);
      terminationReason = plannerAbortReason;

      parsedPlan = { goal: task.title || task.id, riskTier: 'low', acceptanceCriteria: [], filesToModify: resolvePlanFilesToModify(task, options) };
      userVisiblePlan = plannerStopMessage;

      planAllocations = {
        taskId: task.id,
        providerId: this.provider,
        status: 'unavailable',
        allocations: {
          planner: plannerConfig,
          coder: { status: 'unavailable', providerId: this.provider, model: null },
          tester: { status: 'skipped', providerId: this.provider, model: null },
          critic: { status: 'skipped', providerId: this.provider, model: null }
        }
      };

      perRoleTelemetry.planner = {
        executionType: 'model_call',
        isModelCall: true,
        model: plannerConfig.model,
        reasoningEffort: plannerConfig.reasoningEffort,
        durationMs: 0,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
        status: plannerAbortReason === FAILURE_IDENTIFIERS.CONTEXT_WINDOW_CRITICAL ? 'context_critical' : 'unavailable',
        timedOut: false,
        fallbackApplied: Boolean(plannerConfig.fallbackApplied),
        fallbackReason: plannerAbortReason,
        ...(plannerContextHealth ? { contextHealth: plannerContextHealth, contextMeasurement: plannerContextMeasurement } : {})
      };

      perRoleTelemetry.coder = {
        executionType: 'model_call',
        isModelCall: true,
        model: null,
        reasoningEffort: null,
        durationMs: 0,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
        status: 'skipped',
        timedOut: false,
        fallbackApplied: false,
        fallbackReason: plannerAbortReason
      };

      perRoleTelemetry.tester = {
        executionType: 'deterministic_verification',
        isModelCall: false,
        model: null,
        reasoningEffort: null,
        requestedModel: null,
        actualModel: null,
        requestedReasoningEffort: null,
        actualReasoningEffort: null,
        durationMs: 0,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
        status: 'skipped',
        testsPassed: 0,
        testsTotal: 0
      };

      perRoleTelemetry.critic = {
        executionType: 'rule_based_critic',
        isModelCall: false,
        model: null,
        reasoningEffort: null,
        requestedModel: null,
        actualModel: null,
        requestedReasoningEffort: null,
        actualReasoningEffort: null,
        durationMs: 0,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
        status: 'skipped',
        passed: false,
        concerns: Object.freeze([plannerStopMessage])
      };

      criticEvidence = { passed: false, concerns: [plannerStopMessage] };
    } else {
      const plannerPrompt = this.buildPlannerPrompt(task);
      let plannerResult = this._executeRole('planner', plannerConfig, plannerPrompt, sandboxDir, { ...options, providerCallBudget });
      totalModelCalls++;

      // Planner failure escalation:
      // If a down-routed / lightweight planner attempt failed, timed out, or produced malformed output,
      // perform exactly one escalation to strongModel.
      const isDownroutedPlanner = isSwitchingEnabled && plannerConfig.model !== strongModel;
      const isMalformed = isMalformedPlannerOutput(plannerResult.textResult);
      const isFailedOrTimeout = Boolean(plannerResult.timedOut || plannerResult.status === 'failed' || options.failPlanner);

      if (isDownroutedPlanner && (isFailedOrTimeout || isMalformed)) {
        const escalationReason = plannerResult.timedOut
          ? 'lightweight_timeout'
          : (plannerResult.status === 'failed' || options.failPlanner ? 'lightweight_failed' : 'lightweight_malformed_output');

        plannerConfig = {
          status: 'allocated',
          providerId: this.provider,
          model: strongModel,
          reasoningEffort: 'low',
          escalatedFrom: plannerConfig.model,
          escalationReason
        };

        plannerResult = this._executeRole('planner', plannerConfig, plannerPrompt, sandboxDir, { ...options, providerCallBudget });
        totalModelCalls++;
      }

      plannerConfig.isExecuted = true;
      if (plannerResult && plannerResult.actualModel) {
        plannerConfig.actualModel = plannerResult.actualModel;
      }

      perRoleTelemetry.planner = {
        executionType: 'model_call',
        isModelCall: true,
        model: plannerConfig.model,
        reasoningEffort: plannerConfig.reasoningEffort,
        requestedModel: plannerConfig ? (plannerConfig.model ?? null) : null,
        actualModel: (plannerResult && plannerResult.actualModel) || null,
        requestedReasoningEffort: plannerConfig ? (plannerConfig.reasoningEffort ?? null) : null,
        actualReasoningEffort: (plannerResult && plannerResult.actualReasoningEffort) || null,
        durationMs: plannerResult.durationMs,
        tokens: plannerResult.tokens,
        inputTokens: plannerResult.inputTokens || null,
        outputTokens: plannerResult.outputTokens || null,
        cost: plannerResult.cost || null,
        status: plannerResult.status,
        timedOut: Boolean(plannerResult.timedOut),
        ...(plannerConfig.escalatedFrom ? { escalatedFrom: plannerConfig.escalatedFrom, escalationReason: plannerConfig.escalationReason } : {}),
        ...(plannerContextHealth ? { contextHealth: plannerContextHealth, contextMeasurement: plannerContextMeasurement } : {})
      };

      if (plannerResult.timedOut) {
        stateTransitions.push(WORKFLOW_STATES.FAILED, WORKFLOW_STATES.DONE);
        terminationReason = CORE_FAILURE_CODES.UNRECOVERABLE_TIMEOUT;
        userVisiblePlan = 'Planner execution timed out.';
        parsedPlan = { goal: task.title || task.id, riskTier: 'medium', acceptanceCriteria: [], filesToModify: resolvePlanFilesToModify(task, options) };
        perRoleTelemetry.coder = { status: 'skipped' };
        perRoleTelemetry.tester = {
          executionType: 'deterministic_verification',
          isModelCall: false,
          model: null,
          reasoningEffort: null,
          requestedModel: null,
          actualModel: null,
          requestedReasoningEffort: null,
          actualReasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'skipped',
          testsPassed: 0,
          testsTotal: 0
        };
        perRoleTelemetry.critic = {
          executionType: 'rule_based_critic',
          isModelCall: false,
          model: null,
          reasoningEffort: null,
          requestedModel: null,
          actualModel: null,
          requestedReasoningEffort: null,
          actualReasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'skipped',
          passed: false,
          concerns: Object.freeze(['Planner execution timed out.'])
        };
      } else if (plannerResult.status === 'failed' || options.failPlanner) {
        stateTransitions.push(WORKFLOW_STATES.FAILED, WORKFLOW_STATES.DONE);
        terminationReason = CORE_FAILURE_CODES.PLANNER_FAILED;
        userVisiblePlan = 'Planner failed to produce a valid implementation plan.';
        parsedPlan = { goal: task.title || task.id, riskTier: 'medium', acceptanceCriteria: [], filesToModify: resolvePlanFilesToModify(task, options) };
        perRoleTelemetry.coder = { status: 'skipped' };
        perRoleTelemetry.tester = {
          executionType: 'deterministic_verification',
          isModelCall: false,
          model: null,
          reasoningEffort: null,
          requestedModel: null,
          actualModel: null,
          requestedReasoningEffort: null,
          actualReasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'skipped',
          testsPassed: 0,
          testsTotal: 0
        };
        perRoleTelemetry.critic = {
          executionType: 'rule_based_critic',
          isModelCall: false,
          model: null,
          reasoningEffort: null,
          requestedModel: null,
          actualModel: null,
          requestedReasoningEffort: null,
          actualReasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'skipped',
          passed: false,
          concerns: Object.freeze(['Planner failed to produce a valid implementation plan.'])
        };
      } else {
        parsedPlan = parsePlannerOutput(plannerResult.textResult);
      }
    }

    if (!options.approvedPlanSnapshot && !plannerAbort && !terminationReason) {
      // =========================================================================
      // STAGE 2: PLAN_VALIDATION (HybridCoreBrain + ModelAllocator)
      // =========================================================================
      const planRequirements = this.coreBrain.analyzePlanSync(parsedPlan);

      if (isFixedStrong) {
        // Mode B: Strict strong-model allocation for all roles
        planAllocations = {
          taskId: task.id,
          providerId: this.provider,
          status: 'allocated',
          allocations: {
            planner: plannerConfig,
            coder: { status: 'allocated', providerId: this.provider, model: strongModel, reasoningEffort: 'low' },
            tester: { status: 'allocated', providerId: this.provider, model: strongModel, reasoningEffort: 'low' },
            critic: { status: 'allocated', providerId: this.provider, model: strongModel, reasoningEffort: 'low' }
          }
        };
      } else {
        // Mode C: Adaptive per-role model allocation (subject to runtime model switching toggle)
        planAllocations = this.allocator.allocatePlan(planRequirements, catalog, usage, {
          ...options,
          task,
          taskCategory: task.category || 'general',
          environment: runEnvironment,
          historyStore: this.historyStore,
          modelSwitchingEnabled: isSwitchingEnabled,
          selectedModel,
          providerModel
        });

        // Tester and Critic are deterministic workflow stages, not Adapter
        // roles. Do not expose the Provider model as an assignment for them.
        if (planAllocations && planAllocations.allocations) {
          planAllocations.allocations.tester = {
            status: 'deterministic',
            executionType: 'deterministic_verification',
            isModelCall: false,
            providerId: null,
            model: null,
            requestedModel: null,
            reasoningEffort: null,
            reason: 'deterministic_verification_rule_based_no_llm'
          };
          planAllocations.allocations.critic = {
            status: 'deterministic',
            executionType: 'rule_based_critic',
            isModelCall: false,
            providerId: null,
            model: null,
            requestedModel: null,
            reasoningEffort: null,
            reason: 'rule_based_critic_deterministic_no_llm'
          };
        }
      }

      const allocatedCoder = planAllocations && planAllocations.allocations && planAllocations.allocations.coder;
      coderConfig = allocatedCoder;
      needsFallback = (!coderConfig
        || coderConfig.status === 'unavailable'
        || coderConfig.status === 'insufficient_capability'
        || (!coderConfig.model && coderConfig.reason !== 'provider_default_model'));

      fallbackPermitted = true;
      fallbackFailureReason = (allocatedCoder && (allocatedCoder.failureIdentifier || allocatedCoder.reason || allocatedCoder.status)) || 'unresolved_allocation';
      coderStopMessage = null;

      if (needsFallback) {
        if (!isSwitchingEnabled) {
          // When switching is OFF: do NOT silently switch models! Stop safely.
          fallbackPermitted = false;
          fallbackFailureReason = (allocatedCoder && (allocatedCoder.failureIdentifier || allocatedCoder.reason)) || FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED;
          coderStopMessage = `Execution stopped:\nSelected model unavailable because provider quota is exhausted.\nModel switching: OFF.\nNo fallback was attempted.`;
        } else if (usage && usage.ordinaryUsageAllowed === false) {
          fallbackPermitted = false;
          fallbackFailureReason = FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED;
          coderStopMessage = 'Execution stopped:\nProvider usage quota is exhausted for all models.\nNo fallback was attempted.';
        } else {
          // Switching is ON: resolve compliant fallback model satisfying Safety Floor
          const coderReq = planRequirements && planRequirements.coder;
          const reqTier = coderReq ? coderReq.capability : 'lightweight';
          const floorTier = (task && (task.riskTier === 'high' || task.category === 'HIGH' || task.securitySensitive)) ? 'strong' : 'lightweight';
          const fallback = resolveQuotaFallback({
            failedModel: allocatedCoder?.model || null,
            requiredTier: reqTier,
            safetyFloorTier: floorTier,
            catalog,
            usage,
            profiles: this.allocator ? this.allocator.profiles : null,
            options
          });

          if (fallback.fallbackFound) {
            coderConfig = {
              status: 'fallback',
              providerId: this.provider,
              model: fallback.fallbackModel,
              reasoningEffort: 'low',
              originallyResolvedModel: fallback.originallyResolvedModel,
              fallbackModel: fallback.fallbackModel,
              fallbackReason: (allocatedCoder && allocatedCoder.reason) || 'quota_fallback',
              rejectionReason: fallback.rejectionReason,
              safetyFloorDecision: fallback.safetyFloorDecision,
              fallbackApplied: true
            };
            fallbackPermitted = true;
          } else {
            fallbackPermitted = false;
            fallbackFailureReason = fallback.failureIdentifier || FAILURE_IDENTIFIERS.NO_USABLE_MODEL_AVAILABLE;
            coderStopMessage = 'Execution stopped: No usable model satisfies safety floor and provider quota.';
          }
        }
      }

      // Build pre-execution Agent Execution Plan display for user visibility
      const recommendationEntry = Array.isArray(catalog.models)
        ? catalog.models.find(model => model && model.id === strongModel)
        : null;
      const modelRecommendation = recommendationEntry ? Object.freeze({
        providerId: this.provider,
        model: strongModel,
        advisory: true,
        availability: 'not_verified'
      }) : null;
      parsedPlan.modelRecommendation = modelRecommendation;
      agentExecutionPlan = buildAgentExecutionPlan({
        planAllocations,
        plannerConfig,
        coderConfig,
        strongModel,
        providerModel,
        modelSwitchingEnabled: isSwitchingEnabled,
        catalog,
        profiles: this.allocator ? this.allocator.profiles : null
      });

      // Resolve active project languages
      activeLanguages = null;
      try {
        activeLanguages = options.languages || (typeof getProjectLanguages === 'function' ? getProjectLanguages(options) : null);
      } catch {}

      userVisiblePlan = renderUserPlan(parsedPlan, { agentExecutionPlan, languages: activeLanguages });
      parsedPlan.agentExecutionPlan = agentExecutionPlan;
      parsedPlan.userVisiblePlan = userVisiblePlan;
    }

    if (!plannerAbort && !terminationReason) {
      if (needsFallback && !fallbackPermitted) {
        stateTransitions.push(WORKFLOW_STATES.FAILED);
        stateTransitions.push(WORKFLOW_STATES.DONE);

        perRoleTelemetry.coder = {
          executionType: 'model_call',
          isModelCall: true,
          model: coderConfig?.model || null,
          reasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'unavailable',
          timedOut: false,
          fallbackApplied: false,
          fallbackReason: fallbackFailureReason
        };

        perRoleTelemetry.tester = {
          executionType: 'deterministic_verification',
          isModelCall: false,
          model: null,
          reasoningEffort: null,
          requestedModel: null,
          actualModel: null,
          requestedReasoningEffort: null,
          actualReasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'skipped',
          testsPassed: 0,
          testsTotal: 0
        };

        perRoleTelemetry.critic = {
          executionType: 'rule_based_critic',
          isModelCall: false,
          model: null,
          reasoningEffort: null,
          requestedModel: null,
          actualModel: null,
          requestedReasoningEffort: null,
          actualReasoningEffort: null,
          durationMs: 0,
          tokens: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          status: 'skipped',
          passed: false,
          concerns: Object.freeze([coderStopMessage || `Execution aborted: no permitted model available (${fallbackFailureReason})`])
        };

        criticEvidence = { passed: false, concerns: [coderStopMessage || `No usable model available: ${fallbackFailureReason}`] };
        terminationReason = fallbackFailureReason;
      } else {
        // =========================================================================
        // PRE-EXECUTION APPROVAL GATE (Universal V1 Mandatory Invariant)
        // =========================================================================
        stateTransitions.push(WORKFLOW_STATES.PLANNED);
        stateTransitions.push(WORKFLOW_STATES.AWAITING_APPROVAL);

        // Persist user-visible plan metadata safely in task directory inside sandbox (safe Core task/sandbox location)
        const taskPlanDir = path.join(sandboxDir, '.agents', 'tasks', task.id);
        try {
          fs.mkdirSync(taskPlanDir, { recursive: true });
          fs.writeFileSync(path.join(taskPlanDir, 'implementation_plan.md'), userVisiblePlan, 'utf8');
        } catch {}

        // Capture immutable execution plan snapshot
        if (!approvedPlanSnapshot) {
          approvedPlanSnapshot = Object.freeze({
            taskId: task.id,
            task: Object.freeze({ ...task }),
            goal: parsedPlan.goal,
            riskTier: parsedPlan.riskTier,
            affectedLayers: Array.isArray(parsedPlan.affectedLayers) ? Object.freeze([...parsedPlan.affectedLayers]) : Object.freeze([]),
            filesToModify: Array.isArray(parsedPlan.filesToModify) ? Object.freeze([...parsedPlan.filesToModify]) : Object.freeze([]),
            acceptanceCriteria: Array.isArray(parsedPlan.acceptanceCriteria) ? Object.freeze([...parsedPlan.acceptanceCriteria]) : Object.freeze([]),
            verificationContract: parsedPlan.verificationContract || null,
            plan: parsedPlan,
            userVisiblePlan,
            agentExecutionPlan,
            allocations: planAllocations ? planAllocations.allocations : null,
            coderConfig: Object.freeze({ ...coderConfig }),
            plannerConfig: Object.freeze({ ...plannerConfig }),
            providerModel: coderConfig && coderConfig.model ? coderConfig.model : null,
            runtimeSnapshot: Object.freeze({
              modelSwitchingEnabled: isSwitchingEnabled,
              selectedModel: isSwitchingEnabled ? selectedModel : null,
              providerModel: coderConfig && coderConfig.model ? coderConfig.model : null,
              languages: Array.isArray(activeLanguages) ? Object.freeze([...activeLanguages]) : null,
              coderModel: coderConfig ? coderConfig.model : null,
              plannerModel: plannerConfig ? plannerConfig.model : null
            })
          });
        }

        // Resolve user approval decision
        let rawDecision = options.approvalDecision;
        if (rawDecision === undefined && typeof options.onPlanApproval === 'function') {
          try {
            rawDecision = options.onPlanApproval(approvedPlanSnapshot);
          } catch {
            rawDecision = null;
          }
        }

        const isAutomatedHarness = Boolean(hasNonProdTaskId && !options.requirePlanApproval && !options.approvalRequired);
        if (rawDecision === undefined && isAutomatedHarness) {
          rawDecision = APPROVAL_DECISIONS.APPROVE;
        }

        normalizedDecision = normalizeApprovalDecision(rawDecision);

        if (!normalizedDecision) {
          terminationReason = 'AWAITING_APPROVAL';

          perRoleTelemetry.coder = {
            executionType: 'model_call',
            isModelCall: true,
            model: coderConfig?.model || null,
            reasoningEffort: null,
            durationMs: 0,
            tokens: null,
            inputTokens: null,
            outputTokens: null,
            cost: null,
            status: 'awaiting_approval',
            timedOut: false
          };

          perRoleTelemetry.tester = {
            executionType: 'deterministic_verification',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            testsPassed: 0,
            testsTotal: 0
          };

          perRoleTelemetry.critic = {
            executionType: 'rule_based_critic',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            passed: false,
            concerns: Object.freeze(['Execution paused awaiting user plan approval'])
          };

          criticEvidence = { passed: false, concerns: ['Execution paused awaiting user plan approval'] };
        } else if (normalizedDecision === APPROVAL_DECISIONS.REJECT) {
          stateTransitions.push(WORKFLOW_STATES.REJECTED);
          stateTransitions.push(WORKFLOW_STATES.DONE);
          terminationReason = 'PLAN_REJECTED';

          perRoleTelemetry.coder = {
            executionType: 'model_call',
            isModelCall: true,
            model: coderConfig?.model || null,
            reasoningEffort: null,
            durationMs: 0,
            tokens: null,
            inputTokens: null,
            outputTokens: null,
            cost: null,
            status: 'rejected',
            timedOut: false
          };

          perRoleTelemetry.tester = {
            executionType: 'deterministic_verification',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            testsPassed: 0,
            testsTotal: 0
          };

          perRoleTelemetry.critic = {
            executionType: 'rule_based_critic',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            passed: false,
            concerns: Object.freeze(['Plan rejected by user'])
          };

          criticEvidence = { passed: false, concerns: ['Plan rejected by user'] };
        } else if (normalizedDecision === APPROVAL_DECISIONS.CANCEL) {
          stateTransitions.push(WORKFLOW_STATES.CANCELLED);
          stateTransitions.push(WORKFLOW_STATES.DONE);
          terminationReason = 'TASK_CANCELLED';

          perRoleTelemetry.coder = {
            executionType: 'model_call',
            isModelCall: true,
            model: coderConfig?.model || null,
            reasoningEffort: null,
            durationMs: 0,
            tokens: null,
            inputTokens: null,
            outputTokens: null,
            cost: null,
            status: 'cancelled',
            timedOut: false
          };

          perRoleTelemetry.tester = {
            executionType: 'deterministic_verification',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            testsPassed: 0,
            testsTotal: 0
          };

          perRoleTelemetry.critic = {
            executionType: 'rule_based_critic',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            passed: false,
            concerns: Object.freeze(['Task cancelled by user'])
          };

          criticEvidence = { passed: false, concerns: ['Task cancelled by user'] };
        } else if (normalizedDecision === APPROVAL_DECISIONS.APPROVE) {
          // Check if runtime configuration changed between planning and approval (Requirement 8, Test G)
          const currentSwitching = isModelSwitchingEnabled(options);
          let currentLanguages = null;
          try {
            currentLanguages = options.languages || (typeof getProjectLanguages === 'function' ? getProjectLanguages(options) : null);
          } catch {}
          const activeSnapshot = options.approvedPlanSnapshot || approvedPlanSnapshot;
          const currentSelectedModel = currentSwitching
            ? null
            : (options.providerModel !== undefined
              ? options.providerModel
              : (activeSnapshot.runtimeSnapshot?.providerModel ?? activeSnapshot.providerModel ?? activeSnapshot.coderConfig?.model ?? null));

          const languagesChanged = JSON.stringify(currentLanguages || []) !== JSON.stringify(activeSnapshot.runtimeSnapshot?.languages || []);
          const switchingChanged = currentSwitching !== activeSnapshot.runtimeSnapshot?.modelSwitchingEnabled;
          const modelChanged = currentSelectedModel !== (activeSnapshot.runtimeSnapshot?.providerModel ?? null);

          if (switchingChanged || languagesChanged || modelChanged) {
            stateTransitions.push(WORKFLOW_STATES.FAILED);
            stateTransitions.push(WORKFLOW_STATES.DONE);
            terminationReason = 'STALE_PLAN_INVALIDATED';

            perRoleTelemetry.coder = {
              executionType: 'model_call',
              isModelCall: true,
              model: coderConfig?.model || null,
              reasoningEffort: null,
              durationMs: 0,
              tokens: null,
              status: 'stale_plan_invalidated',
              timedOut: false
            };
            perRoleTelemetry.tester = {
              executionType: 'deterministic_verification',
              isModelCall: false,
              model: null,
              reasoningEffort: null,
              requestedModel: null,
              actualModel: null,
              requestedReasoningEffort: null,
              actualReasoningEffort: null,
              durationMs: 0,
              tokens: null,
              status: 'skipped',
              testsPassed: 0,
              testsTotal: 0
            };
            perRoleTelemetry.critic = {
              executionType: 'rule_based_critic',
              isModelCall: false,
              model: null,
              reasoningEffort: null,
              requestedModel: null,
              actualModel: null,
              requestedReasoningEffort: null,
              actualReasoningEffort: null,
              durationMs: 0,
              tokens: null,
              status: 'skipped',
              passed: false,
              concerns: Object.freeze(['Runtime configuration changed after plan display: stale plan invalidated, re-approval required'])
            };
            criticEvidence = { passed: false, concerns: ['Runtime configuration changed after plan display: stale plan invalidated, re-approval required'] };
          } else {
            // Runtime settings are valid! Transition to APPROVED and EXECUTING
            stateTransitions.push(WORKFLOW_STATES.APPROVED);
            stateTransitions.push(WORKFLOW_STATES.EXECUTING);

            // Check authoritative safety conditions after approval (Requirement 4, Test H)
            const postApprovalAvail = coderConfig.model
              ? evaluateModelAvailability(coderConfig.model, catalog, usage, options)
              : { available: true };
            const quotaBlocked = (usage && usage.ordinaryUsageAllowed === false)
              || options.ordinaryUsageAllowed === false
              || !postApprovalAvail.available;

            if (quotaBlocked) {
              stateTransitions.push(WORKFLOW_STATES.FAILED);
              stateTransitions.push(WORKFLOW_STATES.DONE);
              terminationReason = 'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED';

              perRoleTelemetry.coder = {
                executionType: 'model_call',
                isModelCall: true,
                model: coderConfig?.model || null,
                reasoningEffort: null,
                durationMs: 0,
                tokens: null,
                status: 'reapproval_required',
                timedOut: false
              };
              perRoleTelemetry.tester = {
                executionType: 'deterministic_verification',
                isModelCall: false,
                model: null,
                reasoningEffort: null,
                requestedModel: null,
                actualModel: null,
                requestedReasoningEffort: null,
                actualReasoningEffort: null,
                durationMs: 0,
                tokens: null,
                status: 'skipped',
                testsPassed: 0,
                testsTotal: 0
              };
              perRoleTelemetry.critic = {
                executionType: 'rule_based_critic',
                isModelCall: false,
                model: null,
                reasoningEffort: null,
                requestedModel: null,
                actualModel: null,
                requestedReasoningEffort: null,
                actualReasoningEffort: null,
                durationMs: 0,
                tokens: null,
                status: 'skipped',
                passed: false,
                concerns: Object.freeze(['Authoritative runtime safety condition changed after approval: controlled re-approval required'])
              };
              criticEvidence = { passed: false, concerns: ['Authoritative runtime safety condition changed after approval: controlled re-approval required'] };
            } else {
              // ALL CHECKS PASSED: Proceed to Implementation!
              // STAGE 3: DIRECTED HANDOFF GENERATION
              handoff = this.buildHandoffPayload({ task, plan: activeSnapshot.plan || parsedPlan, coderConfig });
              const taskHandoffDir = path.join(sandboxDir, '.agents', 'tasks', task.id, 'handoffs');
              try {
                fs.mkdirSync(taskHandoffDir, { recursive: true });
                fs.writeFileSync(path.join(taskHandoffDir, 'planner-to-coder.json'), JSON.stringify(handoff, null, 2), 'utf8');
              } catch {}

              // STAGE 4: IMPLEMENTING (Coder) & PRE-CODER RELIABILITY GUARDS
              let accumulatedSessionTokens = (perRoleTelemetry.planner && perRoleTelemetry.planner.tokens) || 0;
      const coderContext = evaluateContextHealth({
        providerId: this.provider,
        model: coderConfig.model,
        sessionTokens: accumulatedSessionTokens,
        contextLimit: options.contextLimit,
        exactUsedPercent: options.contextUsedPercent,
        exactRemainingPercent: options.contextRemainingPercent,
        profile: (this.allocator && typeof this.allocator._findProfile === 'function') ? this.allocator._findProfile({ id: coderConfig.model }) : null,
        rawOutput: options.rawOutput,
        ...options
      });

      coderConfig.contextHealth = coderContext.health;
      coderConfig.contextMeasurement = coderContext.measurement;

      let coderAbort = false;
      if (coderContext.health === CONTEXT_HEALTH.CRITICAL) {
        const rolloverSupported = checkFreshSessionRolloverSupport(adapter);
        if (!rolloverSupported) {
          coderAbort = true;
          stateTransitions.push(WORKFLOW_STATES.FAILED);
          stateTransitions.push(WORKFLOW_STATES.DONE);
          terminationReason = FAILURE_IDENTIFIERS.CONTEXT_WINDOW_CRITICAL;

          perRoleTelemetry.coder = {
            executionType: 'model_call',
            isModelCall: true,
            model: coderConfig.model,
            reasoningEffort: coderConfig.reasoningEffort,
            durationMs: 0,
            tokens: null,
            inputTokens: null,
            outputTokens: null,
            cost: null,
            status: 'context_critical',
            contextHealth: 'CRITICAL',
            contextMeasurement: coderContext.measurement,
            timedOut: false,
            fallbackApplied: Boolean(coderConfig.fallbackApplied)
          };
          perRoleTelemetry.tester = {
            executionType: 'deterministic_verification',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            testsPassed: 0,
            testsTotal: 0
          };
          perRoleTelemetry.critic = {
            executionType: 'rule_based_critic',
            isModelCall: false,
            model: null,
            reasoningEffort: null,
            requestedModel: null,
            actualModel: null,
            requestedReasoningEffort: null,
            actualReasoningEffort: null,
            durationMs: 0,
            tokens: null,
            status: 'skipped',
            passed: false,
            concerns: Object.freeze([coderContext.warningMessage || 'Context capacity critical'])
          };
          criticEvidence = { passed: false, concerns: [coderContext.warningMessage || 'Context capacity critical'] };
        }
      }

      if (!coderAbort) {
        stateTransitions.push(WORKFLOW_STATES.IMPLEMENTING);
        const coderPrompt = this.buildCoderPrompt({
          task,
          mode,
          handoff,
          approvedPlanSnapshot,
          executionContext: ENGINE_MANAGED_CODER_CONTEXT,
          structuredArtifactDelivery: structuredCoderExecution
        });
        const targetFiles = this._resolveTargetFiles({ task, handoff, approvedPlanSnapshot });
        if (checkpointStore && checkpointHash(targetFiles) !== checkpointHash(snapshot.filesToModify)) {
          throw new Error('Managed checkpoint execution scope differs from the approved Plan.');
        }
        const artifactBaseline = isBenchRun ? null : captureProjectFileState(sandboxDir, targetFiles);
        if (diagnosticMode) {
          try {
            diagnosticExecutionMarker = consumeDiagnosticAuthorization(options.diagnosticAuthorization);
          } catch (error) {
            const blocked = new Error(`Diagnostic authorization was not consumed; Adapter execution is blocked: ${error.message}`);
            blocked.code = error.code || 'DIAGNOSTIC_AUTHORIZATION_INVALID';
            throw blocked;
          }
        }
        let coderResult = this._executeRole('coder', coderConfig, coderPrompt, sandboxDir, {
          ...options,
          providerCallBudget,
          approvedPlanSnapshot,
          structuredArtifactDelivery: structuredCoderExecution
        });
        totalModelCalls++;
        if (checkpointStore && coderResult.status !== 'success') {
          return { status: 'FAILED', failureCode: 'CODER_EXECUTION_FAILED', retryable: false };
        }
        accumulatedSessionTokens += (coderResult.tokens || 0);
        perRoleTelemetry.coder = {
          executionType: 'model_call',
          isModelCall: true,
          model: coderConfig.model,
          reasoningEffort: coderConfig.reasoningEffort,
          requestedModel: coderConfig ? (coderConfig.model ?? null) : null,
          actualModel: (coderResult && coderResult.actualModel) || null,
          requestedReasoningEffort: coderConfig ? (coderConfig.reasoningEffort ?? null) : null,
          actualReasoningEffort: (coderResult && coderResult.actualReasoningEffort) || null,
          durationMs: coderResult.durationMs,
          tokens: coderResult.tokens,
          inputTokens: coderResult.inputTokens || null,
          outputTokens: coderResult.outputTokens || null,
          cost: coderResult.cost || null,
          status: coderResult.status,
          timedOut: Boolean(coderResult.timedOut),
          exitCode: coderResult.exitCode ?? null,
          stderr: coderResult.stderr || '',
          errorMessage: coderResult.errorMessage || '',
          failureCategory: coderResult.failureCategory || null,
          providerExecutable: coderResult.providerExecutable || null,
          adapterCaptureDiagnostics: coderResult.adapterCaptureDiagnostics || null,
          textResultSource: coderResult.textResultSource || 'unknown',
          contextHealth: coderContext.health,
          contextMeasurement: coderContext.measurement,
          ...(coderContext.health === CONTEXT_HEALTH.WARNING ? { contextWarning: coderContext.warningMessage } : {}),
          ...(coderConfig.status === 'fallback' || coderConfig.fallbackApplied ? { fallbackApplied: true, fallbackReason: coderConfig.fallbackReason } : {})
        };

        if (diagnosticMode) {
          const compliance = evaluateDiagnosticModelCompliance({
            requestedModel: coderConfig.model,
            actualModel: perRoleTelemetry.coder.actualModel,
            provider: this.provider,
            role: 'coder',
            riskTier: approvedPlanSnapshot.riskTier,
            catalog,
            profiles: this.allocator ? this.allocator.profiles : {},
            usage
          });
          modelComplianceStatus = compliance.status;
          modelComplianceFailure = compliance.failure;
        }

      const hasImmediateTimeout = Boolean(coderResult.timedOut || coderResult.status === 'timeout');
      const hasProviderError = Boolean(coderResult.status === 'failed' || coderResult.ok === false || options.failCoder);

      // Extract implementation artifacts (single-file index.js for benchmark, multi-file for project)
      let artifactResult;
      if (isBenchRun) {
        artifactResult = extractAndWriteArtifact(coderResult.textResult, sandboxDir, 'index.js');
        if (artifactResult.success && artifactResult.filePath && fs.existsSync(artifactResult.filePath)) {
          codeContent = fs.readFileSync(artifactResult.filePath, 'utf8');
        } else {
          codeContent = coderResult.textResult;
        }
      } else {
        artifactResult = extractAndApplyProjectArtifacts(coderResult.textResult, sandboxDir, targetFiles, {
          baseline: artifactBaseline,
          baselineBackup: { taskId: task.id, attempt: 0 },
          ...(checkpointStore ? { includeManagedBackup: true } : {}),
          structuredArtifactDelivery: structuredCoderExecution,
          structuredArtifactResult: coderResult.structuredArtifactResult
        });
        codeContent = structuredCoderExecution
          ? (artifactResult.success ? artifactResult.codeContent : '')
          : (artifactResult.codeContent || coderResult.textResult);
        artifactFiles = artifactResult.artifactFiles;
        artifactDeliveryDiagnostics.push(buildArtifactDeliveryDiagnostic({
          taskId: task.id,
          attemptType: 'initial',
          attemptIndex: 0,
          coderResult,
          forwardedResultField: 'coderResult.textResult',
          textResult: coderResult.textResult,
          artifactResult
        }));
      }

      if (checkpointStore) {
        const scope = snapshot.filesToModify;
        const delivery = evaluateProjectArtifactDelivery(sandboxDir, { expectedFiles: scope, artifactResult });
        if (!delivery.required || !delivery.passed) {
          return { status: 'FAILED', failureCode: 'MANAGED_ARTIFACT_DELIVERY_FAILED', retryable: false };
        }
        const partial = {
          status: 'PARTIAL_IMPLEMENTATION', failureCode: 'MANAGED_CHECKPOINT_PERSISTENCE_FAILED',
          artifactsApplied: true, checkpointConfirmed: false, retryable: false,
          message: 'Implementation applied. Checkpoint durability could not be confirmed.'
        };
        try {
          const { randomUUID } = require('node:crypto');
          const { readApprovedFileState } = require('./verification_contract');
          const workspacePath = fs.realpathSync(sandboxDir);
          const approvedFileDigest = checkpointHash(scope.map(file => {
            const state = readApprovedFileState(workspacePath, file);
            if (!state.ok) throw new Error('Approved file evidence unavailable.');
            return { file, ...state };
          }));
          const backup = artifactResult.managedBackup;
          const deliveryDigest = checkpointHash({ delivery, approvedFileDigest });
          const checkpointId = randomUUID();
          const createdAt = Date.now();
          const result = checkpointStore.createCheckpoint({
            ...checkpointInput, checkpointId, workspacePath, approvedFileDigest,
            backup: { path: backup.backupPath, manifestDigest: backup.manifestDigest },
            artifacts: { files: scope, deliveryDigest },
            executionEvidence: {
              providerId: 'codex',
              executionDigest: checkpointHash({ checkpointId, deliveryDigest, approval: checkpointInput.executionApproval })
            },
            providerEvidence: { providerId: 'codex', calls: totalModelCalls, actualModel: coderResult.actualModel ?? null },
            challenge: { id: randomUUID(), createdAt, expiresAt: createdAt + 5 * 60 * 1000 },
            budget: { maxProviderCalls: 0, maxRecoveryAttempts: 0 }
          });
          if (!result.ok) return { ...partial, checkpointReason: result.reason };
          return {
            status: 'AWAITING_VERIFICATION_APPROVAL', checkpoint: result.checkpoint, artifactsApplied: true,
            message: 'Implementation applied and checkpoint persisted. Separate verification approval is required.'
          };
        } catch {
          return partial;
        }
      }

        // =========================================================================
        // STAGES 5 & 6: TESTING, CRITIQUE & RECOVERY LOOP
        // =========================================================================
        for (let attempt = 0; attempt <= maxRecoveryAttempts; attempt++) {
        // 5. Tester Verification
        stateTransitions.push(WORKFLOW_STATES.TESTING);
        const artifactDeliveryEvidence = isBenchRun
          ? null
          : evaluateProjectArtifactDelivery(sandboxDir, { expectedFiles: targetFiles, artifactResult });
        try {
          verificationEvidence = verifierFn(task.id, sandboxDir, isBenchRun ? undefined : {
            expectedFiles: targetFiles,
            artifactResult,
            artifactDeliveryEvidence,
            ...(approvedPlanSnapshot && approvedPlanSnapshot.verificationContract
              ? { verificationContract: approvedPlanSnapshot.verificationContract }
              : {})
          });
        } catch (err) {
          verificationEvidence = {
            testsPassed: 0,
            testsTotal: 1,
            isInfrastructureError: true,
            failureType: 'infrastructure_error',
            fatalViolation: err.message
          };
        }
        if (!isBenchRun) {
          verificationEvidence = mergeArtifactDeliveryEvidence(verificationEvidence, artifactDeliveryEvidence);
        }

        const normalized = normalizeVerificationEvidence(verificationEvidence);
        verificationEvidence.testsPassed = normalized.testsPassed;
        verificationEvidence.testsTotal = normalized.testsTotal;
        verificationEvidence.fatalViolation = normalized.fatalViolation;
        verificationEvidence.securityViolations = normalized.securityViolations;

        if (Array.isArray(normalized.securityViolations)) {
          for (const v of normalized.securityViolations) allSecurityViolations.add(v);
        }
        if (normalized.fatalViolation) {
          allSecurityViolations.add(normalized.fatalViolation);
        }

        // 6. Senior Critic Gate Audit
        stateTransitions.push(WORKFLOW_STATES.REVIEW);
        try {
          criticEvidence = criticFn({
            code: codeContent,
            artifactFiles,
            plan: parsedPlan,
            task,
            verificationEvidence: normalized
          });
        } catch (criticErr) {
          criticEvidence = { passed: false, concerns: [`Critic evaluation failed: ${criticErr.message}`] };
        }

        // Normalize Critic output safely
        if (!criticEvidence || typeof criticEvidence !== 'object') {
          criticEvidence = { passed: false, concerns: ['Missing or malformed Critic output'] };
        } else {
          const passedBool = (criticEvidence.passed === true);
          const concernsArr = Array.isArray(criticEvidence.concerns)
            ? [...criticEvidence.concerns]
            : (criticEvidence.concerns ? [String(criticEvidence.concerns)] : []);
          if (!passedBool && concernsArr.length === 0) {
            concernsArr.push('Critic rejected artifact without specific concerns');
          }
          criticEvidence = {
            passed: passedBool,
            concerns: concernsArr,
            ...(criticEvidence.syntaxValidation && typeof criticEvidence.syntaxValidation === 'object'
              ? { syntaxValidation: { ...criticEvidence.syntaxValidation } }
              : {})
          };
        }

        // CRITICAL INVARIANT: Critic decisions respect deterministic verifier results and never override fatal safety violations
        if ((normalized.fatalViolation || normalized.securityViolations.length > 0) && criticEvidence.passed) {
          criticEvidence.passed = false;
          criticEvidence.concerns.push(`Critic pass overridden by deterministic verifier fatal violation: ${normalized.fatalViolation || normalized.securityViolations.join('; ')}`);
        }

        if (semanticPolicy && semanticPolicy.requested === true && normalized.isClean && criticEvidence.passed) {
          const callCountBeforeSemanticReview = providerCallBudget ? providerCallBudget.reserved : null;
          const scopeEvidence = [];
          for (const file of targetFiles) {
            try {
              const fullPath = path.resolve(sandboxDir, file);
              const relative = path.relative(path.resolve(sandboxDir), fullPath);
              if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
              const content = fs.readFileSync(fullPath, 'utf8');
              scopeEvidence.push({ id: `file:${file}`, type: 'approved_scope_file', path: file,
                content: content.slice(0, 20000), truncated: content.length > 20000 });
            } catch { scopeEvidence.push({ id: `file:${file}`, type: 'approved_scope_file', path: file, unavailable: true }); }
          }
          semanticCriticEvidence = performSemanticCriticReview({
            policy: semanticPolicy,
            adapter: options.semanticCriticAdapter || this.adapter,
            providerCallBudget,
            cwd: sandboxDir,
            unverifiedCoderClaim: coderResult && coderResult.textResult,
            acceptanceCriteria: approvedPlanSnapshot.acceptanceCriteria || parsedPlan.acceptanceCriteria || [],
            evidence: [
              ...normalized.checks.map((check, index) => ({ id: `tester:${index}`, type: 'tester_check', name: check.name,
                status: check.status, summary: String(check.message || check.error || '').slice(0, 500) })),
              ...scopeEvidence,
              { id: 'deterministic-critic', type: 'deterministic_critic', passed: criticEvidence.passed,
                concerns: criticEvidence.concerns }
            ]
          });
          if (providerCallBudget && providerCallBudget.reserved > callCountBeforeSemanticReview) {
            totalModelCalls++;
            perRoleTelemetry.semanticCritic = {
              executionType: 'model_call', isModelCall: true, role: 'critic', status: semanticCriticEvidence.provenance,
              model: semanticCriticEvidence.actualModel || semanticPolicy.allocation.model,
              requestedModel: semanticPolicy.allocation.model,
              actualModel: semanticCriticEvidence.actualModel || null,
              tokens: semanticCriticEvidence.tokens ?? null, cost: semanticCriticEvidence.cost ?? null,
              durationMs: null, errorMessage: semanticCriticEvidence.reason || null
            };
          }
        } else if (semanticPolicy && semanticPolicy.requested === true) {
          semanticCriticEvidence = { status: 'UNREVIEWED', reason: 'technical_gate_not_passed', criteria: [], provenance: 'not_executed' };
        }
        leaderDecision = decideSemanticLeaderOutcome({
          technicalSuccess: normalized.isClean && criticEvidence.passed,
          semanticRequested: Boolean(semanticPolicy && semanticPolicy.requested === true),
          semanticReview: semanticCriticEvidence,
          testerPassed: normalized.isClean,
          deterministicCriticPassed: criticEvidence.passed
        });

        if (attempt === 0) {
          initialVerificationEvidence = { ...normalized };
          initialCriticEvidence = { ...criticEvidence };
          initialSemanticCriticEvidence = { ...semanticCriticEvidence };
          initialLeaderDecision = leaderDecision ? { ...leaderDecision } : null;
        }

        recoveryHistory.push({
          attempt,
          phase: attempt === 0 ? 'initial' : `recovery_${attempt}`,
          passed: Boolean(normalized.isClean && criticEvidence.passed && leaderDecision && leaderDecision.success),
          testsPassed: normalized.testsPassed,
          testsTotal: normalized.testsTotal,
          fatalViolation: normalized.fatalViolation,
          isInfrastructureError: normalized.isInfrastructureError,
          skippedChecks: [...normalized.skippedChecks],
          failures: [...normalized.failures],
          securityViolations: [...normalized.securityViolations],
          criticPassed: criticEvidence.passed,
          semanticReviewStatus: semanticCriticEvidence.status,
          semanticReview: semanticCriticEvidence,
          leaderDecision,
          criticConcerns: [...criticEvidence.concerns],
          ...(criticEvidence.syntaxValidation ? { syntaxValidation: { ...criticEvidence.syntaxValidation } } : {}),
          codeLength: typeof codeContent === 'string' ? codeContent.length : 0
        });

        // Immediate timeout in primary coder is unrecoverable: do not enter recovery
        if (hasImmediateTimeout) {
          stateTransitions.push(WORKFLOW_STATES.FAILED);
          terminationReason = 'UNRECOVERABLE_TIMEOUT';
          break;
        }

        if (hasProviderError) {
          stateTransitions.push(WORKFLOW_STATES.FAILED);
          terminationReason = 'PROVIDER_EXECUTION_FAILED';
          break;
        }

        if (diagnosticMode && modelComplianceStatus === 'FAILED') {
          passedAll = false;
          stateTransitions.push(WORKFLOW_STATES.FAILED);
          terminationReason = 'MODEL_COMPLIANCE_FAILED';
          break;
        }

        // Infrastructure Error Guard: Verifier crashes, unknown task IDs, or toolchain missing
        // are system/infrastructure defects, NOT code errors. Fail-closed immediately.
        const isInfrastructureError = Boolean(
          verificationEvidence && (
            verificationEvidence.isInfrastructureError ||
            verificationEvidence.failureType === 'infrastructure_error' ||
            (normalized.fatalViolation && (
              normalized.fatalViolation.includes('Unknown task ID') ||
              normalized.fatalViolation.includes('SPAWN_FAILURE') ||
              normalized.fatalViolation.includes('CORRUPTED_VERIFIER_OUTPUT') ||
              normalized.fatalViolation.includes('PREMATURE_PROCESS_EXIT') ||
              normalized.fatalViolation.includes('infrastructure_error') ||
              normalized.fatalViolation.includes('VERIFIER_INFRASTRUCTURE_FAILURE')
            ))
          )
        );

        if (isInfrastructureError) {
          stateTransitions.push(WORKFLOW_STATES.FAILED);
          terminationReason = 'VERIFIER_INFRASTRUCTURE_FAILURE';
          break;
        }

        // Both deterministic verification and Critic must pass for final success.
        if (normalized.isClean && criticEvidence.passed && leaderDecision && leaderDecision.success) {
          passedAll = true;
          terminationReason = 'VERIFIED';
          stateTransitions.push(WORKFLOW_STATES.DONE);
          break;
        }

        const isCriticTriggered = Boolean(normalized.isClean && (!criticEvidence.passed || semanticCriticEvidence.status === 'FAILED'));
        passedAll = false;

        stateTransitions.push(WORKFLOW_STATES.FAILED);

        if (normalized.isClean && criticEvidence.passed && semanticPolicy && semanticPolicy.requested === true) {
          if (semanticCriticEvidence.status === 'UNREVIEWED') {
            terminationReason = semanticCriticEvidence.reason || 'SEMANTIC_REVIEW_UNREVIEWED';
            break;
          }
          const semanticRecovery = decideSemanticRecovery({
            status: semanticCriticEvidence.status,
            findings: (semanticCriticEvidence.criteria || []).map(item => ({
              status: item.status,
              grounded: Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0,
              coderCorrectable: item.coderCorrectable === true
            }))
          });
          if (!semanticRecovery.recover) {
            terminationReason = 'SEMANTIC_REVIEW_FAILED_NOT_RECOVERABLE';
            break;
          }
        }

        // Recover only coder-correctable verifier or Critic failures; infrastructure errors exited above.
        if (attempt < maxRecoveryAttempts) {
          stateTransitions.push(WORKFLOW_STATES.DIAGNOSING);

          const diagnostics = [
            normalized.fatalViolation ? `Fatal violation: ${normalized.fatalViolation}` : null,
            normalized.failures.length > 0 ? `Test & validation failures:\n${normalized.failures.map(f => `- ${f}`).join('\n')}` : null,
            !criticEvidence.passed ? `Critic concerns:\n${criticEvidence.concerns.map(c => `- ${c}`).join('\n')}` : null,
            semanticCriticEvidence.status === 'FAILED'
              ? `Semantic Critic findings:\n${semanticCriticEvidence.criteria.filter(item => item.status === 'FAILED').map(item => `- Criterion ${item.index + 1}: ${item.criterion}; evidence: ${item.evidenceRefs.join(', ')}`).join('\n')}`
              : null
          ].filter(Boolean).join('\n\n');

          // Detect repeated identical failure / recovery stagnation
          const currentCode = typeof codeContent === 'string' ? codeContent.trim() : '';
          if (attempt > 0 && currentCode === previousCodeHash && diagnostics === previousDiagnostics) {
            terminationReason = 'RECOVERY_STAGNATION';
            break;
          }
          previousCodeHash = currentCode;
          previousDiagnostics = diagnostics;

          stateTransitions.push(WORKFLOW_STATES.FIXING);
          recoveryUsage = true;
          recoveryAttempts++;

          const recoveryPrompt = isBenchRun
            ? `[CORE GOVERNANCE PROTOCOL ACTIVE]
Role: Coder (Recovery Mode)
Task: ${task.title || task.id || 'Implementation Task'}
Recovery Attempt: ${recoveryAttempts}/${maxRecoveryAttempts}

The previous implementation failed quality verification:
Diagnostics:
${diagnostics}

Delivery Requirement: Write the complete corrected implementation directly to index.js in the current working directory.`
            : structuredCoderExecution
              ? `[CORE GOVERNANCE PROTOCOL ACTIVE]
Role: Coder (Recovery Mode — Structured Codex Delivery)
Task: ${task.title || task.id || 'Implementation Task'}
Recovery Attempt: ${recoveryAttempts}/${maxRecoveryAttempts}

The previous implementation failed quality verification:
Diagnostics:
${diagnostics}

Structured Artifact Delivery (mandatory): Return exactly one JSON object matching the supplied output schema, with one \`files\` entry for every approved file. Each entry must use its exact approved relative path and contain the complete corrected file content. Approved files:
${targetFiles.map((file) => `- ${file}`).join('\n')}
Do not write or modify workspace files directly. Do not use Markdown fences or add text outside the JSON object. The Engine validates the complete artifact set against the approved scope before applying it.`
              : `[CORE GOVERNANCE PROTOCOL ACTIVE]
Role: Coder (Recovery Mode)
Task: ${task.title || task.id || 'Implementation Task'}
Recovery Attempt: ${recoveryAttempts}/${maxRecoveryAttempts}

The previous implementation failed quality verification:
Diagnostics:
${diagnostics}

Delivery Requirement: Correct the implementation directly in the workspace files: ${targetFiles.length > 0 ? targetFiles.join(', ') : 'workspace source files'}.`;

          // Recovery escalation: if initial coder executed with an economical/non-strong model,
          // escalate recovery to the provider's strong model baseline (only when switching is enabled)
          // Recovery escalation: if initial coder executed with an economical/non-strong model,
          // escalate recovery to the provider's strong model baseline (only when switching is enabled)
          const isModelEscalated = isSwitchingEnabled && Boolean(coderConfig && coderConfig.model && coderConfig.model !== strongModel);
          let recoveryConfig = isModelEscalated
            ? {
                ...coderConfig,
                model: strongModel,
                reasoningEffort: 'low',
                escalatedFrom: coderConfig.model
              }
            : { ...coderConfig };

          // 1. Quota & Availability Safety Guard before recovery execution
          const recModelAvail = recoveryConfig.model
            ? evaluateModelAvailability(recoveryConfig.model, catalog, usage, options)
            : { available: true };

          if (!recModelAvail.available) {
            if (!isSwitchingEnabled) {
              terminationReason = recModelAvail.failureIdentifier || FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED;
              stateTransitions.push(WORKFLOW_STATES.FAILED);
              break;
            } else {
              const recFallback = resolveQuotaFallback({
                failedModel: recoveryConfig.model,
                requiredTier: 'strong',
                safetyFloorTier: 'strong',
                catalog,
                usage,
                profiles: this.allocator ? this.allocator.profiles : null,
                options
              });
              if (recFallback.fallbackFound) {
                recoveryConfig = {
                  ...recoveryConfig,
                  model: recFallback.fallbackModel,
                  originallyResolvedModel: recFallback.originallyResolvedModel,
                  fallbackModel: recFallback.fallbackModel,
                  fallbackReason: 'quota_fallback',
                  rejectionReason: recFallback.rejectionReason,
                  safetyFloorDecision: recFallback.safetyFloorDecision,
                  fallbackApplied: true
                };
              } else {
                terminationReason = recFallback.failureIdentifier || FAILURE_IDENTIFIERS.NO_USABLE_MODEL_AVAILABLE;
                stateTransitions.push(WORKFLOW_STATES.FAILED);
                break;
              }
            }
          }

          // 2. Context Window Safety Guard before recovery execution
          const recoveryContext = evaluateContextHealth({
            providerId: this.provider,
            model: recoveryConfig.model,
            sessionTokens: accumulatedSessionTokens,
            contextLimit: options.contextLimit,
            exactUsedPercent: options.contextUsedPercent,
            exactRemainingPercent: options.contextRemainingPercent,
            profile: (this.allocator && typeof this.allocator._findProfile === 'function') ? this.allocator._findProfile({ id: recoveryConfig.model }) : null,
            rawOutput: options.rawOutput,
            ...options
          });

          recoveryConfig.contextHealth = recoveryContext.health;
          recoveryConfig.contextMeasurement = recoveryContext.measurement;

          if (recoveryContext.health === CONTEXT_HEALTH.CRITICAL) {
            const rolloverSupported = checkFreshSessionRolloverSupport(adapter);
            if (!rolloverSupported) {
              terminationReason = FAILURE_IDENTIFIERS.CONTEXT_WINDOW_CRITICAL;
              stateTransitions.push(WORKFLOW_STATES.FAILED);
              break;
            }
          }

          const recoveryBaseline = isBenchRun ? null : captureProjectFileState(sandboxDir, targetFiles);
          coderResult = this._executeRole('coder', recoveryConfig, recoveryPrompt, sandboxDir, {
            ...options,
            providerCallBudget,
            isRecovery: true,
            approvedPlanSnapshot,
            structuredArtifactDelivery: structuredCoderExecution
          });
          totalModelCalls++;
          accumulatedSessionTokens += (coderResult.tokens || 0);
          if (isCriticTriggered) {
            criticTriggeredRecoveryCost += (coderResult.cost || 0);
            criticTriggeredRecoveryTokens += (coderResult.tokens || 0);
            criticTriggeredRecoveryRetries++;
          }
          const recoveryKey = `recovery_${recoveryAttempts}`;
          perRoleTelemetry[recoveryKey] = {
            executionType: 'model_call',
            isModelCall: true,
            role: 'recovery',
            attempt: recoveryAttempts,
            model: recoveryConfig.model,
            reasoningEffort: recoveryConfig.reasoningEffort || null,
            requestedModel: recoveryConfig ? (recoveryConfig.model ?? null) : null,
            actualModel: (coderResult && coderResult.actualModel) || null,
            requestedReasoningEffort: recoveryConfig ? (recoveryConfig.reasoningEffort ?? null) : null,
            actualReasoningEffort: (coderResult && coderResult.actualReasoningEffort) || null,
            durationMs: coderResult.durationMs,
            tokens: coderResult.tokens,
            inputTokens: coderResult.inputTokens || null,
            outputTokens: coderResult.outputTokens || null,
            cost: coderResult.cost || null,
            status: coderResult.status,
            timedOut: Boolean(coderResult.timedOut),
            adapterCaptureDiagnostics: coderResult.adapterCaptureDiagnostics || null,
            textResultSource: coderResult.textResultSource || 'unknown',
            contextHealth: recoveryContext.health,
            contextMeasurement: recoveryContext.measurement,
            ...(recoveryContext.health === CONTEXT_HEALTH.WARNING ? { contextWarning: recoveryContext.warningMessage } : {}),
            ...(recoveryConfig.fallbackApplied ? { fallbackApplied: true, fallbackReason: recoveryConfig.fallbackReason } : {}),
            ...(isModelEscalated ? { escalatedFrom: recoveryConfig.escalatedFrom } : {})
          };

          // If recovery call timed out, abort further futile recovery
          if (coderResult.timedOut || coderResult.status === 'timeout') {
            terminationReason = 'UNRECOVERABLE_TIMEOUT';
            break;
          }

          if (isBenchRun) {
            const recExt = extractCode(coderResult.textResult);
            if (recExt.success && recExt.code) {
              try {
                fs.writeFileSync(path.join(sandboxDir, 'index.js'), recExt.code, 'utf8');
              } catch {}
            }
            artifactResult = extractAndWriteArtifact(coderResult.textResult, sandboxDir, 'index.js');
            if (artifactResult.success && artifactResult.filePath && fs.existsSync(artifactResult.filePath)) {
              codeContent = fs.readFileSync(artifactResult.filePath, 'utf8');
            } else {
              codeContent = (recExt.success && recExt.code) ? recExt.code : coderResult.textResult;
            }
          } else {
            artifactResult = extractAndApplyProjectArtifacts(coderResult.textResult, sandboxDir, targetFiles, {
              baseline: recoveryBaseline,
              baselineBackup: { taskId: task.id, attempt: recoveryAttempts },
              structuredArtifactDelivery: structuredCoderExecution,
              allowUnchangedStructuredArtifacts: structuredCoderExecution,
              structuredArtifactResult: coderResult.structuredArtifactResult
            });
            codeContent = structuredCoderExecution
              ? (artifactResult.success ? artifactResult.codeContent : '')
              : (artifactResult.codeContent || coderResult.textResult);
            artifactFiles = artifactResult.artifactFiles;
            artifactDeliveryDiagnostics.push(buildArtifactDeliveryDiagnostic({
              taskId: task.id,
              attemptType: 'recovery',
              attemptIndex: recoveryAttempts,
              coderResult,
              forwardedResultField: 'coderResult.textResult',
              textResult: coderResult.textResult,
              artifactResult
            }));
          }
        } else {
          terminationReason = semanticCriticEvidence.status === 'FAILED'
            ? 'SEMANTIC_REVIEW_FAILED_ATTEMPTS_EXHAUSTED'
            : (isCriticTriggered ? 'CRITIC_REJECTED' : 'VERIFICATION_FAILED');
        }
      }

    // Failure Propagation: preserve initial fatal security violations and accumulated security violations across all attempts
    if (!passedAll) {
      if (initialVerificationEvidence && initialVerificationEvidence.fatalViolation && !verificationEvidence.fatalViolation) {
        verificationEvidence.fatalViolation = initialVerificationEvidence.fatalViolation;
      }
      if (allSecurityViolations.size > 0) {
        verificationEvidence.securityViolations = Array.from(allSecurityViolations);
      }
    }
    // Record Tester & Critic telemetry
    perRoleTelemetry.tester = {
      executionType: 'deterministic_verification',
      isModelCall: false,
      model: null,
      reasoningEffort: null,
      requestedModel: null,
      actualModel: null,
      requestedReasoningEffort: null,
      actualReasoningEffort: null,
      durationMs: 0,
      tokens: null,
      status: 'success',
      testsPassed: verificationEvidence.testsPassed || 0,
      testsTotal: verificationEvidence.testsTotal || 0
    };

    perRoleTelemetry.critic = {
      executionType: 'rule_based_critic',
      isModelCall: false,
      model: null,
      reasoningEffort: null,
      requestedModel: null,
      actualModel: null,
      requestedReasoningEffort: null,
      actualReasoningEffort: null,
      durationMs: 0,
      tokens: null,
      status: 'success',
      passed: criticEvidence.passed
    };
    } // end if (!coderAbort)
    } // end if (!quotaBlocked && !floorBlocked)
    } // end if (!switchingChanged && !languagesChanged && !modelChanged)
    } // end if (normalizedDecision === APPROVAL_DECISIONS.APPROVE)
    } // end permitted fallback execution else block
    } // end if (!plannerAbort && !terminationReason)

    const hadFatalBefore = Boolean(initialVerificationEvidence && (initialVerificationEvidence.fatalViolation || (initialVerificationEvidence.securityViolations && initialVerificationEvidence.securityViolations.length > 0)));
    const recoveredFromFatal = Boolean(passedAll && hadFatalBefore);
    const passAt1 = Boolean(initialVerificationEvidence && initialVerificationEvidence.isClean);

    // Timeout detection across all participating model calls
    let hasTimeout = false;
    const timedOutRoles = [];
    for (const [rKey, r] of Object.entries(perRoleTelemetry)) {
      if (r.isModelCall && (r.status === 'timeout' || r.timedOut === true)) {
        hasTimeout = true;
        timedOutRoles.push(rKey);
      }
    }

    // Calculate quality score using RubricEvaluator
    let finalQualityScore = 0;
    let rubricBreakdown = {};
    let fatalFailure = false;
    let diagnosticScore = null;
    let providerExecutionStatus = 'SUCCESS';
    let executionValid = true;
    let verificationStatus = 'FAILED';

    const isApprovalHalt = [
      'AWAITING_APPROVAL',
      'PLAN_REJECTED',
      'TASK_CANCELLED'
    ].includes(terminationReason);

    const isReliabilityAbort = [
      'NO_USABLE_MODEL_AVAILABLE',
      'MODEL_QUOTA_EXHAUSTED',
      'MODEL_UNAVAILABLE',
      'CONTEXT_WINDOW_CRITICAL',
      'STALE_PLAN_INVALIDATED',
      'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED'
    ].includes(terminationReason);

    const isExecutionAbort = [
      'PROVIDER_EXECUTION_FAILED',
      'PLANNER_FAILED',
      'CODER_EXECUTION_FAILED',
      'MODEL_COMPLIANCE_FAILED',
      'CORE_INTERNAL_FAILURE'
    ].includes(terminationReason);

    if (isApprovalHalt) {
      fatalFailure = false;
      finalQualityScore = 0;
      diagnosticScore = 0;
      rubricBreakdown = { functionalCorrectness: 0, fatalFailure: false, terminationReason };
      providerExecutionStatus = (terminationReason === 'AWAITING_APPROVAL') ? 'AWAITING_APPROVAL' : 'STOPPED';
      executionValid = false;
      verificationStatus = 'SKIPPED';
    } else if (isReliabilityAbort || isExecutionAbort) {
      fatalFailure = true;
      finalQualityScore = 0;
      diagnosticScore = 0;
      rubricBreakdown = { functionalCorrectness: 0, fatalFailure: true, failureReason: terminationReason };
      providerExecutionStatus = 'FAILURE';
      executionValid = false;
      verificationStatus = 'FAILED';
    } else {
      try {
        const evalResult = RubricEvaluator.evaluate(task, verificationEvidence);
        finalQualityScore = evalResult.finalQualityScore;
        rubricBreakdown = evalResult.breakdown || {};
        fatalFailure = Boolean(evalResult.fatalFailure);
      } catch {
        finalQualityScore = 0;
        rubricBreakdown = { functionalCorrectness: 0 };
        fatalFailure = true;
      }

      // Capture diagnostic evaluation prior to any fatal/timeout/critic zeroing
      diagnosticScore = finalQualityScore;

      providerExecutionStatus = 'SUCCESS';
      executionValid = true;
      verificationStatus = (fatalFailure || passedAll === false)
        ? 'FAILED'
        : (verificationEvidence.testsTotal > 0 && verificationEvidence.testsPassed === verificationEvidence.testsTotal
          ? 'VERIFIED'
          : 'FAILED');

      // Scope 7: Ensure timeout failures are represented accurately
      if (hasTimeout) {
        providerExecutionStatus = 'TIMEOUT';
        executionValid = false;
        verificationStatus = 'TIMED_OUT';
        fatalFailure = true;
        finalQualityScore = 0; // Invariant: Timed-out execution produces 0 quality score
        rubricBreakdown = { fatalFailure: true, timeout: true };
      }
    }

    const criticRejected = !criticEvidence.passed;
    const criticConcerns = [...criticEvidence.concerns];

    // Aggregate tokens, preserving null for unavailable measurements and preventing partial sums from masquerading as totals
    let totalTokens = null;
    let partialTokens = null;
    let inputTokens = null;
    let outputTokens = null;
    let totalCost = null;
    let modelCallsCount = 0;
    let completedModelCallsWithTokens = 0;
    let hasCost = false;

    for (const r of Object.values(perRoleTelemetry)) {
      if (r.isModelCall) {
        modelCallsCount++;
        if (typeof r.tokens === 'number') {
          completedModelCallsWithTokens++;
          totalTokens = (totalTokens || 0) + r.tokens;
        }
      }
      if (typeof r.inputTokens === 'number') {
        inputTokens = (inputTokens || 0) + r.inputTokens;
      }
      if (typeof r.outputTokens === 'number') {
        outputTokens = (outputTokens || 0) + r.outputTokens;
      }
      if (typeof r.cost === 'number') {
        totalCost = (totalCost || 0) + r.cost;
        hasCost = true;
      }
    }

    let telemetryComplete = false;
    let telemetryStatus = 'UNAVAILABLE';

    if (modelCallsCount > 0) {
      if (completedModelCallsWithTokens === modelCallsCount) {
        telemetryComplete = true;
        telemetryStatus = 'COMPLETE';
      } else if (completedModelCallsWithTokens > 0) {
        telemetryComplete = false;
        telemetryStatus = 'PARTIAL';
        partialTokens = totalTokens; // Record partial token sum distinctly
        totalTokens = null; // Scope 3: Never report a partial token sum as a complete total
      } else {
        telemetryComplete = false;
        telemetryStatus = 'UNAVAILABLE';
        totalTokens = null;
        partialTokens = null;
      }
    } else {
      totalTokens = null;
      telemetryComplete = true;
      telemetryStatus = 'NOT_APPLICABLE';
    }

    if (!hasCost) totalCost = null;

    let totalWallClockMs = 0;
    for (const r of Object.values(perRoleTelemetry)) {
      totalWallClockMs += (r.durationMs || 0);
    }

    // Persist per-attempt execution outcomes to history store
    if (!checkpointStore && this.historyStore && typeof this.historyStore.recordAttempt === 'function') {
      try {
        // Operational database protection: NEVER write non-production runs to operational database
        if (operationalHistoryBlocked) {
          return result;
        }

        // 1. Planner attempt
        if (perRoleTelemetry.planner && perRoleTelemetry.planner.isModelCall && perRoleTelemetry.planner.model) {
          this.historyStore.recordAttempt({
            task_id: task.id,
            task_category: task.category || 'general',
            role: 'planner',
            model: perRoleTelemetry.planner.model,
            requested_model: perRoleTelemetry.planner.requestedModel || perRoleTelemetry.planner.model || null,
            actual_model: (typeof perRoleTelemetry.planner.actualModel === 'string' && perRoleTelemetry.planner.actualModel.trim())
              ? perRoleTelemetry.planner.actualModel.trim()
              : null,
            executor: 'core',
            attribution_source: 'direct',
            attempt_type: 'initial',
            attempt_index: 0,
            success: parsedPlan ? 1 : 0,
            verification_passed: parsedPlan ? 1 : 0,
            critic_passed: 1,
            fatal_violation: null,
            tokens: perRoleTelemetry.planner.tokens,
            duration_ms: perRoleTelemetry.planner.durationMs,
            cost: perRoleTelemetry.planner.cost,
            environment: runEnvironment
          });
        }

        // 2. Initial coder attempt
        if (perRoleTelemetry.coder && perRoleTelemetry.coder.isModelCall && perRoleTelemetry.coder.status !== 'cancelled' && perRoleTelemetry.coder.status !== 'skipped') {
          const initVerPassed = (initialVerificationEvidence && !initialVerificationEvidence.fatalViolation && initialVerificationEvidence.testsPassed === initialVerificationEvidence.testsTotal && initialVerificationEvidence.testsTotal > 0) ? 1 : 0;
          const initCritPassed = (initialCriticEvidence && initialCriticEvidence.passed === true) ? 1 : 0;
          const providerAttemptFailed = perRoleTelemetry.coder.status === 'failed' || perRoleTelemetry.coder.status === 'timeout';
          const initSemanticPassed = !(semanticPolicy && semanticPolicy.requested === true) ||
            Boolean(initialLeaderDecision && initialLeaderDecision.success);
          const initSuccess = (!providerAttemptFailed && initVerPassed && initCritPassed && initSemanticPassed && modelComplianceStatus !== 'FAILED') ? 1 : 0;
          const providerFailure = providerAttemptFailed
            ? `${perRoleTelemetry.coder.failureCategory || (perRoleTelemetry.coder.timedOut ? 'provider_timeout' : 'provider_execution_failed')}: ${[
              perRoleTelemetry.coder.exitCode !== null && perRoleTelemetry.coder.exitCode !== undefined ? `exit code ${perRoleTelemetry.coder.exitCode}` : null,
              perRoleTelemetry.coder.errorMessage,
              perRoleTelemetry.coder.stderr
            ].filter(Boolean).join('; ') || 'provider execution failed'}`
            : null;
          const initFatal = providerFailure
            || (initialVerificationEvidence && initialVerificationEvidence.isInfrastructureError
            ? `infrastructure_failure: ${initialVerificationEvidence.skippedChecks && initialVerificationEvidence.skippedChecks.length
              ? `SKIPPED: ${initialVerificationEvidence.skippedChecks.map((check) => `${check.name} (${check.message})`).join('; ')}; `
              : ''}${initialVerificationEvidence.fatalViolation || 'verification infrastructure failed'}`
            : null)
            || (initialVerificationEvidence && initialVerificationEvidence.fatalViolation)
            || (initialVerificationEvidence && !initVerPassed
              ? `verification_failed: ${(initialVerificationEvidence.failures || []).join('; ') || 'verification checks did not pass'}`
              : null)
            || (!initCritPassed && initialCriticEvidence && Array.isArray(initialCriticEvidence.concerns) && initialCriticEvidence.concerns[0])
            || (modelComplianceStatus === 'FAILED' ? `model_compliance_failed: ${modelComplianceFailure || 'reported model did not satisfy the approved model contract'}` : null)
            || null;

          const deliveryDiagnostic = artifactDeliveryDiagnostics.find((item) => item.attemptType === 'initial');
          const recordedAttempt = this.historyStore.recordAttempt({
            task_id: task.id,
            task_category: task.category || 'general',
            role: 'coder',
            model: perRoleTelemetry.coder.model,
            requested_model: perRoleTelemetry.coder.requestedModel || null,
            actual_model: (typeof perRoleTelemetry.coder.actualModel === 'string' && perRoleTelemetry.coder.actualModel.trim())
              ? perRoleTelemetry.coder.actualModel.trim()
              : null,
            executor: 'core',
            attribution_source: 'direct',
            attempt_type: 'initial',
            attempt_index: 0,
            success: initSuccess,
            history_metadata: normalizedDecision === APPROVAL_DECISIONS.APPROVE ? options.historyMetadata : null,
            ...(options.approvalProvenance ? { approval_provenance: options.approvalProvenance } : {}),
            verification_passed: initVerPassed,
            critic_passed: initCritPassed,
            semantic_review_status: initialSemanticCriticEvidence
              ? initialSemanticCriticEvidence.status
              : (semanticPolicy && semanticPolicy.requested === true ? 'UNREVIEWED' : 'NOT_REQUESTED'),
            semantic_review: initialSemanticCriticEvidence || (semanticPolicy && semanticPolicy.requested === true
              ? { status: 'UNREVIEWED', reason: 'review_stage_not_reached', provenance: 'not_executed',
                criteria: (approvedPlanSnapshot.acceptanceCriteria || []).map((criterion, index) => ({ index, criterion, status: 'UNREVIEWED' })) }
              : { status: 'NOT_REQUESTED', provenance: 'not_requested' }),
            leader_decision: initialLeaderDecision,
            role_provenance: {
              coder: perRoleTelemetry.coder && perRoleTelemetry.coder.isModelCall ? 'core_managed' : 'not_executed',
              tester: initialVerificationEvidence ? 'core_observed' : 'not_executed',
              critic: initialCriticEvidence ? 'core_observed' : 'not_executed',
              semanticCritic: initialSemanticCriticEvidence
                ? initialSemanticCriticEvidence.provenance
                : (semanticPolicy && semanticPolicy.requested === true ? 'not_executed' : 'not_requested'),
              leader: initialLeaderDecision ? 'core_observed' : 'not_executed'
            },
            fatal_violation: deliveryDiagnostic && !initSuccess
              ? `${initFatal || 'coder_attempt_failed'} artifact_delivery_diagnostics=${encodeArtifactDeliveryDiagnostic(deliveryDiagnostic)}`
              : initFatal,
            tokens: perRoleTelemetry.coder.tokens,
            duration_ms: perRoleTelemetry.coder.durationMs,
            cost: perRoleTelemetry.coder.cost,
            environment: runEnvironment
          });
          if (deliveryDiagnostic && recordedAttempt && recordedAttempt.ok && Number.isSafeInteger(recordedAttempt.id)) {
            deliveryDiagnostic.executionAttemptId = recordedAttempt.id;
          }
        }

        // 3. Recovery attempts
        for (let att = 1; att <= recoveryAttempts; att++) {
          const rKey = `recovery_${att}`;
          const rTel = perRoleTelemetry[rKey];
          if (rTel && rTel.isModelCall) {
            const rec = Array.isArray(recoveryHistory) ? recoveryHistory.find(h => h.attempt === att) : null;
            const recVerPassed = (rec && !rec.fatalViolation && rec.testsPassed === rec.testsTotal && rec.testsTotal > 0) ? 1 : 0;
            const recCritPassed = (rec && rec.criticPassed === true) ? 1 : 0;
            const recSemanticPassed = !rec || rec.semanticReviewStatus === 'NOT_REQUESTED' ||
              Boolean(rec.leaderDecision && rec.leaderDecision.success);
            const recSuccess = (recVerPassed && recCritPassed && recSemanticPassed) ? 1 : 0;
            const recFatal = (rec && rec.isInfrastructureError
              ? `infrastructure_failure: ${rec.skippedChecks && rec.skippedChecks.length
                ? `SKIPPED: ${rec.skippedChecks.map((check) => `${check.name} (${check.message})`).join('; ')}; `
                : ''}${rec.fatalViolation || 'verification infrastructure failed'}`
              : null)
              || (rec && rec.fatalViolation)
              || (rec && !recVerPassed
                ? `verification_failed: ${(rec.failures || []).join('; ') || 'verification checks did not pass'}`
                : null)
              || (rec && !recCritPassed && Array.isArray(rec.criticConcerns) && rec.criticConcerns[0])
              || null;

            const deliveryDiagnostic = artifactDeliveryDiagnostics.find((item) => item.attemptType === 'recovery' && item.attemptIndex === att);
            const recordedAttempt = this.historyStore.recordAttempt({
              task_id: task.id,
              task_category: task.category || 'general',
              role: 'coder',
              model: rTel.model,
              requested_model: rTel.requestedModel || rTel.model || null,
              actual_model: (typeof rTel.actualModel === 'string' && rTel.actualModel.trim())
                ? rTel.actualModel.trim()
                : null,
              executor: 'core',
              attribution_source: 'direct',
              attempt_type: 'recovery',
              attempt_index: att,
              success: recSuccess,
              history_metadata: normalizedDecision === APPROVAL_DECISIONS.APPROVE ? options.historyMetadata : null,
              ...(options.approvalProvenance ? { approval_provenance: options.approvalProvenance } : {}),
              verification_passed: recVerPassed,
              critic_passed: recCritPassed,
              semantic_review_status: rec && rec.semanticReviewStatus || 'NOT_REQUESTED',
              semantic_review: rec && rec.semanticReview || { status: 'NOT_REQUESTED', provenance: 'not_requested' },
              leader_decision: rec && rec.leaderDecision || null,
              role_provenance: { tester: 'core_observed', critic: 'core_observed', leader: 'core_observed', coder: 'core_managed' },
              fatal_violation: deliveryDiagnostic && !recSuccess
                ? `${recFatal || 'coder_attempt_failed'} artifact_delivery_diagnostics=${encodeArtifactDeliveryDiagnostic(deliveryDiagnostic)}`
                : recFatal,
              tokens: rTel.tokens,
              duration_ms: rTel.durationMs,
              cost: rTel.cost,
              environment: runEnvironment
            });
            if (deliveryDiagnostic && recordedAttempt && recordedAttempt.ok && Number.isSafeInteger(recordedAttempt.id)) {
              deliveryDiagnostic.executionAttemptId = recordedAttempt.id;
            }
          }
        }
      } catch {
        // Safe fail: history logging failure must never affect workflow results
      }
    }

    const isApproved = normalizedDecision === APPROVAL_DECISIONS.APPROVE && terminationReason !== 'STALE_PLAN_INVALIDATED' && terminationReason !== 'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED';
    const isRejected = normalizedDecision === APPROVAL_DECISIONS.REJECT;
    const isCancelled = normalizedDecision === APPROVAL_DECISIONS.CANCEL;
    const requiresReapproval = (terminationReason === 'STALE_PLAN_INVALIDATED' || terminationReason === 'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED');
    const isAwaitingApproval = !requiresReapproval && ((!normalizedDecision && terminationReason === 'AWAITING_APPROVAL') || (stateTransitions.includes(WORKFLOW_STATES.AWAITING_APPROVAL) && !stateTransitions.includes(WORKFLOW_STATES.APPROVED)));

    const isFailed = (requiresReapproval || isReliabilityAbort || isExecutionAbort || [
      'STALE_PLAN_INVALIDATED',
      'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED',
      'MODEL_QUOTA_EXHAUSTED',
      'MODEL_UNAVAILABLE',
      'NO_USABLE_MODEL_AVAILABLE',
      'CONTEXT_WINDOW_CRITICAL',
      'MAX_ATTEMPTS_EXCEEDED',
      'RECOVERY_STAGNATION',
      'UNRECOVERABLE_TIMEOUT',
      'PROVIDER_EXECUTION_FAILED',
      'PLANNER_FAILED',
      'CODER_EXECUTION_FAILED',
      'CORE_INTERNAL_FAILURE'
    ].includes(terminationReason) || (fatalFailure && !isApprovalHalt) || (verificationStatus === 'FAILED' && !isApprovalHalt)) && !isCancelled && !isRejected && !isAwaitingApproval;

    let status = 'SUCCESS';
    if (isCancelled) {
      status = 'CANCELLED';
    } else if (isRejected) {
      status = 'REJECTED';
    } else if (isAwaitingApproval) {
      status = 'AWAITING_APPROVAL';
    } else if (isFailed) {
      status = 'FAILED';
    } else if (verificationStatus === 'VERIFIED') {
      status = 'SUCCESS';
    } else {
      status = 'FAILED';
    }

    let failure = null;
    if (status === 'FAILED') {
      const currentSourceState = initialSourceState
        ? captureProvableSourceState(sandboxDir, [...initialSourceState.keys()])
        : null;
      const sourceStateKnown = initialSourceState !== null && currentSourceState !== null;
      const hasSourceModifications = sourceStateKnown && [...initialSourceState].some(([rel, before]) => {
        const after = currentSourceState.get(rel);
        return before === null ? after !== null : after === null || !before.equals(after);
      });
      const isVerifierInfrastructureFailure = terminationReason === 'VERIFIER_INFRASTRUCTURE_FAILURE';
      const isVerificationFailure = terminationReason === 'VERIFICATION_FAILED';
      const isCriticRejection = terminationReason === 'CRITIC_REJECTED';
      const isSemanticReviewFailure = typeof terminationReason === 'string' && terminationReason.startsWith('SEMANTIC_REVIEW_FAILED');
      const isSemanticReviewUnreviewed = typeof terminationReason === 'string' && terminationReason.startsWith('SEMANTIC_REVIEW_UNREVIEWED');
      const skippedVerificationDetails = initialVerificationEvidence && Array.isArray(initialVerificationEvidence.skippedChecks)
        ? initialVerificationEvidence.skippedChecks.map((check) => `SKIPPED: ${check.name} (${check.message})`)
        : [];
      const outcomeDetails = isVerifierInfrastructureFailure
        ? [...skippedVerificationDetails, ...(verificationEvidence.failures || [])].join('; ')
          || verificationEvidence.fatalViolation
          || 'Verification infrastructure did not produce a result.'
        : isVerificationFailure
          ? (verificationEvidence.failures || []).join('; ')
            || verificationEvidence.fatalViolation
            || 'Verification checks did not pass.'
          : isCriticRejection
            ? `Critic rejected the attempt: ${(criticEvidence.concerns || []).join('; ') || 'no specific concern reported'}`
            : isSemanticReviewFailure
              ? `Semantic Critic identified grounded acceptance-criterion failures: ${(semanticCriticEvidence.criteria || []).filter(item => item.status === 'FAILED').map(item => `${item.index + 1}: ${item.criterion} [${(item.evidenceRefs || []).join(', ')}]`).join('; ')}`
              : isSemanticReviewUnreviewed
                ? `Semantic review remained UNREVIEWED: ${semanticCriticEvidence.reason || 'required evidence or execution was unavailable'}`
            : null;
      const failureContract = buildFailureContract({
        terminationReason,
        fatalFailure: isVerifierInfrastructureFailure ? false : fatalFailure,
        hasTimeout,
        verificationEvidence,
        criticEvidence,
        perRoleTelemetry,
        stateTransitions,
        hasSourceModifications,
        ...(isVerifierInfrastructureFailure ? { message: 'Verification infrastructure failed; Core stopped without retrying the Coder.' } : {}),
        ...(outcomeDetails ? { details: outcomeDetails } : {}),
        options
      });
      failure = Object.freeze({
        ...failureContract,
        projectStateSafe: hasSourceModifications ? false : null,
        projectState: hasSourceModifications ? 'Has partial modifications' : 'Unknown',
        projectStateEvidence: hasSourceModifications ? 'approved_source_baseline' : null
      });
    }

    let approvalStatus = WORKFLOW_STATES.AWAITING_APPROVAL;
    if (isApproved) {
      approvalStatus = WORKFLOW_STATES.APPROVED;
    } else if (isRejected) {
      approvalStatus = WORKFLOW_STATES.REJECTED;
    } else if (isCancelled) {
      approvalStatus = WORKFLOW_STATES.CANCELLED;
    } else if (requiresReapproval) {
      approvalStatus = 'REAPPROVAL_REQUIRED';
    }

    return Object.freeze({
      taskId: task.id,
      mode,
      provider: this.provider,
      status,
      ...(diagnosticMode ? { modelComplianceStatus, modelComplianceFailure } : {}),
      ...(diagnosticMode ? {
        diagnosticEvidence: Object.freeze({
          taskId: task.id,
          workspace: options.diagnosticAuthorization.workspace,
          receiptDigest: options.diagnosticAuthorization.receiptDigest,
          snapshotDigest: options.diagnosticAuthorization.snapshotDigest,
          authorizationConsumed: Boolean(diagnosticExecutionMarker),
          markerPath: diagnosticExecutionMarker ? diagnosticExecutionMarker.markerPath : null,
          modelComplianceStatus
        })
      } : {}),
      failure,
      failureCode: failure ? failure.failureCode : null,
      stage: failure ? failure.stage : null,
      failureStage: failure ? failure.stage : null,
      message: failure ? failure.message : null,
      failureMessage: failure ? failure.message : null,
      retryable: failure ? failure.retryable : false,
      retryUnavailableReason: failure ? failure.retryUnavailableReason : null,
      bypassAllowed: true,
      projectStateSafe: failure ? failure.projectStateSafe : true,
      suggestedAction: failure ? failure.suggestedAction : null,
      plan: parsedPlan,
      userVisiblePlan,
      agentExecutionPlan: agentExecutionPlan || (parsedPlan && parsedPlan.agentExecutionPlan) || null,
      approvedPlanSnapshot: (typeof approvedPlanSnapshot !== 'undefined' ? approvedPlanSnapshot : (options.approvedPlanSnapshot || null)),
      approvalStatus,
      approved: Boolean(isApproved),
      rejected: Boolean(isRejected),
      cancelled: Boolean(isCancelled),
      requiresReapproval: Boolean(requiresReapproval),
      stalePlanInvalidated: terminationReason === 'STALE_PLAN_INVALIDATED',
      allocationChangedAfterApproval: terminationReason === 'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED',
      handoff,
      artifactDeliveryDiagnostics: Object.freeze(artifactDeliveryDiagnostics.map((item) => Object.freeze({ ...item }))),
      allocations: planAllocations ? planAllocations.allocations : null,
      // Allocation metadata across roles (Benchmark V1 trial schema compatibility)
      modelPerAgent: {
        planner: perRoleTelemetry.planner ? perRoleTelemetry.planner.model : null,
        coder: perRoleTelemetry.coder ? perRoleTelemetry.coder.model : null,
        tester: (planAllocations && planAllocations.allocations && planAllocations.allocations.tester)
          ? planAllocations.allocations.tester.model
          : (perRoleTelemetry.tester ? perRoleTelemetry.tester.model : null),
        critic: (planAllocations && planAllocations.allocations && planAllocations.allocations.critic)
          ? planAllocations.allocations.critic.model
          : (perRoleTelemetry.critic ? perRoleTelemetry.critic.model : null)
      },
      // Truthful executed model per role (strictly provider-reported actualModel when call actually executed; null otherwise)
      executedModelPerRole: {
        planner: (
          perRoleTelemetry.planner &&
          perRoleTelemetry.planner.isModelCall &&
          perRoleTelemetry.planner.status !== 'skipped' &&
          perRoleTelemetry.planner.status !== 'unavailable' &&
          perRoleTelemetry.planner.status !== 'context_critical' &&
          typeof perRoleTelemetry.planner.actualModel === 'string' &&
          perRoleTelemetry.planner.actualModel.trim().length > 0
        ) ? perRoleTelemetry.planner.actualModel.trim() : null,
        coder: (
          perRoleTelemetry.coder &&
          perRoleTelemetry.coder.isModelCall &&
          perRoleTelemetry.coder.status !== 'skipped' &&
          perRoleTelemetry.coder.status !== 'unavailable' &&
          perRoleTelemetry.coder.status !== 'context_critical' &&
          perRoleTelemetry.coder.status !== 'awaiting_approval' &&
          perRoleTelemetry.coder.status !== 'rejected' &&
          perRoleTelemetry.coder.status !== 'stale_plan_invalidated' &&
          perRoleTelemetry.coder.status !== 'reapproval_required' &&
          typeof perRoleTelemetry.coder.actualModel === 'string' &&
          perRoleTelemetry.coder.actualModel.trim().length > 0
        ) ? perRoleTelemetry.coder.actualModel.trim() : null,
        tester: null,
        critic: null
      },
      perRoleTelemetry,
      testsPassed: verificationEvidence.testsPassed || 0,
      testsTotal: verificationEvidence.testsTotal || 0,
      finalQualityScore,
      fatalFailure,
      rubricBreakdown,
      recoveryUsage,
      retries: recoveryAttempts,
      firstPassSuccess: passAt1,
      passAt1,
      recoveredFromFatal,
      criticRejected,
      criticConcerns: Object.freeze([...criticConcerns]),
      criticTriggeredRecoveryCost,
      criticTriggeredRecoveryTokens,
      criticTriggeredRecoveryRetries,
      passedAll: Boolean(passedAll),
      semanticReview: Object.freeze({ ...semanticCriticEvidence }),
      semanticReviewStatus: semanticCriticEvidence.status,
      ...(options.approvalProvenance ? { approvalProvenance: Object.freeze({ ...options.approvalProvenance }) } : {}),
      leaderDecision: leaderDecision ? Object.freeze({ ...leaderDecision }) : null,
      modelCallCount: totalModelCalls,
      totalTokens,
      partialTokens,
      telemetryComplete,
      telemetryStatus,
      inputTokens,
      outputTokens,
      totalCost,
      wallClockExecutionTimeMs: totalWallClockMs,
      hasTimeout,
      timedOutRoles,
      providerExecutionStatus,
      executionValid: Boolean(executionValid && isApproved),
      verificationStatus,
      diagnosticScore,
      artifactPath: path.join(sandboxDir, 'index.js'),
      stateTransitions: Object.freeze([...stateTransitions]),
      recoveryHistory: Object.freeze([...recoveryHistory]),
      initialVerificationEvidence: initialVerificationEvidence ? Object.freeze({ ...initialVerificationEvidence }) : null,
      initialCriticEvidence: initialCriticEvidence ? Object.freeze({ ...initialCriticEvidence }) : null,
      allSecurityViolations: Object.freeze(Array.from(allSecurityViolations)),
      terminationReason
    });
  }

  /**
   * Executes an already approved plan snapshot.
   *
   * @param {object} params
   * @param {object} params.approvedPlanSnapshot
   * @param {string} [params.mode]
   * @param {string} params.sandboxDir
   * @param {object} [params.options]
   * @returns {object} WorkflowExecutionResult
   */
  executeApprovedPlan({ approvedPlanSnapshot, mode, sandboxDir, options = {} }) {
    if (!approvedPlanSnapshot || !approvedPlanSnapshot.plan) {
      throw new Error('Valid approvedPlanSnapshot is required to execute approved plan');
    }
    // Ordinary V1 execution always uses the universal adaptive workflow path.
    // With switching frozen, its allocations are explicit Provider model or
    // Provider default; fixed-strong remains an explicit benchmark/legacy mode.
    const resolvedMode = mode || BENCHMARK_MODES.CORE_ADAPTIVE;
    const task = approvedPlanSnapshot.task || { id: approvedPlanSnapshot.taskId, userPrompt: approvedPlanSnapshot.goal };
    return this.executeWorkflow({
      task,
      mode: resolvedMode,
      sandboxDir,
      options: {
        cwd: options.cwd || this.cwd || sandboxDir,
        ...options,
        approvalDecision: APPROVAL_DECISIONS.APPROVE,
        approvedPlanSnapshot
      }
    });
  }

  /**
   * Enforces allocated Coder model handoff on an active interactive Codex thread
   * before implementation proceeds.
   *
   * @param {object} approvedPlanSnapshot
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async enforceInteractiveHandoff(approvedPlanSnapshot, options = {}) {
    assertManagedCheckpointPolicyAvailable(approvedPlanSnapshot?.plan?.managedExecutionPolicy);
    const { executeAllocatedRole } = require('../allocation/execution_handoff');
    return executeAllocatedRole(approvedPlanSnapshot, 'coder', null, {
      ...this.options,
      ...options,
      interactive: true,
      modelSwitchingEnabled: false
    });
  }

  /**
   * Asynchronous variant of executeApprovedPlan that enforces interactive handoff
   * when options.interactive is true.
   *
   * @param {object} params
   * @param {object} params.approvedPlanSnapshot
   * @param {string} [params.mode]
   * @param {string} params.sandboxDir
   * @param {object} [params.options]
   * @returns {Promise<object>}
   */
  async executeApprovedPlanAsync({ approvedPlanSnapshot, mode, sandboxDir, options = {} }) {
    assertManagedCheckpointPolicyAvailable(approvedPlanSnapshot?.plan?.managedExecutionPolicy);
    let handoffResult = null;
    const { isInteractiveCodexSession } = require('../allocation/adapters/codex_interactive_handoff');
    const isInteractive = isInteractiveCodexSession({
      ...this.options,
      ...options,
      env: (options && options.env) || (this.options && this.options.env) || process.env
    }, this.provider);

    if (isInteractive) {
      handoffResult = await this.enforceInteractiveHandoff(approvedPlanSnapshot, options);
    }
    const syncRes = this.executeApprovedPlan({ approvedPlanSnapshot, mode, sandboxDir, options });
    if (handoffResult) {
      return Object.freeze({
        ...syncRes,
        handoff: handoffResult,
        enforcedModel: handoffResult.enforcedModel
      });
    }
    return syncRes;
  }

  /**
   * Builds the structured Agent Execution Plan before execution.
   * @param {object} options
   * @returns {object}
   */
  buildAgentExecutionPlan(options) {
    return buildAgentExecutionPlan(options);
  }

  /**
   * Generates a truthful, deterministic implementation and execution plan
   * without executing providers, child processes, or mutating workspace files.
   *
   * @param {string|object} task Task prompt or task object
   * @param {object} [options]
   * @returns {object} Structured plan result
   */
  planTask(task, options = {}) {
    const { generateTaskPlan } = require('./plan_generator');
    return generateTaskPlan({
      task,
      cwd: this.cwd,
      provider: this.provider,
      adapter: this.adapter,
      coreBrain: this.coreBrain,
      historyStore: this.historyStore,
      allocator: this.allocator,
      modelSwitchingEnabled: this.modelSwitchingEnabled,
      ...options
    });
  }

  /**
   * Cleans orchestration state and yields a structured handoff for continuing without Core.
   *
   * @param {object} params
   * @param {object} [params.task]
   * @param {object} [params.plan]
   * @param {object} [params.failure]
   * @param {string} [params.sandboxDir]
   * @param {object} [params.options]
   * @returns {object}
   */
  continueWithoutCore({ task = null, plan = null, failure = null, sandboxDir = null, options = {} } = {}) {
    return Object.freeze({
      status: 'BYPASSED',
      coreActive: false,
      projectStateSafe: failure ? failure.projectStateSafe : null,
      projectState: failure ? failure.projectState : 'Unknown',
      projectStateEvidence: failure ? failure.projectStateEvidence || null : null,
      task: task || null,
      plan: plan || null,
      failureReason: failure ? failure.failureCode : null,
      failure: failure || null,
      message: 'Continued without Core. Any previously applied changes remain in the workspace. Core will perform no further work.'
    });
  }

  /**
   * Immediately and cleanly terminates Core task execution without further writes.
   *
   * @param {object} params
   * @param {object} [params.task]
   * @param {object} [params.failure]
   * @param {string} [params.sandboxDir]
   * @param {object} [params.options]
   * @returns {object}
   */
  cancelTask({ task = null, failure = null, sandboxDir = null, options = {} } = {}) {
    return Object.freeze({
      status: 'CANCELLED',
      coreActive: false,
      cancelled: true,
      projectStateSafe: failure ? failure.projectStateSafe : null,
      projectState: failure ? failure.projectState : 'Unknown',
      projectStateEvidence: failure ? failure.projectStateEvidence || null : null,
      task: task || null,
      failureReason: failure ? failure.failureCode : null,
      failure: failure || null,
      message: 'Task cancelled by user. Any previously applied changes remain in the workspace. Core will perform no further work.'
    });
  }

  /**
   * Renders the user-visible plan markdown/text.
   * @param {object} plan
   * @param {object} [options]
   * @returns {string}
   */
  renderUserPlan(plan, options) {
    return renderUserPlan(plan, options);
  }
}

module.exports = {
  CoreWorkflowEngine,
  assertManagedCheckpointPolicyAvailable,
  WORKFLOW_STATES,
  APPROVAL_DECISIONS,
  normalizeApprovalDecision,
  DEFAULT_MAX_RECOVERY_ATTEMPTS,
  DEFAULT_ROLE_EXECUTION_TIMEOUT_MS,
  parsePlannerOutput,
  normalizeParsedPlan,
  normalizeVerificationEvidence,
  buildAgentExecutionPlan,
  renderAgentExecutionPlan,
  renderUserPlan,
  CORE_FAILURE_CODES,
  FAILURE_STAGES,
  FAILURE_DECISIONS,
  normalizeFailureDecision,
  buildFailureContract,
  formatFailurePrompt,
  promptFailureDecision,
  extractAndApplyProjectArtifacts,
  verifyProjectWorkspace,
  validateDiagnosticModelAttestation,
  evaluateDiagnosticModelCompliance,
  diagnosticAuthorizationMarkerPath,
  consumeDiagnosticAuthorization
};
