'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ACCEPTED_SANDBOX_MARKERS = new Set(['.agent-core-sandboxes', '.core-sandbox']);

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function resolveVerificationWorkspace(targetDir = process.cwd()) {
  const resolvedTarget = canonicalPath(targetDir);
  const segments = resolvedTarget.split(path.sep).filter(Boolean);
  const markerIndex = segments.findIndex(segment => ACCEPTED_SANDBOX_MARKERS.has(segment));
  if (markerIndex < 0) {
    return { targetDir: resolvedTarget, isAcceptedSandbox: false, sandboxRoot: null };
  }

  const sandboxRoot = path.join(path.sep, ...segments.slice(0, markerIndex + 1));
  return { targetDir: resolvedTarget, isAcceptedSandbox: true, sandboxRoot };
}

function gitEnvironment(workspace) {
  if (!workspace.isAcceptedSandbox) return process.env;
  const existing = process.env.GIT_CEILING_DIRECTORIES
    ? process.env.GIT_CEILING_DIRECTORIES.split(path.delimiter).filter(Boolean)
    : [];
  const ceilings = new Set([...existing, workspace.sandboxRoot]);
  return { ...process.env, GIT_CEILING_DIRECTORIES: Array.from(ceilings).join(path.delimiter) };
}

function runGit(targetDir, args) {
  const workspace = resolveVerificationWorkspace(targetDir);
  const env = gitEnvironment(workspace);

  if (workspace.isAcceptedSandbox) {
    let gitRoot;
    try {
      gitRoot = canonicalPath(execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: workspace.targetDir,
        env,
        stdio: 'pipe'
      }).toString().trim());
    } catch {
      return null;
    }
    // A sandbox can use its own repository, but never a repository above its
    // target workspace boundary (including another sandbox's repository).
    if (gitRoot !== workspace.targetDir) return null;
  }

  try {
    return execFileSync('git', args, {
      cwd: workspace.targetDir,
      env,
      stdio: 'pipe'
    }).toString();
  } catch {
    return null;
  }
}

function isFlutterWorkspace(targetDir) {
  if (!targetDir || typeof targetDir !== 'string') return false;
  try {
    const pubspec = path.join(targetDir, 'pubspec.yaml');
    if (fs.existsSync(pubspec)) {
      const content = fs.readFileSync(pubspec, 'utf8');
      return content.includes('flutter:');
    }
  } catch (_) {}
  return false;
}

function listWorkspaceFiles(targetDir) {
  const workspace = resolveVerificationWorkspace(targetDir);
  const isFlutter = isFlutterWorkspace(workspace.targetDir);
  const result = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (isFlutter && (entry.name === 'build' || entry.name === '.dart_tool')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) result.push(path.relative(workspace.targetDir, absolute).replace(/\\/g, '/'));
    }
  };
  walk(workspace.targetDir);
  return result;
}

function discoverWorkspaceChanges(targetDir = process.cwd()) {
  const workspace = resolveVerificationWorkspace(targetDir);
  const isFlutter = isFlutterWorkspace(workspace.targetDir);
  const diff = runGit(workspace.targetDir, ['diff', '--name-only', 'HEAD']);
  const status = runGit(workspace.targetDir, ['status', '--porcelain', '-uall']);

  if (workspace.isAcceptedSandbox && (diff === null || status === null)) {
    // No Git repository is a supported sandbox state. With no baseline index,
    // inspect files present in the bounded workspace only.
    return listWorkspaceFiles(workspace.targetDir);
  }

  const files = new Set();
  if (diff !== null) {
    diff.split('\n').map(value => value.trim()).filter(Boolean)
      .forEach(value => files.add(value.replace(/\\/g, '/')));
  }
  if (status !== null) {
    status.split('\n').forEach(line => {
      const value = line.trim();
      if (!value) return;
      const filePart = value.slice(2).trim();
      if (!filePart) return;
      if (filePart.includes('->')) {
        const parts = filePart.split('->').map(part => part.trim());
        if (parts[1]) files.add(parts[1].replace(/^['"]|['"]$/g, '').replace(/\\/g, '/'));
      } else {
        files.add(filePart.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/'));
      }
    });
  }
  const resultList = Array.from(files);
  if (isFlutter) {
    return resultList.filter(f => f !== 'build' && !f.startsWith('build/') && f !== '.dart_tool' && !f.startsWith('.dart_tool/'));
  }
  return resultList;
}

module.exports = {
  ACCEPTED_SANDBOX_MARKERS,
  resolveVerificationWorkspace,
  discoverWorkspaceChanges,
  listWorkspaceFiles,
  runGit,
  isFlutterWorkspace
};
