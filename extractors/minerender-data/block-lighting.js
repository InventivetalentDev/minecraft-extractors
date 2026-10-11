import { assert } from './lib.js';
import { validateStateProfiles } from './state-profiles.js';

const integer = value => Number.isInteger(value) && value >= 0 && value <= 15;
const boolean = value => typeof value === 'boolean';
const fields = {
  shadeBrightness: value => value === null || (Number.isFinite(value) && value >= 0 && value <= 1),
  lightEmission: integer,
  lightBlock: value => value === null || integer(value),
  propagatesSkylightDown: value => value === null || boolean(value),
  useShapeForLightOcclusion: boolean,
  emissiveRendering: value => value === null || boolean(value),
  lightPermeable: value => value === null || boolean(value)
};

export function validateBlockLighting(data, blockStates) {
  assert(data && Array.isArray(data.profiles) && data.profiles.length > 0, 'Missing block lighting profiles');
  for (const [index, profile] of data.profiles.entries()) {
    assert(profile && Object.entries(fields).every(([key, valid]) => valid(profile[key])), `Invalid block lighting profile: ${index}`);
  }
  return validateStateProfiles(data, blockStates, 'block lighting');
}
