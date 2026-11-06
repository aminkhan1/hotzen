/**
 * 🌐 Universal Agent Core Hub - LocalBrain V1 (Qwen3.5-0.8B via llama-cli)
 * Phase 5 Implementation: Isolated local planning analyzer with deterministic fallback.
 *
 * Responsibilities:
 * completed execution plan ➔ LocalBrain ➔ PlanRequirementsResult
 *
 * Boundary Invariants:
 * - Isolated child-process boundary via `llama-cli`.
 * - Read-only access to `./llm/Qwen3.5-0.8B-Q4_0.gguf`.
 * - Does NOT read repo files, inspect git, discover providers, or allocate models.
 * - On process failure, timeout, invalid JSON, schema failure, or low confidence (< 0.70):
 *   gracefully falls back to DeterministicFallbackBrain.
 */

'use strict';

const path = require('path');
const { execFile } = require('child_process');
const {
  CoreBrain,
  validatePlanRequirementsResult,
  validateAgentRequirement
} = require('./contracts');
const {
  deterministicFallbackBrain,
  DeterministicFallbackBrain
} = require('./deterministic_fallback_brain');
const {
  reconcileWithSafetyFloor
} = require('./safety_floor');

const DEFAULT_MODEL_PATH = path.resolve(__dirname, '../../llm/Qwen3.5-0.8B-Q4_0.gguf');
const DEFAULT_CLI_PATH = 'llama-cli';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.70;
const DEFAULT_MAX_TOKENS = 350;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_ROLES = Object.freeze(['coder', 'tester', 'critic']);

/**
 * Builds the compact structured prompt for Qwen3.5-0.8B (< 500 tokens).
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.plan
 * @param {string[]} params.assignedRoles
 * @returns {string}
 */
function buildPrompt({ taskId, plan, assignedRoles }) {
  const rolesList = assignedRoles.join(', ');
  return `You are CoreBrain, a task planning analyzer for multi-agent execution.
Analyze the execution plan and determine requirements for each assigned agent role.

Allowed Levels:
- capability: "lightweight" | "balanced" | "strong"
- reasoning: "none" | "low" | "medium" | "high"
- risk: "low" | "medium" | "high"

Guidelines:
- Evaluate the overall plan risk tier and calibrate each role accordingly:
  * Low Risk (docs, typos, trivial styling) -> capability: "lightweight", reasoning: "none", risk: "low"
  * Medium Risk (UI, forms, CRUD, features) -> capability: "balanced", reasoning: "medium", risk: "medium"
  * High Risk (security, auth, payment, core architecture) -> capability: "strong", reasoning: "high", risk: "high"

CRITICAL OUTPUT RULES:
1. Return ONLY a single raw JSON object matching the schema below.
2. Do NOT output markdown code blocks, backticks, or explanatory text.
3. "rationale" must be in English and at most 5 words.
4. Output an entry in "requirements" for EVERY role in assigned roles: [${rolesList}].

JSON Schema:
{"taskId":"${taskId}","source":"local_brain","confidence":0.95,"requirements":{"<role>":{"capability":"<lightweight|balanced|strong>","reasoning":"<none|low|medium|high>","risk":"<low|medium|high>","confidence":0.9,"rationale":"<1-5 words>"}}}

Task ID: ${taskId}
Assigned roles: [${rolesList}]
Plan:
${plan}`;
}

/**
 * Extracts a JSON object from model output text.
 * @param {string} text
 * @returns {object|null}
 */
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Check markdown fenced code blocks ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  // 2. Transport-level extraction of JSON object from generation output
  const openIndices = [];
  const closeIndices = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') openIndices.push(i);
    else if (text[i] === '}') closeIndices.push(i);
  }

  for (let o = 0; o < openIndices.length; o++) {
    const start = openIndices[o];
    for (let c = closeIndices.length - 1; c >= 0; c--) {
      const end = closeIndices[c];
      if (end > start) {
        const candidate = text.slice(start, end + 1);
        if (candidate.includes('requirements') || candidate.includes('taskId')) {
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.requirements || parsed.taskId)) {
              return parsed;
            }
          } catch (_) {}
        }
      }
    }
  }

  return null;
}

/**
 * Normalizes raw model output to conform strictly to PlanRequirementsResult.
 * @param {object} parsed
 * @param {string} taskId
 * @param {string[]} assignedRoles
 * @returns {object|null}
 */
function normalizeModelOutput(parsed, taskId, assignedRoles) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const result = {
    taskId: typeof parsed.taskId === 'string' && parsed.taskId.trim() ? parsed.taskId.trim() : taskId,
    source: 'local_brain',
    confidence: typeof parsed.confidence === 'number' && !Number.isNaN(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.85,
    requirements: {}
  };

  const rawReqs = parsed.requirements;
  if (!rawReqs || typeof rawReqs !== 'object' || Array.isArray(rawReqs)) {
    return null;
  }

  for (const role of assignedRoles) {
    let req = rawReqs[role];
    if (!req) {
      const matchingKey = Object.keys(rawReqs).find(k => k.toLowerCase().trim() === role.toLowerCase().trim());
      if (matchingKey) {
        req = rawReqs[matchingKey];
      }
    }

    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      return null;
    }

    const cap = typeof req.capability === 'string' ? req.capability.trim() : req.capability;
    const rsn = typeof req.reasoning === 'string' ? req.reasoning.trim() : req.reasoning;
    const rsk = typeof req.risk === 'string' ? req.risk.trim() : req.risk;

    let conf = typeof req.confidence === 'number' && !Number.isNaN(req.confidence)
      ? Math.max(0, Math.min(1, req.confidence))
      : result.confidence;

    let rat = typeof req.rationale === 'string' && req.rationale.trim()
      ? req.rationale.trim()
      : 'LocalBrain requirement inference';

    result.requirements[role] = {
      capability: cap,
      reasoning: rsn,
      risk: rsk,
      confidence: conf,
      rationale: rat
    };
  }

  return result;
}

/**
 * LocalBrain V1: Qwen3.5-0.8B isolated child-process inference engine.
 */
class LocalBrain extends CoreBrain {
  /**
   * @param {object} [options]
   * @param {string} [options.modelPath]
   * @param {string} [options.cliPath]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.confidenceThreshold]
   * @param {number} [options.maxTokens]
   * @param {number} [options.temperature]
   * @param {DeterministicFallbackBrain} [options.fallbackBrain]
   */
  constructor(options = {}) {
    super();
    this.modelPath = options.modelPath || DEFAULT_MODEL_PATH;
    this.cliPath = options.cliPath || DEFAULT_CLI_PATH;
    this.timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.confidenceThreshold = typeof options.confidenceThreshold === 'number'
      ? options.confidenceThreshold
      : DEFAULT_CONFIDENCE_THRESHOLD;
    this.maxTokens = typeof options.maxTokens === 'number' ? options.maxTokens : DEFAULT_MAX_TOKENS;
    this.temperature = typeof options.temperature === 'number' ? options.temperature : DEFAULT_TEMPERATURE;
    this.fallbackBrain = options.fallbackBrain || deterministicFallbackBrain;
  }

  /**
   * Executes llama-cli as an isolated child process.
   * @param {string} prompt
   * @returns {Promise<{ stdout: string, stderr: string, durationMs: number }>}
   */
  _runCli(prompt) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.modelPath,
        '-p', prompt,
        '-n', String(this.maxTokens),
        '--temp', String(this.temperature),
        '--no-display-prompt',
        '-st',
        '--simple-io',
        '--offline',
        '-ngl', '99',
        '-rea', 'off'
      ];

      const startTime = Date.now();
      execFile(
        this.cliPath,
        args,
        {
          timeout: this.timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, LLAMA_ARG_OFFLINE: '1' }
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          if (error) {
            return reject(Object.assign(error, { stdout, stderr, durationMs }));
          }
          resolve({ stdout, stderr, durationMs });
        }
      );
    });
  }

  /**
   * Analyzes an execution plan and returns abstract agent requirements.
   * If any failure occurs (process failure, timeout, unparseable output,
   * schema mismatch, or low confidence), falls back gracefully.
   *
   * @param {object} input
   * @param {string} [input.taskId]
   * @param {string} [input.plan]
   * @param {string[]} [input.assignedRoles]
   * @param {object} [input.planMetadata]
   * @returns {Promise<object>} PlanRequirementsResult
   */
  async analyzePlan(input) {
    const safeInput = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const taskId = (typeof safeInput.taskId === 'string' && safeInput.taskId.trim())
      ? safeInput.taskId.trim()
      : 'task-plan';

    const plan = typeof safeInput.plan === 'string'
      ? safeInput.plan.trim()
      : '';

    let roles = [];
    if (Array.isArray(safeInput.assignedRoles) && safeInput.assignedRoles.length > 0) {
      roles = safeInput.assignedRoles;
    } else if (safeInput.planMetadata && Array.isArray(safeInput.planMetadata.assignedRoles)) {
      roles = safeInput.planMetadata.assignedRoles;
    } else {
      roles = DEFAULT_ROLES.slice();
    }

    const assignedRoles = Array.from(new Set(
      roles.filter(r => typeof r === 'string' && r.trim().length > 0).map(r => r.trim())
    ));
    const finalRoles = assignedRoles.length > 0 ? assignedRoles : DEFAULT_ROLES.slice();

    // If plan is completely empty, fallback immediately
    if (!plan) {
      const fallbackResult = this.fallbackBrain.analyzePlanSync(input);
      fallbackResult.fallbackReason = 'empty_plan';
      return reconcileWithSafetyFloor(fallbackResult, input, { fallbackBrain: this.fallbackBrain });
    }

    try {
      const prompt = buildPrompt({ taskId, plan, assignedRoles: finalRoles });
      const { stdout, durationMs } = await this._runCli(prompt);

      const parsed = extractJson(stdout);
      if (!parsed) {
        const fallbackResult = this.fallbackBrain.analyzePlanSync(input);
        fallbackResult.fallbackReason = 'json_parse_failure';
        return reconcileWithSafetyFloor(fallbackResult, input, { fallbackBrain: this.fallbackBrain });
      }

      const normalized = normalizeModelOutput(parsed, taskId, finalRoles);
      if (!normalized) {
        const fallbackResult = this.fallbackBrain.analyzePlanSync(input);
        fallbackResult.fallbackReason = 'schema_normalization_failure';
        return reconcileWithSafetyFloor(fallbackResult, input, { fallbackBrain: this.fallbackBrain });
      }

      const validation = validatePlanRequirementsResult(normalized);
      if (!validation.valid) {
        const fallbackResult = this.fallbackBrain.analyzePlanSync(input);
        fallbackResult.fallbackReason = `validation_error: ${validation.error}`;
        return reconcileWithSafetyFloor(fallbackResult, input, { fallbackBrain: this.fallbackBrain });
      }

      // Check confidence threshold
      if (typeof normalized.confidence === 'number' && normalized.confidence < this.confidenceThreshold) {
        const fallbackResult = this.fallbackBrain.analyzePlanSync(input);
        fallbackResult.fallbackReason = `confidence_below_threshold: ${normalized.confidence} < ${this.confidenceThreshold}`;
        return reconcileWithSafetyFloor(fallbackResult, input, { fallbackBrain: this.fallbackBrain });
      }

      // Successful LocalBrain inference: reconcile with deterministic safety floor
      normalized.durationMs = durationMs;
      return reconcileWithSafetyFloor(normalized, input, { fallbackBrain: this.fallbackBrain });
    } catch (err) {
      const fallbackResult = this.fallbackBrain.analyzePlanSync(input);
      fallbackResult.fallbackReason = `execution_error: ${err.message || String(err)}`;
      return reconcileWithSafetyFloor(fallbackResult, input, { fallbackBrain: this.fallbackBrain });
    }
  }
}

const localBrainInstance = new LocalBrain();

module.exports = {
  LocalBrain,
  localBrain: localBrainInstance,
  buildPrompt,
  extractJson,
  normalizeModelOutput,
  reconcileWithSafetyFloor,
  DEFAULT_MODEL_PATH,
  DEFAULT_CONFIDENCE_THRESHOLD
};
