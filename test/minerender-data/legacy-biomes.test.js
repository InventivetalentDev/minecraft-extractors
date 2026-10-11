import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyBiomeName, validateLegacyBiomes, validateLegacyBiomeFixtures } from '../../extractors/minerender-data/legacy-biomes.js';

function fixture(source = 'net.minecraft.data.worldgen.biome.Biomes') {
  const data = { format: 'legacy-numeric', source, ids: { 0: 'minecraft:ocean', 1: 'minecraft:plains', 3: 'minecraft:mountains', 170: 'minecraft:soul_sand_valley' } };
  const samples = Object.entries(data.ids).map(([id, nativeName]) => ({ id: Number(id), known: true, nativeName }));
  samples.push(...[-1, 176, 255, 9999].map(id => ({ id, known: false,
    nativeName: source.endsWith('ChunkHeightAndBiomeFix') ? 'minecraft:plains' : null })));
  return { data, samples };
}

test('legacy IDs retain historical names and unknown IDs do not become plains', () => {
  for (const source of ['net.minecraft.data.worldgen.biome.Biomes', 'net.minecraft.util.datafix.fixes.ChunkHeightAndBiomeFix']) {
    const { data, samples } = fixture(source);
    assert.deepEqual(validateLegacyBiomeFixtures(data, samples), { legacyBiomeIds: 4, legacyBiomeSamples: 8 });
    assert.equal(legacyBiomeName(data, 3), 'minecraft:mountains');
    assert.equal(legacyBiomeName(data, 170), 'minecraft:soul_sand_valley');
    for (const id of [-1, 176, 255, 9999, 0.5, '3', NaN]) assert.equal(legacyBiomeName(data, id), undefined);
  }
});

test('native validation requires every ID and rejects renaming, duplicates, and fallback changes', () => {
  for (const [change, pattern] of [
    [samples => samples.pop(), /Incomplete native legacy biome fixtures/],
    [samples => { samples[2].nativeName = 'minecraft:windswept_hills'; }, /Native legacy biome differs/],
    [samples => { samples[1] = samples[0]; }, /Invalid native legacy biome fixture/],
    [samples => { samples.at(-1).id = 2; }, /Unexpected legacy biome fallback/],
    [samples => { samples.at(-1).nativeName = 'minecraft:plains'; }, /unknown-biome behavior/]
  ]) {
    const { data, samples } = fixture();
    change(samples);
    assert.throws(() => validateLegacyBiomeFixtures(data, samples), pattern);
  }
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
