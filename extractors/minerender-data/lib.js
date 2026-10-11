import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
export { extractorIdentity, versionId } from '../../lib/identity.js';

export const DATASETS = {
  itemDefaults: 'item-defaults.json', itemProperties: 'item-properties.json', potionColors: 'potion-colors.json',
  blockAppearance: 'block-appearance.json', blockStates: 'block-states.json', fluids: 'fluids.json', fluidStates: 'fluid-states.json', dyes: 'dyes.json',
  blockLighting: 'block-lighting.json',
  legacyBiomes: 'legacy-biomes.json',
  blockCulling: 'block-culling.json',
  blockTints: 'block-tints.json', legacyBlocks: 'legacy-blocks.json'
};

// Older published manifests may omit these runtime datasets.
export const OPTIONAL_MANIFEST_DATASETS = ['fluidStates', 'blockAppearance', 'blockLighting', 'itemProperties', 'legacyBiomes', 'blockCulling'];

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function isImpliedItemDefault(components) {
  return Object.keys(components).length === 1 && components['minecraft:max_stack_size'] === 64;
}

export function stableStringify(value) {
  const sort = entry => Array.isArray(entry) ? entry.map(sort)
    : entry && typeof entry === 'object' ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, sort(entry[key])])) : entry;
  return JSON.stringify(sort(value), null, 2) + '\n';
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function object(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return Object.entries(value);
}

export function identifier(id) {
  assert(typeof id === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)
    && !id.split(/[:/]/).some(part => !part || part === '.' || part === '..'), `Invalid identifier: ${id}`);
}

export async function writeJson(directory, file, value) {
  const bytes = stableStringify(value);
  await writeFile(path.join(directory, file), bytes);
  return { file, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) };
}
