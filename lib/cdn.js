import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const CDN = 'https://assets.mcasset.cloud';

export async function refreshMineRenderData(version, manifest, token, {
  request = fetch, timeout = 600_000, interval = 30_000
} = {}) {
  const expected = Buffer.from(manifest);
  const datasets = Object.values(JSON.parse(expected).datasets);
  const root = `${CDN}/${encodeURIComponent(version)}/minerender-data`;
  const deadline = Date.now() + timeout;
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now())));
  const get = url => request(url, { cache: 'no-store', redirect: 'error', signal: signal() });
  while (Date.now() < deadline) {
    let response;
    try {
      response = await request(`${CDN}/minerender-data/purge`, {
        method: 'POST', redirect: 'error', signal: signal(),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version })
      });
    } catch {
      throw new Error('CDN purge request failed');
    }
    if (!response.ok) throw new Error(`CDN purge failed: HTTP ${response.status}`);
    const result = await response.json().catch(() => undefined);
    if (result?.success !== true) throw new Error('CDN purge did not confirm success');

    try {
      response = await get(`${root}/manifest.json`);
      if (response.ok && expected.equals(Buffer.from(await response.arrayBuffer()))) {
        const checks = await Promise.allSettled([
          ...datasets.map(async dataset => {
            const file = await get(`${root}/${encodeURIComponent(dataset.file)}`);
            if (!file.ok) return false;
            const bytes = Buffer.from(await file.arrayBuffer());
            return bytes.length === dataset.bytes && createHash('sha256').update(bytes).digest('hex') === dataset.sha256;
          }),
          (async () => {
            const index = await get(`${CDN}/minerender-data/versions.json`);
            if (!index.ok) return false;
            return (await index.json()).versions?.some(entry => entry.name === version) === true;
          })()
        ]);
        if (checks.every(check => check.status === 'fulfilled' && check.value)) return;
      }
    } catch {}
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(interval, remaining));
  }
  throw new Error(`CDN data or version index for Minecraft ${version} did not match the published files within ${timeout / 1000} seconds`);
}
