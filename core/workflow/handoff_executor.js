/**
 * 🤝 Agent Core Hub - Post-Approval Interactive Codex Handoff Gate
 *
 * Implements the authoritative post-approval handoff protocol:
 * After explicit user plan approval and BEFORE Codex edits workspace files,
 * Core authoritatively enforces the allocated coder model on the active Codex thread.
 *
 * Invariants:
 * 1. Zero provider/LLM network calls.
 * 2. Side-effect free receipt validation via unkeyed SHA-256 canonical integrity check.
 * 3. Requested model is derived strictly from the validated receipt (no --model or --enforced-model flags).
 * 4. Strict thread resolution precedence: explicit --thread-id -> process.env.CODEX_THREAD_ID -> App Server singleton -> fail closed.
 * 5. If model switching is disabled: status=skipped, reason=model_switching_disabled (zero mutation, zero fabricated evidence).
 * 6. Only successful App Server RPC acknowledgement records handoff evidence to SQLite execution_handoffs.
 * 7. actualModel is NEVER set, inferred, or fabricated.
 */

'use strict';

const path = require('path');
const { validatePlanReceipt } = require('./plan_receipt');
const { isModelSwitchingEnabled, getModelSwitchingStatus } = require('../allocation/model_switching_toggle');
const { ExecutionHistoryStore } = require('../allocation/execution_history_store');
const { TIER_SCORES, isTrustworthyProfile, modelAllocator } = require('../allocation/model_allocator');
const {
  updateCodexThreadSettings,
  resolveAuthoritativeCodexThreadId,
  canonicalizeWorkspacePath,
  formatManualFallbackMessage,
  HANDOFF_STATUS
} = require('../allocation/adapters/codex_interactive_handoff');

/**
 * Resolves capability tier score (1=lightweight, 2=balanced, 3=strong) for a given model.
 * Returns 0 if model is unknown or null.
 *
 * @param {string} [modelName]
 * @param {object} [profiles]
 * @returns {number}
 */
function getModelTierScore(modelName, profiles = null) {
  if (!modelName || typeof modelName !== 'string') return 0;
  const name = modelName.trim();
  const loadedProfiles = profiles || modelAllocator.profiles;
  const profile = loadedProfiles ? (loadedProfiles[name] || loadedProfiles[name.toLowerCase()]) : null;
  if (profile && isTrustworthyProfile(profile)) {
    return TIER_SCORES[profile.capabilityTier] || 1;
  }
  if (name.includes('sonnet') || name.includes('astra') || name.includes('opus')) return 3;
  if (name.includes('terra') || name.includes('fable') || name.includes('sol')) return 2;
  if (name.includes('haiku') || name.includes('luna') || name.includes('gpt-5.5')) return 1;
  return 0;
}

/**
 * Formats structured message for BLOCKED_SAFETY_FLOOR with explicit user choices.
 *
 * @param {string} requestedModel
 * @param {string|null} currentModel
 * @param {string} reason
 * @returns {string}
 */
function formatBlockedSafetyFloorMessage(requestedModel, currentModel, reason) {
  const lines = [
    '======================================================================',
    '🚫 Agent Core Hub - Managed Execution Blocked (Safety Floor)',
    '======================================================================',
    `Target Coder Requirement:  ${requestedModel || 'unknown'}`,
    `Current Active Model:     ${currentModel ? currentModel : 'unknown / unverified'}`,
    `Root Cause:               ${reason || 'Runtime switching unsupported and Safety Floor cannot be guaranteed'}`,
    '----------------------------------------------------------------------',
    'Safety Floor Invariant: Core strictly prohibits silent model downgrades',
    'or unverified model execution during managed tasks.',
    '',
    'Available Options:',
    '  1. Retry: Reconfigure the environment or thread and retry handoff:',
    '     core handoff --receipt="<receipt>" --thread-id="<session-uuid>"',
    '  2. Switch Environment / Model: Switch to a supported CLI/host environment',
    '     or manually switch to a model satisfying the safety floor in your host.',
    '  3. Proceed Outside Core (Unmanaged):',
    '     Continue implementation manually without Core management.',
    '     ⚠️ WARNING: Unmanaged execution will NOT be recorded as verified Core',
    '     execution and will not generate SQLite execution attempt records.',
    '======================================================================'
  ];
  return lines.join('\n');
}

/**
 * Executes post-approval interactive handoff for Codex.
 *
 * @param {object} options
 * @param {string} options.receipt Base64url encoded Plan Receipt string
 * @param {string} [options.threadId] Explicit Codex thread UUID
 * @param {string} [options.cwd] Target workspace directory
 * @param {string} [options.socketPath] Custom App Server control socket path
 * @param {number} [options.timeoutMs] RPC timeout
 * @param {object} [options.env] Environment override
 * @param {boolean} [options.skipThreadReadVerification] Bypass thread/read for mock testing
 * @param {string} [options.verifiedCurrentModel] Authoritative verified active model
 * @param {string} [options.model] Forbidden flag (triggers immediate rejection)
 * @param {string} [options.enforcedModel] Forbidden flag (triggers immediate rejection)
 * @returns {Promise<object>} Standard handoff outcome
 */
async function executeHandoff(options = {}) {
  // 1. Forbidden flag assertion: model cannot be overridden or self-asserted
  if (options.model !== undefined ||
      options.enforcedModel !== undefined ||
      options['enforced-model'] !== undefined ||
      options.verifiedCurrentModel !== undefined ||
      options['verified-current-model'] !== undefined) {
    return {
      ok: false,
      status: 'failure',
      reason: 'forbidden_flag',
      error: 'Cannot specify --model, --enforced-model, or --verified-current-model. Active model cannot be self-asserted; evidence must be derived authoritatively from runtime protocol.',
      manualFallbackRequired: true,
      enforcedModel: null,
      actualModel: null
    };
  }

  // 2. Receipt argument presence check
  const rawReceipt = options.receipt;
  if (!rawReceipt || typeof rawReceipt !== 'string' || !rawReceipt.trim()) {
    return {
      ok: false,
      status: 'failure',
      reason: 'missing_receipt',
      error: 'Plan receipt is required. Provide --receipt="<base64url-receipt>"',
      manualFallbackRequired: true,
      enforcedModel: null,
      actualModel: null
    };
  }

  const targetCwd = canonicalizeWorkspacePath(options.cwd || process.cwd());

  // 3. Receipt integrity validation (canonical unkeyed SHA-256 digest check)
  const receiptValidation = validatePlanReceipt(rawReceipt.trim(), { cwd: targetCwd });
  if (!receiptValidation.valid) {
    const errorMsg = `Receipt integrity failure: ${receiptValidation.error || receiptValidation.reason}`;
    return {
      ok: false,
      status: 'failure',
      reason: receiptValidation.reason || 'receipt_integrity_failure',
      error: errorMsg,
      manualFallbackRequired: true,
      enforcedModel: null,
      actualModel: null
    };
  }

  const receipt = receiptValidation.payload;
  const requestedModel = receipt.coderRequestedModel || null;
  const requestedReasoningEffort = receipt.coderReasoningEffort || null;

  if (!requestedModel) {
    return {
      ok: false,
      status: 'failure',
      reason: 'missing_requested_model',
      error: 'Receipt integrity valid, but payload is missing coderRequestedModel.',
      manualFallbackRequired: true,
      enforcedModel: null,
      actualModel: null
    };
  }

  // Active model evidence cannot be self-asserted by caller or agent;
  // strictly derived from authenticated runtime protocol (null when unverified).
  const verifiedCurrentModel = null;

  // 4. Model Switching Toggle Check: OFF => verify Safety Floor on fixed model
  let switchingEnabled = false;
  try {
    switchingEnabled = isModelSwitchingEnabled({ cwd: targetCwd });
  } catch {
    switchingEnabled = false;
  }

  if (!switchingEnabled) {
    const fixedModel = (typeof receipt.selectedModel === 'string' && receipt.selectedModel.trim())
      ? receipt.selectedModel.trim()
      : null;

    const requiredScore = getModelTierScore(requestedModel) || 1;
    const fixedScore = getModelTierScore(fixedModel);

    // Invariant: Disabling switching NEVER bypasses Safety Floor!
    if (!fixedModel || fixedScore < requiredScore) {
      return {
        ok: false,
        status: 'blocked_safety_floor',
        executionPermitted: false,
        handoffStatus: 'skipped',
        reason: !fixedModel ? 'current_model_unknown' : 'safety_floor_unmet',
        requestedModel,
        enforcedModel: null,
        actualModel: null,
        verifiedCurrentModel: fixedModel || null,
        threadId: null,
        threadResolutionSource: null,
        error: !fixedModel
          ? 'Model switching is disabled, and active fixed model is unknown. Safety Floor cannot be guaranteed.'
          : `Model switching is disabled, and fixed model '${fixedModel}' does not satisfy the safety floor required for '${requestedModel}'.`,
        options: [
          { id: 'retry', label: 'Re-plan with matching model' },
          { id: 'switch_environment', label: 'Enable model switching or select sufficient model' },
          { id: 'unmanaged_continue', label: 'Proceed outside Core (Unmanaged)' }
        ],
        message: formatBlockedSafetyFloorMessage(requestedModel, fixedModel, !fixedModel ? 'Model switching disabled with unknown fixed model' : 'Model switching disabled with insufficient fixed model')
      };
    }

    return {
      ok: true,
      status: 'skipped',
      executionPermitted: true,
      handoffStatus: 'skipped',
      reason: 'model_switching_disabled',
      requestedModel,
      enforcedModel: null,
      actualModel: null, // Invariant: actualModel is NEVER set or inferred
      verifiedCurrentModel: fixedModel,
      threadId: null,
      threadResolutionSource: null,
      message: `Model switching is disabled; fixed model '${fixedModel}' satisfies the safety floor for '${requestedModel}'. Preserving fixed model without interactive handoff.`
    };
  }

  // 5. Authoritative Thread Resolution
  // Strict precedence:
  // A. explicit --thread-id (verified via thread/read + workspace check)
  // B. process.env.CODEX_THREAD_ID (verified via thread/read + workspace check)
  // C. App Server singleton resolution (thread/loaded/list -> thread/read candidates -> workspace match)
  // D. otherwise fail closed
  const resolvedThread = await resolveAuthoritativeCodexThreadId({
    threadId: options.threadId,
    cwd: targetCwd
  }, {
    threadId: options.threadId,
    cwd: targetCwd,
    socketPath: options.socketPath,
    timeoutMs: options.timeoutMs,
    env: options.env,
    skipThreadReadVerification: options.skipThreadReadVerification
  });

  if (!resolvedThread.ok) {
    const rawStatus = resolvedThread.status || 'failure';
    const isUnsupported = rawStatus === HANDOFF_STATUS.UNSUPPORTED || rawStatus === 'unsupported' || options.unsupportedHost === true;
    const failStatus = isUnsupported ? 'unsupported' : (rawStatus === HANDOFF_STATUS.UNAVAILABLE ? 'unavailable' : rawStatus);
    const requiredScore = getModelTierScore(requestedModel) || 1;
    const verifiedScore = getModelTierScore(verifiedCurrentModel);

    // Graceful Degradation: If switching is unsupported by host or thread unavailable,
    // BUT current model is verified with valid evidence AND satisfies Safety Floor,
    // allow managed execution under Core with status 'advisory_satisfied'.
    if (verifiedCurrentModel && verifiedScore >= requiredScore) {
      return {
        ok: true,
        status: 'advisory_satisfied',
        executionPermitted: true,
        handoffStatus: failStatus,
        reason: 'runtime_switching_unsupported_safety_floor_satisfied',
        requestedModel,
        enforcedModel: null, // Invariant: NOT enforced via App Server
        actualModel: null,   // Invariant: actualModel is NEVER set or inferred
        verifiedCurrentModel,
        threadId: resolvedThread.threadId || null,
        threadResolutionSource: resolvedThread.threadResolutionSource || null,
        error: resolvedThread.error,
        code: resolvedThread.code,
        message: `Runtime model switching is unsupported or unavailable in current host (${resolvedThread.error || failStatus}). Verified current model '${verifiedCurrentModel}' satisfies safety floor for '${requestedModel}'. Managed execution under Core may proceed.`
      };
    }

    // If host is unsupported OR if safety floor was explicitly tested and unmet/unknown:
    if (isUnsupported || (verifiedCurrentModel && verifiedScore < requiredScore)) {
      return {
        ok: false,
        status: 'blocked_safety_floor',
        executionPermitted: false,
        handoffStatus: failStatus,
        reason: !verifiedCurrentModel ? 'current_model_unknown' : 'safety_floor_unmet',
        requestedModel,
        enforcedModel: null,
        actualModel: null,
        verifiedCurrentModel: verifiedCurrentModel || null,
        threadId: resolvedThread.threadId || null,
        threadResolutionSource: resolvedThread.threadResolutionSource || null,
        error: !verifiedCurrentModel
          ? `Host environment does not support runtime model switching (${resolvedThread.error || failStatus}), and active model cannot be verified with trusted evidence. Safety Floor cannot be guaranteed.`
          : `Host environment does not support runtime model switching (${resolvedThread.error || failStatus}), and verified model '${verifiedCurrentModel}' does not satisfy required Safety Floor for '${requestedModel}'.`,
        options: [
          {
            id: 'retry',
            label: 'Retry handoff with explicit thread ID or reconfigured environment',
            action: 'core handoff --receipt="<receipt>" --thread-id="<session-uuid>"'
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
        ],
        message: formatBlockedSafetyFloorMessage(requestedModel, verifiedCurrentModel, resolvedThread.error || failStatus)
      };
    }

    const isSocketMissing = Boolean(
      resolvedThread.error && (
        resolvedThread.error.includes('socket not found') ||
        resolvedThread.error.includes('app-server socket not found') ||
        resolvedThread.error.includes('ENOENT')
      )
    );

    const unavailableOptions = (resolvedThread.options && Array.isArray(resolvedThread.options))
      ? resolvedThread.options
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

    const finalMessage = isSocketMissing
      ? formatManualFallbackMessage(requestedModel, resolvedThread.error)
      : (resolvedThread.message || formatManualFallbackMessage(requestedModel, resolvedThread.error));

    return {
      ok: false,
      status: failStatus,
      executionPermitted: false,
      handoffStatus: failStatus,
      manualFallbackRequired: true,
      requestedModel,
      enforcedModel: null,
      actualModel: null,
      verifiedCurrentModel: verifiedCurrentModel || null,
      threadId: resolvedThread.threadId || null,
      threadResolutionSource: resolvedThread.threadResolutionSource || null,
      error: resolvedThread.error,
      code: resolvedThread.code,
      ...(unavailableOptions ? { options: unavailableOptions } : {}),
      message: finalMessage
    };
  }

  // 6. Settings Update RPC on Authoritative Resolved Thread
  const handoffResult = await updateCodexThreadSettings({
    threadId: resolvedThread.threadId,
    model: requestedModel,
    effort: requestedReasoningEffort
  }, {
    socketPath: options.socketPath,
    timeoutMs: options.timeoutMs,
    env: options.env
  });

  // 7. Handle successful handoff enforcement
  if (handoffResult.ok && (handoffResult.status === 'enforced' || handoffResult.status === HANDOFF_STATUS.SUCCESS)) {
    const threadId = resolvedThread.threadId;
    const threadResolutionSource = resolvedThread.threadResolutionSource || 'unknown';
    const enforcedModel = requestedModel;

    // Persist authoritative handoff evidence to SQLite execution_handoffs
    let handoffRowId = null;
    try {
      const historyStore = new ExecutionHistoryStore({ cwd: targetCwd });
      const recordRes = historyStore.recordHandoff({
        task_id: receipt.taskId,
        plan_digest: receipt.planDigest,
        provider: 'codex',
        thread_id: threadId,
        requested_model: requestedModel,
        enforced_model: enforcedModel,
        thread_resolution_source: threadResolutionSource,
        created_at: Date.now()
      });
      if (recordRes && recordRes.ok) {
        handoffRowId = recordRes.id;
      }
      historyStore.close();
    } catch {}

    return {
      ok: true,
      status: 'enforced',
      executionPermitted: true,
      handoffStatus: 'success',
      requestedModel,
      enforcedModel,
      actualModel: null, // Invariant: actualModel remains null/unset
      verifiedCurrentModel: enforcedModel,
      threadId,
      threadResolutionSource,
      handoffId: handoffRowId,
      message: `Receipt integrity valid. Successfully enforced allocated model '${requestedModel}' on active Codex thread '${threadId}' (${threadResolutionSource}).`
    };
  }

  // 8. Fail-closed behavior on settings update error (RPC failure, timeout, etc.)
  const rawStatus = handoffResult.status || 'failure';
  const isUnsupported = rawStatus === HANDOFF_STATUS.UNSUPPORTED || rawStatus === 'unsupported' || options.unsupportedHost === true;
  const failStatus = isUnsupported ? 'unsupported' : (rawStatus === HANDOFF_STATUS.UNAVAILABLE ? 'unavailable' : rawStatus);
  const requiredScore = getModelTierScore(requestedModel) || 1;
  const verifiedScore = getModelTierScore(verifiedCurrentModel);

  // Graceful Degradation check
  if (verifiedCurrentModel && verifiedScore >= requiredScore) {
    return {
      ok: true,
      status: 'advisory_satisfied',
      executionPermitted: true,
      handoffStatus: failStatus,
      reason: 'runtime_switching_unsupported_safety_floor_satisfied',
      requestedModel,
      enforcedModel: null, // Invariant: NOT enforced via App Server
      actualModel: null,   // Invariant: actualModel is NEVER set or inferred
      verifiedCurrentModel,
      threadId: resolvedThread.threadId,
      threadResolutionSource: resolvedThread.threadResolutionSource,
      error: handoffResult.error,
      code: handoffResult.code,
      message: `Runtime model switching could not be applied (${handoffResult.error || failStatus}). Verified current model '${verifiedCurrentModel}' satisfies safety floor for '${requestedModel}'. Managed execution under Core may proceed.`
    };
  }

  if (isUnsupported || (verifiedCurrentModel && verifiedScore < requiredScore)) {
    return {
      ok: false,
      status: 'blocked_safety_floor',
      executionPermitted: false,
      handoffStatus: failStatus,
      reason: !verifiedCurrentModel ? 'current_model_unknown' : 'safety_floor_unmet',
      requestedModel,
      enforcedModel: null, // Invariant: never fabricated on failure
      actualModel: null,
      verifiedCurrentModel: verifiedCurrentModel || null,
      threadId: resolvedThread.threadId,
      threadResolutionSource: resolvedThread.threadResolutionSource,
      error: !verifiedCurrentModel
        ? `Runtime model switching is unsupported (${handoffResult.error || failStatus}), and active model cannot be verified with trusted evidence. Safety Floor cannot be guaranteed.`
        : `Runtime model switching is unsupported (${handoffResult.error || failStatus}), and verified model '${verifiedCurrentModel}' does not satisfy required Safety Floor for '${requestedModel}'.`,
      options: [
        {
          id: 'retry',
          label: 'Retry handoff with explicit thread ID or reconfigured environment',
          action: 'core handoff --receipt="<receipt>" --thread-id="<session-uuid>"'
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
      ],
      message: formatBlockedSafetyFloorMessage(requestedModel, verifiedCurrentModel, handoffResult.error || failStatus)
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

  const finalMessage = isSocketMissing
    ? formatManualFallbackMessage(requestedModel, handoffResult.error)
    : (handoffResult.message || formatManualFallbackMessage(requestedModel, handoffResult.error));

  return {
    ok: false,
    status: failStatus,
    executionPermitted: false,
    handoffStatus: failStatus,
    manualFallbackRequired: true,
    requestedModel,
    enforcedModel: null, // Invariant: never fabricated on failure
    actualModel: null,
    verifiedCurrentModel: verifiedCurrentModel || null,
    threadId: resolvedThread.threadId,
    threadResolutionSource: resolvedThread.threadResolutionSource,
    error: handoffResult.error,
    code: handoffResult.code,
    ...(unavailableOptions ? { options: unavailableOptions } : {}),
    message: finalMessage
  };
}

module.exports = {
  executeHandoff,
  getModelTierScore,
  formatBlockedSafetyFloorMessage
};
