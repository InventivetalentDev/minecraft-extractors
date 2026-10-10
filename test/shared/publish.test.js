import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, writeJson } from '../../extractors/minerender-data/lib.js';
import { UnsupportedRulesVersionError } from '../../extractors/minerender-data/rules.js';
import { writeDataset } from '../../extractors/entity-models/lib.js';
import { extractorIdentity } from '../../lib/identity.js';
import { run } from '../../lib/runtime.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function dataFixture(directory, repository, version) {
  await mkdir(directory);
  const dyeNames = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const data = {
    itemDefaults: { 'minecraft:ender_pearl': { 'minecraft:max_stack_size': 16 } },
    potionColors: { effects: { 'minecraft:speed': 3402751 }, potions: {
      'minecraft:swiftness': [{ id: 'minecraft:speed', amplifier: 0 }]
    } },
    blockStates: { 'minecraft:water': {
      level: { type: 'int', valueType: 'Integer', values: [0, 1], default: 0 }
    } },
    fluids: { 'minecraft:water': { kind: 'water', renderModel: false, levelProperty: 'level' } },
    dyes: Object.fromEntries(dyeNames.map((name, id) => [name, {
      id, textureDiffuseColor: id, fireworkColor: id, textColor: id
    }]))
  };
  const datasets = {};
  for (const [name, value] of Object.entries(data)) datasets[name] = {
    ...await writeJson(directory, DATASETS[name], value),
    provenance: { kind: 'vanilla-runtime', registry: name }
  };
  const metadata = { sha1: '3'.repeat(40), url: 'https://example.test/version.json' };
  const reason = new UnsupportedRulesVersionError(version).message;
  const manifest = {
    schemaVersion: 1, minecraftVersion: version, dataVersion: 1,
    extractor: await extractorIdentity(repository),
    source: {
      metadata,
      client: { sha1: '1'.repeat(40), url: 'https://example.test/client.jar' },
      mappings: { sha1: '2'.repeat(40), url: 'https://example.test/client.txt' },
      remapper: { version: '2.0.18', sha1: '59bd788e0a1bd339256711dee40015a62cdf3cd2' }
    },
    datasets, unavailable: { blockTints: reason, legacyBlocks: reason },
    validation: { itemSamples: 5, potionColors: 1, effectMixtures: 1 }
  };
  await writeJson(directory, 'version.json', { id: version, ...metadata });
  await writeJson(directory, 'manifest.json', manifest);
  const files = ['manifest.json', 'version.json', ...Object.values(datasets).map(entry => entry.file)].sort();
  await writeJson(directory, '_list.json', { directories: [], files });
  return { manifest, files: [...files, '_list.json'].sort() };
}

async function repositories(t) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minecraft-extractors-publish-test-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tooling = path.join(temporary, 'tooling'), repository = path.join(temporary, 'dataset');
  const origin = path.join(temporary, 'origin.git');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: path.join(temporary, 'empty-config'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: path.join(temporary, 'hooks'),
    GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  await mkdir(env.GIT_CONFIG_VALUE_0);
  const git = (args, cwd = repository) => run('git', args, { cwd, env });
  for (const checkout of [tooling, repository]) {
    await mkdir(checkout);
    await git(['init', '--initial-branch=main'], checkout);
    await git(['config', 'user.name', 'Dataset test'], checkout);
    await git(['config', 'user.email', 'dataset@example.test'], checkout);
  }
  for (const file of ['lib', 'tools', 'extractors', 'package.json', '.gitignore']) {
    await cp(path.join(root, file), path.join(tooling, file), { recursive: true });
  }
  await git(['add', '--all'], tooling);
  await git(['commit', '-m', 'Tooling fixture'], tooling);
  await writeFile(path.join(repository, 'README.md'), 'Published dataset repository.\n');
  await git(['add', '--all']);
  await git(['commit', '-m', 'Dataset fixture']);
  await git(['init', '--bare', '--initial-branch=main', origin]);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', 'origin', 'main']);
  const toolingMain = (await git(['rev-parse', 'main'], tooling)).trim();
  const main = (await git(['rev-parse', 'main'])).trim();
  const publish = (dataset, version, input, destination = repository) => run(process.execPath,
    [path.join(tooling, 'tools/publish.js'), '--dataset', dataset, '--version', version,
      '--input', input, '--repository', destination, '--push'], { cwd: tooling, env });
  const remoteHead = async version => (await git(['--git-dir', origin, 'rev-parse', `refs/heads/${version}`])).trim();
  const unchanged = async () => {
    assert.equal((await git(['rev-parse', 'main'], tooling)).trim(), toolingMain);
    assert.equal((await git(['branch', '--format=%(refname:short)'], tooling)).trim(), 'main');
    assert.equal((await git(['rev-parse', 'main'])).trim(), main);
    for (const checkout of [tooling, repository]) {
      assert.equal((await git(['branch', '--show-current'], checkout)).trim(), 'main');
      assert.equal((await git(['status', '--porcelain'], checkout)).trim(), '');
      assert.equal((await git(['worktree', 'list', '--porcelain'], checkout)).match(/^worktree /gm).length, 1);
    }
  };
  return { temporary, tooling, repository, git, publish, remoteHead, unchanged };
}

test('publishing changes only the destination version branch and preserves its history', async t => {
  const { temporary, tooling, git, publish, remoteHead, unchanged } = await repositories(t);
  const version = '1.99.0', input = path.join(temporary, 'data');
  const fixture = await dataFixture(input, tooling, version);
  const publishData = (requested = version, destination) => publish('minerender-data', requested, input, destination);
  await publishData();
  const published = (await git(['rev-parse', version])).trim();
  assert.equal(await remoteHead(version), published);
  assert.deepEqual((await git(['ls-tree', '-r', '--name-only', version])).trim().split('\n').sort(), fixture.files);
  assert.equal((await git(['rev-list', '--parents', '-n', '1', version])).trim(), published);
  await unchanged();

  await publishData();
  assert.equal((await git(['rev-parse', version])).trim(), published);
  assert.equal(await remoteHead(version), published);
  await assert.rejects(publishData('main'), /Use an exact Minecraft version/);
  await assert.rejects(publishData('1.99.1'), /Published dataset version mismatch/);
  await assert.rejects(publishData(version, tooling), /Publish to a dataset repository/);
  await writeJson(input, 'manifest.json', { ...fixture.manifest,
    datasets: { ...fixture.manifest.datasets,
      itemDefaults: { ...fixture.manifest.datasets.itemDefaults, sha256: '0'.repeat(64) } } });
  await assert.rejects(publishData(), /Dataset checksum mismatch/);
  await writeJson(input, 'manifest.json', { ...fixture.manifest,
    extractor: { ...fixture.manifest.extractor, revision: '0'.repeat(40) } });
  await assert.rejects(publishData(), /Re-extract using the committed current tooling/);
  await writeJson(input, 'manifest.json', fixture.manifest);
  assert.equal(await remoteHead(version), published);

  const itemDefaults = await writeJson(input, DATASETS.itemDefaults,
    { 'minecraft:stick': { 'minecraft:max_stack_size': 32 } });
  await writeJson(input, 'manifest.json', { ...fixture.manifest, datasets: { ...fixture.manifest.datasets,
    itemDefaults: { ...fixture.manifest.datasets.itemDefaults, ...itemDefaults } } });
  await publishData();
  const updated = (await git(['rev-parse', version])).trim();
  assert.notEqual(updated, published);
  assert.equal(await remoteHead(version), updated);
  assert.equal((await git(['rev-list', '--parents', '-n', '1', version])).trim(), `${updated} ${published}`);
  await unchanged();

  const tree = (await git(['rev-parse', `${version}^{tree}`])).trim();
  const concurrent = (await git(['commit-tree', tree, '-p', updated, '-m', 'Concurrent update'])).trim();
  await git(['push', 'origin', `${concurrent}:refs/heads/${version}`]);
  await assert.rejects(publishData(), /differs from origin; reconcile it before publishing/);
  assert.equal(await remoteHead(version), concurrent);
  assert.equal((await git(['rev-parse', version])).trim(), updated);
  await unchanged();
});

test('entity publication retains nested data paths and excludes the extraction report', async t => {
  const { temporary, git, publish, remoteHead, unchanged } = await repositories(t);
  const version = '1.99.0', input = path.join(temporary, 'entities');
  await writeDataset(input, { id: version }, [{ id: 'minecraft:cow', transform: [], layers: { main: {
    texture: [64, 32], textureLocation: 'minecraft:textures/entity/cow/cow.png',
    root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} }
  } } }]);
  await writeFile(path.join(input, '_textures.report.json'), '{}\n');
  await publish('entity-models', version, input);
  const files = (await git(['ls-tree', '-r', '--name-only', version])).trim().split('\n').sort();
  assert.deepEqual(files, ['_list.json', 'minecraft/_list.json', 'minecraft/cow.json', 'version.json']);
  const published = (await git(['rev-parse', version])).trim();
  assert.equal(await remoteHead(version), published);
  await publish('entity-models', version, input);
  assert.equal(await remoteHead(version), published);
  await assert.rejects(publish('entity-models', '1.99.1', input), /version.json does not match/);
  await unchanged();
});
