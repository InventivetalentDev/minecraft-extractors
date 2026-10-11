import test from 'node:test';
import assert from 'node:assert/strict';
import { fluidStateProfile, occludesFluidFace, validateFluidStates, validateFluidFixtures } from '../../extractors/minerender-data/fluid-states.js';

const cube = [[0, 0, 0, 1, 1, 1]];
const bottomSlab = [[0, 0, 0, 1, 0.5, 1]];
const topSlab = [[0, 0.5, 0, 1, 1, 1]];

function profile(occlusionShape, fluid) {
  return { renderModel: true, heightSolid: true, blocksFlow: true, waterOverlay: false,
    solidRender: false, occlusionShape, ...(fluid ? { fluid } : {}) };
}

function states() {
  const water = { kind: 'water', amount: 8, source: true, falling: false, height: Math.fround(8 / 9) };
  return {
    blockStates: { 'minecraft:oak_slab': { type: { values: ['bottom', 'top'] }, waterlogged: { values: [false, true] } }, 'minecraft:air': {} },
    data: { shapes: [bottomSlab, topSlab, []],
      profiles: [profile(0), profile(0, water), profile(1), profile(1, water),
        { renderModel: false, heightSolid: false, blocksFlow: false, waterOverlay: false, solidRender: false, occlusionShape: 2 }],
      blocks: { 'minecraft:oak_slab': { properties: ['type', 'waterlogged'], states: [0, 1, 2, 3] },
        'minecraft:air': { properties: [], states: [4] } } }
  };
}

test('state lookup uses both property value orders and handles propertyless blocks', () => {
  const { data, blockStates } = states();
  assert.equal(validateFluidStates(data, blockStates), 5);
  for (const [type, waterlogged, index] of [['bottom', false, 0], ['bottom', true, 1], ['top', false, 2], ['top', true, 3]]) {
    assert.equal(fluidStateProfile(data, blockStates, 'minecraft:oak_slab', { waterlogged, type }), data.profiles[index]);
  }
  assert.equal(fluidStateProfile(data, blockStates, 'minecraft:air', {}), data.profiles[4]);
  assert.throws(() => fluidStateProfile(data, blockStates, 'minecraft:oak_slab', { type: 'bottom' }), /Invalid native fluid state/);
  assert.throws(() => fluidStateProfile(data, blockStates, 'minecraft:oak_slab', { type: 'double', waterlogged: false }), /Invalid native fluid property/);
});

test('every block and property combination must have a valid profile index', () => {
  for (const [change, error] of [
    [data => { delete data.blocks['minecraft:air']; }, /Incomplete fluid state blocks/],
    [data => { data.blocks['minecraft:oak_slab'].states.pop(); }, /Invalid fluid state indices/],
    [data => { data.blocks['minecraft:oak_slab'].states[0] = 5; }, /Invalid fluid state indices/],
    [data => { data.blocks['minecraft:oak_slab'].states[0] = -1; }, /Invalid fluid state indices/],
    [data => { data.blocks['minecraft:oak_slab'].properties.reverse(); }, /Invalid fluid state properties/],
    [data => { data.profiles[0].occlusionShape = 3; }, /Invalid fluid shape reference/]
  ]) {
    const { data, blockStates } = states();
    change(data);
    assert.throws(() => validateFluidStates(data, blockStates), error);
  }
});

test('contained fluids retain source, flowing, and falling states with native heights', () => {
  const { data, blockStates } = states();
  for (const [kind, amount, source, falling] of [['water', 8, true, false], ['water', 3, false, false], ['lava', 8, false, true]]) {
    data.profiles[1].fluid = { kind, amount, source, falling, height: Math.fround(amount / 9) };
    assert.equal(validateFluidStates(data, blockStates), 5);
  }
  for (const invalid of [{ amount: 0 }, { amount: 9 }, { kind: 'oil' }, { height: 1 }, { falling: 1 }, { source: 'true' }]) {
    const { data, blockStates } = states();
    Object.assign(data.profiles[1].fluid, invalid);
    assert.throws(() => validateFluidStates(data, blockStates), /Invalid contained fluid/);
  }
});

test('slab occlusion depends on fluid height and the shared boundary', () => {
  for (const direction of ['east', 'west', 'south', 'north']) {
    assert.equal(occludesFluidFace(bottomSlab, direction, 0.5), true, direction);
    assert.equal(occludesFluidFace(bottomSlab, direction, 8 / 9), false, direction);
    assert.equal(occludesFluidFace(topSlab, direction, 0.5), false, direction);
  }
  assert.equal(occludesFluidFace(bottomSlab, 'up', 1), true);
  assert.equal(occludesFluidFace(bottomSlab, 'up', 8 / 9), false);
  assert.equal(occludesFluidFace(bottomSlab, 'down', 1), false);
  assert.equal(occludesFluidFace(topSlab, 'up', 1), false);
  assert.equal(occludesFluidFace(topSlab, 'down', 0.5), true);
});

test('stair occlusion covers its full side but preserves the open step', () => {
  const stair = [...bottomSlab, [0.5, 0.5, 0, 1, 1, 1]];
  assert.equal(occludesFluidFace(stair, 'west', 1), true);
  assert.equal(occludesFluidFace(stair, 'east', 1), false);
  for (const direction of ['north', 'south']) {
    assert.equal(occludesFluidFace(stair, direction, 0.5), true, direction);
    assert.equal(occludesFluidFace(stair, direction, 1), false, direction);
  }
  assert.equal(occludesFluidFace(stair, 'up', 1), true);
  assert.equal(occludesFluidFace(stair, 'down', 1), false);
});

test('face coverage combines boxes without filling gaps or using interior faces', () => {
  const joined = [[0, 0, 0, 1, 1, 0.5], [0, 0, 0.5, 1, 1, 1]];
  assert.equal(occludesFluidFace(joined, 'east', 1), true);
  assert.equal(occludesFluidFace([[0, 0, 0, 1, 1, 0.4], [0, 0, 0.6, 1, 1, 1]], 'east', 1), false);
  assert.equal(occludesFluidFace([[0.25, 0, 0, 0.75, 1, 1]], 'east', 1), false);
  assert.equal(occludesFluidFace([], 'east', 1), false);
  assert.throws(() => occludesFluidFace(cube, 'diagonal', 1), /Invalid fluid face sample/);
  assert.throws(() => occludesFluidFace(cube, 'east', 0), /Invalid fluid face sample/);
});

function nativeFixture() {
  const blockStates = { 'minecraft:stone': {} }, nativeProfile = { ...profile(0), solidRender: true };
  const data = { shapes: [cube], profiles: [nativeProfile], blocks: { 'minecraft:stone': { properties: [], states: [0] } } };
  const { occlusionShape, ...expected } = nativeProfile;
  const occlusion = Object.entries({ east: [true, true, true, true], west: [true, true, true, true],
    up: [false, false, false, true], down: [true, true, true, true],
    south: [true, true, true, true], north: [true, true, true, true] })
    .flatMap(([direction, results]) => [0.125, 0.5, Math.fround(8 / 9), 1].map((height, index) => ({ direction, height, occluded: results[index] })));
  const fixture = { stateCount: 1, samples: [{ block: 'minecraft:stone', properties: {}, profile: expected, shape: structuredClone(cube), occlusion }] };
  return { data, blockStates, fixture };
}

test('native fixtures verify flags, boxes, and all sampled face results', () => {
  const { data, blockStates, fixture } = nativeFixture();
  assert.deepEqual(validateFluidFixtures(data, blockStates, fixture), { fluidStates: 1, fluidSamples: 1, fluidFaces: 24 });
  for (const [change, error] of [
    [fixture => { fixture.stateCount = 2; }, /Incomplete native fluid fixtures/],
    [fixture => { fixture.samples = []; }, /Incomplete native fluid fixtures/],
    [fixture => { fixture.samples[0].profile.waterOverlay = true; }, /Native fluid state differs/],
    [fixture => { fixture.samples[0].shape[0][4] = 0.5; }, /Native fluid shape differs/],
    [fixture => { fixture.samples[0].occlusion[0].occluded = false; }, /Native fluid face occlusion differs/],
    [fixture => { fixture.samples[0].occlusion.pop(); }, /Incomplete native fluid face fixtures/],
    [fixture => { fixture.samples[0].occlusion[1] = fixture.samples[0].occlusion[0]; }, /Invalid native fluid face fixture/],
    [fixture => { fixture.samples[0].occlusion[1] = { ...fixture.samples[0].occlusion[2], height: 8 / 9 }; }, /Invalid native fluid face fixture/]
  ]) {
    const modified = structuredClone(fixture);
    change(modified);
    assert.throws(() => validateFluidFixtures(data, blockStates, modified), error);
  }
  assert.throws(() => validateFluidFixtures(data, blockStates, undefined), /Incomplete native fluid fixtures/);
});

test('context-dependent shapes stay unavailable instead of becoming empty shapes', () => {
  const { data, blockStates, fixture } = nativeFixture();
  data.profiles[0].occlusionShape = null;
  data.profiles[0].solidRender = null;
  fixture.samples[0].shape = null;
  fixture.samples[0].profile.solidRender = null;
  fixture.samples[0].occlusion = [];
  assert.deepEqual(validateFluidFixtures(data, blockStates, fixture), { fluidStates: 1, fluidSamples: 1, fluidFaces: 0 });
  fixture.samples[0].shape = [];
  assert.throws(() => validateFluidFixtures(data, blockStates, fixture), /Native fluid shape differs/);
});
