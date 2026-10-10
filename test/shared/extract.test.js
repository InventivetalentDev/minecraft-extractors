import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractDatasets } from '../../tools/extract.js';
import { extract as extractRegistry } from '../../extractors/minerender-data/extract.js';
import { SUPPORTED_VERSIONS } from '../../extractors/minerender-data/support.js';
import { convertLegacyFiles } from '../../extractors/entity-models/convert-legacy.js';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minecraft-extractors-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('combined extraction rejects invalid output and dataset combinations before preparing a runtime', async () => {
  await assert.rejects(extractDatasets('1.21.11', '/tmp/extraction-output', { fixtures: '/tmp/extraction-output/fixtures.json' }), /outside the output/);
  await assert.rejects(extractDatasets('1.21.11', '/tmp/extraction-output', { dataset: 'entity-models', fixtures: '/tmp/fixtures.json' }), /requires minerender-data/);
});

test('legacy extraction rejects incomplete dump pairs before preparing a runtime', async t => {
  const directory = await temporary(t);
  const output = path.join(directory, 'output');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  for (const options of [{ entityDump: '/tmp/entityModels.json' }, { blockEntityDump: '/tmp/blockEntityModels.json' }]) {
    await assert.rejects(extractDatasets('1.16.5', output, options), /Provide both --entity-dump/);
  }
  await assert.rejects(convertLegacyFiles(['/tmp/entityModels.json'], output), /Provide both entity and block-entity dump paths/);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(fetch.mock.callCount(), 0);
});

test('registry support is checked before runtime preparation or output creation', async t => {
  const directory = await temporary(t);
  const output = path.join(directory, 'output', 'dataset');
  const cache = path.join(directory, 'cache');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  const runtime = new Proxy({}, { get() { throw new Error('Unexpected runtime access'); } });
  for (const version of ['1.16.4', '1.21.6']) {
    for (const options of [{ offline: true, cache }, { runtime }]) {
      const expected = { message: `minerender-data does not support Minecraft ${version}. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}. Use tools/extract.js --dataset entity-models for entity-only extraction.` };
      await assert.rejects(extractDatasets(version, output, options), expected);
      await assert.rejects(extractDatasets(version, output, { ...options, dataset: 'minerender-data' }), expected);
      await assert.rejects(extractRegistry(version, output, options), expected);
      assert.deepEqual(await readdir(directory), []);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('supported registry versions and other entity-only versions reach runtime preparation', async t => {
  const directory = await temporary(t);
  const options = { offline: true, cache: path.join(directory, 'cache') };
  for (const version of SUPPORTED_VERSIONS) {
    const output = path.join(directory, version);
    await assert.rejects(extractDatasets(version, output, { ...options, dataset: 'minerender-data' }), /Offline cache miss/);
    await assert.rejects(extractDatasets(version, output, options), /Offline cache miss/);
    await assert.rejects(extractRegistry(version, output, options), /Offline cache miss/);
  }
  for (const version of ['1.16.5', '1.20.1', '26.1.2']) {
    await assert.rejects(extractDatasets(version, path.join(directory, version), { ...options, dataset: 'entity-models' }), /Offline cache miss/);
  }
  await assert.rejects(convertLegacyFiles([], path.join(directory, 'direct'), options), /Offline cache miss/);
  assert.deepEqual(await readdir(directory), []);
});
