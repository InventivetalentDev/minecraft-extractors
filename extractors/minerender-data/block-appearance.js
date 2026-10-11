import { assert, object } from './lib.js';

const LAYERS = ['solid', 'cutout_mipped', 'cutout', 'translucent', 'tripwire'];
const POSITIONS = [[0, 0, 0], [1, 7, 2], [-17, -64, 31], [7, 255, -3], [7, -20, -3], [30000000, 319, -30000000]];
const sameKeys = (value, keys) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function blockOffset(data, id, [x, , z]) {
  const rule = data.offsets[id];
  if (!rule) return [0, 0, 0];
  // Vanilla multiplies x as an int, then computes the remaining seed as a signed long.
  let seed = BigInt(Math.imul(x, 3129871)) ^ BigInt(z) * 116129781n;
  seed = BigInt.asIntN(64, seed * seed * 42317861n + seed * 11n) >> 16n;
  const part = shift => Math.fround(Number(seed >> BigInt(shift) & 15n) / 15);
  const horizontal = shift => Math.max(-rule.horizontal, Math.min(rule.horizontal, (part(shift) - 0.5) * 0.5));
  return [horizontal(0), (part(4) - 1) * rule.vertical, horizontal(8)];
}

export function blockRenderLayer(data, id, cutoutLeaves = true) {
  const layers = data.renderLayers;
  assert(layers.source === 'block', 'Sprite render layers require the active material transparency');
  const value = layers.blocks[id];
  return typeof value === 'string' ? value : value?.[cutoutLeaves ? 'cutoutLeaves' : 'solidLeaves'] ?? layers.default;
}

export function validateBlockAppearance(data, blockStates) {
  assert(data && sameKeys(data, ['offsetAlgorithm', 'offsets', 'renderLayers'])
    && data.offsetAlgorithm === 'minecraft-position-v1', 'Invalid block appearance format');
  for (const [id, rule] of object(data.offsets, 'Block offsets')) {
    assert(Object.hasOwn(blockStates, id) && rule && sameKeys(rule, ['type', 'horizontal', 'vertical'])
      && ['xz', 'xyz'].includes(rule.type) && Number.isFinite(rule.horizontal) && rule.horizontal >= 0 && rule.horizontal <= 0.25
      && Number.isFinite(rule.vertical) && rule.vertical >= 0 && rule.vertical <= 1
      && (rule.horizontal > 0 || rule.vertical > 0) && (rule.type === 'xyz' ? rule.vertical > 0 : rule.vertical === 0), `Invalid block offset: ${id}`);
  }
  const layers = data.renderLayers;
  assert(layers && ['block', 'sprite'].includes(layers.source), 'Invalid render-layer policy');
  if (layers.source === 'block') {
    assert(sameKeys(layers, ['source', 'default', 'blocks']) && layers.default === 'solid', 'Invalid block render-layer defaults');
    for (const [id, values] of object(layers.blocks, 'Block render layers')) {
      assert(Object.hasOwn(blockStates, id) && (typeof values === 'string' ? LAYERS.includes(values) && values !== 'solid'
        : values && sameKeys(values, ['solidLeaves', 'cutoutLeaves']) && Object.values(values).every(layer => LAYERS.includes(layer))
          && values.solidLeaves !== values.cutoutLeaves), `Invalid block render layer: ${id}`);
    }
  } else {
    assert(sameKeys(layers, ['source', 'opaque', 'cutout', 'translucent']) && layers.opaque === 'solid'
      && layers.cutout === 'cutout' && layers.translucent === 'translucent', 'Invalid sprite render-layer policy');
  }
  return Object.values(blockStates).reduce((total, properties) => total
    + Object.values(properties).reduce((count, property) => count * property.values.length, 1), 0);
}

export function validateAppearanceFixtures(data, blockStates, fixture) {
  const stateCount = validateBlockAppearance(data, blockStates), blocks = Object.keys(blockStates);
  const sprite = data.renderLayers.source === 'sprite';
  assert(fixture?.stateCount === stateCount && fixture.offsetChecks === stateCount * POSITIONS.length
    && fixture.layerChecks === (sprite ? 4 : stateCount * 2), 'Incomplete native appearance state checks');
  assert(Array.isArray(fixture.offsets) && fixture.offsets.length === blocks.length * POSITIONS.length
    && Array.isArray(fixture.layers) && fixture.layers.length === (sprite ? 4 : blocks.length * 2), 'Incomplete native appearance fixtures');
  const positions = new Set(POSITIONS.map(position => position.join(','))), seen = new Set();
  for (const sample of fixture.offsets) {
    const position = sample.position?.join(','), key = `${sample.block}:${position}`;
    assert(Object.hasOwn(blockStates, sample.block) && positions.has(position) && !seen.has(key), 'Invalid native offset fixture');
    seen.add(key);
    const expected = blockOffset(data, sample.block, sample.position);
    assert(Array.isArray(sample.offset) && sample.offset.length === 3
      && sample.offset.every((value, axis) => Number.isFinite(value) && Math.abs(value - expected[axis]) < 1e-12), `Native block offset differs: ${sample.block}`);
  }
  seen.clear();
  for (const sample of fixture.layers) {
    let key, expected;
    if (sprite) {
      assert(typeof sample.transparent === 'boolean' && typeof sample.translucent === 'boolean', 'Invalid native sprite layer fixture');
      key = `${sample.transparent}:${sample.translucent}`;
      expected = data.renderLayers[sample.translucent ? 'translucent' : sample.transparent ? 'cutout' : 'opaque'];
    } else {
      assert(Object.hasOwn(blockStates, sample.block) && typeof sample.cutoutLeaves === 'boolean', 'Invalid native block layer fixture');
      key = `${sample.block}:${sample.cutoutLeaves}`;
      expected = blockRenderLayer(data, sample.block, sample.cutoutLeaves);
    }
    assert(!seen.has(key), 'Duplicate native layer fixture');
    seen.add(key);
    assert(sample.layer === expected, 'Native block render layer differs');
  }
  return { appearanceStates: stateCount, blockOffsetChecks: fixture.offsetChecks, blockLayerChecks: fixture.layerChecks };
}
