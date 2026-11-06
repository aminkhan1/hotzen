/**
 * 🌐 Universal Agent Core Hub - Execution Handoff
 * Phase 5.9 Extension: Execution Dispatch & Interactive Model Handoff
 *
 * Connects ModelAllocator output (PlanAllocationResult / ResolvedExecutionConfig)
 * to provider execution:
 * 1. Batch / Sandbox: Dispatches to provider adapter execution layer.
 * 2. Interactive Codex: Automatically enforces allocated Coder model onto the active
 *    Codex TUI thread via the App Server daemon without falsifying execution evidence.
 */

'use strict';

const { ClaudeCodeAdapter } = require('./adapters/claude_code_adapter');
const { CodexAdapter } = require('./adapters/codex_adapter');
const {
  updateCodexThreadSettings,
  resolveCodexThreadId,
  isInteractiveCodexSession,
  HANDOFF_STATUS
} = require('./adapters/codex_interactive_handoff');
const { isModelSwitchingEnabled, getModelSwitchingStatus } = require('./model_switching_toggle');

const SUPPORTED_PROVIDER_IDS = new Set(['codex', 'claude_code']);

/** Resolves a Core-managed Provider only from explicit/configured evidence. */
function resolveProviderId(candidates = [], { required = false } = {}) {
  const selected = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  const providerId = selected ? selected.trim() : null;
  if (!providerId) {
    if (required) throw new Error('Provider must be explicitly selected or configured before Core-managed use.');
    return null;
  }
  if (!SUPPORTED_PROVIDER_IDS.has(providerId)) {
    throw new Error(`Unsupported or unconfigured Core-managed Provider: '${providerId}'. Supported Providers: codex, claude_code.`);
  }
  return providerId;
}

function assertAdapterProvider(providerId, adapter) {
  if (adapter && adapter.providerId && adapter.providerId !== providerId) {
    throw new Error(`Configured Provider '${providerId}' does not match Adapter Provider '${adapter.providerId}'.`);
  }
}

/**
 * Resolves a default provider adapter instance for a given providerId.
 * @param {string} providerId
 * @returns {object} ProviderAdapter instance
 */
function getDefaultAdapter(providerId) {
  if (providerId === 'claude_code') {
    return new ClaudeCodeAdapter();
  }
  if (providerId === 'codex') {
    return new CodexAdapter();
  }
  throw new Error(`Unsupported or unconfigured provider for execution handoff: '${providerId}'`);
}

/**
 * Enforces the allocated Coder model on an active interactive Codex thread
 * via the local App Server control protocol.
 *
 * Strict Attribution Invariants:
 * - requestedModel: Model selected by ModelAllocator / policy.
 * - enforcedModel:  Model confirmed applied by App Server settings update RPC (null if not enforced).
 * - actualModel:    Observed execution telemetry (strictly null here; NEVER inferred from handoff).
 *
 * @param {object} planAllocationResult Output of ModelAllocator.allocatePlan, generateTaskPlan, or role config
 * @param {object} [options]
 * @param {boolean} [options.modelSwitchingEnabled] Explicit override for switching toggle
 * @param {string} [options.provider] Explicit provider override
 * @param {string} [options.threadId] Explicit threadId override
 * @param {object} [options.env] Environment override (defaults to process.env)
 * @param {string} [options.socketPath] Custom App Server control socket path
 * @param {number} [options.timeoutMs] Timeout in ms
 * @param {string} [options.cwd] Working directory for runtime_config inspection
 * @returns {Promise<object>} Handoff execution result
 */
async function enforceInteractiveModelHandoff(planAllocationResult, options = {}) {
  if (!planAllocationResult || typeof planAllocationResult !== 'object') {
    throw new TypeError('planAllocationResult must be a non-null object');
  }

  // 0. Forbidden flag assertion: model cannot be overridden or self-asserted
  if (options.model !== undefined ||
      options.enforcedModel !== undefined ||
      options['enforced-model'] !== undefined ||
      options.verifiedCurrentModel !== undefined ||
      options['verified-current-model'] !== undefined) {
    return {
      ok: false,
      status: 'failure',
      reason: 'forbidden_flag',
      error: 'Cannot specify model, enforcedModel, or verifiedCurrentModel. Active model cannot be self-asserted; evidence must be derived authoritatively from runtime protocol.',
      manualFallbackRequired: true,
      enforcedModel: null,
      actualModel: null
    };
  }

  // 1. Extract plan allocations and coder config
  const allocation = planAllocationResult.planAllocations || planAllocationResult;
  const coderConfig = (allocation.allocations && allocation.allocations.coder)
    || (planAllocationResult.coder)
    || (planAllocationResult.model ? planAllocationResult : null);

  let providerId;
  try {
    providerId = resolveProviderId([
      options.provider,
      (coderConfig && coderConfig.providerId),
      allocation.providerId,
      planAllocationResult.providerId,
      (planAllocationResult.runtimeConfig && planAllocationResult.runtimeConfig.provider)
    ], { required: true });
  } catch (error) {
    return {
      ok: false,
      status: 'failure',
      reason: 'provider_unresolved',
      error: error.message,
      providerId: null,
      requestedModel: coderConfig ? (coderConfig.model || null) : null,
      enforcedModel: null,
      actualModel: null,
      handoffAttempted: false,
      manualFallbackRequired: true
    };
  }

  const requestedModel = coderConfig ? (coderConfig.model || null) : null;
  const requestedReasoningEffort = coderConfig ? (coderConfig.reasoningEffort || null) : null;

  // 2. Non-Codex providers do not participate in Codex App Server handoff
  if (providerId !== 'codex') {
    return {
      ok: true,
      status: 'skipped',
      handoffStatus: 'skipped',
      reason: 'non_codex_provider',
      providerId,
      requestedModel,
      enforcedModel: null,
      actualModel: null,
      requestedReasoningEffort,
      enforcedReasoningEffort: null,
      actualReasoningEffort: null,
      handoffAttempted: false,
      manualFallbackRequired: false,
      message: `Interactive model handoff applies only to Codex; provider is '${providerId}'.`
    };
  }

  // 3. Respect model switching toggle: OFF => zero App Server handoff attempt
  const switchingFeatureDisabled = getModelSwitchingStatus({
    cwd: options.cwd || process.cwd(),
    configPath: options.configPath
  }).featureDisabled === true;
  let switchingEnabled = false;
  if (!switchingFeatureDisabled && typeof options.modelSwitchingEnabled === 'boolean') {
    switchingEnabled = options.modelSwitchingEnabled;
  } else if (!switchingFeatureDisabled && planAllocationResult.runtimeConfig && typeof planAllocationResult.runtimeConfig.modelSwitchingEnabled === 'boolean') {
    switchingEnabled = planAllocationResult.runtimeConfig.modelSwitchingEnabled;
  } else if (!switchingFeatureDisabled && typeof allocation.modelSwitchingEnabled === 'boolean') {
    switchingEnabled = allocation.modelSwitchingEnabled;
  } else if (!switchingFeatureDisabled) {
    try {
      switchingEnabled = isModelSwitchingEnabled({
        cwd: options.cwd || process.cwd(),
        configPath: options.configPath
      });
    } catch {
      switchingEnabled = false;
    }
  }

  if (!switchingEnabled) {
    return {
      ok: true,
      status: 'skipped',
      handoffStatus: 'skipped',
      reason: 'model_switching_disabled',
      executionPermitted: true,
      providerId: 'codex',
      requestedModel,
      enforcedModel: null,
      actualModel: null,
      verifiedCurrentModel: null,
      requestedReasoningEffort,
      enforcedReasoningEffort: null,
      actualReasoningEffort: null,
      handoffAttempted: false,
      manualFallbackRequired: false,
      message: 'Model Switching is disabled for V1. Preserving the host-selected model; no active-model attestation or Socket operation was performed.'
    };
  }

  if (!requestedModel) {
    return {
      ok: false,
      status: HANDOFF_STATUS.FAILURE,
      handoffStatus: HANDOFF_STATUS.FAILURE,
      reason: 'missing_requested_model',
      error: 'No model specified for coder role in plan allocations',
      providerId: 'codex',
      threadId: null,
      threadSource: null,
      requestedModel: null,
      enforcedModel: null,
      actualModel: null,
      requestedReasoningEffort: null,
      enforcedReasoningEffort: null,
      actualReasoningEffort: null,
      handoffAttempted: false,
      manualFallbackRequired: true,
      message: "No model allocated for coder role. Please run '/model' and select a model from the picker before proceeding."
    };
  }

  // 4. Attempt authoritative thread resolution and settings update RPC
  const handoffResult = await updateCodexThreadSettings({
    threadId: options.threadId,
    model: requestedModel,
    effort: requestedReasoningEffort,
    cwd: options.cwd
  }, {
    socketPath: options.socketPath,
    timeoutMs: options.timeoutMs,
    env: options.env,
    cwd: options.cwd,
    skipThreadReadVerification: options.skipThreadReadVerification
  });

  // 5. Handle successful handoff: model is enforced on live thread
  if (handoffResult.ok && (handoffResult.status === 'enforced' || handoffResult.status === HANDOFF_STATUS.SUCCESS)) {
    const threadId = handoffResult.threadId;
    const threadSource = handoffResult.threadResolutionSource || 'unknown';
    const enforcedModel = handoffResult.enforcedModel || requestedModel;

    // Persist handoff evidence to SQLite when receipt is present
    if (options.receipt && options.receipt.taskId && options.receipt.planDigest) {
      try {
        const { ExecutionHistoryStore } = require('./execution_history_store');
        const store = new ExecutionHistoryStore({ cwd: options.cwd || process.cwd() });
        store.recordHandoff({
          task_id: options.receipt.taskId,
          plan_digest: options.receipt.planDigest,
          provider: 'codex',
          thread_id: threadId,
          requested_model: requestedModel,
          enforced_model: enforcedModel,
          thread_resolution_source: threadSource,
          created_at: Date.now()
        });
        store.close();
      } catch {}
    }

    return {
      ok: true,
      status: 'enforced',
      handoffStatus: HANDOFF_STATUS.SUCCESS,
      providerId: 'codex',
      threadId,
      threadSource,
      requestedModel,
      enforcedModel,
      actualModel: null, // Invariant: actualModel is NEVER set or inferred from handoff!
      requestedReasoningEffort,
      enforcedReasoningEffort: requestedReasoningEffort,
      actualReasoningEffort: null,
      handoffAttempted: true,
      manualFallbackRequired: false,
      message: `Successfully enforced allocated model '${requestedModel}' on active Codex thread '${threadId}'.`,
      rawResponse: handoffResult.rawResponse
    };
  }

  // 6. Handle handoff failure (connection refused, rejected, timeout, etc.)
  const failStatus = handoffResult.status || HANDOFF_STATUS.FAILURE;
  const isResolutionFailure = !handoffResult.threadId && (failStatus === HANDOFF_STATUS.UNAVAILABLE || failStatus === HANDOFF_STATUS.FAILURE);
  const isUnsupported = failStatus === HANDOFF_STATUS.UNSUPPORTED || failStatus === 'unsupported';

  // Active model evidence cannot be self-asserted by caller or agent;
  // strictly derived from authenticated runtime protocol (null when unverified).
  const verifiedCurrentModel = null;

  if (verifiedCurrentModel) {
    const { getModelTierScore } = require('../workflow/handoff_executor');
    const requiredScore = getModelTierScore(requestedModel) || 1;
    const verifiedScore = getModelTierScore(verifiedCurrentModel);
    if (verifiedScore >= requiredScore) {
      return {
        ok: true,
        status: 'advisory_satisfied',
        handoffStatus: failStatus,
        executionPermitted: true,
        reason: 'runtime_switching_unsupported_safety_floor_satisfied',
        providerId: 'codex',
        threadId: handoffResult.threadId || null,
        threadSource: handoffResult.threadResolutionSource || null,
        requestedModel,
        enforcedModel: null,
        actualModel: null,
        verifiedCurrentModel,
        requestedReasoningEffort,
        enforcedReasoningEffort: null,
        actualReasoningEffort: null,
        handoffAttempted: !isResolutionFailure,
        manualFallbackRequired: false,
        message: `Runtime model switching could not be applied (${failStatus}). Verified current model '${verifiedCurrentModel}' satisfies safety floor for '${requestedModel}'. Managed execution under Core may proceed.`
      };
    }
  }

  if (isUnsupported || (verifiedCurrentModel && require('../workflow/handoff_executor').getModelTierScore(verifiedCurrentModel) < (require('../workflow/handoff_executor').getModelTierScore(requestedModel) || 1))) {
    return {
      ok: false,
      status: 'blocked_safety_floor',
      handoffStatus: failStatus,
      executionPermitted: false,
      reason: !verifiedCurrentModel ? 'current_model_unknown' : 'safety_floor_unmet',
      error: handoffResult.error,
      code: handoffResult.code,
      providerId: 'codex',
      threadId: handoffResult.threadId || null,
      threadSource: handoffResult.threadResolutionSource || null,
      requestedModel,
      enforcedModel: null,
      actualModel: null,
      verifiedCurrentModel: verifiedCurrentModel || null,
      requestedReasoningEffort,
      enforcedReasoningEffort: null,
      actualReasoningEffort: null,
      handoffAttempted: !isResolutionFailure,
      manualFallbackRequired: true,
      message: !verifiedCurrentModel
        ? `Host environment does not support runtime model switching (${failStatus}), and active model cannot be verified with trusted evidence. Safety Floor cannot be guaranteed.`
        : `Host environment does not support runtime model switching (${failStatus}), and verified model '${verifiedCurrentModel}' does not satisfy required Safety Floor for '${requestedModel}'.`
    };
  }

  const isSocketMissing = Boolean(
    handoffResult.error && (
      handoffResult.error.includes('socket not found') ||
      handoffResult.error.includes('app-server socket not found') ||
      handoffResult.error.includes('ENOENT')
    )
  );

  const unavailableOptions = (handoffResult.options && Array.isArray(handoffResult.options))
    ? handoffResult.options
    : (isSocketMissing ? [
        {
          id: 'retry',
          label: 'Retry handoff once Codex app-server socket connection is restored',
          action: 'core handoff --receipt="<receipt>"'
        },
        {
          id: 'switch_environment',
          label: 'Switch to a supported host/CLI environment or reconfigure model in host',
          action: 'Run within Codex CLI or launch with supported model configuration'
        },
        {
          id: 'unmanaged_continue',
          label: 'Proceed outside Core management (Unmanaged: will not be recorded as verified Core execution)',
          action: 'Manual continuation outside Core protocol'
        }
      ] : undefined);

  return {
    ok: false,
    status: failStatus,
    executionPermitted: false,
    handoffStatus: failStatus,
    reason: isResolutionFailure ? 'thread_resolution_failed' : (handoffResult.reason || undefined),
    error: handoffResult.error,
    code: handoffResult.code,
    providerId: 'codex',
    threadId: handoffResult.threadId || null,
    threadSource: handoffResult.threadResolutionSource || null,
    requestedModel,
    enforcedModel: null, // Invariant: never set on failure
    actualModel: null,   // Invariant: no fake actualModel
    verifiedCurrentModel: verifiedCurrentModel || null,
    requestedReasoningEffort,
    enforcedReasoningEffort: null,
    actualReasoningEffort: null,
    handoffAttempted: !isResolutionFailure,
    manualFallbackRequired: true,
    ...(unavailableOptions ? { options: unavailableOptions } : {}),
    message: handoffResult.message || `Failed to enforce model on Codex thread (${failStatus}: ${handoffResult.error}). Please run '/model' and select '${requestedModel}' from the picker before proceeding.`,
    rawResponse: handoffResult.rawResponse
  };
}

/**
 * Executes an allocated agent role prompt using the appropriate provider adapter.
 *
 * @param {object} planAllocationResult PlanAllocationResult from ModelAllocator
 * @param {string} role Role name to execute (e.g. 'coder', 'planner', 'tester', 'critic')
 * @param {string} prompt Prompt or command to execute (e.g. '/model' or task instructions)
 * @param {object} [options]
 * @param {object} [options.adapter] Custom adapter instance override
 * @returns {object} Execution result { ok, stdout, stderr, code, requestedModel, actualModel }
 */
function executeAllocatedRoleSync(planAllocationResult, role, prompt, options = {}) {
  if (!planAllocationResult || typeof planAllocationResult !== 'object') {
    throw new TypeError('planAllocationResult must be a non-null object');
  }
  if (!planAllocationResult.allocations || typeof planAllocationResult.allocations !== 'object') {
    throw new TypeError('planAllocationResult.allocations must be a non-null object');
  }
  const config = planAllocationResult.allocations[role];
  if (!config) {
    throw new Error(`Role '${role}' not found in plan allocations`);
  }

  const provider = resolveProviderId([
    options.provider,
    planAllocationResult.providerId,
    planAllocationResult.runtimeConfig && planAllocationResult.runtimeConfig.provider,
    config.providerId
  ], { required: true });
  if (config.providerId && config.providerId !== provider) {
    throw new Error(`Role Provider '${config.providerId}' does not match selected Provider '${provider}'.`);
  }
  assertAdapterProvider(provider, options.adapter);

  if (isInteractiveCodexSession(options, provider)) {
    throw new Error('Interactive model handoff is asynchronous. Use enforceInteractiveModelHandoff or await executeAllocatedRole(...).');
  }

  const adapter = options.adapter || getDefaultAdapter(provider);
  return adapter.executeSync(config, prompt, options);
}

/**
 * Asynchronous execution dispatch.
 * Automatically enforces interactive Codex model handoff when invoked from an active
 * interactive Codex session or when options.interactive is true.
 *
 * @param {object} planAllocationResult
 * @param {string} role
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function executeAllocatedRole(planAllocationResult, role, prompt, options = {}) {
  if (!planAllocationResult || typeof planAllocationResult !== 'object') {
    throw new TypeError('planAllocationResult must be a non-null object');
  }
  const config = planAllocationResult.allocations && planAllocationResult.allocations[role];
  const provider = resolveProviderId([
    options.provider,
    planAllocationResult.providerId,
    planAllocationResult.runtimeConfig && planAllocationResult.runtimeConfig.provider,
    config && config.providerId
  ], { required: true });
  if (config && config.providerId && config.providerId !== provider) {
    throw new Error(`Role Provider '${config.providerId}' does not match selected Provider '${provider}'.`);
  }
  assertAdapterProvider(provider, options.adapter);

  const isInteractive = isInteractiveCodexSession(options, provider);

  if (isInteractive) {
    const frozenV1 = !isModelSwitchingEnabled({ cwd: options.cwd || process.cwd(), configPath: options.configPath });
    return enforceInteractiveModelHandoff(planAllocationResult, {
      ...options,
      role,
      interactive: true,
      ...(frozenV1 ? { modelSwitchingEnabled: false } : {})
    });
  }
  return executeAllocatedRoleSync(planAllocationResult, role, prompt, options);
}

module.exports = {
  executeAllocatedRole,
  executeAllocatedRoleSync,
  enforceInteractiveModelHandoff,
  isInteractiveCodexSession,
  getDefaultAdapter,
  resolveProviderId,
  assertAdapterProvider
};
