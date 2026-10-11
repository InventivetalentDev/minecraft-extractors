import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlockLighting, validateLightingFixtures } from '../../extractors/minerender-data/block-lighting.js';

const unlit = { shadeBrightness: 0.2, lightEmission: 0, lightBlock: 15,
  propagatesSkylightDown: false, useShapeForLightOcclusion: false, emissiveRendering: false, lightPermeable: false };

function fixture() {
  const blockStates = { 'minecraft:redstone_lamp': { lit: { values: [false, true] } }, 'minecraft:air': {} };
  const profiles = [unlit, { ...unlit, lightEmission: 15 }, { ...unlit, shadeBrightness: 1, lightBlock: 0, propagatesSkylightDown: true, lightPermeable: true }];
  const data = { profiles: structuredClone(profiles), blocks: {
    'minecraft:redstone_lamp': { properties: ['lit'], states: [0, 1] }, 'minecraft:air': { properties: [], states: [2] }
  } };
  const native = { stateCount: 3, contextChecks: 6, samples: [
    { block: 'minecraft:redstone_lamp', properties: { lit: false }, profile: structuredClone(profiles[0]) },
    { block: 'minecraft:redstone_lamp', properties: { lit: true }, profile: structuredClone(profiles[1]) },
    { block: 'minecraft:air', properties: {}, profile: structuredClone(profiles[2]) }
  ] };
  for (const sample of native.samples) sample.checks = [[0, 0, 0], [7, 31, -3]].map(position => ({ position, values: structuredClone(sample.profile) }));
  return { data, blockStates, native };
}

test('native fixtures distinguish lit states and transparent light propagation', () => {
  const { data, blockStates, native } = fixture();
  assert.equal(validateBlockLighting(data, blockStates), 3);
  assert.deepEqual(validateLightingFixtures(data, blockStates, native), { lightingStates: 3, lightingSamples: 3, lightingContextChecks: 6 });
  data.blocks['minecraft:redstone_lamp'].states.reverse();
  assert.throws(() => validateLightingFixtures(data, blockStates, native), /Native block lighting differs/);
});

test('lighting channels and all named flags are validated without replacing unknown values', () => {
  for (const [field, invalid] of [['lightEmission', -1], ['lightEmission', 16], ['lightBlock', 0.5],
    ['shadeBrightness', NaN], ['shadeBrightness', 2], ['emissiveRendering', 0], ['lightPermeable', undefined]]) {
    const { data, blockStates } = fixture();
    data.profiles[0][field] = invalid;
    assert.throws(() => validateBlockLighting(data, blockStates), /Invalid block lighting profile/);
  }
  const { data, blockStates } = fixture();
  for (const name of ['shadeBrightness', 'lightBlock', 'emissiveRendering', 'propagatesSkylightDown', 'lightPermeable']) data.profiles[0][name] = null;
  assert.equal(validateBlockLighting(data, blockStates), 3);
  data.profiles[0].lightEmission = null;
  assert.throws(() => validateBlockLighting(data, blockStates), /Invalid block lighting profile/);
});

test('lighting tables cannot omit block states or reference missing profiles', () => {
  for (const change of [data => { data.blocks['minecraft:redstone_lamp'].states.pop(); },
    data => { data.blocks['minecraft:air'].states[0] = 3; }, data => { delete data.blocks['minecraft:air']; },
    data => { data.blocks['minecraft:redstone_lamp'].properties = []; }]) {
    const { data, blockStates } = fixture();
    change(data);
    assert.throws(() => validateBlockLighting(data, blockStates), /block lighting/);
  }
});

test('native lighting fixtures require typed property values and complete state counts', () => {
  for (const change of [native => { native.stateCount--; }, native => { native.samples = []; },
    native => { native.contextChecks--; }, native => { native.samples[0].checks.pop(); },
    native => { native.samples[0].properties.lit = 'false'; }, native => { native.samples[0].profile.lightBlock = 0; }]) {
    const { data, blockStates, native } = fixture();
    change(native);
    assert.throws(() => validateLightingFixtures(data, blockStates, native), /[Nn]ative/);
  }
});

test('known lighting values must agree across native world and position checks', () => {
  const { data, blockStates, native } = fixture();
  native.samples[0].checks[1].values.shadeBrightness = 1;
  assert.throws(() => validateLightingFixtures(data, blockStates, native), /Context-dependent lighting was exported as constant/);
  data.profiles[0].shadeBrightness = null;
  native.samples[0].profile.shadeBrightness = null;
  assert.equal(validateLightingFixtures(data, blockStates, native).lightingSamples, 3);
});
