import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDatasets } from '../../tools/extract.js';

test('combined extraction rejects invalid output and dataset combinations before preparing a runtime', async () => {
  await assert.rejects(extractDatasets('1.21.11', '/tmp/extraction-output', { fixtures: '/tmp/extraction-output/fixtures.json' }), /outside the output/);
  await assert.rejects(extractDatasets('1.16.5', '/tmp/extraction-output'), /requires --dataset entity-models/);
  await assert.rejects(extractDatasets('1.21.11', '/tmp/extraction-output', { dataset: 'entity-models', fixtures: '/tmp/fixtures.json' }), /requires minerender-data/);
});
