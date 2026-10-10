import test from 'node:test';
import assert from 'node:assert/strict';
import { unpublishedReleases } from '../../tools/versions.js';
import { datasetNames } from '../../lib/datasets.js';
import { versionId } from '../../lib/identity.js';
import { stableStringify } from '../../extractors/minerender-data/lib.js';

test('version discovery excludes snapshots, published branches, and releases before the explicit cutoff', () => {
  const entry = (id, type, releaseTime) => ({ id, type, releaseTime });
  const versions = [entry('1.21.11', 'release', '2025-12-01'), entry('26.4', 'release', '2026-12-01'),
    entry('26.5', 'release', '2027-01-01'), entry('26w50a', 'snapshot', '2026-12-15')];
  assert.deepEqual(unpublishedReleases({ versions }, new Set(['26.4']), '2026-10-10'), ['26.5']);
  assert.throws(() => unpublishedReleases({ versions }, new Set(), 'invalid'), /ISO date/);
  for (const invalid of ['main', 'release', 'latest', '../1.21.11', '1.21.11\nmain', '--force', '1..2', '1.21.lock']) assert.throws(() => versionId(invalid));
  assert.deepEqual(datasetNames('all'), ['entity-models', 'minerender-data']);
  assert.throws(() => datasetNames('unknown'), /Unknown dataset/);
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});
