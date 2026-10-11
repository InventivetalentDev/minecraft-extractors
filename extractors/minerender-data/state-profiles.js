import { assert, object, stableStringify } from './lib.js';

export function validateStateProfiles(data, blockStates, label) {
  const blocks = object(data.blocks, `${label} blocks`);
  assert(blocks.length === Object.keys(blockStates).length, `Incomplete ${label} blocks`);
  let stateCount = 0;
  for (const [id, entry] of blocks) {
    const properties = blockStates[id];
    assert(properties && Array.isArray(entry.properties)
      && stableStringify(entry.properties) === stableStringify(Object.keys(properties).sort()), `Invalid ${label} properties: ${id}`);
    const count = entry.properties.reduce((product, name) => product * properties[name].values.length, 1);
    assert(Number.isSafeInteger(count) && Array.isArray(entry.states) && entry.states.length === count
      && entry.states.every(index => Number.isSafeInteger(index) && index >= 0 && index < data.profiles.length), `Invalid ${label} indices: ${id}`);
    stateCount += count;
  }
  return stateCount;
}
