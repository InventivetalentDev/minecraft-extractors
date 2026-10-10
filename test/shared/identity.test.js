import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractorIdentity } from '../../lib/identity.js';

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'minecraft-extractors-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: path.join(root, 'empty-config'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = args => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(root, 'hooks')}`, ...args],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const directory of ['lib', 'tools', 'extractors']) {
    await mkdir(path.join(root, directory));
    await writeFile(path.join(root, directory, 'source.js'), `export const source = '${directory}';\n`);
  }
  await writeFile(path.join(root, '.gitignore'), '.DS_Store\n*.log\n');
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Identity test']);
  git(['config', 'user.email', 'identity@example.test']);
  git(['add', '--all']);
  git(['commit', '-m', 'Source fixture']);
  return { root, git };
}

test('identity hashes tracked source content without ignored or untracked files', async t => {
  const { root, git } = await repository(t);
  const original = await extractorIdentity(root);
  assert.equal(original.revision, git(['rev-parse', 'HEAD']));
  await writeFile(path.join(root, 'extractors', '.DS_Store'), 'Finder metadata');
  assert.equal(git(['status', '--porcelain']), '');
  assert.deepEqual(await extractorIdentity(root), original);
  await writeFile(path.join(root, 'tools', 'extract.log'), 'Local extraction output');
  assert.equal(git(['status', '--porcelain']), '');
  assert.deepEqual(await extractorIdentity(root), original);

  await writeFile(path.join(root, 'lib', 'untracked.js'), 'export const unused = true;\n');
  assert.deepEqual(await extractorIdentity(root), original);
  await writeFile(path.join(root, 'lib', 'source.js'), 'export const source = "changed";\n');
  const changed = await extractorIdentity(root);
  assert.equal(changed.revision, original.revision);
  assert.notEqual(changed.sha256, original.sha256);
});

test('source archives retain a content identity without inheriting a parent repository', async t => {
  const { root } = await repository(t);
  const original = await extractorIdentity(root);
  const archive = path.join(root, 'archive');
  await mkdir(archive);
  for (const directory of ['lib', 'tools', 'extractors']) {
    await cp(path.join(root, directory), path.join(archive, directory), { recursive: true });
  }
  assert.deepEqual(await extractorIdentity(archive), { ...original, revision: null });
  await writeFile(path.join(archive, 'extractors', '.DS_Store'), 'Finder metadata');
  assert.deepEqual(await extractorIdentity(archive), { ...original, revision: null });
});
