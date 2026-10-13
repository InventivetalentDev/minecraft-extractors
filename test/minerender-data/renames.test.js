import test from 'node:test';
import assert from 'node:assert/strict';
import { renameTarget, validateRenames, validateRenameFixtures } from '../../extractors/minerender-data/renames.js';

function fixture() {
  const entry = (before, to, registered = false) => ({ registered, ranges: [{ before, to }] });
  const data = { format: 'data-fixer-renames', baseDataVersion: 1519,
    blocks: { 'minecraft:sign': entry(1802, 'minecraft:oak_sign'),
      'minecraft:stone_slab': entry(1802, 'minecraft:smooth_stone_slab', true),
      'minecraft:weathered_copper_block': { registered: false, ranges: [
        { before: 2690, to: 'minecraft:oxidized_copper' }, { before: 2691, to: 'minecraft:weathered_copper' }] } },
    items: { 'minecraft:cactus_green': entry(1800, 'minecraft:green_dye') },
    entities: { 'minecraft:zombie_pigman': entry(2509, 'minecraft:zombified_piglin') } };
  const blockStates = Object.fromEntries(['oak_sign', 'stone_slab', 'smooth_stone_slab', 'oxidized_copper', 'weathered_copper'].map(id => [`minecraft:${id}`, {}]));
  const samples = [];
  for (const kind of ['blocks', 'items', 'entities']) {
    for (const [id, { ranges }] of Object.entries(data[kind])) {
      ranges.forEach((range, index) => samples.push(
        { kind, id, dataVersion: range.before - 1, nativeName: range.to },
        { kind, id, dataVersion: range.before, nativeName: ranges[index + 1]?.to ?? id }));
    }
  }
  for (const [kind, id] of [['blocks', 'minecraft:stone'], ['items', 'minecraft:stick'], ['entities', 'minecraft:pig']]) {
    samples.push({ kind, id, dataVersion: 1519, nativeName: id });
  }
  return { data, samples, blockStates };
}

test('rename lookup respects data-version boundaries and registered IDs', () => {
  const { data } = fixture();
  for (const [id, version, expected] of [
    ['sign', 1518, undefined], ['sign', 1519, 'oak_sign'], ['sign', 1801, 'oak_sign'], ['sign', 1802, undefined],
    ['weathered_copper_block', 2689, 'oxidized_copper'], ['weathered_copper_block', 2690, 'weathered_copper'],
    ['weathered_copper_block', 2691, undefined], ['unknown', 1519, undefined],
    ['weathered_copper_block', undefined, 'weathered_copper'], ['stone_slab', undefined, undefined]
  ]) assert.equal(renameTarget(data, 'blocks', `minecraft:${id}`, version), expected && `minecraft:${expected}`);
});

test('native rename fixtures cover both sides of every boundary', () => {
  const { data, samples, blockStates } = fixture();
  assert.deepEqual(validateRenameFixtures(data, samples, blockStates, 4541), { renameIds: 5, renameSamples: 15 });
});

test('rename schema rejects malformed ranges, registry disagreement, and missing known answers', () => {
  for (const [change, pattern] of [
    [data => { data.format = 'other'; }, /Invalid rename format/],
    [data => { delete data.items; }, /must be an object/],
    [data => { data.blocks['minecraft:sign'].ranges = []; }, /Invalid rename entry/],
    [data => { data.blocks['minecraft:weathered_copper_block'].ranges.reverse(); }, /Invalid rename range/],
    [data => { data.blocks['minecraft:sign'].ranges[0].before = 4542; }, /Invalid rename range/],
    [data => { data.blocks['minecraft:sign'].ranges[0].to = 'minecraft:sign'; }, /target equals/],
    [data => { data.blocks['minecraft:sign'].ranges[0].to = 'minecraft:missing'; }, /Missing block rename target/],
    [data => { data.blocks['minecraft:sign'].registered = true; }, /Incorrect registered/],
    [data => { delete data.items['minecraft:cactus_green']; }, /Missing known rename/]
  ]) {
    const { data, blockStates } = fixture();
    change(data);
    assert.throws(() => validateRenames(data, blockStates, 4541), pattern);
  }
});

test('native rename validation rejects mismatches and missing samples', () => {
  for (const [change, pattern] of [
    [samples => { samples[0].nativeName = 'minecraft:stone'; }, /Native rename differs/],
    [samples => samples.pop(), /Incomplete native rename fixtures/],
    [samples => { samples[0] = samples.at(-1); }, /Incomplete native rename boundaries/]
  ]) {
    const { data, samples, blockStates } = fixture();
    change(samples);
    assert.throws(() => validateRenameFixtures(data, samples, blockStates, 4541), pattern);
  }
});
