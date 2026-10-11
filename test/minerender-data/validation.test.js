import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DATASETS, isImpliedItemDefault, writeJson } from '../../extractors/minerender-data/lib.js';
import { effectColor, validateRuntime, validateFixtures, validateDirectory } from '../../extractors/minerender-data/validation.js';

function fixture() {
  return {
    metadata: { minecraftVersion: '1.99', dataVersion: 1 },
    itemDefaults: { 'minecraft:nether_star': { 'minecraft:max_stack_size': 64, 'minecraft:enchantment_glint_override': true } },
    potionColors: { effects: { 'minecraft:red': 0xff0000, 'minecraft:blue': 0x0000ff }, potions: { 'minecraft:empty': [] } },
    blockStates: { 'minecraft:water': { level: { type: 'int', valueType: 'int', default: 0, values: [0, 1] } } },
    fluids: { 'minecraft:water': { kind: 'water', levelProperty: 'level', renderModel: false } },
    dyes: Object.fromEntries(Array.from({ length: 16 }, (_, id) => [`dye_${id}`, { id, textureDiffuseColor: 0, fireworkColor: 0, textColor: 0 }]))
  };
}

test('only a stack size of 64 with no other components is implied', () => {
  assert.equal(isImpliedItemDefault({ 'minecraft:max_stack_size': 64 }), true);
  for (const size of [1, 16, 32, '64']) assert.equal(isImpliedItemDefault({ 'minecraft:max_stack_size': size }), false);
  for (const glint of [true, false]) assert.equal(isImpliedItemDefault({ 'minecraft:max_stack_size': 64, 'minecraft:enchantment_glint_override': glint }), false);
  assert.equal(isImpliedItemDefault({}), false);
  assert.equal(isImpliedItemDefault({ 'minecraft:enchantment_glint_override': true }), false);
});

test('runtime validation rejects wrong versions, invalid defaults, and broken references', () => {
  const data = fixture();
  validateRuntime(data, '1.99');
  assert.throws(() => validateRuntime(data, '1.21.11'), /version/);
  data.blockStates['minecraft:water'].level.default = 2;
  assert.throws(() => validateRuntime(data, '1.99'), /property default/);
  data.blockStates['minecraft:water'].level.default = 0;
  data.fluids['minecraft:water'].levelProperty = 'missing';
  assert.throws(() => validateRuntime(data, '1.99'), /level property/);
});

test('potion averages preserve amplifier weighting, invisible effects, and empty mixtures', () => {
  const colors = fixture().potionColors.effects;
  assert.equal(effectColor([{ id: 'minecraft:red', amplifier: 1 }, { id: 'minecraft:blue', amplifier: 0 }], colors), 0xaa0055);
  assert.equal(effectColor([{ id: 'minecraft:blue', amplifier: 9, show_particles: false }], colors), null);
  assert.equal(effectColor([], colors), null);
});

test('legacy potion colors preserve float rounding and distinguish empty from hidden effects', () => {
  const colors = { 'minecraft:strength': 0xffc700, 'minecraft:unluck': 0xc0a44d };
  const effects = [{ id: 'minecraft:strength', amplifier: 0 }, { id: 'minecraft:unluck', amplifier: 1 }];
  assert.equal(effectColor(effects, colors), 14004019);
  assert.equal(effectColor(effects, colors, true), 13938483);
  assert.equal(effectColor(effects.map(effect => ({ ...effect, show_particles: false })), colors, true), 0);
  assert.equal(effectColor([], colors, true), 3694022);
});

function nativeFixtures(version, potionColor) {
  const data = fixture();
  data.metadata.minecraftVersion = version;
  data.itemDefaults = { 'minecraft:wooden_sword': { 'minecraft:max_stack_size': 1, 'minecraft:max_damage': 10, 'minecraft:damage': 0 } };
  const samples = [1, 8, 16, 32, 64].map(count => ({ count, damage: 0, barVisible: false, barWidth: 13 }));
  samples.push({ count: 1, damage: 5, barVisible: true, barWidth: 7 }, { count: 1, damage: 10, barVisible: true, barWidth: 0 });
  return { data, native: { minecraftVersion: version,
    items: { 'minecraft:wooden_sword': samples.map(sample => ({ ...sample, maxStackSize: 1, maxDamage: 10 })) },
    potions: { 'minecraft:empty': potionColor }, effectMixtures: [] } };
}

test('native potion fixtures use the declared version and durability checks cannot be disabled', () => {
  for (const [version, potionColor] of [['1.20.1', 3694022], ['1.20.6', null]]) {
    const { data, native } = nativeFixtures(version, potionColor);
    assert.deepEqual(validateFixtures(data, native), { itemSamples: 7, potionColors: 1, effectMixtures: 0 });
    native.potions['minecraft:empty'] = potionColor === null ? 3694022 : null;
    assert.throws(() => validateFixtures(data, native), /Native potion color differs/);
    native.potions['minecraft:empty'] = potionColor;
    native.capabilities = { itemBars: false };
    assert.throws(() => validateFixtures(data, native), /capability/);
    native.capabilities.itemBars = true;
    delete native.items['minecraft:wooden_sword'][0].barWidth;
    assert.throws(() => validateFixtures(data, native), /Native durability bar differs/);
  }
});

test('1.16.5 reports unavailable durability checks and rejects invented native bar samples', () => {
  const { data, native } = nativeFixtures('1.16.5', 3694022);
  native.capabilities = { itemBars: false };
  for (const sample of native.items['minecraft:wooden_sword']) {
    delete sample.barVisible;
    delete sample.barWidth;
  }
  assert.deepEqual(validateFixtures(data, native), { itemSamples: 7, potionColors: 1, effectMixtures: 0,
    unavailableChecks: { durabilityBars: 'Minecraft 1.16.5 does not expose native durability bar methods.' } });
  native.items['minecraft:wooden_sword'][0].barVisible = false;
  assert.throws(() => validateFixtures(data, native), /Unexpected native durability bar sample/);
  delete native.items['minecraft:wooden_sword'][0].barVisible;
  delete native.capabilities;
  assert.throws(() => validateFixtures(data, native), /capability/);
});

test('publication validation rejects tampering, version mismatches, and undeclared datasets', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minerender-data-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = fixture(), datasets = {};
  for (const [name, file] of Object.entries(DATASETS)) if (data[name]) datasets[name] = await writeJson(directory, file, data[name]);
  const version = { id: '1.99', sha1: 'a'.repeat(40), url: 'https://example.com/version.json' };
  const manifest = { schemaVersion: 1, minecraftVersion: '1.99', dataVersion: 1,
    source: { client: { sha1: 'b'.repeat(40), url: 'https://example.com/client.jar' }, metadata: { sha1: version.sha1, url: version.url } },
    extractor: { revision: null, sha256: 'c'.repeat(64) }, datasets,
    unavailable: { blockTints: 'Not reviewed', legacyBlocks: 'Not reviewed' } };
  await writeJson(directory, 'version.json', version);
  await writeJson(directory, 'manifest.json', manifest);
  await writeJson(directory, '_list.json', { directories: [], files: ['manifest.json', 'version.json', ...Object.values(datasets).map(entry => entry.file)].sort() });
  await t.test('historical manifests remain valid without additive datasets', async () => {
    assert.equal(Object.hasOwn(manifest.datasets, 'fluidStates'), false);
    assert.equal(Object.hasOwn(manifest.unavailable, 'fluidStates'), false);
    assert.equal(Object.hasOwn(manifest.datasets, 'itemProperties'), false);
    assert.equal(Object.hasOwn(manifest.unavailable, 'itemProperties'), false);
    await validateDirectory(directory, '1.99');
  });
  await t.test('publication validation rejects implied item defaults', async () => {
    datasets.itemDefaults = await writeJson(directory, DATASETS.itemDefaults,
      { ...data.itemDefaults, 'minecraft:stone': { 'minecraft:max_stack_size': 64 } });
    await writeJson(directory, 'manifest.json', manifest);
    await assert.rejects(validateDirectory(directory), { message: 'item-defaults.json must omit items whose only default is a stack size of 64' });
    datasets.itemDefaults = await writeJson(directory, DATASETS.itemDefaults, data.itemDefaults);
    await writeJson(directory, 'manifest.json', manifest);
  });
  await assert.rejects(validateDirectory(directory, '1.21.11'), /version mismatch/);
  const filename = path.join(directory, 'item-defaults.json'), original = await readFile(filename);
  await writeFile(filename, '{}');
  await assert.rejects(validateDirectory(directory), /checksum/);
  await writeFile(filename, original);
  delete manifest.unavailable.blockTints;
  await writeJson(directory, 'manifest.json', manifest);
  await assert.rejects(validateDirectory(directory), /Unreported dataset/);
});
