#!/usr/bin/env node

/**
 * 🌐 HOTZEN — Governed AI Engineering Framework - NPX Instant Runner
 * Usage: npx hotzen
 * Or:    npx hotzen --stack=flutter --bridges=cursor,copilot
 * Or:    npx hotzen bridge cursor
 * Flags: --dry-run (Simulate without writing files), --help (Show help)
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { isDeepStrictEqual } = require('util');
const { discoverWorkspaceChanges } = require('../core/workflow/verification_workspace');
const { detectStack, resolveVerificationContract, compareVerificationContract } = require('../core/workflow/verification_contract');
const diagnosticCrypto = require('crypto');
const { nativeExecutorForHost } = require('../core/workflow/plan_receipt');

const AGENT_APPROVAL_CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Legacy remote bootstrap only; normal installation uses packaged resources.
const REPO_USER = 'aminkhan1';
const REPO_NAME = 'agent-core-hub';

const STACKS = [
  'flutter', 'kotlin', 'swift', 'react', 'react-nextjs', 'vue', 'vanilla-web', 'wordpress',
  'python-fastapi', 'golang', 'rust', 'cpp', 'java', 'php', 'laravel', 'dotnet',
  'nestjs', 'nodejs', 'dart-backend', 'python-ai-ml', 'database',
  'solidity',
  'unity', 'godot', 'gdscript', 'unreal-engine', 'bash', 'core'
];

const BRIDGE_REGISTRY = {
  gemini: ['GEMINI.md', '.geminiignore'],
  claude: ['CLAUDE.md', '.claude/settings.json', '.claude/commands/route.md', '.claude/commands/plan.md', '.claude/commands/critic.md', '.claude/commands/verify.md', '.mcp.json'],
  codex: ['CODEX.md', '.codexignore', 'AGENTS.md'],
  cursor: ['CURSOR.md', '.cursorrules', '.cursor/rules/governance.mdc', '.cursor/rules/clean-architecture.mdc', '.cursor/mcp.json', '.cursorignore'],
  copilot: ['.github/copilot-instructions.md'],
  windsurf: ['WINDSURF.md', '.windsurfrules', '.windsurfignore'],
  cline: ['CLINE.md', '.clinerules'],
  aider: ['AIDER.md', '.aider.conf.yml', '.aiderignore'],
  deepseek: ['DEEPSEEK.md', '.deepseekignore'],
  qwen: ['QWEN.md', '.qwenignore'],
  codestral: ['CODESTRAL.md', '.codestralignore'],
  ollama: ['OLLAMA.md', '.ollamaignore'],
  kimi: ['KIMI.md', '.kimiignore'],
  opencode: ['OPENCODE.md', '.opencodeignore']
};

const DEFAULT_BRIDGES = ['gemini', 'claude', 'codex'];

const MANAGED_START_MARKER = '<!-- AGENT-CORE-HUB:START -->';
const MANAGED_END_MARKER = '<!-- AGENT-CORE-HUB:END -->';

function wrapInManagedBlock(content) {
  const trimmed = content.trim();
  if (trimmed.includes(MANAGED_START_MARKER) && trimmed.includes(MANAGED_END_MARKER)) {
    return trimmed + '\n';
  }
  return `${MANAGED_START_MARKER}\n${trimmed}\n${MANAGED_END_MARKER}\n`;
}

function isInstructionFile(filePath) {
  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('.claude/commands/')) {
    return false;
  }
  const known = [
    'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'CODEX.md', 'CURSOR.md',
    '.cursorrules', '.windsurfrules', '.clinerules', 'WINDSURF.md',
    'CLINE.md', 'AIDER.md', 'DEEPSEEK.md', 'QWEN.md', 'CODESTRAL.md',
    'OLLAMA.md', 'KIMI.md', 'OPENCODE.md', 'copilot-instructions.md',
    'STACK_RULES.md'
  ];
  return known.includes(basename) || basename.endsWith('.md');
}

function safeMergeInstructionString(dst, content, isDryRun) {
  const relDst = path.relative(process.cwd(), dst);
  const managedBlock = wrapInManagedBlock(content);

  if (isDryRun) {
    if (fs.existsSync(dst)) {
      console.log(`   [DRY-RUN] Would merge managed block into: ${relDst}`);
    } else {
      console.log(`   [DRY-RUN] Would create instruction file: ${relDst}`);
    }
    return;
  }

  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  if (!fs.existsSync(dst)) {
    fs.writeFileSync(dst, managedBlock, 'utf8');
    return;
  }

  const dstContent = fs.readFileSync(dst, 'utf8');
  let newContent = '';

  const startIdx = dstContent.indexOf(MANAGED_START_MARKER);
  const endIdx = dstContent.indexOf(MANAGED_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    const before = dstContent.slice(0, startIdx);
    const after = dstContent.slice(endIdx + MANAGED_END_MARKER.length);
    newContent = `${before}${managedBlock.trim()}${after}`;
  } else if (startIdx !== -1 && endIdx === -1) {
    const before = dstContent.slice(0, startIdx);
    newContent = `${before}${managedBlock.trim()}\n`;
  } else if (startIdx === -1 && endIdx !== -1) {
    const after = dstContent.slice(endIdx + MANAGED_END_MARKER.length);
    newContent = `${managedBlock.trim()}\n\n${after.trimStart()}`;
  } else {
    const trimmedDst = dstContent.trimEnd();
    newContent = trimmedDst.length > 0 ? `${trimmedDst}\n\n${managedBlock}` : `${managedBlock}`;
  }

  if (newContent === dstContent) {
    return; // Exact match, 100% idempotent
  }

  const backupPath = `${dst}.bak.${Date.now()}`;
  fs.writeFileSync(backupPath, dstContent, 'utf8');
  console.log(`   🛡️ Backed up existing file: ${path.basename(dst)} -> ${path.basename(backupPath)}`);
  fs.writeFileSync(dst, newContent, 'utf8');
}

function safeMergeInstructionFile(src, dst, isDryRun) {
  if (!fs.existsSync(src)) return;
  const srcContent = fs.readFileSync(src, 'utf8');
  safeMergeInstructionString(dst, srcContent, isDryRun);
}

function safeMergeMcpFile(src, dst, isDryRun) {
  const relDst = path.relative(process.cwd(), dst);
  if (isDryRun) {
    if (fs.existsSync(dst)) {
      console.log(`   [DRY-RUN] Would preserve and non-destructively merge: ${relDst}`);
    } else {
      console.log(`   [DRY-RUN] Would create minimal MCP config: ${relDst}`);
    }
    return;
  }

  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  if (!fs.existsSync(dst)) {
    const initialConfig = {
      mcpServers: {}
    };
    fs.writeFileSync(dst, JSON.stringify(initialConfig, null, 2) + '\n', 'utf8');
    return;
  }

  let existingContent = '';
  let existingJson = null;
  try {
    existingContent = fs.readFileSync(dst, 'utf8');
    existingJson = JSON.parse(existingContent);
  } catch (err) {
    console.warn(`   ⚠️ Warning: ${relDst} contains invalid JSON (${err.message}). Preserving file untouched.`);
    return;
  }

  if (!existingJson || typeof existingJson !== 'object') {
    return;
  }

  if (!existingJson.mcpServers || typeof existingJson.mcpServers !== 'object') {
    existingJson.mcpServers = {};
  }

  // User configuration is authoritative; no optional/heavy servers injected.
  const newContent = JSON.stringify(existingJson, null, 2) + '\n';
  if (newContent.trim() === existingContent.trim()) {
    return; // Idempotent
  }

  const backupPath = `${dst}.bak.${Date.now()}`;
  fs.writeFileSync(backupPath, existingContent, 'utf8');
  console.log(`   🛡️ Backed up existing file: ${path.basename(dst)} -> ${path.basename(backupPath)}`);
  fs.writeFileSync(dst, newContent, 'utf8');
}

function safeCopyFile(src, dst, isDryRun) {
  const relDst = path.relative(process.cwd(), dst);
  if (isDryRun) {
    if (fs.existsSync(dst)) {
      console.log(`   [DRY-RUN] Would backup & overwrite: ${relDst} -> .bak`);
    } else {
      console.log(`   [DRY-RUN] Would create: ${relDst}`);
    }
    return;
  }

  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  if (fs.existsSync(dst)) {
    try {
      const srcBuf = fs.readFileSync(src);
      const dstBuf = fs.readFileSync(dst);
      if (srcBuf.equals(dstBuf)) {
        return; // Idempotent: exact byte match, no write, no backup
      }
      const backupPath = `${dst}.bak.${Date.now()}`;
      fs.copyFileSync(dst, backupPath);
      console.log(`   🛡️ Backed up existing file: ${path.basename(dst)} -> ${path.basename(backupPath)}`);
    } catch (_) {}
  }
  fs.copyFileSync(src, dst);
}

function safeWriteString(dst, content, isDryRun) {
  const relDst = path.relative(process.cwd(), dst);
  if (isDryRun) {
    if (fs.existsSync(dst)) {
      console.log(`   [DRY-RUN] Would backup & overwrite: ${relDst} -> .bak`);
    } else {
      console.log(`   [DRY-RUN] Would create: ${relDst}`);
    }
    return;
  }

  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  if (fs.existsSync(dst)) {
    try {
      const existing = fs.readFileSync(dst, 'utf8');
      if (existing === content) {
        return; // Idempotent: exact string match, no write, no backup
      }
      const backupPath = `${dst}.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, existing, 'utf8');
      console.log(`   🛡️ Backed up existing file: ${path.basename(dst)} -> ${path.basename(backupPath)}`);
    } catch (_) {}
  }
  fs.writeFileSync(dst, content, 'utf8');
}

const REQUIRED_GITIGNORE_RULES = [
  '*.bak',
  '*.bak.*',
  '.agents/memory/database.sqlite',
  '.agents/memory/database.sqlite*',
  '.agents/memory/runtime_config.json',
  '.agents/memory/metrics.json',
  '.agents/memory/*.local.md',
  '.agents/tasks/*',
  '!.agents/tasks/.gitkeep'
];

const GITIGNORE_HEADER = '# HOTZEN — local runtime state';

/**
 * Ensures consumer repository .gitignore contains required Agent Core runtime isolation rules.
 * Preserves all existing lines, checks each rule independently, and is strictly idempotent.
 *
 * @param {string} targetRoot Target consumer repository root
 * @param {object} [options]
 * @param {boolean} [options.isDryRun=false]
 * @returns {{ created: boolean, modified: boolean, missingRules: string[], addedRules: string[] }}
 */
function ensureConsumerGitignore(targetRoot = process.cwd(), options = {}) {
  const isDryRun = Boolean(options.isDryRun);
  const gitignorePath = path.join(path.resolve(targetRoot), '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    const content = [
      GITIGNORE_HEADER,
      ...REQUIRED_GITIGNORE_RULES,
      ''
    ].join('\n');

    if (isDryRun) {
      console.log(`   [DRY-RUN] Would create: ${gitignorePath}`);
      return { created: true, modified: false, missingRules: [...REQUIRED_GITIGNORE_RULES], addedRules: [...REQUIRED_GITIGNORE_RULES] };
    }

    fs.writeFileSync(gitignorePath, content, 'utf8');
    return { created: true, modified: false, missingRules: [...REQUIRED_GITIGNORE_RULES], addedRules: [...REQUIRED_GITIGNORE_RULES] };
  }

  const existingContent = fs.readFileSync(gitignorePath, 'utf8');
  const existingLines = existingContent.split(/\r?\n/).map(l => l.trim());
  const existingSet = new Set(existingLines);

  const missingRules = REQUIRED_GITIGNORE_RULES.filter(rule => !existingSet.has(rule));

  if (missingRules.length === 0) {
    return { created: false, modified: false, missingRules: [], addedRules: [] };
  }

  if (isDryRun) {
    console.log(`   [DRY-RUN] Would update: ${gitignorePath} (+${missingRules.length} rules)`);
    return { created: false, modified: true, missingRules, addedRules: missingRules };
  }

  let newContent = existingContent;
  if (newContent.length > 0 && !newContent.endsWith('\n')) {
    newContent += '\n';
  }

  const hasHeader = existingLines.includes(GITIGNORE_HEADER);
  if (!hasHeader) {
    if (newContent.length > 0 && !newContent.endsWith('\n\n')) {
      newContent += '\n';
    }
    newContent += `${GITIGNORE_HEADER}\n`;
  }

  for (const rule of missingRules) {
    newContent += `${rule}\n`;
  }

  fs.writeFileSync(gitignorePath, newContent, 'utf8');
  return { created: false, modified: true, missingRules, addedRules: missingRules };
}

function safeCopyDir(srcDir, dstDir, isDryRun) {
  if (!fs.existsSync(srcDir)) return;
  if (isDryRun) {
    console.log(`   [DRY-RUN] Would sync directory: ${path.relative(process.cwd(), dstDir)}/`);
    return;
  }
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      safeCopyDir(srcPath, dstPath, isDryRun);
    } else {
      safeCopyFile(srcPath, dstPath, isDryRun);
    }
  }
}

function runDoctor(targetDir = process.cwd()) {
  const issues = [];
  const warnings = [];
  const passes = [];

  // 1. Check Git & Pre-commit Hook
  const hasGit = fs.existsSync(path.join(targetDir, '.git'));
  if (!hasGit) {
    issues.push('Git repository not initialized (.git directory is missing).');
  } else {
    passes.push('Git repository is initialized.');
    let hookConfigured = false;
    try {
      const hooksPath = execSync('git config core.hooksPath', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (hooksPath === '.agents/hooks') hookConfigured = true;
    } catch (_) {}
    if (!hookConfigured && fs.existsSync(path.join(targetDir, '.git', 'hooks', 'pre-commit'))) {
      hookConfigured = true;
    }
    if (hookConfigured) {
      passes.push('Git pre-commit security guardian hook is configured.');
    } else {
      warnings.push('Git pre-commit hook is not configured (opt-in). Run "npx hotzen --install-hooks" or "git config core.hooksPath .agents/hooks" to enable.');
    }
  }

  // 2. Check Security Scanner
  const scannerPath = path.join(targetDir, '.agents', 'security', 'security_scanner.py');
  if (fs.existsSync(scannerPath)) {
    passes.push('Enterprise Security Scanner is installed (.agents/security/security_scanner.py).');
  } else {
    issues.push('Security scanner missing (.agents/security/security_scanner.py).');
  }

  // 3. Check Governance Rules
  const rulesDir = path.join(targetDir, '.agents', 'rules');
  if (fs.existsSync(rulesDir)) {
    const rulesCount = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).length;
    passes.push(`Governance Rules: ${rulesCount} active rules detected in .agents/rules/`);
  } else {
    issues.push('Governance rules directory (.agents/rules/) missing.');
  }

  // 4. Check Active Bridges
  const activeBridges = [];
  for (const [bridgeName, files] of Object.entries(BRIDGE_REGISTRY)) {
    const hasAny = files.some(f => fs.existsSync(path.join(targetDir, f)));
    if (hasAny) activeBridges.push(bridgeName);
  }
  if (activeBridges.length > 0) {
    passes.push(`Active AI Bridges (${activeBridges.length}): ${activeBridges.join(', ')}`);
  } else {
    issues.push('No AI Bridge configured yet. Run "npx hotzen" to deploy bridges.');
  }

  // 5. Check Memory System & Active Session Memory
  const memoryDir = path.join(targetDir, '.agents', 'memory');
  if (fs.existsSync(memoryDir)) {
    const sessionMemory = path.join(memoryDir, 'session_memory.md');
    if (fs.existsSync(sessionMemory)) {
      const content = fs.readFileSync(sessionMemory, 'utf8');
      const isUnfilled = content.includes('هنوز اقدامی در این سشن کاری ثبت نشده است') || content.includes('[نام پروژه]');
      if (isUnfilled) {
        warnings.push('Session memory (.agents/memory/session_memory.md) contains clean template; no active session tasks recorded yet.');
        passes.push('Quad-Memory system is present with initialized template.');
      } else {
        passes.push('Quad-Memory system is present with active project session records.');
      }
    } else {
      issues.push('Active session memory missing (.agents/memory/session_memory.md). Agents must record session learning.');
    }
  } else {
    issues.push('Active memory directory (.agents/memory/) missing.');
  }

  return {
    status: issues.length === 0 ? 'healthy' : 'needs_attention',
    passes,
    warnings,
    issues
  };
}

function runVerify(targetDir = process.cwd(), options = {}) {
  const scope = options.scope || 'changed';
  const detected = detectStack(targetDir);
  const results = {
    stack: detected.stack,
    scope,
    checks: []
  };

  if (options.verificationContract) {
    const contract = options.verificationContract;
    const comparison = compareVerificationContract(targetDir, contract, { expectedFiles: options.expectedFiles || [] });
    if (!comparison.ok || contract.status !== 'ready') {
      results.checks.push({
        name: 'Verification Contract', status: 'FAILED', isInfrastructureError: true,
        cmd: 'resolve verification contract',
        error: comparison.ok ? contract.blockingReasons.join('; ') : comparison.reason
      });
      return results;
    }
    for (const check of contract.checks) {
      if (!check.required) {
        continue;
      }
      try {
        const run = typeof options.execRunner === 'function'
          ? options.execRunner(check.cmd, { cwd: targetDir, name: check.name })
          : require('child_process').spawnSync(check.tool.path, check.args, {
              cwd: targetDir, encoding: 'utf8', stdio: 'pipe', timeout: options.timeoutMs || 600000
            });
        if (run && (run.isInfrastructureError || run.error)) {
          results.checks.push({ name: check.name, status: 'FAILED', cmd: check.cmd, isInfrastructureError: true,
            error: String((run.error && run.error.message) || run.stderr || 'Verifier infrastructure failure') });
          break;
        }
        if (run && (run.status === 0 || run.ok === true || run.code === 0)) {
          results.checks.push({ name: check.name, status: 'PASSED', cmd: check.cmd });
        } else {
          results.checks.push({ name: check.name, status: 'FAILED', cmd: check.cmd, error: (run && (run.stderr || run.stdout || run.message)) || 'Check failed' });
        }
      } catch (error) {
        results.checks.push({ name: check.name, status: 'FAILED', cmd: check.cmd, isInfrastructureError: true, error: error.message });
        break;
      }
    }
    return results;
  }

  const steps = resolveVerificationContract(targetDir, { legacy: true }).checks
    .filter(check => check.required).map(check => ({ name: check.name, cmd: check.cmd }));

  // Scoping Logic
  let modifiedFiles = [];
  let isDocsOnly = false;
  if (scope === 'changed') {
    modifiedFiles = discoverWorkspaceChanges(targetDir);

    if (modifiedFiles.length > 0) {
      results.scopedNotice = `Scoping verification to ${modifiedFiles.length} modified file(s).`;
      const nonCodeExts = ['.md', '.txt', '.json', '.yml', '.yaml', '.lock', '.gitignore'];
      isDocsOnly = modifiedFiles.every(f => nonCodeExts.some(ext => f.endsWith(ext)));
      if (isDocsOnly) {
        results.scopedNotice += ' (Documentation/Configuration only; code test suites bypassed).';
        steps.length = 0;
      } else {
        for (const step of steps) {
          if (step.cmd.startsWith('pytest')) {
            const testFiles = modifiedFiles.filter(f => f.startsWith('test_') || f.endsWith('_test.py') || f.includes('/test_'));
            if (testFiles.length > 0) {
              step.cmd = `pytest ${testFiles.join(' ')}`;
            }
          }
        }
      }
    } else {
      results.scopedNotice = 'No modified files detected in working tree; executing baseline stack verification.';
    }
  } else if (scope === 'full') {
    results.justificationNotice = '⚠️ [FULL-SUITE SCOPE]: Executing full project test suite. Note: Full-suite runs require explicit justification (release gating, critical architectural changes, or explicit user request).';
  }

  if (steps.length === 0) {
    results.checks.push({
      name: 'Verification Matrix',
      status: isDocsOnly ? 'PASSED' : 'SKIPPED',
      message: isDocsOnly
        ? 'Documentation/Configuration changes verified without code regression.'
        : `No standard verification commands configured for stack: ${detected.stack}`
    });
    return results;
  }

  for (const step of steps) {
    if (process.env.AGENT_HUB_IN_TEST && step.cmd.startsWith('npm test')) {
      results.checks.push({ name: step.name, status: 'PASSED', cmd: `${step.cmd} (re-entry prevented)` });
      continue;
    }

    // A supplied runner owns command availability and execution (used by offline tests).
    const baseCmd = step.cmd.trim().split(/\s+/)[0];
    let isAvailable = typeof options.execRunner === 'function';
    if (!isAvailable) {
      try {
        const checkCmd = process.platform === 'win32' ? `where ${baseCmd}` : `command -v ${baseCmd}`;
        execSync(checkCmd, { stdio: 'pipe' });
        isAvailable = true;
      } catch (_) {
        isAvailable = false;
      }
    }

    if (!isAvailable) {
      results.checks.push({
        name: step.name,
        status: 'SKIPPED',
        cmd: step.cmd,
        message: `Command executable '${baseCmd}' not found in PATH.`
      });
      continue;
    }

    // Adaptive Check: Test directory existence for test runners
    if (step.name === 'Tests' || step.name === 'Test') {
      if (detected.stack === 'flutter' || detected.stack === 'dart-backend') {
        const testDir = path.join(targetDir, 'test');
        if (!fs.existsSync(testDir)) {
          results.checks.push({
            name: step.name,
            status: 'SKIPPED',
            cmd: step.cmd,
            message: `No test/ directory found in ${detected.stack} project.`
          });
          continue;
        }
      }
    }

    try {
      if (typeof options.execRunner === 'function') {
        const res = options.execRunner(step.cmd, { cwd: targetDir, name: step.name });
        if (res && res.isInfrastructureError) {
          results.checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, isInfrastructureError: true, error: res.error || 'Verifier infrastructure failure' });
        } else if (res && (res.status === 0 || res.ok === true || res.code === 0)) {
          results.checks.push({ name: step.name, status: 'PASSED', cmd: step.cmd });
        } else {
          results.checks.push({ name: step.name, status: 'FAILED', cmd: step.cmd, error: (res && (res.stderr || res.error || res.message)) || `${step.name} check failed` });
        }
      } else {
        execSync(step.cmd, { cwd: targetDir, stdio: 'pipe', timeout: 600000 });
        results.checks.push({ name: step.name, status: 'PASSED', cmd: step.cmd });
      }
    } catch (err) {
      const errMsg = err.stderr ? err.stderr.toString() : err.message;
      results.checks.push({
        name: step.name,
        status: 'FAILED',
        cmd: step.cmd,
        error: errMsg.trim(),
        ...(err.isInfrastructureError || typeof options.execRunner === 'function' ? { isInfrastructureError: true } : {})
      });
    }
  }

  return results;
}


function runReset(targetDir = process.cwd(), isDryRun = false) {
  const skillsDir = path.join(targetDir, '.agents', 'skills');
  const cleared = [];
  if (fs.existsSync(skillsDir)) {
    if (!isDryRun) {
      fs.rmSync(skillsDir, { recursive: true, force: true });
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    cleared.push('.agents/skills');
  }

  const claudeSkillsDir = path.join(targetDir, '.claude', 'skills');
  if (fs.existsSync(claudeSkillsDir)) {
    if (!isDryRun) {
      fs.rmSync(claudeSkillsDir, { recursive: true, force: true });
      fs.mkdirSync(claudeSkillsDir, { recursive: true });
    }
    cleared.push('.claude/skills');
  }

  // Restore previous git hooks if backup exists
  const hooksBackup = path.join(targetDir, '.agents', '.hooks-backup');
  if (fs.existsSync(hooksBackup) && !isDryRun) {
    try {
      const prevHook = fs.readFileSync(hooksBackup, 'utf8').trim();
      if (prevHook) {
        execSync(`git config core.hooksPath "${prevHook}"`, { cwd: targetDir, stdio: 'pipe' });
        cleared.push(`core.hooksPath restored to '${prevHook}'`);
      }
      fs.rmSync(hooksBackup, { force: true });
    } catch (_) {}
  }

  return {
    status: 'success',
    cleared,
    message: cleared.length > 0
      ? `Reset successfully: ${cleared.join(', ')}`
      : 'No existing skills found to reset.'
  };
}

function parseStackSelection(input, defaultChoice = null) {
  if (!input || !input.trim()) {
    return STACKS.includes(defaultChoice) ? [defaultChoice] : [];
  }
  const parts = input.split(',').map(s => s.trim().toLowerCase());
  const result = [];
  for (const part of parts) {
    const num = /^\d+$/.test(part) ? Number(part) : NaN;
    if (Number.isSafeInteger(num) && num >= 1 && num <= STACKS.length) {
      result.push(STACKS[num - 1]);
    } else if (STACKS.includes(part)) {
      result.push(part);
    } else {
      return [];
    }
  }
  const unique = Array.from(new Set(result));
  return unique;
}

function promptStack(detected = null) {
  return new Promise((resolve) => {
    console.log('======================================================================');
    console.log('🌐 HOTZEN — Governed AI Engineering Framework - NPX Instant Deployer');
    console.log('======================================================================');

    const defaultChoice = (detected && detected.confidence >= 0.7 && detected.stack !== 'core' && STACKS.includes(detected.stack)) ? detected.stack : null;

    if (defaultChoice) {
      console.log(`🔍 Auto-Detected Tech Stack: \x1b[32m${detected.stack}\x1b[0m (${Math.round(detected.confidence * 100)}% confidence)`);
      console.log(`   Evidence: ${detected.evidence.join(', ')}`);
      console.log('----------------------------------------------------------------------');
      console.log(`Press [Enter] to use detected stack '${detected.stack}'`);
      console.log(`Or enter stack number(s) / name(s) [1-${STACKS.length}] separated by comma:`);
    } else {
      console.log('🎯 Select Tech Stack(s) to Deploy into ' + process.cwd() + ' (e.g. 4,15 for multi-stack):');
    }

    STACKS.forEach((stack, index) => console.log(`   ${index + 1}) ${stack}`));
    console.log('======================================================================');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.once('close', () => resolve([]));
    const hint = defaultChoice ? `default: ${defaultChoice}` : 'explicit selection required; no default';
    rl.question(`Enter number(s) or name(s) separated by comma [${hint}]: `, (answer) => {
      const selectedList = parseStackSelection(answer, defaultChoice);
      resolve(selectedList);
      rl.close();
    });
  });
}

/**
 * Formats the complete user-visible plan with the standard approval prompt banner.
 *
 * @param {string} planText User-visible plan markdown/text
 * @returns {string} Banner-wrapped approval prompt text
 */
function formatPlanApprovalPrompt(planText, options = {}) {
  return require('../core/workflow/plan_display').formatPlanApprovalPrompt(planText, options);
}

/**
 * Interactively prompts the user for pre-execution plan decision using CLI architecture.
 *
 * @param {string} planText
 * @param {object} [options]
 * @returns {Promise<'APPROVE' | 'REJECT' | 'CANCEL' | null>}
 */
function promptPlanApproval(planText, options = {}) {
  return new Promise((resolve) => {
    if (options.interactive === false) {
      resolve(null);
      return;
    }

    const input = options.input || process.stdin;
    const output = options.output || process.stdout;

    const planLocale = require('../core/workflow/plan_display').normalizePlanLocale(options.planLocale);
    const banner = formatPlanApprovalPrompt(planText, { planLocale });
    if (output && typeof output.write === 'function') {
      output.write(banner + '\n\n');
    }

    const rl = readline.createInterface({
      input,
      output
    });

    let answered = false;
    let timedOut = false;
    const timeoutMs = options.timeoutMs;
    const timer = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => { timedOut = true; rl.close(); }, timeoutMs)
      : null;

    rl.question(planLocale === 'fa' ? 'گزینه [Y/N/C]: ' : 'Choice [Y/N/C]: ', (rawAnswer) => {
      answered = true;
      if (timer) clearTimeout(timer);
      rl.close();
      const ans = (rawAnswer || '').trim().toLowerCase();
      if (ans === 'y' || ans === 'yes' || ans === 'approve' || ans === 'a') {
        resolve('APPROVE');
      } else if (ans === 'n' || ans === 'no' || ans === 'reject' || ans === 'r') {
        resolve('REJECT');
      } else if (ans === 'c' || ans === 'cancel') {
        resolve('CANCEL');
      } else {
        // No decision, empty, timeout, silence: silence/timeouts must NOT mean approval
        resolve(null);
      }
    });

    rl.on('close', () => {
      if (!answered) {
        if (timer) clearTimeout(timer);
        resolve(timedOut ? 'TIMEOUT' : null);
      }
    });
  });
}

function promptGitlessWorkspaceAuthorization(adapter, approvedPlanSnapshot, targetCwd, options = {}) {
  if (!adapter || typeof adapter.createGitlessWorkspaceAuthorizationChallenge !== 'function' ||
      typeof adapter.confirmGitlessWorkspaceAuthorization !== 'function') {
    return Promise.resolve({ status: 'unsupported', authorization: null });
  }
  if (options.interactive === false) return Promise.resolve({ status: 'cancelled', authorization: null });

  let challenge;
  try {
    challenge = adapter.createGitlessWorkspaceAuthorizationChallenge(approvedPlanSnapshot, targetCwd);
  } catch (error) {
    return Promise.resolve({ status: 'invalid', authorization: null, error });
  }

  const output = options.output || process.stdout;
  const input = options.input || process.stdin;
  output.write(`\nGIT-LESS WORKSPACE AUTHORIZATION\nTask: ${challenge.taskId}\nCanonical workspace: ${challenge.workspace}\nPlan Receipt SHA-256: ${challenge.receiptDigest}\nSnapshot SHA-256: ${challenge.snapshotDigest}\nExecution attempt: ${challenge.attemptId}\nThis permits only --skip-git-repo-check. Filesystem sandboxing, Plan Approval, and File Scope remain unchanged.\nType exactly: ${challenge.confirmationCode}\n> `);

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
    let answered = false;
    rl.once('line', (line) => {
      answered = true;
      const authorization = adapter.confirmGitlessWorkspaceAuthorization(challenge, line.trim());
      resolve(authorization
        ? { status: 'authorized', authorization }
        : { status: 'rejected', authorization: null });
      rl.close();
    });
    rl.once('close', () => {
      if (!answered) resolve({ status: 'rejected', authorization: null });
    });
  });
}

function isDeepFrozenValue(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => isDeepFrozenValue(child, seen));
}

function deepFreezePlanValue(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezePlanValue(child, seen);
  return Object.freeze(value);
}

function samePlanJson(left, right) {
  const { canonicalize } = require('../core/workflow/plan_receipt');
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function buildDiagnosticAuthorizationBinding(bundle, cwd) {
  const { canonicalize, sha256Digest, normalizeWorkspacePath } = require('../core/workflow/plan_receipt');
  const receipt = bundle && (bundle.planReceipt || bundle.receipt);
  const snapshot = bundle && bundle.approvedPlanSnapshot;
  const taskId = bundle && bundle.task && bundle.task.id;
  const workspace = normalizeWorkspacePath(cwd);
  if (!receipt || !snapshot || !taskId || !workspace) {
    throw new Error('Diagnostic authorization requires a complete Plan bundle and canonical Workspace.');
  }
  return Object.freeze({
    taskId,
    workspace,
    receiptDigest: sha256Digest(receipt),
    snapshotDigest: sha256Digest(canonicalize(snapshot))
  });
}

function formatDiagnosticConfirmation(binding) {
  return `AUTHORIZE ${binding.taskId} ${binding.snapshotDigest.slice(0, 16)}`;
}

function buildAgentApprovalBinding(bundle, cwd, executionKind, budget, executionDigest = null) {
  const { canonicalize, sha256Digest, normalizeWorkspacePath, validatePlanReceipt } = require('../core/workflow/plan_receipt');
  const receipt = bundle && (bundle.planReceipt || bundle.receipt);
  const receiptCheck = validatePlanReceipt(receipt, { cwd });
  const snapshot = bundle && bundle.approvedPlanSnapshot;
  if (receiptCheck.valid && receiptCheck.payload.executionKind === 'native') {
    const binding = validateImportedPlanBundle(bundle, { cwd, taskPrompt: bundle.task?.userPrompt, nativeHost: receiptCheck.payload.nativeHost });
    if (!binding.valid || executionKind !== 'native_verification' || budget.maxProviderCalls !== 0 || budget.maxRecoveryAttempts !== 0) {
      throw new Error('Invalid Native challenge identity or budget.');
    }
  }
  if (!receiptCheck.valid || !snapshot || !bundle.task || !Array.isArray(snapshot.filesToModify)) {
    throw new Error('Agent approval requires a validated Plan bundle and Snapshot.');
  }
  return {
    taskId: receiptCheck.payload.taskId,
    executionKind,
    planDigest: receiptCheck.payload.planDigest,
    approvedPlanDigest: receiptCheck.payload.approvedPlanDigest,
    receiptDigest: sha256Digest(receipt),
    snapshotDigest: sha256Digest(canonicalize(snapshot)),
    workspacePath: normalizeWorkspacePath(cwd),
    approvedScope: [...snapshot.filesToModify],
    budget,
    executionDigest,
    ...(receiptCheck.payload.executionKind === 'native' ? { nativeHost: receiptCheck.payload.nativeHost, nativeExecutionKind: 'native' } : {})
  };
}

function createAgentApprovalChallenge(bundle, cwd, executionKind, budget, executionDigest = null, now = Date.now(), challengeId = null) {
  const binding = buildAgentApprovalBinding(bundle, cwd, executionKind, budget, executionDigest);
  challengeId = challengeId || diagnosticCrypto.randomUUID();
  const expiresAt = now + AGENT_APPROVAL_CHALLENGE_TTL_MS;
  const { ExecutionHistoryStore } = require('../core/allocation/execution_history_store');
  const store = new ExecutionHistoryStore({ cwd: binding.workspacePath });
  try {
    const result = store.createApprovalChallenge({ ...binding, challengeId, createdAt: now, expiresAt });
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, challengeId, expiresAt, binding };
  } finally {
    store.close();
  }
}

function formatAgentApprovalConsent(bundle, cwd, challenge, gitlessChallenge = null) {
  if (!challenge || challenge.ok !== true || typeof challenge.challengeId !== 'string' ||
      !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Date.now() || !challenge.binding) {
    throw new Error('agent_approval_challenge_invalid');
  }
  const binding = challenge.binding;
  const derived = buildAgentApprovalBinding(bundle, cwd, binding.executionKind, binding.budget, binding.executionDigest);
  if (!isDeepStrictEqual(derived, binding)) throw new Error('agent_approval_bundle_mismatch');

  const lines = [
    'Agent-mediated owner consent request',
    'Provenance: reported_by_agent (owner identity is not independently authenticated)',
    `Execution kind: ${binding.executionKind}`,
    ...(binding.nativeHost ? [`Native host: ${binding.nativeHost} (declared; not authenticated)`] : []),
    `Challenge ID: ${challenge.challengeId}`,
    `Task ID: ${binding.taskId}`,
    `Workspace: ${binding.workspacePath}`,
    `Scope: ${binding.approvedScope.join(', ') || '(empty)'}`,
    `Budget: ${JSON.stringify(binding.budget)}`,
    `Expires at (Unix ms): ${challenge.expiresAt}`,
    `Plan digest (SHA-256): ${binding.planDigest}`,
    `Approved Plan digest (SHA-256): ${binding.approvedPlanDigest}`,
    `Receipt digest (SHA-256): ${binding.receiptDigest}`,
    `Snapshot digest (SHA-256): ${binding.snapshotDigest}`
  ];
  if (bundle.plan?.managedExecutionPolicy === 'checkpoint_after_implementation') {
    lines.push('Managed execution stops after artifact application and awaits separate verification approval.');
  }
  if (binding.executionDigest) lines.push(`Execution digest (SHA-256): ${binding.executionDigest}`);

  if (gitlessChallenge) {
    const expectedKind = `${binding.executionKind}_gitless`;
    const expectedGitlessBinding = buildAgentApprovalBinding(bundle, cwd, expectedKind,
      binding.budget, gitlessChallenge.executionDigest);
    if (gitlessChallenge.parentChallengeId !== challenge.challengeId ||
        gitlessChallenge.executionKind !== expectedKind ||
        gitlessChallenge.taskId !== expectedGitlessBinding.taskId ||
        gitlessChallenge.workspace !== expectedGitlessBinding.workspacePath ||
        !isDeepStrictEqual(gitlessChallenge.approvedScope, expectedGitlessBinding.approvedScope) ||
        !isDeepStrictEqual(gitlessChallenge.budget, expectedGitlessBinding.budget) ||
        gitlessChallenge.planDigest !== expectedGitlessBinding.planDigest ||
        gitlessChallenge.approvedPlanDigest !== expectedGitlessBinding.approvedPlanDigest ||
        gitlessChallenge.receiptDigest !== expectedGitlessBinding.receiptDigest ||
        gitlessChallenge.snapshotDigest !== expectedGitlessBinding.snapshotDigest ||
        !Number.isSafeInteger(gitlessChallenge.expiresAt) || gitlessChallenge.expiresAt <= Date.now()) {
      throw new Error('agent_gitless_challenge_bundle_mismatch');
    }
    lines.push('Separate Git-less consent: explicitly required; it grants only the Git check exception.');
    lines.push(`Git-less execution kind: ${gitlessChallenge.executionKind}`);
    lines.push(`Git-less challenge ID: ${gitlessChallenge.challengeId}`);
    lines.push(`Git-less expires at (Unix ms): ${gitlessChallenge.expiresAt}`);
    lines.push(`Git-less Execution digest (SHA-256): ${gitlessChallenge.executionDigest}`);
  } else {
    lines.push('Separate Git-less consent: not requested for this execution.');
  }
  lines.push('This consent does not grant Provider budget or semantic-review opt-in.');
  return lines.join('\n');
}

function consumeAgentApprovalChallenge(bundle, cwd, executionKind, budget, challengeId, executionDigest = null, now = Date.now()) {
  const binding = buildAgentApprovalBinding(bundle, cwd, executionKind, budget, executionDigest);
  const { ExecutionHistoryStore } = require('../core/allocation/execution_history_store');
  const store = new ExecutionHistoryStore({ cwd: binding.workspacePath });
  try {
    const result = store.consumeApprovalChallenge({ ...binding, challengeId, now });
    return result.ok ? { ...result, binding } : result;
  } finally {
    store.close();
  }
}

function reportedAgentApproval(challengeId, binding) {
  return {
    source: 'reported_by_agent', challengeId,
    executionKind: binding.executionKind,
    ...(binding.nativeHost ? { nativeHost: binding.nativeHost, nativeExecutionKind: binding.nativeExecutionKind } : {}),
    decision: 'APPROVE',
    taskId: binding.taskId,
    planDigest: binding.planDigest,
    approvedPlanDigest: binding.approvedPlanDigest,
    receiptDigest: binding.receiptDigest,
    snapshotDigest: binding.snapshotDigest,
    workspacePath: binding.workspacePath,
    approvedScope: binding.approvedScope,
    budget: binding.budget,
    executionDigest: binding.executionDigest,
    reportedAt: new Date().toISOString()
  };
}

function gitlessExecutionLinkDigest(parentChallengeId, parentExecutionDigest) {
  return diagnosticCrypto.createHash('sha256')
    .update(JSON.stringify({ parentChallengeId, parentExecutionDigest: parentExecutionDigest || null }))
    .digest('hex');
}

function prepareAgentGitlessAuthorization(bundle, cwd, parentExecutionKind, budget, parentChallengeId,
  parentExecutionDigest = null, now = Date.now()) {
  const { CodexAdapter } = require('../core/allocation/adapters/codex_adapter');
  const adapter = new CodexAdapter();
  if (!adapter.isGitlessWorkspace(cwd)) return { required: false };
  const executionKind = `${parentExecutionKind}_gitless`;
  const challengeId = diagnosticCrypto.randomUUID();
  const executionDigest = gitlessExecutionLinkDigest(parentChallengeId, parentExecutionDigest);
  const binding = buildAgentApprovalBinding(bundle, cwd, executionKind, budget, executionDigest);
  const adapterBinding = {
    ...binding, challengeId, parentChallengeId, parentExecutionKind, parentExecutionDigest
  };
  // Run Adapter's normal workspace/Plan validation before persisting or displaying the challenge.
  adapter.createGitlessWorkspaceAuthorizationChallenge(bundle.approvedPlanSnapshot, cwd, adapterBinding);
  const persisted = createAgentApprovalChallenge(bundle, cwd, executionKind, budget, executionDigest, now, challengeId);
  if (!persisted.ok) throw new Error(persisted.reason || 'gitless_challenge_store_unavailable');
  return {
    required: true,
    challenge: { challengeId, expiresAt: persisted.expiresAt, executionKind,
      parentChallengeId, taskId: binding.taskId, workspace: binding.workspacePath,
      planDigest: binding.planDigest, approvedPlanDigest: binding.approvedPlanDigest,
      receiptDigest: binding.receiptDigest, snapshotDigest: binding.snapshotDigest,
      approvedScope: binding.approvedScope, budget, executionDigest },
    adapterBinding
  };
}

function consumeAgentGitlessAuthorization(bundle, cwd, parentExecutionKind, budget, parentChallengeId,
  parentExecutionDigest, challengeId, now = Date.now()) {
  const executionKind = `${parentExecutionKind}_gitless`;
  const executionDigest = gitlessExecutionLinkDigest(parentChallengeId, parentExecutionDigest);
  const consumed = consumeAgentApprovalChallenge(bundle, cwd, executionKind, budget, challengeId, executionDigest, now);
  return consumed.ok ? { ...consumed, parentChallengeId, parentExecutionKind, parentExecutionDigest } : consumed;
}

function reportedAgentGitlessApproval(challengeId, parentChallengeId, parentExecutionKind, parentExecutionDigest, binding) {
  return {
    source: 'reported_by_agent', challengeId, parentChallengeId,
    executionKind: binding.executionKind, parentExecutionKind,
    decision: 'APPROVE', taskId: binding.taskId,
    planDigest: binding.planDigest, approvedPlanDigest: binding.approvedPlanDigest,
    receiptDigest: binding.receiptDigest, snapshotDigest: binding.snapshotDigest,
    workspacePath: binding.workspacePath, approvedScope: binding.approvedScope,
    budget: binding.budget, executionDigest: binding.executionDigest,
    parentExecutionDigest: parentExecutionDigest || null,
    reportedAt: new Date().toISOString()
  };
}

async function promptDiagnosticAuthorization(binding, options = {}) {
  const output = options.output || process.stdout;
  output.write(`\nONE-TIME DIAGNOSTIC MODEL ATTESTATION\nTask: ${binding.taskId}\nWorkspace: ${binding.workspace}\nReceipt SHA-256: ${binding.receiptDigest}\nSnapshot SHA-256: ${binding.snapshotDigest}\nProvider: codex\nAdapter calls: max 1 | Recovery: 0 | Planner calls: 0\nType exactly: ${formatDiagnosticConfirmation(binding)}\n> `);
  const input = options.input || process.stdin;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, terminal: Boolean(input.isTTY && output.isTTY) });
    let answered = false;
    rl.once('line', (line) => {
      answered = true;
      resolve(line.trim());
      rl.close();
    });
    rl.once('close', () => {
      if (!answered) resolve(null);
    });
  });
}

function formatImportedPlanForApproval(snapshot) {
  const { normalizePlanLocale } = require('../core/workflow/plan_display');
  const planLocale = normalizePlanLocale(snapshot.runtimeSnapshot && snapshot.runtimeSnapshot.planLocale);
  const files = Array.isArray(snapshot.filesToModify) ? snapshot.filesToModify : [];
  const criteria = Array.isArray(snapshot.acceptanceCriteria) ? snapshot.acceptanceCriteria : [];
  const roles = Object.entries(snapshot.allocations || {}).map(([role, allocation]) => {
    const model = allocation && allocation.model ? allocation.model : (planLocale === 'fa' ? 'تخصیص نیافته' : 'not allocated');
    const roleName = planLocale === 'fa'
      ? ({ planner: 'برنامه‌ریز', coder: 'پیاده‌ساز', tester: 'آزمون‌گر', critic: 'منتقد', recovery: 'بازیابی' }[role] || role)
      : role;
    return `- ${roleName}: ${model}`;
  });
  if (planLocale === 'fa') {
    return [
      snapshot.userVisiblePlan || '',
      '',
      '## جزئیات Snapshot طرح واردشده',
      `هدف: ${snapshot.goal || ''}`,
      `سطح ریسک: ${{ low: 'کم', medium: 'متوسط', high: 'زیاد' }[snapshot.riskTier] || snapshot.riskTier || 'مشخص نشده'}`,
      'فایل‌های قابل تغییر:',
      ...(files.length > 0 ? files.map((file) => `- ${file}`) : ['- هیچ‌کدام']),
      'معیارهای پذیرش:',
      ...(criteria.length > 0 ? criteria.map((criterion) => `- ${criterion}`) : ['- هیچ‌کدام']),
      ...(Array.isArray(snapshot.reportingRequirements) && snapshot.reportingRequirements.includes('criterion_matrix_v1')
        ? ['الزام گزارش: ماتریس معیارها با وضعیت و ارجاع عیناً مطابق خروجی Critic؛ گزارش ناقص، تحویل موفق نیست.'] : []),
      'مدل‌های تخصیص‌یافته به نقش‌ها:',
      ...(roles.length > 0 ? roles : ['- هیچ‌کدام'])
    ].join('\n');
  }
  return [
    snapshot.userVisiblePlan || '',
    '',
    '## Imported Plan Snapshot Details',
    `Goal: ${snapshot.goal || ''}`,
    `Risk tier: ${snapshot.riskTier || 'unspecified'}`,
    'Files to modify:',
    ...(files.length > 0 ? files.map((file) => `- ${file}`) : ['- none']),
    'Acceptance criteria:',
    ...(criteria.length > 0 ? criteria.map((criterion) => `- ${criterion}`) : ['- none']),
    ...(Array.isArray(snapshot.reportingRequirements) && snapshot.reportingRequirements.includes('criterion_matrix_v1')
      ? ['Final reporting requirement: criterion matrix must match Critic statuses and evidence references exactly; incomplete report is not successful delivery.'] : []),
    'Allocated role models:',
    ...(roles.length > 0 ? roles : ['- none'])
  ].join('\n');
}

function validateImportedPlanBundle(bundle, { cwd, taskPrompt, provider, planLocale, nativeHost }) {
  if (!bundle || typeof bundle !== 'object' || bundle.ok !== true) {
    return { valid: false, error: 'Plan bundle must be a successful `core plan --json` result.' };
  }
  const snapshot = bundle.approvedPlanSnapshot;
  const receipt = bundle.planReceipt || bundle.receipt;
  const planAllocations = bundle.planAllocations;
  const runtimeConfig = bundle.runtimeConfig;
  if (!snapshot || !bundle.task || !bundle.plan || !planAllocations || !runtimeConfig || !receipt) {
    return { valid: false, error: 'Plan bundle is incomplete; Snapshot, plan, allocations, runtime configuration, task, and Receipt are required.' };
  }
  if ((bundle.planReceipt && bundle.receipt) && bundle.planReceipt !== bundle.receipt) {
    return { valid: false, error: 'Plan bundle contains conflicting Receipt fields.' };
  }
  if (typeof bundle.task.userPrompt !== 'string' || bundle.task.userPrompt.trim() !== taskPrompt.trim()) {
    return { valid: false, error: 'Task Prompt does not match the imported Plan bundle.' };
  }
  const native = runtimeConfig.executionKind === 'native';
  if (bundle.plan.managedExecutionPolicy !== undefined &&
      (native || provider !== 'codex' || bundle.plan.managedExecutionPolicy !== 'checkpoint_after_implementation' ||
       runtimeConfig.modelSwitchingEnabled !== false || !bundle.plan.verificationContract?.fileStates ||
       bundle.plan.verificationContract.fileStates.operations?.length !== 0 || bundle.plan.semanticCriticReview)) {
    return { valid: false, error: 'Unsupported managed checkpoint policy or execution configuration.' };
  }
  if (native) {
    const identities = [runtimeConfig, bundle.plan, snapshot, snapshot.runtimeSnapshot, planAllocations, bundle.agentExecutionPlan];
    if (!nativeExecutorForHost(nativeHost) || provider !== undefined && provider !== null ||
        identities.some(value => !value || value.executionKind !== 'native' || value.nativeHost !== nativeHost) ||
        runtimeConfig.provider !== null || runtimeConfig.providerModel !== null ||
        runtimeConfig.modelSwitchingEnabled !== false || runtimeConfig.selectedModel !== null ||
        planAllocations.providerId !== null || !samePlanJson(planAllocations.allocations, {}) ||
        !bundle.plan.verificationContract?.fileStates ||
        bundle.plan.semanticCriticReview !== undefined || bundle.plan.modelRecommendation !== null ||
        !samePlanJson(bundle.agentExecutionPlan, require('../core/workflow/plan_display').buildAgentExecutionPlan({ executionKind: 'native', nativeHost }))) {
      return { valid: false, reason: 'native_host_contract_mismatch', error: 'Native host, route, Provider or allocation contract mismatch.' };
    }
  } else if (nativeHost !== undefined || [bundle.plan, snapshot, snapshot.runtimeSnapshot, planAllocations].some(value =>
      value && (value.executionKind !== undefined || value.nativeHost !== undefined))) {
    return { valid: false, reason: 'native_host_contract_mismatch', error: 'Native identity requires its explicit Native contract.' };
  }
  if (!native && (runtimeConfig.provider !== provider || planAllocations.providerId !== provider)) {
    return { valid: false, error: 'Provider does not match the imported Plan allocation.' };
  }

  const { normalizePlanLocale } = require('../core/workflow/plan_display');
  const snapshotRuntime = snapshot.runtimeSnapshot || {};
  let bundleLocale;
  try {
    bundleLocale = normalizePlanLocale(runtimeConfig.planLocale);
    const localeFields = [bundle.plan.planLocale, runtimeConfig.planLocale, snapshotRuntime.planLocale];
    if (localeFields.some((value) => value !== undefined) &&
        (localeFields.some((value) => value === undefined) || localeFields.some((value) => value !== bundleLocale))) {
      return { valid: false, error: 'Plan locale differs across Plan, runtime configuration, and Snapshot.', reason: 'plan_locale_mismatch' };
    }
    if (planLocale !== undefined && normalizePlanLocale(planLocale) !== bundleLocale) {
      return { valid: false, error: 'Requested Plan locale differs from the approved Plan bundle.', reason: 'plan_locale_mismatch' };
    }
  } catch (error) {
    return { valid: false, error: error.message, reason: 'invalid_plan_locale' };
  }

  const { validatePlanReceipt } = require('../core/workflow/plan_receipt');
  const receiptValidation = validatePlanReceipt(receipt, {
    cwd,
    taskPrompt,
    task: bundle.task,
    plan: bundle.plan,
    planAllocations,
    runtimeConfig,
    requireApprovedPlanDigest: true,
    ...(native ? { nativeHost } : {})
  });
  if (!receiptValidation.valid) {
    return { valid: false, error: receiptValidation.error || receiptValidation.reason, reason: receiptValidation.reason };
  }
  const semanticPolicy = bundle.plan.semanticCriticReview;
  const receiptSemanticPolicy = receiptValidation.payload.semanticCriticReview;
  if (semanticPolicy !== undefined) {
    if (!semanticPolicy || semanticPolicy.requested !== true || semanticPolicy.providerId !== 'codex' ||
        !Number.isSafeInteger(semanticPolicy.maxProviderCalls) || semanticPolicy.maxProviderCalls < 1 ||
        semanticPolicy.maxProviderCalls > 1000 || !samePlanJson(receiptSemanticPolicy, semanticPolicy)) {
      return { valid: false, error: 'Semantic Critic policy is invalid or differs from the bound Receipt.', reason: 'semantic_critic_policy_mismatch' };
    }
  } else if (receiptSemanticPolicy !== undefined) {
    return { valid: false, error: 'Receipt authorizes Semantic Critic but Plan does not.', reason: 'semantic_critic_policy_mismatch' };
  }

  const switchingPolicy = require('../core/allocation/model_switching_toggle').getModelSwitchingStatus({ cwd }).enabled;
  if (!native && runtimeConfig.modelSwitchingEnabled === true && switchingPolicy === false) {
    return {
      valid: false,
      error: 'This Plan was created with Automatic Model Switching enabled, which is frozen for V1. Re-plan and obtain fresh Approval; the existing Receipt and Snapshot were not altered.',
      reason: 'model_switching_feature_disabled'
    };
  }

  const allocations = planAllocations.allocations || {};
  const providerModel = typeof runtimeConfig.providerModel === 'string' && runtimeConfig.providerModel.trim()
    ? runtimeConfig.providerModel.trim()
    : null;
  if (providerModel !== ((allocations.coder && allocations.coder.model) || null)) {
    return {
      valid: false,
      error: 'The Plan Provider model does not match its executable Coder allocation. Re-plan and obtain fresh Approval; the existing Plan and Receipt were not changed.',
      reason: 'provider_model_mismatch'
    };
  }
  const switchingEnabled = runtimeConfig.modelSwitchingEnabled === true;
  let currentLanguages = null;
  try {
    const { getProjectLanguages } = require('../core/languages');
    currentLanguages = getProjectLanguages({ cwd });
  } catch {}
  const snapshotChecks = {
    receipt: snapshot.planReceipt === receipt,
    taskId: snapshot.taskId === bundle.task.id,
    task: samePlanJson(snapshot.task, bundle.task),
    goal: snapshot.goal === bundle.plan.goal,
    riskTier: snapshot.riskTier === bundle.plan.riskTier,
    affectedLayers: samePlanJson(snapshot.affectedLayers, bundle.plan.affectedLayers || []),
    plan: samePlanJson(snapshot.plan, bundle.plan),
    userVisiblePlan: snapshot.userVisiblePlan === bundle.userVisiblePlan,
    planVisibleText: snapshot.plan.userVisiblePlan === bundle.userVisiblePlan,
    agentExecutionPlan: samePlanJson(snapshot.agentExecutionPlan, bundle.agentExecutionPlan),
    planExecutionRoles: samePlanJson(snapshot.plan.agentExecutionPlan, bundle.agentExecutionPlan),
    filesToModify: samePlanJson(snapshot.filesToModify, bundle.plan.filesToModify),
    acceptanceCriteria: samePlanJson(snapshot.acceptanceCriteria, bundle.plan.acceptanceCriteria),
    reportingRequirements: samePlanJson(snapshot.reportingRequirements || [], bundle.plan.reportingRequirements || []) &&
      (!bundle.plan.reportingRequirements || (Array.isArray(bundle.plan.reportingRequirements) &&
        bundle.plan.reportingRequirements.every((item) => item === 'criterion_matrix_v1'))),
    allocations: samePlanJson(snapshot.allocations, allocations),
    providerModel: snapshot.providerModel === providerModel,
    coderConfig: samePlanJson(snapshot.coderConfig, allocations.coder || null),
    plannerConfig: samePlanJson(snapshot.plannerConfig, allocations.planner || null),
    modelSwitchingEnabled: snapshotRuntime.modelSwitchingEnabled === switchingEnabled,
    coderModel: snapshotRuntime.coderModel === ((allocations.coder && allocations.coder.model) || null),
    plannerModel: snapshotRuntime.plannerModel === ((allocations.planner && allocations.planner.model) || null),
    languages: samePlanJson(snapshotRuntime.languages, Array.isArray(currentLanguages) ? currentLanguages : null),
    selectedModel: snapshotRuntime.selectedModel === null,
    runtimeProviderModel: snapshotRuntime.providerModel === providerModel
  };
  const contractParts = [bundle.plan.verificationContract, snapshot.verificationContract,
    snapshot.plan && snapshot.plan.verificationContract, receiptValidation.payload.verificationContract];
  if (contractParts.some(part => part !== undefined)) {
    snapshotChecks.verificationContract = contractParts.every(part => part !== undefined)
      && contractParts.every(part => samePlanJson(part, contractParts[0]));
  }
  const mismatchedSnapshotFields = Object.keys(snapshotChecks).filter((field) => !snapshotChecks[field]);
  if (mismatchedSnapshotFields.length > 0) {
    return {
      valid: false,
      error: `Plan Snapshot does not match the bundle in these fields: ${mismatchedSnapshotFields.join(', ')}.${mismatchedSnapshotFields.includes('languages') ? ` Snapshot languages=${JSON.stringify(snapshotRuntime.languages)}; current languages=${JSON.stringify(Array.isArray(currentLanguages) ? currentLanguages : null)}.` : ''}`,
      reason: 'snapshot_mismatch'
    };
  }

  if (!isDeepFrozenValue(snapshot)) deepFreezePlanValue(snapshot);
  return { valid: true, snapshot, receipt: receiptValidation.payload };
}

// Shared by the actual Native Approval path and its offline integration tests.
function fingerprintNativeApproval(targetDir, binding) {
  if (!binding || binding.valid !== true || !binding.snapshot) {
    return { ok: false, reason: 'invalid_native_plan' };
  }
  return require('../core/workflow/verify_record').digestApprovedFiles(
    targetDir, binding.snapshot.filesToModify, binding.snapshot.verificationContract);
}

function buildApprovedHistoryMetadata(bundle, { cwd, taskPrompt, provider, nativeHost }) {
  const binding = validateImportedPlanBundle(bundle, { cwd, taskPrompt, provider, nativeHost });
  if (!binding.valid) return null;
  const scope = binding.snapshot.filesToModify;
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > 64 ||
      scope.some(file => typeof file !== 'string' || file.length > 255 ||
        path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) return null;
  const title = binding.snapshot.plan.historyTitle || null;
  return Object.freeze({
    ...(binding.receipt.executionKind === 'native' ? { executionKind: 'native', nativeHost: binding.receipt.nativeHost } : {}),
    taskId: binding.receipt.taskId,
    workspacePath: binding.receipt.workspacePath,
    planDigest: binding.receipt.planDigest,
    approvedPlanDigest: binding.receipt.approvedPlanDigest,
    title,
    approvedScope: Object.freeze([...scope])
  });
}

function buildCriterionReport(plan, semanticReview, leaderDecision) {
  const required = Array.isArray(plan && plan.reportingRequirements) && plan.reportingRequirements.includes('criterion_matrix_v1');
  const acceptanceCriteria = Array.isArray(plan && plan.acceptanceCriteria) ? plan.acceptanceCriteria : [];
  const sourceRows = Array.isArray(semanticReview && semanticReview.criteria) ? semanticReview.criteria : [];
  const byIndex = new Map();
  let valid = true;
  for (const item of sourceRows) {
    if (!item || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= acceptanceCriteria.length || byIndex.has(item.index)) {
      valid = false;
      continue;
    }
    byIndex.set(item.index, item);
  }
  const rows = acceptanceCriteria.map((criterion, index) => {
    const source = byIndex.get(index);
    const validSource = source && source.criterion === criterion &&
      ['CONFIRMED', 'FAILED', 'UNREVIEWED'].includes(source.status) && Array.isArray(source.evidenceRefs) &&
      typeof source.method === 'string' && source.method.trim() &&
      typeof source.confidence === 'string' && source.confidence.trim() &&
      typeof source.coderCorrectable === 'boolean' &&
      (source.status === 'CONFIRMED' || (typeof source.limitation === 'string' && source.limitation.trim())) &&
      (source.status === 'UNREVIEWED' || source.evidenceRefs.length > 0);
    if (!validSource) valid = false;
    return validSource
      ? { index, criterion, status: source.status, evidenceRefs: [...source.evidenceRefs], method: source.method,
        confidence: source.confidence, coderCorrectable: source.coderCorrectable, limitation: source.limitation || null }
      : { index, criterion, status: 'UNKNOWN', evidenceRefs: [], method: null, confidence: null,
        coderCorrectable: null, limitation: 'No matching valid Critic result was available; no status or evidence was inferred.' };
  });
  if (sourceRows.length !== acceptanceCriteria.length) valid = false;
  const report = { requirement: required ? 'criterion_matrix_v1' : 'NOT_REQUIRED',
    completeness: !required || valid ? 'COMPLETE' : 'INCOMPLETE', rows, deliverySuccess: false };
  report.deliverySuccess = report.completeness === 'COMPLETE' && Boolean(leaderDecision && leaderDecision.success === true);
  return report;
}

function validateCriterionReport(report, plan, semanticReview) {
  if (!report || !Array.isArray(report.rows)) return false;
  const expected = buildCriterionReport(plan, semanticReview, null);
  return report.completeness === expected.completeness && JSON.stringify(report.rows) === JSON.stringify(expected.rows);
}

/** Persist an opt-in Native Plan without writing to the protected .agents tree. */
function formatNativeVerificationSummary(result, planBundle = null) {
  const unknown = 'Unknown';
  const outcome = result && result.outcome;
  const attempt = result && result.attempt;
  const semantic = outcome && outcome.semanticReview
    ? outcome.semanticReview
    : attempt && attempt.semantic_review
      ? attempt.semantic_review
      : attempt && attempt.semantic_review_json
        ? (typeof attempt.semantic_review_json === 'string'
          ? (() => { try { return JSON.parse(attempt.semantic_review_json); } catch { return null; } })()
          : attempt.semantic_review_json)
        : null;
  const leader = outcome && outcome.leaderDecision
    ? outcome.leaderDecision
    : attempt && attempt.leader_decision_json
      ? (typeof attempt.leader_decision_json === 'string'
        ? (() => { try { return JSON.parse(attempt.leader_decision_json); } catch { return null; } })()
        : attempt.leader_decision_json)
      : null;
  const semanticStatus = semantic && semantic.status
    ? semantic.status
    : (attempt && attempt.semantic_review_status) || unknown;
  const semanticReason = semantic && semantic.reason
    ? semantic.reason
    : unknown;
  const semanticProvenance = semantic && semantic.provenance
    ? semantic.provenance
    : unknown;
  const leaderStatus = leader
    ? (leader.success === true ? 'SUCCESS' : leader.success === false ? 'FAILED' : unknown)
    : unknown;
  const leaderSemanticStatus = leader && leader.semanticStatus || unknown;
  const plan = planBundle && (planBundle.plan || planBundle.approvedPlanSnapshot && planBundle.approvedPlanSnapshot.plan);
  const criterionReport = plan ? buildCriterionReport(plan, semantic, leader) : null;
  const semanticRequested = semanticStatus === 'NOT_REQUESTED';
  const budget = result && result.receipt && result.receipt.semanticCriticReview;
  let budgetText = unknown;
  if (budget && Number.isSafeInteger(budget.maxProviderCalls)) {
    const reserved = semantic && typeof semantic.providerCallReserved === 'boolean'
      ? Number(semantic.providerCallReserved) : unknown;
    budgetText = `${reserved}/${budget.maxProviderCalls}`;
  } else if (semanticRequested) {
    budgetText = '0/0 (semantic review not requested)';
  }
  const subprocessStatus = semantic && semantic.providerSubprocessInvoked === true
    ? 'STARTED'
    : semantic && semantic.providerSubprocessInvoked === false ? 'NOT STARTED' : unknown;
  const lines = [
    `Native Core-observed Verification: ${result && result.alreadyRecorded && !outcome ? 'PRIOR RECORD (NO CHECKS RUN NOW)' : result && result.ok ? 'PASSED' : 'NOT VERIFIED'}`,
    `Leader decision: ${leaderStatus}; semantic status: ${leaderSemanticStatus}`,
    `Semantic Critic: ${semanticStatus}; provenance: ${semanticProvenance}; reason: ${semanticReason}`,
    `Semantic Critic budget reservation/limit: ${budgetText}`,
    `Semantic Critic Provider subprocess: ${subprocessStatus}`,
    ...(criterionReport && criterionReport.requirement === 'criterion_matrix_v1'
      ? [`Criterion report: ${criterionReport.completeness}; deliverySuccess: ${criterionReport.deliverySuccess}`,
        ...criterionReport.rows.map((row) => `Criterion ${row.index + 1}: ${row.status}; ${row.criterion}; evidence: ${row.evidenceRefs.length ? row.evidenceRefs.join(', ') : 'Unknown'}${row.method ? `; method: ${row.method}` : ''}${row.limitation ? `; limitation: ${row.limitation}` : ''}`)] : []),
    'Native execution: external Coder was not run by Core; Core Recovery did not run.',
    `Scope outside approved files: ${result && result.scopeOutsideApprovedFiles || unknown}.`
  ];
  return lines.join('\n');
}

function saveNativePlanBundle(bundle, cwd = process.cwd()) {
  const workspace = fs.realpathSync(cwd);
  if (!bundle || !bundle.task || !/^TASK-[0-9]+$/.test(bundle.task.id || '')) {
    throw new Error('Native Plan Bundle needs a generated Task ID.');
  }
  const binding = validateImportedPlanBundle(bundle, {
    cwd: workspace, taskPrompt: bundle.task.userPrompt,
    ...(bundle.runtimeConfig?.executionKind === 'native' ? { nativeHost: bundle.runtimeConfig.nativeHost } : { provider: 'codex' })
  });
  if (!binding.valid) throw new Error(`Native Plan Bundle is invalid: ${binding.error}`);

  const bundleDir = path.join(workspace, '.core-plan-bundles');
  const statIfPresent = (file) => {
    try { return fs.lstatSync(file); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  if (!statIfPresent(bundleDir)) fs.mkdirSync(bundleDir, { mode: 0o700 });
  const dirStat = fs.lstatSync(bundleDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() ||
      (dirStat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && dirStat.uid !== process.getuid()) ||
      fs.realpathSync(bundleDir) !== bundleDir) {
    throw new Error('Native Plan Bundle requires a private, non-symlink Workspace directory (0700).');
  }

  const ignoreFile = path.join(bundleDir, '.gitignore');
  const ignoreContent = '*\n!.gitignore\n';
  const ignoreStat = statIfPresent(ignoreFile);
  if (ignoreStat) {
    if (!ignoreStat.isFile() || ignoreStat.isSymbolicLink() ||
        (ignoreStat.mode & 0o777) !== 0o600 ||
        fs.readFileSync(ignoreFile, 'utf8') !== ignoreContent) {
      throw new Error('Native Plan Bundle directory has a different .gitignore; existing content was preserved.');
    }
  } else {
    fs.writeFileSync(ignoreFile, ignoreContent, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }

  const bundleFile = path.join(bundleDir, `${bundle.task.id}.json`);
  const savedBundle = { ...bundle, bundleFile };
  try {
    fs.writeFileSync(bundleFile, JSON.stringify(savedBundle, null, 2) + '\n', {
      encoding: 'utf8', flag: 'wx', mode: 0o600
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Native Plan Bundle already exists and was not overwritten: ${bundleFile}`);
    }
    throw error;
  }
  return savedBundle;
}

function createNativePreEditBackup(targetDir, bundle, { nativeHost } = {}) {
  const failure = reason => ({ ok: false, status: 'NATIVE_BACKUP_FAILED', reason,
    agentAction: 'stop_before_native_edit', hostApproval: 'external_unverified', writeToolControl: 'not_controlled' });
  try {
    const workspace = fs.realpathSync(targetDir);
    if (!bundle || !bundle.task || typeof bundle.task.userPrompt !== 'string') return failure('invalid_native_plan_bundle');
    const validated = validateImportedPlanBundle(bundle, { cwd: workspace,
      taskPrompt: bundle.task.userPrompt,
      ...(nativeHost !== undefined || bundle.runtimeConfig?.executionKind === 'native' ? { nativeHost } : { provider: 'codex' }) });
    if (!validated.valid) return failure('invalid_native_plan_bundle');
    const { sha256Digest, canonicalize } = require('../core/workflow/plan_receipt');
    const snapshot = validated.snapshot;
    const binding = {
      ...(validated.receipt.executionKind === 'native' ? { executionKind: 'native', nativeHost: validated.receipt.nativeHost } : {}),
      workspace, taskId: validated.receipt.taskId, approvedPlanDigest: validated.receipt.approvedPlanDigest,
      receiptDigest: sha256Digest(snapshot.planReceipt), snapshotDigest: sha256Digest(canonicalize(snapshot)),
      verificationContractDigest: sha256Digest(canonicalize(snapshot.verificationContract || null)),
      scope: [...snapshot.filesToModify]
    };
    const { persistNativePreEditBaseline } = require('../core/workflow/project_artifact_extractor');
    const saved = persistNativePreEditBaseline(workspace, snapshot, binding);
    return { ok: true, status: 'NATIVE_BACKUP_VERIFIED', ...saved, binding,
      hostApproval: 'external_unverified', writeToolControl: 'not_controlled', snapshotOnly: true };
  } catch (error) {
    // File contents, prompts and raw exception output never enter the report.
    const reason = error && /^[a-z][a-z0-9_]+$/.test(error.message || '') ? error.message : 'backup_io_error';
    return failure(reason);
  }
}

/**
 * Handles an unrecoverable or controlled failure in the Core workflow with explicit user choices.
 *
 * @param {object} failure Structured failure object
 * @param {object} task Task definition
 * @param {object} engine CoreWorkflowEngine instance
 * @param {object} [options]
 * @param {object} [planSnapshot]
 * @returns {Promise<object>}
 */
async function handleTaskFailure(failure, task, engine, options = {}, planSnapshot = null) {
  const {
    formatFailurePrompt,
    promptFailureDecision,
    normalizeFailureDecision,
    buildFailureContract,
    FAILURE_DECISIONS
  } = require('../core/workflow');

  const rawFailureContract = (failure && failure.failureCode && failure.status === 'FAILED')
    ? failure
    : buildFailureContract(failure || {});
  const failureContract = rawFailureContract.projectStateEvidence
    ? rawFailureContract
    : Object.freeze({ ...rawFailureContract, projectStateSafe: null, projectState: 'Unknown' });

  // 1. Resolve user action decision (options override or prompt)
  let decision = normalizeFailureDecision(options.failureDecision);
  if (!decision && options.failureDecision === undefined) {
    decision = await promptFailureDecision(failureContract, options);
  }

  // 2. Act strictly upon decision
  if (decision === FAILURE_DECISIONS.RETRY) {
    const currentRetryCount = (options._failureRetryCount || 0) + 1;
    const maxRetries = options.maxFailureRetries !== undefined ? options.maxFailureRetries : 1;

    if (failureContract.retryable === false) {
      const reasonMsg = failureContract.retryUnavailableReason || 'Condition cannot be resolved automatically by retry.';
      const msg = `Retry unavailable: ${reasonMsg}`;
      if (options.output && typeof options.output.write === 'function') {
        options.output.write(`\n${msg}\n\n`);
      } else {
        console.log(`\n${msg}\n`);
      }

      // If non-interactive decision was provided or no input stream available, cancel cleanly
      if (options.failureDecision || !options.input) {
        return engine.cancelTask({
          task,
          failure: failureContract,
          sandboxDir: options.sandboxDir,
          options
        });
      }

      // Re-prompt user with retry unavailable for Bypass/Cancel
      const nextDecision = await promptFailureDecision({
        ...failureContract,
        retryable: false
      }, options);

      if (nextDecision === FAILURE_DECISIONS.BYPASS) {
        return engine.continueWithoutCore({
          task,
          plan: planSnapshot,
          failure: failureContract,
          sandboxDir: options.sandboxDir,
          options
        });
      }
      return engine.cancelTask({
        task,
        failure: failureContract,
        sandboxDir: options.sandboxDir,
        options
      });
    }

    if (currentRetryCount > maxRetries) {
      const msg = `Retry unavailable: maximum retry attempts (${maxRetries}) exceeded`;
      if (options.output && typeof options.output.write === 'function') {
        options.output.write(`\n${msg}\n\n`);
      } else {
        console.log(`\n${msg}\n`);
      }
      return engine.cancelTask({
        task,
        failure: {
          ...failureContract,
          retryable: false,
          retryUnavailableReason: `maximum retry attempts (${maxRetries}) exceeded`
        },
        sandboxDir: options.sandboxDir,
        options
      });
    }

    if (options.output && typeof options.output.write === 'function') {
      options.output.write(`\nRetrying with Core (attempt ${currentRetryCount}/${maxRetries}; starting a fresh per-run Provider-call budget)...\n\n`);
    } else {
      console.log(`\nRetrying with Core (attempt ${currentRetryCount}/${maxRetries}; starting a fresh per-run Provider-call budget)...\n`);
    }

    const retryOptions = {
      ...options,
      approvalDecision: undefined,
      approvedPlanSnapshot: undefined,
      _failureRetryCount: currentRetryCount,
      failureDecision: undefined
    };

    return runTaskCommand(task ? task.userPrompt : '', retryOptions);
  } else if (decision === FAILURE_DECISIONS.BYPASS) {
    if (options.output && typeof options.output.write === 'function') {
      options.output.write('\nContinuing without Core. Orchestration bypassed cleanly.\n');
    } else {
      console.log('\nContinuing without Core. Orchestration bypassed cleanly.');
    }
    return engine.continueWithoutCore({
      task,
      plan: planSnapshot,
      failure: failureContract,
      sandboxDir: options.sandboxDir,
      options
    });
  } else if (decision === FAILURE_DECISIONS.CANCEL) {
    if (options.output && typeof options.output.write === 'function') {
      options.output.write('\nTask cancelled by user. Core terminated cleanly.\n');
    } else {
      console.log('\nTask cancelled by user. Core terminated cleanly.');
    }
    return engine.cancelTask({
      task,
      failure: failureContract,
      sandboxDir: options.sandboxDir,
      options
    });
  } else {
    // Invalid or no input: do not silently retry or approve anything!
    if (options.output && typeof options.output.write === 'function') {
      options.output.write('\nInvalid or no decision provided. Task cancelled cleanly.\n');
    } else {
      console.log('\nInvalid or no decision provided. Task cancelled cleanly.');
    }
    return engine.cancelTask({
      task,
      failure: failureContract,
      sandboxDir: options.sandboxDir,
      options
    });
  }
}

/**
 * Executes a task through the Core workflow with mandatory pre-execution approval gate.
 *
 * @param {string} taskPrompt
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runTaskCommand(taskPrompt, options = {}) {
  const {
    CoreWorkflowEngine,
    buildFailureContract,
    CORE_FAILURE_CODES,
    FAILURE_STAGES
  } = require('../core/workflow');
  const { resolveProviderId, assertAdapterProvider } = require('../core/allocation/execution_handoff');
  const { normalizePlanLocale } = require('../core/workflow/plan_display');
  const targetDir = options.cwd || process.cwd();
  try {
    normalizePlanLocale(options.planLocale);
  } catch (error) {
    return {
      status: 'FAILED', failureCode: 'INVALID_PLAN_LOCALE', terminationReason: 'INVALID_PLAN_LOCALE',
      message: error.message, retryable: false, projectStateSafe: true
    };
  }
  const diagnosticMode = options.diagnosticAttestation === true;
  if (diagnosticMode && (!options.planBundleFile && !options.planBundle || options.provider !== 'codex' ||
      options.maxProviderCalls !== 1 || options.maxRecoveryAttempts !== 0)) {
    return {
      status: 'FAILED', failureCode: 'DIAGNOSTIC_CONFIGURATION_INVALID',
      terminationReason: 'DIAGNOSTIC_CONFIGURATION_INVALID',
      message: 'Diagnostic mode requires the imported approved Codex Plan, exactly one Adapter call and zero Recovery attempts.',
      retryable: false, projectStateSafe: true
    };
  }

  if (options.managedExecutionPolicy !== undefined || options.managedCheckpointInput !== undefined) {
    return { status: 'FAILED', failureCode: 'MANAGED_POLICY_OVERRIDE', engineStarted: false };
  }
  let managedBundleEvidence;
  let importedPlanBundle = null;
  if (options.planBundleFile || options.planBundle) {
    if (options.historyTitle !== undefined) {
      return {
        status: 'FAILED', failureCode: 'INVALID_PLAN_BUNDLE', terminationReason: 'INVALID_PLAN_BUNDLE',
        message: 'An imported Plan already fixes its history title. Create a fresh Plan to change it.',
        retryable: false, projectStateSafe: true
      };
    }
    try {
      const bytes = options.planBundle ? null : fs.readFileSync(path.resolve(options.planBundleFile));
      importedPlanBundle = options.planBundle || JSON.parse(bytes.toString('utf8'));
      if (importedPlanBundle.plan?.managedExecutionPolicy !== undefined) {
        if (!bytes || diagnosticMode) throw new Error('Checkpoint policy requires an original saved managed Bundle.');
        const bundleFile = fs.realpathSync(options.planBundleFile);
        if (importedPlanBundle.bundleFile !== bundleFile) throw new Error('Managed Bundle path mismatch.');
        managedBundleEvidence = {
          bundleFile,
          bundleDigest: require('node:crypto').createHash('sha256').update(bytes).digest('hex')
        };
      }
    } catch (err) {
      return {
        status: 'FAILED',
        failureCode: 'INVALID_PLAN_BUNDLE',
        terminationReason: 'INVALID_PLAN_BUNDLE',
        message: 'Core rejected the imported Plan bundle before execution.',
        details: `Could not read or parse the Plan bundle: ${err.message}`,
        retryable: false,
        projectStateSafe: true
      };
    }

    if (options.approvedPlanSnapshot) {
      return {
        status: 'FAILED',
        failureCode: 'INVALID_PLAN_BUNDLE',
        terminationReason: 'INVALID_PLAN_BUNDLE',
        message: 'Core rejected conflicting Plan inputs before execution.',
        details: 'Provide either an imported Plan bundle or an in-process approvedPlanSnapshot, not both.',
        retryable: false,
        projectStateSafe: true
      };
    }

  }

  try {
    const { assertManagedCheckpointPolicyAvailable } = require('../core/workflow/core_workflow_engine');
    assertManagedCheckpointPolicyAvailable(importedPlanBundle?.plan?.managedExecutionPolicy);
    assertManagedCheckpointPolicyAvailable(
      (importedPlanBundle?.approvedPlanSnapshot || options.approvedPlanSnapshot)?.plan?.managedExecutionPolicy
    );
  } catch (error) {
    return { status: 'FAILED', failureCode: error.code, message: error.message,
      engineStarted: false, retryable: false, projectStateSafe: true };
  }
  const nativeInput = importedPlanBundle || { approvedPlanSnapshot: options.approvedPlanSnapshot };
  const nativeReceipt = nativeInput.planReceipt && require('../core/workflow/plan_receipt').validatePlanReceipt(nativeInput.planReceipt, { cwd: targetDir });
  if ([nativeInput.runtimeConfig, nativeInput.plan, nativeInput.approvedPlanSnapshot, nativeReceipt && nativeReceipt.payload].some(value =>
      value && (value.executionKind === 'native' || value.nativeHost !== undefined))) {
    return { status: 'FAILED', failureCode: 'NATIVE_BUNDLE_NOT_EXECUTABLE', terminationReason: 'NATIVE_BUNDLE_NOT_EXECUTABLE',
      message: 'Native Bundles cannot enter Core-managed execution.', retryable: false, projectStateSafe: true };
  }
  let resolvedProvider;
  try {
    resolvedProvider = resolveProviderId([
      options.provider,
      options.adapter && options.adapter.providerId,
      importedPlanBundle && importedPlanBundle.runtimeConfig && importedPlanBundle.runtimeConfig.provider,
      importedPlanBundle && importedPlanBundle.planAllocations && importedPlanBundle.planAllocations.providerId
    ], { required: true });
    assertAdapterProvider(resolvedProvider, options.adapter);
  } catch (err) {
    return {
      status: 'FAILED',
      failureCode: 'PROVIDER_EXECUTION_FAILED',
      terminationReason: 'PROVIDER_EXECUTION_FAILED',
      message: 'Core rejected the task before Approval because its Core-managed Provider is unresolved or unsupported.',
      details: err.message,
      retryable: false,
      projectStateSafe: true
    };
  }

  if (importedPlanBundle) {
    const plannedProviderModel = (importedPlanBundle.runtimeConfig && importedPlanBundle.runtimeConfig.providerModel) || null;
    if (options.providerModel !== undefined && options.providerModel !== plannedProviderModel) {
      return {
        status: 'FAILED',
        failureCode: 'INVALID_PLAN_BUNDLE',
        terminationReason: 'INVALID_PLAN_BUNDLE',
        message: 'The requested Provider model differs from the approved Plan. Re-plan and obtain fresh Approval.',
        retryable: false,
        projectStateSafe: true
      };
    }
    const importedValidation = validateImportedPlanBundle(importedPlanBundle, {
      cwd: targetDir,
      taskPrompt,
      provider: resolvedProvider,
      planLocale: options.planLocale
    });
    if (!importedValidation.valid) {
      return {
        status: 'FAILED',
        failureCode: 'INVALID_PLAN_BUNDLE',
        terminationReason: 'INVALID_PLAN_BUNDLE',
        message: 'Core rejected the imported Plan bundle before execution.',
        details: importedValidation.error,
        retryable: false,
        projectStateSafe: true
      };
    }
    importedPlanBundle = { ...importedPlanBundle, approvedPlanSnapshot: importedValidation.snapshot };
  }

  let agentApprovalProvenance = null;
  let agentGitlessApprovalProvenance = null;
  let agentGitlessAdapterBinding = null;
  const agentApprovalRequest = options.agentMediatedApproval;
  if (agentApprovalRequest !== undefined && agentApprovalRequest !== null) {
    if (!importedPlanBundle || !agentApprovalRequest || typeof agentApprovalRequest !== 'object') {
      return { status: 'FAILED', failureCode: 'AGENT_APPROVAL_REQUIRES_IMPORTED_PLAN', engineStarted: false,
        message: 'Agent-mediated Approval requires the exact imported Plan Bundle.' };
    }
    const receiptPolicy = importedPlanBundle.planReceipt && require('../core/workflow/plan_receipt')
      .validatePlanReceipt(importedPlanBundle.planReceipt, { cwd: targetDir }).payload;
    const semanticCap = receiptPolicy && receiptPolicy.semanticCriticReview &&
      receiptPolicy.semanticCriticReview.requested === true ? receiptPolicy.semanticCriticReview.maxProviderCalls : null;
    const configuredCalls = Number.isSafeInteger(options.maxProviderCalls) ? options.maxProviderCalls : null;
    const providerCallLimit = Number.isSafeInteger(configuredCalls) && Number.isSafeInteger(semanticCap)
      ? Math.min(configuredCalls, semanticCap) : (configuredCalls === null ? semanticCap : configuredCalls);
    const { DEFAULT_MAX_RECOVERY_ATTEMPTS } = require('../core/workflow');
    const budget = {
      maxProviderCalls: providerCallLimit,
      maxRecoveryAttempts: Number.isSafeInteger(options.maxRecoveryAttempts) && options.maxRecoveryAttempts >= 0
        ? options.maxRecoveryAttempts : DEFAULT_MAX_RECOVERY_ATTEMPTS,
      semanticCriticMaxProviderCalls: semanticCap
    };
    const gitlessAdapterForPreflight = resolvedProvider === 'codex'
      ? new (require('../core/allocation/adapters/codex_adapter').CodexAdapter)() : null;
    let gitlessAuthorizationRequired = false;
    try {
      gitlessAuthorizationRequired = Boolean(gitlessAdapterForPreflight &&
        gitlessAdapterForPreflight.isGitlessWorkspace(targetDir));
    } catch {
      return { status: 'FAILED', failureCode: 'GITLESS_WORKSPACE_UNSAFE', engineStarted: false,
        message: 'Core could not validate the Git-less workspace before Approval.' };
    }
    if (agentApprovalRequest.mode === 'prepare') {
      try {
        const challenge = createAgentApprovalChallenge(importedPlanBundle, targetDir, 'core_run', budget);
        if (!challenge.ok) throw new Error(challenge.reason || 'challenge_store_unavailable');
        const gitless = gitlessAuthorizationRequired
          ? prepareAgentGitlessAuthorization(importedPlanBundle, targetDir, 'core_run', budget,
            challenge.challengeId, null)
          : { required: false };
        const consentText = formatAgentApprovalConsent(importedPlanBundle, targetDir, challenge,
          gitless.required ? gitless.challenge : null);
        return {
          status: 'AWAITING_AGENT_APPROVAL', approved: false, engineStarted: false,
          approvalProvenance: 'reported_by_agent (owner identity not independently authenticated)',
          consentText,
          challenge: {
            challengeId: challenge.challengeId, expiresAt: challenge.expiresAt,
            executionKind: 'core_run',
            taskId: challenge.binding.taskId, workspace: challenge.binding.workspacePath,
            approvedScope: challenge.binding.approvedScope,
            planDigest: challenge.binding.planDigest,
            approvedPlanDigest: challenge.binding.approvedPlanDigest,
            receiptDigest: challenge.binding.receiptDigest,
            snapshotDigest: challenge.binding.snapshotDigest, budget,
            gitlessAuthorizationRequired: gitless.required,
            ...(gitless.required ? { gitlessAuthorizationChallenge: gitless.challenge } : {}),
            gitlessAuthorizationGranted: false, providerBudgetGranted: false,
            consents: {
              coreExecution: 'separate explicit decision required',
              ...(gitless.required ? { gitlessWorkspaceException: 'separate explicit decision required' } : {})
            }
          }
        };
      } catch (error) {
        return { status: 'FAILED', failureCode: 'AGENT_APPROVAL_CHALLENGE_UNAVAILABLE', engineStarted: false,
          message: 'Core could not safely create the one-time Approval challenge.', details: error.message };
      }
    }
    if (agentApprovalRequest.mode !== 'consume' || !['APPROVE', 'REJECT'].includes(agentApprovalRequest.decision) ||
        typeof agentApprovalRequest.challengeId !== 'string') {
      return { status: 'FAILED', failureCode: 'AGENT_APPROVAL_ASSERTION_INVALID', engineStarted: false,
        message: 'Agent-mediated Approval assertion is missing a challenge or explicit APPROVE report.' };
    }
    const hasGitlessChallenge = typeof agentApprovalRequest.gitlessChallengeId === 'string' &&
      agentApprovalRequest.gitlessChallengeId.length > 0;
    if ((gitlessAuthorizationRequired && (!hasGitlessChallenge ||
        !['APPROVE', 'REJECT'].includes(agentApprovalRequest.gitlessDecision))) ||
        (!gitlessAuthorizationRequired && (hasGitlessChallenge || agentApprovalRequest.gitlessDecision))) {
      return { status: 'FAILED', failureCode: 'AGENT_GITLESS_ASSERTION_INVALID', engineStarted: false,
        message: 'Core requires a separate Git-less consent only for the matching Git-less execution.' };
    }
    try {
      const consumed = consumeAgentApprovalChallenge(importedPlanBundle, targetDir, 'core_run', budget,
        agentApprovalRequest.challengeId);
      if (!consumed.ok) return { status: 'FAILED', failureCode: 'AGENT_APPROVAL_CHALLENGE_REJECTED',
        reason: consumed.reason, engineStarted: false,
        message: 'Core rejected the Agent-reported Approval challenge; no Engine execution began.' };
      const executionApproval = reportedAgentApproval(agentApprovalRequest.challengeId, consumed.binding);
      if (gitlessAuthorizationRequired) {
        const gitlessConsumed = consumeAgentGitlessAuthorization(importedPlanBundle, targetDir, 'core_run', budget,
          agentApprovalRequest.challengeId, null, agentApprovalRequest.gitlessChallengeId);
        if (!gitlessConsumed.ok) return { status: 'FAILED', failureCode: 'AGENT_GITLESS_CHALLENGE_REJECTED',
          reason: gitlessConsumed.reason, engineStarted: false,
          message: 'Core rejected the separate Git-less authorization; no Engine execution began.' };
        const child = reportedAgentGitlessApproval(agentApprovalRequest.gitlessChallengeId,
          agentApprovalRequest.challengeId, 'core_run', null, gitlessConsumed.binding);
        agentGitlessApprovalProvenance = agentApprovalRequest.gitlessDecision === 'APPROVE' ? child : { ...child, decision: 'REJECT' };
        agentGitlessAdapterBinding = { ...gitlessConsumed.binding, challengeId: agentApprovalRequest.gitlessChallengeId,
          parentChallengeId: agentApprovalRequest.challengeId, parentExecutionKind: 'core_run', parentExecutionDigest: null };
      }
      if (agentApprovalRequest.decision === 'REJECT' || agentApprovalRequest.gitlessDecision === 'REJECT') {
        return { status: 'REJECTED', failureCode: agentApprovalRequest.decision === 'REJECT'
          ? 'AGENT_CORE_APPROVAL_REJECTED' : 'AGENT_GITLESS_AUTHORIZATION_REJECTED',
          approved: false, engineStarted: false, approvalProvenance: executionApproval,
          ...(agentGitlessApprovalProvenance ? { gitlessAuthorizationProvenance: agentGitlessApprovalProvenance } : {}),
          message: 'A required independent owner consent was rejected; Engine execution did not begin.' };
      }
      agentApprovalProvenance = agentGitlessApprovalProvenance
        ? { ...executionApproval, gitlessAuthorization: agentGitlessApprovalProvenance }
        : executionApproval;
    } catch (error) {
      return { status: 'FAILED', failureCode: 'AGENT_APPROVAL_CHALLENGE_UNAVAILABLE', engineStarted: false,
        message: 'Core could not safely consume the Approval challenge; no Engine execution began.', details: error.message };
    }
  }

  const taskId = options.taskId || (importedPlanBundle && importedPlanBundle.task.id) || `TASK-${Date.now()}`;
  const isBenchTask = Boolean(
    (taskId && (taskId.startsWith('BENCH-') || taskId.startsWith('CAL-') || taskId.startsWith('CANARY-'))) ||
    options.isBenchmark
  );
  const isAlreadySandbox = Boolean(
    targetDir.includes('.core-sandbox') ||
    targetDir.includes('.agent-core-sandboxes')
  );
  const sandboxDir = options.sandboxDir || ((!isBenchTask || isAlreadySandbox) ? targetDir : path.join(targetDir, '.core-sandbox'));

  const task = importedPlanBundle
    ? importedPlanBundle.task
    : {
        id: taskId,
        userPrompt: taskPrompt,
        category: options.taskCategory || 'general'
      };

  const engine = new CoreWorkflowEngine({
    ...options,
    provider: resolvedProvider,
    cwd: targetDir
  });

  // 1. Planning stage: deterministic, offline planning BEFORE user approval (zero provider calls)
  let planResult;
  let approvedPlanSnapshot = importedPlanBundle
    ? importedPlanBundle.approvedPlanSnapshot
    : (options.approvedPlanSnapshot || null);

  try {
    if (importedPlanBundle) {
      planResult = {
        ...importedPlanBundle,
        ok: true,
        status: 'PLANNED',
        approvedPlanSnapshot
      };
    } else if (approvedPlanSnapshot && approvedPlanSnapshot.plan) {
      planResult = {
        ok: true,
        status: 'PLANNED',
        userVisiblePlan: approvedPlanSnapshot.userVisiblePlan,
        approvedPlanSnapshot
      };
    } else {
      planResult = engine.planTask(task, {
        ...options,
        cwd: targetDir
      });
      approvedPlanSnapshot = planResult.approvedPlanSnapshot;
    }
  } catch (err) {
    const controlledFailure = buildFailureContract({
      terminationReason: CORE_FAILURE_CODES.CORE_INTERNAL_FAILURE,
      stage: FAILURE_STAGES.PLANNING,
      error: err,
      message: 'Core encountered an internal error during planning.',
      details: err.message,
      retryable: false,
      hasSourceModifications: false
    });
    return handleTaskFailure(controlledFailure, task, engine, options, null);
  }

  // Check if planning stage failed
  if (planResult.status === 'FAILED' || planResult.failure || planResult.ok === false) {
    return handleTaskFailure(
      planResult.failure || planResult,
      task,
      engine,
      options,
      null
    );
  }

  const { normalizeWorkspacePath } = require('../core/workflow/plan_receipt');
  const canonicalWorkspace = normalizeWorkspacePath(targetDir);
  const approvedPlanLocale = normalizePlanLocale(approvedPlanSnapshot && approvedPlanSnapshot.runtimeSnapshot && approvedPlanSnapshot.runtimeSnapshot.planLocale);
  const workspaceDisplay = approvedPlanLocale === 'fa'
    ? `Workspace معتبر طرح: ${canonicalWorkspace}`
    : `Canonical Plan workspace: ${canonicalWorkspace}`;
  const workspaceOutput = options.output || process.stdout;
  if (workspaceOutput && typeof workspaceOutput.write === 'function') {
    workspaceOutput.write(`\n${workspaceDisplay}\n`);
  }
  if (approvedPlanSnapshot.verificationContract && approvedPlanSnapshot.verificationContract.status !== 'ready') {
    workspaceOutput.write(`${planResult.userVisiblePlan}\n`);
    return {
      status: 'FAILED', failureCode: 'VERIFICATION_CONTRACT_BLOCKED',
      terminationReason: 'VERIFICATION_CONTRACT_BLOCKED',
      message: 'Planned verification has no usable required checks. Repair the environment and create a fresh Plan.',
      details: approvedPlanSnapshot.verificationContract.blockingReasons.join('; '),
      retryable: false, projectStateSafe: true, projectState: 'Safe/unchanged',
      projectStateEvidence: 'pre_execution_gate', approvedPlanSnapshot
    };
  }

  // 2. Resolve user decision (options override or prompt)
  const { normalizeApprovalDecision, APPROVAL_DECISIONS } = require('../core/workflow');
  let rawDecision = (typeof options.approvalDecision === 'string' && options.approvalDecision.trim())
    ? options.approvalDecision.trim()
    : null;
  if (importedPlanBundle) {
    rawDecision = agentApprovalProvenance ? 'APPROVE' : null;
  } else if (!rawDecision && typeof options.onPlanApproval === 'function') {
    try {
      rawDecision = options.onPlanApproval(approvedPlanSnapshot);
    } catch {
      rawDecision = null;
    }
  }

  if (!rawDecision && !agentApprovalProvenance) {
      const approvalText = importedPlanBundle
        ? formatImportedPlanForApproval(approvedPlanSnapshot)
        : planResult.userVisiblePlan;
      rawDecision = await promptPlanApproval(`${workspaceDisplay}\n\n${approvalText}`, { ...options, planLocale: approvedPlanLocale });
  }

  const decision = normalizeApprovalDecision(rawDecision);

  // 3. Act strictly upon decision
  if (decision === APPROVAL_DECISIONS.APPROVE) {
    if (approvedPlanSnapshot.verificationContract) {
      const comparison = compareVerificationContract(targetDir, approvedPlanSnapshot.verificationContract, {
        expectedFiles: approvedPlanSnapshot.filesToModify
      });
      if (!comparison.ok) {
        return {
          status: 'FAILED', failureCode: 'STALE_VERIFICATION_CONTRACT',
          terminationReason: 'STALE_VERIFICATION_CONTRACT',
          message: 'Verification changed after Plan Approval. Create a fresh Plan and obtain fresh Approval.',
          details: comparison.reason, retryable: false, projectStateSafe: true,
          projectState: 'Safe/unchanged', projectStateEvidence: 'pre_execution_gate', approvedPlanSnapshot
        };
      }
    }
    const approvedMessage = approvedPlanLocale === 'fa'
      ? '\nطرح تأیید شد. اجرا آغاز می‌شود...\n\n'
      : '\nPlan approved. Proceeding with execution...\n\n';
    if (options.output && typeof options.output.write === 'function') {
      options.output.write(approvedMessage);
    } else {
      console.log(approvedMessage);
    }

    let diagnosticAuthorization = null;
    if (diagnosticMode) {
      const { isInteractiveCodexSession } = require('../core/allocation/adapters/codex_interactive_handoff');
      if (isInteractiveCodexSession({ env: process.env }, resolvedProvider)) {
        return {
          status: 'FAILED', failureCode: 'DIAGNOSTIC_INTERACTIVE_HOST_BLOCKED',
          terminationReason: 'DIAGNOSTIC_INTERACTIVE_HOST_BLOCKED',
          message: 'Diagnostic attestation is restricted to a standalone CLI process; interactive Handoff behavior is unchanged.',
          retryable: false, projectStateSafe: true,
          approvedPlanSnapshot: planResult.approvedPlanSnapshot
        };
      }
      try {
        const binding = buildDiagnosticAuthorizationBinding(importedPlanBundle, targetDir);
        const expected = formatDiagnosticConfirmation(binding);
        const answer = await promptDiagnosticAuthorization(binding, options);
        if (answer !== expected) {
          return {
            status: answer === null ? 'CANCELLED' : 'REJECTED',
            failureCode: answer === null ? 'DIAGNOSTIC_AUTHORIZATION_CANCELLED' : 'DIAGNOSTIC_AUTHORIZATION_REJECTED',
            terminationReason: answer === null ? 'DIAGNOSTIC_AUTHORIZATION_CANCELLED' : 'DIAGNOSTIC_AUTHORIZATION_REJECTED',
            message: 'Diagnostic authorization was not confirmed; no Adapter call was made.',
            approved: false, retryable: false, projectStateSafe: true,
            approvedPlanSnapshot: planResult.approvedPlanSnapshot
          };
        }
        diagnosticAuthorization = Object.freeze({
          ...binding,
          ownerConfirmed: true,
          ownerConfirmedAt: new Date().toISOString()
        });
      } catch (error) {
        return {
          status: 'FAILED', failureCode: error.code || 'DIAGNOSTIC_AUTHORIZATION_INVALID',
          terminationReason: error.code || 'DIAGNOSTIC_AUTHORIZATION_INVALID',
          message: 'Diagnostic authorization could not be consumed safely; no Adapter call was made.',
          details: error.message, retryable: false, projectStateSafe: true,
          approvedPlanSnapshot: planResult.approvedPlanSnapshot
        };
      }
    }

    // Interactive handoff: enforce allocated Coder model on active Codex thread before implementation proceeds
    let handoffResult = null;
    const { isInteractiveCodexSession } = require('../core/allocation/adapters/codex_interactive_handoff');
    const isInteractive = isInteractiveCodexSession({ ...options, env: options.env || process.env }, engine.provider);

    if (isInteractive && !diagnosticMode) {
      const { executeAllocatedRole } = require('../core/allocation/execution_handoff');
      try {
        handoffResult = await executeAllocatedRole(planResult.approvedPlanSnapshot, 'coder', null, {
          ...options,
          interactive: true
        });
      } catch (handoffErr) {
        handoffResult = {
          ok: false,
          status: 'failure',
          error: handoffErr.message,
          enforcedModel: null,
          actualModel: null,
          manualFallbackRequired: true,
          message: `Interactive handoff error: ${handoffErr.message}`
        };
      }

      const validSkippedHandoff = handoffResult
        && handoffResult.ok === true
        && handoffResult.status === 'skipped'
        && handoffResult.reason === 'model_switching_disabled'
        && handoffResult.executionPermitted !== false;
      const validEnforcedHandoff = handoffResult
        && handoffResult.ok === true
        && handoffResult.status === 'enforced'
        && typeof handoffResult.enforcedModel === 'string'
        && handoffResult.enforcedModel.trim().length > 0;
      const validAdvisoryHandoff = handoffResult
        && handoffResult.ok === true
        && handoffResult.status === 'advisory_satisfied'
        && handoffResult.executionPermitted === true;

      if (!validSkippedHandoff && !validEnforcedHandoff && !validAdvisoryHandoff) {
        const handoffStatus = handoffResult && typeof handoffResult.status === 'string'
          ? handoffResult.status
          : 'invalid_result';
        const failureCode = handoffStatus === 'blocked_safety_floor'
          ? 'blocked_safety_floor'
          : handoffStatus === 'unavailable'
            ? 'HANDOFF_UNAVAILABLE'
            : handoffStatus === 'failure'
              ? 'HANDOFF_FAILURE'
              : 'HANDOFF_INVALID_RESULT';
        const detail = (handoffResult && (handoffResult.message || handoffResult.error || handoffResult.reason))
          || 'Core handoff did not provide a valid permission to execute the approved plan.';
        const controlledFailure = buildFailureContract({
          terminationReason: failureCode,
          stage: FAILURE_STAGES.ALLOCATION,
          message: handoffStatus === 'blocked_safety_floor'
            ? 'Core stopped because the active model could not be proven to satisfy Safety Floor.'
            : handoffStatus === 'unavailable'
              ? 'Core stopped because interactive Handoff is unavailable; execution did not continue.'
              : 'Core stopped because interactive Handoff did not return a valid execution authorization.',
          details: detail,
          retryable: false,
          hasSourceModifications: false
        });
        return {
          ...controlledFailure,
          projectState: 'Safe/unchanged',
          projectStateEvidence: 'pre_execution_gate',
          handoff: handoffResult,
          approvedPlanSnapshot: planResult.approvedPlanSnapshot,
          terminationReason: failureCode
        };
      }

      if (handoffResult && handoffResult.status === 'enforced') {
        const out = options.output || console;
        const msg = `\nModel enforced on Codex thread: ${handoffResult.enforcedModel}\n\n`;
        if (typeof out.write === 'function') out.write(msg);
        else out.log(msg);
      } else if (handoffResult && handoffResult.manualFallbackRequired) {
        const out = options.output || console;
        const msg = `\n⚠️ ${handoffResult.message}\n\n`;
        if (typeof out.write === 'function') out.write(msg);
        else (out.warn || out.log)(msg);
      }
    }

    let gitlessWorkspaceAuthorization = null;
    if (resolvedProvider === 'codex' && engine.adapter && typeof engine.adapter.isGitlessWorkspace === 'function') {
      let isGitlessWorkspace = false;
      try {
        isGitlessWorkspace = engine.adapter.isGitlessWorkspace(canonicalWorkspace);
      } catch (error) {
        return {
          status: 'FAILED',
          failureCode: 'GITLESS_WORKSPACE_UNSAFE',
          terminationReason: 'GITLESS_WORKSPACE_UNSAFE',
          message: 'Core stopped because the Codex workspace path could not be validated safely.',
          details: error.message,
          approved: true,
          retryable: false,
          projectStateSafe: true,
          projectState: 'Safe/unchanged',
          projectStateEvidence: 'pre_execution_gate',
          approvedPlanSnapshot: planResult.approvedPlanSnapshot
        };
      }
      if (isGitlessWorkspace) {
        let authorizationResult;
        if (agentGitlessApprovalProvenance) {
          try {
            const adapterChallenge = engine.adapter.createGitlessWorkspaceAuthorizationChallenge(
              planResult.approvedPlanSnapshot, canonicalWorkspace, agentGitlessAdapterBinding);
            const authorization = engine.adapter.confirmGitlessWorkspaceAuthorizationFromAgent(
              adapterChallenge, {
                executionApproval: agentApprovalProvenance,
                gitlessAuthorization: agentGitlessApprovalProvenance
              });
            authorizationResult = authorization
              ? { status: 'authorized', authorization }
              : { status: 'rejected', authorization: null };
          } catch (error) {
            authorizationResult = { status: 'invalid', authorization: null, error };
          }
        } else {
          authorizationResult = await promptGitlessWorkspaceAuthorization(
            engine.adapter,
            planResult.approvedPlanSnapshot,
            canonicalWorkspace,
            options
          );
        }
        if (authorizationResult.status !== 'authorized' || !authorizationResult.authorization) {
          const rejected = authorizationResult.status === 'rejected';
          return {
            status: rejected ? 'REJECTED' : (authorizationResult.status === 'cancelled' ? 'CANCELLED' : 'FAILED'),
            failureCode: rejected
              ? 'GITLESS_WORKSPACE_AUTHORIZATION_REJECTED'
              : (authorizationResult.status === 'cancelled' ? 'GITLESS_WORKSPACE_AUTHORIZATION_CANCELLED' : 'GITLESS_WORKSPACE_AUTHORIZATION_INVALID'),
            terminationReason: rejected
              ? 'GITLESS_WORKSPACE_AUTHORIZATION_REJECTED'
              : (authorizationResult.status === 'cancelled' ? 'GITLESS_WORKSPACE_AUTHORIZATION_CANCELLED' : 'GITLESS_WORKSPACE_AUTHORIZATION_INVALID'),
            message: rejected
              ? 'Codex execution stopped because the Git-less workspace authorization was not confirmed.'
              : (authorizationResult.status === 'cancelled'
                ? 'Codex execution cancelled before Provider invocation; no Git-less workspace authorization was granted.'
                : 'Codex execution stopped because this Adapter could not validate Git-less workspace authorization.'),
            ...(authorizationResult.error ? { details: authorizationResult.error.message } : {}),
            approved: true,
            retryable: false,
            projectStateSafe: true,
            projectState: 'Safe/unchanged',
            projectStateEvidence: 'pre_execution_gate',
            approvedPlanSnapshot: planResult.approvedPlanSnapshot
          };
        }
        gitlessWorkspaceAuthorization = authorizationResult.authorization;
      }
    }

    let execResult;
    try {
      const historyMetadata = buildApprovedHistoryMetadata(planResult, {
        cwd: targetDir, taskPrompt, provider: resolvedProvider
      });
      execResult = engine.executeApprovedPlan({
        approvedPlanSnapshot: planResult.approvedPlanSnapshot,
        sandboxDir,
        options: {
          ...options,
          ...(gitlessWorkspaceAuthorization ? { gitlessWorkspaceAuthorization } : {}),
          ...(diagnosticMode ? { diagnosticAttestation: true, diagnosticAuthorization, maxProviderCalls: 1, maxRecoveryAttempts: 0 } : {}),
          historyMetadata,
          ...(managedBundleEvidence ? {
            managedCheckpointInput: {
              ...managedBundleEvidence,
              executionApproval: agentApprovalProvenance || {
                ...buildAgentApprovalBinding(planResult, targetDir, 'core_run', { maxProviderCalls: 1, maxRecoveryAttempts: 0 }),
                source: 'cli',
                decision: 'APPROVE'
              }
            }
          } : {}),
          ...(agentApprovalProvenance ? { approvalProvenance: agentApprovalProvenance } : {}),
          approvalDecision: 'APPROVE'
        }
      });
    } catch (err) {
      if (diagnosticMode) {
        return {
          status: 'FAILED', failureCode: err.code || CORE_FAILURE_CODES.CORE_INTERNAL_FAILURE,
          terminationReason: err.code || CORE_FAILURE_CODES.CORE_INTERNAL_FAILURE,
          message: 'Diagnostic execution stopped safely; no retry or Recovery was attempted.',
          details: err.message, retryable: false, projectStateSafe: true,
          approvedPlanSnapshot: planResult.approvedPlanSnapshot
        };
      }
      if (managedBundleEvidence) return {
        status: 'FAILED', failureCode: err.code || 'MANAGED_IMPLEMENTATION_STOPPED', retryable: false
      };
      const budgetExhausted = err && err.code === 'PROVIDER_CALL_BUDGET_EXHAUSTED';
      if (err && err.code === 'STALE_VERIFICATION_CONTRACT') {
        return {
          status: 'FAILED', failureCode: err.code, terminationReason: err.code,
          message: 'Verification changed after Plan Approval. Create a fresh Plan and obtain fresh Approval.',
          details: err.message, retryable: false, projectStateSafe: true,
          projectState: 'Safe/unchanged', projectStateEvidence: 'pre_execution_gate',
          approvedPlanSnapshot: planResult.approvedPlanSnapshot
        };
      }
      const controlledFailure = buildFailureContract({
        terminationReason: budgetExhausted ? err.code : CORE_FAILURE_CODES.CORE_INTERNAL_FAILURE,
        stage: FAILURE_STAGES.CODER,
        error: err,
        message: budgetExhausted
          ? 'Core stopped because the per-run Provider Adapter call budget is exhausted.'
          : 'Core encountered an internal error during execution.',
        details: err.message,
        retryable: false,
        retryUnavailableReason: budgetExhausted ? 'The configured Adapter-call budget for this run is exhausted.' : undefined,
        hasSourceModifications: fs.existsSync(path.join(sandboxDir, 'index.js'))
      });
      return handleTaskFailure(controlledFailure, task, engine, options, planResult.approvedPlanSnapshot);
    } finally {
      if (gitlessWorkspaceAuthorization && engine.adapter &&
          typeof engine.adapter.revokeGitlessWorkspaceAuthorization === 'function') {
        engine.adapter.revokeGitlessWorkspaceAuthorization(gitlessWorkspaceAuthorization);
      }
    }

    let finalResult = agentApprovalProvenance
      ? { ...execResult, approvalProvenance: agentApprovalProvenance }
      : execResult;
    if (handoffResult) {
      finalResult = {
        ...(managedBundleEvidence ? finalResult : execResult),
        handoff: handoffResult,
        enforcedModel: handoffResult.enforcedModel
      };
    }

    if (diagnosticMode) {
      return finalResult;
    }

    if (managedBundleEvidence) return finalResult;

    if (execResult.status === 'FAILED' || execResult.failure) {
      const failRes = await handleTaskFailure(
        execResult.failure || execResult,
        task,
        engine,
        options,
        planResult.approvedPlanSnapshot
      );
      if (handoffResult && failRes && typeof failRes === 'object') {
        return {
          ...failRes,
          handoff: handoffResult,
          enforcedModel: handoffResult.enforcedModel
        };
      }
      return failRes;
    }

    return finalResult;
  } else if (decision === APPROVAL_DECISIONS.REJECT) {
    if (options.output && typeof options.output.write === 'function') {
      options.output.write('\nPlan rejected by user. No implementation executed.\n');
    } else {
      console.log('\nPlan rejected by user. No implementation executed.');
    }
    return {
      status: 'REJECTED',
      approved: false,
      rejected: true,
      coderCallCount: 0,
      sourceWrites: 0,
      message: 'Plan rejected by user. No implementation executed.'
    };
  } else if (decision === APPROVAL_DECISIONS.CANCEL) {
    if (options.output && typeof options.output.write === 'function') {
      options.output.write('\nTask cancelled by user. No implementation executed.\n');
    } else {
      console.log('\nTask cancelled by user. No implementation executed.');
    }
    return {
      status: 'CANCELLED',
      approved: false,
      cancelled: true,
      coderCallCount: 0,
      sourceWrites: 0,
      message: 'Task cancelled by user. No implementation executed.'
    };
  } else {
    if (options.output && typeof options.output.write === 'function') {
      options.output.write('\nNo decision provided. Execution aborted without approval.\n');
    } else {
      console.log('\nNo decision provided. Execution aborted without approval.');
    }
    return {
      status: 'AWAITING_APPROVAL',
      approved: false,
      coderCallCount: 0,
      sourceWrites: 0,
      message: 'No decision provided. Execution aborted without approval.'
    };
  }
}

function resolveSelectedBridges(bridgeArg) {
  if (!bridgeArg || bridgeArg === 'default' || bridgeArg === 'core') {
    return DEFAULT_BRIDGES;
  }
  if (bridgeArg === 'all') {
    return Object.keys(BRIDGE_REGISTRY);
  }
  const requested = bridgeArg.split(',').map(b => b.trim().toLowerCase()).filter(Boolean);
  const selected = new Set();
  for (const b of requested) {
    if (BRIDGE_REGISTRY[b]) {
      selected.add(b);
    }
  }
  return Array.from(selected);
}

function deployBridgeFiles(sourceBridgesDir, targetRoot, selectedBridges, isDryRun) {
  const deployedNames = [];
  for (const bridgeKey of selectedBridges) {
    const files = BRIDGE_REGISTRY[bridgeKey];
    if (!files) continue;
    deployedNames.push(bridgeKey);
    for (const relFile of files) {
      const src = path.join(sourceBridgesDir, relFile);
      const dst = path.join(targetRoot, relFile);
      if (fs.existsSync(src)) {
        if (relFile === '.mcp.json' || relFile.endsWith('mcp.json')) {
          safeMergeMcpFile(src, dst, isDryRun);
        } else if (isInstructionFile(relFile)) {
          safeMergeInstructionFile(src, dst, isDryRun);
        } else {
          safeCopyFile(src, dst, isDryRun);
        }
      }
    }
  }
  return deployedNames;
}

function deployClaudeSkillAdapters(targetSkillsDir, targetClaudeSkillsDir, isDryRun) {
  if (!fs.existsSync(targetSkillsDir)) return;
  const skills = fs.readdirSync(targetSkillsDir);
  for (const skillName of skills) {
    const canonicalSkillMd = path.join(targetSkillsDir, skillName, 'SKILL.md');
    if (fs.existsSync(canonicalSkillMd)) {
      const content = fs.readFileSync(canonicalSkillMd, 'utf8');
      let name = skillName;
      let description = `Specialist skill for ${skillName}`;
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim();
      const descMatch = content.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim();

      const adapterDir = path.join(targetClaudeSkillsDir, skillName);
      if (!isDryRun && !fs.existsSync(adapterDir)) {
        fs.mkdirSync(adapterDir, { recursive: true });
      }
      const adapterPath = path.join(adapterDir, 'SKILL.md');
      const adapterContent = `---
name: ${name}
description: ${description}
---

# ${name} (Claude Runtime Adapter)
> Canonical Source: [${name}](file:///.agents/skills/${skillName}/SKILL.md)

This skill is governed by the HOTZEN — Governed AI Engineering Framework canonical skill definition.
Before executing tasks in this domain, load and adhere to the canonical instructions at:
\`.agents/skills/${skillName}/SKILL.md\`
`;
      safeWriteString(adapterPath, adapterContent, isDryRun);
    }
  }
}

function printHelp() {
  console.log(`
🌐 HOTZEN — Governed AI Engineering Framework CLI
Usage:
  core switch                          # Display current model switching status
  core switch on                       # Enable adaptive model switching
  core switch off [model]              # Disable adaptive model switching
  core lang                            # Display current project languages
  core lang add <language>             # Add supported language (e.g. python, dart)
  core lang remove <language>          # Remove language from project
  core [options]
  core plan "<task>" --provider=<provider> [--provider-model=<id>] [--files=<paths>] [--task-json=<json>] [--history-title=<text>] [--semantic-critic-max-provider-calls=<n>] --json
  core history last [--json]              # Read the latest recorded attempt in this workspace
  core plan --native --host=claude --task-json=<json> --files=<paths> --json --save-bundle
  core backup --native --host=claude --plan-file=<bundle> [--json]
  core verify --record --native --host=claude --plan-file=<bundle> [--agent-mediated-approval] [--json]
  core plan --native --host=antigravity --task-json=<json> --files=<paths> --json --save-bundle
  core backup --native --host=antigravity --plan-file=<bundle> [--json]
  core verify --record --native --host=antigravity --plan-file=<bundle> [--agent-mediated-approval] [--json]
  core backup --native --plan-file=<bundle> [--json]
                                         # Save a private byte snapshot; does not control Native write tools
  core history task <taskId> --approved-plan-digest=<sha256> [--json]
                                         # Read only the explicitly referenced Task/Plan context
  npx hotzen [options]
  npx hotzen detect [path]
  npx hotzen doctor [path]
  npx hotzen verify [path]
  npx hotzen bridge <name> [--dry-run]

Subcommands:
  plan "<task>"         Generate an offline Plan; optional --provider-model is a Core-managed Provider choice
  run "<task>"         Execute a plan after interactive approval
  switch [on|off]      Runtime control for adaptive model switching
  lang [add|remove]    Runtime management of project programming languages
  detect               Auto-detect project tech stack and confidence score
  doctor               Verify health of git hooks, bridges, security, and governance
  verify               Run verification matrix (lint, type-check, tests) for current stack
  history last         Report the latest SQLite attempt, provenance, and evidence limits
  bridge <name>        Deploy specific AI bridge (e.g. cursor, claude, codex, all)
  reset                Purge previous skills from .agents/skills for a clean stack reset
  model-switching <on|off|status>  Runtime control for adaptive per-role model switching (alias)

Options:
  --stack=<name>       Tech stack name (e.g. flutter, react, python-fastapi, rust, laravel, core)
  --bridges=<list>     AI bridges to install (e.g. cursor,copilot,all) (Default: gemini,claude,codex)
  --clean              Purge previous stack skills before deploying to fix accidental stack choices
  --dry-run            Simulate deployment without writing or overwriting any files
  --help, -h           Show this help message

Core run options:
  --history-title <text>      Optional owner-supplied Plan title for future attempt history; do not include secrets
  --max-provider-calls <n>     Optional per-run Adapter-call ceiling (non-negative integer)
  --semantic-critic-max-provider-calls <n> Explicit Plan opt-in and total Provider-call ceiling for model-based Critic (Codex only)
  --max-recovery-attempts <n>  Recovery attempts; 0 disables Recovery
  --plan-file <path>           Import the exact JSON bundle emitted by 'core plan --json'; approval is prompted again
  --agent-mediated-approval    Opt in for this run: prepare an expiring, one-use challenge bound to its Plan and execution
  --agent-approval-challenge <id> --agent-approval-decision APPROVE|REJECT
                               Report the separate Core execution decision; provenance is reported_by_agent
  --agent-gitless-challenge <id> --agent-gitless-decision APPROVE|REJECT
                               Separately report the Git-less check exception when the workspace requires it
  --save-bundle               With 'core plan --provider=codex', save a private Native Bundle in the Workspace
  --diagnostic-model-attestation  One-time standalone diagnostic; requires imported Plan, fresh Approval and owner confirmation

Examples:
  core run --plan-file=<bundle> --agent-mediated-approval
  core verify --record --native --plan-file=<bundle> --agent-mediated-approval
  core switch                             # Display model switching status
  core switch off                         # Disable adaptive model switching
  core switch on                          # Enable adaptive model switching
  core lang                               # Display project languages
  core lang add python                    # Add python language support
  core lang remove python                 # Remove python language support
  npx hotzen                      # Auto-detects stack or prompts interactively
  npx hotzen --clean              # Clean previous skills and deploy fresh stack
  npx hotzen reset                # Purge skills to reset workspace
  npx hotzen doctor               # Check health and security hooks
  npx hotzen verify               # Run test and verification gate
  npx hotzen --stack=react-nextjs --bridges=cursor,copilot
  npx hotzen bridge cursor
  npx hotzen --install-hooks      # Opt-in to configure git pre-commit hook
`);
}

function fetchStack(stackName, destDir, options = {}) {
  const stackTmp = path.join(destDir, stackName);

  // 1. Check if running from a local HOTZEN checkout where the stack exists
  const localCoreRoot = path.resolve(__dirname, '..');
  const localStackDir = path.join(localCoreRoot, 'stacks', stackName);
  const isLocalCheckout = fs.existsSync(localStackDir) && fs.statSync(localStackDir).isDirectory();

  if (!options.forceRemote && isLocalCheckout) {
    console.log(`  📂 Using local stack definition from ${localStackDir}...`);
    fs.mkdirSync(stackTmp, { recursive: true });

    // Copy local core rules, hooks, and security into stackTmp (never staging live memory)
    if (fs.existsSync(path.join(localCoreRoot, '.agents'))) {
      for (const d of ['rules', 'hooks', 'security']) {
        const srcD = path.join(localCoreRoot, '.agents', d);
        if (fs.existsSync(srcD)) {
          safeCopyDir(srcD, path.join(stackTmp, '.agents', d), false);
        }
      }
      const mcpSrc = path.join(localCoreRoot, '.agents', 'mcp_config.json');
      if (fs.existsSync(mcpSrc)) {
        safeCopyFile(mcpSrc, path.join(stackTmp, '.agents', 'mcp_config.json'), false);
      }
    }
    if (fs.existsSync(path.join(localCoreRoot, 'core'))) {
      safeCopyDir(path.join(localCoreRoot, 'core'), path.join(stackTmp, 'core'), false);
    }
    if (fs.existsSync(path.join(localCoreRoot, 'AGENTS.md'))) {
      safeCopyFile(path.join(localCoreRoot, 'AGENTS.md'), path.join(stackTmp, 'AGENTS.md'), false);
    }

    // Copy stack-specific STACK_RULES.md and skills
    const localStackRules = path.join(localStackDir, 'STACK_RULES.md');
    if (fs.existsSync(localStackRules)) {
      safeCopyFile(localStackRules, path.join(stackTmp, 'STACK_RULES.md'), false);
    }
    const localStackSkills = path.join(localStackDir, 'skills');
    if (fs.existsSync(localStackSkills)) {
      safeCopyDir(localStackSkills, path.join(stackTmp, '.agents', 'skills'), false);
    }

    return stackTmp;
  }

  if (!options.forceRemote) {
    throw new Error(`Missing bundled stack '${stackName}'. Reinstall HOTZEN from a complete npm package or local distribution. Legacy private GitHub access requires explicit --remote or --force-remote.`);
  }

  // 2. Explicit legacy remote request only (git clone or tarball).
  let cloneError = null;
  try {
    execFileSync('git', [
      'clone',
      '--depth', '1',
      '--branch', stackName,
      `https://github.com/${REPO_USER}/${REPO_NAME}.git`,
      stackTmp
    ], {
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return stackTmp;
  } catch (err) {
    cloneError = err;
    const errMsg = err.stderr ? err.stderr.toString().trim() : err.message.trim();
    console.warn(`  ⚠️ Git clone failed (${errMsg}). Attempting tarball fallback...`);
  }

  // Fallback to tarball
  fs.mkdirSync(stackTmp, { recursive: true });
  const tarUrl = `https://github.com/${REPO_USER}/${REPO_NAME}/archive/refs/heads/${stackName}.tar.gz`;
  const tarFile = path.join(stackTmp, 'stack.tar.gz');
  try {
    execFileSync('curl', ['-fsSL', tarUrl, '-o', tarFile], { stdio: 'pipe' });
    execFileSync('tar', ['-xzf', tarFile, '-C', stackTmp], { stdio: 'pipe' });
    const extractedFolders = fs.readdirSync(stackTmp).filter(f => f.startsWith(`${REPO_NAME}-`));
    if (extractedFolders.length === 0) {
      throw new Error(`Failed to extract stack archive for ${stackName}`);
    }
    return path.join(stackTmp, extractedFolders[0]);
  } catch (tarErr) {
    const cloneMsg = cloneError ? (cloneError.stderr ? cloneError.stderr.toString().trim() : cloneError.message.trim()) : 'unknown error';
    const tarMsg = tarErr.stderr ? tarErr.stderr.toString().trim() : tarErr.message.trim();
    throw new Error(
      `Failed to fetch stack '${stackName}' via both git clone and tarball fallback:\n` +
      `  1. Git clone error: ${cloneMsg}\n` +
      `  2. Tarball error: ${tarMsg}`
    );
  }
}

function reportWorkflowResult(result, processRef = process, output = console) {
  const status = result && typeof result.status === 'string' ? result.status : 'FAILED';
  const failure = result && result.failure && typeof result.failure === 'object' ? result.failure : null;
  const reason = (result && (result.failureCode || result.terminationReason || result.failureReason))
    || (failure && failure.failureCode)
    || (result && (result.message || result.error))
    || (status === 'SUCCESS' ? 'Workflow completed with verified artifacts.' : 'Workflow ended without a successful result.');
  const details = (failure && (failure.details || failure.message))
    || (result && (result.details || result.message || result.error))
    || null;
  const skippedChecks = result && result.initialVerificationEvidence && Array.isArray(result.initialVerificationEvidence.skippedChecks)
    ? result.initialVerificationEvidence.skippedChecks
    : [];
  const exitCodeByStatus = {
    SUCCESS: 0,
    BYPASSED: 0,
    FAILED: 1,
    CRITIC_REJECTED: 1,
    VERIFICATION_FAILED: 1,
    INFRASTRUCTURE_FAILURE: 1,
    CANCELLED: 130,
    REJECTED: 2,
    AWAITING_APPROVAL: 2,
    AWAITING_VERIFICATION_APPROVAL: 2
  };
  const exitCode = Object.prototype.hasOwnProperty.call(exitCodeByStatus, status)
    ? exitCodeByStatus[status]
    : 1;
  const plan = result && result.plan;
  const hasCriterionReport = Array.isArray(plan && plan.reportingRequirements) && plan.reportingRequirements.includes('criterion_matrix_v1');
  const criterionReport = hasCriterionReport ? buildCriterionReport(plan, result.semanticReview, result.leaderDecision) : null;
  const criterionReportValid = criterionReport && validateCriterionReport(criterionReport, plan, result.semanticReview);
  const deliverySuccess = Boolean(!hasCriterionReport ||
    (status === 'SUCCESS' && criterionReportValid && criterionReport.completeness === 'COMPLETE' &&
      criterionReport.deliverySuccess && result.leaderDecision && result.leaderDecision.success === true));
  const finalExitCode = hasCriterionReport && !deliverySuccess && exitCode === 0 ? 1 : exitCode;

  output.log(`Workflow status: ${status}`);
  if (status === 'AWAITING_VERIFICATION_APPROVAL') {
    output.log(`Checkpoint ID: ${result.checkpoint.checkpointId}`);
  }
  if (status === 'AWAITING_AGENT_APPROVAL' && typeof result.consentText === 'string' && result.consentText) {
    output.log(result.consentText);
  }
  if (criterionReport) {
    output.log(`Criterion report completeness: ${criterionReportValid ? criterionReport.completeness : 'INCOMPLETE'}`);
    for (const row of criterionReport.rows) {
      output.log(`Criterion ${row.index + 1}: ${row.status}; ${row.criterion}; evidence: ${row.evidenceRefs.length ? row.evidenceRefs.join(', ') : 'Unknown'}${row.method ? `; method: ${row.method}` : ''}${row.limitation ? `; limitation: ${row.limitation}` : ''}`);
    }
    output.log(`Delivery success: ${deliverySuccess ? 'YES' : 'NO'}`);
  }
  if (result && result.modelComplianceStatus) {
    output.log(`Model compliance: ${result.modelComplianceStatus}${result.modelComplianceFailure ? ` — ${result.modelComplianceFailure}` : ''}`);
  }
  output.log(`Reason: ${reason}`);
  if (details && details !== reason) output.log(`Details: ${details}`);
  if (status !== 'SUCCESS') {
    const stateEvidence = (result && result.projectStateEvidence) || (failure && failure.projectStateEvidence);
    const stateSafe = result && typeof result.projectStateSafe === 'boolean'
      ? result.projectStateSafe
      : (failure && failure.projectStateSafe);
    const projectState = !stateEvidence
      ? 'Unknown'
      : (stateSafe === true
        ? 'Safe/unchanged (no source changes by this Core attempt)'
        : (stateSafe === false ? 'Has partial modifications' : 'Unknown'));
    output.log(`Project state: ${projectState}`);
  }
  if (status === 'CANCELLED' || status === 'BYPASSED') {
    output.log('Any previously applied changes remain in the workspace. Core will perform no further work.');
  }
  if (skippedChecks.length > 0) {
    output.log(`Verification: SKIPPED — ${skippedChecks.map((check) => `${check.name} (${check.message})`).join('; ')}`);
  }
  output.log(`Exit code: ${finalExitCode}`);
  processRef.exitCode = finalExitCode;
  return finalExitCode;
}

async function main() {
  let args = process.argv.slice(2);
  if (args[0] === 'core') {
    args = args.slice(1);
  }

  if (args.length === 1 && args[0] === '--version') {
    console.log(require('../package.json').version);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // User-facing simple model switching commands:
  // core switch
  // core switch on
  // core switch off [model]
  const isCoreBin = path.basename(process.argv[1] || '') === 'core';
  const firstArg = (args[0] || '').toLowerCase();

  if (firstArg === 'switch' || firstArg === 'on' || firstArg === 'off' || firstArg === 'status' || (isCoreBin && args.length === 0)) {
    const { getModelSwitchingStatus } = require('../core/allocation/model_switching_toggle');
    const secondArg = (args[1] || '').toLowerCase();

    // Turn ON: core switch on | core on
    if (firstArg === 'on' || (firstArg === 'switch' && ['on', 'enable', '1', 'true'].includes(secondArg))) {
      console.error('FEATURE_DISABLED: Automatic Model Switching is frozen for V1. Saved preferences were not changed.');
      process.exitCode = 2;
      return;
    }

    // Turn OFF: core switch off [model] | core off [model]
    if (firstArg === 'off' || (firstArg === 'switch' && ['off', 'disable', '0', 'false'].includes(secondArg))) {
      const status = getModelSwitchingStatus();
      console.log('FEATURE_DISABLED: Model Switching is frozen OFF for V1; saved preferences were not changed.');
      if (status.selectedModel) {
        console.log(`Selected fixed model: ${status.selectedModel}`);
        console.log('Safety Floor: Active — Core may override the selected model when required by capability or availability constraints.');
      } else {
        console.log('Mode: Provider/default fallback (no fixed model selected)');
        console.log('Safety Floor: Active — Core enforces capability and availability constraints.');
      }
      return;
    }

    // Status: core switch | core status | core (when invoked as core)
    const status = getModelSwitchingStatus();
    if (status.enabled) {
      console.log('Model switching: ON');
      console.log('Adaptive routing: Enabled');
    } else {
      console.log('Model switching: OFF');
      if (status.featureDisabled) console.log('FEATURE_DISABLED: Automatic Model Switching is frozen for V1.');
      if (status.selectedModel) {
        console.log(`Selected fixed model: ${status.selectedModel}`);
        console.log('Safety Floor: Active — Core may override the selected model when required by capability or availability constraints.');
      } else {
        console.log('Mode: Provider/default fallback (no fixed model selected)');
        console.log('Safety Floor: Active — Core enforces capability and availability constraints.');
      }
      console.log('Adaptive routing: Disabled');
      console.log('Effective scope: future tasks');
    }
    return;
  }

  // User-facing simple language management commands:
  // core lang
  // core lang add <language>
  // core lang remove <language>
  if (firstArg === 'lang' || firstArg === 'language' || firstArg === 'languages') {
    const {
      getProjectLanguageStatus,
      formatLanguageStatus,
      addProjectLanguage,
      removeProjectLanguage
    } = require('../core/languages');

    const subAction = (args[1] || '').toLowerCase();
    const langTarget = args[2] || '';

    if (subAction === 'add') {
      if (!langTarget) {
        console.log('Please specify a language to add. Example: core lang add python');
        return;
      }
      const res = addProjectLanguage(langTarget);
      console.log(res.message);
      return;
    }

    if (subAction === 'remove' || subAction === 'rm' || subAction === 'del' || subAction === 'delete') {
      if (!langTarget) {
        console.log('Please specify a language to remove. Example: core lang remove python');
        return;
      }
      const res = removeProjectLanguage(langTarget);
      console.log(res.message);
      return;
    }

    // Default: display status
    const status = getProjectLanguageStatus();
    console.log(formatLanguageStatus(status));
    return;
  }

  // Subcommand: plan (offline / non-interactive plan generation)
  if (firstArg === 'plan') {
    const { generateTaskPlan } = require('../core/workflow/plan_generator');
    const planArgs = args.slice(1);
    const cleanArgs = [];
    let isJson = false;
    let explicitInteractive = false;
    let explicitNoInteractive = false;
    let targetCwd = process.cwd();
    let explicitProvider = null;
    let explicitFiles = null;
    let providerModel;
    let planLocale;
    let historyTitle;
    let semanticCriticMaxProviderCalls;
    let saveBundle = false;
    let native = false;
    let nativeHost;
    let forbiddenNativeOption = false;
    let structuredTask = null;

    for (let i = 0; i < planArgs.length; i++) {
      const a = planArgs[i];
      if (a === '--native') {
        native = true;
      } else if (a.startsWith('--host=')) {
        nativeHost = a.slice('--host='.length);
      } else if (a === '--host') {
        nativeHost = planArgs[++i];
      } else if (/^--(?:model|selected-model|model-switching|adapter|catalog|switching)/.test(a)) {
        forbiddenNativeOption = true; cleanArgs.push(a);
      } else if (a === '--json') {
        isJson = true;
      } else if (a === '--save-bundle') {
        saveBundle = true;
      } else if (a.startsWith('--task-json=')) {
        try { structuredTask = JSON.parse(a.slice('--task-json='.length)); }
        catch { structuredTask = null; }
        if (!structuredTask) {
          console.error('Invalid --task-json value; expected a JSON object with goal, filesToModify, and acceptanceCriteria.');
          process.exitCode = 2;
          return;
        }
      } else if (a === '--task-json' && planArgs[i + 1]) {
        try { structuredTask = JSON.parse(planArgs[++i]); }
        catch {
          console.error('Invalid --task-json value; expected a JSON object with goal, filesToModify, and acceptanceCriteria.');
          process.exitCode = 2;
          return;
        }
      } else if (a.startsWith('--semantic-critic-max-provider-calls=')) {
        semanticCriticMaxProviderCalls = Number(a.slice('--semantic-critic-max-provider-calls='.length));
      } else if (a === '--semantic-critic-max-provider-calls') {
        semanticCriticMaxProviderCalls = Number(planArgs[++i]);
      } else if (a === '--interactive') {
        explicitInteractive = true;
      } else if (a === '--no-interactive') {
        explicitNoInteractive = true;
      } else if (a.startsWith('--cwd=')) {
        targetCwd = path.resolve(a.split('=')[1].trim());
      } else if (a === '--cwd' && planArgs[i + 1]) {
        targetCwd = path.resolve(planArgs[i + 1].trim());
        i++;
      } else if (a.startsWith('--provider=')) {
        explicitProvider = a.split('=')[1].trim();
      } else if (a === '--provider' && planArgs[i + 1]) {
        explicitProvider = planArgs[i + 1].trim();
        i++;
      } else if (a.startsWith('--provider-model=')) {
        providerModel = a.slice('--provider-model='.length).trim();
      } else if (a === '--provider-model' && planArgs[i + 1]) {
        providerModel = planArgs[++i].trim();
      } else if (a.startsWith('--plan-locale=')) {
        planLocale = a.slice('--plan-locale='.length).trim();
      } else if (a === '--plan-locale') {
        planLocale = planArgs[i + 1] ? planArgs[++i].trim() : '';
      } else if (a.startsWith('--history-title=')) {
        historyTitle = a.slice('--history-title='.length);
      } else if (a === '--history-title') {
        historyTitle = planArgs[i + 1] ? planArgs[++i] : '';
      } else if (a.startsWith('--files=')) {
        explicitFiles = a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
      } else if ((a === '--files' || a === '--file') && planArgs[i + 1]) {
        explicitFiles = planArgs[i + 1].split(',').map(s => s.trim()).filter(Boolean);
        i++;
      } else {
        cleanArgs.push(a);
      }
    }

    const taskPrompt = cleanArgs.join(' ').trim();
    if (structuredTask && taskPrompt) {
      console.error('Use either a positional task prompt or --task-json, not both.');
      process.exitCode = 2;
      return;
    }
    if (!taskPrompt && !structuredTask) {
      console.error('❌ Error: Task prompt is required. Example: core plan "Build semver parser"');
      process.exit(1);
    }
    if ((nativeHost !== undefined && !native) || (native && (!nativeExecutorForHost(nativeHost) || forbiddenNativeOption || explicitProvider !== null || providerModel !== undefined || semanticCriticMaxProviderCalls !== undefined))) {
      console.error('Invalid Native host or mixed Provider/model options.'); process.exitCode = 2; return;
    }
    if (saveBundle && !native && explicitProvider !== 'codex') {
      console.error('❌ Error: --save-bundle requires an explicit --provider=codex Native Plan.');
      process.exitCode = 1;
      return;
    }

    let planResult;
    try {
      planResult = generateTaskPlan({
        ...(native ? { native: true, nativeHost } : {}),
        ...(structuredTask ? { structuredTask } : { taskPrompt }),
        cwd: targetCwd,
        ...(explicitProvider ? { provider: explicitProvider } : {}),
        ...(providerModel !== undefined ? { providerModel } : {}),
        ...(planLocale !== undefined ? { planLocale } : {}),
        ...(historyTitle !== undefined ? { historyTitle } : {}),
        ...(semanticCriticMaxProviderCalls !== undefined ? { semanticCriticMaxProviderCalls } : {}),
        ...(explicitFiles ? { filesToModify: explicitFiles } : {})
      });
    } catch (err) {
      console.error(`Provider resolution failed: ${err.message}`);
      process.exitCode = 2;
      return;
    }

    planResult.enforcedModel = null;
    planResult.receipt = typeof planResult.planReceipt === 'string'
      ? planResult.planReceipt
      : (planResult.planReceipt && planResult.planReceipt.receipt ? planResult.planReceipt.receipt : null);
    if (saveBundle) {
      try {
        planResult = saveNativePlanBundle(planResult, targetCwd);
      } catch (error) {
        console.error(`❌ Native Plan Bundle was not saved: ${error.message}`);
        process.exitCode = 1;
        return;
      }
    }

    if (isJson) {
      console.log(JSON.stringify(planResult, null, 2));
    } else {
      console.log(planResult.userVisiblePlan);
      if (planResult.bundleFile) console.log(`\nPrivate Plan Bundle: ${planResult.bundleFile}`);
    }
    return;
  }

  // Subcommand: handoff
  if (args[0] === 'handoff') {
    let receiptString = null;
    let explicitThreadId = null;
    let targetCwd = process.cwd();
    let isJson = args.includes('--json');
    let parseError = null;

    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('--receipt=')) {
        receiptString = a.slice('--receipt='.length);
      } else if (a === '--receipt' && i + 1 < args.length) {
        receiptString = args[++i];
      } else if (a.startsWith('--thread-id=')) {
        explicitThreadId = a.slice('--thread-id='.length);
      } else if (a === '--thread-id' && i + 1 < args.length) {
        explicitThreadId = args[++i];
      } else if (a.startsWith('--cwd=')) {
        targetCwd = path.resolve(a.slice('--cwd='.length));
      } else if (a === '--cwd' && i + 1 < args.length) {
        targetCwd = path.resolve(args[++i]);
      } else if (a === '--json') {
        isJson = true;
      } else if (a.startsWith('--model') || a.startsWith('--enforced-model') || a.startsWith('--verified-current-model')) {
        const errMsg = 'Cannot specify --model, --enforced-model, or --verified-current-model. Active model cannot be self-asserted; requested coder model is derived strictly from the validated plan receipt.';
        if (isJson) {
          console.log(JSON.stringify({ ok: false, status: 'failure', error: errMsg }));
        } else {
          console.error(`❌ Error: ${errMsg}`);
        }
        process.exitCode = 1;
        return;
      } else if (a.startsWith('--')) {
        parseError = { reason: 'unknown_option', error: `Unknown core handoff option '${a}'. Supported options: --receipt, --thread-id, --cwd, --json.` };
      } else {
        parseError = { reason: 'unexpected_argument', error: `Unexpected positional argument '${a}'. Use --cwd="<workspace>".` };
      }
    }

    if (parseError) {
      if (isJson) console.log(JSON.stringify({ ok: false, status: 'failure', ...parseError }));
      else console.error(`❌ Error: ${parseError.error}`);
      process.exitCode = 1;
      return;
    }

    const { executeHandoff } = require('../core/workflow/handoff_executor');
    const result = await executeHandoff({
      receipt: receiptString,
      ...(explicitThreadId !== null ? { threadId: explicitThreadId } : {}),
      cwd: targetCwd
    });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }

    if (result.ok && result.status === 'enforced') {
      console.log('======================================================================');
      console.log('🤝 HOTZEN - Authoritative Codex Interactive Handoff Gate');
      console.log('======================================================================');
      console.log(`✅ Status:                  ENFORCED`);
      console.log(`🎯 Requested Model:        ${result.requestedModel}`);
      console.log(`🔒 Enforced Model:         ${result.enforcedModel}`);
      console.log(`🧵 Active Thread ID:        ${result.threadId}`);
      console.log(`🔍 Resolution Source:       ${result.threadResolutionSource}`);
      console.log('======================================================================');
      console.log(`Receipt integrity valid. Codex thread settings updated successfully.`);
      console.log('You may now proceed with workspace implementation.');
      console.log('======================================================================');
    } else if (result.status === 'advisory_satisfied') {
      console.log('======================================================================');
      console.log('🤝 HOTZEN - Interactive Handoff (Advisory Satisfied)');
      console.log('======================================================================');
      console.log(`✅ Status:                  ADVISORY_SATISFIED`);
      console.log(`🎯 Requested Model:        ${result.requestedModel}`);
      console.log(`🔒 Current Verified Model: ${result.verifiedCurrentModel}`);
      console.log(`📋 Note:                   ${result.message}`);
      console.log('======================================================================');
      console.log('You may now proceed with workspace implementation under Core management.');
      console.log('======================================================================');
    } else if (result.status === 'skipped') {
      console.log('======================================================================');
      console.log('🤝 HOTZEN - Interactive Handoff (Model Switching Disabled)');
      console.log('======================================================================');
      console.log(`ℹ️ Status:                  SKIPPED`);
      console.log(`🎯 Requested Model:        ${result.requestedModel}`);
      console.log(`🔒 Enforced Model:         none (model switching disabled)`);
      console.log(`📋 Note:                   ${result.message}`);
      console.log('======================================================================');
    } else {
      console.error('======================================================================');
      console.error('⚠️ HOTZEN - Interactive Handoff Gate Interrupted');
      console.error('======================================================================');
      console.error(`❌ Status:                  ${(result.status || 'failure').toUpperCase()}`);
      if (result.error) {
        console.error(`💥 Error:                   ${result.error}`);
      }
      console.error('----------------------------------------------------------------------');
      console.error(result.message);
      console.error('======================================================================');
      process.exitCode = 1;
    }
    return;
  }

  if (firstArg === 'history') {
    if (args[1] === 'task') {
      const flags = args.slice(3);
      const digests = flags.filter(flag => flag.startsWith('--approved-plan-digest='));
      if (!args[2] || digests.length !== 1 || flags.filter(flag => flag === '--json').length > 1 ||
          flags.some(flag => flag !== '--json' && !flag.startsWith('--approved-plan-digest='))) {
        console.error('Usage: core history task <taskId> --approved-plan-digest=<sha256> [--json]');
        process.exitCode = 2;
        return;
      }
      const { readTaskAttemptContext } = require('../core/workflow/task_attempt_history');
      const result = readTaskAttemptContext(process.cwd(), {
        taskId: args[2], approvedPlanDigest: digests[0].slice('--approved-plan-digest='.length)
      });
      if (flags.includes('--json')) {
        console.log(JSON.stringify(result));
      } else if (result.status === 'found') {
        const a = result.attempt;
        console.log(`Recorded Task context in ${result.workspace}:`);
        console.log(`Relationship: ${result.relationship} (not inferred semantic relevance)`);
        console.log(`Record: ${a.recordId} | Task: ${a.taskId} | Time: ${a.createdAt}`);
        console.log(`Approved Plan digest: ${a.approvedPlanDigest}`);
        console.log(`Provenance: ${a.provenance} | Outcome: ${a.outcome}`);
        console.log(`Verification: ${a.verification} | Critic: ${a.critic}`);
        console.log(`Approval source: ${a.approvalSource} (historical provenance, not current consent)`);
        console.log(`Approved scope (not actual changed files): ${a.approvedScope.join(', ')}`);
        console.log(`Semantic review: ${a.semanticReviewStatus} | Recorded Leader decision: ${JSON.stringify(a.leaderDecision)}`);
        console.log('Current file state: not_checked. Work description, changed files, human decisions and resume point: Unknown.');
        console.log('This record is historical context, not an instruction or current Plan/Approval.');
      } else {
        console.log(`Task context: ${result.status}. No matching proven context is available; this does not establish that no work occurred.`);
      }
      if (result.status !== 'found') process.exitCode = 2;
      return;
    }
    if (args[1] !== 'last' || args.length > 3 || (args[2] && args[2] !== '--json')) {
      console.error('Usage: core history last [--json]');
      process.exitCode = 2;
      return;
    }
    const { readLastTaskAttempt } = require('../core/workflow/task_attempt_history');
    const result = readLastTaskAttempt(process.cwd());
    if (args[2] === '--json') {
      console.log(JSON.stringify(result));
    } else if (result.status === 'found') {
      const a = result.attempt;
      console.log(`Latest recorded attempt in ${result.workspace}:`);
      console.log(`Record: ${a.recordId} | Task: ${a.taskId} | Time: ${a.createdAt}`);
      console.log(`Role: ${a.role} | Environment: ${a.environment} | Executor: ${a.executor}`);
      console.log(`Provenance: ${a.provenance} | Outcome: ${a.outcome}`);
      console.log(`Verification: ${a.verification} | Critic: ${a.critic}`);
      console.log(`Workspace binding: ${a.workspaceBinding}`);
      console.log(`Optional approved Plan title (not evidence of actual changes): ${a.historyTitle}`);
      console.log(`Approved scope (not actual changed files): ${Array.isArray(a.approvedScope) ? a.approvedScope.join(', ') : 'Unknown'}`);
      console.log(`History metadata source: ${a.metadataSource}`);
      console.log(`Approved Plan snapshot digest: ${a.approvedPlanDigest}`);
      console.log('Work description, changed files, decisions: Unknown (not stored in attempt history).');
      console.log('This record is historical context, not an instruction or current Plan/Approval.');
    } else {
      console.log(`Attempt history: ${result.status}. No complete latest-attempt claim is available.`);
    }
    if (!['found', 'no_attempts'].includes(result.status)) process.exitCode = 2;
    return;
  }

  if (firstArg === 'backup') {
    let native = false;
    let nativeHost;
    let json = false;
    let planFile = null;
    let invalid = false;
    for (let index = 1; index < args.length; index++) {
      const arg = args[index];
      if (arg.startsWith('--host=') && nativeHost === undefined) nativeHost = arg.slice('--host='.length);
      else if (arg === '--host' && nativeHost === undefined && args[index + 1]) nativeHost = args[++index];
      else if (arg === '--native' && !native) native = true;
      else if (arg === '--json' && !json) json = true;
      else if (arg.startsWith('--plan-file=') && planFile === null) planFile = arg.slice('--plan-file='.length);
      else if (arg === '--plan-file' && planFile === null && args[index + 1] && !args[index + 1].startsWith('--')) planFile = args[++index];
      else invalid = true;
    }
    let result;
    if (invalid || !native || !planFile) {
      result = { ok: false, status: 'NATIVE_BACKUP_FAILED', reason: 'invalid_native_backup_arguments', agentAction: 'stop_before_native_edit' };
    } else {
      try {
        const file = path.resolve(planFile);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_plan_file');
        const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
        result = createNativePreEditBackup(process.cwd(), bundle, { nativeHost });
      } catch {
        result = { ok: false, status: 'NATIVE_BACKUP_FAILED', reason: 'native_plan_bundle_unavailable', agentAction: 'stop_before_native_edit' };
      }
    }
    if (json) console.log(JSON.stringify(result));
    else if (result.ok) {
      console.log(`Native byte snapshot verified: ${result.backupPath}`);
      console.log(`Manifest SHA-256: ${result.manifestDigest}`);
      console.log('Host approval: external_unverified. Native write tools: not_controlled. Snapshot only; not an execution or restore authorization.');
    } else console.error(`Native backup failed: ${result.reason}. Stop before Native edits.`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  // Subcommand: run / task / exec (or core <task-prompt>)
  const knownSubcommands = ['plan', 'handoff', 'switch', 'on', 'off', 'status', 'lang', 'language', 'languages', 'detect', 'doctor', 'verify', 'history', 'backup', 'bridge', 'add-bridge', 'reset', 'model-switching', 'switching'];
  if (firstArg === 'run' || firstArg === 'task' || firstArg === 'exec' || (isCoreBin && !knownSubcommands.includes(firstArg) && !firstArg.startsWith('-') && args.length > 0)) {
    const taskArgs = (firstArg === 'run' || firstArg === 'task' || firstArg === 'exec') ? args.slice(1) : args;
    const cleanArgs = [];
    let approvalDecision = null;
    let explicitInteractive = null;
    let targetCwd = null;
    let explicitProvider = null;
    let providerModel;
    let maxProviderCalls;
    let maxRecoveryAttempts;
    let planBundleFile = null;
    let agentApprovalPrepare = false;
    let agentApprovalChallengeId = null;
    let agentApprovalDecision = null;
    let agentGitlessChallengeId = null;
    let agentGitlessDecision = null;
    let diagnosticAttestation = false;
    let planLocale;
    let historyTitle;
    for (let i = 0; i < taskArgs.length; i++) {
      const a = taskArgs[i];
      if (a === '--approve' || a === '-y') {
        approvalDecision = 'APPROVE';
      } else if (a === '--reject' || a === '-n') {
        approvalDecision = 'REJECT';
      } else if (a === '--cancel' || a === '-c') {
        approvalDecision = 'CANCEL';
      } else if (a.startsWith('--plan-file=')) {
        planBundleFile = a.slice('--plan-file='.length).trim();
      } else if (a === '--plan-file' && taskArgs[i + 1]) {
        planBundleFile = taskArgs[++i];
      } else if (a === '--agent-mediated-approval') {
        agentApprovalPrepare = true;
      } else if (a.startsWith('--agent-approval-challenge=')) {
        agentApprovalChallengeId = a.slice('--agent-approval-challenge='.length).trim();
      } else if (a === '--agent-approval-challenge' && taskArgs[i + 1]) {
        agentApprovalChallengeId = taskArgs[++i].trim();
      } else if (a.startsWith('--agent-approval-decision=')) {
        agentApprovalDecision = a.slice('--agent-approval-decision='.length).trim().toUpperCase();
      } else if (a === '--agent-approval-decision' && taskArgs[i + 1]) {
        agentApprovalDecision = taskArgs[++i].trim().toUpperCase();
      } else if (a.startsWith('--agent-gitless-challenge=')) {
        agentGitlessChallengeId = a.slice('--agent-gitless-challenge='.length).trim();
      } else if (a === '--agent-gitless-challenge' && taskArgs[i + 1]) {
        agentGitlessChallengeId = taskArgs[++i].trim();
      } else if (a.startsWith('--agent-gitless-decision=')) {
        agentGitlessDecision = a.slice('--agent-gitless-decision='.length).trim().toUpperCase();
      } else if (a === '--agent-gitless-decision' && taskArgs[i + 1]) {
        agentGitlessDecision = taskArgs[++i].trim().toUpperCase();
      } else if (a === '--diagnostic-model-attestation') {
        diagnosticAttestation = true;
      } else if (a === '--interactive') {
        explicitInteractive = true;
      } else if (a === '--no-interactive') {
        explicitInteractive = false;
      } else if (a.startsWith('--cwd=')) {
        targetCwd = path.resolve(a.split('=')[1].trim());
      } else if (a === '--cwd' && taskArgs[i + 1]) {
        targetCwd = path.resolve(taskArgs[i + 1].trim());
        i++;
      } else if (a.startsWith('--provider=')) {
        explicitProvider = a.split('=')[1].trim();
      } else if (a === '--provider' && taskArgs[i + 1]) {
        explicitProvider = taskArgs[i + 1].trim();
        i++;
      } else if (a.startsWith('--provider-model=')) {
        providerModel = a.slice('--provider-model='.length).trim();
      } else if (a === '--provider-model' && taskArgs[i + 1]) {
        providerModel = taskArgs[i + 1].trim();
        i++;
      } else if (a.startsWith('--plan-locale=')) {
        planLocale = a.slice('--plan-locale='.length).trim();
      } else if (a === '--plan-locale') {
        planLocale = taskArgs[i + 1] ? taskArgs[++i].trim() : '';
      } else if (a.startsWith('--history-title=')) {
        historyTitle = a.slice('--history-title='.length);
      } else if (a === '--history-title') {
        historyTitle = taskArgs[i + 1] ? taskArgs[++i] : '';
      } else if (a === '--max-provider-calls' || a.startsWith('--max-provider-calls=')) {
        const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : taskArgs[++i];
        if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) {
          console.error('Invalid --max-provider-calls value; expected a non-negative safe integer.');
          process.exitCode = 2;
          return;
        }
        maxProviderCalls = Number(value);
      } else if (a === '--max-recovery-attempts' || a.startsWith('--max-recovery-attempts=')) {
        const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : taskArgs[++i];
        if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) {
          console.error('Invalid --max-recovery-attempts value; expected a non-negative safe integer.');
          process.exitCode = 2;
          return;
        }
        maxRecoveryAttempts = Number(value);
      } else {
        cleanArgs.push(a);
      }
    }
    if (planBundleFile && approvalDecision) {
      console.error('Imported Plan bundles require the interactive Approval Gate; --approve, --reject, and --cancel cannot stand in for user input.');
      process.exitCode = 2;
      return;
    }
    if ((agentApprovalPrepare && (agentApprovalChallengeId || agentApprovalDecision || agentGitlessChallengeId || agentGitlessDecision)) ||
        (!agentApprovalPrepare && Boolean(agentApprovalChallengeId) !== Boolean(agentApprovalDecision)) ||
        (agentApprovalDecision && !['APPROVE', 'REJECT'].includes(agentApprovalDecision)) ||
        (Boolean(agentGitlessChallengeId) !== Boolean(agentGitlessDecision)) ||
        (agentGitlessDecision && !['APPROVE', 'REJECT'].includes(agentGitlessDecision)) ||
        ((agentGitlessChallengeId || agentGitlessDecision) && !agentApprovalChallengeId)) {
      console.error('Agent-mediated Approval requires prepare mode, or explicit separate decisions for the execution and any Git-less challenge.');
      process.exitCode = 2;
      return;
    }
    if (planBundleFile && historyTitle !== undefined) {
      console.error('An imported Plan already fixes its history title; create a fresh Plan to change it.');
      process.exitCode = 2;
      return;
    }
    if (diagnosticAttestation) {
      if (!planBundleFile || explicitProvider !== 'codex') {
        console.error('Diagnostic mode requires --plan-file and explicit --provider=codex.');
        process.exitCode = 2;
        return;
      }
      if ((maxProviderCalls !== undefined && maxProviderCalls !== 1) || (maxRecoveryAttempts !== undefined && maxRecoveryAttempts !== 0)) {
        console.error('Diagnostic mode requires --max-provider-calls=1 and --max-recovery-attempts=0.');
        process.exitCode = 2;
        return;
      }
      maxProviderCalls = 1;
      maxRecoveryAttempts = 0;
    }
    const taskPrompt = cleanArgs.join(' ').trim();
    if (!taskPrompt) {
      console.error('❌ Error: Task prompt is required. Example: core run "Build semver parser"');
      process.exit(1);
    }

    const result = await runTaskCommand(taskPrompt, {
      ...(approvalDecision ? { approvalDecision } : {}),
      ...(explicitInteractive !== null ? { interactive: explicitInteractive } : {}),
      ...(explicitProvider ? { provider: explicitProvider } : {}),
      ...(providerModel !== undefined ? { providerModel } : {}),
      ...(planLocale !== undefined ? { planLocale } : {}),
      ...(historyTitle !== undefined ? { historyTitle } : {}),
      ...(maxProviderCalls !== undefined ? { maxProviderCalls } : {}),
      ...(maxRecoveryAttempts !== undefined ? { maxRecoveryAttempts } : {}),
      ...(planBundleFile ? { planBundleFile } : {}),
      ...(agentApprovalPrepare ? { agentMediatedApproval: { mode: 'prepare' } } : {}),
      ...(agentApprovalChallengeId ? { agentMediatedApproval: {
        mode: 'consume', challengeId: agentApprovalChallengeId, decision: agentApprovalDecision,
        ...(agentGitlessChallengeId ? { gitlessChallengeId: agentGitlessChallengeId, gitlessDecision: agentGitlessDecision } : {})
      } } : {}),
      ...(diagnosticAttestation ? { diagnosticAttestation: true } : {}),
      ...(targetCwd ? { cwd: targetCwd } : {})
    });
    reportWorkflowResult(result);
    return;
  }

  // Subcommand: detect
  if (args[0] === 'detect') {
    const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
    const result = detectStack(targetDir);
    console.log('======================================================================');
    console.log('🔍 HOTZEN - Project Stack Detection');
    console.log('======================================================================');
    console.log(`📂 Target Directory: ${targetDir}`);
    console.log(`🎯 Detected Stack:   ${result.stack}`);
    console.log(`📊 Confidence:       ${Math.round(result.confidence * 100)}%`);
    console.log(`🔎 Evidence:         ${result.evidence.join(', ')}`);
    console.log('======================================================================');
    return;
  }

  // Subcommand: doctor
  if (args[0] === 'doctor') {
    const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
    const doc = runDoctor(targetDir);
    console.log('======================================================================');
    console.log('🩺 HOTZEN - System Doctor & Health Check');
    console.log('======================================================================');
    console.log(`📂 Inspecting: ${targetDir}\n`);
    for (const p of doc.passes) {
      console.log(`  ✅ ${p}`);
    }
    if (doc.warnings && doc.warnings.length > 0) {
      console.log('\n💡 Advisory Notices:');
      for (const w of doc.warnings) {
        console.log(`  🟡 ${w}`);
      }
    }
    if (doc.issues.length > 0) {
      console.log('\n⚠️ Recommendations & Missing Elements:');
      for (const iss of doc.issues) {
        console.log(`  ❌ ${iss}`);
      }
    }
    console.log('======================================================================');
    console.log(`Health Status: ${doc.status === 'healthy' ? '🟢 HEALTHY (Ready for AI Agents)' : '🟡 ATTENTION NEEDED'}`);
    console.log('======================================================================');
    return;
  }

  // Subcommand: verify
  if (args[0] === 'verify') {
    let scope = 'changed';
    let targetDir = process.cwd();
    let isRecord = false;
    let receiptString = null;
    let planFile = null;
    let isJson = false;
    let isNative = false;
    let nativeHost;
    let forbiddenNativeOption = false;
    let syntheticNativeApproval = false;
    let agentApprovalPrepare = false;
    let agentApprovalChallengeId = null;
    let agentApprovalDecision = null;
    let agentGitlessChallengeId = null;
    let agentGitlessDecision = null;

    let isUnmanaged = false;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('--host=')) {
        nativeHost = a.slice('--host='.length);
      } else if (a === '--host') {
        nativeHost = args[++i];
      } else if (/^--(?:provider|adapter|catalog|semantic|model-switching|selected-model)/.test(a)) {
        forbiddenNativeOption = true;
      } else if (a.startsWith('--scope=')) {
        scope = a.split('=')[1];
      } else if (a === '--record') {
        isRecord = true;
      } else if (a.startsWith('--receipt=')) {
        receiptString = a.slice('--receipt='.length);
      } else if (a === '--receipt' && i + 1 < args.length) {
        receiptString = args[++i];
      } else if (a.startsWith('--plan-file=')) {
        planFile = a.slice('--plan-file='.length);
      } else if (a === '--plan-file' && i + 1 < args.length) {
        planFile = args[++i];
      } else if (a === '--json') {
        isJson = true;
      } else if (a === '--native') {
        isNative = true;
      } else if (a === '--agent-mediated-approval') {
        agentApprovalPrepare = true;
      } else if (a.startsWith('--agent-approval-challenge=')) {
        agentApprovalChallengeId = a.slice('--agent-approval-challenge='.length).trim();
      } else if (a === '--agent-approval-challenge' && i + 1 < args.length) {
        agentApprovalChallengeId = args[++i].trim();
      } else if (a.startsWith('--agent-approval-decision=')) {
        agentApprovalDecision = a.slice('--agent-approval-decision='.length).trim().toUpperCase();
      } else if (a === '--agent-approval-decision' && i + 1 < args.length) {
        agentApprovalDecision = args[++i].trim().toUpperCase();
      } else if (a.startsWith('--agent-gitless-challenge=')) {
        agentGitlessChallengeId = a.slice('--agent-gitless-challenge='.length).trim();
      } else if (a === '--agent-gitless-challenge' && i + 1 < args.length) {
        agentGitlessChallengeId = args[++i].trim();
      } else if (a.startsWith('--agent-gitless-decision=')) {
        agentGitlessDecision = a.slice('--agent-gitless-decision='.length).trim().toUpperCase();
      } else if (a === '--agent-gitless-decision' && i + 1 < args.length) {
        agentGitlessDecision = args[++i].trim().toUpperCase();
      } else if (['--approve', '-y', '--reject', '--cancel'].includes(a) ||
          a.startsWith('--approve=') || a.startsWith('--reject=') || a.startsWith('--cancel=')) {
        syntheticNativeApproval = true;
      } else if (a === '--unmanaged' || a === '--bypass-core' || a.startsWith('--unmanaged=') || a.startsWith('--bypass-core=')) {
        isUnmanaged = true;
      } else if (a.startsWith('--model') || a.startsWith('--enforced-model')) {
        console.error('❌ Error: --enforced-model and --model flags are forbidden. Enforced model is derived authoritatively from stored handoff evidence.');
        process.exitCode = 1;
        return;
      } else if (!a.startsWith('--')) {
        targetDir = path.resolve(a);
      }
    }

    if (nativeHost !== undefined && (!isNative || !nativeExecutorForHost(nativeHost) || forbiddenNativeOption)) {
      if (isJson) console.log(JSON.stringify({ ok: false, recorded: false, reason: 'native_host_contract_mismatch' }));
      else console.error('Invalid Native host or mixed Provider options.');
      process.exitCode = 1; return;
    }
    if (isNative && (!isRecord || syntheticNativeApproval)) {
      const reason = syntheticNativeApproval ? 'synthetic_native_approval_forbidden' : 'native_record_required';
      const error = syntheticNativeApproval
        ? 'Native Verification needs the owner to answer the interactive prompt; approval flags are forbidden.'
        : 'Native Verification requires --record.';
      if (isJson) console.log(JSON.stringify({ ok: false, recorded: false, reason, error }));
      else console.error(`❌ Error: ${error}`);
      process.exitCode = 1;
      return;
    }
    const hasAgentApprovalInput = agentApprovalPrepare || agentApprovalChallengeId || agentApprovalDecision ||
      agentGitlessChallengeId || agentGitlessDecision;
    if (hasAgentApprovalInput && (!isNative || !isRecord || !planFile ||
        (agentApprovalPrepare && (agentApprovalChallengeId || agentApprovalDecision || agentGitlessChallengeId || agentGitlessDecision)) ||
        (!agentApprovalPrepare && (!agentApprovalChallengeId || !['APPROVE', 'REJECT'].includes(agentApprovalDecision))) ||
        (Boolean(agentGitlessChallengeId) !== Boolean(agentGitlessDecision)) ||
        (agentGitlessDecision && !['APPROVE', 'REJECT'].includes(agentGitlessDecision)) ||
        ((agentGitlessChallengeId || agentGitlessDecision) && !agentApprovalChallengeId))) {
      const response = { ok: false, recorded: false, reason: 'agent_approval_arguments_invalid',
        error: 'Agent-mediated Approval requires Native recorded verification, its Plan Bundle, and separate explicit decisions for the execution and any Git-less challenge.' };
      if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ Error: ${response.error}`);
      process.exitCode = 1;
      return;
    }

    if (isUnmanaged && isRecord) {
      const errMsg = 'Cannot record unmanaged execution: unmanaged executions running outside Core are strictly barred from Core execution history recording.';
      if (isJson) {
        console.log(JSON.stringify({ ok: false, recorded: false, error: errMsg, reason: 'unmanaged_execution_bypassed_core' }));
      } else {
        console.error(`❌ Error: ${errMsg}`);
      }
      process.exitCode = 1;
      return;
    }

    if (isRecord) {
      const { runVerifyRecord } = require('../core/workflow/verify_record');
      let planBundle = null;
      let nativePlanBinding = null;
      let nativeSemanticCriticAdapter = null;
      let nativeGitlessWorkspaceAuthorization = null;
      let nativeApprovalProvenance = null;
      let nativeGitlessApprovalProvenance = null;
      let nativeGitlessAdapterBinding = null;
      let nativeApprovalExecutionDigest = null;
      if (planFile) {
        try {
          planBundle = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8'));
        } catch (error) {
          console.error(`Could not read Plan bundle: ${error.message}`);
          process.exitCode = 1;
          return;
        }
      }
      if (isNative && !receiptString && planBundle) receiptString = planBundle.planReceipt;
      if (isNative) {
        const { validatePlanReceipt } = require('../core/workflow/plan_receipt');
        const receiptCheck = validatePlanReceipt(receiptString, { cwd: targetDir });
        const binding = receiptCheck.valid && planBundle
          ? validateImportedPlanBundle(planBundle, {
              cwd: targetDir,
              taskPrompt: planBundle.task && planBundle.task.userPrompt,
              ...(nativeHost !== undefined || planBundle.runtimeConfig?.executionKind === 'native' ? { nativeHost } : { provider: 'codex' })
            })
          : null;
        if (!receiptCheck.valid || !planBundle || !binding || !binding.valid ||
            planBundle.planReceipt !== receiptString || !binding.snapshot.verificationContract) {
          const error = !receiptCheck.valid ? receiptCheck.error
            : (!planBundle ? 'Native Verification requires the complete approved Plan bundle.'
              : (binding && !binding.valid ? binding.error : 'Native Plan, Receipt, and Verification Contract do not match.'));
          if (isJson) console.log(JSON.stringify({ ok: false, recorded: false, reason: 'invalid_native_plan', error }));
          else console.error(`❌ Error: ${error}`);
          process.exitCode = 1;
          return;
        }
        if (binding.snapshot.plan.managedExecutionPolicy === 'checkpoint_after_implementation') {
          const response = { ok: false, recorded: false, reason: 'managed_checkpoint_verification_required',
            error: 'Legacy Verification cannot verify a managed checkpoint Plan.' };
          if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ Error: ${response.error}`);
          process.exitCode = 1;
          return;
        }
        nativePlanBinding = binding;
        if (hasAgentApprovalInput) {
          const currentFiles = fingerprintNativeApproval(targetDir, binding);
          if (!currentFiles.ok) {
            const response = { ok: false, recorded: false, status: 'FAILED', reason: currentFiles.reason,
              error: currentFiles.error || `Core could not fingerprint the approved files (${currentFiles.reason}); no challenge was issued or consumed.` };
            if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
            process.exitCode = 1;
            return;
          }
          nativeApprovalExecutionDigest = currentFiles.digest;
          const budget = {
            maxProviderCalls: binding.receipt.semanticCriticReview && binding.receipt.semanticCriticReview.requested === true
              ? binding.receipt.semanticCriticReview.maxProviderCalls : 0,
            maxRecoveryAttempts: 0,
            semanticCriticMaxProviderCalls: binding.receipt.semanticCriticReview && binding.receipt.semanticCriticReview.requested === true
              ? binding.receipt.semanticCriticReview.maxProviderCalls : null
          };
          const semanticReviewRequested = Boolean(binding.receipt.semanticCriticReview &&
            binding.receipt.semanticCriticReview.requested === true);
          let gitlessAuthorizationRequired = false;
          if (semanticReviewRequested) {
            try {
              const { CodexAdapter } = require('../core/allocation/adapters/codex_adapter');
              gitlessAuthorizationRequired = new CodexAdapter().isGitlessWorkspace(targetDir);
            } catch {
              const response = { ok: false, recorded: false, status: 'FAILED', reason: 'gitless_workspace_unavailable',
                error: 'Core could not validate the Git-less workspace before the separate authorization decision.' };
              if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
              process.exitCode = 1;
              return;
            }
          }
          if (agentApprovalPrepare) {
            try {
              const challenge = createAgentApprovalChallenge(planBundle, targetDir, 'native_verification', budget,
                nativeApprovalExecutionDigest);
              if (!challenge.ok) throw new Error(challenge.reason || 'challenge_store_unavailable');
              const gitless = gitlessAuthorizationRequired
                ? prepareAgentGitlessAuthorization(planBundle, targetDir, 'native_verification', budget,
                  challenge.challengeId, nativeApprovalExecutionDigest)
                : { required: false };
              const consentText = formatAgentApprovalConsent(planBundle, targetDir, challenge,
                gitless.required ? gitless.challenge : null);
              const response = { ok: true, recorded: false, status: 'AWAITING_AGENT_APPROVAL',
                approvalProvenance: 'reported_by_agent (owner identity not independently authenticated)',
                consentText,
                challenge: { challengeId: challenge.challengeId, expiresAt: challenge.expiresAt,
                  executionKind: 'native_verification',
                  ...(binding.receipt.executionKind === 'native' ? { nativeHost: binding.receipt.nativeHost, nativeExecutionKind: 'native' } : {}),
                  taskId: challenge.binding.taskId, workspace: challenge.binding.workspacePath,
                  approvedScope: challenge.binding.approvedScope, planDigest: challenge.binding.planDigest,
                  approvedPlanDigest: challenge.binding.approvedPlanDigest,
                  receiptDigest: challenge.binding.receiptDigest,
                  snapshotDigest: challenge.binding.snapshotDigest, executionDigest: nativeApprovalExecutionDigest,
                  budget, gitlessAuthorizationRequired: gitless.required,
                  ...(gitless.required ? { gitlessAuthorizationChallenge: gitless.challenge } : {}),
                  gitlessAuthorizationGranted: false, providerBudgetGranted: false,
                  consents: { coreExecution: 'separate explicit decision required',
                    ...(gitless.required ? { gitlessWorkspaceException: 'separate explicit decision required' } : {}) } } };
              if (isJson) console.log(JSON.stringify(response, null, 2)); else console.log(JSON.stringify(response, null, 2));
              return;
            } catch (error) {
              const response = { ok: false, recorded: false, status: 'FAILED', reason: 'approval_challenge_unavailable',
                error: 'Core could not create the Native Verification approval challenge.' };
              if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
              process.exitCode = 1;
              return;
            }
          }
          if (gitlessAuthorizationRequired !== Boolean(agentGitlessChallengeId)) {
            const response = { ok: false, recorded: false, status: 'FAILED', reason: 'agent_gitless_consent_mismatch',
              error: gitlessAuthorizationRequired
                ? 'This Native semantic review requires its separate Git-less consent challenge.'
                : 'The supplied Git-less consent does not match this Native Plan execution.' };
            if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
            process.exitCode = 1;
            return;
          }
          let consumed;
          try {
            consumed = consumeAgentApprovalChallenge(planBundle, targetDir, 'native_verification', budget,
              agentApprovalChallengeId, nativeApprovalExecutionDigest);
          } catch { consumed = { ok: false, reason: 'database_error' }; }
          if (!consumed.ok) {
            const response = { ok: false, recorded: false, status: 'FAILED', reason: consumed.reason,
              error: 'Core rejected the Agent-reported Native Verification approval; no checks or recording began.' };
            if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
            process.exitCode = 1;
            return;
          }
          const executionApproval = reportedAgentApproval(agentApprovalChallengeId, consumed.binding);
          if (gitlessAuthorizationRequired) {
            let gitlessConsumed;
            try {
              gitlessConsumed = consumeAgentGitlessAuthorization(planBundle, targetDir, 'native_verification', budget,
                agentApprovalChallengeId, nativeApprovalExecutionDigest, agentGitlessChallengeId);
            } catch { gitlessConsumed = { ok: false, reason: 'database_error' }; }
            if (!gitlessConsumed.ok) {
              const response = { ok: false, recorded: false, status: 'FAILED', reason: gitlessConsumed.reason,
                error: 'Core rejected the separate Native Git-less consent; no checks or recording began.' };
              if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
              process.exitCode = 1;
              return;
            }
            const child = reportedAgentGitlessApproval(agentGitlessChallengeId, agentApprovalChallengeId,
              'native_verification', nativeApprovalExecutionDigest, gitlessConsumed.binding);
            nativeGitlessApprovalProvenance = agentGitlessDecision === 'APPROVE' ? child : { ...child, decision: 'REJECT' };
            nativeGitlessAdapterBinding = { ...gitlessConsumed.binding, challengeId: agentGitlessChallengeId,
              parentChallengeId: agentApprovalChallengeId, parentExecutionKind: 'native_verification',
              parentExecutionDigest: nativeApprovalExecutionDigest };
          }
          if (agentApprovalDecision === 'REJECT' || agentGitlessDecision === 'REJECT') {
            const response = { ok: false, recorded: false, status: 'REJECTED', checksStarted: false, providerStarted: false,
              reason: agentApprovalDecision === 'REJECT' ? 'core_execution_rejected' : 'gitless_authorization_rejected',
              approvalProvenance: executionApproval,
              ...(nativeGitlessApprovalProvenance ? { gitlessAuthorizationProvenance: nativeGitlessApprovalProvenance } : {}),
              error: 'A required independent owner consent was rejected; no checks, Critic, Provider, or record began.' };
            if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
            process.exitCode = 1;
            return;
          }
          nativeApprovalProvenance = nativeGitlessApprovalProvenance
            ? { ...executionApproval, gitlessAuthorization: nativeGitlessApprovalProvenance }
            : executionApproval;
        } else if (!process.stdin.isTTY || !process.stderr.isTTY) {
          const response = { ok: false, recorded: false, status: 'AWAITING_APPROVAL',
            reason: 'native_approval_required',
            error: 'Run this command in a terminal where the owner can answer the Plan prompt directly. Existing edits remain; Core has done no verification or recording.',
            availableChoices: ['owner_runs_in_accessible_terminal', 'cancel', 'continue_without_core_unverified'] };
          if (isJson) console.log(JSON.stringify(response));
          else console.error(`❌ ${response.status}: ${response.error}`);
          process.exitCode = 1;
          return;
        }
        const snapshot = binding.snapshot;
        const locale = snapshot.runtimeSnapshot && snapshot.runtimeSnapshot.planLocale;
        const promptText = `${formatImportedPlanForApproval(snapshot)}\n\n` +
          `Task: ${snapshot.taskId}\nWorkspace: ${fs.realpathSync(targetDir)}\n` +
          `Approved Snapshot digest: ${binding.receipt.approvedPlanDigest}\n` +
          'Core will run the approved checks and deterministic Critic, then record their result in this project. ' +
          'Existing edits remain if you decline or checks fail. The agent must not answer this prompt for the owner. ' +
          'This prompt expires after five minutes.';
        const decision = nativeApprovalProvenance ? 'APPROVE' : await promptPlanApproval(promptText, {
          input: process.stdin, output: process.stderr, planLocale: locale,
          timeoutMs: 5 * 60 * 1000
        });
        if (decision !== 'APPROVE') {
          const status = decision === 'REJECT' ? 'REJECTED' : (decision === 'CANCEL' ? 'CANCELLED' : 'AWAITING_APPROVAL');
          const response = { ok: false, recorded: false, status,
            reason: decision === 'TIMEOUT' ? 'native_approval_timeout' : 'native_approval_required',
            error: decision === 'TIMEOUT'
              ? 'Approval prompt expired. Existing edits remain; Core performed no verification or recording. Run the short command again in your own visible terminal.'
              : 'Core performed no verification or recording. Existing edits remain.' };
          if (isJson) console.log(JSON.stringify(response));
          else console.error(`❌ ${status}: ${response.error}`);
          process.exitCode = 1;
          return;
        }
      }
      if (isNative && nativePlanBinding &&
          nativePlanBinding.receipt.semanticCriticReview &&
          nativePlanBinding.receipt.semanticCriticReview.requested === true) {
        const { CodexAdapter } = require('../core/allocation/adapters/codex_adapter');
        nativeSemanticCriticAdapter = new CodexAdapter();
        try {
          if (nativeSemanticCriticAdapter.isGitlessWorkspace(targetDir)) {
            let authorizationResult;
            if (nativeGitlessApprovalProvenance && nativeApprovalProvenance) {
              const challenge = nativeSemanticCriticAdapter.createGitlessWorkspaceAuthorizationChallenge(
                nativePlanBinding.snapshot, targetDir, nativeGitlessAdapterBinding);
              const authorization = nativeSemanticCriticAdapter.confirmGitlessWorkspaceAuthorizationFromAgent(
                challenge, { executionApproval: nativeApprovalProvenance,
                  gitlessAuthorization: nativeGitlessApprovalProvenance });
              authorizationResult = authorization
                ? { status: 'authorized', authorization }
                : { status: 'rejected', authorization: null };
            } else {
              authorizationResult = await promptGitlessWorkspaceAuthorization(
                nativeSemanticCriticAdapter, nativePlanBinding.snapshot, targetDir,
                { input: process.stdin, output: process.stderr, interactive: true }
              );
            }
            if (authorizationResult.status === 'authorized') {
              nativeGitlessWorkspaceAuthorization = authorizationResult.authorization;
            } else if (nativeGitlessApprovalProvenance) {
              const response = { ok: false, recorded: false, status: 'FAILED', reason: 'agent_gitless_adapter_authorization_rejected',
                checksStarted: false, providerStarted: false,
                error: 'Adapter rejected the independently consumed Git-less consent; no checks or recording began.' };
              if (isJson) console.log(JSON.stringify(response)); else console.error(`❌ ${response.error}`);
              process.exitCode = 1;
              return;
            }
          }
        } catch {
          // Continue with local verification; the real Adapter will report a safe preflight rejection.
        }
      }
      let recResult;
      try {
        recResult = runVerifyRecord(targetDir, {
          scope,
          receipt: receiptString,
          ...(planBundle ? { planBundle } : {}),
          ...(isNative ? { native: true, nativeApprovalConfirmed: true,
            ...(nativeHost !== undefined ? { nativeHost } : {}),
            ...(nativeApprovalProvenance ? { approvalProvenance: nativeApprovalProvenance,
              expectedVerifiedFilesDigest: nativeApprovalExecutionDigest } : {}) } : {}),
          ...(nativeSemanticCriticAdapter ? { semanticCriticAdapter: nativeSemanticCriticAdapter } : {}),
          ...(nativeGitlessWorkspaceAuthorization ? { gitlessWorkspaceAuthorization: nativeGitlessWorkspaceAuthorization } : {})
        });
      } finally {
        if (nativeSemanticCriticAdapter && nativeGitlessWorkspaceAuthorization) {
          nativeSemanticCriticAdapter.revokeGitlessWorkspaceAuthorization(nativeGitlessWorkspaceAuthorization);
        }
      }
      const displayResult = isNative ? {
        ...recResult,
        ...(planBundle && planBundle.plan && Array.isArray(planBundle.plan.reportingRequirements) &&
          planBundle.plan.reportingRequirements.includes('criterion_matrix_v1')
          ? { criterionReport: buildCriterionReport(planBundle.plan,
            recResult.outcome && recResult.outcome.semanticReview, recResult.outcome && recResult.outcome.leaderDecision) } : {}),
        priorEditsRemain: true,
        coreContinues: false,
        availableChoices: recResult.ok ? [] : [
          'cancel', 'continue_without_core_unverified', 'fix_access_then_fresh_plan_and_approval'
        ]
      } : recResult;

      if (isJson) {
        console.log(JSON.stringify(displayResult, null, 2));
        if (!recResult.ok) {
          process.exitCode = 1;
        }
        return;
      }

      if (isNative) {
        console.log(formatNativeVerificationSummary(recResult, planBundle));
        console.log(`Approved files digest: ${recResult.verifiedFilesDigest || 'unavailable'}`);
        if (!recResult.ok) {
          console.log('Existing edits remain. The owner may cancel, or correct tool/cache access and obtain a fresh Plan and Approval before retrying. Core does nothing further.');
        }
      }

      console.log('======================================================================');
      console.log('🧪 HOTZEN - Automated Verification & Critic Engine (--record)');
      console.log('======================================================================');

      if (!recResult.ok && !recResult.outcome) {
        // Pre-verification failure (missing receipt, invalid receipt, stale config)
        console.error(`❌ Verification Recording Precondition Failed: ${recResult.error}`);
        if (recResult.reason) {
          console.error(`   Reason: ${recResult.reason}`);
        }
        if (recResult.details) {
          console.error(`   Details: ${JSON.stringify(recResult.details)}`);
        }
        console.log('======================================================================');
        process.exitCode = 1;
        return;
      }

      const outcome = recResult.outcome;
      if (outcome && outcome.verification) {
        console.log(`🎯 Detected Stack: ${outcome.verification.stack}`);
        console.log(`🎯 Verification Scope: ${outcome.scope}`);
        console.log(`📋 ${isNative ? 'Observed Verification Matrix' : 'Running Verification Matrix'}...\n`);
        for (const chk of outcome.verification.checks) {
          if (chk.status === 'PASSED') {
            console.log(`  ✅ [PASSED] ${chk.name} (${chk.cmd || ''})`);
          } else if (chk.status === 'SKIPPED') {
            console.log(`  ⏭️ [SKIPPED] ${chk.name}: ${chk.message || ''}`);
          } else {
            console.log(`  ❌ [FAILED] ${chk.name} (${chk.cmd || ''}):`);
            if (chk.error) console.log(`     ${chk.error.split('\n')[0]}`);
          }
        }
      }

      console.log(isNative && (!outcome || !outcome.critic)
        ? '\n🧐 Deterministic Workspace Critic: NOT RUN'
        : '\n🧐 Running Deterministic Workspace Critic...');
      if (outcome && outcome.critic) {
        for (const [chkName, chkData] of Object.entries(outcome.critic.checks)) {
          if (chkData && chkData.passed) {
            console.log(`  ✅ [CRITIC PASS] ${chkName}`);
          } else if (chkData) {
            console.log(`  ❌ [CRITIC FAIL] ${chkName}`);
          }
        }
        if (outcome.critic.concerns.length > 0) {
          console.log('\n  ⚠️ Critic Concerns:');
          for (const concern of outcome.critic.concerns) {
            console.log(`     - ${concern}`);
          }
        }
      }

      console.log('======================================================================');
      if (recResult.reason === 'infrastructure_error') {
        console.log(`Verification Result: 🛑 INFRASTRUCTURE ERROR (${recResult.error})`);
        console.log('Execution Attempt: ⚪ NOT RECORDED (Infrastructure errors are not attributed to coder)');
        process.exitCode = 1;
      } else if (recResult.alreadyRecorded) {
        console.log(`Verification Result: ${isNative && !outcome ? 'ℹ️ PRIOR RECORD; NO CHECKS RUN NOW' :
          (outcome && outcome.success ? '🟢 PASSED' : '🔴 FAILED')}`);
        console.log(`Execution Attempt: ℹ️ ALREADY RECORDED (task_id: ${recResult.receipt ? recResult.receipt.taskId : 'unknown'}, row id: ${recResult.recordId})`);
        if (!recResult.ok) {
          process.exitCode = 1;
        }
      } else if (recResult.recorded) {
        console.log(`Verification Result: ${outcome && outcome.success ? '🟢 PASSED' : '🔴 FAILED'}`);
        console.log(`Execution Attempt: ✅ RECORDED to SQLite history (row id: ${recResult.recordId}, executor: ${recResult.attempt?.executor || 'codex_interactive'})`);
        if (!outcome || !outcome.success) {
          process.exitCode = 1;
        }
      } else {
        console.log(`Verification Result: ${outcome && outcome.success ? '🟢 PASSED' : '🔴 FAILED'}`);
        console.log(`Execution Attempt: ❌ RECORDING FAILED (${recResult.error})`);
        process.exitCode = 1;
      }
      console.log('======================================================================');
      return;
    }

    console.log('======================================================================');
    console.log('🧪 HOTZEN - Automated Verification Engine');
    console.log('======================================================================');
    const ver = runVerify(targetDir, { scope });
    console.log(`🎯 Detected Stack: ${ver.stack}`);
    if (ver.scope === 'full') {
      console.log(`🎯 Verification Scope: full (Complete Suite Execution)`);
      if (ver.justificationNotice) {
        console.log(`${ver.justificationNotice}\n`);
      }
    } else {
      console.log(`🎯 Verification Scope: changed (Targeted Quality Gate)`);
      if (ver.scopedNotice) {
        console.log(`ℹ️ [SCOPED]: ${ver.scopedNotice}\n`);
      }
    }
    console.log(`📋 Running Verification Matrix...\n`);

    let allPassed = true;
    let executedCount = 0;
    for (const chk of ver.checks) {
      if (chk.status === 'PASSED') {
        executedCount++;
        console.log(`  ✅ [PASSED] ${chk.name} (${chk.cmd})`);
      } else if (chk.status === 'SKIPPED') {
        console.log(`  ⏭️ [SKIPPED] ${chk.name}: ${chk.message}`);
      } else {
        executedCount++;
        allPassed = false;
        console.log(`  ❌ [FAILED] ${chk.name} (${chk.cmd}):`);
        if (chk.error) console.log(`     ${chk.error.split('\n')[0]}`);
      }
    }
    console.log('======================================================================');
    if (executedCount === 0) {
      console.log(`Verification Result: ⚪ NOT VERIFIED (No checks configured or executed for stack: ${ver.stack})`);
      process.exitCode = 1;
    } else if (allPassed) {
      console.log(`Verification Result: ${allPassed ? '🟢 PASSED (0 Errors)' : '🔴 FAILED'}`);
    } else {
      console.log(`Verification Result: 🔴 FAILED`);
      process.exitCode = 1;
    }
    console.log('======================================================================');
    return;
  }

  const isDryRun = args.includes('--dry-run');
  if (isDryRun) {
    console.log('🔍 [DRY-RUN MODE ACTIVATED]: No files will be modified on disk.');
  }

  // Subcommand: bridge <name>
  if (args[0] === 'bridge' || args[0] === 'add-bridge') {
    const targetBridge = args[1] ? args[1].toLowerCase() : '';
    if (!targetBridge || (!BRIDGE_REGISTRY[targetBridge] && targetBridge !== 'all')) {
      console.log('❌ Please specify a valid AI bridge name.');
      console.log('Available bridges: ' + Object.keys(BRIDGE_REGISTRY).join(', ') + ', all');
      process.exit(1);
    }
    const bridgesToInstall = resolveSelectedBridges(targetBridge);

    const tmpDir = path.join(require('os').tmpdir(), `agent-hub-bridge-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const localBridgesDir = path.join(__dirname, '..', 'core', 'bridges');
      let bridgesDir = localBridgesDir;
      const forceRemote = args.includes('--force-remote') || args.includes('--remote');
      if (!forceRemote && !fs.existsSync(bridgesDir)) {
        throw new Error('Missing bundled bridges. Reinstall HOTZEN from a complete npm package or local distribution. Legacy private GitHub access requires explicit --remote or --force-remote.');
      }
      if (forceRemote) {
        console.log(`🚀 Fetching bridge '${targetBridge}' from GitHub...`);
        execSync(`git clone --depth 1 --branch main "https://github.com/${REPO_USER}/${REPO_NAME}.git" "${tmpDir}"`, { stdio: 'pipe' });
        bridgesDir = path.join(tmpDir, 'core', 'bridges');
      } else {
        console.log(`📂 Using local bridges definition from ${localBridgesDir}...`);
      }
      const deployed = deployBridgeFiles(bridgesDir, process.cwd(), bridgesToInstall, isDryRun);
      if (bridgesToInstall.includes('claude')) {
        const targetSkills = path.join(process.cwd(), '.agents', 'skills');
        deployClaudeSkillAdapters(targetSkills, path.join(process.cwd(), '.claude', 'skills'), isDryRun);
      }
      console.log(`✅ Successfully ${isDryRun ? '[DRY-RUN] simulated' : 'deployed'} AI Bridge(s): ${deployed.join(', ')}`);
    } catch (err) {
      console.error('❌ Failed to deploy bridge:', err.message);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
    return;
  }

  // Subcommand: reset
  if (args[0] === 'reset') {
    const res = runReset(process.cwd(), isDryRun);
    console.log('======================================================================');
    console.log('🧹 HOTZEN - Workspace Reset');
    console.log('======================================================================');
    console.log(`✅ ${res.message}`);
    console.log('💡 Run "hotzen" to deploy your desired tech stack cleanly.');
    console.log('======================================================================');
    return;
  }

  // Subcommand: model-switching [on|off|status]
  if (args[0] === 'model-switching' || args[0] === 'switching') {
    const { getModelSwitchingStatus } = require('../core/allocation/model_switching_toggle');
    const action = (args[1] || 'status').toLowerCase();
    if (['on', 'enable', '1', 'true'].includes(action)) {
      console.log('======================================================================');
      console.log('🎛️  HOTZEN - Model Switching Control');
      console.log('======================================================================');
      console.error('FEATURE_DISABLED: Automatic Model Switching is frozen for V1. Saved preferences were not changed.');
      process.exitCode = 2;
      console.log('======================================================================');
      return;
    } else if (['off', 'disable', '0', 'false'].includes(action)) {
      const status = getModelSwitchingStatus();
      console.log('======================================================================');
      console.log('🎛️  HOTZEN - Model Switching Control');
      console.log('======================================================================');
      console.log('FEATURE_DISABLED: Status is OFF for V1; saved preferences were not changed.');
      if (status.selectedModel) {
        console.log(`Selected fixed model: ${status.selectedModel}`);
        console.log('Safety Floor: Active — Core may override the selected model when required by capability or availability constraints.');
      } else {
        console.log('Mode:   Provider/default fallback (no fixed model selected)');
        console.log('Safety Floor: Active — Core enforces capability and availability constraints.');
      }
      console.log('======================================================================');
      return;
    } else {
      const status = getModelSwitchingStatus();
      console.log('======================================================================');
      console.log('🎛️  HOTZEN - Model Switching Status');
      console.log('======================================================================');
      console.log(`Status:  ${status.status} (${status.featureDisabled ? 'Feature Frozen' : status.enabled ? 'Enabled' : 'Disabled'})`);
      if (status.featureDisabled) console.log('FEATURE_DISABLED: Automatic Model Switching is frozen for V1.');
      if (!status.enabled) {
        if (status.selectedModel) {
          console.log(`Selected fixed model: ${status.selectedModel}`);
          console.log('Safety Floor: Active — Core may override the selected model when required by capability or availability constraints.');
        } else {
          console.log('Mode:    Provider/default fallback (no fixed model selected)');
          console.log('Safety Floor: Active — Core enforces capability and availability constraints.');
        }
      }
      console.log(`Source:  ${status.source}`);
      console.log(`Updated: ${status.updatedAt || 'N/A'}`);
      console.log('======================================================================');
      return;
    }
  }

  let stack = null;
  let bridgesArg = '';
  const isClean = args.includes('--clean');
  const isInstallHooks = args.includes('--install-hooks');
  const isForceHooks = args.includes('--force-hooks');
  const isForceRemote = args.includes('--force-remote') || args.includes('--remote');

  for (const arg of args) {
    if (arg.startsWith('--stack=')) {
      stack = arg.slice('--stack='.length);
    } else if (arg.startsWith('--bridges=')) {
      bridgesArg = arg.split('=')[1];
    } else if (arg.startsWith('--bridge=')) {
      bridgesArg = arg.split('=')[1];
    }
  }

  let stackList = [];
  if (stack !== null) {
    stackList = parseStackSelection(stack);
  } else {
    const detected = detectStack(process.cwd());
    const selected = await promptStack(detected);
    stackList = Array.isArray(selected) ? selected : [selected];
  }

  if (stackList.length === 0) {
    console.error('❌ Error: A valid explicit Stack selection is required; nothing was installed.');
    console.error(`Allowed stacks:\n  ${STACKS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const selectedBridges = resolveSelectedBridges(bridgesArg);

  console.log(`\n🚀 Deploying stacks: ${stackList.join(', ')} (bundled resources by default)...`);
  console.log(`🤖 Selected AI Bridges: ${selectedBridges.join(', ')}`);

  const tmpDir = path.join(require('os').tmpdir(), `agent-hub-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const targetRoot = process.cwd();
  const targetAgents = path.join(targetRoot, '.agents');
  const targetSkills = path.join(targetAgents, 'skills');
  const targetClaudeSkills = path.join(targetRoot, '.claude', 'skills');
  if (isClean) {
    if (fs.existsSync(targetSkills)) {
      console.log('🧹 [--clean]: Purging previous skills to allow clean stack re-selection...');
      if (!isDryRun) {
        fs.rmSync(targetSkills, { recursive: true, force: true });
      }
    }
    if (fs.existsSync(targetClaudeSkills)) {
      if (!isDryRun) {
        fs.rmSync(targetClaudeSkills, { recursive: true, force: true });
      }
    }
  }
  if (!isDryRun) {
    fs.mkdirSync(targetSkills, { recursive: true });
  }

  let combinedRules = '';
  let firstStack = true;

  try {
    for (const s of stackList) {
      const sourceRoot = fetchStack(s, tmpDir, { isDryRun, forceRemote: isForceRemote });


      const sourceAgents = path.join(sourceRoot, '.agents');

      // Copy core rules, hooks, security on first stack
      if (firstStack) {
        for (const dir of ['rules', 'hooks', 'security']) {
          const src = path.join(sourceAgents, dir);
          const dst = path.join(targetAgents, dir);
          safeCopyDir(src, dst, isDryRun);
        }

        // Memory directory: initialize clean project-isolated memory templates only; never copy Core repo's live development memory
        const targetMemory = path.join(targetAgents, 'memory');
        if (!isDryRun && !fs.existsSync(targetMemory)) {
          fs.mkdirSync(targetMemory, { recursive: true });
        }

        // Preserve existing memory in target project; initialize only if missing
        const sessionMemPath = path.join(targetMemory, 'session_memory.md');
        const projName = path.basename(targetRoot);
        if (!fs.existsSync(sessionMemPath)) {
          const cleanSessionContent = `# Session Memory - Executive Summary of Completed Tasks\n\nاین فایل تاریخچه کارهای انجام‌شده در سشن‌های کاری فعال این پروژه را برای بازیابی سریع بدون نیاز به مرور مجدد ثبت می‌کند.\n\n---\n\n## 📌 گزارش اقدامات انجام‌شده:\n\n*(هنوز اقدامی در این سشن کاری ثبت نشده است. پس از تکمیل هر تسک توسط ایجنت، خلاصه اجرایی آن در این بخش ثبت می‌شود)*\n`;
          safeWriteString(sessionMemPath, cleanSessionContent, isDryRun);
        }

        const workingMemPath = path.join(targetMemory, 'working_memory.md');
        if (!fs.existsSync(workingMemPath)) {
          const cleanWorkingContent = `# Working Memory - Active Context & Resume Point\n\n- **Current State**: آماده برای دریافت و اجرای تسک جدید.\n- **Active Task**: هیچ تسک فعالی در جریان نیست.\n- **Resume Point**: منتظر دریافت دستور جدید از سوی کاربر.\n`;
          safeWriteString(workingMemPath, cleanWorkingContent, isDryRun);
        }

        const projectMemPath = path.join(targetMemory, 'project_memory.md');
        if (!fs.existsSync(projectMemPath)) {
          const cleanProjContent = `# Project Memory (Architecture & Repository Identity)\n\nاین فایل شناسنامه پایدار، اصول ثابت معماری، الگوهای نام‌گذاری و مشخصات اختصاصی این پروژه را برای بازیابی آنی کانتکست ایجنت‌ها ثبت می‌کند.\n\n---\n\n## 🏛️ ۱. ماهیت و معماری پروژه\n\n- **نام پروژه / مخزن**: ${projName}\n- **پشته فنی (Stack)**: ${stackList.join(', ')}\n- **اصول معماری**: تفکیک دامنه‌ها و لایه‌ها، رعایت استانداردهای کدبیس موجود، تایپ‌های صریح و اعتبارسنجی هدفمند بدون اثرات جانبی واقعی.\n\n---\n\n## 📁 ۲. ساختار کلیدی دایرکتوری‌ها\n*(ایجنت در اولین اکتشاف تسک، ساختار دایرکتوری‌های واقعی این پروژه را بررسی و در این بخش مستند می‌کند)*\n`;
          safeWriteString(projectMemPath, cleanProjContent, isDryRun);
        }

        const metricsPath = path.join(targetMemory, 'metrics.json');
        if (!fs.existsSync(metricsPath)) {
          const initialMetrics = JSON.stringify({
            $schema: "https://json-schema.org/draft/2020-12/schema",
            title: "HOTZEN - Telemetry Metrics",
            description: "Multi-agent task telemetry, token consumption, iterations, and verification rates.",
            is_template: false,
            telemetry_summary: {
              total_tasks_executed: 0,
              task_success_rate: 1.0,
              first_pass_success_rate: 1.0,
              average_iterations: 1.0,
              average_tokens_per_task: 0,
              average_latency_ms: 0,
              context_expansion_count: 0,
              critic_rejection_rate: 0.0,
              recovery_success_rate: 1.0,
              rollback_count: 0,
              regression_count: 0
            },
            metrics_history: []
          }, null, 2);
          safeWriteString(metricsPath, initialMetrics, isDryRun);
        }

        const decisionMemPath = path.join(targetMemory, 'decision_memory.md');
        if (!fs.existsSync(decisionMemPath)) {
          const cleanDecisionContent = `# Decision Memory (ADR - Architecture Decision Records)\n\nاین فایل شامل تمام تصمیمات کلان معماری (ADR) و شرط «تغییر نده مگر اینکه...» در طول حیات این پروژه است.\n\n---\n\n## 📌 ADR-000: الگوی ثبت تصمیمات معماری (ADR Template)\n- **Date**: YYYY-MM-DD\n- **Decision**: [شرح خلاصه تصمیم اتخاذشده]\n- **Rationale**: [دلیل فنی و مزیتی که این تصمیم ایجاد می‌کند]\n- **Do Not Change Unless**: [شرط صریح و شرایطی که تحت آن می‌توان این تصمیم را تغییر داد]\n- **Impacted Components**: [بخش‌ها و فایل‌های متأثر از این تصمیم]\n`;
          safeWriteString(decisionMemPath, cleanDecisionContent, isDryRun);
        }

        const dbPath = path.join(targetMemory, 'database.sqlite');
        if (!fs.existsSync(dbPath)) {
          safeWriteString(dbPath, '', isDryRun);
        }

        const mcpSrc = path.join(sourceAgents, 'mcp_config.json');
        if (fs.existsSync(mcpSrc)) {
          safeMergeMcpFile(mcpSrc, path.join(targetAgents, 'mcp_config.json'), isDryRun);
          safeMergeMcpFile(mcpSrc, path.join(targetRoot, '.mcp.json'), isDryRun);
        }

        const agentsMdSrc = path.join(sourceRoot, 'AGENTS.md');
        if (fs.existsSync(agentsMdSrc)) {
          safeMergeInstructionFile(agentsMdSrc, path.join(targetRoot, 'AGENTS.md'), isDryRun);
        }

        // Ensure consumer .gitignore contains Agent Core runtime isolation rules
        ensureConsumerGitignore(targetRoot, { isDryRun });

        // Deploy Selected Bridges
        const sourceBridgesDir = path.join(sourceRoot, 'core', 'bridges');
        if (fs.existsSync(sourceBridgesDir)) {
          deployBridgeFiles(sourceBridgesDir, targetRoot, selectedBridges, isDryRun);
        } else {
          for (const bKey of selectedBridges) {
            const files = BRIDGE_REGISTRY[bKey] || [];
            for (const f of files) {
              const srcF = path.join(sourceRoot, f);
              if (fs.existsSync(srcF)) {
                const dstF = path.join(targetRoot, f);
                if (f === '.mcp.json' || f.endsWith('mcp.json')) {
                  safeMergeMcpFile(srcF, dstF, isDryRun);
                } else if (isInstructionFile(f)) {
                  safeMergeInstructionFile(srcF, dstF, isDryRun);
                } else {
                  safeCopyFile(srcF, dstF, isDryRun);
                }
              }
            }
          }
        }

        firstStack = false;
      }

      // Merge skills
      const srcSkills = path.join(sourceAgents, 'skills');
      safeCopyDir(srcSkills, targetSkills, isDryRun);

      // Deploy thin runtime skill adapters for Claude Code if claude bridge is selected
      if (selectedBridges.includes('claude')) {
        deployClaudeSkillAdapters(targetSkills, targetClaudeSkills, isDryRun);
      }

      // Collect STACK_RULES
      const stackRulesPath = path.join(sourceRoot, 'STACK_RULES.md');
      const agentsRulesPath = path.join(sourceAgents, 'AGENTS.md');
      if (fs.existsSync(stackRulesPath)) {
        combinedRules += fs.readFileSync(stackRulesPath, 'utf8') + '\n\n---\n\n';
      } else if (fs.existsSync(agentsRulesPath)) {
        combinedRules += fs.readFileSync(agentsRulesPath, 'utf8') + '\n\n---\n\n';
      }
    }

    if (combinedRules) {
      safeMergeInstructionString(path.join(targetAgents, 'AGENTS.md'), combinedRules, isDryRun);
      safeMergeInstructionString(path.join(targetRoot, 'STACK_RULES.md'), combinedRules, isDryRun);
    }

    let hookStatus = 'skipped';
    let hookDetail = '';

    if (fs.existsSync(path.join(targetRoot, '.git')) && isDryRun) {
      if (isInstallHooks) {
        console.log(`   [DRY-RUN] Would configure Git pre-commit hook: git config core.hooksPath .agents/hooks`);
      } else {
        console.log(`   [DRY-RUN] core.hooksPath left unchanged (use --install-hooks to enable)`);
      }
    }

    // Setup Git Security Hook if inside a git repository
    if (fs.existsSync(path.join(targetRoot, '.git')) && !isDryRun) {
      const hookPath = path.join(targetAgents, 'hooks', 'pre-commit');
      if (fs.existsSync(hookPath)) {
        try {
          fs.chmodSync(hookPath, '755');
          const scannerPath = path.join(targetAgents, 'security', 'security_scanner.py');
          if (fs.existsSync(scannerPath)) {
            fs.chmodSync(scannerPath, '755');
          }

          let existingHooksPath = '';
          try {
            existingHooksPath = execSync('git config --get core.hooksPath', { cwd: targetRoot, stdio: 'pipe' }).toString().trim();
          } catch (_) {}

          if (!isInstallHooks) {
            hookStatus = 'skipped';
            hookDetail = 'core.hooksPath left unchanged (opt-in via --install-hooks)';
            console.log(`\nℹ️  Git hooks: core.hooksPath left unchanged (use --install-hooks to enable pre-commit guardian).`);
          } else if (existingHooksPath && existingHooksPath !== '.agents/hooks' && !isForceHooks) {
            hookStatus = 'preserved';
            hookDetail = existingHooksPath;
            console.warn(`\n⚠️ Existing core.hooksPath detected: '${existingHooksPath}'.`);
            console.warn(`   Preserved existing hooks to avoid breaking workflows. Use --force-hooks to override.`);
          } else {
            if (existingHooksPath && existingHooksPath !== '.agents/hooks' && isForceHooks) {
              const backupHooksFile = path.join(targetAgents, '.hooks-backup');
              safeWriteString(backupHooksFile, existingHooksPath, false);
            }
            execSync('git config core.hooksPath .agents/hooks', { cwd: targetRoot, stdio: 'pipe' });
            hookStatus = 'configured';
          }
        } catch (err) {
          hookStatus = 'failed';
          hookDetail = err.message;
          console.warn(`⚠️ Failed to configure Git hook: ${err.message}`);
        }
      }
    }

    function countDeployedSkills(dir) {
      if (!fs.existsSync(dir)) return 0;
      let count = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) count += countDeployedSkills(path.join(dir, entry.name));
        else if (entry.name.endsWith('.md')) count++;
      }
      return count;
    }

    if (process.env.AGENT_HUB_TEST_EMPTY_PAYLOAD === '1' && fs.existsSync(targetSkills)) {
      fs.rmSync(targetSkills, { recursive: true, force: true });
      fs.mkdirSync(targetSkills, { recursive: true });
    }

    const deployedSkillsCount = countDeployedSkills(targetSkills);
    if (!isDryRun && stackList.length > 0 && deployedSkillsCount === 0) {
      console.error(`\n❌ Deployment Failed: 0 skills were deployed for stack(s): ${stackList.join(', ')}.`);
      console.error(`   The fetched stack payload is empty or missing skill definitions.`);
      process.exit(1);
    }


    console.log('======================================================================');
    console.log(`✅ HOTZEN framework successfully ${isDryRun ? '[DRY-RUN SIMULATED]' : 'deployed'} for: ${stackList.join(', ')}`);
    console.log(`📂 Structure deployed into ${targetRoot}:`);
    console.log(`   • .agents/ (Rules, Memory, Merged Skills: ${deployedSkillsCount} files, MCP config)`);
    if (hookStatus === 'configured') {
      console.log('   • 🔒 Git Pre-commit Security Hook automatically configured');
    } else if (hookStatus === 'preserved') {
      console.log(`   • 🔒 Git Pre-commit Hook: Preserved existing '${hookDetail}' (use --force-hooks to override)`);
    } else if (hookStatus === 'failed') {
      console.log(`   • ⚠️ Git Pre-commit Hook: Configuration failed (${hookDetail})`);
    }
    console.log(`   • Active AI Bridges: ${selectedBridges.join(', ')}`);
    console.log('   • Clean Project Root (On-Demand Bridges)');
    console.log('   • 🛡️ Safe Non-Destructive Deployment (Auto-Backup enabled)');
    console.log('======================================================================');
  } catch (err) {
    console.error('❌ Deployment error:', err.message);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

module.exports = {
  safeCopyFile,
  safeWriteString,
  safeCopyDir,
  safeMergeInstructionString,
  safeMergeInstructionFile,
  safeMergeMcpFile,
  wrapInManagedBlock,
  isInstructionFile,
  MANAGED_START_MARKER,
  MANAGED_END_MARKER,
  resolveSelectedBridges,
  detectStack,
  parseStackSelection,
  promptStack,
  runDoctor,
  runVerify,
  get runVerifyRecord() {
    try {
      return require('../core/workflow').runVerifyRecord;
    } catch {
      return null;
    }
  },
  runReset,
  fetchStack,
  deployBridgeFiles,
  BRIDGE_REGISTRY,
  STACKS,
  formatPlanApprovalPrompt,
  formatImportedPlanForApproval,
  promptPlanApproval,
  validateImportedPlanBundle,
  fingerprintNativeApproval,
  buildApprovedHistoryMetadata,
  formatNativeVerificationSummary,
  buildCriterionReport,
  validateCriterionReport,
  reportWorkflowResult,
  saveNativePlanBundle,
  createNativePreEditBackup,
  buildDiagnosticAuthorizationBinding,
  formatDiagnosticConfirmation,
  promptDiagnosticAuthorization,
  runTaskCommand,
  get formatFailurePrompt() {
    try {
      return require('../core/workflow').formatFailurePrompt;
    } catch {
      return null;
    }
  },
  get promptFailureDecision() {
    try {
      return require('../core/workflow').promptFailureDecision;
    } catch {
      return null;
    }
  },
  get normalizeFailureDecision() {
    try {
      return require('../core/workflow').normalizeFailureDecision;
    } catch {
      return null;
    }
  },
  get buildFailureContract() {
    try {
      return require('../core/workflow').buildFailureContract;
    } catch {
      return null;
    }
  },
  handleTaskFailure,
  runTaskCommand,
  ensureConsumerGitignore,
  REQUIRED_GITIGNORE_RULES,
  GITIGNORE_HEADER,
  get generateTaskPlan() {
    try {
      return require('../core/workflow').generateTaskPlan;
    } catch {
      return null;
    }
  }
};

if (require.main === module) {
  main();
}
