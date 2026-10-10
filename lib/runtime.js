import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CACHE, clientNeedsRemapping, download, downloadClient, exists, loadVersion, sha1 } from './download.js';

const ART_VERSION = '2.0.18';
const ART_SHA1 = '59bd788e0a1bd339256711dee40015a62cdf3cd2';
const ART_URL = `https://maven.neoforged.net/releases/net/neoforged/AutoRenamingTool/${ART_VERSION}/AutoRenamingTool-${ART_VERSION}-all.jar`;

export const javaTool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-24000); });
    child.stderr.on('data', bytes => { output = (output + bytes).slice(-24000); });
    child.on('error', error => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(
      `${path.basename(command)} exited with code ${code}: ${output.trim()}`)));
  });
}

export function allowedLibrary(library) {
  let allowed = !library.rules;
  const osName = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64', ia32: 'x86' }[process.arch] || process.arch;
  for (const rule of library.rules || []) {
    if (rule.os?.name && rule.os.name !== osName) continue;
    if (rule.os?.arch && !new RegExp(`^(?:${rule.os.arch})$`).test(arch)) continue;
    if (rule.os?.version && !new RegExp(rule.os.version).test(os.release())) continue;
    if (rule.features && Object.values(rule.features).some(Boolean)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

// One listing serves the class, blockstate, and texture lookups of a run.
export async function listJar(jar) {
  const { stdout } = await promisify(execFile)(javaTool('jar'), ['tf', jar], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

export async function downloadLibraries(libraries, cache = DEFAULT_CACHE, offline = false) {
  const artifacts = libraries.filter(allowedLibrary).map(library => library.downloads?.artifact).filter(Boolean);
  for (const artifact of artifacts) {
    if (!artifact.url || !/^[a-f0-9]{40}$/.test(artifact.sha1)) throw new Error(`Invalid library download: ${artifact.url}`);
  }
  const distinct = [...new Map(artifacts.map(artifact => [artifact.sha1, artifact])).values()];
  const files = [];
  for (let index = 0; index < distinct.length; index += 6) {
    const results = await Promise.allSettled(distinct.slice(index, index + 6).map(async artifact => {
      const file = path.join(cache, 'libraries', `${artifact.sha1}.jar`);
      await download(artifact.url, file, artifact.sha1, offline);
      return file;
    }));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      files.push(result.value);
    }
  }
  return files;
}

export async function prepareRuntime(version, { cache = DEFAULT_CACHE, offline = false } = {}) {
  cache = path.resolve(cache);
  const { entry, metadata, directory } = await loadVersion(version, cache, offline);
  const java = javaTool('java');
  const requiredJava = Math.max(17, metadata.javaVersion?.majorVersion || 17);
  const javaVersion = await run(java, ['-version']);
  const javaMajor = Number(javaVersion.match(/version "(\d+)/)?.[1]);
  if (!javaMajor || javaMajor < requiredJava) {
    throw new Error(`Minecraft ${version} requires Java ${requiredJava}+; set JAVA_HOME to a matching JDK`);
  }
  const clientJar = await downloadClient(metadata, directory, offline);
  const client = metadata.downloads.client;
  const mappings = metadata.downloads.client_mappings;
  let entries = mappings ? undefined : await listJar(clientJar);
  const remap = clientNeedsRemapping(metadata, entries);
  const libraries = await downloadLibraries(metadata.libraries, cache, offline);
  const source = { client: { sha1: client.sha1, url: client.url } };
  let jar = clientJar;
  if (remap) {
    if (!mappings.url || !/^[a-f0-9]{40}$/.test(mappings.sha1)) throw new Error(`Invalid client mappings for Minecraft ${version}`);
    const mappingFile = path.join(directory, `mappings-${mappings.sha1}.txt`);
    const remapper = path.join(cache, `AutoRenamingTool-${ART_VERSION}-all.jar`);
    await download(mappings.url, mappingFile, mappings.sha1, offline);
    await download(ART_URL, remapper, ART_SHA1, offline);
    source.mappings = { sha1: mappings.sha1, url: mappings.url };
    source.remapper = { version: ART_VERSION, sha1: ART_SHA1 };
    const remapKey = sha1(`${client.sha1}:${mappings.sha1}:${ART_SHA1}`);
    jar = path.join(directory, `mapped-${remapKey}.jar`);
    const checksum = `${jar}.sha1`;
    if (await exists(jar) && await exists(checksum)) {
      if (sha1(await readFile(jar)) !== (await readFile(checksum, 'utf8')).trim()) throw new Error(`SHA-1 mismatch: ${jar}`);
    } else {
      if (offline) throw new Error(`Offline cache miss: ${jar}`);
      const temporary = `${jar}.${randomUUID()}.tmp.jar`;
      const temporaryChecksum = `${temporary}.sha1`;
      try {
        await run(java, ['-Xmx2G', '-jar', remapper, '--input', clientJar, '--output', temporary,
          '--map', mappingFile, '--reverse', '--ann-fix', '--record-fix', '--strip-sigs', '--threads', '2',
          '--log', path.join(directory, 'remap.log'), ...libraries.flatMap(file => ['--lib', file])]);
        await writeFile(temporaryChecksum, sha1(await readFile(temporary)) + '\n');
        await rename(temporary, jar);
        await rename(temporaryChecksum, checksum);
      } finally {
        await rm(temporary, { force: true });
        await rm(temporaryChecksum, { force: true });
      }
    }
    entries = await listJar(jar);
  }
  return { entry, metadata, directory, jar, clientJar, entries, libraries, java, source, cache };
}
