import assert from 'node:assert/strict';
import test from 'node:test';
import { proceduralAnimations1215 } from '../../extractors/entity-models/animations-1215.js';
import { blockAnimations } from '../../extractors/entity-models/procedural-blocks.js';
import { entityAnimations } from '../../extractors/entity-models/procedural-entities.js';
import { humanoidAnimations } from '../../extractors/entity-models/procedural-humanoids.js';

test('1.21.5 profiles use flat model classes and the player render state without changing shared inputs', () => {
  const requests = [...entityAnimations(['minecraft:cat', 'minecraft:tropical_fish_large', 'minecraft:tropical_fish_small']),
    ...humanoidAnimations(['minecraft:player', 'minecraft:player_slim', 'minecraft:pillager'])];
  const before = structuredClone(requests);
  const result = proceduralAnimations1215(requests);
  for (const [id, model] of [['cat', 'CatModel'], ['tropical_fish_large', 'TropicalFishModelB'],
    ['tropical_fish_small', 'TropicalFishModelA'], ['player', 'PlayerModel'], ['player_slim', 'PlayerModel']]) {
    const request = result.find(request => request.models.includes(`minecraft:${id}`));
    assert.equal(request.class, `net.minecraft.client.model.${model}`);
    if (model === 'PlayerModel') {
      assert.deepEqual(request.parameters, ['net.minecraft.client.renderer.entity.state.PlayerRenderState']);
      assert.deepEqual(request.constructor.values, [id === 'player_slim']);
    }
  }
  const illager = result.find(request => request.models.includes('minecraft:pillager'));
  assert.equal('speedValue' in illager.clips.walk_cycle.frames[0].values[0], false);
  assert.equal(illager.clips.walk_cycle.frames[0].values[0].walkAnimationSpeed, 1);
  assert.equal(illager.clips.walk_cycle.frames[0].values[0].armPose, 'NEUTRAL');
  assert.deepEqual(requests, before);
});

test('1.21.5 block profiles preserve transitions while invoking the release-specific methods', () => {
  const requests = blockAnimations(['minecraft:chest', 'minecraft:shulker_box', 'minecraft:standing_banner',
    'minecraft:dragon_skull', 'minecraft:piglin_head', 'minecraft:book', 'minecraft:bell']);
  const before = structuredClone(requests);
  const result = proceduralAnimations1215(requests);
  const find = id => result.find(request => request.models.includes(`minecraft:${id}`));
  assert.deepEqual(find('chest').parameters, ['float']);
  assert.deepEqual(find('standing_banner').parameters, ['float']);
  assert.equal(find('standing_banner').layer, 'flag');
  assert.equal(find('shulker_box').method, 'animate');
  assert.deepEqual(find('shulker_box').parameters, ['float']);
  assert.equal(find('dragon_skull').class, 'net.minecraft.client.model.dragon.DragonHeadModel');
  assert.deepEqual(find('dragon_skull').parameters, Array(3).fill('float'));
  assert.deepEqual(find('piglin_head').clips.ears.frames[1].values,
    [before.find(request => request.models.includes('minecraft:piglin_head')).clips.ears.frames[1].values[0].animationPos, 0, 0]);
  assert.deepEqual(find('book').parameters, Array(4).fill('float'));
  assert.equal(find('book').clips.open.frames.at(-1).values[3], before.find(request => request.models.includes('minecraft:book'))
    .clips.open.frames.at(-1).values[0].open);
  const bell = find('bell');
  assert.deepEqual(bell.parameters, ['net.minecraft.world.level.block.entity.BellBlockEntity', 'float']);
  const middle = bell.clips.ring_north.frames[1].values;
  assert.equal(middle[0].fields.clickDirection, 'NORTH');
  assert.equal(middle[0].fields.shaking, true);
  assert.equal(middle[0].fields.ticks + middle[1], requests.find(request => request.models.includes('minecraft:bell'))
    .clips.ring_north.frames[1].values[0].ticks);
  const end = bell.clips.ring_north.frames.at(-1);
  assert.equal(end.pre[0].fields.shaking, true);
  assert.equal(end.values[0].fields.shaking, false);
  assert.deepEqual(requests, before);
});

test('1.21.5 armor copies main-model poses and appearance layers retain their own baked poses', () => {
  const records = [
    { id: 'minecraft:player_slim', layers: { main: {}, inner_armor: {}, outer_armor: {} } },
    { id: 'minecraft:bogged', layers: { main: {}, inner_armor: {}, outer_armor: {}, outer: {} } },
    { id: 'minecraft:cat_baby', layers: { main: {}, collar: {} } },
    { id: 'minecraft:tropical_fish_small', layers: { main: {}, pattern: {} } },
    { id: 'minecraft:creeper', layers: { main: {}, armor: {} } },
  ];
  const ids = records.map(record => record.id);
  const requests = [...entityAnimations(ids), ...humanoidAnimations(ids, records)];
  const before = structuredClone(requests);
  const result = proceduralAnimations1215(requests, records);
  for (const id of ['minecraft:player_slim', 'minecraft:bogged']) {
    for (const layer of ['inner_armor', 'outer_armor']) {
      const armor = result.find(request => request.models.includes(id) && request.layer === layer);
      assert.deepEqual(armor.copyPose, {
        sourceLayer: 'main', targetClass: 'net.minecraft.client.model.HumanoidModel', method: 'copyPropertiesTo',
      });
      assert.deepEqual(Object.keys(armor.clips), [`walk_cycle_${layer}`]);
      if (id === 'minecraft:player_slim') assert.deepEqual(armor.constructor.values, [true]);
      else assert.equal(armor.class, 'net.minecraft.client.model.BoggedModel');
    }
  }
  assert.equal(result.filter(request => request.models.includes('minecraft:bogged') && request.layer === 'outer').length, 1);
  for (const [id, layer] of [['cat_baby', 'collar'], ['tropical_fish_small', 'pattern'], ['creeper', 'armor']]) {
    const overlay = result.find(request => request.models.includes(`minecraft:${id}`) && request.layer === layer);
    assert.ok(overlay);
    assert.equal(overlay.copyPose, undefined);
    assert.ok(Object.keys(overlay.clips).every(name => name.endsWith(`_${layer}`)));
  }
  assert.deepEqual(requests, before);
});
