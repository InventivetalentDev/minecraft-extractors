import { assert, object, stableStringify } from './lib.js';
import { fluidStateProfile } from './fluid-states.js';

const opposite = { east: 'west', west: 'east', up: 'down', down: 'up', south: 'north', north: 'south' };
const horizontal = ['east', 'west', 'south', 'north'];
const types = ['none', 'same_block', 'same_block_vertical', 'connected', 'leaves', 'fluid'];

export function validateBlockCulling(data, blockStates) {
  assert(data && Array.isArray(data.profiles) && data.profiles.length > 0, 'Missing block culling profiles');
  for (const [index, profile] of data.profiles.entries()) {
    assert(profile && types.includes(profile.type), `Unknown block culling rule: ${index}`);
    const keys = ['type'];
    if (profile.type === 'fluid') {
      keys.push('kind');
      assert(['water', 'lava'].includes(profile.kind), `Invalid block culling fluid: ${index}`);
    }
    if (profile.type === 'connected' && profile.group !== undefined) {
      keys.push('group');
      assert(profile.group === 'bars', `Invalid block culling group: ${index}`);
    }
    assert(stableStringify(Object.keys(profile).sort()) === stableStringify(keys.sort()), `Invalid block culling fields: ${index}`);
  }
  const blocks = object(data.blocks, 'Block culling blocks');
  assert(blocks.length === Object.keys(blockStates).length, 'Incomplete block culling blocks');
  for (const [id, index] of blocks) {
    assert(Object.hasOwn(blockStates, id) && Number.isInteger(index) && index >= 0 && index < data.profiles.length, `Invalid block culling profile: ${id}`);
    if (data.profiles[index].type === 'connected') {
      assert(horizontal.every(name => stableStringify(blockStates[id][name]?.values?.toSorted()) === stableStringify([false, true])), `Invalid block connection properties: ${id}`);
    }
  }
  assert(stableStringify(Object.keys(data.groups ?? {}).sort()) === stableStringify(['bars', 'leaves']), 'Missing block culling groups');
  for (const [name, values] of object(data.groups, 'Block culling groups')) {
    assert(Array.isArray(values) && values.every(id => Object.hasOwn(blockStates, id))
      && stableStringify(values) === stableStringify([...new Set(values)].sort()), `Invalid block culling members: ${name}`);
  }
  for (const [id, index] of blocks) {
    if (data.profiles[index].type === 'leaves') assert(data.groups.leaves.includes(id), `Missing leaf group member: ${id}`);
  }
  return blocks.length;
}

function state(data, blockStates, value) {
  assert(value && Object.hasOwn(data.blocks, value.block), 'Invalid native block culling state');
  const properties = object(value.properties, 'Block culling state properties'), expected = blockStates[value.block];
  assert(properties.length === Object.keys(expected).length && properties.every(([name, entry]) => expected[name]?.values.includes(entry)), `Invalid native block culling properties: ${value.block}`);
  return data.profiles[data.blocks[value.block]];
}

// skipRendering does not include shape occlusion; false does not mean the face must be drawn.
export function skipsBlockFace(data, blockStates, fluidStates, source, neighbor, direction, cutoutLeaves) {
  const rule = state(data, blockStates, source);
  state(data, blockStates, neighbor);
  assert(Object.hasOwn(opposite, direction) && typeof cutoutLeaves === 'boolean', 'Invalid native block culling context');
  const same = source.block === neighbor.block;
  switch (rule.type) {
    case 'none': return false;
    case 'same_block': return same;
    case 'same_block_vertical': return same && !horizontal.includes(direction);
    case 'leaves': return !cutoutLeaves && data.groups.leaves.includes(neighbor.block);
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
  assert(fluidStates && fixture?.blockCount === count && Array.isArray(fixture.samples) && fixture.samples.length > 0, 'Incomplete native block culling fixtures');
  const blocks = new Set(), pairs = new Set();
  let faces = 0;
  for (const sample of fixture.samples) {
    const pair = stableStringify([sample.source, sample.neighbor]);
    assert(!pairs.has(pair) && Array.isArray(sample.faces) && sample.faces.length === 12, 'Invalid native block culling pair');
    pairs.add(pair);
    blocks.add(sample.source?.block);
    const checked = new Set();
    for (const face of sample.faces) {
      const key = `${face.direction}/${face.cutoutLeaves}`;
      assert(!checked.has(key) && typeof face.skip === 'boolean', 'Invalid native block culling face');
      checked.add(key);
      assert(skipsBlockFace(data, blockStates, fluidStates, sample.source, sample.neighbor, face.direction, face.cutoutLeaves) === face.skip,
        `Native block culling differs: ${sample.source.block}/${sample.neighbor.block}/${key}`);
      faces++;
    }
  }
  assert(blocks.size === count, 'Incomplete native block culling coverage');
  return { blockCullingBlocks: count, blockCullingPairs: pairs.size, blockCullingFaces: faces };
}
