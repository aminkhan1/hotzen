/**
 * 🌐 Universal Agent Core Hub - Plan Receipt Protocol
 * Task 4B2B2 Implementation: Portable, Non-Persistent Plan Correlation Receipt
 *
 * Responsibilities:
 * 1. Generates an opaque, self-contained base64url-encoded Plan Receipt for offline correlation.
 * 2. Encapsulates immutable plan metadata:
 *    - schema version ('core.plan_receipt.v1')
 *    - taskId & taskCategory
 *    - consumer workspace path
 *    - task prompt SHA-256 digest
 *    - creation timestamp
 *    - runtime configuration snapshot (modelSwitchingEnabled, selectedModel, provider)
 *    - Coder requested/allocated model & reasoning effort (from authoritative ModelAllocator)
 *    - canonical plan & allocation SHA-256 digest
 * 3. Enforces zero false execution claims: never includes or asserts actualModel or execution evidence.
 * 4. Adds non-cryptographic SHA-256 integrity digest to detect corruption or modification.
 * 5. Provides reusable validation and decoding functions for subsequent verification.
 * 6. Completely read-only: never writes receipt files or mutates workspace/memory state.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PLAN_RECEIPT_VERSION = 'core.plan_receipt.v1';
const NATIVE_PLAN_RECEIPT_VERSION = 'core.native_plan_receipt.v1';

/** Declared Native host identity is independent of a managed Provider ID. */
function nativeExecutorForHost(host) {
  if (host === 'antigravity') return 'antigravity_native';
  if (host === 'claude') return 'claude_native';
  return null;
}

/**
 * Resolves real canonical workspace path handling symlinks (e.g. macOS /tmp vs /private/tmp).
 *
 * @param {string} rawPath
 * @returns {string} Normalized absolute path
 */
function normalizeWorkspacePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  const resolved = path.resolve(rawPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Computes deterministic SHA-256 hex digest for an arbitrary string or object.
 *
 * @param {string|object} data
 * @returns {string} Hexadecimal SHA-256 digest
 */
function sha256Digest(data) {
  const content = (typeof data === 'string') ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Binds all planning inputs that can change the approved execution: task,
 * canonical workspace, parsed plan, role allocations, and runtime settings.
 * Project languages are resolved again when an imported bundle is validated.
 * @param {object} params
 * @returns {string}
 */
function computeApprovedPlanDigest(params = {}) {
  const taskPrompt = (typeof params.taskPrompt === 'string')
    ? params.taskPrompt.trim()
    : ((params.task && params.task.userPrompt) || '').trim();
  const workspacePath = normalizeWorkspacePath(params.workspacePath || params.cwd || process.cwd());
  let languages = null;
  try {
    const { getProjectLanguages } = require('../languages');
    languages = getProjectLanguages({ cwd: workspacePath });
  } catch {}

  return sha256Digest(canonicalize({
    task: params.task || {},
    taskPromptDigest: sha256Digest(taskPrompt),
    workspacePath,
    plan: params.plan || null,
    planAllocations: params.planAllocations || null,
    runtimeConfig: params.runtimeConfig || {},
    languages: Array.isArray(languages) ? languages : null
  }));
}

/**
 * Canonicalizes an object by sorting its keys recursively for deterministic hashing.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sortedKeys = Object.keys(value).sort();
  const result = {};
  for (const k of sortedKeys) {
    result[k] = canonicalize(value[k]);
  }
  return result;
}

/**
 * Creates an authoritative Plan Receipt for a generated task plan.
 *
 * @param {object} params
 * @param {object} params.task Task object with id and category
 * @param {string} params.taskPrompt Original task prompt string
 * @param {string} params.workspacePath Absolute path of consumer workspace
 * @param {object} [params.plan] Parsed plan structure
 * @param {object} params.planAllocations Authoritative allocations from ModelAllocator
 * @param {object} [params.runtimeConfig] Runtime configuration snapshot
 * @returns {string} Opaque base64url-encoded plan receipt string
 */
function createPlanReceipt(params = {}) {
  const task = params.task || {};
  const taskId = task.id || `TASK-${Date.now()}`;
  const taskCategory = task.category || 'general';

  const taskPrompt = (typeof params.taskPrompt === 'string')
    ? params.taskPrompt.trim()
    : (task.userPrompt || '').trim();

  if (!taskPrompt) {
    throw new Error('taskPrompt is required to create a Plan Receipt.');
  }

  const workspacePath = normalizeWorkspacePath(params.workspacePath || process.cwd());

  const planAllocations = params.planAllocations || {};
  const allocations = planAllocations.allocations || {};
  const coderConfig = allocations.coder || {};

  // Authoritative requested Coder model from Core allocation (not unallocated selectedModel)
  const coderRequestedModel = (coderConfig && typeof coderConfig.model === 'string' && coderConfig.model.trim())
    ? coderConfig.model.trim()
    : 'unknown';

  const coderRequestedReasoningEffort = (coderConfig && coderConfig.reasoningEffort !== undefined)
    ? coderConfig.reasoningEffort
    : null;

  const runtimeConfig = params.runtimeConfig || {};
  const modelSwitchingEnabled = Boolean(runtimeConfig.modelSwitchingEnabled);
  const selectedModel = (!modelSwitchingEnabled && typeof runtimeConfig.selectedModel === 'string' && runtimeConfig.selectedModel.trim())
    ? runtimeConfig.selectedModel.trim()
    : null;
  const native = runtimeConfig.executionKind === 'native';
  const provider = native ? null : runtimeConfig.provider || planAllocations.providerId || 'codex';
  if (native && (!nativeExecutorForHost(runtimeConfig.nativeHost) || runtimeConfig.provider !== null || runtimeConfig.providerModel !== null)) {
    throw new Error('Invalid Native host/Provider contract.');
  }
  const receiptVersion = native ? NATIVE_PLAN_RECEIPT_VERSION : PLAN_RECEIPT_VERSION;

  // Compute digests
  const taskPromptDigest = sha256Digest(taskPrompt);
  const planDigest = sha256Digest(canonicalize({
    taskId,
    providerId: provider,
    ...(native ? { executionKind: 'native', nativeHost: runtimeConfig.nativeHost } : {}),
    allocations
  }));
  const approvedPlanDigest = computeApprovedPlanDigest({
    task: { ...task, id: taskId, category: taskCategory, userPrompt: taskPrompt },
    taskPrompt,
    workspacePath,
    plan: params.plan || null,
    planAllocations,
    runtimeConfig
  });

  // Build canonical receipt payload
  // NOTE: Strict invariant - zero execution evidence fields (actualModel, verification, etc.)
  const payload = {
    version: receiptVersion,
    ...(native ? { executionKind: 'native', nativeHost: runtimeConfig.nativeHost, providerModel: null } : {}),
    taskId,
    taskCategory,
    workspacePath,
    taskPromptDigest,
    createdAt: Date.now(),
    modelSwitchingEnabled,
    selectedModel,
    provider,
    coderRequestedModel: native ? null : coderRequestedModel,
    coderRequestedReasoningEffort,
    planDigest,
    approvedPlanDigest,
    ...(params.plan && params.plan.verificationContract
      ? { verificationContract: params.plan.verificationContract }
      : {}),
    ...(params.plan && params.plan.semanticCriticReview && params.plan.semanticCriticReview.requested === true
      ? { semanticCriticReview: params.plan.semanticCriticReview }
      : {})
  };

  // Compute integrity checksum over canonical payload
  const integrityDigest = sha256Digest(canonicalize(payload));

  const envelope = {
    v: receiptVersion,
    payload,
    integrityDigest
  };

  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

/**
 * Decodes and validates a Plan Receipt.
 *
 * @param {string} receiptString Base64url-encoded receipt string
 * @param {object} [options] Validation constraints
 * @param {string} [options.workspace] Expected consumer workspace path
 * @param {string} [options.cwd] Expected consumer workspace path alias
 * @param {string} [options.taskPrompt] Expected task prompt to verify prompt digest
 * @returns {{ valid: boolean, payload?: object, error?: string, reason?: string, field?: string }}
 */
function validatePlanReceipt(receiptString, options = {}) {
  if (typeof receiptString !== 'string' || !receiptString.trim()) {
    return { valid: false, error: 'Plan receipt must be a non-empty string', reason: 'malformed_receipt' };
  }

  let envelope;
  try {
    const jsonStr = Buffer.from(receiptString.trim(), 'base64url').toString('utf8');
    envelope = JSON.parse(jsonStr);
  } catch (err) {
    return { valid: false, error: `Malformed receipt encoding: ${err.message}`, reason: 'malformed_receipt' };
  }

  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, error: 'Malformed receipt envelope structure', reason: 'malformed_receipt' };
  }

  if (![PLAN_RECEIPT_VERSION, NATIVE_PLAN_RECEIPT_VERSION].includes(envelope.v)) {
    return {
      valid: false,
      error: `Unsupported receipt version '${envelope.v}'. Expected '${PLAN_RECEIPT_VERSION}'`,
      reason: 'unsupported_version'
    };
  }

  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Receipt payload is missing or invalid', reason: 'malformed_payload' };
  }

  // Verify integrity digest over canonical payload
  const expectedDigest = sha256Digest(canonicalize(payload));
  if (envelope.integrityDigest !== expectedDigest) {
    return {
      valid: false,
      error: 'Receipt integrity failure: digest mismatch',
      reason: 'digest_mismatch'
    };
  }

  const native = envelope.v === NATIVE_PLAN_RECEIPT_VERSION;
  if (payload.version !== envelope.v || (native ?
      payload.executionKind !== 'native' || !nativeExecutorForHost(payload.nativeHost) || payload.provider !== null ||
      payload.providerModel !== null || payload.modelSwitchingEnabled !== false || payload.selectedModel !== null ||
      payload.coderRequestedModel !== null || payload.coderRequestedReasoningEffort !== null || payload.semanticCriticReview !== undefined
      : payload.executionKind !== undefined || payload.nativeHost !== undefined) ||
      (options.nativeHost !== undefined && (!native || options.nativeHost !== payload.nativeHost))) {
    return { valid: false, reason: 'native_host_contract_mismatch', error: 'Native host, execution kind or Provider contract mismatch.' };
  }

  // Required non-empty string / number fields assertion
  const requiredNonEmptyFields = [
    'version',
    'taskId',
    'taskCategory',
    'workspacePath',
    'taskPromptDigest',
    'createdAt',
    ...(native ? [] : ['coderRequestedModel']),
    'planDigest'
  ];

  for (const field of requiredNonEmptyFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      return {
        valid: false,
        error: `Receipt payload missing required field '${field}'`,
        reason: 'missing_required_field',
        field
      };
    }
  }

  // Fields that may be null, but must be defined:
  if (typeof payload.modelSwitchingEnabled !== 'boolean') {
    return {
      valid: false,
      error: "Receipt payload missing required field 'modelSwitchingEnabled'",
      reason: 'missing_required_field',
      field: 'modelSwitchingEnabled'
    };
  }

  if (payload.coderRequestedReasoningEffort === undefined) {
    return {
      valid: false,
      error: "Receipt payload missing required field 'coderRequestedReasoningEffort'",
      reason: 'missing_required_field',
      field: 'coderRequestedReasoningEffort'
    };
  }

  if (payload.selectedModel === undefined) {
    return {
      valid: false,
      error: "Receipt payload missing required field 'selectedModel'",
      reason: 'missing_required_field',
      field: 'selectedModel'
    };
  }

  // Invariant: Receipt MUST NOT contain execution evidence fields
  if ('actualModel' in payload || 'actualReasoningEffort' in payload || 'executionEvidence' in payload) {
    return {
      valid: false,
      error: 'Receipt contains invalid execution attribution fields (actualModel/executionEvidence forbidden in plan receipt)',
      reason: 'invalid_execution_claim'
    };
  }

  // Consumer workspace verification if provided
  const expectedWorkspace = options.workspace || options.cwd;
  if (expectedWorkspace) {
    const resolvedExpected = normalizeWorkspacePath(expectedWorkspace);
    const resolvedActual = normalizeWorkspacePath(payload.workspacePath);
    if (resolvedExpected !== resolvedActual) {
      return {
        valid: false,
        error: `Receipt workspace mismatch: generated for '${resolvedActual}', but validating in '${resolvedExpected}'`,
        reason: 'workspace_mismatch',
        payload
      };
    }
  }

  // Task prompt verification if provided
  if (typeof options.taskPrompt === 'string' && options.taskPrompt.trim()) {
    const expectedPromptDigest = sha256Digest(options.taskPrompt.trim());
    if (expectedPromptDigest !== payload.taskPromptDigest) {
      return {
        valid: false,
        error: 'Receipt task prompt mismatch: prompt digest does not match current task prompt',
        reason: 'task_prompt_mismatch',
        payload
      };
    }
  }

  if (options.requireApprovedPlanDigest === true) {
    if (typeof payload.approvedPlanDigest !== 'string' || !/^[a-f0-9]{64}$/.test(payload.approvedPlanDigest)) {
      return {
        valid: false,
        error: 'Plan receipt is missing the approved Plan Snapshot digest required for Engine execution.',
        reason: 'missing_approved_plan_digest',
        payload
      };
    }
    const expectedApprovedPlanDigest = computeApprovedPlanDigest({
      task: options.task,
      taskPrompt: options.taskPrompt,
      workspacePath: options.workspacePath || options.cwd || options.workspace,
      plan: options.plan,
      planAllocations: options.planAllocations,
      runtimeConfig: options.runtimeConfig
    });
    if (payload.approvedPlanDigest !== expectedApprovedPlanDigest) {
      return {
        valid: false,
        error: 'Approved Plan Snapshot digest does not match the imported Plan bundle.',
        reason: 'approved_plan_digest_mismatch',
        payload
      };
    }
  }

  return {
    valid: true,
    payload
  };
}

/**
 * Convenience decoder for a Plan Receipt.
 *
 * @param {string} receiptString
 * @param {object} [options]
 * @returns {object|null} Decoded payload or null if invalid
 */
function decodePlanReceipt(receiptString, options = {}) {
  const result = validatePlanReceipt(receiptString, options);
  return result.valid ? result.payload : null;
}

module.exports = {
  nativeExecutorForHost,
  createPlanReceipt,
  computeApprovedPlanDigest,
  validatePlanReceipt,
  decodePlanReceipt,
  canonicalize,
  sha256Digest,
  normalizeWorkspacePath,
  PLAN_RECEIPT_VERSION
};
