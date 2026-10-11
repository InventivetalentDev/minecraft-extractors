import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlockLighting } from '../../extractors/minerender-data/block-lighting.js';

const unlit = { shadeBrightness: 0.2, lightEmission: 0, lightBlock: 15,
  propagatesSkylightDown: false, useShapeForLightOcclusion: false, emissiveRendering: false, lightPermeable: false };

function fixture() {
  const blockStates = { 'minecraft:redstone_lamp': { lit: { values: [false, true] } }, 'minecraft:air': {} };
  const profiles = [unlit, { ...unlit, lightEmission: 15 }, { ...unlit, shadeBrightness: 1, lightBlock: 0, propagatesSkylightDown: true, lightPermeable: true }];
  const data = { profiles: structuredClone(profiles), blocks: {
    'minecraft:redstone_lamp': { properties: ['lit'], states: [0, 1] }, 'minecraft:air': { properties: [], states: [2] }
  } };
  return { data, blockStates };
}

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
