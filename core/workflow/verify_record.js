/**
 * 🌐 Universal Agent Core Hub - Truthful Verification & External Recording Pipeline
 * Task 4B2B3B3 Implementation: core verify --record --receipt=<planReceipt>
 *
 * Responsibilities:
 * 1. Enforces strict preconditions for recording:
 *    - Mandatory --receipt flag (fails closed if missing, zero rows).
 *    - Validates plan receipt integrity, schema version, and consumer workspace binding.
 *    - Enforces Runtime Snapshot Stale Guard (fails closed if switching or selectedModel changed).
 *    - Zero actual model inference (actual_model=null, model='unknown', requested_model from receipt).
 * 2. Executes truthful combined verification & critic (runVerificationWithCritic).
 * 3. Infrastructure Error Guard: infrastructure crashes are never recorded as model failures.
 * 4. Duplicate Guard: idempotent check preventing duplicate recording of the same external attempt.
 * 5. Persists exactly one external coder attempt on genuine outcome:
 *    - task_id = receipt.taskId
 *    - task_category = receipt.taskCategory
 *    - role = 'coder'
 *    - model = 'unknown'
 *    - requested_model = receipt.coderRequestedModel
 *    - actual_model = null
 *    - executor = 'codex_interactive'
 *    - attribution_source = 'unverified_external'
 *    - attempt_type = 'initial'
 *    - verification_passed = outcome.verificationPassed ? 1 : 0
 *    - critic_passed = outcome.criticPassed ? 1 : 0
 *    - success = outcome.success ? 1 : 0
 *    - tokens = null, cost = null, duration_ms = null
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validatePlanReceipt, sha256Digest, canonicalize, nativeExecutorForHost } = require('./plan_receipt');
const { runVerificationWithCritic } = require('./verification_with_critic');
const { getModelSwitchingStatus } = require('../allocation/model_switching_toggle');
const { ExecutionHistoryStore, storageErrorCode } = require('../allocation/execution_history_store');
const { safeResolveWorkspacePath } = require('./project_artifact_extractor');
const { compareVerificationContract, validateApprovedFileStates, readApprovedFileState } = require('./verification_contract');
const { CodexAdapter } = require('../allocation/adapters/codex_adapter');

function digestApprovedFiles(targetDir, approvedFiles, verificationContract = null) {
  if (!Array.isArray(approvedFiles) || approvedFiles.length === 0) {
    return { ok: false, reason: 'empty_approved_scope' };
  }
  let root;
  try { root = fs.realpathSync(targetDir); } catch { return { ok: false, reason: 'workspace_unavailable' }; }
  const fileStates = verificationContract && verificationContract.fileStates;
  if (fileStates !== undefined && fileStates !== null && !validateApprovedFileStates(fileStates, approvedFiles).ok) {
    return { ok: false, reason: 'invalid_approved_file_states' };
  }
  if (verificationContract && Object.prototype.hasOwnProperty.call(verificationContract, 'fileStates') && !fileStates) {
    return { ok: false, reason: 'invalid_approved_file_states' };
  }
  const entries = [];
  const seen = new Set();
  for (const file of approvedFiles) {
    if (typeof file !== 'string' || !file.trim()) return { ok: false, reason: 'invalid_approved_file' };
    // Older Bundles accepted relative spellings such as ./src/app.js. Keep
    // their canonical digest; new state contracts require exact canonical keys.
    const relative = fileStates ? file
      : path.relative(root, path.resolve(root, file.trim().replace(/\\/g, '/'))).split(path.sep).join('/');
    if (seen.has(relative)) {
      return { ok: false, reason: 'invalid_approved_file' };
    }
    seen.add(relative);
    const current = readApprovedFileState(root, relative);
    if (!current.ok) return current;
    const expected = fileStates ? fileStates.entries.find(entry => entry.file === relative).expectedState : 'present';
    if (current.state !== expected) {
      return { ok: false, reason: current.state === 'absent' ? 'unexpected_missing_approved_file' : 'approved_absence_not_applied',
        file: relative, error: fileStates ? `Approved path state mismatch: ${relative}; expected ${expected}.`
          : `Missing approved file: ${relative}; deletion authorization is unavailable. Create a fresh Plan (replan).` };
    }
    entries.push(fileStates ? { file: relative, state: current.state, digest: current.digest }
      : { file: relative, digest: current.digest });
  }
  entries.sort((a, b) => a.file < b.file ? -1 : (a.file > b.file ? 1 : 0));
  return { ok: true, digest: sha256Digest(canonicalize(entries)), files: entries.map(entry => entry.file), workspace: root };
}

function nativeRoleEvidence(outcome) {
  return {
    coder: 'external_unverified',
    tester: outcome && outcome.verification && outcome.verification.executedCount > 0
      ? 'core_observed' : 'not_executed',
    critic: outcome && outcome.critic ? 'core_observed' : 'not_executed',
    leader: outcome && outcome.leaderDecision ? 'core_observed' : 'not_executed',
    semanticCritic: outcome && outcome.semanticReview && outcome.semanticReview.status !== 'NOT_REQUESTED'
      ? (outcome.semanticReview.provenance || 'core_observed') : 'not_requested',
    recovery: 'not_executed'
  };
}

function isTrustedNativeSemanticCriticAdapter(adapter) {
  return adapter instanceof CodexAdapter &&
    adapter.providerId === 'codex' &&
    adapter.supportsReadOnlySemanticCritic === true &&
    adapter.cliPath === 'codex' &&
    adapter.execRunner === null;
}

function priorNativeAttempt(dbPath, taskId, executor = 'codex_interactive') {
  try {
    if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return { ok: true, attempt: null };
  } catch (error) { return { ok: false, error: storageErrorCode(error) }; }
  const history = new ExecutionHistoryStore({ dbPath, readOnly: true });
  if (!history.isAvailable()) {
    const error = history.initError ? storageErrorCode(history.initError) : 'history_unavailable';
    history.close();
    return { ok: false, error };
  }
  try {
    const attempts = history.db.prepare(`
      SELECT * FROM execution_attempts
      WHERE task_id = ? AND executor = ? AND role = 'coder'
      ORDER BY id DESC
    `).all(taskId, executor);
    return { ok: true, attempt: attempts.find(row => row.verification_origin === 'core_observed_native') || null };
  } catch (error) {
    return { ok: false, error: storageErrorCode(error) };
  } finally {
    history.close();
  }
}

/**
 * Retrieves all prior external coder attempts for a specific task.
 *
 * @param {ExecutionHistoryStore} historyStore
 * @param {string} taskId
 * @param {string} [executor='codex_interactive']
 * @param {string} [role='coder']
 * @returns {Array<object>}
 */
function getExistingCoderAttempts(historyStore, taskId, executor = 'codex_interactive', role = 'coder', strict = false) {
  if (!historyStore) return strict ? null : [];
  if (!historyStore.isAvailable()) {
    if (!historyStore.init()) return strict ? null : [];
  }
  try {
    const stmt = historyStore.db.prepare(`
      SELECT id, task_id, task_category, role, model, attempt_type, attempt_index, success,
             verification_passed, critic_passed, requested_model, enforced_model, actual_model,
             executor, attribution_source, created_at, plan_digest, approved_plan_digest,
             workspace_path, verified_files_digest, verification_origin,
             verification_executed_count, critic_executed
      FROM execution_attempts
      WHERE task_id = ? AND executor = ? AND role = ?
      ORDER BY attempt_index ASC, id ASC
    `);
    return stmt.all(taskId, executor, role) || [];
  } catch {
    return strict ? null : [];
  }
}

/**
 * Executes verification and truthful external attempt recording.
 *
 * @param {string} targetDir Target consumer workspace directory
 * @param {object} options
 * @param {string} [options.receipt] Opaque base64url Plan Receipt string
 * @param {string} [options.scope='changed'] Scope of verification ('changed' | 'full')
 * @param {Function} [options.verifierFn] Verifier function override
 * @param {Function} [options.criticFn] Critic function override
 * @param {boolean} [options.allowEmptyDiff] Allow 0 changed files override
 * @param {string[]} [options.changedFiles] Explicit changed files list override
 * @returns {{
 *   ok: boolean,
 *   recorded: boolean,
 *   alreadyRecorded: boolean,
 *   recordId: number | null,
 *   attempt: object | null,
 *   error: string | null,
 *   reason: string | null,
 *   details?: object,
 *   outcome: object | null,
 *   receipt: object | null
 * }}
 */
function runVerifyRecord(targetDir = process.cwd(), options = {}) {
  const resolvedDir = path.resolve(targetDir);
  const native = options.native === true;

  // Forbidden CLI options guard: enforced model is never accepted from user input
  if (options.enforcedModel !== undefined || options.model !== undefined || options['enforced-model'] !== undefined) {
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: false,
      recordId: null,
      attempt: null,
      error: 'Forbidden option: --enforced-model and --model cannot be provided to verify --record. Enforced model is derived authoritatively from stored handoff evidence.',
      reason: 'forbidden_enforced_model_option',
      outcome: null,
      receipt: null
    };
  }

  // Unmanaged execution guard: tasks executed outside Core management must never be recorded
  if (options.unmanaged || options.bypassCore || options['bypass-core']) {
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: false,
      recordId: null,
      attempt: null,
      error: 'Cannot record unmanaged execution: unmanaged executions running outside Core are strictly barred from Core execution history recording.',
      reason: 'unmanaged_execution_bypassed_core',
      outcome: null,
      receipt: null
    };
  }

  if (native && options.nativeApprovalConfirmed !== true) {
    return {
      ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error: 'Native Core Verification requires a separate interactive owner confirmation.',
      reason: 'native_approval_required', outcome: null, receipt: null
    };
  }
  if (native && (options.verifierFn || options.criticFn || options.execRunner ||
      (options.semanticCriticAdapter && !isTrustedNativeSemanticCriticAdapter(options.semanticCriticAdapter)))) {
    return {
      ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error: 'Native Core Verification cannot accept supplied verifier, critic, Adapter, or command results.',
      reason: 'native_supplied_evidence_forbidden', outcome: null, receipt: null
    };
  }

  const receiptString = options.receipt;

  // 1. Precondition: --record requires --receipt
  if (!receiptString || typeof receiptString !== 'string' || !receiptString.trim()) {
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: false,
      recordId: null,
      attempt: null,
      error: 'Missing required --receipt flag when --record is specified',
      reason: 'missing_receipt',
      outcome: null,
      receipt: null
    };
  }

  // 2 & 3. Validate Plan Receipt against target workspace
  const receiptValidation = validatePlanReceipt(receiptString.trim(), { cwd: resolvedDir });
  if (!receiptValidation.valid) {
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: false,
      recordId: null,
      attempt: null,
      error: receiptValidation.error,
      reason: receiptValidation.reason || 'invalid_receipt',
      outcome: null,
      receipt: receiptValidation.payload || null
    };
  }

  const receipt = receiptValidation.payload;
  const explicitNativeHost = receipt.executionKind === 'native';
  const executor = explicitNativeHost ? nativeExecutorForHost(receipt.nativeHost) : 'codex_interactive';
  if (explicitNativeHost && (!native || options.nativeHost !== receipt.nativeHost ||
      ['provider', 'providerModel', 'adapter', 'catalog', 'allocator', 'modelSwitchingEnabled',
        'semanticCriticPolicy', 'semanticCriticAdapter', 'providerCallBudget'].some(key => options[key] !== undefined))) {
    return { ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      reason: 'native_host_contract_mismatch', error: 'Explicit supported Native host and zero Provider options required.', outcome: null, receipt };
  }
  if (!explicitNativeHost && options.nativeHost !== undefined) {
    return { ok: false, recorded: false, recordId: null, reason: 'native_host_contract_mismatch', outcome: null, receipt };
  }
  let verificationContract = null;
  let approvedFiles = null;
  if (receipt.verificationContract) {
    const bundle = options.planBundle;
    if (!bundle || bundle.planReceipt !== receiptString.trim()) {
      return {
        ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
        error: 'This Receipt requires its original approved Plan bundle for Verification.',
        reason: 'missing_or_mismatched_plan_bundle', outcome: null, receipt
      };
    }
    const { validateImportedPlanBundle } = require('../../cli');
    const binding = validateImportedPlanBundle(bundle, {
      cwd: resolvedDir,
      taskPrompt: bundle.task && bundle.task.userPrompt,
      ...(explicitNativeHost ? { nativeHost: options.nativeHost } : { provider: receipt.provider })
    });
    if (!binding.valid) {
      return {
        ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
        error: binding.error, reason: binding.reason || 'invalid_plan_bundle', outcome: null, receipt
      };
    }
    if (binding.snapshot.plan.managedExecutionPolicy === 'checkpoint_after_implementation') {
      return {
        ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
        reason: 'managed_checkpoint_verification_required',
        error: 'Legacy Verification cannot verify a managed checkpoint Plan.', outcome: null, receipt
      };
    }
    verificationContract = receipt.verificationContract;
    approvedFiles = bundle.approvedPlanSnapshot.filesToModify;
  }
  if (native && ((!explicitNativeHost && receipt.provider !== 'codex') || !verificationContract || !Array.isArray(approvedFiles))) {
    return {
      ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error: 'Native Core Verification requires a Codex Plan with an approved Verification Contract and complete Bundle.',
      reason: 'native_plan_contract_required', outcome: null, receipt
    };
  }

  // 4. Runtime Snapshot Stale Guard
  const currentStatus = getModelSwitchingStatus({ cwd: resolvedDir });
  const currentSwitching = Boolean(currentStatus.enabled);
  const currentSelected = (typeof currentStatus.selectedModel === 'string' && currentStatus.selectedModel.trim())
    ? currentStatus.selectedModel.trim()
    : null;

  const receiptSwitching = Boolean(receipt.modelSwitchingEnabled);
  const receiptSelected = (typeof receipt.selectedModel === 'string' && receipt.selectedModel.trim())
    ? receipt.selectedModel.trim()
    : null;

  // Rule 1: Switching state mismatch is always stale (ON -> OFF or OFF -> ON)
  const switchingMismatch = (currentSwitching !== receiptSwitching);

  // Rule 2: When switching is OFF, selectedModel is authoritative and changes after planning invalidate the receipt.
  // Rule 3: When switching is ON, adaptive allocation is authoritative; raw/stale selectedModel differences must NOT invalidate the receipt.
  const selectedModelMismatch = (!currentSwitching && !receiptSwitching) && (currentSelected !== receiptSelected);

  if (!explicitNativeHost && (switchingMismatch || selectedModelMismatch)) {
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: false,
      recordId: null,
      attempt: null,
      error: 'Stale Plan Receipt: runtime model configuration has changed since planning',
      reason: 'stale_plan_receipt',
      details: {
        modelSwitchingEnabled: { receipt: receiptSwitching, current: currentSwitching },
        selectedModel: { receipt: receiptSelected, current: currentSelected }
      },
      outcome: null,
      receipt
    };
  }

  const nativeBefore = native ? digestApprovedFiles(resolvedDir, approvedFiles, verificationContract) : null;
  if (native && !nativeBefore.ok) {
    return {
      ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error: nativeBefore.error || `Approved files cannot be fingerprinted safely: ${nativeBefore.reason}${nativeBefore.file ? ` (${nativeBefore.file})` : ''}`,
      reason: nativeBefore.reason, outcome: null, receipt
    };
  }
  if (native && options.expectedVerifiedFilesDigest &&
      options.expectedVerifiedFilesDigest !== nativeBefore.digest) {
    return { ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error: 'Approved files changed after Agent-mediated owner approval.',
      reason: 'approval_execution_digest_mismatch', outcome: null, receipt,
      verifiedFilesDigest: nativeBefore.digest };
  }
  const nativeDbPath = native
    ? path.join(nativeBefore.workspace, '.agents', 'memory', 'database.sqlite') : null;
  if (native) {
    const currentContract = compareVerificationContract(resolvedDir, verificationContract, { expectedFiles: approvedFiles });
    if (!currentContract.ok || verificationContract.status !== 'ready') {
      return { ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
        error: currentContract.reason || 'Approved verification tools are unavailable.',
        reason: 'verification_contract_changed', outcome: null, receipt };
    }
    const previous = priorNativeAttempt(nativeDbPath, receipt.taskId, executor);
    if (!previous.ok) {
      return { ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
        error: previous.error, reason: 'history_unavailable', outcome: null, receipt };
    }
    if (previous.attempt) {
      const sameVersion = previous.attempt.approved_plan_digest === receipt.approvedPlanDigest &&
        previous.attempt.verified_files_digest === nativeBefore.digest &&
        previous.attempt.workspace_path === nativeBefore.workspace;
      return {
        ok: sameVersion && previous.attempt.success === 1,
        recorded: false, alreadyRecorded: sameVersion, recordId: previous.attempt.id,
        attempt: previous.attempt,
        error: sameVersion && previous.attempt.success === 0 ? 'A failed Native attempt needs a fresh Plan and owner choice.'
          : (sameVersion ? null : 'This Task was already recorded for a different Plan or file version.'),
        reason: sameVersion ? (previous.attempt.success === 1 ? 'already_recorded' : 'native_retry_requires_new_plan')
          : 'native_plan_already_recorded_for_different_files',
        outcome: null, receipt, verifiedFilesDigest: nativeBefore.digest,
        verificationOrigin: 'previous_core_observed_record', scopeOutsideApprovedFiles: 'Unknown',
        roleEvidence: {
          coder: 'external_unverified',
          tester: Number(previous.attempt.verification_executed_count) > 0 ? 'core_observed_previous' : 'Unknown',
          critic: previous.attempt.critic_executed === 1 ? 'core_observed_previous' : 'Unknown',
          semanticCritic: previous.attempt.semantic_review_status || 'Unknown',
          leader: previous.attempt.leader_decision_json ? 'core_observed_previous' : 'Unknown',
          recovery: 'Unknown'
        }
      };
    }
  }

  // 5 & 6. Execute Combined Verification & Critic
  const outcome = runVerificationWithCritic(resolvedDir, {
    ...options,
    scope: options.scope || 'changed',
    ...(verificationContract ? { verificationContract, expectedFiles: approvedFiles } : {}),
    ...(native ? {
      changedFiles: nativeBefore.files,
      allowEmptyDiff: false,
      semanticCriticPolicy: receipt.semanticCriticReview || { requested: false },
      approvedPlanSnapshot: options.planBundle && options.planBundle.approvedPlanSnapshot,
      acceptanceCriteria: options.planBundle && options.planBundle.plan && options.planBundle.plan.acceptanceCriteria || [],
      providerCallBudget: receipt.semanticCriticReview && receipt.semanticCriticReview.requested === true
        ? { limit: receipt.semanticCriticReview.maxProviderCalls, reserved: 0 } : null,
      semanticScopeEvidence: nativeBefore.files.map((file, index) => {
        try {
          const content = fs.readFileSync(safeResolveWorkspacePath(resolvedDir, file), 'utf8');
          return { id: `file:${file}`, type: 'approved_scope_file', path: file, content: content.slice(0, 20000), truncated: content.length > 20000 };
        } catch { return { id: `file:${file}`, type: 'approved_scope_file', path: file, unavailable: true }; }
      })
    } : {})
  });

  const nativeAfter = native ? digestApprovedFiles(resolvedDir, approvedFiles, verificationContract) : null;
  if (native && (!nativeAfter.ok || nativeAfter.digest !== nativeBefore.digest)) {
    return {
      ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error: 'Approved files changed or became unavailable during Core Verification and Critic.',
      reason: 'workspace_changed_during_verification', outcome, receipt,
      roleEvidence: nativeRoleEvidence(outcome)
    };
  }

  // 7. Infrastructure Error Guard
  if (outcome.failureType === 'infrastructure_error') {
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: false,
      recordId: null,
      attempt: null,
      error: outcome.infrastructureError
        ? outcome.infrastructureError.message
        : 'Verification infrastructure crash',
      reason: 'infrastructure_error',
      outcome,
      receipt,
      ...(native ? { roleEvidence: nativeRoleEvidence(outcome), verifiedFilesDigest: nativeBefore.digest,
        scopeOutsideApprovedFiles: 'Unknown' } : {})
    };
  }

  // 8. Duplicate Guard & Retry Semantics:
  // - No previous attempt: record attempt_type='initial', attempt_index=0
  // - Previous successful attempt: keep idempotent behavior, do not create another row
  // - Previous failed attempt + current verification succeeds:
  //   preserve failed row, record attempt_type='recovery', attempt_index=next, success=1
  // - Previous failed attempt + current verification fails:
  //   keep idempotent behavior, return alreadyRecorded pointing to latest failure
  const historyStore = native
    ? new ExecutionHistoryStore({ dbPath: nativeDbPath })
    : new ExecutionHistoryStore({ cwd: resolvedDir });

  const existingAttempts = getExistingCoderAttempts(historyStore, receipt.taskId,
    executor, 'coder', native);
  if (native && existingAttempts === null) {
    const error = historyStore.initError ? storageErrorCode(historyStore.initError) : 'history_unavailable';
    historyStore.close();
    return { ok: false, recorded: false, alreadyRecorded: false, recordId: null, attempt: null,
      error, reason: 'history_unavailable', outcome, receipt, verifiedFilesDigest: nativeBefore.digest,
      roleEvidence: nativeRoleEvidence(outcome), scopeOutsideApprovedFiles: 'Unknown' };
  }
  const successfulAttempt = existingAttempts.find(a => a.success === 1);

  if (!native && successfulAttempt) {
    historyStore.close();
    return {
      ok: outcome.success,
      recorded: false,
      alreadyRecorded: true,
      recordId: successfulAttempt.id,
      attempt: successfulAttempt,
      error: null,
      reason: 'already_recorded',
      outcome,
      receipt
    };
  }

  if (!native && existingAttempts.length > 0 && !outcome.success) {
    const latestAttempt = existingAttempts[existingAttempts.length - 1];
    historyStore.close();
    return {
      ok: false,
      recorded: false,
      alreadyRecorded: true,
      recordId: latestAttempt.id,
      attempt: latestAttempt,
      error: null,
      reason: 'already_recorded',
      outcome,
      receipt
    };
  }

  let attemptType = 'initial';
  let attemptIndex = 0;

  if (!native && existingAttempts.length > 0) {
    attemptType = 'recovery';
    const maxPriorIndex = existingAttempts.reduce((max, a) => {
      const idx = typeof a.attempt_index === 'number' ? a.attempt_index : 0;
      return idx > max ? idx : max;
    }, -1);
    attemptIndex = maxPriorIndex + 1;
  }

  // 9. Resolve Authoritative Stored Handoff Evidence
  const handoffResolution = native ? null : historyStore.resolveAuthoritativeHandoff({
    task_id: receipt.taskId,
    plan_digest: receipt.planDigest
  });

  let authoritativeEnforcedModel = null;
  let handoffAmbiguity = null;
  if (handoffResolution && handoffResolution.status === 'unique') {
    authoritativeEnforcedModel = handoffResolution.enforcedModel;
  } else if (handoffResolution && handoffResolution.status === 'ambiguous') {
    handoffAmbiguity = {
      status: 'ambiguous',
      reason: 'multiple_distinct_handoffs',
      distinctCount: handoffResolution.distinctCount
    };
  }

  // 10. Persist Truthful External Attempt
  const recordPayload = {
    task_id: receipt.taskId,
    task_category: receipt.taskCategory,
    role: 'coder',
    model: 'unknown',
    requested_model: receipt.coderRequestedModel,
    enforced_model: authoritativeEnforcedModel,
    actual_model: null,
    executor,
    attribution_source: 'unverified_external',
    attempt_type: attemptType,
    attempt_index: attemptIndex,
    verification_passed: outcome.verificationPassed ? 1 : 0,
    critic_passed: outcome.criticPassed ? 1 : 0,
    success: outcome.success ? 1 : 0,
    tokens: null,
    cost: null,
    duration_ms: null,
    environment: 'production',
    ...(native && options.planBundle ? {
      history_metadata: require('../../cli').buildApprovedHistoryMetadata(options.planBundle, {
        cwd: resolvedDir, taskPrompt: options.planBundle.task.userPrompt,
        ...(explicitNativeHost ? { nativeHost: options.nativeHost } : { provider: receipt.provider })
      })
    } : {}),
    ...(native ? {
      plan_digest: receipt.planDigest,
      approved_plan_digest: receipt.approvedPlanDigest,
      workspace_path: nativeBefore.workspace,
      verified_files_digest: nativeBefore.digest,
      verification_origin: 'core_observed_native',
      verification_executed_count: outcome.verification ? outcome.verification.executedCount : 0,
      critic_executed: outcome.critic ? 1 : 0,
      semantic_review_status: outcome.semanticReview && outcome.semanticReview.status || 'NOT_REQUESTED',
      semantic_review: outcome.semanticReview || { status: 'NOT_REQUESTED', provenance: 'not_requested' },
      leader_decision: outcome.leaderDecision || null,
      role_provenance: { ...nativeRoleEvidence(outcome),
        ...(explicitNativeHost ? { executionKind: 'native', nativeHost: receipt.nativeHost } : {}) },
      ...(options.approvalProvenance ? { approval_provenance: options.approvalProvenance } : {}),
      fatal_violation: outcome.failureType || null
    } : {})
  };

  const recordResult = historyStore.recordAttempt(recordPayload);
  const recordId = (recordResult && recordResult.ok && typeof recordResult.id === 'number')
    ? recordResult.id
    : null;

  historyStore.close();

  const recordSuccess = Boolean(recordResult && recordResult.ok);

  return {
    // Checks may pass while persistence fails. Keep outcome intact, but the
    // combined --record operation succeeds only when both actually succeed.
    ok: Boolean(outcome.success && recordSuccess),
    recorded: recordSuccess,
    alreadyRecorded: false,
    recordId,
    ...(native ? {
      verifiedFilesDigest: nativeBefore.digest,
      verificationOrigin: 'core_observed_native',
      scopeOutsideApprovedFiles: 'Unknown',
      roleEvidence: nativeRoleEvidence(outcome)
    } : {}),
    attempt: {
      ...recordPayload,
      id: recordId
    },
    ...(options.approvalProvenance ? { approvalProvenance: options.approvalProvenance } : {}),
    enforcedModel: authoritativeEnforcedModel,
    handoff: handoffResolution,
    handoffAmbiguity,
    error: recordSuccess ? null : (recordResult ? recordResult.error : 'record_failed'),
    reason: recordSuccess ? null : 'record_failed',
    outcome,
    receipt
  };
}

module.exports = {
  runVerifyRecord,
  getExistingCoderAttempts,
  digestApprovedFiles
};
