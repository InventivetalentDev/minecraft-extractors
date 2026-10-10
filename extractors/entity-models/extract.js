import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../lib/identity.js';
import { stableStringify, writeDataset } from './lib.js';
import { blockTextureRecords, expandBlocks, listBlockIds, loadBlockFamilies } from './blocks.js';
import { addTextures, validateTextures } from './textures.js';
import { applyTransforms } from './transform.js';
import { applyPasses } from './passes.js';
import { buildAnimations } from './animations.js';
import { extractionAdapter } from './extraction-adapters.js';
import { addClassicBlockModels } from './classic-models.js';
import { proceduralAnimations } from './procedural-animations.js';
import { decimateProceduralAnimations } from './procedural-decimation.js';
import { exists } from '../../lib/download.js';
import { downloadLibraries, prepareRuntime, run } from '../../lib/runtime.js';

async function main() {
  const values = { offline: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const name = args[index].slice(2);
    if (args[index] === '--offline' && !values.offline) {
      values.offline = true;
    } else if (['--version', '--output', '--cache'].includes(args[index]) && !values[name] && args[index + 1] && !args[index + 1].startsWith('--')) {
      values[name] = args[++index];
    } else {
      throw new Error(`Unknown or incomplete option: ${args[index]}`);
    }
  }
  if (!values.version || !values.output) throw new Error('Usage: node extractors/entity-models/extract.js --version VERSION --output DIR [--cache DIR] [--offline]');
  return extract(values.version, values.output, values);
}

export async function extract(version, output, options = {}) {
  output = path.resolve(output);
  if (await exists(output)) throw new Error(`Output directory already exists: ${output}`);
  const adapter = extractionAdapter(version);
  if (/^1\.(\d+)/.test(version) && Number(version.match(/^1\.(\d+)/)[1]) < 17) {
    throw new Error('Use the legacy converter for Minecraft versions before 1.17');
  }
  const runtime = options.runtime ?? await prepareRuntime(version, options);
  const { entry, directory, jar: remapped, entries, libraries, java, cache } = runtime;
  if (entry.id !== version) throw new Error(`Prepared runtime is for ${entry.id}, expected ${version}`);
  const { offline = false } = options;
  console.log(`Extracting Minecraft ${entry.id} entity models...`);
  const extracted = path.join(directory, `models-${process.pid}.json`);
  const proceduralInputs = path.join(directory, `animation-inputs-${process.pid}.json`);
  try {
    await run(java, ['-Djava.awt.headless=true', '--class-path', [remapped, ...libraries].join(path.delimiter),
      fileURLToPath(new URL('./Extract.java', import.meta.url)), extracted], { cwd: directory });
    const { models: records, modelLayers } = JSON.parse(await readFile(extracted, 'utf8'));
    adapter.normalizeModels(records);
    await applyTransforms(records, entry.id);
    await addClassicBlockModels(records, entry.id);
    console.log(`Resolving Minecraft ${entry.id} textures...`);
    const textures = await addTextures(records, { jar: remapped, entries, modelLayers, version: entry.id, cache, offline });
    await applyPasses(records, entry.id, { cache, offline, textureEntries: textures.textureEntries });
    const blocks = expandBlocks(await loadBlockFamilies(), records, listBlockIds(entries));
    await validateTextures(blockTextureRecords(blocks), entry.id, new Map(), { cache, offline });
    await run(java, ['-Djava.awt.headless=true', '--class-path', [remapped, ...libraries].join(path.delimiter),
      fileURLToPath(new URL('./Animations.java', import.meta.url)), extracted], { cwd: directory });
    const native = JSON.parse(await readFile(extracted, 'utf8'));
    const dump = adapter.nativeAnimations(native);
    const procedural = proceduralAnimations(entry.id, records);
    if (!adapter.procedural) {
      console.warn(`Minecraft ${entry.id} has no reviewed procedural animation profiles; only native definitions are extracted.`);
    }
    if (procedural.length) {
      console.log(`Sampling Minecraft ${entry.id} procedural animations...`);
      const samplerLibraries = [...libraries, ...await downloadLibraries(adapter.samplerLibraries, cache, offline)];
      await writeFile(proceduralInputs, JSON.stringify(procedural));
      await run(java, ['-Djava.awt.headless=true', '--class-path', [remapped, ...samplerLibraries].join(path.delimiter),
        fileURLToPath(new URL('./ProceduralAnimations.java', import.meta.url)), proceduralInputs, extracted], { cwd: directory });
      dump.push(...decimateProceduralAnimations(JSON.parse(await readFile(extracted, 'utf8'))));
    }
    const { animations, findings } = buildAnimations(dump, records);
    for (const finding of findings) console.warn(`Animation mapping: ${finding}`);
    const count = await writeDataset(output, entry, records, { blocks, animations });
    await writeFile(path.join(output, '_textures.report.json'), stableStringify(textures.report));
    console.log(`${entry.id}: ${count - animations.length} models, ${animations.length} animation files → ${output}`);
    console.log(`${textures.withTexture} models with a texture; ${textures.withoutTexture} without.`);
  } finally {
    await rm(extracted, { force: true });
    await rm(proceduralInputs, { force: true });
  }
}

if (await isMain(import.meta.url)) {
  main().catch(error => {
    console.error(`Error: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
    process.exitCode = 1;
  });
}
