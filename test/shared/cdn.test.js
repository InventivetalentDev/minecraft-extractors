import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { refreshMineRenderData } from '../../lib/cdn.js';

const files = { 'item-defaults.json': Buffer.from('{"item":1}\n'), 'fluids.json': Buffer.from('{"water":true}\n') };
const manifest = Buffer.from(JSON.stringify({ minecraftVersion: '1.21.11', datasets: Object.fromEntries(
  Object.entries(files).map(([file, bytes]) => [file, {
    file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
  }])
) }));

function freshResponse(url) {
  if (url === 'https://assets.mcasset.cloud/minerender-data/versions.json') return Response.json({ versions: [{ name: '1.21.11' }] });
  assert.ok(url.startsWith('https://assets.mcasset.cloud/1.21.11/minerender-data/'));
  const file = url.split('/').at(-1);
  const body = file === 'manifest.json' ? manifest : files[file];
  assert.ok(body, `Unexpected CDN file: ${file}`);
  return new Response(body);
}

test('CDN refresh repeats the purge until the published manifest is served', async () => {
  const calls = [];
  await refreshMineRenderData('1.21.11', manifest, 'test-token', {
    interval: 1,
    request: async (url, options) => {
      calls.push([url, options]);
      if (options.method === 'POST') return Response.json({ success: true });
      return calls.length === 2 ? new Response('stale manifest') : freshResponse(url);
    }
  });
  assert.equal(calls.length, 7);
  for (const [url, options] of calls) {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (options.method === 'POST') {
      assert.equal(url, 'https://assets.mcasset.cloud/minerender-data/purge');
      assert.deepEqual(options.headers, { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(options.body), { version: '1.21.11' });
    } else {
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers, undefined);
    }
  }
});

test('CDN refresh retries independently stale dataset bytes and version discovery', async () => {
  for (const stale of ['hash', 'size', 'missing', 'index']) {
    let purges = 0;
    await refreshMineRenderData('1.21.11', manifest, 'test-token', {
      interval: 1,
      request: async (url, options) => {
        if (options.method === 'POST') { purges++; return Response.json({ success: true }); }
        if (purges === 1) {
          if (stale === 'index' && url.endsWith('/versions.json')) return Response.json({ versions: [] });
          if (url.endsWith('/fluids.json')) {
            if (stale === 'hash') return new Response('x'.repeat(files['fluids.json'].length));
            if (stale === 'size') return new Response('x');
            if (stale === 'missing') return new Response('', { status: 404 });
          }
        }
        return freshResponse(url);
      }
    });
    assert.equal(purges, 2, stale);
  }
});

test('CDN refresh rejects failed or unconfirmed purges without polling the manifest', async () => {
  for (const response of [new Response('denied', { status: 401 }), Response.json({ success: false }), new Response('not json')]) {
    let calls = 0;
    await assert.rejects(refreshMineRenderData('1.21.11', manifest, 'test-token', {
      request: async () => { calls++; return response; }
    }), /CDN purge (failed: HTTP 401|did not confirm success)/);
    assert.equal(calls, 1);
  }
  await assert.rejects(refreshMineRenderData('1.21.11', manifest, 'test-token', {
    request: async () => { throw new Error('test-token'); }
  }), { message: 'CDN purge request failed' });
});

test('CDN refresh stops polling a stale or missing manifest at the deadline', async () => {
  for (const status of [200, 404]) {
    let purges = 0;
    await assert.rejects(refreshMineRenderData('1.21.11', manifest, 'test-token', {
      timeout: 20, interval: 1,
      request: async (_url, options) => {
        if (options.method === 'POST') { purges++; return Response.json({ success: true }); }
        return new Response('old manifest', { status });
      }
    }), /did not match the published files within 0.02 seconds/);
    assert.ok(purges > 0);
  }
});
