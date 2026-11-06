/**
 * 🌐 Universal Agent Core Hub - Runtime Language Management Subsystem
 * Minimal runtime language management for active projects without reinitialization.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../.agents/memory/runtime_config.json');

// In-memory runtime state for zero-restart session behavior
let _activeLanguages = null;
let _primaryLanguage = null;
let _hasExplicitRuntimeOverride = false;
let _lastUpdated = null;

/**
 * Canonical registry of supported programming languages in Agent Core Hub.
 * Mapped to the 28 stacks and skills existing in the repository.
 */
const LANGUAGE_REGISTRY = {
  'dart': {
    id: 'dart',
    name: 'Dart',
    aliases: ['dart'],
    stacks: ['flutter', 'dart-backend'],
    extensions: ['.dart'],
    evidenceFiles: ['pubspec.yaml']
  },
  'javascript': {
    id: 'javascript',
    name: 'JavaScript',
    aliases: ['javascript', 'js'],
    stacks: ['vanilla-web', 'nodejs', 'react', 'react-nextjs', 'vue', 'nestjs'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    evidenceFiles: ['package.json']
  },
  'typescript': {
    id: 'typescript',
    name: 'TypeScript',
    aliases: ['typescript', 'ts'],
    stacks: ['react', 'react-nextjs', 'vue', 'nodejs', 'nestjs'],
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    evidenceFiles: ['tsconfig.json']
  },
  'python': {
    id: 'python',
    name: 'Python',
    aliases: ['python', 'py'],
    stacks: ['python-fastapi', 'python-ai-ml'],
    extensions: ['.py'],
    evidenceFiles: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py']
  },
  'golang': {
    id: 'golang',
    name: 'Go',
    aliases: ['golang', 'go'],
    stacks: ['golang'],
    extensions: ['.go'],
    evidenceFiles: ['go.mod']
  },
  'rust': {
    id: 'rust',
    name: 'Rust',
    aliases: ['rust', 'rs'],
    stacks: ['rust'],
    extensions: ['.rs'],
    evidenceFiles: ['Cargo.toml']
  },
  'java': {
    id: 'java',
    name: 'Java',
    aliases: ['java'],
    stacks: ['java'],
    extensions: ['.java'],
    evidenceFiles: ['pom.xml', 'build.gradle']
  },
  'kotlin': {
    id: 'kotlin',
    name: 'Kotlin',
    aliases: ['kotlin', 'kt'],
    stacks: ['kotlin'],
    extensions: ['.kt', '.kts'],
    evidenceFiles: ['build.gradle.kts']
  },
  'swift': {
    id: 'swift',
    name: 'Swift',
    aliases: ['swift'],
    stacks: ['swift'],
    extensions: ['.swift'],
    evidenceFiles: ['Package.swift']
  },
  'cpp': {
    id: 'cpp',
    name: 'C++',
    aliases: ['cpp', 'c++'],
    stacks: ['cpp', 'unreal-engine'],
    extensions: ['.cpp', '.hpp', '.cc', '.cxx', '.h'],
    evidenceFiles: ['CMakeLists.txt']
  },
  'csharp': {
    id: 'csharp',
    name: 'C#',
    aliases: ['csharp', 'c#', 'cs', 'dotnet'],
    stacks: ['dotnet', 'unity'],
    extensions: ['.cs'],
    evidenceFiles: ['*.csproj', '*.sln']
  },
  'php': {
    id: 'php',
    name: 'PHP',
    aliases: ['php'],
    stacks: ['php', 'laravel', 'wordpress'],
    extensions: ['.php'],
    evidenceFiles: ['composer.json', 'wp-config.php']
  },
  'solidity': {
    id: 'solidity',
    name: 'Solidity',
    aliases: ['solidity', 'sol'],
    stacks: ['solidity'],
    extensions: ['.sol'],
    evidenceFiles: ['foundry.toml', 'hardhat.config.js']
  },
  'bash': {
    id: 'bash',
    name: 'Bash',
    aliases: ['bash', 'sh', 'shell'],
    stacks: ['bash'],
    extensions: ['.sh', '.bash'],
    evidenceFiles: ['*.sh']
  },
  'gdscript': {
    id: 'gdscript',
    name: 'GDScript',
    aliases: ['gdscript', 'godot'],
    stacks: ['gdscript', 'godot'],
    extensions: ['.gd'],
    evidenceFiles: ['project.godot']
  },
  'sql': {
    id: 'sql',
    name: 'SQL',
    aliases: ['sql', 'database'],
    stacks: ['database'],
    extensions: ['.sql'],
    evidenceFiles: ['schema.sql']
  }
};

/**
 * Resolves config path taking into account options, env, cwd, or repository default.
 * @param {object} [options]
 * @returns {string}
 */
function _getConfigPath(options = {}) {
  if (options && options.configPath) return options.configPath;
  if (process.env.CORE_CONFIG_PATH) return process.env.CORE_CONFIG_PATH;
  const baseDir = (options && (options.cwd || options.targetDir)) ? path.resolve(options.cwd || options.targetDir) : process.cwd();
  const cwdAgents = path.resolve(baseDir, '.agents');
  const cwdConfig = path.resolve(baseDir, '.agents/memory/runtime_config.json');
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
 * Safely writes runtime config to disk without corrupting existing keys.
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
 * Capitalizes first letter for formatted display.
 * @param {string} str
 * @returns {string}
 */
function formatName(str) {
  if (!str) return '';
  const trimmed = str.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Resolves a language input string (name, ID, or alias) to its definition.
 * @param {string} langInput
 * @returns {object | null}
 */
function resolveLanguage(langInput) {
  if (!langInput || typeof langInput !== 'string') return null;
  const normalized = langInput.trim().toLowerCase();
  for (const [key, def] of Object.entries(LANGUAGE_REGISTRY)) {
    if (key === normalized || def.name.toLowerCase() === normalized || def.aliases.includes(normalized)) {
      return def;
    }
  }
  return null;
}

/**
 * Validates whether language support actually exists in the installed Core language/rules/skills registry.
 * @param {object} langDef
 * @param {object} [options]
 * @returns {boolean}
 */
function isLanguageInstalled(langDef, options = {}) {
  if (!langDef) return false;
  const coreRoot = (options && options.coreRoot) || path.resolve(__dirname, '..');
  const stacksDir = path.join(coreRoot, 'stacks');

  if (fs.existsSync(stacksDir)) {
    for (const s of langDef.stacks) {
      if (fs.existsSync(path.join(stacksDir, s))) {
        return true;
      }
    }
  }

  try {
    const { STACKS } = require('../cli');
    if (Array.isArray(STACKS)) {
      for (const s of langDef.stacks) {
        if (STACKS.includes(s)) return true;
      }
    }
  } catch {}

  return false;
}

/**
 * Detects the primary language of the project based on detected stack and evidence.
 * @param {string} [targetDir]
 * @returns {string}
 */
function detectPrimaryLanguage(targetDir = process.cwd()) {
  try {
    const { detectStack } = require('../cli');
    const detected = detectStack(targetDir);
    const stack = detected && detected.stack ? detected.stack : 'vanilla-web';

    // Special check: TypeScript when tsconfig.json is present in JS-based stacks
    if (['react', 'react-nextjs', 'vue', 'nodejs', 'nestjs'].includes(stack)) {
      if (fs.existsSync(path.join(targetDir, 'tsconfig.json'))) {
        return 'TypeScript';
      }
    }

    const STACK_TO_LANG = {
      'flutter': 'Dart',
      'dart-backend': 'Dart',
      'react': 'JavaScript',
      'react-nextjs': 'JavaScript',
      'vue': 'JavaScript',
      'vanilla-web': 'JavaScript',
      'nodejs': 'JavaScript',
      'nestjs': 'TypeScript',
      'python-fastapi': 'Python',
      'python-ai-ml': 'Python',
      'golang': 'Go',
      'rust': 'Rust',
      'cpp': 'C++',
      'unreal-engine': 'C++',
      'java': 'Java',
      'kotlin': 'Kotlin',
      'swift': 'Swift',
      'php': 'PHP',
      'laravel': 'PHP',
      'wordpress': 'PHP',
      'dotnet': 'C#',
      'unity': 'C#',
      'solidity': 'Solidity',
      'bash': 'Bash',
      'gdscript': 'GDScript',
      'godot': 'GDScript',
      'database': 'SQL',
      'core': 'JavaScript'
    };

    return STACK_TO_LANG[stack] || 'Dart';
  } catch {
    return 'Dart';
  }
}

function _getTargetDir(options = {}) {
  if (options && options.targetDir) return path.resolve(options.targetDir);
  if (options && options.cwd) return path.resolve(options.cwd);
  if (options && options.configPath) {
    const norm = path.resolve(options.configPath);
    if (norm.includes('.agents')) {
      return norm.split('.agents')[0].replace(/[/\\]$/, '') || process.cwd();
    }
  }
  return process.cwd();
}

/**
 * Returns current project languages list.
 * @param {object} [options]
 * @returns {string[]}
 */
function getProjectLanguages(options = {}) {
  if (options && Array.isArray(options.languages)) {
    return [...options.languages];
  }

  const configPath = _getConfigPath(options);
  const cfg = _readConfigFile(configPath);

  if (cfg && Array.isArray(cfg.languages) && cfg.languages.length > 0) {
    if (_hasExplicitRuntimeOverride && _lastUpdated && cfg.updatedAt) {
      if (new Date(cfg.updatedAt).getTime() > new Date(_lastUpdated).getTime()) {
        return [...cfg.languages];
      }
    } else if (!_hasExplicitRuntimeOverride) {
      return [...cfg.languages];
    }
  }

  if (_hasExplicitRuntimeOverride && Array.isArray(_activeLanguages)) {
    return [..._activeLanguages];
  }

  if (cfg && Array.isArray(cfg.languages) && cfg.languages.length > 0) {
    return [...cfg.languages];
  }

  const targetDir = _getTargetDir(options);
  const primary = (cfg && cfg.primaryLanguage) || detectPrimaryLanguage(targetDir);
  return [primary];
}

/**
 * Returns primary language of the project.
 * @param {object} [options]
 * @returns {string}
 */
function getPrimaryLanguage(options = {}) {
  if (options && options.primaryLanguage) return options.primaryLanguage;
  const configPath = _getConfigPath(options);
  const cfg = _readConfigFile(configPath);
  if (cfg && cfg.primaryLanguage) return cfg.primaryLanguage;
  if (_primaryLanguage) return _primaryLanguage;
  const targetDir = _getTargetDir(options);
  return detectPrimaryLanguage(targetDir);
}

/**
 * Returns full status of project languages.
 * @param {object} [options]
 * @returns {{ languages: string[], primary: string }}
 */
function getProjectLanguageStatus(options = {}) {
  const languages = getProjectLanguages(options);
  const primary = getPrimaryLanguage(options);
  return {
    languages,
    primary
  };
}

/**
 * Captures an immutable snapshot of project languages for an executing task.
 * Future language changes will NOT mutate this snapshot.
 * @param {object} [options]
 * @returns {Readonly<{ languages: readonly string[], primary: string, snapshotTime: string }>}
 */
function getProjectLanguageSnapshot(options = {}) {
  const languages = getProjectLanguages(options);
  const primary = getPrimaryLanguage(options);
  return Object.freeze({
    languages: Object.freeze([...languages]),
    primary,
    snapshotTime: new Date().toISOString()
  });
}

/**
 * Formats status output matching required CLI UX.
 * @param {{ languages: string[], primary: string }} status
 * @returns {string}
 */
function formatLanguageStatus(status) {
  const lines = ['Project Languages', ''];
  for (const l of status.languages) {
    lines.push(`- ${l}`);
  }
  lines.push('');
  lines.push(`Primary: ${status.primary}`);
  return lines.join('\n');
}

/**
 * Adds a supported language to the active project configuration.
 * @param {string} langInput
 * @param {object} [options]
 * @returns {{ ok: boolean, message: string, language: string|null, languages?: string[], primary?: string, error?: string }}
 */
function addProjectLanguage(langInput, options = {}) {
  if (!langInput || typeof langInput !== 'string' || !langInput.trim()) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      message: 'Please specify a language to add.',
      language: null
    };
  }

  const def = resolveLanguage(langInput);
  if (!def || !isLanguageInstalled(def, options)) {
    const formatted = formatName(langInput);
    return {
      ok: false,
      error: 'UNSUPPORTED',
      message: `${formatted} support is not installed or available.\nNo changes made.`,
      language: null
    };
  }

  const currentLanguages = getProjectLanguages(options);
  if (currentLanguages.includes(def.name)) {
    return {
      ok: false,
      error: 'ALREADY_ENABLED',
      message: `${def.name} is already enabled.`,
      language: def.name,
      languages: currentLanguages
    };
  }

  const primary = getPrimaryLanguage(options);
  const updatedLanguages = [...currentLanguages, def.name];

  _activeLanguages = updatedLanguages;
  _hasExplicitRuntimeOverride = true;
  _lastUpdated = new Date();

  if (options.persist !== false) {
    const configPath = _getConfigPath(options);
    _writeConfigFile({
      languages: updatedLanguages,
      primaryLanguage: primary,
      updatedAt: _lastUpdated.toISOString()
    }, configPath);
  }

  return {
    ok: true,
    message: `${def.name} added.\nEffective from: next task.`,
    language: def.name,
    languages: updatedLanguages,
    primary
  };
}

/**
 * Removes a language from future project routing.
 * Enforces safety invariants: cannot remove only language, cannot remove required primary language.
 * @param {string} langInput
 * @param {object} [options]
 * @returns {{ ok: boolean, message: string, language: string|null, languages?: string[], primary?: string, error?: string }}
 */
function removeProjectLanguage(langInput, options = {}) {
  if (!langInput || typeof langInput !== 'string' || !langInput.trim()) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      message: 'Please specify a language to remove.',
      language: null
    };
  }

  const def = resolveLanguage(langInput);
  const targetName = def ? def.name : formatName(langInput);
  const currentLanguages = getProjectLanguages(options);

  if (!currentLanguages.includes(targetName)) {
    return {
      ok: false,
      error: 'NOT_ENABLED',
      message: `${targetName} is not currently enabled.\nNo changes made.`,
      language: null
    };
  }

  // Safety Check 1: Cannot remove only active language
  if (currentLanguages.length <= 1) {
    return {
      ok: false,
      error: 'ONLY_LANGUAGE',
      message: `Cannot remove ${targetName}: It is the only active project language.\nNo changes made.`,
      language: targetName
    };
  }

  // Safety Check 2: Cannot remove required primary language
  const targetDir = _getTargetDir(options);
  const detectedPrimary = detectPrimaryLanguage(targetDir);
  const configuredPrimary = getPrimaryLanguage(options);
  const primary = configuredPrimary || detectedPrimary;

  if (targetName.toLowerCase() === primary.toLowerCase() || targetName.toLowerCase() === detectedPrimary.toLowerCase()) {
    return {
      ok: false,
      error: 'PRIMARY_REQUIRED',
      message: `Cannot remove ${targetName}: It is the primary language required by the detected project configuration.\nNo changes made.`,
      language: targetName
    };
  }

  const updatedLanguages = currentLanguages.filter(l => l !== targetName);

  _activeLanguages = updatedLanguages;
  _hasExplicitRuntimeOverride = true;
  _lastUpdated = new Date();

  if (options.persist !== false) {
    const configPath = _getConfigPath(options);
    _writeConfigFile({
      languages: updatedLanguages,
      primaryLanguage: primary,
      updatedAt: _lastUpdated.toISOString()
    }, configPath);
  }

  return {
    ok: true,
    message: `${targetName} removed.\nEffective from: next task.`,
    language: targetName,
    languages: updatedLanguages,
    primary
  };
}

/**
 * Returns available specialist skills matching the active project languages.
 * @param {string[]} languages
 * @param {object} [options]
 * @returns {string[]}
 */
function getSkillsForLanguages(languages, options = {}) {
  const coreRoot = (options && options.coreRoot) || path.resolve(__dirname, '..');
  const stacksDir = path.join(coreRoot, 'stacks');
  const skills = new Set();

  if (!Array.isArray(languages)) return [];

  for (const langName of languages) {
    const def = resolveLanguage(langName);
    if (!def) continue;
    for (const stackName of def.stacks) {
      const skillPath = path.join(stacksDir, stackName, 'skills');
      if (fs.existsSync(skillPath)) {
        try {
          for (const entry of fs.readdirSync(skillPath)) {
            if (fs.existsSync(path.join(skillPath, entry, 'SKILL.md'))) {
              skills.add(entry);
            }
          }
        } catch {}
      }
    }
  }

  return Array.from(skills).sort();
}

/**
 * Resets runtime language state (used by test suites).
 * @param {object} [options]
 * @param {boolean} [options.cleanDisk=false]
 */
function resetProjectLanguages(options = {}) {
  _activeLanguages = null;
  _primaryLanguage = null;
  _hasExplicitRuntimeOverride = false;
  _lastUpdated = null;

  if (options && options.cleanDisk) {
    const configPath = _getConfigPath(options);
    try {
      const current = _readConfigFile(configPath);
      if (current) {
        delete current.languages;
        delete current.primaryLanguage;
        if (Object.keys(current).length === 0) {
          fs.unlinkSync(configPath);
        } else {
          fs.writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf8');
        }
      }
    } catch {}
  }
}

module.exports = {
  LANGUAGE_REGISTRY,
  resolveLanguage,
  isLanguageInstalled,
  detectPrimaryLanguage,
  getProjectLanguages,
  getPrimaryLanguage,
  getProjectLanguageStatus,
  getProjectLanguageSnapshot,
  formatLanguageStatus,
  addProjectLanguage,
  removeProjectLanguage,
  getSkillsForLanguages,
  resetProjectLanguages,
  DEFAULT_CONFIG_PATH
};
