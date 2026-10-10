import { parseArgs } from 'node:util';
import path from 'node:path';
import { download, DEFAULT_CACHE, loadVersion } from '../lib/download.js';
import { isMain, versionId } from '../lib/identity.js';
import { run } from '../lib/runtime.js';

export function unpublishedReleases(manifest, published, after) {
  if (!Number.isFinite(Date.parse(after))) throw new Error('Provide an ISO date with --after');
  return manifest.versions.filter(entry => entry.type === 'release' && Date.parse(entry.releaseTime) > Date.parse(after)
    && !published.has(entry.id)).sort((a, b) => Date.parse(a.releaseTime) - Date.parse(b.releaseTime)).slice(0, 10).map(entry => versionId(entry.id));
}

if (await isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      version: { type: 'string' }, repository: { type: 'string' }, after: { type: 'string' },
      cache: { type: 'string', default: DEFAULT_CACHE }, offline: { type: 'boolean', default: false }
    } });
    let versions;
    if (values.version) {
      if (values.repository || values.after) throw new Error('Choose --version or --repository with --after');
      versions = [versionId(values.version)];
    } else {
      if (!values.repository || !values.after || values.offline) throw new Error('Usage: node tools/versions.js --version VERSION [--cache DIR] [--offline], or --repository CHECKOUT --after DATE');
      const manifest = JSON.parse(await download('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', path.join(values.cache, 'manifest.json'), null, false, true));
      const refs = await run('git', ['ls-remote', '--heads', 'origin'], { cwd: values.repository });
      const published = new Set(refs.trim().split('\n').map(line => line.split('refs/heads/')[1]));
      versions = unpublishedReleases(manifest, published, values.after);
    }
    const include = [];
    for (const version of versions) {
      const { metadata } = await loadVersion(version, values.cache, values.offline);
      include.push({ version, java: String(Math.max(17, metadata.javaVersion?.majorVersion ?? 17)) });
    }
    console.log(JSON.stringify({ include }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
