import { assert, stableStringify } from './lib.js';
import { validateStateProfiles } from './state-profiles.js';

const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const flags = ['renderModel', 'heightSolid', 'blocksFlow', 'waterOverlay'];
const directions = { east: [0, 0], west: [0, 1], up: [1, 0], down: [1, 1], south: [2, 0], north: [2, 1] };

export function validateFluidStates(data, blockStates) {
  assert(data && Array.isArray(data.shapes) && data.shapes.length > 0, 'Missing fluid occlusion shapes');
  for (const [index, shape] of data.shapes.entries()) {
    assert(Array.isArray(shape) && shape.every(box => Array.isArray(box) && box.length === 6
      && box.every(Number.isFinite) && [0, 1, 2].every(axis => box[axis] < box[axis + 3])), `Invalid fluid occlusion shape: ${index}`);
  }
  assert(Array.isArray(data.profiles) && data.profiles.length > 0, 'Missing fluid state profiles');
  for (const [index, profile] of data.profiles.entries()) {
    assert(profile && flags.every(name => typeof profile[name] === 'boolean')
      && (profile.solidRender === null || typeof profile.solidRender === 'boolean'), `Invalid fluid state flags: ${index}`);
    assert(profile.occlusionShape === null || integer(profile.occlusionShape, 0, data.shapes.length - 1), `Invalid fluid shape reference: ${index}`);
    if (profile.fluid !== undefined) {
      const fluid = profile.fluid;
      assert(fluid && ['water', 'lava'].includes(fluid.kind) && integer(fluid.amount, 1, 8)
        && typeof fluid.falling === 'boolean' && typeof fluid.source === 'boolean'
        && Number.isFinite(fluid.height) && Math.abs(fluid.height - fluid.amount / 9) < 1e-7, `Invalid contained fluid: ${index}`);
    }
  }
  return validateStateProfiles(data, blockStates, 'fluid state');
}

export function fluidStateProfile(data, blockStates, id, properties) {
  const entry = data.blocks[id];
  assert(entry && properties && Object.keys(properties).length === entry.properties.length, `Invalid native fluid state: ${id}`);
  let index = 0;
  for (const name of entry.properties) {
    const values = blockStates[id][name].values, value = values.indexOf(properties[name]);
    assert(value !== -1, `Invalid native fluid property: ${id}/${name}`);
    index = index * values.length + value;
  }
  return data.profiles[entry.states[index]];
}

// Compare the exported boxes with native fluid-face tests without using Minecraft's voxel-shape operations.
export function occludesFluidFace(boxes, direction, height) {
  assert(Object.hasOwn(directions, direction) && height > 0 && height <= 1, 'Invalid fluid face sample');
  if (!boxes.length || (direction === 'up' && Math.abs(height - 1) > 1e-7)) return false;
  const [axis, boundary] = directions[direction];
  const edge = boundary ? Math.max(...boxes.map(box => box[axis + 3])) : Math.min(...boxes.map(box => box[axis]));
  if (Math.abs(edge - boundary) > 1e-7) return false;
  const axes = [0, 1, 2].filter(value => value !== axis);
  const limits = axes.map(value => value === 1 ? height : 1);
  const rectangles = boxes.filter(box => Math.abs(box[axis + (boundary ? 3 : 0)] - edge) < 1e-7)
    .map(box => [...axes.map(value => box[value]), ...axes.map(value => box[value + 3])]);
  const cuts = limits.map((limit, index) => [...new Set([0, limit,
    ...rectangles.flatMap(rect => [rect[index], rect[index + 2]]).filter(value => value > 0 && value < limit)])].sort((a, b) => a - b));
  for (let x = 1; x < cuts[0].length; x++) {
    for (let y = 1; y < cuts[1].length; y++) {
      const u = (cuts[0][x - 1] + cuts[0][x]) / 2, v = (cuts[1][y - 1] + cuts[1][y]) / 2;
      if (!rectangles.some(rect => rect[0] <= u && rect[2] >= u && rect[1] <= v && rect[3] >= v)) return false;
    }
  }
  return true;
}

export function validateFluidFixtures(data, blockStates, fixture) {
  const count = validateFluidStates(data, blockStates);
  assert(fixture?.stateCount === count && Array.isArray(fixture.samples) && fixture.samples.length > 0, 'Incomplete native fluid fixtures');
  let faces = 0;
  for (const sample of fixture.samples) {
    const { occlusionShape, ...profile } = fluidStateProfile(data, blockStates, sample.block, sample.properties);
    assert(stableStringify(profile) === stableStringify(sample.profile), `Native fluid state differs: ${sample.block}`);
    const shape = occlusionShape === null ? null : data.shapes[occlusionShape];
    assert(stableStringify(shape) === stableStringify(sample.shape), `Native fluid shape differs: ${sample.block}`);
    assert(Array.isArray(sample.occlusion) && sample.occlusion.length === (shape === null ? 0 : 24), `Incomplete native fluid face fixtures: ${sample.block}`);
    const tested = new Set();
    for (const face of sample.occlusion) {
      const height = [0.125, 0.5, 8 / 9, 1].find(value => Math.abs(value - face.height) < 1e-7);
      const key = `${face.direction}/${height}`;
      assert(Object.hasOwn(directions, face.direction) && !tested.has(key) && height !== undefined, `Invalid native fluid face fixture: ${sample.block}`);
      tested.add(key);
      assert(occludesFluidFace(shape, face.direction, face.height) === face.occluded, `Native fluid face occlusion differs: ${sample.block}/${key}`);
      faces++;
    }
  }
  return { fluidStates: count, fluidSamples: fixture.samples.length, fluidFaces: faces };
}
