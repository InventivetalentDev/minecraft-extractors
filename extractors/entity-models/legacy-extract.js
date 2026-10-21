import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stableStringify, validateModel, writeDataset } from './lib.js';
import { addTextures, validateTextures } from './textures.js';
import { applyTransforms } from './transform.js';
import { DEFAULT_CACHE, downloadClient, exists, loadVersion } from '../../lib/download.js';
import { extractLegacyData } from './legacy-runtime.js';
import { listJar } from '../../lib/runtime.js';
import { addLegacyBlockLayers, legacyBlockAnimations } from './legacy-blocks.js';
import { applyLegacyPasses } from './legacy-passes.js';
import { blockTextureRecords, expandBlocks, listBlockIds } from './blocks.js';
import { buildAnimations } from './animations.js';
import { decimateProceduralAnimations } from './procedural-decimation.js';

function childrenOf(part, id) {
  if (!part || !Array.isArray(part.cubes) || !Array.isArray(part.children)) {
    throw new Error(`Invalid legacy part in ${id}`);
  }
  return part.children;
}

function textureSizes(parts, id) {
  const sizes = new Map();
  function visit(part) {
    const children = childrenOf(part, id);
    if (part.cubes.length) {
      const { textureWidth, textureHeight } = part;
      if (!(textureWidth > 0) || !(textureHeight > 0)) {
        throw new Error(`Invalid legacy texture size in ${id}`);
      }
      sizes.set(`${textureWidth},${textureHeight}`, [textureWidth, textureHeight]);
    }
    children.forEach(visit);
  }
  Object.values(parts).forEach(visit);
  return [...sizes.values()];
}

function sameTexture(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function convertPart(part, id, inheritedTexture) {
  const children = childrenOf(part, id);
  const partTexture = [part.textureWidth, part.textureHeight];
  const overrideTexture = part.cubes.length > 0 && !sameTexture(partTexture, inheritedTexture);
  const effectiveTexture = overrideTexture ? partTexture : inheritedTexture;
  return {
    ...(overrideTexture ? { texture: partTexture } : {}),
    pose: {
      offset: [part.pivotX, part.pivotY, part.pivotZ],
      rotation: [part.pitch, part.yaw, part.roll],
    },
    cubes: part.cubes.map(cube => ({
      origin: [cube.minX, cube.minY, cube.minZ],
      size: [cube.maxX - cube.minX, cube.maxY - cube.minY, cube.maxZ - cube.minZ],
      uv: cube.uv ?? [part.textureOffsetU, part.textureOffsetV],
      ...(cube.grow?.some(value => value !== 0) ? { grow: cube.grow } : {}),
      ...((cube.mirror ?? part.mirror) ? { mirror: true } : {}),
    })),
    children: Object.fromEntries(children.map((child, index) => [child.name ?? String(index), convertPart(child, id, effectiveTexture)])),
  };
}

function readModel(id, parts) {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) {
    throw new Error(`Invalid legacy model: ${id}`);
  }
  const sizes = textureSizes(parts, id);
  if (!sizes.length) return { model: null, mixed: false };
  const texture = [Math.max(...sizes.map(size => size[0])), Math.max(...sizes.map(size => size[1]))];
  const model = {
    id: id.includes(':') ? id : `minecraft:${id}`,
    layers: {
      main: {
        texture,
        root: {
          pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
          cubes: [],
          children: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, convertPart(part, id, texture)])),
        },
      },
    },
  };
  validateModel({ ...model, transform: [] });
  return { model, mixed: sizes.length > 1 };
}

export function convertModel(id, parts) {
  return readModel(id, parts).model;
}

export async function extractLegacy(output, options = {}) {
  output = resolve(output);
  options = { ...options, cache: resolve(options.cache || DEFAULT_CACHE), offline: options.offline ?? false };
  if (await exists(output)) throw new Error(`Output directory already exists: ${output}`);
  const { cache, offline } = options;
  const { entry, metadata, directory } = await loadVersion('1.16.5', cache, offline);
  const clientJar = await downloadClient(metadata, directory, offline);
  const runtime = await extractLegacyData({ ...options, metadata, clientJar });
  const records = [];
  let mixedTextureSizes = 0;
  for (const [id, layers] of Object.entries(runtime.models)) {
    const record = { id, layers: {} };
    let mixed = false;
    for (const [name, parts] of Object.entries(layers)) {
      const converted = readModel(id, parts);
      if (converted.model) record.layers[name] = converted.model.layers.main;
      mixed ||= converted.mixed;
    }
    if (Object.keys(record.layers).length) records.push(record);
    if (mixed) mixedTextureSizes++;
  }
  const blockIds = listBlockIds(await listJar(clientJar));
  const blockFamilies = await addLegacyBlockLayers(records, blockIds);
  const textures = await addTextures(records, { jar: clientJar, rendererTextures: runtime.textures, version: entry.id, cache, offline, validate: false });
  await applyLegacyPasses(records);
  const blocks = expandBlocks(blockFamilies, records, blockIds);
  const missing = new Map(textures.report.missing.map(finding => [`${finding.id}#${finding.layer}`, finding]));
  textures.report.missing = records.flatMap(record => Object.entries(record.layers).filter(([, layer]) => !layer.textureLocation)
    .map(([layer]) => ['inner_armor', 'outer_armor', 'armor', 'decor'].includes(layer)
      ? { id: record.id, layer, reason: 'Requires a caller-selected equipment texture' }
      : missing.get(`${record.id}#${layer}`) ?? { id: record.id, layer, reason: 'Requires a caller-selected texture' }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en') || a.layer.localeCompare(b.layer, 'en'));
  textures.withTexture = records.filter(record => Object.values(record.layers).some(layer => layer.textureLocation)).length;
  textures.withoutTexture = records.length - textures.withTexture;
  await applyTransforms(records, entry.id);
  const passTextures = records.filter(record => record.passes).map(record => ({ id: record.id,
    layers: Object.fromEntries(record.passes.filter(pass => pass.textureLocation).map((pass, index) => [index, pass])) }));
  await validateTextures([...records, ...blockTextureRecords(blocks), ...passTextures], entry.id, new Map(), { cache, offline });
  const { animations, findings } = buildAnimations(decimateProceduralAnimations([...runtime.animations, ...legacyBlockAnimations(records)]), records);
  if (findings.length) throw new Error(findings.join('\n'));
  await writeDataset(output, entry, records, { blocks, animations });
  await writeFile(join(output, '_textures.report.json'), stableStringify(textures.report));
  console.log(`Wrote ${records.length} models${options.logOutput === false ? '' : ` to ${output}`}; preserved part texture sizes for ${mixedTextureSizes} models with mixed sizes.`);
  console.log(`${textures.withTexture} models with a texture; ${textures.withoutTexture} without.`);
  console.log(`${Object.keys(blocks).length} block entries; ${animations.length} animation files.`);
}
