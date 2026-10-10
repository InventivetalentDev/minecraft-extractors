import { cp, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { run } from '../lib/runtime.js';
import { validateDataset } from '../lib/datasets.js';
import { extractorIdentity, isMain, repoRoot, versionId } from '../lib/identity.js';

export async function publish(dataset, version, input, repository, push = false) {
  versionId(version);
  input = await realpath(input);
  repository = await realpath(repository);
  const manifest = await validateDataset(dataset, input, version);
  const git = (args, cwd = repository) => run('git', args, { cwd });
  const root = await realpath((await git(['rev-parse', '--show-toplevel'])).trim());
  if (root !== repository) throw new Error('--repository must name the destination checkout root');
  const common = async cwd => realpath(path.resolve(cwd, (await git(['rev-parse', '--git-common-dir'], cwd)).trim()));
  if (await common(repository) === await common(repoRoot)) throw new Error('Publish to a dataset repository, not the extraction tooling repository');
  if ((await git(['status', '--porcelain'], repoRoot)).trim()) throw new Error('Commit tooling changes before publishing');
  if (dataset === 'minerender-data') {
    const identity = await extractorIdentity();
    if (!manifest.extractor.revision || manifest.extractor.revision !== identity.revision
        || manifest.extractor.sha256 !== identity.sha256 || manifest.extractor.repository !== identity.repository) {
      throw new Error('Re-extract using the committed current tooling before publishing');
    }
  }
  await git(['check-ref-format', '--branch', version]);
  if (push) await git(['fetch', 'origin', `+refs/heads/${version}:refs/remotes/origin/${version}`]).catch(async error => {
    const refs = await git(['ls-remote', '--heads', 'origin', `refs/heads/${version}`]);
    if (refs.trim()) throw error;
  });
  const hasRef = async ref => { try { await git(['show-ref', '--verify', '--quiet', ref]); return true; } catch { return false; } };
  const local = await hasRef(`refs/heads/${version}`), remote = await hasRef(`refs/remotes/origin/${version}`);
  if (local && remote && (await git(['rev-parse', version])).trim() !== (await git(['rev-parse', `origin/${version}`])).trim()) {
    throw new Error(`Local ${version} differs from origin; reconcile it before publishing`);
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'minecraft-extractors-publish-'));
  const checkout = path.join(temporary, 'checkout');
  let attached = false;
  try {
    if (local) { await git(['worktree', 'add', '--quiet', checkout, version]); attached = true; }
    else if (remote) { await git(['worktree', 'add', '--quiet', '-b', version, checkout, `origin/${version}`]); attached = true; }
    else {
      await git(['worktree', 'add', '--quiet', '--detach', checkout, 'HEAD']);
      attached = true;
      await git(['switch', '--orphan', version], checkout);
    }
    for (const file of await readdir(checkout)) if (file !== '.git') await rm(path.join(checkout, file), { recursive: true, force: true });
    for (const file of await readdir(input)) {
      if (dataset === 'entity-models' && file === '_textures.report.json') continue;
      await cp(path.join(input, file), path.join(checkout, file), { recursive: true });
    }
    await git(['add', '--all'], checkout);
    if ((await git(['diff', '--cached', '--name-only'], checkout)).trim()) await git(['commit', '-m', `Extract Minecraft ${version}`], checkout);
    if (push) await git(['push', 'origin', `refs/heads/${version}:refs/heads/${version}`]);
    console.log(push ? `Published ${dataset} ${version}` : `Prepared ${dataset} ${version}; push from ${repository} with: git push origin ${version}`);
  } finally {
    if (attached) await git(['worktree', 'remove', '--force', checkout]);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (await isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { dataset: { type: 'string' }, version: { type: 'string' }, input: { type: 'string' }, repository: { type: 'string' }, push: { type: 'boolean', default: false } } });
    if (!values.dataset || !values.version || !values.input || !values.repository) throw new Error('Usage: node tools/publish.js --dataset DATASET --version VERSION --input DIR --repository CHECKOUT [--push]');
    await publish(values.dataset, values.version, values.input, values.repository, values.push);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
