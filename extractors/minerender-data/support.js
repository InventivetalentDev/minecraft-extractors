export const SUPPORTED_VERSIONS = Object.freeze([
  '1.16.5', '1.17.1', '1.18.2', '1.19.4', '1.20.1', '1.20.6',
  '1.21.5', '1.21.11', '26.1.2', '26.2', '26.3'
]);

export function registryCompatibility(version) {
  assertSupportedVersion(version);
  return {
    legacyPotionColors: ['1.16.5', '1.17.1', '1.18.2', '1.19.4', '1.20.1'].includes(version),
    durabilityBars: version !== '1.16.5'
  };
}

export function assertSupportedVersion(version) {
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error(`minerender-data does not support Minecraft ${version}. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}. Use tools/extract.js --dataset entity-models for entity-only extraction.`);
  }
}
