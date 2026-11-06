/**
 * 🌐 Universal Agent Core Hub - Execution History Store
 * Adaptive Routing V1: Minimal History-Based Routing using SQLite
 *
 * Responsibilities:
 * - Persists per-attempt execution outcomes by model, role, and task category.
 * - Distinguishes initial failures from successful recovery attempts.
 * - Stores environment tag ('production', 'benchmark', 'sandbox', 'mock') and
 *   strictly excludes non-production runs from production routing feedback.
 * - Computes conservative history-based escalation signals with minimum sample guards.
 * - Fails safely if SQLite storage is unavailable, corrupted, or disabled.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { nativeExecutorForHost } = require('../workflow/plan_receipt');

function computeHistoryMetadataDigest(meta) {
  return crypto.createHash('sha256').update(JSON.stringify({
    taskId: meta.taskId, workspacePath: meta.workspacePath,
    planDigest: meta.planDigest, approvedPlanDigest: meta.approvedPlanDigest,
    title: meta.title, approvedScope: meta.approvedScope,
    source: 'approved_plan_snapshot',
    ...(meta.executionKind === 'native' ? { executionKind: meta.executionKind, nativeHost: meta.nativeHost } : {})
  })).digest('hex');
}

let DatabaseSyncClass;

// Deliberately never inspect message, SQL, path or stderr. Numeric SQLite
// results are meaningful only on a SQLite error; extended results share a
// primary code in their low byte. CANTOPEN identifies access failure, not
// specifically a sandbox denial or a permission grant requirement.
function storageErrorCode(error) {
  const code = error && error.code;
  if (['database_access_error', 'database_locked', 'database_error', 'database_unavailable'].includes(code)) return code;
  if (['EACCES', 'EPERM', 'EROFS', 'SQLITE_PERM', 'SQLITE_AUTH', 'SQLITE_READONLY', 'SQLITE_CANTOPEN'].includes(code)) {
    return 'database_access_error';
  }
  if (['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code)) return 'database_locked';
  if (code === 'ERR_SQLITE_ERROR' && Number.isSafeInteger(error.errcode) && error.errcode >= 0 && error.errcode <= 0x7fffffff) {
    const primary = error.errcode & 0xff;
    if ([3, 8, 14, 23].includes(primary)) return 'database_access_error';
    if ([5, 6].includes(primary)) return 'database_locked';
  }
  return 'database_error';
}

function getDatabaseSyncClass() {
  if (DatabaseSyncClass !== undefined) {
    return DatabaseSyncClass;
  }

  try {
    const sqlite = require('node:sqlite');
    DatabaseSyncClass = sqlite.DatabaseSync;
  } catch {
    // Graceful degradation when node:sqlite is unavailable
    DatabaseSyncClass = null;
  }

  return DatabaseSyncClass;
}

const DEFAULT_OPERATIONAL_DB_PATH = path.join(__dirname, '../../.agents/memory/database.sqlite');
const DEFAULT_DB_PATH = DEFAULT_OPERATIONAL_DB_PATH;
const DEFAULT_MIN_SAMPLES = 3;
const DEFAULT_FAILURE_THRESHOLD = 0.50; // 50% initial failure rate triggers escalation

const NON_PROD_PREFIXES = ['BENCH-', 'CAL-', 'TEST-', 'MOCK-', 'CANARY-', 'SANDBOX-', 'EVAL-'];

function isTestProcess() {
  if (process.env.NODE_ENV === 'test' || process.env.CORE_TEST_MODE === '1') {
    return true;
  }
  const entry = (process.argv[1] || '').toLowerCase();
  if (entry.includes('/test/') || entry.includes('\\test\\') || entry.endsWith('.test.js') || entry.endsWith('test.js')) {
    return true;
  }
  return false;
}

function getIsolatedTestDbPath() {
  const tmpDir = path.join(os.tmpdir(), 'core-history-test');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {}
  return path.join(tmpDir, `isolated-test-history-${process.pid}.sqlite`);
}

function resolveDefaultDbPath() {
  if (process.env.CORE_HISTORY_DB_PATH && typeof process.env.CORE_HISTORY_DB_PATH === 'string' && process.env.CORE_HISTORY_DB_PATH.trim()) {
    return process.env.CORE_HISTORY_DB_PATH.trim();
  }
  if (isTestProcess()) {
    return getIsolatedTestDbPath();
  }
  return DEFAULT_OPERATIONAL_DB_PATH;
}

/**
 * Resolves the SQLite database path for execution history according to strict precedence:
 * 1. Explicit dbPath option
 * 2. CORE_HISTORY_DB_PATH environment variable override
 * 3. Explicit engine workspace / cwd (<workspace>/.agents/memory/database.sqlite)
 * 4. Existing legacy / default operational path as final fallback
 *
 * @param {object} [options]
 * @param {string} [options.dbPath] Explicit SQLite database file path
 * @param {string} [options.workspace] Explicit workspace directory
 * @param {string} [options.cwd] Explicit working directory
 * @param {string} [options.workspaceRoot] Explicit workspace root directory
 * @param {string} [options.projectRoot] Explicit project root directory
 * @returns {string} Resolved database file path
 */
function resolveHistoryDbPath(options = {}) {
  // 1. Explicit dbPath option
  if (options && typeof options.dbPath === 'string' && options.dbPath.trim()) {
    return options.dbPath.trim();
  }

  // 2. CORE_HISTORY_DB_PATH environment override
  if (process.env.CORE_HISTORY_DB_PATH && typeof process.env.CORE_HISTORY_DB_PATH === 'string' && process.env.CORE_HISTORY_DB_PATH.trim()) {
    return process.env.CORE_HISTORY_DB_PATH.trim();
  }

  // 3. Explicit engine workspace / cwd
  const rawWorkspace = options && (options.workspace || options.cwd || options.workspaceRoot || options.projectRoot);
  if (typeof rawWorkspace === 'string' && rawWorkspace.trim()) {
    const resolvedWorkspace = path.resolve(rawWorkspace.trim());
    return path.join(resolvedWorkspace, '.agents', 'memory', 'database.sqlite');
  }

  // 4. Existing legacy / default operational path as final fallback
  return resolveDefaultDbPath();
}

function isNonProductionTask(taskId) {
  if (typeof taskId !== 'string') return false;
  const upper = taskId.trim().toUpperCase();
  if (NON_PROD_PREFIXES.some(prefix => upper.startsWith(prefix))) return true;
  if (upper.includes('-MOCK') || upper.includes('-TEST') || upper.includes('-SANDBOX')) return true;
  return false;
}

class ExecutionHistoryStore {
  /**
   * @param {object} [options]
   * @param {string} [options.dbPath] Path to SQLite database file or ':memory:'
   * @param {string} [options.workspace] Workspace directory to host .agents/memory/database.sqlite
   * @param {string} [options.cwd] Working directory to host .agents/memory/database.sqlite
   * @param {number} [options.minSamples=3] Minimum independent samples required for escalation
   * @param {number} [options.failureThreshold=0.50] Failure rate threshold (0.0 - 1.0)
   * @param {boolean} [options.autoInit=true] Whether to initialize schema immediately
   * @param {boolean} [options.readOnly=false] Open existing history without creating or migrating schema
   */
  constructor(options = {}) {
    this.dbPath = resolveHistoryDbPath(options);
    this.isOperational = Boolean(this.dbPath && path.resolve(this.dbPath) === path.resolve(DEFAULT_OPERATIONAL_DB_PATH));
    this.minSamples = typeof options.minSamples === 'number' && options.minSamples > 0
      ? options.minSamples
      : DEFAULT_MIN_SAMPLES;
    this.failureThreshold = typeof options.failureThreshold === 'number' && options.failureThreshold >= 0
      ? options.failureThreshold
      : DEFAULT_FAILURE_THRESHOLD;
    this.readOnly = options.readOnly === true;

    this.db = null;
    this.initialized = false;
    this.initError = null;
    this.closed = false;

    if (options.autoInit !== false) {
      this.init();
    }
  }

  /**
   * Checks whether the underlying database is ready and available.
   * @returns {boolean}
   */
  isAvailable() {
    return Boolean(!this.closed && this.initialized && this.db && !this.initError);
  }

  /**
   * Initializes the SQLite database connection and, unless read-only, sets up the schema.
   * Fails safely without throwing unhandled exceptions.
   * @returns {boolean}
   */
  init() {
    this.closed = false;
    if (this.initialized && this.db) {
      return true;
    }

    const DatabaseSync = getDatabaseSyncClass();
    if (!DatabaseSync) {
      this.initError = Object.assign(new Error('database_unavailable'), { code: 'database_unavailable' });
      return false;
    }

    try {
      if (this.readOnly) {
        if (!this.dbPath || this.dbPath === ':memory:' || !fs.existsSync(this.dbPath) || fs.statSync(this.dbPath).size === 0) {
          this.initError = Object.assign(new Error('database_unavailable'), { code: 'database_unavailable' });
          return false;
        }

        this.db = new DatabaseSync(this.dbPath, { readOnly: true });
        const attemptsTable = this.db.prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'execution_attempts'"
        ).get();
        if (!attemptsTable) {
          this.db.close();
          this.db = null;
          this.initError = Object.assign(new Error('database_unavailable'), { code: 'database_unavailable' });
          return false;
        }

        this.initialized = true;
        this.initError = null;
        return true;
      }

      if (this.dbPath && this.dbPath !== ':memory:') {
        const parentDir = path.dirname(this.dbPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      }
      this.db = new DatabaseSync(this.dbPath);

      // Create attempts table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS execution_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          task_category TEXT,
          role TEXT NOT NULL,
          model TEXT NOT NULL,
          attempt_type TEXT NOT NULL,
          attempt_index INTEGER DEFAULT 0,
          success INTEGER NOT NULL,
          verification_passed INTEGER NOT NULL,
          critic_passed INTEGER NOT NULL,
          fatal_violation TEXT,
          tokens INTEGER,
          duration_ms INTEGER,
          cost REAL,
          environment TEXT NOT NULL DEFAULT 'production',
          created_at INTEGER NOT NULL,
          requested_model TEXT,
          enforced_model TEXT,
          actual_model TEXT,
          executor TEXT NOT NULL DEFAULT 'core',
          attribution_source TEXT NOT NULL DEFAULT 'direct',
          plan_digest TEXT,
          approved_plan_digest TEXT,
          workspace_path TEXT,
          verified_files_digest TEXT,
          verification_origin TEXT,
          verification_executed_count INTEGER,
          critic_executed INTEGER,
          history_title TEXT,
          approved_scope_json TEXT,
          history_metadata_source TEXT,
          history_metadata_digest TEXT,
          semantic_review_status TEXT,
          semantic_review_json TEXT,
          leader_decision_json TEXT,
          role_provenance_json TEXT,
          approval_provenance_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_attempts_query
        ON execution_attempts (environment, role, model, task_category, attempt_type);

        CREATE TABLE IF NOT EXISTS execution_handoffs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          plan_digest TEXT NOT NULL,
          provider TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          requested_model TEXT NOT NULL,
          enforced_model TEXT NOT NULL,
          thread_resolution_source TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_handoffs_task_plan
        ON execution_handoffs (task_id, plan_digest);

        CREATE TABLE IF NOT EXISTS approval_challenges (
          challenge_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          execution_kind TEXT NOT NULL,
          plan_digest TEXT NOT NULL,
          approved_plan_digest TEXT NOT NULL,
          receipt_digest TEXT NOT NULL,
          snapshot_digest TEXT NOT NULL,
          workspace_path TEXT NOT NULL,
          approved_scope_json TEXT NOT NULL,
          budget_json TEXT NOT NULL,
          execution_digest TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER
        );
      `);

      // Idempotent additive schema migration for pre-existing databases
      try {
        const columns = this.db.prepare("PRAGMA table_info(execution_attempts)").all().map(c => c.name);
        if (!columns.includes('requested_model')) {
          this.db.exec("ALTER TABLE execution_attempts ADD COLUMN requested_model TEXT;");
        }
        if (!columns.includes('enforced_model')) {
          this.db.exec("ALTER TABLE execution_attempts ADD COLUMN enforced_model TEXT;");
        }
        if (!columns.includes('actual_model')) {
          this.db.exec("ALTER TABLE execution_attempts ADD COLUMN actual_model TEXT;");
        }
        if (!columns.includes('executor')) {
          this.db.exec("ALTER TABLE execution_attempts ADD COLUMN executor TEXT NOT NULL DEFAULT 'core';");
        }
        if (!columns.includes('attribution_source')) {
          this.db.exec("ALTER TABLE execution_attempts ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'direct';");
        }
        for (const [column, type] of [
          ['plan_digest', 'TEXT'], ['approved_plan_digest', 'TEXT'],
          ['workspace_path', 'TEXT'], ['verified_files_digest', 'TEXT'],
          ['approval_provenance_json', 'TEXT'],
          ['verification_origin', 'TEXT'], ['verification_executed_count', 'INTEGER'],
          ['critic_executed', 'INTEGER'], ['history_title', 'TEXT'],
          ['approved_scope_json', 'TEXT'], ['history_metadata_source', 'TEXT'],
          ['history_metadata_digest', 'TEXT'], ['semantic_review_status', 'TEXT'],
          ['semantic_review_json', 'TEXT'], ['leader_decision_json', 'TEXT'], ['role_provenance_json', 'TEXT']
        ]) {
          if (!columns.includes(column)) this.db.exec(`ALTER TABLE execution_attempts ADD COLUMN ${column} ${type};`);
        }
      } catch {}

      // Create attribution index after columns are guaranteed to exist
      try {
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_attempts_attribution
          ON execution_attempts (environment, role, model, executor, attribution_source);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_native_core_observed_task
          ON execution_attempts (task_id) WHERE verification_origin = 'core_observed_native';
        `);
      } catch {}

      this.initialized = true;
      this.initError = null;
      return true;
    } catch (err) {
      const code = storageErrorCode(err);
      this.initError = Object.assign(new Error(code), { code });
      this.initialized = false;
      this.db = null;
      return false;
    }
  }

  /**
   * Closes the database connection.
   */
  close() {
    this.closed = true;
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
    this.initialized = false;
  }

  /** Creates a short-lived, execution-bound Agent-mediated approval challenge. */
  createApprovalChallenge(data = {}) {
    if (!this.isAvailable()) return { ok: false, reason: this.initError ? storageErrorCode(this.initError) : 'database_unavailable' };
    if (this.readOnly) return { ok: false, reason: 'database_read_only' };
    const digestFields = ['planDigest', 'approvedPlanDigest', 'receiptDigest', 'snapshotDigest'];
    if (typeof data.challengeId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.challengeId) ||
        typeof data.taskId !== 'string' || !data.taskId.trim() ||
        !['core_run', 'native_verification', 'core_run_gitless', 'native_verification_gitless', 'managed_verification'].includes(data.executionKind) ||
        digestFields.some(field => !/^[a-f0-9]{64}$/.test(data[field] || '')) ||
        typeof data.workspacePath !== 'string' || !path.isAbsolute(data.workspacePath) ||
        !Array.isArray(data.approvedScope) || data.approvedScope.length === 0 ||
        data.approvedScope.some(file => typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) ||
        !data.budget || typeof data.budget !== 'object' || Array.isArray(data.budget) ||
        !Number.isSafeInteger(data.createdAt) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= data.createdAt) {
      return { ok: false, reason: 'invalid_challenge' };
    }
    try {
      this.db.prepare(`INSERT INTO approval_challenges (
        challenge_id, task_id, execution_kind, plan_digest, approved_plan_digest,
        receipt_digest, snapshot_digest, workspace_path, approved_scope_json,
        budget_json, execution_digest, created_at, expires_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
        data.challengeId, data.taskId, data.executionKind, data.planDigest,
        data.approvedPlanDigest, data.receiptDigest, data.snapshotDigest,
        data.workspacePath, JSON.stringify(data.approvedScope), JSON.stringify(data.budget),
        data.executionDigest || null,
        data.createdAt, data.expiresAt
      );
      return { ok: true, challengeId: data.challengeId, expiresAt: data.expiresAt };
    } catch (error) {
      const conflict = error && (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        (error.code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes(error.errcode)));
      return { ok: false, reason: conflict ? 'challenge_id_conflict' : storageErrorCode(error) };
    }
  }

  /** Atomically consumes a matching unexpired challenge; exactly one concurrent caller can succeed. */
  consumeApprovalChallenge(data = {}) {
    if (!this.isAvailable()) return { ok: false, reason: this.initError ? storageErrorCode(this.initError) : 'database_unavailable' };
    if (this.readOnly) return { ok: false, reason: 'database_read_only' };
    const now = Number.isSafeInteger(data.now) ? data.now : Date.now();
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      const result = this.db.prepare(`UPDATE approval_challenges SET consumed_at = ?
        WHERE challenge_id = ? AND task_id = ? AND execution_kind = ? AND plan_digest = ?
          AND approved_plan_digest = ? AND receipt_digest = ? AND snapshot_digest = ?
          AND workspace_path = ? AND approved_scope_json = ? AND budget_json = ?
          AND execution_digest IS ?
          AND consumed_at IS NULL AND expires_at > ?`).run(
        now, data.challengeId, data.taskId, data.executionKind, data.planDigest,
        data.approvedPlanDigest, data.receiptDigest, data.snapshotDigest,
        data.workspacePath, JSON.stringify(data.approvedScope), JSON.stringify(data.budget), data.executionDigest || null, now
      );
      if (Number(result.changes) === 1) return { ok: true, consumed: true, consumedAt: now };
      const row = this.db.prepare('SELECT * FROM approval_challenges WHERE challenge_id = ?').get(data.challengeId);
      if (!row) return { ok: false, reason: 'challenge_not_found' };
      if (row.consumed_at !== null) return { ok: false, reason: 'already_consumed' };
      if (row.expires_at <= now) return { ok: false, reason: 'expired' };
      return { ok: false, reason: 'binding_mismatch' };
    } catch (error) {
      return { ok: false, reason: storageErrorCode(error) };
    }
  }

  /**
   * Persists a single attempt execution outcome.
   * Fails safely and returns structured status without throwing.
   *
   * @param {object} data
   * @param {string} data.task_id
   * @param {string} [data.task_category='general']
   * @param {string} data.role 'coder' | 'planner' | 'tester' | 'critic'
   * @param {string} data.model Model identifier (e.g. 'haiku', 'sonnet')
   * @param {string} [data.attempt_type='initial'] 'initial' | 'recovery'
   * @param {number} [data.attempt_index=0]
   * @param {boolean|number} data.success
   * @param {boolean|number} [data.verification_passed=1]
   * @param {boolean|number} [data.critic_passed=1]
   * @param {string|null} [data.fatal_violation=null]
   * @param {number|null} [data.tokens=null]
   * @param {number|null} [data.duration_ms=null]
   * @param {number|null} [data.cost=null]
   * @param {string} [data.environment='production'] 'production' | 'benchmark' | 'sandbox' | 'mock'
   * @returns {{ ok: boolean, id?: number, error?: string }}
   */
  recordAttempt(data) {
    if (this.closed) {
      return { ok: false, error: 'storage_closed' };
    }
    if (this.readOnly) {
      return { ok: false, error: 'storage_read_only' };
    }

    if (!this.isAvailable()) {
      const initialized = this.init();
      if (!initialized) {
        return { ok: false, error: this.initError ? storageErrorCode(this.initError) : 'storage_unavailable' };
      }
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'invalid_data_payload' };
    }

    try {
      const taskId = typeof data.task_id === 'string' && data.task_id.trim() ? data.task_id.trim() : '';
      const taskCategory = typeof data.task_category === 'string' && data.task_category.trim()
        ? data.task_category.trim()
        : 'general';
      const role = typeof data.role === 'string' && data.role.trim() ? data.role.trim() : 'coder';
      const rawExecutor = typeof data.executor === 'string' && data.executor.trim()
        ? data.executor.trim()
        : 'core';
      const isExternalUnverified = (rawExecutor === 'codex_interactive' || data.attribution_source === 'unverified_external');

      const explicitNativeHost = rawExecutor === 'antigravity_native' || rawExecutor === 'claude_native';
      const executor = explicitNativeHost ? rawExecutor : isExternalUnverified ? 'codex_interactive' : rawExecutor;
      const attributionSource = isExternalUnverified
        ? 'unverified_external'
        : (typeof data.attribution_source === 'string' && data.attribution_source.trim() ? data.attribution_source.trim() : 'direct');

      // Requested model: preserved from data.requested_model, fallback to data.model for internal core calls
      let requestedModel = null;
      if (typeof data.requested_model === 'string' && data.requested_model.trim()) {
        requestedModel = data.requested_model.trim();
      } else if (!isExternalUnverified && typeof data.model === 'string' && data.model.trim()) {
        requestedModel = data.model.trim();
      }

      // Enforced model: authoritative enforcement evidence, null when absent/unverified
      let enforcedModel = null;
      if (!explicitNativeHost && typeof data.enforced_model === 'string' && data.enforced_model.trim()) {
        enforcedModel = data.enforced_model.trim();
      }

      // Actual model: strictly from provider evidence when available, never fabricated, null for external unverified
      let actualModel = null;
      if (!isExternalUnverified && typeof data.actual_model === 'string' && data.actual_model.trim()) {
        actualModel = data.actual_model.trim();
      }

      // Legacy routing model:
      // For external unverified, MUST normalize to 'unknown' to prevent accidental catalog matching
      let model = 'unknown';
      if (!isExternalUnverified) {
        if (typeof data.model === 'string' && data.model.trim()) {
          model = data.model.trim();
        } else if (requestedModel) {
          model = requestedModel;
        }
      }

      const attemptType = (data.attempt_type === 'recovery') ? 'recovery' : 'initial';
      const attemptIndex = typeof data.attempt_index === 'number' ? data.attempt_index : 0;
      const success = data.success ? 1 : 0;
      const verificationPassed = data.verification_passed !== undefined ? (data.verification_passed ? 1 : 0) : success;
      const criticPassed = data.critic_passed !== undefined ? (data.critic_passed ? 1 : 0) : success;
      const fatalViolation = typeof data.fatal_violation === 'string' ? data.fatal_violation : null;
      const tokens = typeof data.tokens === 'number' ? data.tokens : null;
      const durationMs = typeof data.duration_ms === 'number' ? data.duration_ms : null;
      const cost = typeof data.cost === 'number' ? data.cost : null;
      let environment = typeof data.environment === 'string' && data.environment.trim()
        ? data.environment.trim().toLowerCase()
        : 'production';

      // Detect and correct misclassified non-production runs
      const isDefinitiveNonProd = isNonProductionTask(taskId) || data.isMock || data.isBenchmark || data.isSandbox;
      if (isDefinitiveNonProd && environment === 'production') {
        const upper = taskId.toUpperCase();
        environment = (upper.startsWith('BENCH-') || upper.startsWith('CAL-') || data.isBenchmark)
          ? 'benchmark'
          : (upper.startsWith('MOCK-') || upper.includes('-MOCK') || data.isMock ? 'mock' : 'sandbox');
      }

      // Operational memory protection: Operational DB NEVER accepts non-production records
      if (this.isOperational && environment !== 'production') {
        return { ok: false, skipped: true, reason: 'non_production_data_rejected_from_operational_store' };
      }

      const createdAt = typeof data.created_at === 'number' ? data.created_at : Date.now();
      const nativeEvidence = data.verification_origin === 'core_observed_native';
      const candidate = data.history_metadata;
      const metadataEligible = role === 'coder' && (nativeEvidence || (executor === 'core' && attributionSource === 'direct'));
      const metadataValid = metadataEligible && candidate && typeof candidate === 'object' &&
        candidate.taskId === taskId && typeof candidate.workspacePath === 'string' &&
        path.isAbsolute(candidate.workspacePath) && fs.existsSync(candidate.workspacePath) &&
        fs.realpathSync(candidate.workspacePath) === candidate.workspacePath &&
        /^[a-f0-9]{64}$/.test(candidate.planDigest || '') &&
        /^[a-f0-9]{64}$/.test(candidate.approvedPlanDigest || '') &&
        (candidate.title === null || (typeof candidate.title === 'string' &&
          candidate.title.trim() === candidate.title && candidate.title.length > 0 &&
          Array.from(candidate.title).length <= 120 && !/[\u0000-\u001f\u007f]/u.test(candidate.title) &&
          !/(?:bearer\s+\S+|-----BEGIN|(?:api[_-]?key|token|password|secret)\s*[:=])/iu.test(candidate.title))) &&
        Array.isArray(candidate.approvedScope) && candidate.approvedScope.length > 0 && candidate.approvedScope.length <= 64 &&
        candidate.approvedScope.every(file => typeof file === 'string' && file.length > 0 && file.length <= 255 &&
          !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && !/[\u0000-\u001f\u007f]/u.test(file)) &&
        JSON.stringify(candidate.approvedScope).length <= 4096 &&
        (!nativeEvidence || (data.plan_digest === candidate.planDigest &&
          data.approved_plan_digest === candidate.approvedPlanDigest &&
          data.workspace_path === candidate.workspacePath));
      const metadata = metadataValid ? candidate : null;
      const planDigest = metadata ? metadata.planDigest
        : nativeEvidence && /^[a-f0-9]{64}$/.test(data.plan_digest || '') ? data.plan_digest : null;
      const approvedPlanDigest = metadata ? metadata.approvedPlanDigest
        : nativeEvidence && /^[a-f0-9]{64}$/.test(data.approved_plan_digest || '') ? data.approved_plan_digest : null;
      const verifiedFilesDigest = nativeEvidence && /^[a-f0-9]{64}$/.test(data.verified_files_digest || '') ? data.verified_files_digest : null;
      const workspacePath = metadata ? metadata.workspacePath
        : nativeEvidence && typeof data.workspace_path === 'string' ? data.workspace_path : null;
      const verificationOrigin = nativeEvidence && planDigest && approvedPlanDigest && verifiedFilesDigest && workspacePath
        ? 'core_observed_native' : null;
      const verificationExecutedCount = verificationOrigin && Number.isInteger(data.verification_executed_count) &&
        data.verification_executed_count >= 0
        ? data.verification_executed_count : null;
      const criticExecuted = verificationOrigin ? (data.critic_executed ? 1 : 0) : null;
      const semanticStatus = ['NOT_REQUESTED', 'COMPLETED', 'FAILED', 'UNREVIEWED'].includes(data.semantic_review_status)
        ? data.semantic_review_status : null;
      const boundedJson = (value) => {
        if (!value || typeof value !== 'object') return null;
        try {
          const json = JSON.stringify(value);
          return json.length <= 16000 ? json : null;
        } catch { return null; }
      };
      const semanticJson = boundedJson(data.semantic_review);
      const leaderJson = boundedJson(data.leader_decision);
      const provenanceJson = boundedJson(data.role_provenance);
      const approval = data.approval_provenance;
      const gitlessApproval = approval && approval.gitlessAuthorization;
      const executionKindForGitless = approval && approval.executionKind === 'core_run'
        ? 'core_run_gitless' : 'native_verification_gitless';
      const gitlessApprovalValid = gitlessApproval === undefined || Boolean(
        approval && gitlessApproval && gitlessApproval.source === 'reported_by_agent' &&
        typeof gitlessApproval.challengeId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(gitlessApproval.challengeId) &&
        gitlessApproval.executionKind === executionKindForGitless &&
        gitlessApproval.parentChallengeId === approval.challengeId && gitlessApproval.decision === 'APPROVE' &&
        gitlessApproval.parentExecutionKind === approval.executionKind &&
        gitlessApproval.parentExecutionDigest === (approval.executionDigest || null) &&
        gitlessApproval.taskId === approval.taskId && gitlessApproval.workspacePath === approval.workspacePath &&
        gitlessApproval.planDigest === approval.planDigest && gitlessApproval.approvedPlanDigest === approval.approvedPlanDigest &&
        gitlessApproval.receiptDigest === approval.receiptDigest && gitlessApproval.snapshotDigest === approval.snapshotDigest &&
        JSON.stringify(gitlessApproval.approvedScope) === JSON.stringify(approval.approvedScope) &&
        JSON.stringify(gitlessApproval.budget) === JSON.stringify(approval.budget) &&
        /^[a-f0-9]{64}$/.test(gitlessApproval.executionDigest || '')
      );
      const approvalJson = approval && approval.source === 'reported_by_agent' &&
        typeof approval.challengeId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(approval.challengeId) &&
        ['core_run', 'native_verification'].includes(approval.executionKind) &&
        /^[a-f0-9]{64}$/.test(approval.approvedPlanDigest || '') && gitlessApprovalValid
        ? boundedJson(approval) : null;
      if (nativeEvidence && (!verificationOrigin || verificationExecutedCount === null ||
          !['codex_interactive', 'antigravity_native', 'claude_native'].includes(data.executor) || data.attribution_source !== 'unverified_external')) {
        return { ok: false, error: 'incomplete_native_verification_provenance' };
      }
      if (nativeEvidence && !explicitNativeHost &&
          (candidate?.executionKind === 'native' || candidate?.nativeHost !== undefined ||
           data.role_provenance?.executionKind === 'native' || data.role_provenance?.nativeHost !== undefined)) {
        return { ok: false, error: 'incomplete_native_verification_provenance' };
      }
      if (explicitNativeHost && (!nativeEvidence || !metadata || candidate.executionKind !== 'native' || nativeExecutorForHost(candidate.nativeHost) !== rawExecutor ||
          data.role_provenance?.executionKind !== 'native' || data.role_provenance?.nativeHost !== candidate.nativeHost ||
          data.requested_model !== null || data.actual_model !== null || data.enforced_model !== null ||
          data.semantic_review_status !== 'NOT_REQUESTED')) {
        return { ok: false, error: 'incomplete_native_verification_provenance' };
      }
      if (verificationOrigin && success && (!verificationPassed || !criticPassed ||
          verificationExecutedCount < 1 || criticExecuted !== 1)) {
        return { ok: false, error: 'native_success_without_observed_checks_and_critic' };
      }

      const stmt = this.db.prepare(`
        INSERT INTO execution_attempts (
          task_id, task_category, role, model, attempt_type, attempt_index,
          success, verification_passed, critic_passed, fatal_violation,
          tokens, duration_ms, cost, environment, created_at,
          requested_model, enforced_model, actual_model, executor, attribution_source,
          plan_digest, approved_plan_digest, workspace_path, verified_files_digest,
          verification_origin, verification_executed_count, critic_executed,
          history_title, approved_scope_json, history_metadata_source, history_metadata_digest,
          semantic_review_status, semantic_review_json, leader_decision_json, role_provenance_json,
          approval_provenance_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        taskId,
        taskCategory,
        role,
        model,
        attemptType,
        attemptIndex,
        success,
        verificationPassed,
        criticPassed,
        fatalViolation,
        tokens,
        durationMs,
        cost,
        environment,
        createdAt,
        requestedModel,
        enforcedModel,
        actualModel,
        executor,
        attributionSource,
        planDigest,
        approvedPlanDigest,
        workspacePath,
        verifiedFilesDigest,
        verificationOrigin,
        verificationExecutedCount,
        criticExecuted,
        metadata ? metadata.title : null,
        metadata ? JSON.stringify(metadata.approvedScope) : null,
        metadata ? 'approved_plan_snapshot' : null,
        metadata ? computeHistoryMetadataDigest(metadata) : null,
        semanticStatus,
        semanticJson,
        leaderJson,
        provenanceJson,
        approvalJson
      );

      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err) {
      return { ok: false, error: storageErrorCode(err) };
    }
  }

  /**
   * Persists an authoritative handoff outcome.
   * Only successful App Server enforcement may create handoff evidence.
   *
   * @param {object} data
   * @param {string} data.task_id
   * @param {string} data.plan_digest
   * @param {string} [data.provider='codex']
   * @param {string} data.thread_id
   * @param {string} data.requested_model
   * @param {string} data.enforced_model
   * @param {string} data.thread_resolution_source
   * @param {number} [data.created_at]
   * @returns {{ ok: boolean, id?: number, error?: string }}
   */
  recordHandoff(data) {
    if (this.closed) return { ok: false, error: 'storage_closed' };
    if (this.readOnly) return { ok: false, error: 'storage_read_only' };
    if (!this.isAvailable()) {
      if (!this.init()) return { ok: false, error: this.initError ? this.initError.message : 'storage_unavailable' };
    }
    if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_data_payload' };

    try {
      const taskId = typeof data.task_id === 'string' && data.task_id.trim() ? data.task_id.trim() : 'UNKNOWN';
      const planDigest = typeof data.plan_digest === 'string' && data.plan_digest.trim() ? data.plan_digest.trim() : '';
      const provider = typeof data.provider === 'string' && data.provider.trim() ? data.provider.trim() : '';
      const threadId = typeof data.thread_id === 'string' && data.thread_id.trim() ? data.thread_id.trim() : '';
      const requestedModel = typeof data.requested_model === 'string' && data.requested_model.trim() ? data.requested_model.trim() : '';
      const enforcedModel = typeof data.enforced_model === 'string' && data.enforced_model.trim() ? data.enforced_model.trim() : '';
      const threadResolutionSource = typeof data.thread_resolution_source === 'string' && data.thread_resolution_source.trim() ? data.thread_resolution_source.trim() : '';
      const createdAt = typeof data.created_at === 'number' ? data.created_at : Date.now();

      if (!taskId || !planDigest || !provider || !threadId || !requestedModel || !enforcedModel || !threadResolutionSource) {
        return { ok: false, error: 'missing_required_handoff_fields' };
      }

      // Idempotency guard: If identical handoff evidence is already recorded, return existing row ID without creating a duplicate row
      const findStmt = this.db.prepare(`
        SELECT id FROM execution_handoffs
        WHERE task_id = ?
          AND plan_digest = ?
          AND provider = ?
          AND thread_id = ?
          AND requested_model = ?
          AND enforced_model = ?
          AND thread_resolution_source = ?
        LIMIT 1
      `);

      const existing = findStmt.get(
        taskId,
        planDigest,
        provider,
        threadId,
        requestedModel,
        enforcedModel,
        threadResolutionSource
      );

      if (existing) {
        return { ok: true, id: Number(existing.id), duplicate: true };
      }

      const stmt = this.db.prepare(`
        INSERT INTO execution_handoffs (
          task_id, plan_digest, provider, thread_id, requested_model,
          enforced_model, thread_resolution_source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        taskId,
        planDigest,
        provider,
        threadId,
        requestedModel,
        enforcedModel,
        threadResolutionSource,
        createdAt
      );

      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Resolves authoritative handoff evidence for a given task and plan digest.
   * Enforces strict non-recency ambiguity resolution:
   * - 0 records: { status: 'none', handoff: null, enforcedModel: null }
   * - 1 record or idempotent repeats to the SAME thread & SAME model:
   *     { status: 'unique', handoff: row, enforcedModel: row.enforced_model, threadId: row.thread_id, count }
   * - Multiple distinct threads or distinct models:
   *     { status: 'ambiguous', handoff: null, enforcedModel: null, reason: 'multiple_distinct_handoffs', distinctCount }
   *
   * @param {object} params
   * @param {string} params.task_id
   * @param {string} params.plan_digest
   * @returns {{ status: 'unique'|'none'|'ambiguous'|'unavailable', handoff?: object|null, enforcedModel: string|null, threadId?: string|null, reason?: string, count?: number, distinctCount?: number }}
   */
  resolveAuthoritativeHandoff(params = {}) {
    if (this.closed) return { status: 'unavailable', enforcedModel: null, error: 'storage_closed' };
    if (!this.isAvailable()) {
      if (!this.init()) return { status: 'unavailable', enforcedModel: null, error: 'storage_unavailable' };
    }

    const taskId = typeof params.task_id === 'string' ? params.task_id.trim() : '';
    const planDigest = typeof params.plan_digest === 'string' ? params.plan_digest.trim() : '';

    if (!taskId || !planDigest) {
      return { status: 'none', handoff: null, enforcedModel: null };
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, task_id, plan_digest, provider, thread_id, requested_model,
               enforced_model, thread_resolution_source, created_at
        FROM execution_handoffs
        WHERE task_id = ? AND plan_digest = ?
      `);
      const rows = stmt.all(taskId, planDigest);

      if (!rows || rows.length === 0) {
        return { status: 'none', handoff: null, enforcedModel: null };
      }

      const first = rows[0];
      const evidenceKey = row => JSON.stringify([
        row.provider,
        row.thread_id,
        row.requested_model,
        row.enforced_model,
        row.thread_resolution_source
      ]);
      const firstKey = evidenceKey(first);
      const isUnanimous = rows.every(row => evidenceKey(row) === firstKey);

      if (isUnanimous) {
        return {
          status: 'unique',
          handoff: rows[0],
          enforcedModel: first.enforced_model,
          threadId: first.thread_id,
          count: rows.length
        };
      }

      return {
        status: 'ambiguous',
        handoff: null,
        enforcedModel: null,
        reason: 'multiple_distinct_handoffs',
        distinctCount: new Set(rows.map(evidenceKey)).size
      };
    } catch (err) {
      return { status: 'unavailable', handoff: null, enforcedModel: null, error: err.message };
    }
  }

  /**
   * Finds an existing attempt matching the specified filter criteria.
   *
   * @param {object} filter
   * @param {string} filter.task_id
   * @param {string} [filter.executor='core']
   * @param {string} [filter.role='coder']
   * @param {string} [filter.attempt_type='initial']
   * @returns {object|null}
   */
  findAttempt(filter = {}) {
    if (this.closed) return null;
    if (!this.isAvailable()) {
      if (!this.init()) return null;
    }
    try {
      const taskId = typeof filter.task_id === 'string' ? filter.task_id.trim() : '';
      const executor = typeof filter.executor === 'string' ? filter.executor.trim() : 'core';
      const role = typeof filter.role === 'string' ? filter.role.trim() : 'coder';
      const attemptType = typeof filter.attempt_type === 'string' ? filter.attempt_type.trim() : 'initial';

      const stmt = this.db.prepare(`
        SELECT id, task_id, task_category, role, model, attempt_type, success,
               verification_passed, critic_passed, requested_model, enforced_model, actual_model,
               executor, attribution_source, created_at
        FROM execution_attempts
        WHERE task_id = ? AND executor = ? AND role = ? AND attempt_type = ?
        LIMIT 1
      `);
      return stmt.get(taskId, executor, role, attemptType) || null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves aggregated historical execution statistics for a given model, role, and category.
   *
   * @param {object} filter
   * @param {string} filter.model
   * @param {string} [filter.role='coder']
   * @param {string} [filter.taskCategory='general']
   * @param {string} [filter.attemptType='initial'] 'initial' | 'recovery' | 'all'
   * @param {string} [filter.environment='production']
   * @returns {{ totalSamples: number, failureCount: number, successCount: number, failureRate: number }}
   */
  getModelStatistics(filter = {}) {
    if (!this.isAvailable()) {
      if (!this.init()) {
        return { totalSamples: 0, failureCount: 0, successCount: 0, failureRate: 0 };
      }
    }

    try {
      const model = typeof filter.model === 'string' ? filter.model : '';
      const role = typeof filter.role === 'string' ? filter.role : 'coder';
      const category = typeof filter.taskCategory === 'string' ? filter.taskCategory : 'general';
      const attemptType = typeof filter.attemptType === 'string' ? filter.attemptType : 'initial';
      const environment = typeof filter.environment === 'string' ? filter.environment.toLowerCase() : 'production';
      const executor = typeof filter.executor === 'string' && filter.executor.trim()
        ? filter.executor.trim()
        : 'core';
      const attributionSource = typeof filter.attributionSource === 'string' && filter.attributionSource.trim()
        ? filter.attributionSource.trim()
        : (typeof filter.attribution_source === 'string' && filter.attribution_source.trim() ? filter.attribution_source.trim() : 'direct');

      let whereClause = `
        environment = ?
        AND role = ?
        AND model = ?
        AND executor = ?
        AND attribution_source = ?
      `;
      const params = [environment, role, model, executor, attributionSource];

      if (category && category !== 'general' && category !== '*') {
        whereClause += ' AND task_category = ?';
        params.push(category);
      }

      if (attemptType && attemptType !== 'all') {
        whereClause += ' AND attempt_type = ?';
        params.push(attemptType);
      }

      // If evaluating production, strictly exclude any non-production task signatures (defense against misclassified rows)
      if (environment === 'production') {
        whereClause += `
          AND UPPER(task_id) NOT LIKE 'BENCH-%'
          AND UPPER(task_id) NOT LIKE 'CAL-%'
          AND UPPER(task_id) NOT LIKE 'TEST-%'
          AND UPPER(task_id) NOT LIKE 'MOCK-%'
          AND UPPER(task_id) NOT LIKE 'CANARY-%'
          AND UPPER(task_id) NOT LIKE 'SANDBOX-%'
          AND UPPER(task_id) NOT LIKE 'EVAL-%'
          AND UPPER(task_id) NOT LIKE '%-MOCK%'
          AND UPPER(task_id) NOT LIKE '%-TEST%'
          AND UPPER(task_id) NOT LIKE '%-SANDBOX%'
        `;
      }

      const query = `
        WITH latest_attempts AS (
          SELECT
            task_id,
            success,
            ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC, id DESC) as rn
          FROM execution_attempts
          WHERE ${whereClause}
        )
        SELECT
          COUNT(*) as total_samples,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
        FROM latest_attempts
        WHERE rn = 1
      `;

      const stmt = this.db.prepare(query);
      const row = stmt.get(...params);

      const totalSamples = row && row.total_samples ? Number(row.total_samples) : 0;
      const failureCount = row && row.failure_count ? Number(row.failure_count) : 0;
      const successCount = row && row.success_count ? Number(row.success_count) : 0;
      const failureRate = totalSamples > 0 ? (failureCount / totalSamples) : 0;

      return {
        totalSamples,
        failureCount,
        successCount,
        failureRate
      };
    } catch {
      return { totalSamples: 0, failureCount: 0, successCount: 0, failureRate: 0 };
    }
  }

  /**
   * Evaluates whether a candidate model should be escalated based on production history.
   *
   * Invariants:
   * 1. Strictly considers production runs (excludes benchmark, sandbox, mock).
   * 2. Evaluates initial attempts only (distinguishes initial failure from recovered success).
   * 3. Requires at least minSamples independent production observations.
   * 4. If samples < minSamples, returns shouldEscalate = false (preserves current routing).
   * 5. If failure rate >= failureThreshold, returns shouldEscalate = true.
   *
   * @param {object} params
   * @param {string} params.model Candidate model identifier
   * @param {string} [params.role='coder']
   * @param {string} [params.taskCategory='general']
   * @param {string} [params.environment='production']
   * @returns {{
   *   shouldEscalate: boolean,
   *   reason: string,
   *   sampleCount: number,
   *   failureCount?: number,
   *   failureRate?: number,
   *   minSamples: number
   * }}
   */
  evaluateModelCandidate(params = {}) {
    if (this.closed) {
      return {
        shouldEscalate: false,
        reason: 'storage_closed',
        sampleCount: 0,
        minSamples: this.minSamples
      };
    }

    if (!this.isAvailable()) {
      if (!this.init()) {
        return {
          shouldEscalate: false,
          reason: 'storage_unavailable',
          sampleCount: 0,
          minSamples: this.minSamples
        };
      }
    }

    try {
      const environment = typeof params.environment === 'string'
        ? params.environment.toLowerCase()
        : 'production';

      // Non-production queries are never evaluated for production routing feedback
      if (environment !== 'production') {
        return {
          shouldEscalate: false,
          reason: 'non_production_environment_ignored',
          sampleCount: 0,
          minSamples: this.minSamples
        };
      }

      const stats = this.getModelStatistics({
        model: params.model,
        role: params.role || 'coder',
        taskCategory: params.taskCategory || 'general',
        attemptType: 'initial',
        environment: 'production'
      });

      // Guard: Insufficient historical samples
      if (stats.totalSamples < this.minSamples) {
        return {
          shouldEscalate: false,
          reason: 'insufficient_samples',
          sampleCount: stats.totalSamples,
          minSamples: this.minSamples
        };
      }

      // Evaluation: High initial failure rate trigger
      if (stats.failureRate >= this.failureThreshold) {
        return {
          shouldEscalate: true,
          reason: 'high_initial_failure_rate',
          sampleCount: stats.totalSamples,
          failureCount: stats.failureCount,
          failureRate: stats.failureRate,
          minSamples: this.minSamples
        };
      }

      // Default: Acceptable historical performance
      return {
        shouldEscalate: false,
        reason: 'acceptable_performance',
        sampleCount: stats.totalSamples,
        failureCount: stats.failureCount,
        failureRate: stats.failureRate,
        minSamples: this.minSamples
      };
    } catch (err) {
      return {
        shouldEscalate: false,
        reason: 'evaluation_error',
        error: err.message,
        sampleCount: 0,
        minSamples: this.minSamples
      };
    }
  }

  /**
   * Clears historical records, optionally filtered by environment.
   * Useful for test isolation.
   *
   * @param {string} [environment] Optional environment filter
   */
  clearHistory(environment = null) {
    if (!this.isAvailable()) return;
    try {
      if (environment) {
        this.db.prepare('DELETE FROM execution_attempts WHERE environment = ?').run(environment.toLowerCase());
      } else {
        this.db.exec('DELETE FROM execution_attempts');
      }
    } catch {}
  }
}

module.exports = {
  storageErrorCode,
  ExecutionHistoryStore,
  computeHistoryMetadataDigest,
  resolveHistoryDbPath,
  DEFAULT_DB_PATH,
  DEFAULT_OPERATIONAL_DB_PATH,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_FAILURE_THRESHOLD,
  isTestProcess,
  getIsolatedTestDbPath,
  isNonProductionTask,
  getDatabaseSyncClass,
  _resetDatabaseSyncClass: (val) => { DatabaseSyncClass = val; }
};
