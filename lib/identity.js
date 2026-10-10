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
  const files = [];
  for (const directory of ['lib', 'tools', 'extractors']) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) files.push(path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).replaceAll(path.sep, '/'));
    }
  }
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file + '\0');
    hash.update(createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') + '\n');
  }
  let revision = null;
  try {
    if (await realpath(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) === root) {
      revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
  } catch { /* Extracted files still identify the source through its content hash. */ }
  return { repository: 'InventivetalentDev/minecraft-extractors', revision, sha256: hash.digest('hex') };
}

export async function isMain(url) {
  if (!process.argv[1]) return false;
  try { return await realpath(process.argv[1]) === await realpath(fileURLToPath(url)); }
  catch { return false; }
}
