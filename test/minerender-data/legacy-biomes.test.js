import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyBiomeName, validateLegacyBiomes, validateLegacyBiomeFixtures } from '../../extractors/minerender-data/legacy-biomes.js';

function fixture(source = 'net.minecraft.data.worldgen.biome.Biomes') {
  const modern = source.endsWith('ChunkHeightAndBiomeFix');
  const data = { format: 'legacy-numeric', source, ids: { 0: 'minecraft:ocean', 1: 'minecraft:plains',
    3: modern ? 'minecraft:windswept_hills' : 'minecraft:mountains',
    12: modern ? 'minecraft:snowy_plains' : 'minecraft:snowy_tundra',
    47: modern ? 'minecraft:warm_ocean' : 'minecraft:deep_warm_ocean', 170: 'minecraft:soul_sand_valley' } };
  const samples = Object.entries(data.ids).map(([id, nativeName]) => ({ id: Number(id), known: true, nativeName, registered: true }));
  samples.push(...[-1, 176, 255, 9999].map(id => ({ id, known: false,
    nativeName: modern ? 'minecraft:plains' : null, registered: modern })));
  return { data, samples };
}

test('legacy IDs resolve to target-version names and unknown IDs do not become plains', () => {
  for (const source of ['net.minecraft.data.worldgen.biome.Biomes', 'net.minecraft.util.datafix.fixes.ChunkHeightAndBiomeFix']) {
    const { data, samples } = fixture(source);
    assert.deepEqual(validateLegacyBiomeFixtures(data, samples), { legacyBiomeIds: 6, legacyBiomeSamples: 10 });
    const modern = source.endsWith('ChunkHeightAndBiomeFix');
    assert.equal(legacyBiomeName(data, 3), modern ? 'minecraft:windswept_hills' : 'minecraft:mountains');
    assert.equal(legacyBiomeName(data, 12), modern ? 'minecraft:snowy_plains' : 'minecraft:snowy_tundra');
    assert.equal(legacyBiomeName(data, 47), modern ? 'minecraft:warm_ocean' : 'minecraft:deep_warm_ocean');
    assert.equal(legacyBiomeName(data, 170), 'minecraft:soul_sand_valley');
    for (const id of [-1, 176, 255, 9999, 0.5, '3', NaN]) assert.equal(legacyBiomeName(data, id), undefined);
  }
});

test('native validation requires every ID and rejects renaming, duplicates, and fallback changes', () => {
  for (const [change, pattern] of [
    [samples => samples.pop(), /Incomplete native legacy biome fixtures/],
    [samples => { samples[2].nativeName = 'minecraft:windswept_hills'; }, /Native legacy biome differs/],
    [samples => { samples[2].registered = false; }, /target biome is not registered/],
    [samples => { samples[1] = samples[0]; }, /Invalid native legacy biome fixture/],
    [samples => { samples.at(-1).id = 2; }, /Unexpected legacy biome fallback/],
    [samples => { samples.at(-1).nativeName = 'minecraft:plains'; }, /unknown-biome behavior/]
  ]) {
    const { data, samples } = fixture();
    change(samples);
    assert.throws(() => validateLegacyBiomeFixtures(data, samples), pattern);
  }
});

test('native target fixtures reject names left at the numeric-conversion schema', () => {
  const { data, samples } = fixture('net.minecraft.util.datafix.fixes.ChunkHeightAndBiomeFix');
  data.ids[3] = 'minecraft:mountains';
  assert.throws(() => validateLegacyBiomeFixtures(data, samples), /Native legacy biome differs/);
});

test('schema validation rejects registry order, malformed IDs, and invented fallback IDs', () => {
  for (const [change, pattern] of [
    [data => { data.source = 'net.minecraft.core.registries.BuiltInRegistries'; }, /Invalid legacy biome format/],
    [data => { data.ids['01'] = 'minecraft:plains'; }, /Invalid legacy biome ID/],
    [data => { data.ids[256] = 'minecraft:plains'; }, /Invalid legacy biome ID/],
    [data => { data.ids[255] = 'minecraft:plains'; }, /Unexpected reserved/],
    [data => { data.ids[0] = 'ocean'; }, /Invalid identifier/],
    [data => { data.ids = {}; }, /Empty legacy biome IDs/]
  ]) {
    const { data } = fixture();
    change(data);
    assert.throws(() => validateLegacyBiomes(data), pattern);
  }
});
