import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const DEFAULT_CACHE = '.cache/minecraft-extractors';
export const NAMED_CLIENT_CLASSES = ['net/minecraft/SharedConstants.class', 'net/minecraft/server/Bootstrap.class',
  'net/minecraft/core/registries/BuiltInRegistries.class', 'net/minecraft/client/model/geom/LayerDefinitions.class',
  'net/minecraft/client/model/geom/ModelLayers.class'];

export function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

export async function exists(file) {
  try { await access(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function download(url, file, expectedHash, offline = false, refresh = false) {
  if (!refresh && await exists(file)) {
    const bytes = await readFile(file);
    if (expectedHash && sha1(bytes) !== expectedHash) throw new Error(`SHA-1 mismatch: ${file}`);
    return bytes;
  }
  if (offline) throw new Error(`Offline cache miss: ${file}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedHash && sha1(bytes) !== expectedHash) throw new Error(`SHA-1 mismatch: ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes;
}

export async function loadVersion(version, cache = DEFAULT_CACHE, offline = false) {
  if (typeof version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version)) {
    throw new Error(`Invalid Minecraft version: ${version}`);
  }
  const manifest = JSON.parse(await download(MANIFEST, path.join(cache, 'manifest.json'), null, offline, !offline));
  const entry = manifest.versions.find(candidate => candidate.id === version);
  if (!entry) throw new Error(`Version not found in Mojang manifest: ${version}`);
  if (!/^[a-f0-9]{40}$/.test(entry.sha1)) throw new Error(`Invalid manifest SHA-1 for Minecraft ${version}`);
  const directory = path.join(cache, entry.id);
  const metadata = JSON.parse(await download(entry.url, path.join(directory, `${entry.sha1}.json`), entry.sha1, offline));
  if (metadata.id !== version) throw new Error(`Version metadata mismatch: expected ${version}, received ${metadata.id}`);
  return { entry, metadata, directory };
}

export async function downloadClient(metadata, directory, offline = false) {
  const client = metadata.downloads?.client;
  if (!client?.url || !/^[a-f0-9]{40}$/.test(client.sha1)) {
    throw new Error(`Missing client download for Minecraft ${metadata.id}`);
  }
  const file = path.join(directory, `client-${client.sha1}.jar`);
  await download(client.url, file, client.sha1, offline);
  return file;
}

export function clientNeedsRemapping(metadata, entries = []) {
  if (metadata.downloads?.client_mappings) return true;
  const named = new Set(entries);
  const missing = NAMED_CLIENT_CLASSES.filter(name => !named.has(name));
  if (missing.length) throw new Error(`Client has no mappings and is missing named classes: ${missing.join(', ')}`);
  return false;
}
