import { parseArgs } from 'node:util';
import { validateDataset } from '../lib/datasets.js';
import { versionId } from '../lib/identity.js';

try {
  const { values } = parseArgs({ options: { dataset: { type: 'string' }, input: { type: 'string' }, version: { type: 'string' } } });
  if (!values.dataset || !values.input || !values.version) throw new Error('Usage: node tools/validate.js --dataset DATASET --input DIR --version VERSION');
  await validateDataset(values.dataset, values.input, versionId(values.version));
  console.log(`Validated ${values.dataset} for ${values.version}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
