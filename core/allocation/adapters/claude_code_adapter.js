/**
 * 🌐 Universal Agent Core Hub - Claude Code Adapter
 * Phase 3 Implementation: CLI Discovery & Telemetry for Claude Code
 */

'use strict';

const path = require('path');
const { ProviderAdapter } = require('../provider_adapter');
const { validateProviderCatalog, validateProviderUsage } = require('../contracts');

let isBenchmarkSandboxFn = null;
try {
  const sb = require('../../benchmark/sandbox');
  isBenchmarkSandboxFn = sb.isBenchmarkSandbox;
} catch {}

class ClaudeCodeAdapter extends ProviderAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.cliPath] Path to claude binary (default: 'claude')
   * @param {number} [options.timeoutMs] CLI execution timeout
   * @param {Function} [options.execRunner] Mock runner for testing
   * @param {string} [options.outputFormat] Output format (e.g. 'json')
   * @param {string} [options.permissionMode] Permission mode for sandboxed execution
   */
  constructor(options = {}) {
    super({
      providerId: 'claude_code',
      timeoutMs: options.timeoutMs,
      execRunner: options.execRunner
    });
    this.cliPath = options.cliPath || 'claude';
    this.outputFormat = options.outputFormat || null;
    this.permissionMode = options.permissionMode || null;
  }

  /**
   * Checks if Claude Code CLI is available.
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
   * Discovers current model and discoverable aliases from Claude Code.
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
    const res = this.safeExecSync(this.cliPath, ['-p', '/model'], options);

    if (!res.ok || !res.stdout || typeof res.stdout !== 'string') {
      return {
        providerId: this.providerId,
        current: null,
        models: []
      };
    }

    const { current, models } = this._parseModelOutput(res.stdout);

    const catalog = {
      providerId: this.providerId,
      current,
      models
    };

    // Sanity check against contract
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
   * Parses the text output of `claude -p "/model"`.
   * @param {string} text
   * @returns {{ current: string | null, models: Array<object> }}
   * @private
   */
  _parseModelOutput(text) {
    let current = null;
    const models = [];
    const seenIds = new Set();

    const lines = text.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Parse Current model: `Sonnet 5 (default)` or Current model: Sonnet 5
      const currentMatch = line.match(/^Current model:\s*`?([^`\n\r]+)`?/i);
      if (currentMatch && currentMatch[1]) {
        current = currentMatch[1].trim();
      }

      // Parse Available: sonnet, opus, haiku, ...
      const availableMatch = line.match(/Available:\s*(.+)$/i);
      if (availableMatch && availableMatch[1]) {
        let listStr = availableMatch[1].trim();

        // Strip trailing explanations like: ", or a full model ID."
        listStr = listStr.replace(/,?\s*or\s+a\s+full\s+model\s+ID\.?/i, '');
        listStr = listStr.replace(/\.$/, '');

        const parts = listStr.split(',');
        for (const rawPart of parts) {
          let part = rawPart.trim();
          if (part.toLowerCase().startsWith('or ')) {
            part = part.slice(3).trim();
          }

          if (part && !seenIds.has(part)) {
            seenIds.add(part);
            models.push({
              id: part,
              displayName: part,
              discoverable: true,
              access: 'unknown', // Entitlement cannot be inferred from discoverability
              supportedEfforts: []
            });
          }
        }
      }
    }

    // If current model was found and is not yet in models array, add it
    if (current && !seenIds.has(current)) {
      seenIds.add(current);
      models.push({
        id: current,
        displayName: current,
        discoverable: true,
        access: 'unknown',
        supportedEfforts: []
      });
    }

    return { current, models };
  }

  /**
   * Retrieves usage telemetry and rate limit windows from `claude -p "/usage"`.
   * @param {object} [options]
   * @returns {Promise<object>} Normalized ProviderUsage
   */
  async getUsage(options = {}) {
    return this.getUsageSync(options);
  }

  /**
   * Synchronous usage retrieval.
   * @param {object} [options]
   * @returns {object} Normalized ProviderUsage
   */
  getUsageSync(options = {}) {
    const res = this.safeExecSync(this.cliPath, ['-p', '/usage'], options);

    if (!res.ok || !res.stdout || typeof res.stdout !== 'string') {
      return {
        ordinaryUsageAllowed: null,
        windows: [],
        credits: null
      };
    }

    const usage = this._parseUsageOutput(res.stdout);

    const check = validateProviderUsage(usage);
    if (!check.valid) {
      return {
        ordinaryUsageAllowed: null,
        windows: [],
        credits: null
      };
    }

    return usage;
  }

  /**
   * Parses the text output of `claude -p "/usage"`.
   * @param {string} text
   * @returns {object} Normalized ProviderUsage
   * @private
   */
  _parseUsageOutput(text) {
    const windows = [];
    const lines = text.split(/\r?\n/);

    // Matches patterns like:
    // "Current session: 2% used · resets Oct 4 at 7:30am (Asia/Tehran)"
    // "Current week (all models): 17% used · resets Oct 7 at 8:30pm (Asia/Tehran)"
    const windowRegex = /^([^:\n\r]+):\s*([0-9]{1,3})%\s*(used|remaining)(?:\s*·\s*resets\s*([^\n\r]+))?/i;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = line.match(windowRegex);
      if (match) {
        const name = match[1].trim();
        const percentVal = parseInt(match[2], 10);
        const type = match[3].toLowerCase();
        const resetAt = match[4] ? match[4].trim() : null;

        if (Number.isFinite(percentVal)) {
          let usedPercent = null;
          let remainingPercent = null;

          if (type === 'used') {
            usedPercent = Math.min(100, Math.max(0, percentVal));
            remainingPercent = 100 - usedPercent;
          } else {
            remainingPercent = Math.min(100, Math.max(0, percentVal));
            usedPercent = 100 - remainingPercent;
          }

          windows.push({
            name,
            usedPercent,
            remainingPercent,
            resetAt
          });
        }
      }
    }

    let ordinaryUsageAllowed = null;
    if (windows.length > 0) {
      // Allowed if no window is exhausted (usedPercent < 100 or remainingPercent > 0)
      ordinaryUsageAllowed = windows.every(w => {
        if (w.remainingPercent !== null) return w.remainingPercent > 0;
        if (w.usedPercent !== null) return w.usedPercent < 100;
        return true;
      });
    }

    return {
      ordinaryUsageAllowed,
      windows,
      credits: null // Claude Code CLI does not report credit balances
    };
  }

  /**
   * Executes a command or prompt using Claude Code CLI with the allocated model configuration.
   * Keeps provider-specific CLI flags (--model, -p) strictly inside the adapter boundary.
   *
   * @param {object} resolvedConfig ResolvedExecutionConfig from ModelAllocator
   * @param {string} prompt Prompt or command to execute (e.g. "/model" or task instructions)
   * @param {object} [options] Execution options
   * @returns {object} { ok: boolean, stdout: string, stderr: string, code: number | null, requestedModel: string | null, actualModel: string | null }
   */
  executeSync(resolvedConfig, prompt, options = {}) {
    if (resolvedConfig && (resolvedConfig.status === 'unavailable' || resolvedConfig.status === 'insufficient_capability')) {
      return {
        ok: false,
        stdout: '',
        stderr: `Cannot execute allocation with status '${resolvedConfig.status}'`,
        code: 1,
        requestedModel: (resolvedConfig && resolvedConfig.model) ? resolvedConfig.model : null,
        actualModel: null
      };
    }

    const outputFormat = options.outputFormat || this.outputFormat;
    const args = [];
    if (outputFormat === 'json') {
      args.push('--output-format', 'json');
    }

    // Permission mode protection:
    // Apply '--permission-mode acceptEdits' ONLY when executing inside dedicated benchmark sandboxes.
    // Strictly prohibited from running on user workspace, home directory, or arbitrary production paths.
    // Note: Never use '--dangerously-skip-permissions'.
    const targetCwd = options.cwd || process.cwd();
    const isSandboxExecution = this._isDedicatedSandbox(targetCwd, options.isSandbox);
    const allowAcceptEdits = options.permissionMode === 'acceptEdits' || this.permissionMode === 'acceptEdits' || isSandboxExecution;

    if (allowAcceptEdits && isSandboxExecution) {
      args.push('--permission-mode', 'acceptEdits');
    }

    if (resolvedConfig && typeof resolvedConfig.model === 'string' && resolvedConfig.model.trim()) {
      args.push('--model', resolvedConfig.model.trim());
    }

    if (typeof prompt === 'string' && prompt.length > 0) {
      args.push('-p', prompt);
    }

    const res = this.safeExecSync(this.cliPath, args, options);

    let actualModel = null;
    if (res.stdout) {
      const match = res.stdout.match(/^Current model:\s*`?([^`\n\r]+)`?/im);
      if (match && match[1]) {
        actualModel = match[1].trim();
      }
    }

    let textResult = res.stdout || '';
    let inputTokens = null;
    let outputTokens = null;
    let totalTokens = null;
    let costUsd = null;
    let parsedJson = null;

    if (res.stdout && typeof res.stdout === 'string') {
      try {
        parsedJson = JSON.parse(res.stdout);
      } catch {}

      if (parsedJson && typeof parsedJson === 'object') {
        if (typeof parsedJson.result === 'string') {
          textResult = parsedJson.result;
        }
        if (parsedJson.usage && typeof parsedJson.usage === 'object') {
          if (typeof parsedJson.usage.input_tokens === 'number') {
            inputTokens = parsedJson.usage.input_tokens;
          }
          if (typeof parsedJson.usage.output_tokens === 'number') {
            outputTokens = parsedJson.usage.output_tokens;
          }
          if (inputTokens !== null && outputTokens !== null) {
            totalTokens = inputTokens + outputTokens;
          }
        }
        if (typeof parsedJson.total_cost_usd === 'number') {
          costUsd = parsedJson.total_cost_usd;
        }
      }
    }

    return {
      ok: res.ok,
      stdout: res.stdout,
      stderr: res.stderr,
      code: res.code,
      timedOut: Boolean(res.timedOut),
      requestedModel: (resolvedConfig && resolvedConfig.model) ? resolvedConfig.model : null,
      actualModel,
      textResult,
      inputTokens,
      outputTokens,
      tokensUsed: totalTokens,
      totalTokens,
      costUsd,
      raw: parsedJson
    };
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
   * Strictly verifies whether target directory is a dedicated benchmark sandbox.
   * Asserts that target is never the workspace root, home, or system root.
   *
   * @param {string} targetCwd
   * @param {boolean} [explicitSandboxFlag]
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
      const tmpDir = path.resolve(process.env.BENCHMARK_SANDBOX_ROOT || path.join(require('os').tmpdir(), '.agent-core-sandboxes'));
      const relCore = path.relative(coreSandbox, resolved);
      const isUnderCore = Boolean(relCore && !relCore.startsWith('..') && !path.isAbsolute(relCore));
      const relTmp = path.relative(tmpDir, resolved);
      const isUnderTmp = Boolean(relTmp && !relTmp.startsWith('..') && !path.isAbsolute(relTmp));
      return (isUnderCore || isUnderTmp) && !forbidden.includes(resolved);
    }

    return false;
  }
}

module.exports = {
  ClaudeCodeAdapter
};
