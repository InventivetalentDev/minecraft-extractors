import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { datasetNames, validateDataset } from '../lib/datasets.js';
import { isMain, versionId } from '../lib/identity.js';
import { exists } from '../lib/download.js';
import { prepareRuntime } from '../lib/runtime.js';

export async function extractDatasets(version, output, options = {}) {
  versionId(version);
  const datasets = datasetNames(options.dataset);
  const legacy = version === '1.16.5';
  if (legacy && (datasets.includes('minerender-data') || !options.entityDump || !options.blockEntityDump)) {
    throw new Error('Minecraft 1.16.5 requires --dataset entity-models, --entity-dump FILE and --block-entity-dump FILE');
  }
  if (options.fixtures && !datasets.includes('minerender-data')) throw new Error('--fixtures requires minerender-data');
  output = path.resolve(output);
  if (options.fixtures) {
    const relative = path.relative(output, path.resolve(options.fixtures));
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
      throw new Error('--fixtures must be outside the output directory');
    }
  }
  if (await exists(output)) throw new Error(`Output directory already exists: ${output}`);
  await mkdir(path.dirname(output), { recursive: true });
  const scratch = await mkdtemp(`${output}.tmp-`);
  try {
    const runtime = legacy ? undefined : await prepareRuntime(version, options);
    for (const dataset of datasets) {
      const destination = path.join(scratch, dataset);
      if (dataset === 'entity-models') {
        if (legacy) {
          const { convertLegacyFiles } = await import('../extractors/entity-models/convert-legacy.js');
          await convertLegacyFiles([options.entityDump, options.blockEntityDump], destination, options);
        } else {
          const { extract } = await import('../extractors/entity-models/extract.js');
          await extract(version, destination, { ...options, runtime });
        }
      } else {
        const { extract } = await import('../extractors/minerender-data/extract.js');
        await extract(version, destination, { ...options, runtime });
      }
      await validateDataset(dataset, destination, version);
    }
    await rename(scratch, output);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (await isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      version: { type: 'string' }, output: { type: 'string' }, dataset: { type: 'string', default: 'all' },
      cache: { type: 'string' }, offline: { type: 'boolean', default: false }, fixtures: { type: 'string' },
      'entity-dump': { type: 'string' }, 'block-entity-dump': { type: 'string' }, 'legacy-cache': { type: 'string' }
    } });
    if (!values.version || !values.output) throw new Error('Usage: node tools/extract.js --version VERSION --output DIR [--dataset all|entity-models|minerender-data] [--cache DIR] [--offline]');
    await extractDatasets(values.version, values.output, { ...values,
      entityDump: values['entity-dump'], blockEntityDump: values['block-entity-dump'], legacyCache: values['legacy-cache'] });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
