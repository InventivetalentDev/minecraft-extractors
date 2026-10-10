import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NAMED_CLIENT_CLASSES, clientNeedsRemapping, download, exists, loadVersion, sha1 } from '../../lib/download.js';
import { allowedLibrary, downloadLibraries, prepareRuntime, run } from '../../lib/runtime.js';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minecraft-extractors-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('downloads reject corrupt bytes before caching them', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'nested', 'asset');
  const bytes = Buffer.from('verified asset');
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  await assert.rejects(download('https://example.test/asset', file, '0'.repeat(40)), /SHA-1 mismatch/);
  assert.equal(await exists(file), false);
  await download('https://example.test/asset', file, sha1(bytes));
  assert.deepEqual(await readFile(file), bytes);
});

test('offline cache reads verify hashes and never request missing files', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'asset');
  const bytes = Buffer.from('cached asset');
  await writeFile(file, bytes);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  assert.deepEqual(await download('https://example.test/asset', file, sha1(bytes), true), bytes);
  await assert.rejects(download('https://example.test/asset', file, '0'.repeat(40), true), /SHA-1 mismatch/);
  await assert.rejects(download('https://example.test/missing', path.join(directory, 'missing'), sha1(bytes), true), /Offline cache miss/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('cached metadata must match its requested version and manifest hash', async t => {
  const cache = await temporary(t);
  const version = '1.21.5';
  const metadata = Buffer.from(JSON.stringify({ id: version }));
  const entry = { id: version, sha1: sha1(metadata), url: 'https://example.test/version.json' };
  await mkdir(path.join(cache, version));
  await writeFile(path.join(cache, 'manifest.json'), JSON.stringify({ versions: [entry] }));
  const metadataFile = path.join(cache, version, `${entry.sha1}.json`);
  await writeFile(metadataFile, metadata);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  assert.equal((await loadVersion(version, cache, true)).metadata.id, version);
  await assert.rejects(loadVersion('1.21.11', cache, true), /Version not found/);
  await assert.rejects(loadVersion('latest', cache, true), /Version not found/);
  await assert.rejects(loadVersion('../1.21.5', cache, true), /Invalid Minecraft version/);
  await writeFile(metadataFile, JSON.stringify({ id: '1.21.11' }));
  await assert.rejects(loadVersion(version, cache, true), /SHA-1 mismatch/);
  const mismatched = Buffer.from(JSON.stringify({ id: '1.21.11' }));
  entry.sha1 = sha1(mismatched);
  await writeFile(path.join(cache, 'manifest.json'), JSON.stringify({ versions: [entry] }));
  await writeFile(path.join(cache, version, `${entry.sha1}.json`), mismatched);
  await assert.rejects(loadVersion(version, cache, true), /Version metadata mismatch/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('library rules apply in order for this platform', () => {
  const name = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  assert.equal(allowedLibrary({}), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { name: 'unmatched-os' } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow' }, { action: 'disallow', os: { name } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'disallow' }, { action: 'allow', os: { name } }] }), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { arch: 'unmatched-architecture' } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', features: { is_demo_user: true } }] }), false);
  assert.equal(allowedLibrary({ rules: [] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { version: '.+' } }] }), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { version: '^$' } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow' }, { action: 'disallow', os: { version: '^$' } }] }), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow' }, { action: 'disallow', os: { version: '.+' } }] }), false);
});

test('process failures retain the exit status and diagnostic output', async t => {
  assert.equal(await run(process.execPath, ['-e', 'process.stdout.write("done")']), 'done');
  await assert.rejects(run(process.execPath, ['-e', 'process.stderr.write("broken input"); process.exit(2)']), /exited with code 2: broken input/);
  await assert.rejects(run(path.join(await temporary(t), 'missing'), []), /Cannot run/);
});

test('clients without mappings require the named extraction classes', () => {
  assert.equal(clientNeedsRemapping({ downloads: { client_mappings: { sha1: 'mapped' } } }), true);
  const metadata = { downloads: { client: { sha1: 'named' } } };
  assert.equal(clientNeedsRemapping(metadata, NAMED_CLIENT_CLASSES), false);
  assert.throws(() => clientNeedsRemapping(metadata), /Client has no mappings and is missing named classes/);
  assert.throws(() => clientNeedsRemapping(metadata, NAMED_CLIENT_CLASSES.slice(0, -1)), /ModelLayers.class/);
});

test('library downloads share verified artifacts and reject missing hashes', async t => {
  const cache = await temporary(t);
  const bytes = Buffer.from('library');
  const artifact = { sha1: sha1(bytes), url: 'https://example.test/library.jar' };
  const libraries = [{ downloads: { artifact } }, { downloads: { artifact } },
    { rules: [{ action: 'disallow' }], downloads: { artifact: { sha1: 'invalid' } } }];
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  const files = await downloadLibraries(libraries, cache);
  assert.deepEqual(files, [path.join(cache, 'libraries', `${artifact.sha1}.jar`)]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(await downloadLibraries(libraries, cache, true), files);
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(downloadLibraries([{ downloads: { artifact: { url: artifact.url } } }], cache), /Invalid library download/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('named clients use the declared Java version and retain a complete shared jar listing', async t => {
  const cache = await temporary(t);
  const version = '26.1';
  const directory = path.join(cache, version);
  await mkdir(directory);
  const client = Buffer.from('named client');
  const metadata = { id: version, javaVersion: { majorVersion: 25 }, libraries: [],
    downloads: { client: { sha1: sha1(client), url: 'https://example.test/client.jar' } } };
  const bytes = Buffer.from(JSON.stringify(metadata));
  const entry = { id: version, sha1: sha1(bytes), url: 'https://example.test/version.json' };
  await writeFile(path.join(cache, 'manifest.json'), JSON.stringify({ versions: [entry] }));
  await writeFile(path.join(directory, `${entry.sha1}.json`), bytes);
  const clientJar = path.join(directory, `client-${metadata.downloads.client.sha1}.jar`);
  await writeFile(clientJar, client);

  const jdk = path.join(cache, 'jdk');
  await mkdir(path.join(jdk, 'bin'), { recursive: true });
  const java = path.join(jdk, 'bin', 'java');
  const jar = path.join(jdk, 'bin', 'jar');
  const entries = [...NAMED_CLIENT_CLASSES, ...Array.from({ length: 5000 }, (_, i) => `assets/minecraft/textures/block/block_${i}.png`)];
  await writeFile(java, `#!${process.execPath}\nprocess.stdout.write('openjdk version "25"\\n');\n`);
  await writeFile(jar, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(entries.join('\n') + '\n')});\n`);
  await chmod(java, 0o755);
  await chmod(jar, 0o755);
  const previousJavaHome = process.env.JAVA_HOME;
  t.after(() => {
    if (previousJavaHome === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = previousJavaHome;
  });
  process.env.JAVA_HOME = jdk;
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  const runtime = await prepareRuntime(version, { cache, offline: true });
  assert.deepEqual(runtime, { entry, metadata, directory, jar: clientJar, clientJar, entries, libraries: [], java,
    source: { client: metadata.downloads.client }, cache });
  await writeFile(java, `#!${process.execPath}\nprocess.stdout.write('openjdk version "21"\\n');\n`);
  await assert.rejects(prepareRuntime(version, { cache, offline: true }), /Minecraft 26.1 requires Java 25\+/);
  assert.equal(fetch.mock.callCount(), 0);
});
