import { assert, identifier, object } from './lib.js';

const REGISTRY = 'net.minecraft.data.worldgen.biome.Biomes';
const DATA_FIX = 'net.minecraft.util.datafix.fixes.ChunkHeightAndBiomeFix';
const UNKNOWN_IDS = [-1, 176, 255, 9999];

export function legacyBiomeName(data, id) {
  return Number.isSafeInteger(id) ? data.ids[id] : undefined;
}

export function validateLegacyBiomes(data) {
  assert(data?.format === 'legacy-numeric' && [REGISTRY, DATA_FIX].includes(data.source), 'Invalid legacy biome format');
  const entries = object(data.ids, 'Legacy biome IDs');
  assert(entries.length > 0, 'Empty legacy biome IDs');
  for (const [id, name] of entries) {
    assert(/^(0|[1-9][0-9]*)$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 255, `Invalid legacy biome ID: ${id}`);
    identifier(name);
  }
  for (const id of UNKNOWN_IDS) assert(!Object.hasOwn(data.ids, id), `Unexpected reserved legacy biome ID: ${id}`);
  return entries.length;
}

export function validateLegacyBiomeFixtures(data, samples) {
  const count = validateLegacyBiomes(data);
  assert(Array.isArray(samples) && samples.length === count + UNKNOWN_IDS.length, 'Incomplete native legacy biome fixtures');
  const seen = new Set();
  for (const sample of samples) {
    assert(Number.isSafeInteger(sample.id) && typeof sample.known === 'boolean' && !seen.has(sample.id), 'Invalid native legacy biome fixture');
    seen.add(sample.id);
    if (sample.known) {
      assert(sample.registered === true, `Native target biome is not registered: ${sample.id}`);
      assert(Object.hasOwn(data.ids, sample.id) && legacyBiomeName(data, sample.id) === sample.nativeName, `Native legacy biome differs: ${sample.id}`);
    } else {
      assert(UNKNOWN_IDS.includes(sample.id) && legacyBiomeName(data, sample.id) === undefined, `Unexpected legacy biome fallback: ${sample.id}`);
      assert(sample.nativeName === (data.source === DATA_FIX ? 'minecraft:plains' : null)
        && sample.registered === (data.source === DATA_FIX), 'Native unknown-biome behavior differs');
    }
  }
  assert(Object.keys(data.ids).every(id => seen.has(Number(id))) && UNKNOWN_IDS.every(id => seen.has(id)), 'Incomplete native legacy biome IDs');
  return { legacyBiomeIds: count, legacyBiomeSamples: samples.length };
}
