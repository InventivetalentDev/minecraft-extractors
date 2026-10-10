import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');

export function versionId(version) {
  if (typeof version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)
      || version.includes('..') || version.endsWith('.') || version.endsWith('.lock')
      || ['main', 'master', 'HEAD', 'latest', 'release', 'snapshot'].includes(version)) {
    throw new Error(`Use an exact Minecraft version: ${version}`);
  }
  return version;
}

export async function extractorIdentity(root = repoRoot) {
  root = await realpath(root);
  const directories = ['lib', 'tools', 'extractors'];
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let gitRoot = null;
  try { gitRoot = await realpath(git(['rev-parse', '--show-toplevel']).trim()); }
  catch { /* Source archives have no Git metadata. */ }
  let files = [];
  let revision = null;
  if (gitRoot === root) {
    files = git(['ls-files', '-z', '--', ...directories]).split('\0').filter(Boolean);
    try { revision = git(['rev-parse', 'HEAD']).trim(); }
    catch { /* A repository without commits still has a content hash. */ }
  } else {
    for (const directory of directories) {
      for (const entry of await readdir(path.join(root, directory), { withFileTypes: true, recursive: true })) {
        const file = path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).replaceAll(path.sep, '/');
        if (entry.isFile() && !file.split('/').some(part => part.startsWith('.'))) files.push(file);
      }
    }
  }
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file + '\0');
    hash.update(createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') + '\n');
  }
  return { repository: 'InventivetalentDev/minecraft-extractors', revision, sha256: hash.digest('hex') };
}

export async function isMain(url) {
  if (!process.argv[1]) return false;
  try { return await realpath(process.argv[1]) === await realpath(fileURLToPath(url)); }
  catch { return false; }
}
