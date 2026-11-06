'use strict';

const fs = require('fs');
const path = require('path');
const { nativeExecutorForHost } = require('./plan_receipt');

const COLUMNS = [
  'id', 'task_id', 'created_at', 'role', 'success', 'verification_passed',
  'critic_passed', 'environment', 'executor', 'attribution_source',
  'workspace_path', 'verification_origin', 'verification_executed_count',
  'critic_executed', 'plan_digest', 'approved_plan_digest', 'history_title',
  'approved_scope_json', 'history_metadata_source', 'history_metadata_digest'
  , 'semantic_review_status', 'semantic_review_json', 'leader_decision_json', 'role_provenance_json',
  'approval_provenance_json'
];

function safeText(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value)
    ? value : 'Unknown';
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sidecarPresent(file) {
  return ['-wal', '-shm', '-journal'].some(suffix => fs.existsSync(file + suffix));
}

function sameStat(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function readAttempt(workspacePath, reference = null) {
  let workspace;
  try {
    workspace = fs.realpathSync(workspacePath);
    if (!fs.statSync(workspace).isDirectory()) return { status: 'workspace_unavailable' };
  } catch { return { status: 'workspace_unavailable' }; }

  const agents = path.join(workspace, '.agents');
  const memory = path.join(agents, 'memory');
  const file = path.join(memory, 'database.sqlite');
  for (const dir of [agents, memory]) {
    try {
      const info = fs.lstatSync(dir);
      if (info.isSymbolicLink() || !info.isDirectory() || fs.realpathSync(dir) !== dir) {
        return { status: 'unsafe_path' };
      }
    } catch (error) {
      return { status: error.code === 'ENOENT' ? 'database_missing' : 'database_unavailable' };
    }
  }

  let before;
  try {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || fs.realpathSync(file) !== file) {
      return { status: 'unsafe_path' };
    }
    before = fs.statSync(file, { bigint: true });
    if (before.size === 0n) return { status: 'database_unavailable' };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'database_missing' : 'database_unavailable' };
  }
  // A read-only connection to a live WAL database may observe state not in the
  // main file. Decline to report a complete history when any sidecar is present.
  if (sidecarPresent(file)) return { status: 'history_incomplete' };
  try {
    const header = Buffer.alloc(20);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, header, 0, header.length, 0); }
    finally { fs.closeSync(fd); }
    // SQLite header bytes 18/19 are the write/read format versions; 2 is WAL.
    if (header[18] === 2 || header[19] === 2) return { status: 'history_incomplete' };
  } catch { return { status: 'database_unavailable' }; }

  let db;
  let row;
  let readStatus;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='execution_attempts'").get();
    if (!table) {
      readStatus = 'schema_unavailable';
    } else {
      const columns = new Set(db.prepare('PRAGMA table_info(execution_attempts)').all().map(item => item.name));
      if (!['id', 'task_id', 'created_at'].every(name => columns.has(name))) {
        readStatus = 'schema_unavailable';
      } else {
        const select = COLUMNS.map(name => columns.has(name) ? name : `NULL AS ${name}`).join(', ');
        if (!reference) {
          row = db.prepare(`SELECT ${select} FROM execution_attempts ORDER BY created_at DESC, id DESC LIMIT 1`).get();
        } else if (!['role', 'approved_plan_digest'].every(name => columns.has(name))) {
          readStatus = 'context_unproven';
        } else {
          row = db.prepare(`SELECT ${select} FROM execution_attempts
            WHERE task_id = ? AND approved_plan_digest = ? AND role = 'coder'
            ORDER BY created_at DESC, id DESC LIMIT 1`).get(reference.taskId, reference.approvedPlanDigest);
          if (!row) {
            const legacy = db.prepare(`SELECT 1 FROM execution_attempts WHERE task_id = ? AND role = 'coder'
              AND (approved_plan_digest IS NULL OR approved_plan_digest = '') LIMIT 1`).get(reference.taskId);
            readStatus = legacy ? 'context_unproven' : 'no_matching_attempt';
          }
        }
      }
    }
  } catch {
    readStatus = 'database_unavailable';
  } finally {
    if (db) {
      try { db.close(); } catch { readStatus = 'database_unavailable'; }
    }
  }
  try {
    if (sidecarPresent(file) || !sameStat(before, fs.statSync(file, { bigint: true }))) {
      return { status: 'history_incomplete' };
    }
  } catch { return { status: 'history_incomplete' }; }
  if (readStatus) return { status: readStatus };
  if (!row) return { status: 'no_attempts', workspace };

  if (row.workspace_path) {
    try {
      if (fs.realpathSync(row.workspace_path) !== workspace) return { status: 'workspace_mismatch' };
    } catch { return { status: 'workspace_mismatch' }; }
  }
  const parseStoredJson = (value) => {
    if (typeof value !== 'string' || value.length > 16000) return 'Unknown';
    try { return JSON.parse(value); } catch { return 'Unknown'; }
  };

  const bound = Boolean(row.workspace_path);
  const nativeIdentity = parseStoredJson(row.role_provenance_json);
  const explicitNativeHost = row.executor === 'antigravity_native' || row.executor === 'claude_native';
  const legacyCodexIdentity = row.executor === 'codex_interactive' &&
    nativeIdentity?.executionKind !== 'native' && nativeIdentity?.nativeHost === undefined;
  let nativeObserved = bound && (legacyCodexIdentity ||
    explicitNativeHost && nativeIdentity?.executionKind === 'native' && nativeExecutorForHost(nativeIdentity?.nativeHost) === row.executor) &&
    row.attribution_source === 'unverified_external' &&
    row.verification_origin === 'core_observed_native' &&
    Number(row.verification_executed_count) > 0 && row.critic_executed === 1;
  const coreRecorded = row.executor === 'core' && row.attribution_source === 'direct';
  const managed = bound && coreRecorded;
  const evidencePassed = row.success === 1 && row.verification_passed === 1 && row.critic_passed === 1;
  let approvedMetadata = null;
  if (bound && row.history_metadata_source === 'approved_plan_snapshot' &&
      /^[a-f0-9]{64}$/.test(row.plan_digest || '') &&
      /^[a-f0-9]{64}$/.test(row.approved_plan_digest || '') &&
      /^[a-f0-9]{64}$/.test(row.history_metadata_digest || '') &&
      typeof row.approved_scope_json === 'string' && row.approved_scope_json.length <= 4096) {
    try {
      const approvedScope = JSON.parse(row.approved_scope_json);
      if (Array.isArray(approvedScope) && approvedScope.length > 0 && approvedScope.length <= 64 &&
          approvedScope.every(file => typeof file === 'string' && file.length > 0 && file.length <= 255 &&
            !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') &&
            !/[\u0000-\u001f\u007f]/u.test(file)) &&
          (row.history_title === null || (typeof row.history_title === 'string' &&
            row.history_title.trim() === row.history_title && row.history_title.length > 0 &&
            Array.from(row.history_title).length <= 120 && !/[\u0000-\u001f\u007f]/u.test(row.history_title)))) {
        const candidate = { ...(explicitNativeHost ? { executionKind: 'native', nativeHost: nativeIdentity?.nativeHost } : {}),
          taskId: row.task_id, workspacePath: workspace,
          planDigest: row.plan_digest, approvedPlanDigest: row.approved_plan_digest,
          title: row.history_title, approvedScope };
        const { computeHistoryMetadataDigest } = require('../allocation/execution_history_store');
        if (computeHistoryMetadataDigest(candidate) === row.history_metadata_digest) approvedMetadata = candidate;
      }
    } catch { /* Legacy or damaged metadata remains Unknown. */ }
  }
  if (explicitNativeHost && !approvedMetadata) nativeObserved = false;
  const provenance = nativeObserved ? 'core_observed_native'
    : managed ? 'core_managed_recorded'
      : coreRecorded ? 'legacy_unbound' : 'unknown';
  const outcome = nativeObserved && evidencePassed ? 'verified'
    : row.success === 0 || row.verification_passed === 0 || row.critic_passed === 0
      ? (provenance === 'unknown' || provenance === 'legacy_unbound' ? 'recorded_failure_unconfirmed' : 'failed')
      : coreRecorded && evidencePassed ? 'recorded_success_unconfirmed' : 'unknown';


  if (reference) {
    if (!approvedMetadata) return { status: 'context_unproven', workspace };
    // Only bounded, typed evidence is exposed by the new context command.
    // Stored free text/JSON is never returned wholesale or treated as approval.
    const approval = parseStoredJson(row.approval_provenance_json);
    const leader = parseStoredJson(row.leader_decision_json);
    const roles = parseStoredJson(row.role_provenance_json);
    const leaderProvenance = nativeObserved && roles && roles.leader === 'core_observed'
      ? 'core_observed' : managed ? 'core_managed_recorded' : 'recorded_unverified';
    const semanticStatuses = ['NOT_REQUESTED', 'COMPLETED', 'CONFIRMED', 'FAILED', 'UNREVIEWED'];
    const boolOrUnknown = value => typeof value === 'boolean' ? value : 'Unknown';
    return {
      status: 'found', workspace, relationship: 'explicit_task_plan_reference',
      isInstruction: false, isApproval: false,
      attempt: {
        recordId: safeInteger(row.id), taskId: safeText(row.task_id), createdAt: safeInteger(row.created_at),
        role: 'coder', executor: safeText(row.executor), attributionSource: safeText(row.attribution_source),
        provenance, outcome, workspaceBinding: 'row_and_database',
        planDigest: approvedMetadata.planDigest, approvedPlanDigest: approvedMetadata.approvedPlanDigest,
        approvedScope: approvedMetadata.approvedScope, metadataSource: 'approved_plan_snapshot_recorded',
        verification: nativeObserved ? (row.verification_passed === 1 ? 'core_observed_pass' : 'core_observed_fail') : 'not_proven',
        critic: nativeObserved ? (row.critic_passed === 1 ? 'core_observed_pass' : 'core_observed_fail') : 'not_proven',
        verificationExecutedCount: nativeObserved ? Number(row.verification_executed_count) : null,
        semanticReviewStatus: semanticStatuses.includes(row.semantic_review_status) ? row.semantic_review_status : 'Unknown',
        leaderDecision: leader && typeof leader === 'object' && !Array.isArray(leader)
          ? { provenance: leaderProvenance, technicalSuccess: boolOrUnknown(leader.technicalSuccess),
            semanticStatus: semanticStatuses.includes(leader.semanticStatus) ? leader.semanticStatus : 'Unknown',
            success: boolOrUnknown(leader.success) } : 'Unknown',
        approvalSource: approval && approval.source === 'reported_by_agent' ? 'reported_by_agent' : 'Unknown',
        workDescription: 'Unknown', changedFiles: 'Unknown', decisions: 'Unknown', resumePoint: 'Unknown',
        currentFileState: 'not_checked'
      }
    };
  }

  return {
    status: 'found', workspace,
    attempt: {
      recordId: safeInteger(row.id), taskId: safeText(row.task_id), createdAt: safeInteger(row.created_at),
      role: safeText(row.role), environment: safeText(row.environment),
      executor: safeText(row.executor), attributionSource: safeText(row.attribution_source),
      provenance, outcome,
      workspaceBinding: bound ? 'row_and_database' : 'database_location_only',
      verification: nativeObserved ? (row.verification_passed === 1 ? 'core_observed_pass' : 'core_observed_fail') : 'not_proven',
      critic: nativeObserved ? (row.critic_passed === 1 ? 'core_observed_pass' : 'core_observed_fail') : 'not_proven',
      semanticReviewStatus: typeof row.semantic_review_status === 'string' ? row.semantic_review_status : 'Unknown',
      semanticReview: parseStoredJson(row.semantic_review_json),
      leaderDecision: parseStoredJson(row.leader_decision_json),
      roleProvenance: parseStoredJson(row.role_provenance_json),
      verificationExecutedCount: nativeObserved ? Number(row.verification_executed_count) : null,
      historyTitle: approvedMetadata && approvedMetadata.title ? approvedMetadata.title : 'Unknown',
      approvedScope: approvedMetadata ? approvedMetadata.approvedScope : 'Unknown',
      approvedPlanDigest: approvedMetadata ? approvedMetadata.approvedPlanDigest : 'Unknown',
      metadataSource: approvedMetadata ? 'approved_plan_snapshot_recorded' : 'Unknown',
      workDescription: 'Unknown', changedFiles: 'Unknown', decisions: 'Unknown'
    }
  };
}

function readLastTaskAttempt(workspacePath) {
  return readAttempt(workspacePath);
}

function readTaskAttemptContext(workspacePath, reference) {
  if (!reference || typeof reference.taskId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(reference.taskId) ||
      typeof reference.approvedPlanDigest !== 'string' || !/^[a-f0-9]{64}$/.test(reference.approvedPlanDigest)) {
    return { status: 'invalid_context_reference' };
  }
  return readAttempt(workspacePath, reference);
}

module.exports = { readLastTaskAttempt, readTaskAttemptContext };
