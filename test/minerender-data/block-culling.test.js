import test from 'node:test';
import assert from 'node:assert/strict';
import { skipsBlockFace, validateBlockCulling, validateBlockCullingFixtures } from '../../extractors/minerender-data/block-culling.js';

const directions = ['east', 'west', 'up', 'down', 'south', 'north'];
const opposite = { east: 'west', west: 'east', south: 'north', north: 'south' };
const id = name => `minecraft:${name}`;
const state = (name, properties = {}) => ({ block: id(name), properties });
const connections = (value = false) => Object.fromEntries(Object.keys(opposite).map(name => [name, value]));

function data() {
  const blocks = { air: 0, stone: 0, glass: 1, red_stained_glass: 1, mangrove_roots: 2,
    glass_pane: 3, red_stained_glass_pane: 3, iron_bars: 3, copper_bars: 3,
    oak_leaves: 4, birch_leaves: 4, water: 5, lava: 6, oak_slab: 0 };
  const blockStates = Object.fromEntries(Object.keys(blocks).map(name => [id(name), {}]));
  for (const name of ['glass_pane', 'red_stained_glass_pane', 'iron_bars', 'copper_bars']) {
    blockStates[id(name)] = Object.fromEntries(Object.keys(opposite).map(name => [name, { values: [false, true] }]));
  }
  blockStates[id('oak_slab')] = { waterlogged: { values: [false, true] } };
  const fluidStates = { profiles: [{}, { fluid: { kind: 'water' } }, { fluid: { kind: 'lava' } }], blocks: {} };
  for (const [block, properties] of Object.entries(blockStates)) {
    const names = Object.keys(properties).sort();
    fluidStates.blocks[block] = { properties: names, states: block === id('oak_slab') ? [0, 1]
      : Array(names.reduce((count, name) => count * properties[name].values.length, 1)).fill(block === id('water') ? 1 : block === id('lava') ? 2 : 0) };
  }
  return { blockStates, fluidStates, rules: {
    profiles: [{ type: 'none' }, { type: 'same_block' }, { type: 'same_block_vertical' },
      { type: 'connected', group: 'bars' }, { type: 'leaves' }, { type: 'fluid', kind: 'water' }, { type: 'fluid', kind: 'lava' }],
    blocks: Object.fromEntries(Object.entries(blocks).map(([name, profile]) => [id(name), profile])),
    groups: { bars: [id('copper_bars'), id('iron_bars')], leaves: [id('birch_leaves'), id('oak_leaves')] }
  } };
}

const skip = (data, source, neighbor, direction = 'east', cutoutLeaves = true) =>
  skipsBlockFace(data.rules, data.blockStates, data.fluidStates, source, neighbor, direction, cutoutLeaves);

test('culling rules require complete blocks, known profiles, groups, and boolean connections', () => {
  const original = data();
  assert.equal(validateBlockCulling(original.rules, original.blockStates), 14);
  for (const [change, message] of [
    [data => { delete data.rules.blocks[id('air')]; }, /Incomplete block culling blocks/],
    [data => { data.rules.blocks[id('air')] = 99; }, /Invalid block culling profile/],
    [data => { data.rules.profiles[0].type = 'solid'; }, /Unknown block culling rule/],
    [data => { data.rules.profiles[0].group = 'bars'; }, /Invalid block culling fields/],
    [data => { data.rules.profiles[3].group = 'panes'; }, /Invalid block culling group/],
    [data => { data.rules.profiles[5].kind = 'oil'; }, /Invalid block culling fluid/],
    [data => { delete data.rules.groups.leaves; }, /Missing block culling groups/],
    [data => { data.rules.groups.bars.push(id('unknown')); }, /Invalid block culling members/],
    [data => { data.rules.groups.leaves.pop(); }, /Missing leaf group member/],
    [data => { data.blockStates[id('iron_bars')].east.values = ['false', 'true']; }, /Invalid block connection properties/]
  ]) {
    const modified = structuredClone(original);
    change(modified);
    assert.throws(() => validateBlockCulling(modified.rules, modified.blockStates), message);
  }
});

test('glass shares faces only with the same block and roots only vertically', () => {
  const fixture = data();
  for (const direction of directions) {
    assert.equal(skip(fixture, state('glass'), state('glass'), direction), true);
    assert.equal(skip(fixture, state('glass'), state('red_stained_glass'), direction), false);
    assert.equal(skip(fixture, state('stone'), state('stone'), direction), false);
    assert.equal(skip(fixture, state('mangrove_roots'), state('mangrove_roots'), direction), ['up', 'down'].includes(direction));
    assert.equal(skip(fixture, state('mangrove_roots'), state('glass'), direction), false);
  }
});

test('pane and bar faces depend on opposing connections, block identity, and versioned bar groups', () => {
  const fixture = data();
  for (const [direction, reverse] of Object.entries(opposite)) {
    for (const source of [false, true]) for (const neighbor of [false, true]) {
      const left = { ...connections(), [direction]: source }, right = { ...connections(), [reverse]: neighbor };
      assert.equal(skip(fixture, state('glass_pane', left), state('glass_pane', right), direction), source && neighbor);
      assert.equal(skip(fixture, state('glass_pane', left), state('red_stained_glass_pane', right), direction), false);
      assert.equal(skip(fixture, state('iron_bars', left), state('copper_bars', right), direction), source && neighbor);
    }
  }
  for (const direction of ['up', 'down']) {
    assert.equal(skip(fixture, state('iron_bars', connections()), state('iron_bars', connections()), direction), true);
    assert.equal(skip(fixture, state('iron_bars', connections(true)), state('copper_bars', connections(true)), direction), false);
  }
  delete fixture.rules.profiles[3].group;
  assert.equal(skip(fixture, state('iron_bars', connections(true)), state('copper_bars', connections(true))), false);
  assert.equal(skip(fixture, state('iron_bars', connections(true)), state('iron_bars', connections(true))), true);
});

test('leaves retain the graphics input and older runtimes can have no leaf rule', () => {
  const fixture = data();
  for (const cutout of [false, true]) {
    assert.equal(skip(fixture, state('oak_leaves'), state('birch_leaves'), 'north', cutout), !cutout);
    assert.equal(skip(fixture, state('oak_leaves'), state('glass'), 'north', cutout), false);
  }
  fixture.rules.blocks[id('oak_leaves')] = 0;
  assert.equal(skip(fixture, state('oak_leaves'), state('birch_leaves'), 'north', false), false);
  assert.throws(() => skipsBlockFace(fixture.rules, fixture.blockStates, fixture.fluidStates, state('oak_leaves'), state('birch_leaves'), 'north'), /Invalid native block culling context/);
});

test('liquid comparisons use the neighbor state, including waterlogged blocks', () => {
  const fixture = data();
  for (const direction of directions) {
    assert.equal(skip(fixture, state('water'), state('water'), direction), true);
    assert.equal(skip(fixture, state('water'), state('lava'), direction), false);
    assert.equal(skip(fixture, state('water'), state('oak_slab', { waterlogged: true }), direction), true);
    assert.equal(skip(fixture, state('water'), state('oak_slab', { waterlogged: false }), direction), false);
    assert.equal(skip(fixture, state('oak_slab', { waterlogged: true }), state('water'), direction), false);
  }
  assert.throws(() => skip(fixture, state('water'), state('oak_slab', {})), /Invalid native block culling properties/);
});

function nativeFixture() {
  const fixture = data();
  const samples = Object.keys(fixture.rules.blocks).map(block => {
    const properties = Object.fromEntries(Object.entries(fixture.blockStates[block]).map(([name, property]) => [name, property.values[0]]));
    const name = block.split(':')[1];
    const leaves = ['oak_leaves', 'birch_leaves'].includes(name);
    const vertical = ['mangrove_roots', 'glass_pane', 'red_stained_glass_pane', 'iron_bars', 'copper_bars'].includes(name);
    const always = ['glass', 'red_stained_glass', 'water', 'lava'].includes(name);
    return { source: { block, properties }, neighbor: { block, properties }, faces: [false, true].flatMap(cutoutLeaves => directions.map(direction => ({
      direction, cutoutLeaves, skip: always || (leaves && !cutoutLeaves) || (vertical && ['up', 'down'].includes(direction))
    }))) };
  });
  return { ...fixture, native: { blockCount: samples.length, samples } };
}

test('native fixtures check every block, direction, leaf mode, and paired-state result', () => {
  const fixture = nativeFixture();
  const validate = value => validateBlockCullingFixtures(value.rules, value.blockStates, value.fluidStates, value.native);
  assert.deepEqual(validate(fixture), { blockCullingBlocks: 14, blockCullingPairs: 14, blockCullingFaces: 168 });
  for (const [change, message] of [
    [data => { data.native.blockCount++; }, /Incomplete native block culling fixtures/],
    [data => { data.native.samples.pop(); }, /Incomplete native block culling coverage/],
    [data => { data.native.samples.push(data.native.samples[0]); }, /Invalid native block culling pair/],
    [data => { data.native.samples[0].faces.pop(); }, /Invalid native block culling pair/],
    [data => { data.native.samples[0].faces[1] = data.native.samples[0].faces[0]; }, /Invalid native block culling face/],
    [data => { data.native.samples[0].faces[0].skip = true; }, /Native block culling differs/],
    [data => { data.native.samples[0].faces[0].direction = 'diagonal'; }, /Invalid native block culling context/]
  ]) {
    const modified = structuredClone(fixture);
    change(modified);
    assert.throws(() => validate(modified), message);
  }
});
