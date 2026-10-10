export const DATASETS = ['entity-models', 'minerender-data'];

export function datasetNames(value = 'all') {
  if (value === 'all') return [...DATASETS];
  if (!DATASETS.includes(value)) throw new Error(`Unknown dataset: ${value}`);
  return [value];
}

export async function validateDataset(name, input, version) {
  datasetNames(name);
  if (name === 'all') throw new Error('Choose one dataset to validate or publish');
  const { validateDirectory } = name === 'entity-models'
    ? await import('../extractors/entity-models/validation.js')
    : await import('../extractors/minerender-data/validation.js');
  return validateDirectory(input, version);
}
