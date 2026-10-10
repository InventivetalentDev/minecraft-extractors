import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateBlocks } from './blocks.js';
import { validateModel } from './lib.js';
import { validateAnimationFile } from './animations.js';

export async function validateDirectory(input, version) {
  if (!(await lstat(input)).isDirectory()) throw new Error('Input must be a directory.');
  let models = 0;
  async function json(filename) {
    try {
      return JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      throw new Error(`${path.relative(input, filename)}: ${error.message}`);
    }
  }
  async function visit(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = [];
    const files = [];
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (name === '_textures.report.json') {
        if (!entry.isFile()) throw new Error('Texture report must be a regular file.');
        continue;
      }
      if (entry.isDirectory()) {
        if (!/^[a-z0-9_.-]+$/.test(entry.name) || entry.name === '.git') {
          throw new Error(`Unexpected directory: ${name}`);
        }
        directories.push(entry.name);
        await visit(filename, name);
      } else if (entry.isFile()) {
        if (entry.name === '_list.json') continue;
        files.push(entry.name);
        const data = await json(filename);
        if (name === 'version.json') {
          if (data?.id !== version) throw new Error('version.json does not match --version.');
          continue;
        }
        if (name === 'blocks.json') {
          validateBlocks(data);
          continue;
        }
        if (name.startsWith('animations/')) {
          validateAnimationFile(name, data);
          continue;
        }
        const match = /^([a-z0-9_.-]+)\/([a-z0-9_./-]+)\.json$/.exec(name);
        if (!match) throw new Error(`Unexpected file: ${name}`);
        try {
          validateModel(data);
        } catch (error) {
          throw new Error(`${name}: ${error.message}`);
        }
        if (data.id !== `${match[1]}:${match[2]}`) throw new Error(`Model id does not match its path: ${name}`);
        models += 1;
      } else {
        throw new Error(`Input must contain only regular files and directories: ${name}`);
      }
    }
    const listing = await json(path.join(directory, '_list.json'));
    const expected = { directories: directories.sort(), files: files.sort() };
    if (!listing || JSON.stringify(listing.directories) !== JSON.stringify(expected.directories)
        || JSON.stringify(listing.files) !== JSON.stringify(expected.files)
        || Object.keys(listing).sort().join(',') !== 'directories,files') {
      throw new Error(`Directory listing does not match its contents: ${relative || '.'}/_list.json`);
    }
  }
  await visit(input);
  await readFile(path.join(input, 'version.json'));
  if (models === 0) throw new Error('Input contains no models.');
}
