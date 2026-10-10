import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildRules, UnsupportedRulesVersionError } from '../../extractors/minerender-data/rules.js';

async function blockStates() {
  const source = JSON.parse(await readFile(new URL('../../extractors/minerender-data/sources/legacy-blocks.json', import.meta.url)));
  const states = {};
  for (const state of Object.values(source.blocks)) {
    const [, id, fields] = /^([^\[]+)(?:\[([^\]]+)\])?$/.exec(state);
    const properties = states[id] ??= {};
    for (const field of fields?.split(',') ?? []) {
      const [name, raw] = field.split('=');
      const value = /^(?:true|false|\d+)$/.test(raw) ? JSON.parse(raw) : raw;
      const property = properties[name] ??= { values: [] };
      if (!property.values.includes(value)) property.values.push(value);
    }
  }
  for (const id of ['minecraft:cobblestone_wall', 'minecraft:mossy_cobblestone_wall']) {
    for (const side of ['east', 'south', 'north', 'west']) states[id][side].values = ['none', 'low', 'tall'];
  }
  return states;
}

test('unreviewed versions do not inherit preview or legacy rules', async () => {
  await assert.rejects(buildRules('1.21.6', {}), error =>
    error instanceof UnsupportedRulesVersionError && error.version === '1.21.6');
});

test('tint formulas reject changed property ranges', async () => {
  await assert.rejects(buildRules('1.21.11', {
    'minecraft:redstone_wire': { power: { values: [0, 1] } }
  }), /redstone_wire requires power values/);
  await assert.rejects(buildRules('1.21.5', {
    'minecraft:melon_stem': { age: { values: [0, 1] } }
  }), /melon_stem requires age values/);
});

test('legacy mappings reject missing target blocks', async () => {
  await assert.rejects(buildRules('1.21.11', {}), /0:0 refers to an unknown block: minecraft:air/);
});

test('reviewed releases select their block names and preserve cauldron levels', async () => {
  for (const [version, grass, splitCauldron, count] of [
    ['1.16.5', 'grass', false, 7],
    ['1.17.1', 'grass', true, 3],
    ['1.18.2', 'grass', true, 3],
    ['1.19.4', 'grass', true, 3],
    ['1.20.1', 'grass', true, 3],
    ['1.20.6', 'short_grass', true, 2],
    ['1.21.5', 'short_grass', true, 2],
    ['1.21.11', 'short_grass', true, 2],
    ['26.1.2', 'short_grass', true, 2],
    ['26.2', 'short_grass', true, 2],
    ['26.3', 'short_grass', true, 2]
  ]) {
    const states = await blockStates();
    if (grass === 'grass') {
      states['minecraft:grass'] = states['minecraft:short_grass'];
      delete states['minecraft:short_grass'];
    }
    if (!splitCauldron) {
      states['minecraft:grass_path'] = states['minecraft:dirt_path'];
      delete states['minecraft:dirt_path'];
      states['minecraft:cauldron'] = { level: { values: [0, 1, 2, 3] } };
      delete states['minecraft:water_cauldron'];
    }
    const rules = await buildRules(version, states), blocks = rules.legacyBlocks.blocks;
    assert.equal(blocks['31:1'], `minecraft:${grass}`, version);
    assert.equal(blocks['208:0'], splitCauldron ? 'minecraft:dirt_path' : 'minecraft:grass_path', version);
    assert.equal(blocks['118:0'], 'minecraft:cauldron', version);
    for (const level of [1, 2, 3]) {
      assert.equal(blocks[`118:${level}`], `minecraft:${splitCauldron ? 'water_cauldron' : 'cauldron'}[level=${level}]`, version);
    }
    assert.equal(Object.keys(rules.provenance.legacyBlocks.corrections).length, count, version);
    assert.equal(Object.hasOwn(rules.blockTints, 'minecraft:cauldron'), !splitCauldron, version);
    assert.equal(Object.hasOwn(rules.provenance.blockTints, 'aliases'), !splitCauldron, version);
    if (!splitCauldron) {
      assert.deepEqual(rules.blockTints['minecraft:cauldron'], { source: 'constant', color: 4159204 });
      assert.equal(rules.provenance.blockTints.aliases['minecraft:cauldron'].from, 'minecraft:water_cauldron');
    }
  }
});

test('the 1.16.5 cauldron tint requires its reviewed level range', async () => {
  await assert.rejects(buildRules('1.16.5', {
    'minecraft:cauldron': { level: { values: [1, 2, 3] } }
  }), /cauldron requires level values 0, 1, 2, 3/);
});
