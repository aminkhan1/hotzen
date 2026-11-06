'use strict';

// Persistence foundation only: no Engine, CLI, Provider or workflow side effects.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExecutionHistoryStore, storageErrorCode } = require('./execution_history_store');
const { canonicalize, sha256Digest, validatePlanReceipt } = require('../workflow/plan_receipt');
const { readApprovedFileState, validateApprovedFileStates } = require('../workflow/verification_contract');

const VERSION = 1;
const AWAITING = 'AWAITING_VERIFICATION_APPROVAL';
const STATES = Object.freeze([AWAITING, 'CLAIMED', 'VERIFIED', 'REJECTED', 'BLOCKED', 'INDETERMINATE']);
const MAX_JSON_BYTES = 131072;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{16,128}$/;
const hash = value => sha256Digest(canonicalize(value));
function fail(reason) { throw Object.assign(new Error(reason), { checkpointReason: reason }); }
function requireCondition(condition, reason = 'invalid_checkpoint') { if (!condition) fail(reason); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, max = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}
// Reject lossy JSON inputs, excessive nesting, oversized fields and arbitrary instances.
function prose(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 16384 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}
function json(value) {
  const visit = (item, depth) => {
    requireCondition(depth <= 16);
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { requireCondition(Number.isFinite(item)); return; }
    if (typeof item === 'string') { requireCondition(item.length <= 16384); return; }
    requireCondition(Array.isArray(item) || object(item) && Object.getPrototypeOf(item) === Object.prototype);
    if (!Array.isArray(item)) {
      requireCondition(Object.keys(item).every(key => text(key, 128) &&
        !['__proto__', 'constructor', 'prototype'].includes(key)));
    }
    const entries = Array.isArray(item) ? item : Object.values(item);
    requireCondition(entries.length <= 256);
    for (const child of entries) visit(child, depth + 1);
  };
  visit(value, 0);
  const serialized = JSON.stringify(canonicalize(value));
  requireCondition(Buffer.byteLength(serialized) <= MAX_JSON_BYTES);
  return serialized;
}
function same(a, b) { return json(a) === json(b); }
function canonicalPath(file) {
  requireCondition(text(file) && path.isAbsolute(file));
  requireCondition(fs.realpathSync(file) === file, 'noncanonical_path');
  return file;
}
function readBytes(file, max = 1048576) {
  canonicalPath(file);
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size <= max, 'invalid_evidence_file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    requireCondition(fs.fstatSync(fd).isFile(), 'invalid_evidence_file');
    const bytes = fs.readFileSync(fd);
    requireCondition(bytes.length <= max, 'invalid_evidence_file');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function byteDigest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function approvedScope(value) {
  requireCondition(Array.isArray(value) && value.length > 0 && value.length <= 64 && new Set(value).size === value.length);
  for (const file of value) {
    requireCondition(text(file, 255) && !path.isAbsolute(file) && !file.includes('\\') &&
      file.split('/').every(part => part && part !== '.' && part !== '..'));
  }
  return [...value];
}
// Evidence digest recipe is explicit: canonical [{file, ...readApprovedFileState()}] in approved Scope order.
function currentFileDigest(workspace, scope) {
  return hash(scope.map(file => {
    const state = readApprovedFileState(workspace, file);
    requireCondition(state.ok, 'approved_file_unavailable');
    return { file, ...state };
  }));
}
function validateBackup(data) {
  const backup = data.backup;
  requireCondition(object(backup) && DIGEST.test(backup.manifestDigest || ''));
  canonicalPath(backup.path);
  const raw = readBytes(path.join(backup.path, 'manifest.json'), MAX_JSON_BYTES);
  requireCondition(byteDigest(raw) === backup.manifestDigest, 'backup_digest_mismatch');
  const manifest = JSON.parse(raw.toString('utf8'));
  requireCondition(manifest.taskId === data.taskId && Array.isArray(manifest.files) &&
    same(manifest.files.map(entry => entry.path).sort(), [...data.approvedScope].sort()), 'backup_binding_mismatch');
  if (manifest.kind === 'native_pre_edit') {
    const binding = manifest.binding;
    requireCondition(binding && binding.workspace === data.workspacePath && binding.taskId === data.taskId &&
      binding.approvedPlanDigest === data.approvedPlanDigest && binding.receiptDigest === data.receiptDigest &&
      binding.snapshotDigest === data.snapshotDigest && binding.verificationContractDigest === data.verificationContractDigest &&
      same(binding.scope, data.approvedScope), 'backup_binding_mismatch');
  } else requireCondition(Number.isSafeInteger(manifest.attempt) && manifest.attempt >= 0, 'backup_binding_mismatch');
  for (const entry of manifest.files) {
    requireCondition(typeof entry.present === 'boolean' && (entry.present ? DIGEST.test(entry.sha256 || '') : entry.sha256 === null));
    const initial = data.initialFileStates.entries.find(item => item.file === entry.path)?.initial;
    requireCondition(initial && entry.present === (initial.state === 'present') &&
      entry.sha256 === initial.digest, 'backup_initial_state_mismatch');
    if (entry.present) {
      const file = path.join(backup.path, ...(manifest.kind === 'native_pre_edit' ? ['files'] : []), entry.path);
      requireCondition(byteDigest(readBytes(file)) === entry.sha256, 'backup_byte_mismatch');
    }
  }
}

/**
 * Borrows one initialized ExecutionHistoryStore connection. Never opens, initializes
 * or closes it. All schema changes are explicit through initializeSchema().
 * Evidence is correlation/integrity data, not independent owner/host authentication.
 */
class ManagedExecutionCheckpointStore {
  #history;
  #db;
  #schemaReady = false;
  #indeterminate = false;

  constructor(historyStore) {
    this.#history = historyStore;
    this.#db = historyStore instanceof ExecutionHistoryStore ? historyStore.db : null;
  }

  #guard(requireSchema = true) {
    requireCondition(!this.#indeterminate, 'transaction_outcome_indeterminate');
    requireCondition(this.#history instanceof ExecutionHistoryStore && this.#db, 'storage_unavailable');
    requireCondition(this.#history.db === this.#db, 'connection_changed');
    requireCondition(!this.#history.closed && this.#history.isAvailable(), 'storage_unavailable');
    requireCondition(!this.#history.readOnly, 'storage_read_only');
    // Flags alone do not detect raw-handle closure or PRAGMA query_only changes.
    const mode = this.#db.prepare('PRAGMA query_only').get();
    requireCondition(Number(mode.query_only) === 0, 'storage_read_only');
    if (requireSchema) requireCondition(this.#schemaReady, 'schema_not_initialized');
  }

  #result(operation) {
    try { return operation(); }
    catch (error) { return { ok: false, reason: error.checkpointReason || storageErrorCode(error) }; }
  }

  #transaction(operation, requireSchema = true) {
    return this.#result(() => {
      this.#guard(requireSchema);
      requireCondition(this.#db.isTransaction !== true, 'nested_transaction');
      // A failed BEGIN (including a caller-owned transaction) never grants ownership.
      let owned = false;
      try {
        this.#db.exec('BEGIN IMMEDIATE');
        owned = true;
        const result = operation();
        this.#guard(requireSchema);
        this.#db.exec('COMMIT');
        owned = false;
        return result;
      } catch (error) {
        if (owned) {
          try { this.#db.exec('ROLLBACK'); }
          catch {
            this.#indeterminate = true;
            fail('transaction_outcome_indeterminate');
          }
        }
        throw error;
      }
    });
  }

  initializeSchema() {
    const result = this.#transaction(() => {
      const schema = `
        CREATE TABLE IF NOT EXISTS managed_checkpoints_v1 (
          checkpoint_id TEXT PRIMARY KEY,
          version INTEGER NOT NULL CHECK(version = 1),
          state TEXT NOT NULL CHECK(state IN ('AWAITING_VERIFICATION_APPROVAL','CLAIMED','VERIFIED','REJECTED','BLOCKED','INDETERMINATE')),
          binding_digest TEXT NOT NULL,
          data_json TEXT NOT NULL,
          challenge_id TEXT NOT NULL UNIQUE,
          claim_token TEXT,
          verification_approval_json TEXT,
          terminal_json TEXT,
          finalization_digest TEXT,
          record_id INTEGER UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS managed_checkpoint_attempts_v1 (
          checkpoint_id TEXT PRIMARY KEY REFERENCES managed_checkpoints_v1(checkpoint_id),
          attempt_id INTEGER NOT NULL UNIQUE REFERENCES execution_attempts(id),
          finalization_digest TEXT NOT NULL
        );
      `;
      this.#db.exec(schema);
      // Existing incompatible objects must fail closed rather than being silently adopted.
      const normalizeSql = sql => sql.replace(/IF\s+NOT\s+EXISTS/gi, '').replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
      for (const definition of schema.split(';').map(sql => sql.trim()).filter(Boolean)) {
        const name = /CREATE TABLE IF NOT EXISTS (\w+)/i.exec(definition)[1];
        const existing = this.#db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
        requireCondition(existing && normalizeSql(existing.sql) === normalizeSql(definition), 'checkpoint_schema_mismatch');
      }
      this.#db.prepare('SELECT checkpoint_id,version,state,binding_digest,data_json,challenge_id,claim_token,verification_approval_json,terminal_json,finalization_digest,record_id,created_at,updated_at FROM managed_checkpoints_v1 LIMIT 0').all();
      this.#db.prepare('SELECT checkpoint_id,attempt_id,finalization_digest FROM managed_checkpoint_attempts_v1 LIMIT 0').all();
      return { ok: true, version: VERSION };
    }, false);
    if (result.ok) this.#schemaReady = true;
    return result;
  }

  #normalize(input) {
    requireCondition(object(input));
    json(input);
    requireCondition(ID.test(input.checkpointId || '') && DIGEST.test(input.bundleDigest || ''));
    const workspacePath = canonicalPath(input.workspacePath);
    requireCondition(fs.statSync(workspacePath).isDirectory());
    const raw = readBytes(input.bundleFile);
    requireCondition(byteDigest(raw) === input.bundleDigest, 'bundle_digest_mismatch');
    const bundle = JSON.parse(raw.toString('utf8'));
    const { task, plan, planAllocations, runtimeConfig, approvedPlanSnapshot: snapshot } = bundle;
    requireCondition(bundle.ok === true && task && text(task.id, 128) && typeof task.userPrompt === 'string' &&
      task.userPrompt.trim() && plan && snapshot && planAllocations && runtimeConfig && runtimeConfig.provider &&
      runtimeConfig.executionKind === undefined && runtimeConfig.modelSwitchingEnabled === false &&
      planAllocations.providerId === runtimeConfig.provider, 'invalid_managed_bundle');
    const receipt = bundle.planReceipt || bundle.receipt;
    requireCondition(!bundle.receipt || bundle.receipt === receipt, 'receipt_mismatch');
    const checked = validatePlanReceipt(receipt, { cwd: workspacePath, taskPrompt: task.userPrompt,
      task, plan, planAllocations, runtimeConfig, requireApprovedPlanDigest: true });
    requireCondition(checked.valid && checked.payload.executionKind === undefined && checked.payload.taskId === task.id &&
      checked.payload.provider === runtimeConfig.provider, 'invalid_plan_receipt');
    const payload = checked.payload;
    requireCondition(payload.planDigest === hash({ taskId: task.id, providerId: runtimeConfig.provider,
      allocations: planAllocations.allocations || {} }), 'plan_digest_mismatch');
    const scope = approvedScope(plan.filesToModify);
    const initialFileStates = plan.verificationContract?.fileStates;
    requireCondition(validateApprovedFileStates(initialFileStates, scope).ok, 'invalid_approved_file_states');
    requireCondition(Array.isArray(plan.acceptanceCriteria) && plan.acceptanceCriteria.length > 0 &&
      plan.acceptanceCriteria.every(criterion => text(criterion)) && snapshot.taskId === task.id &&
      same(snapshot.task, task) && same(snapshot.plan, plan) && same(snapshot.filesToModify, scope) &&
      same(snapshot.acceptanceCriteria, plan.acceptanceCriteria) && snapshot.planReceipt === receipt &&
      prose(bundle.userVisiblePlan) && snapshot.userVisiblePlan === bundle.userVisiblePlan &&
      plan.userVisiblePlan === bundle.userVisiblePlan && object(plan.verificationContract) &&
      same(snapshot.verificationContract, plan.verificationContract) && same(payload.verificationContract, plan.verificationContract), 'snapshot_mismatch');
    const data = { version: VERSION, checkpointId: input.checkpointId, taskId: task.id, workspacePath,
      bundleFile: input.bundleFile, bundleDigest: input.bundleDigest, taskPromptDigest: payload.taskPromptDigest,
      planDigest: payload.planDigest, approvedPlanDigest: payload.approvedPlanDigest,
      receiptDigest: sha256Digest(receipt), snapshotDigest: hash(snapshot), approvedScope: scope,
      verificationContractDigest: hash(plan.verificationContract), initialFileStates, executionApproval: input.executionApproval,
      backup: input.backup, artifacts: input.artifacts, approvedFileDigest: input.approvedFileDigest,
      executionEvidence: input.executionEvidence, providerEvidence: input.providerEvidence,
      challenge: input.challenge, budget: input.budget };
    const approval = data.executionApproval;
    requireCondition(object(approval) && ['cli', 'reported_by_agent'].includes(approval.source) &&
      approval.decision === 'APPROVE' && approval.executionKind === 'core_run' && approval.taskId === data.taskId &&
      approval.workspacePath === workspacePath && same(approval.approvedScope, scope) &&
      approval.planDigest === data.planDigest && approval.approvedPlanDigest === data.approvedPlanDigest &&
      approval.receiptDigest === data.receiptDigest && approval.snapshotDigest === data.snapshotDigest &&
      (approval.source !== 'reported_by_agent' || ID.test(approval.challengeId || '')), 'execution_approval_mismatch');
    requireCondition(object(data.executionEvidence) && DIGEST.test(data.executionEvidence.executionDigest || '') &&
      data.executionEvidence.providerId === runtimeConfig.provider && object(data.providerEvidence) &&
      data.providerEvidence.providerId === runtimeConfig.provider, 'execution_evidence_mismatch');
    requireCondition(object(data.artifacts) && same(data.artifacts.files, scope) && DIGEST.test(data.artifacts.deliveryDigest || ''));
    requireCondition(DIGEST.test(data.approvedFileDigest || '') && currentFileDigest(workspacePath, scope) === data.approvedFileDigest, 'approved_files_mismatch');
    requireCondition(object(data.challenge) && ID.test(data.challenge.id || '') &&
      Number.isSafeInteger(data.challenge.createdAt) && data.challenge.createdAt >= 0 &&
      Number.isSafeInteger(data.challenge.expiresAt) && data.challenge.expiresAt > data.challenge.createdAt);
    requireCondition(object(data.budget) && Number.isSafeInteger(data.budget.maxProviderCalls) && data.budget.maxProviderCalls >= 0 &&
      Number.isSafeInteger(data.budget.maxRecoveryAttempts) && data.budget.maxRecoveryAttempts >= 0);
    validateBackup(data);
    return JSON.parse(json(data));
  }

  #binding(data, bindingDigest) {
    return { taskId: data.taskId, executionKind: 'managed_verification', planDigest: data.planDigest,
      approvedPlanDigest: data.approvedPlanDigest, receiptDigest: data.receiptDigest, snapshotDigest: data.snapshotDigest,
      workspacePath: data.workspacePath, approvedScope: data.approvedScope, budget: data.budget,
      // This fingerprint binds all immutable checkpoint data, not only the original execution.
      executionDigest: bindingDigest, challengeId: data.challenge.id };
  }

  #load(id) {
    requireCondition(ID.test(id || ''), 'invalid_checkpoint_id');
    const row = this.#db.prepare('SELECT * FROM managed_checkpoints_v1 WHERE checkpoint_id=?').get(id);
    requireCondition(row, 'checkpoint_not_found');
    const data = JSON.parse(row.data_json);
    requireCondition(row.version === VERSION && STATES.includes(row.state) && hash(data) === row.binding_digest &&
      data.checkpointId === id && data.challenge.id === row.challenge_id, 'checkpoint_integrity_failure');
    return { row, data };
  }

  #view(row, data) {
    return { checkpointId: row.checkpoint_id, version: row.version, state: row.state,
      bindingDigest: row.binding_digest, data, recordId: row.record_id,
      verificationApproval: row.verification_approval_json ? JSON.parse(row.verification_approval_json) : null,
      terminalOutcome: row.terminal_json ? JSON.parse(row.terminal_json) : null };
  }

  #current(data) {
    requireCondition(fs.realpathSync(data.workspacePath) === data.workspacePath, 'workspace_changed');
    requireCondition(byteDigest(readBytes(data.bundleFile)) === data.bundleDigest, 'bundle_digest_mismatch');
    requireCondition(currentFileDigest(data.workspacePath, data.approvedScope) === data.approvedFileDigest, 'approved_files_mismatch');
    validateBackup(data);
  }

  createCheckpoint(input) {
    return this.#transaction(() => {
      const data = this.#normalize(input);
      const bindingDigest = hash(data);
      const challenge = this.#history.createApprovalChallenge({ ...this.#binding(data, bindingDigest),
        createdAt: data.challenge.createdAt, expiresAt: data.challenge.expiresAt });
      requireCondition(challenge.ok === true, challenge.reason || 'challenge_creation_failed');
      this.#db.prepare(`INSERT INTO managed_checkpoints_v1
        (checkpoint_id,version,state,binding_digest,data_json,challenge_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(data.checkpointId, VERSION, AWAITING, bindingDigest, json(data),
          data.challenge.id, data.challenge.createdAt, data.challenge.createdAt);
      const loaded = this.#load(data.checkpointId);
      return { ok: true, checkpoint: this.#view(loaded.row, loaded.data) };
    });
  }

  getCheckpoint(id) {
    return this.#result(() => {
      this.#guard(); const { row, data } = this.#load(id);
      return { ok: true, checkpoint: this.#view(row, data) };
    });
  }

  #decision(row, data, decision, expected, now) {
    requireCondition(object(decision) && decision.bindingDigest === row.binding_digest &&
      decision.challengeId === data.challenge.id && decision.decision === expected &&
      ['cli', 'reported_by_agent'].includes(decision.source) && 
      now >= data.challenge.createdAt, 'approval_binding_mismatch');
    requireCondition(now < data.challenge.expiresAt, 'expired');
    requireCondition(row.state === AWAITING, 'checkpoint_not_pending');
  }

  claimCheckpoint(id, decision) {
    return this.#transaction(() => {
      const { row, data } = this.#load(id);
      const now = Date.now();
      this.#decision(row, data, decision, 'APPROVE', now); this.#current(data);
      // The legacy method sets a connection-wide timeout; preserve the lender's setting.
      const timeout = Number(this.#db.prepare('PRAGMA busy_timeout').get().timeout);
      requireCondition(Number.isSafeInteger(timeout) && timeout >= 0, 'invalid_connection_timeout');
      let consumed;
      try {
        consumed = this.#history.consumeApprovalChallenge({ ...this.#binding(data, row.binding_digest), now });
      } finally {
        this.#db.exec(`PRAGMA busy_timeout = ${timeout}`);
      }
      requireCondition(consumed.ok === true && consumed.consumed === true, consumed.reason || 'challenge_consumption_failed');
      const claimToken = crypto.randomUUID();
      const update = this.#db.prepare(`UPDATE managed_checkpoints_v1 SET state='CLAIMED',claim_token=?,
        verification_approval_json=?,updated_at=? WHERE checkpoint_id=? AND state=? AND binding_digest=?`)
        .run(claimToken, json({ ...decision, now }), now, id, AWAITING, row.binding_digest);
      requireCondition(Number(update.changes) === 1, 'claim_conflict');
      return { ok: true, claimToken, state: 'CLAIMED' };
    });
  }

  rejectCheckpoint(id, decision) {
    return this.#transaction(() => {
      const { row, data } = this.#load(id); const now = Date.now();
      this.#decision(row, data, decision, 'REJECT', now);
      const update = this.#db.prepare(`UPDATE managed_checkpoints_v1 SET state='REJECTED',verification_approval_json=?,
        terminal_json=?,updated_at=? WHERE checkpoint_id=? AND state=?`).run(json({ ...decision, now }),
          json({ reason: 'owner_rejected', success: false }), now, id, AWAITING);
      requireCondition(Number(update.changes) === 1, 'transition_conflict');
      return { ok: true, state: 'REJECTED' };
    });
  }

  // Explicit interruption/blocking only. No resume, retry, success or attempt insertion.
  transitionCheckpoint(id, input) {
    return this.#transaction(() => {
      const { row } = this.#load(id);
      requireCondition(object(input) && row.binding_digest === input.bindingDigest && text(input.reason, 256), 'transition_binding_mismatch');
      const legal = row.state === AWAITING && input.state === 'BLOCKED' ||
        row.state === 'CLAIMED' && ['BLOCKED', 'INDETERMINATE'].includes(input.state) && input.claimToken === row.claim_token;
      requireCondition(legal, 'illegal_transition');
      const update = this.#db.prepare(`UPDATE managed_checkpoints_v1 SET state=?,terminal_json=?,updated_at=?
        WHERE checkpoint_id=? AND state=?`).run(input.state, json({ reason: input.reason, success: false }), Date.now(), id, row.state);
      requireCondition(Number(update.changes) === 1, 'transition_conflict');
      return { ok: true, state: input.state };
    });
  }

  finalizeCheckpoint(id, input) {
    return this.#transaction(() => {
      const { row, data } = this.#load(id);
      requireCondition(object(input));
      const fingerprint = hash(JSON.parse(json(input)));
      requireCondition(input.bindingDigest === row.binding_digest && input.claimToken && input.claimToken === row.claim_token, 'finalization_binding_mismatch');
      const prior = this.#db.prepare('SELECT * FROM managed_checkpoint_attempts_v1 WHERE checkpoint_id=?').get(id);
      if (prior) {
        requireCondition(['VERIFIED', 'BLOCKED'].includes(row.state) && row.finalization_digest === fingerprint &&
          prior.finalization_digest === fingerprint && row.record_id === prior.attempt_id &&
          this.#db.prepare('SELECT id FROM execution_attempts WHERE id=? AND task_id=?').get(prior.attempt_id, data.taskId), 'finalization_conflict');
        return { ok: true, prior: true, recordId: prior.attempt_id, state: row.state };
      }
      requireCondition(row.state === 'CLAIMED', 'checkpoint_not_claimed');
      requireCondition(['VERIFIED', 'BLOCKED'].includes(input.state) && object(input.outcome) && object(input.attempt));
      const attempt = input.attempt;
      requireCondition(attempt.task_id === data.taskId && attempt.role === 'coder' && attempt.executor === 'core' &&
        attempt.attribution_source === 'direct' && attempt.verification_origin !== 'core_observed_native' &&
        same(attempt.approval_provenance, data.executionApproval), 'attempt_binding_mismatch');
      for (const [field, expected] of [['plan_digest', data.planDigest], ['approved_plan_digest', data.approvedPlanDigest],
        ['workspace_path', data.workspacePath], ['verified_files_digest', data.approvedFileDigest]]) {
        requireCondition(attempt[field] === undefined || attempt[field] === expected, 'attempt_binding_mismatch');
      }
      if (attempt.history_metadata !== undefined) {
        const metadata = attempt.history_metadata;
        requireCondition(object(metadata) && metadata.taskId === data.taskId && metadata.workspacePath === data.workspacePath &&
          metadata.planDigest === data.planDigest && metadata.approvedPlanDigest === data.approvedPlanDigest &&
          same(metadata.approvedScope, data.approvedScope), 'attempt_binding_mismatch');
      }
      requireCondition(attempt.actual_model === undefined || attempt.actual_model === null ||
        attempt.actual_model === data.providerEvidence.actualModel, 'attempt_attribution_mismatch');
      requireCondition(typeof input.outcome.success === 'boolean' && typeof input.outcome.verificationPassed === 'boolean' &&
        typeof input.outcome.criticPassed === 'boolean' && attempt.success === input.outcome.success &&
        attempt.verification_passed === input.outcome.verificationPassed && attempt.critic_passed === input.outcome.criticPassed &&
        (input.state === 'VERIFIED' ? input.outcome.success && input.outcome.verificationPassed && input.outcome.criticPassed : !input.outcome.success), 'invalid_terminal_outcome');
      this.#current(data);
      const previousMax = Number(this.#db.prepare('SELECT coalesce(max(id),0) AS id FROM execution_attempts').get().id);
      const result = this.#history.recordAttempt(attempt);
      requireCondition(result.ok === true, result.error || result.reason || 'recording_failed');
      requireCondition(Number.isSafeInteger(result.id) && result.id > previousMax &&
        this.#db.prepare('SELECT id FROM execution_attempts WHERE id=? AND task_id=? AND executor=? AND attribution_source=?')
          .get(result.id, data.taskId, 'core', 'direct'), 'invalid_record_id');
      this.#db.prepare(`INSERT INTO managed_checkpoint_attempts_v1(checkpoint_id,attempt_id,finalization_digest) VALUES(?,?,?)`)
        .run(id, result.id, fingerprint);
      const update = this.#db.prepare(`UPDATE managed_checkpoints_v1 SET state=?,terminal_json=?,finalization_digest=?,record_id=?,updated_at=?
        WHERE checkpoint_id=? AND state='CLAIMED' AND claim_token=?`).run(input.state, json(input.outcome), fingerprint, result.id, Date.now(), id, input.claimToken);
      requireCondition(Number(update.changes) === 1, 'finalization_conflict');
      return { ok: true, prior: false, recordId: result.id, state: input.state };
    });
  }
}

module.exports = { ManagedExecutionCheckpointStore };
