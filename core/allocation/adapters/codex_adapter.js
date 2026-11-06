/**
 * 🌐 Universal Agent Core Hub - Codex Adapter
 * Phase 3 Implementation: CLI Discovery & Telemetry for OpenAI / Codex CLI
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {
  decodePlanReceipt,
  normalizeWorkspacePath,
  canonicalize,
  sha256Digest
} = require('../../workflow/plan_receipt');
const { ProviderAdapter } = require('../provider_adapter');
const { validateProviderCatalog, validateProviderUsage } = require('../contracts');
const {
  updateCodexThreadSettings,
  CodexInteractiveHandoff,
  HANDOFF_STATUS,
  resolveCodexThreadId,
  isValidCodexThreadId
} = require('./codex_interactive_handoff');

let isBenchmarkSandboxFn = null;
try {
  const sb = require('../../benchmark/sandbox');
  isBenchmarkSandboxFn = sb.isBenchmarkSandbox;
} catch {}

/**
 * Strips CLI metadata/telemetry footers from raw Codex stdout.
 * @param {string} text
 * @returns {string}
 */
function stripCodexCliMetadata(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^OpenAI Codex [^\n\r]+/gim, '')
    .replace(/^(?:model|reasoning effort|session id|provider|cost|elapsed):\s*[^\n\r]+/gim, '')
    .replace(/^tokens used\s*(?::\s*[0-9,]+|\r?\n\s*[0-9,]+)?/gim, '')
    .trim();
}

function buildStructuredArtifactSchema(snapshot) {
  const files = snapshot && snapshot.filesToModify;
  const planFiles = snapshot && snapshot.plan && snapshot.plan.filesToModify;
  if (!Array.isArray(files) || files.length === 0 || !Array.isArray(planFiles) ||
      JSON.stringify(files) !== JSON.stringify(planFiles)) {
    throw new Error('Approved Plan file scope is missing or inconsistent for structured Coder output.');
  }
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || !file.trim() || path.isAbsolute(file) ||
        /^[a-zA-Z]:[\\/]/.test(file) || file.split(/[\\/]+/).some((part) => !part || part === '..' || part === '.')) {
      throw new Error('Approved Plan contains an unsafe file path for structured Coder output.');
    }
    const normalized = file.replace(/\\/g, '/');
    if (seen.has(normalized)) throw new Error('Approved Plan contains duplicate file paths for structured Coder output.');
    seen.add(normalized);
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['files'],
    properties: {
      files: {
        type: 'array',
        minItems: files.length,
        maxItems: files.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'content'],
          properties: {
            path: { type: 'string', enum: files },
            content: { type: 'string', minLength: 1 }
          }
        }
      }
    }
  };
}

function validateStructuredArtifactText(text, expectedFiles) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { status: 'invalid', reasonCode: 'invalid_json', files: [] };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Array.isArray(payload.files)) {
    return { status: 'invalid', reasonCode: 'invalid_envelope', files: [] };
  }
  if (payload.files.length !== expectedFiles.length) {
    return { status: 'invalid', reasonCode: 'incomplete_scope', files: [] };
  }
  const seen = new Set();
  for (const artifact of payload.files) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
        Object.keys(artifact).length !== 2 || typeof artifact.path !== 'string' ||
        typeof artifact.content !== 'string' || !artifact.content.trim()) {
      return { status: 'invalid', reasonCode: 'invalid_artifact', files: [] };
    }
    if (!expectedFiles.includes(artifact.path)) {
      return { status: 'invalid', reasonCode: 'out_of_scope_path', files: [] };
    }
    if (seen.has(artifact.path)) {
      return { status: 'invalid', reasonCode: 'duplicate_path', files: [] };
    }
    seen.add(artifact.path);
  }
  if (expectedFiles.some((file) => !seen.has(file))) {
    return { status: 'invalid', reasonCode: 'incomplete_scope', files: [] };
  }
  return {
    status: 'valid',
    reasonCode: null,
    files: payload.files.map(({ path: artifactPath, content }) => ({ path: artifactPath, content }))
  };
}

class CodexAdapter extends ProviderAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.cliPath] Path to codex binary (default: 'codex')
   * @param {number} [options.timeoutMs] CLI execution timeout
   * @param {Function} [options.execRunner] Mock runner for testing
   */
  constructor(options = {}) {
    super({
      providerId: 'codex',
      timeoutMs: options.timeoutMs,
      execRunner: options.execRunner
    });
    this.cliPath = options.cliPath || 'codex';
    this.supportsStructuredArtifactOutput = true;
    this.supportsReadOnlySemanticCritic = true;
    this._gitlessChallenges = new WeakMap();
    this._gitlessAuthorizations = new WeakMap();
  }

  _canonicalWorkspace(targetCwd) {
    if (typeof targetCwd !== 'string' || !targetCwd.trim()) {
      throw new Error('A non-empty workspace directory is required.');
    }
    const requested = path.resolve(targetCwd);
    if (fs.lstatSync(requested).isSymbolicLink()) {
      throw new Error('A symbolic-link workspace root is not accepted for Git-less execution.');
    }
    const canonical = fs.realpathSync(requested);
    if (!fs.statSync(canonical).isDirectory()) throw new Error('Workspace path is not a directory.');
    return canonical;
  }

  _findGitMetadata(canonicalWorkspace) {
    let current = canonicalWorkspace;
    for (;;) {
      try {
        fs.lstatSync(path.join(current, '.git'));
        return true;
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw new Error(`Workspace Git metadata could not be inspected safely: ${error.message}`);
        }
      }
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }

  isGitlessWorkspace(targetCwd) {
    const canonicalWorkspace = this._canonicalWorkspace(targetCwd);
    return !this._findGitMetadata(canonicalWorkspace);
  }

  _validateGitlessPlanSnapshot(snapshot, canonicalWorkspace) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.taskId ||
        !snapshot.task || snapshot.task.id !== snapshot.taskId ||
        typeof snapshot.task.userPrompt !== 'string' || !snapshot.planReceipt ||
        !Array.isArray(snapshot.filesToModify) || snapshot.filesToModify.length === 0 ||
        !Array.isArray(snapshot.acceptanceCriteria) || !snapshot.plan) {
      throw new Error('A complete approved Plan Snapshot with Receipt and file scope is required.');
    }
    const plannedFiles = snapshot.plan.filesToModify;
    const plannedCriteria = snapshot.plan.acceptanceCriteria;
    if (!Array.isArray(plannedFiles) || JSON.stringify(plannedFiles) !== JSON.stringify(snapshot.filesToModify) ||
        !Array.isArray(plannedCriteria) || JSON.stringify(plannedCriteria) !== JSON.stringify(snapshot.acceptanceCriteria)) {
      throw new Error('Plan Snapshot file scope or acceptance criteria do not match the approved Plan.');
    }
    for (const file of snapshot.filesToModify) {
      if (typeof file !== 'string' || !file.trim() || path.isAbsolute(file) ||
          file.split(/[\\/]+/).includes('..') || file.split(/[\\/]+/).includes('')) {
        throw new Error('Plan contains an unsafe or ambiguous file scope path.');
      }
    }
    const receipt = decodePlanReceipt(snapshot.planReceipt, {
      cwd: canonicalWorkspace,
      taskPrompt: snapshot.task.userPrompt
    });
    if (!receipt || receipt.taskId !== snapshot.taskId || receipt.provider !== this.providerId ||
        normalizeWorkspacePath(receipt.workspacePath) !== canonicalWorkspace ||
        typeof receipt.approvedPlanDigest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.approvedPlanDigest)) {
      throw new Error('Plan Receipt is invalid or is not bound to this Provider, task, and canonical workspace.');
    }
    let coreRoot;
    try {
      const packageRoot = path.resolve(__dirname, '../../..');
      const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
      if (!['hotzen', 'agent-hub-init'].includes(manifest.name) || manifest.bin?.core !== './cli/index.js') {
        throw new Error('Unexpected Core package layout.');
      }
      coreRoot = fs.realpathSync(packageRoot);
    } catch {
      throw new Error('Core package root could not be verified for Git-less workspace authorization.');
    }
    const protectedRoots = [
      path.parse(canonicalWorkspace).root,
      (() => { try { return fs.realpathSync(process.env.HOME || os.homedir()); } catch { return path.resolve(process.env.HOME || os.homedir()); } })(),
      coreRoot
    ];
    if (protectedRoots.includes(canonicalWorkspace)) {
      throw new Error('System root, user home, and Core repository roots cannot be authorized as Git-less workspaces.');
    }
    return receipt;
  }

  createGitlessWorkspaceAuthorizationChallenge(approvedPlanSnapshot, targetCwd, agentBinding = null) {
    const canonicalWorkspace = this._canonicalWorkspace(targetCwd);
    if (this._findGitMetadata(canonicalWorkspace)) {
      throw new Error('Git-less authorization is not applicable to a workspace with Git metadata.');
    }
    const receipt = this._validateGitlessPlanSnapshot(approvedPlanSnapshot, canonicalWorkspace);
    const attemptId = crypto.randomUUID();
    const receiptDigest = sha256Digest(approvedPlanSnapshot.planReceipt);
    const snapshotDigest = sha256Digest(canonicalize(approvedPlanSnapshot));
    if (agentBinding) {
      const expectedGitlessKind = agentBinding.parentExecutionKind === 'core_run'
        ? 'core_run_gitless' : 'native_verification_gitless';
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(agentBinding.challengeId || '') ||
          !/^[A-Za-z0-9_-]{16,128}$/.test(agentBinding.parentChallengeId || '') ||
          !['core_run', 'native_verification'].includes(agentBinding.parentExecutionKind) ||
          agentBinding.executionKind !== expectedGitlessKind ||
          agentBinding.taskId !== approvedPlanSnapshot.taskId || agentBinding.workspacePath !== canonicalWorkspace ||
          agentBinding.receiptDigest !== receiptDigest || agentBinding.snapshotDigest !== snapshotDigest ||
          agentBinding.planDigest !== receipt.planDigest || agentBinding.approvedPlanDigest !== receipt.approvedPlanDigest ||
          JSON.stringify(agentBinding.approvedScope) !== JSON.stringify(approvedPlanSnapshot.filesToModify) ||
          !agentBinding.budget || typeof agentBinding.budget !== 'object' || Array.isArray(agentBinding.budget) ||
          !/^[a-f0-9]{64}$/.test(agentBinding.executionDigest || '') ||
          !(agentBinding.parentExecutionDigest === null || /^[a-f0-9]{64}$/.test(agentBinding.parentExecutionDigest || ''))) {
        throw new Error('Agent Git-less challenge is not bound to the exact approved execution and Plan.');
      }
    }
    const confirmationCode = `AUTHORIZE GITLESS ${approvedPlanSnapshot.taskId} ${receiptDigest.slice(0, 12)} ${attemptId.slice(0, 8)}`;
    const challenge = Object.freeze({
      workspace: canonicalWorkspace,
      taskId: receipt.taskId,
      attemptId,
      receiptDigest,
      snapshotDigest,
      ...(agentBinding ? { agentChallengeId: agentBinding.challengeId,
        executionChallengeId: agentBinding.parentChallengeId, executionKind: agentBinding.executionKind } : {}),
      confirmationCode
    });
    this._gitlessChallenges.set(challenge, {
      workspace: canonicalWorkspace,
      taskId: receipt.taskId,
      attemptId,
      receiptDigest,
      snapshotDigest,
      agentBinding: agentBinding ? Object.freeze({ ...agentBinding }) : null,
      createdAt: Date.now()
    });
    return challenge;
  }

  _issueGitlessWorkspaceAuthorization(state) {
    const authorization = Object.freeze({
      version: 'core.codex.gitless-workspace-authorization.v1',
      taskId: state.taskId,
      workspace: state.workspace,
      attemptId: state.attemptId,
      receiptDigest: state.receiptDigest,
      snapshotDigest: state.snapshotDigest,
      authorizedAt: Date.now()
    });
    this._gitlessAuthorizations.set(authorization, { ...state, revoked: false });
    return authorization;
  }

  confirmGitlessWorkspaceAuthorizationFromAgent(challenge, reports = {}) {
    const state = challenge && this._gitlessChallenges.get(challenge);
    const executionApproval = reports.executionApproval;
    const gitlessAuthorization = reports.gitlessAuthorization;
    const binding = state && state.agentBinding;
    const matchesBinding = (report) => Boolean(report && binding &&
      report.source === 'reported_by_agent' && report.taskId === binding.taskId &&
      report.workspacePath === binding.workspacePath && report.receiptDigest === binding.receiptDigest &&
      report.snapshotDigest === binding.snapshotDigest && report.planDigest === binding.planDigest &&
      report.approvedPlanDigest === binding.approvedPlanDigest &&
      JSON.stringify(report.approvedScope) === JSON.stringify(binding.approvedScope) &&
      JSON.stringify(report.budget) === JSON.stringify(binding.budget));
    const valid = Boolean(state && binding && state.createdAt + 5 * 60 * 1000 >= Date.now() &&
      challenge.agentChallengeId === binding.challengeId &&
      challenge.executionChallengeId === binding.parentChallengeId &&
      executionApproval && executionApproval.source === 'reported_by_agent' &&
      executionApproval.challengeId === binding.parentChallengeId && executionApproval.decision === 'APPROVE' &&
      executionApproval.executionKind === binding.parentExecutionKind &&
      executionApproval.executionDigest === binding.parentExecutionDigest &&
      matchesBinding(executionApproval) &&
      gitlessAuthorization && gitlessAuthorization.source === 'reported_by_agent' &&
      gitlessAuthorization.challengeId === binding.challengeId &&
      gitlessAuthorization.parentChallengeId === binding.parentChallengeId &&
      gitlessAuthorization.parentExecutionKind === binding.parentExecutionKind &&
      gitlessAuthorization.parentExecutionDigest === binding.parentExecutionDigest &&
      gitlessAuthorization.executionKind === binding.executionKind &&
      gitlessAuthorization.decision === 'APPROVE' && matchesBinding(gitlessAuthorization) &&
      gitlessAuthorization.executionDigest === binding.executionDigest &&
      gitlessAuthorization.workspacePath === state.workspace &&
      gitlessAuthorization.taskId === state.taskId &&
      gitlessAuthorization.receiptDigest === state.receiptDigest &&
      gitlessAuthorization.snapshotDigest === state.snapshotDigest);
    if (!valid) {
      if (challenge) this._gitlessChallenges.delete(challenge);
      return null;
    }
    this._gitlessChallenges.delete(challenge);
    return this._issueGitlessWorkspaceAuthorization(state);
  }

  confirmGitlessWorkspaceAuthorization(challenge, typedConfirmation) {
    const state = challenge && this._gitlessChallenges.get(challenge);
    if (!state || state.createdAt + 5 * 60 * 1000 < Date.now() || typedConfirmation !== challenge.confirmationCode) {
      if (challenge) this._gitlessChallenges.delete(challenge);
      return null;
    }
    this._gitlessChallenges.delete(challenge);
    return this._issueGitlessWorkspaceAuthorization(state);
  }

  revokeGitlessWorkspaceAuthorization(authorization) {
    const state = authorization && this._gitlessAuthorizations.get(authorization);
    if (!state) return false;
    state.revoked = true;
    this._gitlessAuthorizations.delete(authorization);
    return true;
  }

  _validateGitlessWorkspaceAuthorization(authorization, snapshot, targetCwd, approvalDecision) {
    const state = authorization && this._gitlessAuthorizations.get(authorization);
    const canonicalWorkspace = this._canonicalWorkspace(targetCwd);
    if (!state || state.revoked || approvalDecision !== 'APPROVE' || !snapshot ||
        state.createdAt + 5 * 60 * 1000 < Date.now() ||
        canonicalWorkspace !== state.workspace ||
        snapshot.taskId !== state.taskId || !snapshot.planReceipt ||
        sha256Digest(snapshot.planReceipt) !== state.receiptDigest ||
        sha256Digest(canonicalize(snapshot)) !== state.snapshotDigest ||
        authorization.version !== 'core.codex.gitless-workspace-authorization.v1' ||
        authorization.workspace !== canonicalWorkspace || authorization.taskId !== snapshot.taskId ||
        authorization.attemptId !== state.attemptId ||
        authorization.receiptDigest !== state.receiptDigest || authorization.snapshotDigest !== state.snapshotDigest) {
      throw new Error('Git-less execution authorization is missing, expired, revoked, or mismatched with the approved Plan and workspace.');
    }
    this._validateGitlessPlanSnapshot(snapshot, canonicalWorkspace);
    return canonicalWorkspace;
  }

  _gitlessAuthorizationFailure(reasonCode) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Codex Git-less workspace authorization blocked execution.',
      code: 1,
      timedOut: false,
      requestedModel: null,
      requestedReasoningEffort: null,
      actualModel: null,
      actualReasoningEffort: null,
      tokensUsed: null,
      textResult: '',
      modelResponse: '',
      semanticReviewError: reasonCode,
      providerSubprocessInvoked: false
    };
  }

  /**
   * Checks if Codex CLI is available.
   * @param {object} [options]
   * @returns {Promise<boolean>}
   */
  async isAvailable(options = {}) {
    return this.isAvailableSync(options);
  }

  /**
   * Synchronous availability check.
   * @param {object} [options]
   * @returns {boolean}
   */
  isAvailableSync(options = {}) {
    const res = this.safeExecSync(this.cliPath, ['--version'], options);
    return res.ok && typeof res.stdout === 'string' && res.stdout.trim().length > 0;
  }

  /**
   * Discovers available models and provider-native reasoning efforts from Codex.
   * Runs `codex debug models`.
   * @param {object} [options]
   * @returns {Promise<object>} Normalized ProviderCatalog
   */
  async discover(options = {}) {
    return this.discoverSync(options);
  }

  /**
   * Synchronous discovery.
   * @param {object} [options]
   * @returns {object} Normalized ProviderCatalog
   */
  discoverSync(options = {}) {
    const res = this.safeExecSync(this.cliPath, ['debug', 'models'], options);

    if (!res.ok || !res.stdout || typeof res.stdout !== 'string') {
      return {
        providerId: this.providerId,
        current: null,
        models: []
      };
    }

    const catalog = this._parseDebugModelsOutput(res.stdout);

    const check = validateProviderCatalog(catalog);
    if (!check.valid) {
      return {
        providerId: this.providerId,
        current: null,
        models: []
      };
    }

    return catalog;
  }

  /**
   * Parses the output of `codex debug models`.
   * Safely handles JSON or malformed output.
   * @param {string} outputText
   * @returns {object}
   * @private
   */
  _parseDebugModelsOutput(outputText) {
    let parsedJson = null;

    try {
      parsedJson = JSON.parse(outputText);
    } catch {
      // In case stdout contains preamble or trailing logs, attempt to find first '{' and last '}'
      const start = outputText.indexOf('{');
      const end = outputText.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          parsedJson = JSON.parse(outputText.slice(start, end + 1));
        } catch {
          parsedJson = null;
        }
      }
    }

    if (!parsedJson || !Array.isArray(parsedJson.models)) {
      return {
        providerId: this.providerId,
        current: null,
        models: []
      };
    }

    const models = [];
    const seenSlugs = new Set();

    for (const rawModel of parsedJson.models) {
      if (!rawModel || typeof rawModel !== 'object') continue;

      const slug = rawModel.slug || rawModel.id;
      if (!slug || typeof slug !== 'string' || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      // Extract provider-native reasoning effort strings
      // e.g. [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }, { effort: "max" }, { effort: "ultra" }]
      const supportedEfforts = [];
      const rawEfforts = rawModel.supported_reasoning_levels || rawModel.supportedEfforts || [];

      if (Array.isArray(rawEfforts)) {
        for (const effortItem of rawEfforts) {
          if (typeof effortItem === 'string' && effortItem.trim()) {
            supportedEfforts.push(effortItem.trim());
          } else if (effortItem && typeof effortItem.effort === 'string' && effortItem.effort.trim()) {
            supportedEfforts.push(effortItem.effort.trim());
          }
        }
      }

      const defaultEffort = typeof rawModel.default_reasoning_level === 'string' && rawModel.default_reasoning_level.trim()
        ? rawModel.default_reasoning_level.trim()
        : undefined;

      const displayName = typeof rawModel.display_name === 'string' && rawModel.display_name.trim()
        ? rawModel.display_name.trim()
        : slug;

      models.push({
        id: slug,
        displayName,
        discoverable: true,
        access: 'unknown', // Conservative entitlement reporting per Phase 3 specifications
        supportedEfforts,
        defaultEffort
      });
    }

    return {
      providerId: this.providerId,
      current: null,
      models
    };
  }

  /**
   * Retrieves usage telemetry.
   * Per Phase 3 specifications: If the live app-server protocol is unverified in production,
   * returns an explicit unsupported/unknown result without guessing speculative behavior.
   * @param {object} [_options]
   * @returns {Promise<object>} Normalized ProviderUsage
   */
  async getUsage(_options = {}) {
    return this.getUsageSync(_options);
  }

  /**
   * Synchronous usage retrieval.
   * @param {object} [_options]
   * @returns {object} Normalized ProviderUsage
   */
  getUsageSync(_options = {}) {
    const usage = {
      ordinaryUsageAllowed: null,
      windows: [],
      credits: null,
      status: 'unsupported',
      message: 'Codex usage discovery protocol (app-server) is not yet verified'
    };

    validateProviderUsage(usage);
    return usage;
  }

  /**
   * Executes a command or prompt using OpenAI Codex CLI with the allocated model and reasoning configuration.
   * Keeps provider-specific CLI flags ('exec', '-m', '-c model_reasoning_effort=...') strictly inside the adapter boundary.
   *
   * @param {object} resolvedConfig ResolvedExecutionConfig from ModelAllocator
   * @param {string} prompt Prompt or instructions to execute
   * @param {object} [options] Execution options
   * @param {boolean} [options.ephemeral=true] Whether to run in ephemeral mode without persisting session DBs
   * @returns {object} { ok: boolean, stdout: string, stderr: string, code: number | null, requestedModel: string | null, requestedReasoningEffort: string | null, actualModel: string | null, actualReasoningEffort: string | null, tokensUsed: number | null }
   */
  executeSync(resolvedConfig, prompt, options = {}) {
    if (resolvedConfig && (resolvedConfig.status === 'unavailable' || resolvedConfig.status === 'insufficient_capability')) {
      return {
        ok: false,
        stdout: '',
        stderr: `Cannot execute allocation with status '${resolvedConfig.status}'`,
        code: 1,
        requestedModel: (resolvedConfig && resolvedConfig.model) ? resolvedConfig.model : null,
        requestedReasoningEffort: (resolvedConfig && resolvedConfig.reasoningEffort) ? resolvedConfig.reasoningEffort : null,
        actualModel: null,
        actualReasoningEffort: null,
        tokensUsed: null,
        textResult: '',
        modelResponse: ''
      };
    }

    if (resolvedConfig && resolvedConfig.reasoningEffort) {
      const effort = String(resolvedConfig.reasoningEffort).trim().toLowerCase();
      if (!VALID_CODEX_REASONING_EFFORTS.includes(effort)) {
        return {
          ok: false,
          stdout: '',
          stderr: `Unsupported reasoning effort '${resolvedConfig.reasoningEffort}' for Codex`,
          code: 1,
          requestedModel: (resolvedConfig && resolvedConfig.model) ? resolvedConfig.model : null,
          requestedReasoningEffort: resolvedConfig.reasoningEffort,
          actualModel: null,
          actualReasoningEffort: null,
          tokensUsed: null,
          textResult: '',
          modelResponse: ''
        };
      }
    }

    const structuredCoderExecution = options.role === 'coder' && options.structuredArtifactDelivery === true;
    const semanticCriticReadOnly = options.role === 'critic' && options.semanticCriticReadOnly === true;
    let structuredArtifactSchema = null;
    let structuredArtifactFiles = null;
    let structuredTempDir = null;
    if (structuredCoderExecution) {
      try {
        structuredArtifactSchema = buildStructuredArtifactSchema(options.approvedPlanSnapshot);
        structuredArtifactFiles = options.approvedPlanSnapshot.filesToModify.slice();
        structuredTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-core-codex-artifacts-'));
        const schemaPath = path.join(structuredTempDir, 'coder-artifacts.schema.json');
        fs.writeFileSync(schemaPath, JSON.stringify(structuredArtifactSchema), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        options = { ...options, structuredArtifactSchemaPath: schemaPath };
      } catch (error) {
        if (structuredTempDir) {
          try { fs.rmSync(structuredTempDir, { recursive: true, force: true }); } catch {}
        }
        return {
          ok: false, stdout: '', stderr: 'Could not prepare the approved structured Coder output contract.',
          code: null, timedOut: false, textResult: '', modelResponse: '',
          structuredArtifactResult: { status: 'invalid', reasonCode: 'schema_setup_failed', files: [] }
        };
      }
    }

    const args = ['exec'];
    if (options.ephemeral !== false) {
      args.push('--ephemeral');
    }

    // Sandbox execution protection:
    // Apply benchmark sandbox flags only inside Core-verified isolated sandboxes.
    // Git-less user workspaces use only the separately authorized Git-check exception below.
    const targetCwd = options.cwd || process.cwd();
    const isSandboxExecution = this._isDedicatedSandbox(targetCwd, options.isSandbox);
    let canonicalGitlessWorkspace = null;
    if (!isSandboxExecution) {
      let gitless = false;
      try {
        gitless = this.isGitlessWorkspace(targetCwd);
      } catch (error) {
        if (structuredTempDir) {
          try { fs.rmSync(structuredTempDir, { recursive: true, force: true }); } catch {}
        }
        return this._gitlessAuthorizationFailure('unknown_adapter_failure');
      }
      if (gitless) {
        try {
          canonicalGitlessWorkspace = this._validateGitlessWorkspaceAuthorization(
            options.gitlessWorkspaceAuthorization,
            options.approvedPlanSnapshot,
            targetCwd,
            options.approvalDecision
          );
        } catch (error) {
          if (structuredTempDir) {
            try { fs.rmSync(structuredTempDir, { recursive: true, force: true }); } catch {}
          }
          return this._gitlessAuthorizationFailure(options.gitlessWorkspaceAuthorization
            ? 'gitless_authorization_invalid' : 'gitless_authorization_required');
        }
      }
    }
    if (isSandboxExecution) {
      args.push('--skip-git-repo-check');
      if (semanticCriticReadOnly) {
        args.push('-s', 'read-only');
      } else if (structuredCoderExecution) {
        args.push('-s', 'read-only');
      } else if (options.sandboxMode && options.sandboxMode !== 'workspace-write') {
        args.push('-s', options.sandboxMode);
      } else if (!semanticCriticReadOnly) {
        args.push('--approve-for-me');
      }
      args.push('-C', targetCwd);
    } else if (canonicalGitlessWorkspace) {
      // This bypasses only Codex's Git trust check; default filesystem sandboxing and approvals remain unchanged.
      args.push('--skip-git-repo-check');
    }

    if ((structuredCoderExecution || semanticCriticReadOnly) && !isSandboxExecution) {
      args.push('-s', 'read-only');
    }
    if (structuredCoderExecution) {
      args.push('--output-schema', options.structuredArtifactSchemaPath);
    }

    if (resolvedConfig && typeof resolvedConfig.model === 'string' && resolvedConfig.model.trim()) {
      args.push('-m', resolvedConfig.model.trim());
    }

    if (resolvedConfig && typeof resolvedConfig.reasoningEffort === 'string' && resolvedConfig.reasoningEffort.trim()) {
      const effort = resolvedConfig.reasoningEffort.trim().toLowerCase();
      args.push('-c', `model_reasoning_effort="${effort}"`);
    }

    // Setup message capture file using supported -o, --output-last-message
    let semanticTempDir = null;
    let outputLastMessageFile = structuredCoderExecution ? path.join(structuredTempDir, 'coder-output.json') : (options.outputLastMessageFile || null);
    let autoCreatedMsgFile = structuredCoderExecution;
    if (semanticCriticReadOnly) {
      try {
        semanticTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-core-codex-critic-'));
        outputLastMessageFile = path.join(semanticTempDir, 'critic-output.txt');
        autoCreatedMsgFile = true;
      } catch {
        return { ok: false, stdout: '', stderr: 'Could not prepare private Critic output capture.', code: null,
          timedOut: false, textResult: '', modelResponse: '', semanticReviewError: 'unknown_adapter_failure',
          providerSubprocessInvoked: false };
      }
    }
    if (!structuredCoderExecution && !semanticCriticReadOnly && !outputLastMessageFile && (options.captureLastMessage === true || (!this.execRunner && options.captureLastMessage !== false))) {
      const baseDir = options.cwd || os.tmpdir();
      outputLastMessageFile = path.join(baseDir, `.codex_last_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
      autoCreatedMsgFile = true;
    }

    if (outputLastMessageFile) {
      args.push('-o', outputLastMessageFile);
    }

    if (typeof prompt === 'string' && prompt.length > 0) {
      args.push(prompt);
    }

    const execOptions = {
      ...options,
      timeoutMs: options.timeoutMs === undefined ? 60000 : options.timeoutMs,
      ...(canonicalGitlessWorkspace ? { cwd: canonicalGitlessWorkspace } : {})
    };

    const res = this.safeExecSync(this.cliPath, args, execOptions);
    const processStartFailureCodes = new Set(['ENOENT', 'EACCES', 'ENOTDIR']);
    const providerSubprocessInvoked = !(res.error && processStartFailureCodes.has(res.error.code));

    let actualModel = null;
    let actualReasoningEffort = null;
    let tokensUsed = null;

    const combinedOutput = `${res.stdout || ''}\n${res.stderr || ''}`;
    const modelMatch = combinedOutput.match(/^model:\s*([^\n\r]+)/im);
    if (modelMatch && modelMatch[1]) {
      actualModel = modelMatch[1].trim();
    }

    const effortMatch = combinedOutput.match(/^reasoning effort:\s*([^\n\r]+)/im);
    if (effortMatch && effortMatch[1]) {
      actualReasoningEffort = effortMatch[1].trim();
    }

    const tokenMatch = combinedOutput.match(/tokens used\s*\r?\n\s*([0-9,]+)/im);
    if (tokenMatch && tokenMatch[1]) {
      tokensUsed = parseInt(tokenMatch[1].replace(/,/g, ''), 10);
    }

    // Separate clean model response from CLI metadata conforming to common provider contract (textResult)
    let textResult = '';
    let outputLastMessagePresent = false;
    let captureReadError = false;
    let captureSource = 'stdout_fallback';
    if (outputLastMessageFile && fs.existsSync(outputLastMessageFile)) {
      outputLastMessagePresent = true;
      captureSource = 'output_last_message';
      try {
        textResult = fs.readFileSync(outputLastMessageFile, 'utf8');
      } catch {
        captureReadError = true;
        captureSource = 'output_last_message_read_error';
      }
      if (autoCreatedMsgFile) {
        try { fs.unlinkSync(outputLastMessageFile); } catch {}
      }
    } else {
      textResult = stripCodexCliMetadata(res.stdout);
    }

    const structuredArtifactResult = structuredCoderExecution
      ? validateStructuredArtifactText(textResult, structuredArtifactFiles)
      : null;
    if (structuredTempDir) {
      try { fs.rmSync(structuredTempDir, { recursive: true, force: true }); } catch {}
    }
    if (semanticTempDir) {
      try { fs.rmSync(semanticTempDir, { recursive: true, force: true }); } catch {}
    }

    return {
      ok: res.ok,
      stdout: res.stdout,
      stderr: res.stderr,
      code: res.code,
      timedOut: Boolean(res.timedOut),
      requestedModel: (resolvedConfig && resolvedConfig.model) ? resolvedConfig.model : null,
      requestedReasoningEffort: (resolvedConfig && resolvedConfig.reasoningEffort) ? resolvedConfig.reasoningEffort : null,
      actualModel,
      actualReasoningEffort,
      tokensUsed,
      textResult,
      modelResponse: textResult,
      ...(semanticCriticReadOnly ? {
        providerSubprocessInvoked,
        semanticReviewError: res.timedOut
          ? 'provider_timeout'
          : (!res.ok
            ? (providerSubprocessInvoked ? 'provider_exit_nonzero' : 'unknown_adapter_failure')
            : (captureReadError ? 'capture_read_failed'
              : (!textResult.trim() ? 'capture_empty'
                : (textResult.length > 24000 ? 'response_too_large' : null))))
      } : {}),
      ...(structuredCoderExecution ? { structuredArtifactResult } : {}),
      deliveryCaptureDiagnostics: {
        processCompleted: !res.timedOut && Number.isInteger(res.code),
        exitCode: Number.isInteger(res.code) ? res.code : null,
        timedOut: Boolean(res.timedOut),
        outputLastMessagePresent,
        captureSource,
        captureReadError,
        capturedTextLength: textResult.length,
        capturedTextEmpty: textResult.length === 0
      }
    };
  }

  /**
   * Asserts whether targetCwd is a Core-verified isolated sandbox.
   * Strictly forbids repository root, user home, system root, or arbitrary directories.
   *
   * @param {string} targetCwd Target working directory
   * @param {boolean} [explicitSandboxFlag] Explicit caller flag
   * @returns {boolean}
   * @private
   */
  _isDedicatedSandbox(targetCwd, explicitSandboxFlag) {
    if (!targetCwd || typeof targetCwd !== 'string') return false;
    const resolved = path.resolve(targetCwd);
    const forbidden = [
      path.resolve('/'),
      path.resolve(process.env.HOME || '/tmp'),
      path.resolve(process.cwd())
    ];

    if (forbidden.includes(resolved)) {
      return false; // Absolute hard stop for forbidden workspace/root paths
    }

    if (typeof isBenchmarkSandboxFn === 'function') {
      return isBenchmarkSandboxFn(resolved);
    }

    if (explicitSandboxFlag === true) {
      const coreSandbox = path.resolve(process.cwd(), '.core-sandbox');
      const tmpDir = path.resolve(process.env.BENCHMARK_SANDBOX_ROOT || path.join(os.tmpdir(), '.agent-core-sandboxes'));
      const relCore = path.relative(coreSandbox, resolved);
      const isUnderCore = Boolean(relCore && !relCore.startsWith('..') && !path.isAbsolute(relCore));
      const relTmp = path.relative(tmpDir, resolved);
      const isUnderTmp = Boolean(relTmp && !relTmp.startsWith('..') && !path.isAbsolute(relTmp));
      return (isUnderCore || isUnderTmp) && !forbidden.includes(resolved);
    }

    return false;
  }

  /**
   * Asynchronous parity for executeSync.
   * @param {object} resolvedConfig
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async execute(resolvedConfig, prompt, options = {}) {
    return this.executeSync(resolvedConfig, prompt, options);
  }

  /**
   * Updates an existing interactive Codex thread's model and reasoning effort settings
   * via the local App Server daemon protocol.
   *
   * @param {object} params
   * @param {string} params.threadId Target thread UUID
   * @param {string} [params.model] Target model
   * @param {string} [params.effort] Target reasoning effort
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async updateInteractiveSession(params, options = {}) {
    return updateCodexThreadSettings(params, options);
  }

  /**
   * Enforces the allocated model onto an active interactive Codex thread.
   *
   * @param {object} planAllocationResult
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async enforceInteractiveHandoff(planAllocationResult, options = {}) {
    const { enforceInteractiveModelHandoff } = require('../execution_handoff');
    return enforceInteractiveModelHandoff(planAllocationResult, {
      ...options,
      provider: this.providerId
    });
  }
}

const VALID_CODEX_REASONING_EFFORTS = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
]);

module.exports = {
  CodexAdapter,
  stripCodexCliMetadata,
  VALID_CODEX_REASONING_EFFORTS,
  updateCodexThreadSettings,
  CodexInteractiveHandoff,
  HANDOFF_STATUS,
  resolveCodexThreadId,
  isValidCodexThreadId,
  enforceInteractiveModelHandoff: (...args) => require('../execution_handoff').enforceInteractiveModelHandoff(...args)
};
