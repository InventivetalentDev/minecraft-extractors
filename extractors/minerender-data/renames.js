import { assert, identifier, object } from './lib.js';

export function renameTarget(data, kind, id, dataVersion) {
  const entry = data[kind][id];
  if (!entry) return undefined;
  if (dataVersion === undefined) return entry.registered ? undefined : entry.ranges.at(-1).to;
  if (dataVersion < data.baseDataVersion) return undefined;
  return entry.ranges.find(range => dataVersion < range.before)?.to;
}

export function validateRenames(data, blockStates, dataVersion) {
  assert(data?.format === 'data-fixer-renames' && data.baseDataVersion === 1519, 'Invalid rename format');
  let count = 0;
  for (const kind of ['blocks', 'items', 'entities']) {
    for (const [id, entry] of object(data[kind], `Rename ${kind}`)) {
      identifier(id);
      assert(object(entry, `Rename ${id}`).length === 2 && typeof entry.registered === 'boolean'
        && Array.isArray(entry.ranges) && entry.ranges.length > 0, `Invalid rename entry: ${id}`);
      let previous = data.baseDataVersion;
      for (const range of entry.ranges) {
        assert(object(range, `Rename range ${id}`).length === 2 && Number.isSafeInteger(range.before)
          && range.before > previous && range.before <= dataVersion, `Invalid rename range: ${id}`);
        identifier(range.to);
        assert(range.to !== id, `Rename target equals old ID: ${id}`);
        if (kind === 'blocks') assert(Object.hasOwn(blockStates, range.to), `Missing block rename target: ${range.to}`);
        previous = range.before;
      }
      if (kind === 'blocks') assert(entry.registered === Object.hasOwn(blockStates, id), `Incorrect registered block rename: ${id}`);
      count++;
    }
  }
  // These known answers fail when the candidate scan or the fixer call stops working.
  for (const [kind, id, before, to] of [
    ['blocks', 'minecraft:sign', 1802, 'minecraft:oak_sign'],
    ['items', 'minecraft:cactus_green', 1800, 'minecraft:green_dye'],
    ['entities', 'minecraft:zombie_pigman', 2509, 'minecraft:zombified_piglin']
  ]) {
    const entry = data[kind][id];
    assert(entry?.registered === false && entry.ranges.length === 1
      && entry.ranges[0].before === before && entry.ranges[0].to === to, `Missing known rename: ${id}`);
  }
  return count;
}

export function validateRenameFixtures(data, samples, blockStates, dataVersion) {
  const count = validateRenames(data, blockStates, dataVersion);
  const boundaries = Object.entries(data).filter(([kind]) => ['blocks', 'items', 'entities'].includes(kind))
    .flatMap(([kind, ids]) => Object.entries(ids).flatMap(([id, entry]) => entry.ranges
      .flatMap(({ before }) => [before - 1, before].map(version => `${kind}/${id}/${version}`))));
  assert(Array.isArray(samples) && samples.length === boundaries.length + 3, 'Incomplete native rename fixtures');
  const seen = new Set();
  for (const sample of samples) {
    assert((renameTarget(data, sample.kind, sample.id, sample.dataVersion) ?? sample.id) === sample.nativeName, `Native rename differs: ${sample.id}`);
    seen.add(`${sample.kind}/${sample.id}/${sample.dataVersion}`);
  }
  assert(boundaries.every(key => seen.has(key)), 'Incomplete native rename boundaries');
  return { renameIds: count, renameSamples: samples.length };
}
