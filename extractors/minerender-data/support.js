const SUPPORTED_VERSIONS = ['1.21.5', '1.21.11'];

export function assertSupportedVersion(version) {
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error(`minerender-data does not support Minecraft ${version}. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}. Use tools/extract.js --dataset entity-models for entity-only extraction.`);
  }
}
