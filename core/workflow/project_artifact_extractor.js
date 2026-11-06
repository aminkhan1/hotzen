/**
 * 🌐 Universal Agent Core Hub - Project Multi-File Artifact Extractor
 * Deterministically extracts and applies multi-file implementation artifacts for real project
 * workspaces (Dart/Flutter, Python, Rust, Go, etc.) without JavaScript vm.Script validation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');

/**
 * Strips known CLI telemetry and metadata headers/footers from provider output.
 * @param {string} text
 * @returns {string}
 */
function stripCliMetadata(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^OpenAI Codex [^\n\r]+/gim, '')
    .replace(/^(?:model|reasoning effort|session id|provider|cost|elapsed):\s*[^\n\r]+/gim, '')
    .replace(/^tokens used\s*(?::\s*[0-9,]+|\r?\n\s*[0-9,]+)?/gim, '')
    .trim();
}

/**
 * Safely resolves a target relative path within a workspace directory.
 * Blocks directory traversal (e.g. ../), absolute path escapes, and invalid characters.
 *
 * @param {string} baseDir Base workspace directory
 * @param {string} relPath Candidate relative path
 * @returns {string|null} Resolved absolute path or null if invalid/traversal
 */
function safeResolveWorkspacePath(baseDir, relPath) {
  if (!baseDir || !relPath || typeof relPath !== 'string') return null;
  let clean = relPath.trim()
    .replace(/^["'`<(\[]+/, '')
    .replace(/["'`>)\]]+$/, '')
    .replace(/[:;,]+$/, '')
    .replace(/\.+$/, '')
    .trim();

  if (!clean || clean.startsWith('http://') || clean.startsWith('https://')) return null;
  if (clean.startsWith('./')) clean = clean.slice(2);
  if (clean.includes('\\')) clean = clean.replace(/\\/g, '/');

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, clean);
  const rel = path.relative(resolvedBase, resolvedTarget);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null; // Path traversal attempt blocked
  }

  // A lexically safe path can still escape through a symlink in the workspace.
  try {
    const realBase = fs.realpathSync(resolvedBase);
    let existing = resolvedTarget;
    while (!fs.existsSync(existing) && existing !== resolvedBase) {
      existing = path.dirname(existing);
    }
    const realExisting = fs.realpathSync(existing);
    const realRelative = path.relative(realBase, realExisting);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
  } catch {
    return null;
  }
  return resolvedTarget;
}

/**
 * Captures the content baseline for planned files before a Provider executes.
 * Missing files are recorded as null so a later direct creation is detectable.
 * @param {string} baseDir
 * @param {string[]} expectedFiles
 * @returns {Map<string, string|null>}
 */
function captureProjectFileState(baseDir, expectedFiles = []) {
  const state = new Map();
  for (const rel of expectedFiles) {
    const fullPath = safeResolveWorkspacePath(baseDir, rel);
    const key = fullPath
      ? path.relative(path.resolve(baseDir), fullPath).split(path.sep).join('/')
      : rel;
    if (!fullPath) {
      state.set(key, null);
      continue;
    }
    try {
      const stat = fs.statSync(fullPath);
      state.set(key, stat.isFile() ? fs.readFileSync(fullPath, 'utf8') : null);
    } catch {
      state.set(key, null);
    }
  }
  return state;
}

function persistArtifactBaseline(targetDir, expectedFiles, fullPaths, backupSpec) {
  const native = backupSpec && backupSpec.kind === 'native_pre_edit';
  if (!backupSpec || typeof backupSpec.taskId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(backupSpec.taskId) ||
      (native ? typeof backupSpec.verifyInitial !== 'function' || !backupSpec.binding
        : !Number.isSafeInteger(backupSpec.attempt) || backupSpec.attempt < 0)) {
    throw new Error('invalid_backup_binding');
  }
  const workspace = fs.realpathSync(targetDir);
  const bundleRoot = path.join(workspace, '.core-plan-bundles');
  const taskRoot = path.join(bundleRoot, `${backupSpec.taskId}.baseline`);
  const attemptRoot = path.join(taskRoot, native ? 'native-pre-edit' : `attempt-${backupSpec.attempt}`);
  const payloadRoot = native ? path.join(attemptRoot, 'files') : attemptRoot;
  const ensureDirectory = (directory, { exclusive = false } = {}) => {
    if (fs.existsSync(directory)) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
          (native && ((stat.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory ||
            (typeof process.getuid === 'function' && stat.uid !== process.getuid())))) {
        throw new Error('backup_directory_not_private');
      }
      if (exclusive) throw new Error('backup_attempt_already_exists');
      return false;
    }
    fs.mkdirSync(directory, { mode: 0o700 });
    return true;
  };
  const checkPrivateFile = file => {
    if (!native) return;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 ||
        fs.realpathSync(file) !== file ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('backup_file_not_private');
    }
  };

  let attemptCreated = false;
  try {
    if (native) backupSpec.verifyInitial();
    ensureDirectory(bundleRoot);
    ensureDirectory(taskRoot);
    attemptCreated = ensureDirectory(attemptRoot, { exclusive: true });
    if (native) ensureDirectory(payloadRoot);
    const manifest = { version: 1, taskId: backupSpec.taskId,
      ...(native ? { kind: 'native_pre_edit', binding: backupSpec.binding } : { attempt: backupSpec.attempt }), files: [] };
    for (const relativePath of expectedFiles) {
      const fullPath = fullPaths.get(relativePath);
      if (!fullPath) throw new Error('backup_scope_path_invalid');
      let stat;
      try { stat = fs.lstatSync(fullPath); }
      catch (error) {
        if (error.code === 'ENOENT') {
          if (native && backupSpec.initialStates.get(relativePath).state !== 'absent') throw new Error('native_initial_state_changed');
          manifest.files.push({ path: relativePath, present: false, sha256: null });
          continue;
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('backup_scope_entry_not_regular_file');
      let originalBytes;
      if (native) {
        // Recheck every component immediately before opening; never follow a
        // replaced leaf symlink. Post-copy validation checks the whole Scope.
        backupSpec.verifyInitial();
        const fd = fs.openSync(fullPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          if (!fs.fstatSync(fd).isFile() || fs.realpathSync(fullPath) !== fullPath) throw new Error('invalid_approved_file');
          originalBytes = fs.readFileSync(fd);
        } finally { fs.closeSync(fd); }
        const initial = backupSpec.initialStates.get(relativePath);
        if (initial.state !== 'present' || crypto.createHash('sha256').update(originalBytes).digest('hex') !== initial.digest) {
          throw new Error('native_initial_state_changed');
        }
      } else originalBytes = fs.readFileSync(fullPath);
      const backupPath = path.join(payloadRoot, ...relativePath.split('/'));
      if (native) {
        let parent = payloadRoot;
        for (const part of relativePath.split('/').slice(0, -1)) {
          parent = path.join(parent, part);
          ensureDirectory(parent);
        }
      } else fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(backupPath, originalBytes, { flag: 'wx', mode: 0o600 });
      checkPrivateFile(backupPath);
      const copiedBytes = fs.readFileSync(backupPath);
      if (!copiedBytes.equals(originalBytes)) throw new Error('backup_byte_validation_failed');
      manifest.files.push({
        path: relativePath,
        present: true,
        sha256: crypto.createHash('sha256').update(originalBytes).digest('hex')
      });
    }
    const manifestPath = path.join(attemptRoot, 'manifest.json');
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    fs.writeFileSync(manifestPath, manifestBytes, { flag: 'wx', mode: 0o600 });
    checkPrivateFile(manifestPath);
    const storedBytes = fs.readFileSync(manifestPath);
    const storedManifest = JSON.parse(storedBytes.toString('utf8'));
    if (!isDeepStrictEqual(storedManifest, manifest)) throw new Error('backup_manifest_validation_failed');
    for (const item of manifest.files) {
      if (!item.present) continue;
      const copiedPath = path.join(payloadRoot, ...item.path.split('/'));
      checkPrivateFile(copiedPath);
      const copiedBytes = fs.readFileSync(copiedPath);
      const copiedDigest = crypto.createHash('sha256').update(copiedBytes).digest('hex');
      if (copiedDigest !== item.sha256) throw new Error('backup_digest_validation_failed');
    }
    if (native) {
      for (const directory of [bundleRoot, taskRoot, attemptRoot, payloadRoot]) ensureDirectory(directory);
      backupSpec.verifyInitial();
    }
    return { backupPath: attemptRoot, manifestDigest: crypto.createHash('sha256').update(storedBytes).digest('hex') };
  } catch (error) {
    if (attemptCreated) {
      try { fs.rmSync(attemptRoot, { recursive: true, force: true }); } catch {}
    }
    throw error;
  }
}

/** Uses the same byte store for a validated Native Bundle, without applying artifacts. */
function persistNativePreEditBaseline(targetDir, snapshot, binding) {
  const { validateApprovedFileStates, readApprovedFileState } = require('./verification_contract');
  const workspace = fs.realpathSync(targetDir);
  const states = snapshot && snapshot.verificationContract && snapshot.verificationContract.fileStates;
  if (states === undefined) throw new Error('native_initial_states_required');
  const files = snapshot.filesToModify;
  if (!validateApprovedFileStates(states, files).ok || !binding || binding.workspace !== workspace ||
      binding.taskId !== snapshot.taskId || !isDeepStrictEqual(binding.scope, files)) {
    throw new Error('invalid_native_backup_binding');
  }
  // A backup may not recursively capture its own private storage or Plan data.
  if (files.some(file => file === '.core-plan-bundles' || file.startsWith('.core-plan-bundles/'))) {
    throw new Error('invalid_approved_file');
  }
  const initialStates = new Map(states.entries.map(entry => [entry.file, entry.initial]));
  const verifyInitial = () => {
    for (const file of files) {
      const current = readApprovedFileState(workspace, file);
      if (!current.ok) throw new Error(current.reason);
      const initial = initialStates.get(file);
      if (current.state !== initial.state || current.digest !== initial.digest) throw new Error('native_initial_state_changed');
    }
  };
  return persistArtifactBaseline(workspace, files, new Map(files.map(file => [file, path.join(workspace, file)])), {
    taskId: snapshot.taskId, kind: 'native_pre_edit', binding, initialStates, verifyInitial
  });
}

/**
 * Extracts candidate file path from code block info string, first line comment, or preceding markdown.
 *
 * @param {string} infoString Fence info string (e.g. 'dart:lib/main.dart' or 'dart file=lib/main.dart')
 * @param {string} code Block content
 * @param {string} [precedingText=''] Markdown text directly preceding the fence
 * @param {string[]} [expectedFiles=[]] List of normalized expected files
 * @returns {string|null} Detected relative file path
 */
function detectFilePathFromBlock(infoString, code, precedingText = '', expectedFiles = []) {
  const normInfo = (infoString || '').trim();

  // 1. Info string contains path with colon or space (e.g. ```dart:lib/main.dart or ```dart lib/main.dart)
  if (normInfo) {
    // Check for explicit key-value (file=..., path=...)
    const kvMatch = normInfo.match(/(?:file|path)=["']?([a-zA-Z0-9_\-\.\/]+)["']?/i);
    if (kvMatch && kvMatch[1]) return kvMatch[1];

    if (normInfo.includes(':')) {
      const parts = normInfo.split(':');
      const candidate = parts.slice(1).join(':').trim();
      if (candidate && (candidate.includes('/') || candidate.includes('.'))) return candidate;
    }

    const tokens = normInfo.split(/\s+/);
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].includes('/') || tokens[i].includes('.')) {
        return tokens[i];
      }
    }

    // Info string itself is a file path (e.g. ```lib/counter_bloc.dart)
    if (normInfo.includes('/') || (normInfo.includes('.') && !/^(?:js|javascript|dart|ts|py|go|rs|json|yaml|html|css|sh)$/i.test(normInfo))) {
      return normInfo;
    }
  }

  // 2. First line of code block contains a path comment
  const firstLine = (code || '').split('\n')[0].trim();
  const commentMatch = firstLine.match(/^(?:\/\/|#|\/\*|\*)\s*(?:file:?|filepath:?|path:?)?\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_-]+)/i);
  if (commentMatch && commentMatch[1]) {
    return commentMatch[1];
  }

  // 3. Preceding markdown text contains a header or bolded file path
  if (precedingText) {
    const lines = precedingText.trim().split('\n').slice(-3); // Last 3 lines before block
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      const headerMatch = line.match(/(?:^#+\s*|^\*{1,2}|`)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_-]+)(?:`|\*{1,2}|:)?/);
      if (headerMatch && headerMatch[1]) {
        return headerMatch[1];
      }
    }
  }

  // 4. If code matches one of the expected files by matching keywords in imports or class name
  if (Array.isArray(expectedFiles) && expectedFiles.length === 1) {
    return expectedFiles[0];
  }

  return null;
}

/**
 * Extracts and writes project implementation files from provider output to the workspace directory.
 *
 * @param {string} text Provider raw text response
 * @param {string} targetDir Project workspace directory
 * @param {string[]} [expectedFiles=[]] List of planned files to create/modify
 * @returns {{
 *   success: boolean,
 *   writtenFiles: string[],
 *   existingFiles: string[],
 *   allTargetFiles: string[],
 *   codeContent: string,
 *   errors: string[]
 * }}
 */
function extractAndApplyProjectArtifacts(text, targetDir, expectedFiles = [], options = {}) {
  const errors = [];
  const writtenFiles = [];
  const existingFiles = [];

  if (!targetDir || !fs.existsSync(targetDir)) {
    const expected = Array.isArray(expectedFiles) ? expectedFiles.filter((item) => typeof item === 'string').slice(0, 32) : [];
    return {
      success: false,
      writtenFiles: [],
      existingFiles: [],
      allTargetFiles: [],
      artifactFiles: [],
      codeContent: text || '',
      errors: [`Target directory '${targetDir}' does not exist`],
      deliveryDiagnostics: {
        expectedArtifactCount: expected.length,
        recognizedArtifactPathCount: 0,
        approvedRelativePathsRecognized: [],
        missingExpectedPaths: expected.map((item) => item.slice(0, 160)),
        directWritePathsObserved: [],
        parseOutcome: 'not_attempted',
        deliveryOutcome: 'failed_workspace_unavailable',
        rollbackApplied: false,
        rollbackReason: null
      }
    };
  }

  const requestedFiles = (Array.isArray(expectedFiles) ? expectedFiles : [])
    .map(f => (typeof f === 'string' ? f.trim().replace(/\.+$/, '') : ''))
    .filter(f => f && f !== '(unresolved — to be determined during inspection)');
  const structuredMode = options && options.structuredArtifactDelivery === true;
  const allowUnchangedStructuredArtifacts = structuredMode
    && options.allowUnchangedStructuredArtifacts === true;
  const normalizedExpected = [];
  const fullPaths = new Map();
  for (const rel of requestedFiles) {
    const fullPath = safeResolveWorkspacePath(targetDir, rel);
    if (!fullPath) {
      errors.push(`Path traversal or invalid planned path blocked: ${rel}`);
      continue;
    }
    const canonicalRel = path.relative(path.resolve(targetDir), fullPath).split(path.sep).join('/');
    if (!normalizedExpected.includes(canonicalRel)) normalizedExpected.push(canonicalRel);
    fullPaths.set(canonicalRel, fullPath);
  }

  const baseline = options && options.baseline
    ? options.baseline
    : captureProjectFileState(targetDir, normalizedExpected);
  const baselineValue = (rel) => {
    const original = requestedFiles.find((candidate) => {
      const candidatePath = safeResolveWorkspacePath(targetDir, candidate);
      return candidatePath && path.relative(path.resolve(targetDir), candidatePath).split(path.sep).join('/') === rel;
    });
    if (baseline instanceof Map) {
      if (baseline.has(rel)) return baseline.get(rel);
      return original && baseline.has(original) ? baseline.get(original) : null;
    }
    if (Object.prototype.hasOwnProperty.call(baseline || {}, rel)) return baseline[rel];
    return original && Object.prototype.hasOwnProperty.call(baseline || {}, original) ? baseline[original] : null;
  };

  // Provider-written files count only when their content differs from the pre-run baseline.
  const directFiles = new Map();
  for (const rel of normalizedExpected) {
    const fullPath = fullPaths.get(rel);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size === 0) continue;
      const current = fs.readFileSync(fullPath, 'utf8');
      const before = baselineValue(rel);
      if (current.trim() && current !== before) {
        directFiles.set(rel, current);
        existingFiles.push(rel);
      }
    } catch {}
  }

  // 2. Decode only the selected contract. Structured Codex delivery must never
  // fall back to the legacy free-form parser when its result is invalid.
  const cleanedText = stripCliMetadata(text);
  const extractedBlocks = [];
  let structuredInvalid = false;
  if (structuredMode) {
    const result = options.structuredArtifactResult;
    const expectedSet = new Set(normalizedExpected);
    if (!result || result.status !== 'valid' || !Array.isArray(result.files)) {
      errors.push('Structured artifact delivery was missing or invalid; free-form fallback is disabled.');
      structuredInvalid = true;
    } else {
      if (result.files.length !== normalizedExpected.length || normalizedExpected.length !== requestedFiles.length) {
        errors.push('Structured artifact delivery did not contain exactly one artifact for every approved file.');
        structuredInvalid = true;
      }
      const seen = new Set();
      for (const artifact of result.files) {
        if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
            Object.keys(artifact).length !== 2 || typeof artifact.path !== 'string' ||
            typeof artifact.content !== 'string' || !artifact.content.trim()) {
          errors.push('Structured artifact entry was malformed or empty.');
          structuredInvalid = true;
          continue;
        }
        const fullPath = safeResolveWorkspacePath(targetDir, artifact.path);
        const canonicalRel = fullPath
          ? path.relative(path.resolve(targetDir), fullPath).split(path.sep).join('/')
          : null;
        if (!canonicalRel || !expectedSet.has(canonicalRel) || artifact.path !== canonicalRel) {
          errors.push('Structured artifact path was unsafe or outside the approved file scope.');
          structuredInvalid = true;
          continue;
        }
        if (seen.has(canonicalRel)) {
          errors.push('Duplicate structured artifact path rejected.');
          structuredInvalid = true;
          continue;
        }
        seen.add(canonicalRel);
        extractedBlocks.push({ relPath: canonicalRel, code: artifact.content });
      }
      if (normalizedExpected.some((rel) => !seen.has(rel))) {
        errors.push('Structured artifact delivery omitted one or more approved files.');
        structuredInvalid = true;
      }
    }
    if (directFiles.size > 0) {
      errors.push('Direct workspace writes are not accepted for structured Coder delivery.');
      structuredInvalid = true;
    }
  } else {
    const fenceRegex = /[ \t]*`{3,}([^\n\r]*)\r?\n([\s\S]*?)[ \t]*`{3,}/g;
    let match;
    let lastIndex = 0;
    while ((match = fenceRegex.exec(cleanedText)) !== null) {
      const precedingText = cleanedText.slice(lastIndex, match.index);
      lastIndex = match.index + match[0].length;
      const info = match[1] || '';
      const code = match[2] || '';
      const detectedPath = detectFilePathFromBlock(info, code, precedingText, normalizedExpected);
      if (detectedPath) {
        extractedBlocks.push({ relPath: detectedPath.trim().replace(/\.+$/, ''), code: code.trim() });
      }
    }
  }

  // Validate every extracted path and source body before writing any of them.
  const staged = new Map();
  let invalidOutput = errors.length > 0 || structuredInvalid;
  for (const block of extractedBlocks) {
    const fullPath = safeResolveWorkspacePath(targetDir, block.relPath);
    const canonicalRel = fullPath
      ? path.relative(path.resolve(targetDir), fullPath).split(path.sep).join('/')
      : null;
    if (!canonicalRel || !fullPaths.has(canonicalRel) || !normalizedExpected.includes(canonicalRel)) {
      errors.push(`Artifact is outside the approved Plan or has an invalid path: ${block.relPath}`);
      invalidOutput = true;
      continue;
    }
    if (staged.has(canonicalRel)) {
      errors.push(`Duplicate artifact path rejected: ${canonicalRel}`);
      invalidOutput = true;
      continue;
    }
    if (!isValidArtifactContent(canonicalRel, block.code)) {
      errors.push(`Invalid or empty source artifact rejected: ${canonicalRel}`);
      invalidOutput = true;
      continue;
    }
    staged.set(canonicalRel, block.code);
  }

  const candidateContents = structuredMode ? new Map() : new Map(directFiles);
  for (const [rel, code] of staged) candidateContents.set(rel, code);
  for (const rel of normalizedExpected) {
    const candidate = candidateContents.get(rel);
    const before = baselineValue(rel);
    if (typeof candidate !== 'string' || !isValidArtifactContent(rel, candidate)
        || (candidate === before && !allowUnchangedStructuredArtifacts)) {
      errors.push(`Planned file was not newly delivered or changed: ${rel}`);
      invalidOutput = true;
    }
  }

  const approvedRelativePathsRecognized = [...new Set(extractedBlocks.map((block) => {
    const fullPath = safeResolveWorkspacePath(targetDir, block.relPath);
    if (!fullPath) return null;
    const canonicalRel = path.relative(path.resolve(targetDir), fullPath).split(path.sep).join('/');
    return fullPaths.has(canonicalRel) && normalizedExpected.includes(canonicalRel) ? canonicalRel : null;
  }).filter(Boolean))].slice(0, 32);
  const missingBeforeRollback = normalizedExpected.filter((rel) => {
    const candidate = staged.has(rel) ? staged.get(rel) : directFiles.get(rel);
    return typeof candidate !== 'string' || !isValidArtifactContent(rel, candidate)
      || (candidate === baselineValue(rel) && !allowUnchangedStructuredArtifacts);
  }).slice(0, 32);
  const diagnosticBase = {
    expectedArtifactCount: normalizedExpected.length,
    recognizedArtifactPathCount: approvedRelativePathsRecognized.length,
    approvedRelativePathsRecognized,
    missingExpectedPaths: missingBeforeRollback,
    directWritePathsObserved: [...new Set(existingFiles)].slice(0, 32),
    parseOutcome: extractedBlocks.length === 0 ? 'no_artifacts' : (invalidOutput ? 'invalid' : 'parsed'),
    deliveryOutcome: null,
    rollbackApplied: false,
    rollbackReason: null
  };

  let managedBackup;
  if (options && options.baselineBackup) {
    try {
      managedBackup = persistArtifactBaseline(targetDir, normalizedExpected, fullPaths, options.baselineBackup);
    } catch (error) {
      return {
        success: false,
        writtenFiles: [],
        existingFiles: [...new Set(existingFiles)].slice(0, 32),
        allTargetFiles: [],
        artifactFiles: [],
        codeContent: structuredMode ? '' : cleanedText,
        errors: [`Core-managed baseline backup failed safely (${error && error.message ? error.message : 'unknown'}). Project files were not changed by artifact extraction.`],
        deliveryDiagnostics: {
          ...diagnosticBase,
          deliveryOutcome: 'failed_backup',
          rollbackApplied: false,
          rollbackReason: null
        }
      };
    }
  }

  if (invalidOutput || normalizedExpected.length === 0) {
    const rollbackApplied = directFiles.size > 0;
    restoreBaselineFiles(targetDir, normalizedExpected, baseline, errors);
    if (errors.length === 0) errors.push('No planned implementation artifacts were delivered');
    return {
      success: false,
      writtenFiles: [],
      existingFiles: [],
      allTargetFiles: [],
      artifactFiles: [],
      codeContent: structuredMode ? '' : cleanedText,
      errors,
      deliveryDiagnostics: {
        ...diagnosticBase,
        deliveryOutcome: normalizedExpected.length === 0 ? 'failed_no_expected_artifacts' : (missingBeforeRollback.length ? 'failed_incomplete' : 'failed_invalid'),
        rollbackApplied,
        rollbackReason: rollbackApplied ? (missingBeforeRollback.length ? 'incomplete_delivery' : 'invalid_artifact') : null
      }
    };
  }

  // Apply only after the complete set has passed validation; rollback if any write fails.
  const previousContents = new Map();
  const stagedPaths = [];
  try {
    for (const [rel, code] of staged) {
      const fullPath = fullPaths.get(rel);
      previousContents.set(rel, fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : null);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const temporaryPath = `${fullPath}.artifact-${process.pid}-${Math.random().toString(16).slice(2)}`;
      fs.writeFileSync(temporaryPath, code, { encoding: 'utf8', flag: 'wx' });
      stagedPaths.push(temporaryPath);
      fs.renameSync(temporaryPath, fullPath);
      writtenFiles.push(rel);
    }
  } catch (err) {
    errors.push(`Failed to apply complete artifact set: ${err.message}`);
    for (const temporaryPath of stagedPaths) {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch {}
    }
    for (const [rel, previous] of previousContents) {
      const fullPath = fullPaths.get(rel);
      try {
        if (previous === null) fs.rmSync(fullPath, { force: true });
        else fs.writeFileSync(fullPath, previous);
      } catch (rollbackError) {
        errors.push(`Failed to restore '${rel}' after write error: ${rollbackError.message}`);
      }
    }
    restoreBaselineFiles(targetDir, normalizedExpected, baseline, errors);
    return {
      success: false, writtenFiles: [], existingFiles: [], allTargetFiles: [], artifactFiles: [], codeContent: structuredMode ? '' : cleanedText, errors,
      deliveryDiagnostics: {
        ...diagnosticBase,
        deliveryOutcome: 'failed_write',
        missingExpectedPaths: normalizedExpected.slice(0, 32),
        rollbackApplied: true,
        rollbackReason: 'artifact_write_failed'
      }
    };
  }

  const allTargetFiles = normalizedExpected.slice();
  const success = allTargetFiles.length > 0;

  // Assemble combined code content for Critic inspection
  let codeContent = '';
  for (const rel of allTargetFiles) {
    const fullPath = safeResolveWorkspacePath(targetDir, rel);
    if (fullPath && fs.existsSync(fullPath)) {
      try {
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        codeContent += `// File: ${rel}\n${fileContent}\n\n`;
      } catch {}
    }
  }

  return {
    success,
    writtenFiles,
    existingFiles,
    allTargetFiles,
    artifactFiles: normalizedExpected.map((rel) => ({ path: rel, content: candidateContents.get(rel) })),
    codeContent: codeContent.trim(),
    ...(options.includeManagedBackup ? { managedBackup } : {}),
    errors,
    deliveryDiagnostics: {
      ...diagnosticBase,
      missingExpectedPaths: [],
      directWritePathsObserved: [...new Set(existingFiles)].slice(0, 32),
      deliveryOutcome: 'delivered',
      rollbackApplied: false,
      rollbackReason: null
    }
  };
}

function isValidArtifactContent(rel, code) {
  if (typeof code !== 'string' || !code.trim()) return false;
  if (path.extname(rel).toLowerCase() === '.dart') {
    return /\b(?:class|enum|mixin|extension|typedef|void|final|const|var|import|part|library|abstract|sealed|Future|Stream|Widget|test|group)\b|=>|[{};]/.test(code);
  }
  return true;
}

function restoreBaselineFiles(baseDir, expectedFiles, baseline, errors) {
  for (const rel of expectedFiles) {
    const fullPath = safeResolveWorkspacePath(baseDir, rel);
    if (!fullPath) continue;
    const before = baseline instanceof Map
      ? (baseline.has(rel) ? baseline.get(rel) : null)
      : (Object.prototype.hasOwnProperty.call(baseline || {}, rel) ? baseline[rel] : null);
    try {
      if (before === null || before === undefined) {
        fs.rmSync(fullPath, { force: true });
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, before, 'utf8');
      }
    } catch (error) {
      errors.push(`Failed to restore planned file '${rel}': ${error.message}`);
    }
  }
}

module.exports = {
  stripCliMetadata,
  safeResolveWorkspacePath,
  detectFilePathFromBlock,
  captureProjectFileState,
  persistNativePreEditBaseline,
  extractAndApplyProjectArtifacts
};
