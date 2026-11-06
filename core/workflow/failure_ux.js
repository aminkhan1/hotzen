/**
 * 🌐 Universal Agent Core Hub - V1 Failure UX & Lifecycle Control Subsystem
 * Mandatory V1 Release Requirement: Clear Failure + Retry / Continue Without Core / Cancel
 *
 * Provides:
 * 1. CORE_FAILURE_CODES: Standardized failure codes
 * 2. FAILURE_STAGES: User-visible workflow stages
 * 3. FAILURE_DECISIONS: Explicit user action choices (RETRY, BYPASS, CANCEL)
 * 4. buildFailureContract: Generates structured failure contract object
 * 5. formatFailurePrompt: Formats standard user-facing failure explanation banner
 * 6. promptFailureDecision: Interactively prompts user using CLI architecture
 */

'use strict';

const readline = require('readline');

/**
 * Standard failure identifiers conforming to Universal V1 Core Contract.
 */
const CORE_FAILURE_CODES = Object.freeze({
  MODEL_QUOTA_EXHAUSTED: 'MODEL_QUOTA_EXHAUSTED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  NO_USABLE_MODEL_AVAILABLE: 'NO_USABLE_MODEL_AVAILABLE',
  CONTEXT_WINDOW_CRITICAL: 'CONTEXT_WINDOW_CRITICAL',
  SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED: 'SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED',
  STALE_PLAN_INVALIDATED: 'STALE_PLAN_INVALIDATED',
  PROVIDER_EXECUTION_FAILED: 'PROVIDER_EXECUTION_FAILED',
  UNRECOVERABLE_TIMEOUT: 'UNRECOVERABLE_TIMEOUT',
  PLANNER_FAILED: 'PLANNER_FAILED',
  CODER_EXECUTION_FAILED: 'CODER_EXECUTION_FAILED',
  MAX_ATTEMPTS_EXCEEDED: 'MAX_ATTEMPTS_EXCEEDED',
  RECOVERY_STAGNATION: 'RECOVERY_STAGNATION',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  CORE_INTERNAL_FAILURE: 'CORE_INTERNAL_FAILURE'
});

/**
 * Minimum required user-visible failure stages.
 */
const FAILURE_STAGES = Object.freeze({
  PLANNING: 'Planning',
  AWAITING_APPROVAL: 'Awaiting Approval',
  ALLOCATION: 'Allocation',
  CODER: 'Coder',
  VERIFICATION: 'Verification',
  CRITIC: 'Critic',
  RECOVERY: 'Recovery',
  DELIVERY: 'Delivery'
});

/**
 * User action choices when Core encounters an unrecoverable or controlled failure.
 */
const FAILURE_DECISIONS = Object.freeze({
  RETRY: 'RETRY',
  BYPASS: 'BYPASS',
  CANCEL: 'CANCEL'
});

/** Redacts prompt echoes and common credential forms from provider diagnostics. */
function sanitizeProviderDiagnostic(value, { prompt = '', secrets = [], maxLength = 1600 } = {}) {
  if (typeof value !== 'string' || !value) return '';
  let safe = value;
  if (typeof prompt === 'string' && prompt.length > 0) {
    const normalizedPrompt = prompt.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizedDiagnostic = safe.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalizedPrompt && normalizedDiagnostic.includes(normalizedPrompt)) {
      return '[provider diagnostic omitted because it echoed the task prompt]';
    }
    safe = safe.split(prompt).join('[prompt redacted]');
  }
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) safe = safe.split(secret).join('[REDACTED]');
  }
  safe = safe
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
  return safe.slice(0, maxLength);
}

function providerDiagnosticDetails(telemetry) {
  if (!telemetry || (!telemetry.stderr && !telemetry.errorMessage && telemetry.exitCode == null && !telemetry.providerExecutable)) return '';
  const parts = [];
  if (telemetry.providerExecutable) parts.push(`Executable: ${sanitizeProviderDiagnostic(String(telemetry.providerExecutable), { maxLength: 240 })}`);
  if (telemetry.failureCategory) parts.push(`category=${telemetry.failureCategory}`);
  if (telemetry.exitCode !== null && telemetry.exitCode !== undefined) parts.push(`exit code ${telemetry.exitCode}`);
  if (telemetry.timedOut) parts.push('provider process timed out');
  const stderr = sanitizeProviderDiagnostic(telemetry.stderr || '');
  const errorMessage = sanitizeProviderDiagnostic(telemetry.errorMessage || '');
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (errorMessage && errorMessage !== stderr) parts.push(`error: ${errorMessage}`);
  return parts.join('; ');
}

/**
 * Normalizes user/caller failure action decision string.
 *
 * @param {any} decision
 * @returns {'RETRY' | 'BYPASS' | 'CANCEL' | null}
 */
function normalizeFailureDecision(decision) {
  if (!decision || typeof decision !== 'string') return null;
  const d = decision.trim().toUpperCase();
  if (d === 'RETRY' || d === 'R' || d === 'RETRY WITH CORE') return FAILURE_DECISIONS.RETRY;
  if (d === 'BYPASS' || d === 'B' || d === 'CONTINUE' || d === 'CONTINUE WITHOUT CORE') return FAILURE_DECISIONS.BYPASS;
  if (d === 'CANCEL' || d === 'C' || d === 'ABORT') return FAILURE_DECISIONS.CANCEL;
  return null;
}

/**
 * Builds a structured user-facing failure object conforming to Universal V1 Failure Contract.
 *
 * @param {object} params
 * @param {string} [params.terminationReason]
 * @param {string} [params.stage]
 * @param {boolean} [params.fatalFailure]
 * @param {boolean} [params.hasTimeout]
 * @param {object} [params.verificationEvidence]
 * @param {object} [params.criticEvidence]
 * @param {object} [params.perRoleTelemetry]
 * @param {string[]} [params.stateTransitions]
 * @param {boolean} [params.hasSourceModifications]
 * @param {Error|null} [params.error]
 * @param {string} [params.message]
 * @param {string} [params.details]
 * @param {boolean} [params.retryable]
 * @param {string} [params.suggestedAction]
 * @returns {object} Structured failure contract
 */
function buildFailureContract({
  terminationReason,
  stage: explicitStage,
  fatalFailure,
  hasTimeout,
  verificationEvidence,
  criticEvidence,
  perRoleTelemetry,
  stateTransitions = [],
  hasSourceModifications = false,
  error = null,
  message: explicitMessage = null,
  details: explicitDetails = null,
  retryable: explicitRetryable = null,
  suggestedAction: explicitAction = null
} = {}) {
  let failureCode = terminationReason || (error && error.code) || CORE_FAILURE_CODES.CORE_INTERNAL_FAILURE;
  let stage = explicitStage || null;
  let message = explicitMessage || '';
  let details = explicitDetails || '';
  let retryable = (explicitRetryable !== null && explicitRetryable !== undefined) ? Boolean(explicitRetryable) : true;
  let retryUnavailableReason = null;
  let suggestedAction = explicitAction || '';

  // 1. Resolve stage if not explicitly specified
  if (!stage) {
    if (perRoleTelemetry && perRoleTelemetry.coder && (perRoleTelemetry.coder.status === 'failed' || perRoleTelemetry.coder.timedOut)) {
      stage = FAILURE_STAGES.CODER;
    } else if (perRoleTelemetry && perRoleTelemetry.planner && (perRoleTelemetry.planner.status === 'failed' || perRoleTelemetry.planner.timedOut)) {
      stage = FAILURE_STAGES.PLANNING;
    } else if (stateTransitions.includes('RECOVERY') || stateTransitions.includes('FIXING') || stateTransitions.includes('DIAGNOSING')) {
      stage = FAILURE_STAGES.RECOVERY;
    } else if (stateTransitions.includes('REVIEW')) {
      stage = FAILURE_STAGES.CRITIC;
    } else if (stateTransitions.includes('TESTING')) {
      stage = FAILURE_STAGES.VERIFICATION;
    } else if (stateTransitions.includes('IMPLEMENTING')) {
      stage = FAILURE_STAGES.CODER;
    } else if (stateTransitions.includes('AWAITING_APPROVAL')) {
      stage = FAILURE_STAGES.AWAITING_APPROVAL;
    } else if (stateTransitions.includes('PLAN_VALIDATION')) {
      stage = FAILURE_STAGES.ALLOCATION;
    } else if (stateTransitions.includes('PLANNING')) {
      stage = FAILURE_STAGES.PLANNING;
    } else {
      stage = FAILURE_STAGES.DELIVERY;
    }
  }

  // 2. Classify by failure code
  switch (failureCode) {
    case CORE_FAILURE_CODES.MODEL_QUOTA_EXHAUSTED:
      message = message || 'The requested model cannot be executed because account or provider quota is exhausted.';
      details = details || 'The selected model has no usable quota or account usage limits have been reached.';
      retryable = false;
      retryUnavailableReason = 'Account or model quota is exhausted. Enable model switching or restore quota before retrying.';
      suggestedAction = suggestedAction || 'Enable model switching with `core switch on` to allow a compliant fallback, or continue without Core.';
      break;

    case CORE_FAILURE_CODES.MODEL_UNAVAILABLE:
      message = message || 'The specified model is unavailable in the provider catalog or access was denied.';
      details = details || 'Provider catalog returned access denied or model is undiscoverable.';
      retryable = false;
      retryUnavailableReason = 'The model is unavailable in the current provider environment.';
      suggestedAction = suggestedAction || 'Select an available model or continue without Core.';
      break;

    case CORE_FAILURE_CODES.NO_USABLE_MODEL_AVAILABLE:
      message = message || 'No compliant model is available that satisfies the Safety Floor requirements.';
      details = details || 'All available catalog models either exhausted quota or failed minimum capability tier.';
      retryable = false;
      retryUnavailableReason = 'No compliant fallback models are available in current configuration.';
      suggestedAction = suggestedAction || 'Check model access permissions or continue without Core.';
      break;

    case CORE_FAILURE_CODES.CONTEXT_WINDOW_CRITICAL:
      stage = explicitStage || FAILURE_STAGES.PLANNING;
      message = message || 'Context window usage has reached a critical threshold.';
      details = details || 'Active session tokens exceed safe context window capacity. Further execution risks failure.';
      retryable = false;
      retryUnavailableReason = 'Context window is exhausted. Automatic session rollover is not supported.';
      suggestedAction = suggestedAction || 'Start a fresh session with reduced context or continue without Core.';
      break;

    case CORE_FAILURE_CODES.STALE_PLAN_INVALIDATED:
      stage = FAILURE_STAGES.AWAITING_APPROVAL;
      message = message || 'Runtime configuration changed before plan approval. The pending plan was invalidated.';
      details = details || 'Model switching, language settings, or model selection changed after planning. A fresh plan is required.';
      retryable = true;
      suggestedAction = suggestedAction || 'Retry with Core to generate a fresh plan reflecting the new configuration, or continue without Core.';
      break;

    case CORE_FAILURE_CODES.SAFETY_CONDITION_CHANGED_REAPPROVAL_REQUIRED:
      stage = stage || FAILURE_STAGES.AWAITING_APPROVAL;
      message = message || 'Authoritative safety or model availability condition changed after approval. Re-approval is required.';
      details = details || 'The approved model became unavailable, exhausted quota, or was blocked by Safety Floor. Core will not silently execute a different model.';
      retryable = true;
      suggestedAction = suggestedAction || 'Retry with Core to re-evaluate the plan with compliant models, or continue without Core.';
      break;

    case CORE_FAILURE_CODES.MAX_ATTEMPTS_EXCEEDED:
      stage = FAILURE_STAGES.RECOVERY;
      message = message || 'Automated recovery attempts reached maximum limit without resolving all defects.';
      details = details || 'The implementation failed test verification or critic review across all allowed recovery attempts.';
      retryable = false;
      retryUnavailableReason = 'Maximum automated recovery attempts have been exhausted.';
      suggestedAction = suggestedAction || 'Continue without Core to manually inspect test failures and finish implementation.';
      break;

    case CORE_FAILURE_CODES.RECOVERY_STAGNATION:
      stage = FAILURE_STAGES.RECOVERY;
      message = message || 'Recovery loop detected repeated identical errors and code stagnation.';
      details = details || 'Subsequent recovery attempts produced duplicate code without resolving test failures.';
      retryable = false;
      retryUnavailableReason = 'Recovery stagnation detected; automated attempts cannot resolve this issue.';
      suggestedAction = suggestedAction || 'Continue without Core to resolve the issue directly.';
      break;

    case CORE_FAILURE_CODES.UNRECOVERABLE_TIMEOUT:
      message = message || 'Execution timed out before completing the stage.';
      details = details || providerDiagnosticDetails(perRoleTelemetry && perRoleTelemetry.coder)
        || 'The provider process did not return within the allocated timeout limit.';
      retryable = true;
      suggestedAction = suggestedAction || 'Verify provider status or increase timeout limit, then retry.';
      break;

    case CORE_FAILURE_CODES.PROVIDER_EXECUTION_FAILED:
      message = message || 'The AI provider CLI encountered an execution error.';
      details = details || providerDiagnosticDetails(perRoleTelemetry && perRoleTelemetry.coder)
        || sanitizeProviderDiagnostic((error && error.message) || 'Provider process exited with a non-zero exit code or failed to respond.');
      retryable = true;
      suggestedAction = suggestedAction || 'Verify provider CLI connectivity and authentication, then retry.';
      break;

    case CORE_FAILURE_CODES.PLANNER_FAILED:
      stage = FAILURE_STAGES.PLANNING;
      message = message || 'The planner failed to produce a valid implementation plan.';
      details = details || (error && error.message) || 'Planner output was empty or invalid.';
      retryable = true;
      suggestedAction = suggestedAction || 'Retry planning with Core or simplify the task description.';
      break;

    case CORE_FAILURE_CODES.CODER_EXECUTION_FAILED:
      stage = FAILURE_STAGES.CODER;
      message = message || 'The coder failed to produce executable code.';
      details = details || (error && error.message) || 'Coder output could not be parsed into valid source code.';
      retryable = true;
      suggestedAction = suggestedAction || 'Retry code implementation with Core or continue without Core.';
      break;

    default:
      if (hasTimeout) {
        failureCode = CORE_FAILURE_CODES.UNRECOVERABLE_TIMEOUT;
        message = message || 'Execution timed out before completing.';
        details = details || 'Provider execution exceeded the configured timeout limit.';
        retryable = true;
        suggestedAction = suggestedAction || 'Retry task with Core or continue without Core.';
      } else if (fatalFailure) {
        failureCode = CORE_FAILURE_CODES.VERIFICATION_FAILED;
        stage = stage || FAILURE_STAGES.VERIFICATION;
        message = message || 'Implementation failed verification or introduced fatal safety violations.';
        details = details || (verificationEvidence && verificationEvidence.fatalViolation) || 'Automated verification detected defects.';
        retryable = false;
        retryUnavailableReason = 'Verification failed fatal check.';
        suggestedAction = suggestedAction || 'Continue without Core to resolve remaining defects.';
      } else {
        message = message || 'Core encountered an unrecoverable failure and cannot continue normally.';
        details = details || (error && error.message) || 'Orchestration could not complete successfully.';
        retryable = (explicitRetryable !== null && explicitRetryable !== undefined) ? Boolean(explicitRetryable) : false;
        retryUnavailableReason = retryable ? null : 'Unrecoverable execution error.';
        suggestedAction = suggestedAction || 'Continue without Core or review project logs.';
      }
      break;
  }

  const projectStateSafe = !hasSourceModifications;
  const projectState = projectStateSafe ? 'Safe' : 'Has partial modifications';

  return Object.freeze({
    status: 'FAILED',
    failureCode,
    stage,
    message,
    details,
    retryable,
    retryUnavailableReason,
    bypassAllowed: true,
    projectStateSafe,
    projectState,
    suggestedAction
  });
}

/**
 * Formats a clear user-facing failure prompt conforming to Section 2 of the specification.
 *
 * @param {object} failure Structured failure object
 * @returns {string} Banner text
 */
function formatFailurePrompt(failure) {
  const divider = '='.repeat(50);
  const stage = (failure && failure.stage) || 'General';
  const reason = (failure && failure.failureCode) || 'UNKNOWN_FAILURE';
  const details = (failure && (failure.details || failure.message)) || 'An unexpected failure occurred.';
  const projectState = (failure && failure.projectState) || (failure && failure.projectStateSafe ? 'Safe' : 'Has partial modifications');

  const lines = [
    divider,
    'CORE FAILURE',
    divider,
    '',
    'Core could not continue.',
    '',
    `Stage: ${stage}`,
    `Reason: ${reason}`,
    `Details: ${details}`,
    `Project state: ${projectState}`,
    '',
    'What would you like to do?',
    ''
  ];

  if (!failure || failure.retryable !== false) {
    lines.push('[R] Retry with Core');
  } else {
    lines.push(`Retry unavailable: ${failure.retryUnavailableReason || 'Condition cannot be resolved automatically'}`);
  }
  lines.push('[B] Continue without Core');
  lines.push('[C] Cancel');

  return lines.join('\n');
}

/**
 * Interactively prompts the user for failure decision using standard readline.
 *
 * @param {object} failure
 * @param {object} [options]
 * @returns {Promise<'RETRY' | 'BYPASS' | 'CANCEL' | null>}
 */
function promptFailureDecision(failure, options = {}) {
  return new Promise((resolve) => {
    const input = options.input || process.stdin;
    const output = options.output || process.stdout;

    const banner = formatFailurePrompt(failure);
    if (output && typeof output.write === 'function') {
      output.write('\n' + banner + '\n\n');
    }

    const rl = readline.createInterface({
      input,
      output
    });

    let answered = false;

    rl.question('Choice: ', (rawAnswer) => {
      answered = true;
      rl.close();
      const ans = normalizeFailureDecision(rawAnswer);
      resolve(ans);
    });

    rl.on('close', () => {
      if (!answered) {
        resolve(null);
      }
    });
  });
}

module.exports = {
  CORE_FAILURE_CODES,
  FAILURE_STAGES,
  FAILURE_DECISIONS,
  normalizeFailureDecision,
  buildFailureContract,
  sanitizeProviderDiagnostic,
  formatFailurePrompt,
  promptFailureDecision
};
