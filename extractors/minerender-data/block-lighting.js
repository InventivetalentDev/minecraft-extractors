import { assert, object, stableStringify } from './lib.js';

const integer = value => Number.isInteger(value) && value >= 0 && value <= 15;
const boolean = value => typeof value === 'boolean';
const fields = {
  shadeBrightness: value => value === null || (Number.isFinite(value) && value >= 0 && value <= 1),
  lightEmission: integer,
  lightBlock: value => value === null || integer(value),
  propagatesSkylightDown: value => value === null || boolean(value),
  useShapeForLightOcclusion: boolean,
  emissiveRendering: value => value === null || boolean(value),
  lightPermeable: value => value === null || boolean(value)
};

export function validateBlockLighting(data, blockStates) {
  assert(data && Array.isArray(data.profiles) && data.profiles.length > 0, 'Missing block lighting profiles');
  for (const [index, profile] of data.profiles.entries()) {
    assert(profile && Object.entries(fields).every(([key, valid]) => valid(profile[key])), `Invalid block lighting profile: ${index}`);
  }
  const blocks = object(data.blocks, 'Block lighting states');
  assert(blocks.length === Object.keys(blockStates).length, 'Incomplete block lighting states');
  let stateCount = 0;
  for (const [id, entry] of blocks) {
    const properties = blockStates[id];
    assert(properties && Array.isArray(entry.properties)
      && stableStringify(entry.properties) === stableStringify(Object.keys(properties).sort()), `Invalid block lighting properties: ${id}`);
    const count = entry.properties.reduce((product, name) => product * properties[name].values.length, 1);
    assert(Number.isSafeInteger(count) && Array.isArray(entry.states) && entry.states.length === count
      && entry.states.every(index => Number.isSafeInteger(index) && index >= 0 && index < data.profiles.length), `Invalid block lighting indices: ${id}`);
    stateCount += count;
  }
  return stateCount;
}

export function validateLightingFixtures(data, blockStates, fixture) {
  const count = validateBlockLighting(data, blockStates);
  assert(fixture?.stateCount === count && Array.isArray(fixture.samples) && fixture.samples.length > 0, 'Incomplete native lighting fixtures');
  assert(fixture.contextChecks === count * 2, 'Incomplete native lighting context checks');
  for (const sample of fixture.samples) {
    const entry = data.blocks[sample.block];
    assert(entry && sample.properties && Object.keys(sample.properties).length === entry.properties.length, `Invalid native lighting state: ${sample.block}`);
    let index = 0;
    for (const name of entry.properties) {
      const values = blockStates[sample.block][name].values, value = values.indexOf(sample.properties[name]);
      assert(value !== -1, `Invalid native lighting property: ${sample.block}/${name}`);
      index = index * values.length + value;
    }
    assert(stableStringify(data.profiles[entry.states[index]]) === stableStringify(sample.profile), `Native block lighting differs: ${sample.block}`);
    assert(Array.isArray(sample.checks) && sample.checks.length === 2, `Incomplete native lighting samples: ${sample.block}`);
    for (const check of sample.checks) {
      assert(Array.isArray(check.position) && check.position.length === 3 && check.position.every(Number.isInteger), `Invalid native lighting position: ${sample.block}`);
      for (const [name, valid] of Object.entries(fields)) {
        assert(check.values && valid(check.values[name]), `Invalid native lighting value: ${sample.block}/${name}`);
        if (sample.profile[name] !== null) assert(sample.profile[name] === check.values[name], `Context-dependent lighting was exported as constant: ${sample.block}/${name}`);
      }
    }
  }
  return { lightingStates: count, lightingSamples: fixture.samples.length, lightingContextChecks: fixture.contextChecks };
}
