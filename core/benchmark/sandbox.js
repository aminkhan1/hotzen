/**
 * 🌐 Universal Agent Core Hub - Benchmark Sandbox Lifecycle Manager
 * Phase 6 Implementation: Disposable Sandbox Isolation & Cleanup Verification
 */

'use strict';

const fs = require('fs');
const path = require('path');

const os = require('os');

const DEFAULT_SANDBOX_ROOT = process.env.BENCHMARK_SANDBOX_ROOT
  || path.join(os.tmpdir(), '.agent-core-sandboxes');

/**
 * Safely asserts that childPath is strictly located inside parentPath.
 * Prevents prefix collision / zip-slip attacks (e.g. /sandbox_evil matching /sandbox).
 * @param {string} parentPath
 * @param {string} childPath
 * @returns {boolean}
 */
function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false;
  const rel = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Validates that sandbox root is not system root, home directory,
 * workspace repository root, or containing .git.
 * @param {string} rootPath
 * @returns {string} resolved path
 */
function validateSandboxRoot(rootPath) {
  if (!rootPath || typeof rootPath !== 'string') {
    throw new Error('Fatal safety error: Sandbox root must be a non-empty string');
  }
  const resolved = path.resolve(rootPath);
  const home = path.resolve(process.env.HOME || '/tmp');
  const systemRoot = path.resolve('/');
  const cwd = path.resolve(process.cwd());

  if (resolved === systemRoot || resolved === home || resolved === cwd) {
    throw new Error(`Fatal safety error: Sandbox root cannot be system root, HOME, or repo root: ${resolved}`);
  }

  const parts = resolved.split(path.sep);
  if (parts.includes('.git') || resolved.endsWith('.git')) {
    throw new Error(`Fatal safety error: Sandbox root cannot be inside or contain .git: ${resolved}`);
  }

  return resolved;
}

class BenchmarkSandbox {
  /**
   * @param {object} options
   * @param {string} [options.rootPath]
   * @param {string} options.runId Unique benchmark run identifier
   * @param {string} options.taskId Benchmark task identifier
   * @param {string} options.mode Benchmark mode (RAW_STRONG, CORE_FIXED_STRONG, CORE_ADAPTIVE)
   */
  constructor(options = {}) {
    if (!options.runId || typeof options.runId !== 'string') {
      throw new TypeError('options.runId must be a non-empty string');
    }
    if (!options.taskId || typeof options.taskId !== 'string') {
      throw new TypeError('options.taskId must be a non-empty string');
    }
    if (!options.mode || typeof options.mode !== 'string') {
      throw new TypeError('options.mode must be a non-empty string');
    }

    const candidateRoot = options.rootPath || DEFAULT_SANDBOX_ROOT;
    this.rootPath = validateSandboxRoot(candidateRoot);
    this.runId = options.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.taskId = options.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.mode = options.mode.replace(/[^a-zA-Z0-9_-]/g, '_');

    this.sandboxDir = path.join(this.rootPath, this.runId, this.taskId, this.mode);
    this._isCreated = false;
  }

  /**
   * Asserts that sandbox directory is safe, strictly confined to .core-sandbox,
   * and never points to workspace root, home, or system directories.
   */
  verifyIsolation() {
    const resolvedPath = path.resolve(this.sandboxDir);
    const resolvedRoot = path.resolve(this.rootPath);

    if (!isPathInside(resolvedRoot, resolvedPath)) {
      throw new Error(`Isolation violation: Sandbox path '${resolvedPath}' is outside sandbox root '${resolvedRoot}'`);
    }

    // Must not be root, home, or project root
    const forbidden = [
      path.resolve('/'),
      path.resolve(process.env.HOME || '/tmp'),
      path.resolve(process.cwd())
    ];

    if (forbidden.includes(resolvedPath) || forbidden.includes(resolvedRoot)) {
      throw new Error(`Fatal safety error: Sandbox target matches forbidden path: ${resolvedPath} (root: ${resolvedRoot})`);
    }

    return true;
  }

  /**
   * Creates the isolated sandbox directory structure on disk.
   * @returns {string} Absolute path to created sandbox directory
   */
  create() {
    this.verifyIsolation();

    if (!fs.existsSync(this.sandboxDir)) {
      fs.mkdirSync(this.sandboxDir, { recursive: true });
    }

    // Standard sandbox scaffold
    const subdirs = ['src', 'test', 'artifacts'];
    for (const dir of subdirs) {
      const p = path.join(this.sandboxDir, dir);
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
      }
    }

    this._isCreated = true;
    return this.sandboxDir;
  }

  /**
   * Safely writes a file within the sandbox.
   * @param {string} relPath Path relative to sandbox directory
   * @param {string} content
   * @returns {string} Absolute path to written file
   */
  writeFile(relPath, content) {
    this.verifyIsolation();
    const fullPath = path.resolve(this.sandboxDir, relPath);
    if (!isPathInside(this.sandboxDir, fullPath)) {
      throw new Error(`Path traversal attempt blocked: '${relPath}'`);
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    return fullPath;
  }

  /**
   * Safely reads a file from the sandbox.
   * @param {string} relPath
   * @returns {string}
   */
  readFile(relPath) {
    this.verifyIsolation();
    const fullPath = path.resolve(this.sandboxDir, relPath);
    if (!isPathInside(this.sandboxDir, fullPath)) {
      throw new Error(`Path traversal attempt blocked: '${relPath}'`);
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in sandbox: '${relPath}'`);
    }

    return fs.readFileSync(fullPath, 'utf8');
  }

  /**
   * Checks whether a file exists in the sandbox.
   * @param {string} relPath
   * @returns {boolean}
   */
  fileExists(relPath) {
    this.verifyIsolation();
    const fullPath = path.resolve(this.sandboxDir, relPath);
    if (!isPathInside(this.sandboxDir, fullPath)) {
      return false;
    }
    return fs.existsSync(fullPath);
  }

  /**
   * Recursively deletes this sandbox directory.
   */
  cleanup() {
    this.verifyIsolation();

    if (fs.existsSync(this.sandboxDir)) {
      fs.rmSync(this.sandboxDir, { recursive: true, force: true });
    }

    // Also attempt pruning empty parent run/task directories if empty
    try {
      const taskDir = path.dirname(this.sandboxDir);
      if (isPathInside(this.rootPath, taskDir) && fs.existsSync(taskDir) && fs.readdirSync(taskDir).length === 0) {
        fs.rmdirSync(taskDir);
      }
      const runDir = path.dirname(taskDir);
      if (isPathInside(this.rootPath, runDir) && fs.existsSync(runDir) && fs.readdirSync(runDir).length === 0) {
        fs.rmdirSync(runDir);
      }
    } catch {
      // Non-critical cleanup
    }

    this._isCreated = false;
  }

  /**
   * Verifies that the sandbox directory no longer exists on disk.
   * @returns {boolean} True if confirmed non-existent
   */
  verifyCleanup() {
    const exists = fs.existsSync(this.sandboxDir);
    if (exists) {
      throw new Error(`Sandbox cleanup verification failed: '${this.sandboxDir}' still exists on disk!`);
    }
    return true;
  }

  /**
   * Static utility to clean up an entire benchmark root.
   * @param {string} [rootPath]
   */
  static cleanAll(rootPath = DEFAULT_SANDBOX_ROOT) {
    const resolved = path.resolve(rootPath);
    if (resolved === path.resolve(process.cwd()) || resolved === path.resolve('/')) {
      throw new Error('Unsafe sandbox root deletion blocked');
    }
    if (fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    return !fs.existsSync(resolved);
  }
}

/**
 * Verifies whether a given directory is an isolated benchmark sandbox.
 * Strictly asserts that the path is inside .core-sandbox (or dedicated benchmark sandbox root)
 * and is NEVER the repository root, user home, system root, or the sandbox root itself.
 *
 * @param {string} dirPath
 * @param {string} [rootPath=DEFAULT_SANDBOX_ROOT]
 * @returns {boolean}
 */
function isBenchmarkSandbox(dirPath, rootPath = (process.env.BENCHMARK_SANDBOX_ROOT || DEFAULT_SANDBOX_ROOT)) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  const resolved = path.resolve(dirPath);
  const activeRoot = rootPath || process.env.BENCHMARK_SANDBOX_ROOT || DEFAULT_SANDBOX_ROOT;
  const resolvedRoot = path.resolve(activeRoot);
  const defaultTmpRoot = path.resolve(path.join(require('os').tmpdir(), '.agent-core-sandboxes'));
  const legacyRoot = path.resolve(path.join(process.cwd(), '.core-sandbox'));

  const isUnderSandboxRoot = isPathInside(resolvedRoot, resolved) ||
                             isPathInside(defaultTmpRoot, resolved) ||
                             isPathInside(legacyRoot, resolved);

  if (!isUnderSandboxRoot) return false;

  const forbidden = [
    path.resolve('/'),
    path.resolve(process.env.HOME || '/tmp'),
    path.resolve(process.cwd()),
    resolvedRoot,
    defaultTmpRoot,
    legacyRoot,
    path.resolve(require('os').tmpdir())
  ];

  return !forbidden.includes(resolved);
}

module.exports = {
  BenchmarkSandbox,
  DEFAULT_SANDBOX_ROOT,
  isBenchmarkSandbox,
  isPathInside,
  validateSandboxRoot
};
