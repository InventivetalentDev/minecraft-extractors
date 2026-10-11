import test from 'node:test';
import assert from 'node:assert/strict';
import { blockOffset, blockRenderLayer, validateBlockAppearance, validateAppearanceFixtures } from '../../extractors/minerender-data/block-appearance.js';

const positions = [[0, 0, 0], [1, 7, 2], [-17, -64, 31], [7, 255, -3], [7, -20, -3], [30000000, 319, -30000000]];
const nativeGrassOffsets = [[-0.25, -0.2, -0.25], [-0.11666665971279144, -0.15999999940395357, -0.18333332985639572],
  [0.0833333432674408, 0, -0.14999999850988388], [-0.0833333283662796, -0.2, -0.18333332985639572],
  [-0.0833333283662796, -0.2, -0.18333332985639572], [0.0833333432674408, -0.026666665077209474, -0.14999999850988388]];

function fixture() {
  const data = { offsetAlgorithm: 'minecraft-position-v1', offsets: {
    'minecraft:grass': { type: 'xyz', horizontal: 0.25, vertical: 0.2 }
  }, renderLayers: { source: 'block', default: 'solid', blocks: {
    'minecraft:grass': 'cutout'
  } } };
  const blockStates = { 'minecraft:grass': {} };
  const native = { stateCount: 1, offsetChecks: 6, layerChecks: 2,
    offsets: positions.map((position, index) => ({ block: 'minecraft:grass', position, offset: nativeGrassOffsets[index] })),
    layers: [false, true].map(cutoutLeaves => ({ block: 'minecraft:grass', cutoutLeaves, layer: 'cutout' })) };
  return { data, blockStates, native };
}

test('offsets match native negative and world-border coordinates without using height in the seed', () => {
  const { data } = fixture();
  positions.forEach((position, index) => assert.deepEqual(blockOffset(data, 'minecraft:grass', position).map(value => value || 0), nativeGrassOffsets[index]));
  assert.deepEqual(blockOffset(data, 'minecraft:stone', positions[1]), [0, 0, 0]);
  data.offsets['minecraft:grass'] = { type: 'xz', horizontal: 0.125, vertical: 0 };
  assert.deepEqual(blockOffset(data, 'minecraft:grass', positions[0]).map(value => value || 0), [-0.125, 0, -0.125]);
});

test('fixed layers preserve translucent glass, cutout-mipped leaves, and solid defaults', () => {
  const { data } = fixture();
  data.renderLayers.blocks['minecraft:glass'] = 'translucent';
  data.renderLayers.blocks['minecraft:oak_leaves'] = { solidLeaves: 'solid', cutoutLeaves: 'cutout_mipped' };
  assert.equal(blockRenderLayer(data, 'minecraft:glass'), 'translucent');
  assert.equal(blockRenderLayer(data, 'minecraft:oak_leaves', false), 'solid');
  assert.equal(blockRenderLayer(data, 'minecraft:oak_leaves'), 'cutout_mipped');
  assert.equal(blockRenderLayer(data, 'minecraft:stone'), 'solid');
  const blockStates = Object.fromEntries(Object.keys(data.renderLayers.blocks).map(id => [id, {}]));
  validateBlockAppearance(data, blockStates);
  for (const value of ['solid', 'unknown', { solidLeaves: 'cutout', cutoutLeaves: 'cutout' }, { solidLeaves: 'solid' }]) {
    data.renderLayers.blocks['minecraft:grass'] = value;
    assert.throws(() => validateBlockAppearance(data, blockStates), /Invalid block render layer/);
  }
});

test('sprite policy checks both transparency flags and does not supply fixed block layers', () => {
  const { data, blockStates, native } = fixture();
  data.renderLayers = { source: 'sprite', opaque: 'solid', cutout: 'cutout', translucent: 'translucent' };
  native.layerChecks = 4;
  native.layers = [false, true].flatMap(transparent => [false, true].map(translucent => ({
    transparent, translucent, layer: translucent ? 'translucent' : transparent ? 'cutout' : 'solid'
  })));
  assert.deepEqual(validateAppearanceFixtures(data, blockStates, native), { appearanceStates: 1, blockOffsetChecks: 6, blockLayerChecks: 4 });
  assert.throws(() => blockRenderLayer(data, 'minecraft:grass'), /active material transparency/);
  data.renderLayers.blocks = {};
  assert.throws(() => validateBlockAppearance(data, blockStates), /sprite render-layer policy/);
});

test('validation rejects missing native checks, duplicate samples, and changed offsets or layers', () => {
  const { data, blockStates, native } = fixture();
  assert.deepEqual(validateAppearanceFixtures(data, blockStates, native), { appearanceStates: 1, blockOffsetChecks: 6, blockLayerChecks: 2 });
  for (const [change, pattern] of [
    [value => { value.stateCount++; }, /state checks/],
    [value => { value.offsetChecks--; }, /state checks/],
    [value => { value.layers.pop(); }, /appearance fixtures/],
    [value => { value.offsets[1] = value.offsets[0]; }, /offset fixture/],
    [value => { value.offsets[0].offset[0] = 0; }, /offset differs/],
    [value => { value.layers[0].layer = 'solid'; }, /layer differs/],
    [value => { value.layers[1] = value.layers[0]; }, /Duplicate native layer/]
  ]) {
    const modified = structuredClone(native);
    change(modified);
    assert.throws(() => validateAppearanceFixtures(data, blockStates, modified), pattern);
  }
  data.offsets['minecraft:grass'].type = 'xz';
  assert.throws(() => validateBlockAppearance(data, blockStates), /Invalid block offset/);
});
