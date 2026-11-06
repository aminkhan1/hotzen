/**
 * 🌐 Universal Agent Core Hub - Provider Adapter Boundary
 * Phase 3 Implementation: Generic Provider Interface & Safe Execution Layer
 */

'use strict';

const childProcess = require('child_process');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BUFFER = 1024 * 1024; // 1 MB

/**
 * Base abstract class defining the provider boundary.
 * Phase 3 boundary is strictly for discovery and telemetry/usage;
 * no agent execution or model allocation occurs at this layer.
 */
class ProviderAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.providerId] Unique identifier for the provider (e.g., 'claude_code', 'codex')
   * @param {number} [options.timeoutMs] Default execution timeout in milliseconds
   * @param {Function} [options.execRunner] Custom synchronous runner for mocking / testing
   */
  constructor(options = {}) {
    this.providerId = options.providerId || 'generic_provider';
    this.timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    this.execRunner = typeof options.execRunner === 'function'
      ? options.execRunner
      : null;
  }

  /**
   * Checks whether the provider CLI/service is installed and available in the environment.
   * @param {object} [_options]
   * @returns {Promise<boolean> | boolean}
   */
  async isAvailable(_options = {}) {
    throw new Error(`${this.constructor.name}.isAvailable() must be implemented`);
  }

  /**
   * Discovers available models and current active model from the provider.
   * Returns a normalized ProviderCatalog.
   * @param {object} [_options]
   * @returns {Promise<object> | object}
   */
  async discover(_options = {}) {
    throw new Error(`${this.constructor.name}.discover() must be implemented`);
  }

  /**
   * Retrieves usage telemetry and rate limit windows.
   * Returns a normalized multidimensional ProviderUsage.
   * @param {object} [_options]
   * @returns {Promise<object> | object}
   */
  async getUsage(_options = {}) {
    throw new Error(`${this.constructor.name}.getUsage() must be implemented`);
  }

  /**
   * Executes a command or prompt with a resolved execution configuration.
   * Concrete adapters map ResolvedExecutionConfig into provider-native CLI flags.
   * @param {object} _resolvedConfig ResolvedExecutionConfig
   * @param {string} _prompt Prompt or command to execute
   * @param {object} [_options]
   * @returns {Promise<object> | object}
   */
  async execute(_resolvedConfig, _prompt, _options = {}) {
    throw new Error(`${this.constructor.name}.execute() must be implemented`);
  }

  executeSync(_resolvedConfig, _prompt, _options = {}) {
    throw new Error(`${this.constructor.name}.executeSync() must be implemented`);
  }

  /**
   * Executes a CLI command safely without shell interpolation,
   * with bounded buffers and configurable timeouts.
   *
   * @param {string} command Executable name or path (e.g. 'claude', 'codex')
   * @param {string[]} args Array of arguments (must not rely on shell parsing)
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {string} [options.cwd]
   * @param {object} [options.env]
   * @returns {{ ok: boolean, stdout: string, stderr: string, code: number | null, error?: Error }}
   */
  safeExecSync(command, args = [], options = {}) {
    const timeout = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : this.timeoutMs;

    const maxBuffer = typeof options.maxBuffer === 'number' && options.maxBuffer > 0
      ? options.maxBuffer
      : DEFAULT_MAX_BUFFER;

    // Support test runner injection
    if (this.execRunner) {
      try {
        const res = this.execRunner(command, args, { timeout, maxBuffer, ...options });
        return {
          ok: res.ok !== undefined ? res.ok : true,
          stdout: res.stdout || '',
          stderr: res.stderr || '',
          code: res.code !== undefined ? res.code : 0,
          timedOut: Boolean(res.timedOut),
          error: res.error || null
        };
      } catch (err) {
        return {
          ok: false,
          stdout: err.stdout ? String(err.stdout) : '',
          stderr: err.stderr ? String(err.stderr) : (err.message || ''),
          code: typeof err.status === 'number' ? err.status : 1,
          timedOut: Boolean(err && (err.code === 'ETIMEDOUT' || err.timedOut)),
          error: err
        };
      }
    }

    try {
      // Direct child_process execution with shell: false
      const res = childProcess.spawnSync(command, args, {
        timeout,
        maxBuffer,
        shell: false,
        encoding: 'utf8',
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      if (res.error) {
        throw res.error;
      }

      const code = typeof res.status === 'number' ? res.status : 0;
      const ok = code === 0;

      return {
        ok,
        stdout: typeof res.stdout === 'string' ? res.stdout : '',
        stderr: typeof res.stderr === 'string' ? res.stderr : '',
        code,
        timedOut: false,
        error: ok ? null : new Error(`Process exited with code ${code}`)
      };
    } catch (err) {
      // Safely catch missing executable (ENOENT), timeouts (ETIMEDOUT), or errors
      const stdout = err.stdout ? String(err.stdout) : '';
      const stderr = err.stderr ? String(err.stderr) : '';
      const code = typeof err.status === 'number' ? err.status : (err.code === 'ENOENT' ? 127 : 1);
      const timedOut = Boolean(err && (err.code === 'ETIMEDOUT' || err.timedOut));

      return {
        ok: false,
        stdout,
        stderr: stderr || err.message || '',
        code,
        timedOut,
        error: err
      };
    }
  }
}

module.exports = {
  ProviderAdapter,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BUFFER
};
