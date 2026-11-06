'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { safeResolveWorkspacePath } = require('./project_artifact_extractor');
const { BLOCKED_FILE_PATTERNS } = require('../critic/deterministic_workspace_critic');

const VERSION = 'core.verification_contract.v1';
const SELECTION_FILES = Object.freeze([
  'pubspec.yaml', 'Cargo.toml', 'go.mod', 'composer.json', 'foundry.toml',
  'hardhat.config.js', 'hardhat.config.ts', 'truffle-config.js', 'package.json',
  'tsconfig.json', 'mypy.ini', 'pyproject.toml', 'setup.cfg', 'project.godot',
  'CMakeLists.txt', 'requirements.txt', 'Pipfile', 'setup.py'
]);

function fileDigest(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
  catch (error) { return error && error.code === 'ENOENT' ? null : 'unreadable'; }
}

// This is the existing CLI matrix, moved here so planning and execution select
// the same checks. Conditional entries are added below from workspace evidence.
const STACK_COMMANDS = Object.freeze({
  flutter: [['Analyze', 'flutter analyze'], ['Tests', 'flutter test']],
  'dart-backend': [['Analyze', 'dart analyze'], ['Tests', 'dart test']],
  rust: [['Cargo Check', 'cargo check'], ['Tests', 'cargo test']],
  golang: [['Go Vet', 'go vet ./...'], ['Tests', 'go test ./...']],
  react: [['Lint', 'npm run lint'], ['Test', 'npm test -- --watchAll=false']],
  'react-nextjs': [['Lint', 'npm run lint'], ['Test', 'npm test']],
  vue: [['Lint', 'npm run lint'], ['Test', 'npm test']],
  nodejs: [['Test', 'npm test']],
  nestjs: [['Lint', 'npm run lint'], ['Test', 'npm test']],
  'python-fastapi': [['Test', 'pytest']],
  'python-ai-ml': [['Test', 'pytest']],
  laravel: [['Artisan Test', 'php artisan test']],
  kotlin: [['Gradle Check', './gradlew check']],
  java: [['Gradle Test', './gradlew test']],
  swift: [['Swift Test', 'swift test']],
  cpp: [['CTest', 'ctest']],
  php: [['PHPUnit', 'composer test']],
  dotnet: [['Dotnet Test', 'dotnet test']],
  'vanilla-web': [['Web Test', 'npm test']],
  wordpress: [['WP Test', 'composer test']],
  bash: [['ShellCheck', 'shellcheck']]
});

function detectStack(targetDir = process.cwd()) {
  const check = (relPath) => fs.existsSync(path.join(targetDir, relPath));
  const read = (relPath) => {
    try { return fs.readFileSync(path.join(targetDir, relPath), 'utf8'); } catch (_) { return ''; }
  };

  // 1. Flutter / Dart
  if (check('pubspec.yaml')) {
    const pubspec = read('pubspec.yaml');
    if (pubspec.includes('flutter:')) {
      return { stack: 'flutter', confidence: 0.95, evidence: ['pubspec.yaml (flutter sdk)'] };
    }
    return { stack: 'dart-backend', confidence: 0.85, evidence: ['pubspec.yaml (dart sdk)'] };
  }

  // 2. Rust
  if (check('Cargo.toml')) {
    return { stack: 'rust', confidence: 0.95, evidence: ['Cargo.toml'] };
  }

  // 3. Go
  if (check('go.mod')) {
    return { stack: 'golang', confidence: 0.95, evidence: ['go.mod'] };
  }

  // 4. WordPress (checked before composer.json so Bedrock/composer WordPress projects are correctly classified)
  if (check('wp-config.php') || check('wp-content')) {
    return { stack: 'wordpress', confidence: 0.95, evidence: ['wp-config.php / wp-content'] };
  }

  // 4b. PHP / Laravel
  if (check('composer.json')) {
    const composer = read('composer.json');
    if (composer.includes('laravel/framework')) {
      return { stack: 'laravel', confidence: 0.95, evidence: ['composer.json (laravel/framework)'] };
    }
    return { stack: 'php', confidence: 0.85, evidence: ['composer.json'] };
  }

  // 5. Blockchain & Smart Contracts (Solidity / Foundry / Hardhat)
  if (check('foundry.toml')) {
    return { stack: 'solidity', confidence: 0.95, evidence: ['foundry.toml (Foundry framework)'] };
  }
  if (check('hardhat.config.js') || check('hardhat.config.ts')) {
    return { stack: 'solidity', confidence: 0.95, evidence: ['hardhat.config (Hardhat framework)'] };
  }
  if (check('truffle-config.js')) {
    return { stack: 'solidity', confidence: 0.9, evidence: ['truffle-config.js'] };
  }
  try {
    if (check('contracts') && fs.readdirSync(path.join(targetDir, 'contracts')).some(f => f.endsWith('.sol'))) {
      return { stack: 'solidity', confidence: 0.9, evidence: ['contracts/*.sol files'] };
    }
  } catch (_) {}

  // 6. JavaScript / TypeScript / Node / React / Next / Vue / Nest
  if (check('package.json')) {
    const pkgStr = read('package.json');
    let pkg = {};
    try { pkg = JSON.parse(pkgStr); } catch (_) {}
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (deps['hardhat']) {
      return { stack: 'solidity', confidence: 0.95, evidence: ['hardhat dependency'] };
    }
    if (check('next.config.js') || check('next.config.mjs') || check('next.config.ts') || deps['next']) {
      return { stack: 'react-nextjs', confidence: 0.95, evidence: ['next.js configuration/dependency'] };
    }
    if (deps['@nestjs/core'] || check('nest-cli.json')) {
      return { stack: 'nestjs', confidence: 0.95, evidence: ['@nestjs/core dependency'] };
    }
    if (deps['vue'] || deps['nuxt'] || check('nuxt.config.js') || check('nuxt.config.ts')) {
      return { stack: 'vue', confidence: 0.95, evidence: ['vue/nuxt dependency'] };
    }
    if (deps['react'] || deps['react-dom']) {
      return { stack: 'react', confidence: 0.9, evidence: ['react dependency'] };
    }
    if (deps['express'] || deps['koa'] || deps['fastify'] || deps['hono']) {
      return { stack: 'nodejs', confidence: 0.85, evidence: ['node backend framework'] };
    }
    return { stack: 'vanilla-web', confidence: 0.5, evidence: ['package.json (generic web/node without known framework)'] };
  }

  // 6b. Static HTML / Vanilla Web (projects without package.json)
  if (check('index.html') || check('index.htm')) {
    return { stack: 'vanilla-web', confidence: 0.85, evidence: ['index.html file'] };
  }

  // 7. Python (FastAPI / AI-ML)
  if (check('requirements.txt') || check('pyproject.toml') || check('Pipfile') || check('setup.py')) {
    const pyReq = read('requirements.txt') + '\n' + read('pyproject.toml') + '\n' + read('Pipfile') + '\n' + read('setup.py');
    const hasML = /torch|tensorflow|scikit-learn|sklearn|transformers|pandas|numpy|diffusers/i.test(pyReq);
    const hasFastAPI = /fastapi|uvicorn/i.test(pyReq);
    if (hasFastAPI) {
      return { stack: 'python-fastapi', confidence: 0.9, evidence: ['fastapi requirement'] };
    }
    if (hasML) {
      return { stack: 'python-ai-ml', confidence: 0.9, evidence: ['ai/ml libraries requirement'] };
    }
    return { stack: 'python-fastapi', confidence: 0.5, evidence: ['python configuration (generic fallback)'] };
  }

  // 8. Game Engines (Specific markers checked before generic .csproj / .sln)
  try {
    const files = fs.readdirSync(targetDir);
    if (files.some(f => f.endsWith('.uproject'))) {
      return { stack: 'unreal-engine', confidence: 0.95, evidence: ['*.uproject file'] };
    }
  } catch (_) {}

  if (check('project.godot')) {
    return { stack: 'godot', confidence: 0.95, evidence: ['project.godot'] };
  }
  if (check('Assets') && check('ProjectSettings')) {
    return { stack: 'unity', confidence: 0.95, evidence: ['Unity project structure (Assets + ProjectSettings)'] };
  }

  // 9. GDScript
  try {
    const files = fs.readdirSync(targetDir);
    if (files.some(f => f.endsWith('.gd'))) {
      return { stack: 'gdscript', confidence: 0.9, evidence: ['*.gd GDScript files'] };
    }
  } catch (_) {}

  // 10. Dotnet / C#
  try {
    const files = fs.readdirSync(targetDir);
    if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln') || f.endsWith('.fsproj'))) {
      return { stack: 'dotnet', confidence: 0.95, evidence: ['*.csproj / *.sln file'] };
    }
    // 11. Swift / iOS
    if (check('Package.swift') || files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) {
      return { stack: 'swift', confidence: 0.95, evidence: ['Swift Package / Xcode project'] };
    }
  } catch (_) {}

  // 12. Kotlin / Java
  if (check('pom.xml') || check('build.gradle') || check('build.gradle.kts')) {
    const gradle = read('build.gradle') + '\n' + read('build.gradle.kts');
    let isKotlin = gradle.includes('kotlin');
    try {
      const files = fs.readdirSync(targetDir);
      if (files.some(f => f.endsWith('.kt'))) isKotlin = true;
    } catch (_) {}
    if (isKotlin) {
      return { stack: 'kotlin', confidence: 0.9, evidence: ['kotlin build configuration'] };
    }
    return { stack: 'java', confidence: 0.9, evidence: ['java build configuration'] };
  }

  // 13. C++
  if (check('CMakeLists.txt')) {
    return { stack: 'cpp', confidence: 0.85, evidence: ['CMakeLists.txt'] };
  }

  // 14. Database (SQL files or migrations directory)
  try {
    const files = fs.readdirSync(targetDir);
    if (check('migrations') || files.some(f => f.endsWith('.sql'))) {
      return { stack: 'database', confidence: 0.85, evidence: ['sql files or migrations directory'] };
    }
  } catch (_) {}

  // 15. Bash / Shell scripts
  try {
    const files = fs.readdirSync(targetDir);
    if (files.some(f => f.endsWith('.sh') || f.endsWith('.bash'))) {
      return { stack: 'bash', confidence: 0.85, evidence: ['*.sh / *.bash script files'] };
    }
  } catch (_) {}

  return { stack: 'core', confidence: 0.5, evidence: ['Universal raw core (no specific stack signature detected)'] };
}


function findExecutable(workspace, command) {
  const local = command.includes('/') || command.includes('\\');
  const dirs = local ? [''] : (process.env.PATH || '').split(path.delimiter);
  const suffixes = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = local ? path.resolve(workspace, command + suffix) : path.resolve(workspace, dir || '.', command + suffix);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
      } catch {}
    }
  }
  return null;
}

function selected(name, cmd, workspace, applicability = 'required', reason = null) {
  const parts = cmd.split(/\s+/);
  const executable = parts[0];
  const args = parts.slice(1);
  const toolPath = findExecutable(workspace, executable);
  let toolStatus = toolPath ? 'available' : 'missing';
  let toolReason = toolPath ? null : `Executable '${executable}' not found`;
  const toolDigest = toolPath ? fileDigest(toolPath) : null;
  if (toolPath && (!toolDigest || toolDigest === 'unreadable')) {
    toolStatus = 'unavailable';
    toolReason = `Executable '${executable}' could not be fingerprinted`;
  }
  let nestedTool = null;
  if (executable === 'npx' && parts[1]) {
    const localPackage = path.join(workspace, 'node_modules', '.bin', parts[1]);
    try {
      fs.accessSync(localPackage, fs.constants.X_OK);
      nestedTool = { path: fs.realpathSync(localPackage), digest: fileDigest(fs.realpathSync(localPackage)) };
      if (!nestedTool.digest || nestedTool.digest === 'unreadable') {
        toolStatus = 'unavailable';
        toolReason = `Local package executable '${parts[1]}' could not be fingerprinted`;
      }
    } catch {
      toolStatus = 'missing';
      toolReason = `Local package executable '${parts[1]}' not found`;
    }
  }
  if (executable === 'npm' && parts[1]) {
    const script = parts[1] === 'run' ? parts[2] : parts[1];
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
      if (!pkg.scripts || !pkg.scripts[script]) {
        toolStatus = 'missing';
        toolReason = `package.json script '${script}' not found`;
      }
    } catch {
      toolStatus = 'missing';
      toolReason = 'package.json could not be read';
    }
  }
  return { name, cmd, executable, args, required: true, applicability, reason,
    tool: { status: toolStatus, path: toolPath, digest: toolDigest, nestedTool, reason: toolReason } };
}

function notApplicable(name, cmd, reason) {
  return { name, cmd, required: false, applicability: 'not_applicable', reason, tool: { status: 'not_applicable', path: null, reason } };
}

// File-state evidence lives in the existing Verification Contract, so the
// existing approved Plan digest and Receipt bind it without another store.
function approvedScopePath(file) {
  return typeof file === 'string' && file.length > 0 && !file.includes('\\') &&
    !file.includes('\0') && !path.isAbsolute(file) &&
    file.split('/').every(part => part && part !== '.' && part !== '..') &&
    !['.agents', '.git'].includes(file.split('/')[0]) &&
    !BLOCKED_FILE_PATTERNS.some(pattern => pattern.test(path.basename(file)));
}

/** Read a regular file or prove absence; never turn access/type errors into absence. */
function readApprovedFileState(targetDir, file) {
  if (!approvedScopePath(file)) return { ok: false, reason: 'invalid_approved_file', file };
  try {
    const root = fs.realpathSync(targetDir);
    const parts = file.split('/');
    let full = root;
    for (let index = 0; index < parts.length; index++) {
      full = path.join(full, parts[index]);
      let stat;
      try { stat = fs.lstatSync(full); }
      catch (error) {
        if (error.code === 'ENOENT') return { ok: true, state: 'absent', digest: null };
        return { ok: false, reason: 'approved_file_access_error', file, code: error.code };
      }
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
        return { ok: false, reason: 'invalid_approved_file', file };
      }
    }
    // O_NOFOLLOW also rejects a leaf replaced with a symlink between lstat/read.
    const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(fd).isFile()) return { ok: false, reason: 'invalid_approved_file', file };
      const real = fs.realpathSync(full);
      if (path.relative(root, real) !== file.split('/').join(path.sep)) {
        return { ok: false, reason: 'invalid_approved_file', file };
      }
      return { ok: true, state: 'present', digest: crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex') };
    } finally { fs.closeSync(fd); }
  } catch (error) {
    // A disappearance after lstat is a race/error, not proven approved absence.
    return { ok: false, reason: 'approved_file_access_error', file, code: error.code };
  }
}

function validateApprovedFileStates(fileStates, expectedFiles) {
  const invalid = { ok: false, reason: 'invalid_approved_file_states' };
  if (!fileStates || fileStates.version !== 1 || !Array.isArray(expectedFiles) ||
      !expectedFiles.length || expectedFiles.some(file => !approvedScopePath(file)) ||
      new Set(expectedFiles).size !== expectedFiles.length ||
      !Array.isArray(fileStates.operations) || !Array.isArray(fileStates.entries) ||
      fileStates.entries.length !== expectedFiles.length) return invalid;
  const scope = new Set(expectedFiles);
  const touched = new Set();
  const absent = new Set();
  const sources = new Set();
  for (const op of fileStates.operations) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return invalid;
    const keys = Object.keys(op).sort().join(',');
    const files = op.type === 'delete' && keys === 'path,type' ? [op.path]
      : op.type === 'move' && keys === 'from,to,type' ? [op.from, op.to] : null;
    if (!files || files.some(file => !scope.has(file) || touched.has(file)) || new Set(files).size !== files.length) return invalid;
    files.forEach(file => touched.add(file));
    absent.add(files[0]);
    sources.add(files[0]);
  }
  const seen = new Set();
  for (const entry of fileStates.entries) {
    if (!entry || !scope.has(entry.file) || seen.has(entry.file) || !entry.initial ||
        !['present', 'absent'].includes(entry.initial.state) ||
        (entry.initial.state === 'present'
          ? !/^[a-f0-9]{64}$/.test(entry.initial.digest)
          : entry.initial.digest !== null) ||
        (sources.has(entry.file) && entry.initial.state !== 'present') ||
        entry.expectedState !== (absent.has(entry.file) ? 'absent' : 'present')) return invalid;
    seen.add(entry.file);
  }
  return { ok: true };
}

function captureApprovedFileStates(targetDir, expectedFiles, operations) {
  if (!Array.isArray(operations)) throw new Error('Invalid file operations: expected an explicit array.');
  const absent = new Set(operations.filter(op => op && ['delete', 'move'].includes(op.type))
    .map(op => op.type === 'delete' ? op.path : op.from));
  const entries = expectedFiles.map(file => {
    const initial = readApprovedFileState(targetDir, file);
    if (!initial.ok) throw new Error(`Cannot capture approved file state: ${file}: ${initial.reason}`);
    return { file, initial: { state: initial.state, digest: initial.digest },
      expectedState: absent.has(file) ? 'absent' : 'present' };
  }).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const fileStates = { version: 1, operations: operations.map(op => ({ ...op })), entries };
  if (!validateApprovedFileStates(fileStates, expectedFiles).ok) {
    throw new Error('Invalid approved file operations, initial states, or scope; create a fresh Plan before edits.');
  }
  return fileStates;
}

function resolveVerificationContract(targetDir, options = {}) {
  const workspace = path.resolve(targetDir);
  const detected = options.stack || detectStack(workspace).stack;
  const expectedFiles = Array.isArray(options.expectedFiles) ? options.expectedFiles : [];
  const fileStates = options.fileStates;
  if (fileStates !== undefined && !validateApprovedFileStates(fileStates, expectedFiles).ok) {
    throw new Error('Invalid approved file states in Verification Contract.');
  }
  const absentFiles = new Set(fileStates ? fileStates.entries.filter(entry => entry.expectedState === 'absent').map(entry => entry.file) : []);
  const checks = [];
  for (const rel of expectedFiles) {
    if (absentFiles.has(rel)) continue;
    const full = safeResolveWorkspacePath(workspace, rel);
    if (!full) continue;
    const ext = path.extname(rel).toLowerCase();
    if (['.js', '.cjs', '.mjs'].includes(ext)) {
      const cmd = `node --check ${JSON.stringify(full)}`;
      const check = selected(`Syntax: ${rel}`, 'node --check', workspace, 'conditional', 'Approved JavaScript file');
      checks.push({ ...check, cmd, args: ['--check', full] });
    } else if (ext === '.py') {
      const parser = 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), filename=sys.argv[1])';
      const check = selected(`Syntax: ${rel}`, 'python3 -c', workspace, 'conditional', 'Approved Python file');
      checks.push({ ...check, cmd: `python3 -c ${JSON.stringify(parser)} ${JSON.stringify(full)}`, args: ['-c', parser, full] });
    }
  }

  for (const [name, cmd] of STACK_COMMANDS[detected] || []) {
    if (!options.legacy && ['flutter', 'dart-backend'].includes(detected) && name === 'Tests' &&
        !fs.existsSync(path.join(workspace, 'test')) && !expectedFiles.some(file => file.startsWith('test/'))) {
      checks.push(notApplicable(name, cmd, 'No test directory or approved test file'));
    } else {
      checks.push(selected(name, cmd, workspace));
    }
  }

  if (detected === 'solidity') {
    if (fs.existsSync(path.join(workspace, 'foundry.toml'))) checks.push(selected('Forge Test', 'forge test', workspace, 'conditional', 'foundry.toml present'));
    else if (fs.existsSync(path.join(workspace, 'hardhat.config.js')) || fs.existsSync(path.join(workspace, 'hardhat.config.ts')) || (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
        return Boolean({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }.hardhat);
      } catch { return false; }
    })()) checks.push(selected('Hardhat Test', 'npx hardhat test', workspace, 'conditional', 'Hardhat config/dependency present'));
    else if (fs.existsSync(path.join(workspace, 'truffle-config.js'))) checks.push(selected('Truffle Test', 'npx truffle test', workspace, 'conditional', 'Truffle config present'));
  }
  if (fs.existsSync(path.join(workspace, 'tsconfig.json')) && ['react', 'react-nextjs', 'vue', 'nodejs', 'nestjs'].includes(detected)) {
    const typeCheck = selected('Type Check', 'npx tsc --noEmit', workspace, 'conditional', 'tsconfig.json present');
    checks.splice(checks.length > 1 ? 1 : 0, 0, typeCheck);
  }
  if ((fs.existsSync(path.join(workspace, 'mypy.ini')) || fs.existsSync(path.join(workspace, 'pyproject.toml')) || fs.existsSync(path.join(workspace, 'setup.cfg'))) &&
      ['python-fastapi', 'python-ai-ml'].includes(detected)) {
    checks.unshift(selected('Type Check', 'mypy .', workspace, 'conditional', 'Python type-check config present'));
  }
  if (!checks.some(check => check.required && !check.name.startsWith('Syntax:'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.test) checks.push(selected('NPM Test', 'npm test', workspace, 'conditional', 'package.json test script present'));
    } catch {}
  }
  const required = checks.filter(check => check.required);
  const blockingReasons = required.length === 0 ? [`No verification checks configured for stack: ${detected}`] : [];
  for (const check of required) if (check.tool.status !== 'available') blockingReasons.push(`${check.name}: ${check.tool.reason}`);
  const selectionInputs = Object.fromEntries(SELECTION_FILES.map(rel => [rel, fileDigest(path.join(workspace, rel))]));
  for (const [rel, digest] of Object.entries(selectionInputs)) {
    if (digest === 'unreadable') blockingReasons.push(`Cannot fingerprint verification configuration: ${rel}`);
  }
  return { version: VERSION, stack: detected, selectionInputs, checks,
    ...(fileStates !== undefined ? { fileStates } : {}),
    status: blockingReasons.length ? 'blocked' : 'ready', blockingReasons };
}

function compareVerificationContract(targetDir, contract, options = {}) {
  if (!contract || contract.version !== VERSION) return { ok: false, reason: 'Invalid verification contract' };
  if (contract.fileStates !== undefined && !validateApprovedFileStates(contract.fileStates, options.expectedFiles).ok) {
    return { ok: false, reason: 'invalid_approved_file_states' };
  }
  // Preserve the approved initial evidence; comparing tools must not recapture it
  // from the already edited workspace.
  const current = resolveVerificationContract(targetDir, { ...options, fileStates: contract.fileStates });
  return isDeepStrictEqual(contract, current)
    ? { ok: true, current }
    : { ok: false, reason: 'Verification contract changed since Plan Approval', current };
}

module.exports = { VERSION, detectStack, resolveVerificationContract, compareVerificationContract,
  captureApprovedFileStates, validateApprovedFileStates, readApprovedFileState };
