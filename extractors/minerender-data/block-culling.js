import { assert, object, stableStringify } from './lib.js';
import { fluidStateProfile } from './fluid-states.js';

const opposite = { east: 'west', west: 'east', up: 'down', down: 'up', south: 'north', north: 'south' };
const horizontal = ['east', 'west', 'south', 'north'];
const types = ['same_block', 'same_block_vertical', 'connected', 'leaves', 'fluid'];

export function validateBlockCulling(data, blockStates) {
  assert(data && Array.isArray(data.profiles), 'Missing block culling profiles');
  for (const [index, profile] of data.profiles.entries()) {
    assert(profile && types.includes(profile.type), `Unknown block culling rule: ${index}`);
    const keys = ['type'];
    if (profile.type === 'fluid') {
      keys.push('kind');
      assert(['water', 'lava'].includes(profile.kind), `Invalid block culling fluid: ${index}`);
    }
    if (profile.type === 'connected' && profile.group !== undefined) {
      keys.push('group');
      assert(profile.group === 'bars' && Array.isArray(data.groups?.bars), `Invalid block culling group: ${index}`);
    }
    assert(stableStringify(Object.keys(profile).sort()) === stableStringify(keys.sort()), `Invalid block culling fields: ${index}`);
  }
  const blocks = object(data.blocks, 'Block culling blocks');
  for (const [id, index] of blocks) {
    assert(Object.hasOwn(blockStates, id) && Number.isInteger(index) && index >= 0 && index < data.profiles.length, `Invalid block culling profile: ${id}`);
    if (data.profiles[index].type === 'connected') {
      assert(horizontal.every(name => stableStringify(blockStates[id][name]?.values?.toSorted()) === stableStringify([false, true])), `Invalid block connection properties: ${id}`);
    }
  }
  for (const [name, values] of object(data.groups ?? {}, 'Block culling groups')) {
    assert(name === 'bars', `Unknown block culling group: ${name}`);
    assert(Array.isArray(values) && values.every(id => Object.hasOwn(blockStates, id))
      && stableStringify(values) === stableStringify([...new Set(values)].sort()), `Invalid block culling members: ${name}`);
  }
  return Object.keys(blockStates).length;
}

function state(data, blockStates, value) {
  assert(value && Object.hasOwn(blockStates, value.block), 'Invalid native block culling state');
  const properties = object(value.properties, 'Block culling state properties'), expected = blockStates[value.block];
  assert(properties.length === Object.keys(expected).length && properties.every(([name, entry]) => expected[name]?.values.includes(entry)), `Invalid native block culling properties: ${value.block}`);
  return Object.hasOwn(data.blocks, value.block) ? data.profiles[data.blocks[value.block]] : undefined;
}

// skipRendering does not include shape occlusion; false does not mean the face must be drawn.
export function skipsBlockFace(data, blockStates, fluidStates, source, neighbor, direction, cutoutLeaves) {
  const rule = state(data, blockStates, source);
  const neighborRule = state(data, blockStates, neighbor);
  assert(Object.hasOwn(opposite, direction) && typeof cutoutLeaves === 'boolean', 'Invalid native block culling context');
  const same = source.block === neighbor.block;
  switch (rule?.type) {
    case undefined: return false;
    case 'same_block': return same;
    case 'same_block_vertical': return same && !horizontal.includes(direction);
    case 'leaves': return !cutoutLeaves && neighborRule?.type === 'leaves';
    case 'fluid': return fluidStateProfile(fluidStates, blockStates, neighbor.block, neighbor.properties).fluid?.kind === rule.kind;
    case 'connected': {
      const crossGroup = rule.group && data.groups[rule.group].includes(source.block)
        && data.groups[rule.group].includes(neighbor.block) && Object.hasOwn(neighbor.properties, opposite[direction]);
      return Boolean((same || crossGroup) && (!horizontal.includes(direction)
        || (source.properties[direction] && neighbor.properties[opposite[direction]])));
    }
    default: throw new Error(`Unknown block culling rule: ${rule.type}`);
  }
}

export function validateBlockCullingFixtures(data, blockStates, fluidStates, fixture) {
  const count = validateBlockCulling(data, blockStates);
  assert(fluidStates && fixture?.blockCount === count && Array.isArray(fixture.states) && fixture.states.length > 0
    && Array.isArray(fixture.pairs) && fixture.pairs.length > 0, 'Incomplete native block culling fixtures');
  const blocks = new Set(), pairs = new Set(), states = new Set();
  for (const entry of fixture.states) {
    state(data, blockStates, entry);
    const key = stableStringify(entry);
    assert(!states.has(key), 'Duplicate native block culling state');
    states.add(key);
  }
  const directions = Object.keys(opposite);
  for (const pair of fixture.pairs) {
    assert(Array.isArray(pair) && pair.length === 3 && pair.every(Number.isInteger)
      && pair.slice(0, 2).every(index => index >= 0 && index < fixture.states.length)
      && pair[2] >= 0 && pair[2] < 4096, 'Invalid native block culling pair');
    const [sourceIndex, neighborIndex, mask] = pair, key = `${sourceIndex}/${neighborIndex}`;
    assert(!pairs.has(key), 'Duplicate native block culling pair');
    pairs.add(key);
    const source = fixture.states[sourceIndex], neighbor = fixture.states[neighborIndex];
    blocks.add(source.block);
    // Bits 0–5 follow east, west, up, down, south, north with opaque leaves.
    // Bits 6–11 use the same directions with cutout leaves.
    for (let bit = 0; bit < 12; bit++) {
      const direction = directions[bit % 6], cutoutLeaves = bit >= 6;
      assert(skipsBlockFace(data, blockStates, fluidStates, source, neighbor, direction, cutoutLeaves) === Boolean(mask & (1 << bit)),
        `Native block culling differs: ${source.block}/${neighbor.block}/${direction}/${cutoutLeaves}`);
    }
  }
  assert(blocks.size === count, 'Incomplete native block culling coverage');
  return { blockCullingBlocks: count, blockCullingPairs: pairs.size, blockCullingFaces: pairs.size * 12 };
}
