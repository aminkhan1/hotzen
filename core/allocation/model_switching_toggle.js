/**
 * 🌐 Universal Agent Core Hub - Runtime Model Switching Toggle
 * Minimal runtime ON/OFF control for adaptive model switching.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../.agents/memory/runtime_config.json');
const MODEL_SWITCHING_FEATURE_FROZEN = true;

let _modelSwitchingEnabled = true;
let _hasExplicitRuntimeOverride = false;
let _selectedModel = null;
let _lastUpdated = null;

/**
 * Resolves config path taking into account options, env, cwd, or repository default.
 * @param {object} [options]
 * @returns {string}
 */
function _getConfigPath(options = {}) {
  if (options && options.configPath) return options.configPath;
  if (process.env.CORE_CONFIG_PATH) return process.env.CORE_CONFIG_PATH;
  const rawTarget = options && (options.cwd || options.workspace || options.workspaceRoot || options.projectRoot);
  const targetDir = (typeof rawTarget === 'string' && rawTarget.trim())
    ? path.resolve(rawTarget.trim())
    : process.cwd();
  const cwdAgents = path.resolve(targetDir, '.agents');
  const cwdConfig = path.resolve(targetDir, '.agents/memory/runtime_config.json');
  if (fs.existsSync(cwdConfig) || fs.existsSync(cwdAgents)) return cwdConfig;
  return DEFAULT_CONFIG_PATH;
}

/**
 * Checks whether runtime config file exists and is readable.
 * @param {string} [configPath]
 * @returns {object | null}
 */
function _readConfigFile(configPath = DEFAULT_CONFIG_PATH) {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {}
  return null;
}

/**
 * Safely writes runtime config to disk.
 * @param {object} patch
 * @param {string} [configPath]
 */
function _writeConfigFile(patch, configPath = DEFAULT_CONFIG_PATH) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const current = _readConfigFile(configPath) || {};
    const merged = { ...current, ...patch };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  } catch {}
}

/**
 * Normalizes input value to a boolean.
 * @param {any} val
 * @returns {boolean}
 */
function normalizeBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    if (['true', '1', 'on', 'enabled', 'yes'].includes(trimmed)) return true;
    if (['false', '0', 'off', 'disabled', 'no'].includes(trimmed)) return false;
  }
  return Boolean(val);
}

/**
 * Checks whether adaptive model switching is currently enabled.
 *
 * Precedence:
 * 1. Explicit options override (if boolean passed in options.modelSwitchingEnabled)
 * 2. In-memory runtime override (set via setModelSwitchingEnabled)
 * 3. Environment variable (CORE_MODEL_SWITCHING)
 * 4. Runtime config file (.agents/memory/runtime_config.json)
 * 5. Default: true (ON)
 *
 * @param {object} [options]
 * @param {boolean} [options.modelSwitchingEnabled] Explicit per-call override
 * @param {string} [options.configPath] Override path to runtime config
 * @returns {boolean}
 */
function isModelSwitchingEnabled(options = {}) {
  // V1 freeze is an effective policy gate; retain persisted preferences unchanged.
  if (MODEL_SWITCHING_FEATURE_FROZEN) return false;

  if (options && typeof options.modelSwitchingEnabled === 'boolean') {
    return options.modelSwitchingEnabled;
  }

  const configPath = _getConfigPath(options);
  const cfg = _readConfigFile(configPath);

  // If disk has a newer state from CLI or external process
  if (cfg && typeof cfg.modelSwitchingEnabled === 'boolean') {
    if (_hasExplicitRuntimeOverride && _lastUpdated && cfg.updatedAt) {
      const fileTime = new Date(cfg.updatedAt).getTime();
      const memTime = new Date(_lastUpdated).getTime();
      if (fileTime > memTime) {
        return cfg.modelSwitchingEnabled;
      }
    } else if (!_hasExplicitRuntimeOverride) {
      if (process.env.CORE_MODEL_SWITCHING !== undefined) {
        const envVal = String(process.env.CORE_MODEL_SWITCHING).trim().toLowerCase();
        return !['0', 'false', 'off', 'disabled', 'no'].includes(envVal);
      }
      return cfg.modelSwitchingEnabled;
    }
  }

  if (_hasExplicitRuntimeOverride) {
    return _modelSwitchingEnabled;
  }

  if (process.env.CORE_MODEL_SWITCHING !== undefined) {
    const envVal = String(process.env.CORE_MODEL_SWITCHING).trim().toLowerCase();
    return !['0', 'false', 'off', 'disabled', 'no'].includes(envVal);
  }

  return _modelSwitchingEnabled;
}

/**
 * Sets the runtime model switching state.
 * Changeable during an active session without restart.
 *
 * @param {boolean|string|number} enabled
 * @param {object} [options]
 * @param {boolean} [options.persist=true] Whether to persist to runtime_config.json
 * @param {string} [options.configPath] Override config path
 * @param {string} [options.selectedModel] User or provider selected model
 * @returns {{ enabled: boolean, status: string, source: string, selectedModel: string|null, updatedAt: string }}
 */
function setModelSwitchingEnabled(enabled, options = {}) {
  const normalized = normalizeBoolean(enabled);
  if (MODEL_SWITCHING_FEATURE_FROZEN && normalized) {
    return {
      ...getModelSwitchingStatus(options),
      code: 'FEATURE_DISABLED',
      featureDisabled: true,
      message: 'FEATURE_DISABLED: Automatic Model Switching is frozen for V1; saved preferences were not changed.'
    };
  }
  _modelSwitchingEnabled = normalized;
  _hasExplicitRuntimeOverride = true;
  _lastUpdated = new Date();

  if (normalized) {
    _selectedModel = null;
  } else if (options && options.selectedModel !== undefined) {
    _selectedModel = options.selectedModel;
  } else {
    const configPath = _getConfigPath(options);
    const current = _readConfigFile(configPath);
    _selectedModel = (current && current.selectedModel) || null;
  }

  if (options.persist !== false) {
    const configPath = _getConfigPath(options);
    const current = _readConfigFile(configPath) || {};
    const patch = {
      modelSwitchingEnabled: normalized,
      updatedAt: _lastUpdated.toISOString()
    };
    if (normalized) {
      patch.selectedModel = null;
    } else if (options && options.selectedModel !== undefined) {
      patch.selectedModel = options.selectedModel;
    } else if (current.selectedModel !== undefined) {
      patch.selectedModel = current.selectedModel;
    } else {
      patch.selectedModel = null;
    }
    _writeConfigFile(patch, configPath);
  }

  return getModelSwitchingStatus(options);
}

/**
 * Enables model switching (ON).
 * @param {object} [options]
 * @returns {object} Status object
 */
function enableModelSwitching(options = {}) {
  return setModelSwitchingEnabled(true, options);
}

/**
 * Disables model switching (OFF).
 * @param {object} [options]
 * @returns {object} Status object
 */
function disableModelSwitching(options = {}) {
  let opts = options;
  if (typeof options === 'string') {
    const secondArg = arguments.length > 1 && typeof arguments[1] === 'object' && arguments[1] !== null ? arguments[1] : {};
    opts = { ...secondArg, selectedModel: options };
  }
  return setModelSwitchingEnabled(false, opts);
}

/**
 * Returns detailed status of the model switching toggle.
 * @param {object} [options]
 * @returns {{ enabled: boolean, status: 'ON'|'OFF', source: string, selectedModel: string|null, updatedAt: string|null }}
 */
function getModelSwitchingStatus(options = {}) {
  const enabled = isModelSwitchingEnabled(options);
  let source = MODEL_SWITCHING_FEATURE_FROZEN ? 'feature_freeze' : 'default';

  const configPath = _getConfigPath(options);
  const cfg = _readConfigFile(configPath);
  if (!MODEL_SWITCHING_FEATURE_FROZEN) {
    if (options && typeof options.modelSwitchingEnabled === 'boolean') {
      source = 'per_call_option';
    } else if (cfg && typeof cfg.modelSwitchingEnabled === 'boolean' && _lastUpdated && cfg.updatedAt && new Date(cfg.updatedAt).getTime() > new Date(_lastUpdated).getTime()) {
      source = 'config_file';
    } else if (_hasExplicitRuntimeOverride) {
      source = 'runtime_api';
    } else if (process.env.CORE_MODEL_SWITCHING !== undefined) {
      source = 'env_var';
    } else if (cfg && typeof cfg.modelSwitchingEnabled === 'boolean') {
      source = 'config_file';
    }
  }

  let selectedModel = null;
  if (!enabled) {
    selectedModel = (options && options.selectedModel)
      || _selectedModel
      || process.env.CORE_SELECTED_MODEL
      || (cfg && cfg.selectedModel)
      || null;
  }

  return {
    enabled,
    status: enabled ? 'ON' : 'OFF',
    featureDisabled: MODEL_SWITCHING_FEATURE_FROZEN,
    configuredEnabled: cfg && typeof cfg.modelSwitchingEnabled === 'boolean' ? cfg.modelSwitchingEnabled : null,
    source,
    selectedModel,
    updatedAt: _lastUpdated ? _lastUpdated.toISOString() : (cfg && cfg.updatedAt ? cfg.updatedAt : null)
  };
}

/**
 * Resets the runtime model switching toggle to default state (ON).
 * @param {object} [options]
 * @param {boolean} [options.cleanDisk=false] Whether to also remove disk config
 * @param {string} [options.configPath]
 */
function resetModelSwitching(options = {}) {
  _modelSwitchingEnabled = true;
  _hasExplicitRuntimeOverride = false;
  _selectedModel = null;
  _lastUpdated = null;

  if (options.cleanDisk) {
    const configPath = _getConfigPath(options);
    try {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } catch {}
  }
}

module.exports = {
  isModelSwitchingEnabled,
  setModelSwitchingEnabled,
  enableModelSwitching,
  disableModelSwitching,
  getModelSwitchingStatus,
  resetModelSwitching,
  MODEL_SWITCHING_FEATURE_FROZEN,
  DEFAULT_CONFIG_PATH
};
