import { assert, identifier, object, stableStringify } from './lib.js';

const slots = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head', 'body', 'saddle'];
const operations = ['add_value', 'add_multiplied_base', 'add_multiplied_total'];

export function validateItemProperties(data, defaults) {
  assert(data?.schemaVersion === 1 && ['native', 'legacy'].includes(data.componentFormat), 'Invalid item property format');
  const items = object(data.items, 'Item properties');
  assert(items.length > 0 && Object.keys(defaults).every(id => Object.hasOwn(data.items, id)), 'Incomplete item properties');
  for (const [id, item] of items) {
    identifier(id);
    object(item, `Properties of ${id}`);
    assert(item.name !== null && ['string', 'object'].includes(typeof item.name), `Invalid item name: ${id}`);
    assert(['common', 'uncommon', 'rare', 'epic'].includes(item.rarity), `Invalid item rarity: ${id}`);
    assert(slots.includes(item.equipmentSlot), `Invalid item equipment slot: ${id}`);
    assert(Array.isArray(item.attributeModifiers), `Invalid item attribute modifiers: ${id}`);
    const keys = new Set();
    for (const modifier of item.attributeModifiers) {
      identifier(modifier.attribute);
      assert(typeof modifier.id === 'string' && (/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(modifier.id)
        || /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(modifier.id)), `Invalid attribute modifier identity: ${id}`);
      assert(slots.includes(modifier.slot) && Number.isFinite(modifier.amount) && operations.includes(modifier.operation), `Invalid attribute modifier: ${id}`);
      const key = [modifier.slot, modifier.attribute, modifier.id].join('/');
      assert(!keys.has(key), `Duplicate attribute modifier: ${id}`);
      keys.add(key);
    }
    if (data.componentFormat === 'native') {
      for (const [component, value] of object(item.components, `Native components of ${id}`)) {
        identifier(component);
        assert(value !== null, `Invalid native component: ${id}/${component}`);
      }
      for (const [component, value] of Object.entries(defaults[id] ?? { 'minecraft:max_stack_size': 64 })) {
        assert(stableStringify(item.components[component]) === stableStringify(value), `Native component differs from item defaults: ${id}/${component}`);
      }
    } else assert(!Object.hasOwn(item, 'components'), `Legacy item cannot declare native components: ${id}`);
  }
  return items.length;
}

export function validateItemPropertyFixtures(data, fixture) {
  const count = Object.keys(data.items).length;
  assert(fixture?.items === count, 'Incomplete native item property fixtures');
  const native = data.componentFormat === 'native';
  const components = native ? Object.values(data.items).reduce((total, item) => total + Object.keys(item.components).length, 0) : 0;
  assert(fixture.componentRoundTrips === (native ? count : 0) && fixture.persistentComponents === components,
    'Incomplete native component round trips');
  return { itemProperties: count, componentRoundTrips: fixture.componentRoundTrips, persistentComponents: components };
}
