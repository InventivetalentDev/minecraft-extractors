import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItemProperties, validateItemPropertyFixtures } from '../../extractors/minerender-data/item-properties.js';

const defaults = { 'minecraft:diamond_sword': { 'minecraft:max_stack_size': 1, 'minecraft:max_damage': 1561, 'minecraft:damage': 0 } };
function fixture(format = 'native') {
  return { schemaVersion: 1, componentFormat: format, items: { 'minecraft:diamond_sword': {
    name: { translate: 'item.minecraft.diamond_sword' }, rarity: 'common', equipmentSlot: 'mainhand',
    attributeModifiers: [{ attribute: 'minecraft:attack_damage', slot: 'mainhand', id: 'minecraft:base_attack_damage', amount: 6, operation: 'add_value' }],
    ...(format === 'native' ? { components: { ...defaults['minecraft:diamond_sword'], 'minecraft:attribute_modifiers': [], 'minecraft:rarity': 'common' } } : {})
  } } };
}

test('native properties retain complete components and legacy properties cannot invent them', () => {
  const native = fixture();
  assert.equal(validateItemProperties(native, defaults), 1);
  native.items['minecraft:diamond_sword'].components['minecraft:damage'] = 1;
  assert.throws(() => validateItemProperties(native, defaults), /differs from item defaults/);
  const legacy = fixture('legacy');
  legacy.items['minecraft:diamond_sword'].attributeModifiers[0].id = 'cb3f55d3-645c-4f38-a497-9c13a33db5cf';
  assert.equal(validateItemProperties(legacy, defaults), 1);
  legacy.items['minecraft:diamond_sword'].components = {};
  assert.throws(() => validateItemProperties(legacy, defaults), /cannot declare native components/);
});

test('item properties preserve explicit modifier slots and reject duplicate or incomplete entries', () => {
  const data = fixture(), item = data.items['minecraft:diamond_sword'];
  item.attributeModifiers.push({ ...item.attributeModifiers[0], slot: 'offhand' });
  assert.equal(validateItemProperties(data, defaults), 1);
  item.attributeModifiers.push({ ...item.attributeModifiers[0] });
  assert.throws(() => validateItemProperties(data, defaults), /Duplicate attribute modifier/);
  item.attributeModifiers.pop();
  item.equipmentSlot = 'all';
  assert.throws(() => validateItemProperties(data, defaults), /equipment slot/);
  delete data.items['minecraft:diamond_sword'];
  assert.throws(() => validateItemProperties(data, defaults), /Incomplete item properties/);
});

test('component checks account for every native item and persistent component', () => {
  const data = fixture(), native = { items: 1, componentRoundTrips: 1, persistentComponents: 5 };
  assert.deepEqual(validateItemPropertyFixtures(data, native), { itemProperties: 1, componentRoundTrips: 1, persistentComponents: 5 });
  assert.throws(() => validateItemPropertyFixtures(data, { ...native, componentRoundTrips: 0 }), /component round trips/);
  assert.throws(() => validateItemPropertyFixtures(data, { ...native, persistentComponents: 4 }), /component round trips/);
  assert.deepEqual(validateItemPropertyFixtures(fixture('legacy'), { items: 1, componentRoundTrips: 0, persistentComponents: 0 }),
    { itemProperties: 1, componentRoundTrips: 0, persistentComponents: 0 });
});
