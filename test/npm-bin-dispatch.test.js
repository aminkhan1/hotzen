const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const source = path.resolve(__dirname, '..');

test('packaged HOTZEN selects the correct bin and preserves alias behavior', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hotzen-bin-test-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  function directory(name) {
    return fs.mkdirSync(path.join(sandbox, name), { recursive: true });
  }
  const work = directory('work');
  const prefix = directory('install');
  const env = {
    ...process.env,
    TMPDIR: sandbox,
    npm_config_cache: directory('cache'),
    npm_config_prefix: directory('global-prefix'),
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };

  function run(command, args, cwd = work, expectedStatus = 0) {
    const result = spawnSync(command, args, {
      cwd, env, input: '', encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus,
      [command, ...args].join(' ') + '\n' + result.stdout + result.stderr);
    return result.stdout;
  }

  function pack(packagePath, destination) {
    const [report] = JSON.parse(run('npm', [
      'pack', packagePath, '--json', '--pack-destination', destination,
    ]));
    return { archive: path.join(destination, report.filename), files: report.files };
  }

  const original = pack(source, directory('original'));
  const extracted = directory('extracted');
  run('tar', ['-xzf', original.archive, '-C', extracted]);
  const fixture = path.join(extracted, 'package');
  const manifestPath = path.join(fixture, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(Object.keys(manifest.bin)[0], 'hotzen');

  // Reproduce the registry's core-first order in a copy of the packed package.
  const { core, hotzen, 'agent-hub-init': init } = manifest.bin;
  manifest.bin = { core, hotzen, 'agent-hub-init': init };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const reordered = pack(fixture, directory('reordered'));
  const packedManifest = JSON.parse(run('tar', ['-xOf', reordered.archive, 'package/package.json']));
  assert.equal(Object.keys(packedManifest.bin)[0], 'core');

  function assertSelection(command, args) {
    const output = run(command, args, work, 1);
    assert.match(output, /Select Tech Stack\(s\) to Deploy/);
    assert.doesNotMatch(output, /Model switching:/);
    assert.deepEqual(fs.readdirSync(work), []);
  }

  // A positional archive spec exercises NPX bin inference without a registry.
  for (const { archive } of [reordered, original]) {
    assertSelection('npx', ['--offline', '--yes', 'file:' + archive]);
  }

  const files = original.files.map(({ path: file }) => file);
  for (const file of ['cli/hotzen.js', 'cli/index.js']) {
    assert.ok(files.includes(file), 'missing from package: ' + file);
  }
  assert.ok(files.every((file) => !/^(test|\.core-plan-bundles)\//.test(file)));

  run('npm', ['install', '--prefix', prefix, '--package-lock=false', original.archive]);
  const bin = (name) => path.join(prefix, 'node_modules', '.bin', name);
  const installed = path.join(prefix, 'node_modules', 'hotzen');
  assert.equal(fs.realpathSync(bin('hotzen')), fs.realpathSync(path.join(installed, 'cli/hotzen.js')));
  for (const alias of ['core', 'agent-hub-init']) {
    assert.equal(fs.realpathSync(bin(alias)), fs.realpathSync(path.join(installed, 'cli/index.js')));
  }

  const status = run(bin('core'), []);
  assert.match(status, /Model switching: OFF/);
  assert.match(status, /frozen for V1/);
  assert.match(status, /Safety Floor: Active/);
  assertSelection(bin('agent-hub-init'), []);
  assert.equal(run(bin('hotzen'), ['switch']), status);
  assert.match(run(bin('hotzen'), ['--help']), /Usage:/);
  assert.deepEqual(fs.readdirSync(work), []);

  for (const stack of ['flutter', 'solidity']) {
    const project = directory(stack);
    const output = run(bin('hotzen'), ['--stack=' + stack, '--bridges=codex'], project);
    assert.match(output, new RegExp('successfully deployed for: ' + stack));
    assert.match(output, /Active AI Bridges: codex/);
    assert.ok(fs.existsSync(path.join(project, 'CODEX.md')));
    const stackSkills = fs.readdirSync(path.join(installed, 'stacks', stack, 'skills'));
    assert.ok(stackSkills.length > 0);
    assert.deepEqual(fs.readdirSync(path.join(project, '.agents', 'skills')), stackSkills);
  }
});
