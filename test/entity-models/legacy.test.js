import assert from 'node:assert/strict';
import test from 'node:test';
import { convertModel } from '../../extractors/entity-models/legacy-extract.js';
import { validateModel } from '../../extractors/entity-models/lib.js';
import { applyLegacyPasses } from '../../extractors/entity-models/legacy-passes.js';
import { legacyAnimationRequests } from '../../extractors/entity-models/legacy-animations.js';

test('legacy armor copies its body controller and lectern books remain static', () => {
  const ids = ['piglin', 'piglin_brute', 'zombified_piglin', 'zombie', 'zombie_villager', 'skeleton', 'player', 'player_slim'];
  const inventory = new Proxy({}, { get: (_, id) => ({ main: ['BodyModel'],
    ...(ids.some(name => id === `minecraft:${name}`) ? { inner_armor: ['ArmorModel'], outer_armor: ['ArmorModel'] } : {}),
  }) });
  const requests = legacyAnimationRequests(inventory);
  assert.ok(!requests.some(request => request.model === 'minecraft:lectern'));
  assert.ok(requests.some(request => request.model === 'minecraft:enchanting_table' && request.clips.idle));
  for (const id of ['guardian', 'elder_guardian']) {
    const request = requests.find(request => request.model === `minecraft:${id}`);
    assert.ok(request);
    assert.equal(request.layer, undefined);
  }
  for (const id of ids) {
    const main = requests.find(request => request.model === `minecraft:${id}` && !request.layer);
    for (const layer of ['inner_armor', 'outer_armor']) {
      const armor = requests.find(request => request.model === `minecraft:${id}` && request.layer === layer);
      assert.deepEqual(armor.copyPose, { sourceLayer: 'main',
        targetClass: 'net.minecraft.client.render.entity.model.BipedEntityModel', method: 'setAttributes' });
      assert.equal(armor.entityClass, main.entityClass);
      assert.deepEqual(armor.clips, Object.fromEntries(Object.entries(main.clips).map(([name, clip]) => [`${name}_${layer}`, clip])));
    }
  }
});

test('converts runtime trident parts with a mirrored child to one main layer', () => {
  const part = {
    textureWidth: 32,
    textureHeight: 32,
    textureOffsetU: 0,
    textureOffsetV: 6,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    mirror: false,
    cubes: [{ minX: -0.5, minY: 2, minZ: -0.5, maxX: 0.5, maxY: 27, maxZ: 0.5 }],
    children: [],
  };
  part.children.push({
    ...part,
    textureOffsetU: 4,
    textureOffsetV: 3,
    pivotX: 1,
    pivotY: 2,
    pivotZ: 3,
    pitch: 0.25,
    yaw: -0.5,
    roll: 1,
    mirror: true,
    cubes: [{ minX: 1.5, minY: -3, minZ: -0.5, maxX: 2.5, maxY: 1, maxZ: 0.5 }],
    children: [],
  });
  const model = convertModel('minecraft:trident', { trident: part });
  assert.equal(model.id, 'minecraft:trident');
  assert.deepEqual(Object.keys(model.layers), ['main']);
  assert.deepEqual(model.layers.main.texture, [32, 32]);
  assert.deepEqual(model.layers.main.root.pose, { offset: [0, 0, 0], rotation: [0, 0, 0] });
  const converted = model.layers.main.root.children.trident;
  assert.deepEqual(converted.cubes, [{ origin: [-0.5, 2, -0.5], size: [1, 25, 1], uv: [0, 6] }]);
  assert.deepEqual(converted.children['0'], {
    pose: { offset: [1, 2, 3], rotation: [0.25, -0.5, 1] },
    cubes: [{ origin: [1.5, -3, -0.5], size: [1, 4, 1], uv: [4, 3], mirror: true }],
    children: {},
  });
});

test('inherits and resets a legacy part texture override through its children', () => {
  const part = {
    textureWidth: 16,
    textureHeight: 16,
    textureOffsetU: 0,
    textureOffsetV: 0,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }],
    children: [],
  };
  const model = convertModel('minecraft:conduit', {
    shell: { ...part, textureWidth: 64, textureHeight: 32 },
    eye: {
      ...part,
      children: [
        { ...part, children: [] },
        {
          ...part,
          textureWidth: 64,
          textureHeight: 32,
          children: [{ ...part, textureWidth: 64, textureHeight: 32, children: [] }],
        },
      ],
    },
  });
  assert.deepEqual(model.layers.main.texture, [64, 32]);
  assert.equal(Object.hasOwn(model.layers.main.root.children.shell, 'texture'), false);
  assert.deepEqual(model.layers.main.root.children.eye.texture, [16, 16]);
  assert.equal(Object.hasOwn(model.layers.main.root.children.eye.children['0'], 'texture'), false);
  const reset = model.layers.main.root.children.eye.children['1'];
  assert.deepEqual(reset.texture, [64, 32]);
  assert.equal(Object.hasOwn(reset.children['0'], 'texture'), false);
  assert.equal(convertModel('minecraft:beacon', {}), null);
});


test('keeps a field-named runtime child once under its parent', () => {
  const part = {
    textureWidth: 16, textureHeight: 16, textureOffsetU: 0, textureOffsetV: 0,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }], children: [],
  };
  const jaw = { ...part, name: 'jaw', pivotY: 4 };
  const model = convertModel('example:skull', { head: { ...part, children: [jaw] } });
  assert.deepEqual(Object.keys(model.layers), ['main']);
  assert.deepEqual(Object.keys(model.layers.main.root.children), ['head']);
  const head = model.layers.main.root.children.head;
  assert.deepEqual(Object.keys(head.children), ['jaw']);
  assert.deepEqual(head.children.jaw.pose.offset, [0, 4, 0]);
  assert.deepEqual(head.children.jaw.children, {});
});

test('uses per-cube UV, dilation and mirror from runtime parts', () => {
  const part = {
    textureWidth: 64, textureHeight: 32, textureOffsetU: 20, textureOffsetV: 25,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: true,
    cubes: [
      { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 3, maxZ: 4, uv: [3, 5], grow: [1, 2, 3], mirror: false },
      { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 3, maxZ: 4, uv: [20, 25], grow: [0, 0, 0], mirror: true },
    ], children: [],
  };
  const cubes = convertModel('example:armor', { body: part }).layers.main.root.children.body.cubes;
  assert.deepEqual(cubes[0], { origin: [0, 0, 0], size: [2, 3, 4], uv: [3, 5], grow: [1, 2, 3] });
  assert.deepEqual(cubes[1], { origin: [0, 0, 0], size: [2, 3, 4], uv: [20, 25], mirror: true });
});


test('preserves runtime models with non-main layers through legacy pass assignment', async () => {
  const part = {
    textureWidth: 16, textureHeight: 16, textureOffsetU: 0, textureOffsetV: 0,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0, mirror: false,
    cubes: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }], children: [],
  };
  for (const [id, layer] of [
    ['conduit', 'shell'], ['chest', 'single'], ['sheep', 'fur'],
  ]) {
    const record = convertModel(`minecraft:${id}`, { body: part });
    record.layers = { [layer]: record.layers.main };
    const records = [record];
    assert.deepEqual(Object.keys(records[0].layers), [layer]);
    const geometry = structuredClone(records[0].layers[layer].root);
    await applyLegacyPasses(records);
    assert.deepEqual(Object.keys(records[0].layers), [layer]);
    assert.deepEqual(records[0].layers[layer].root, geometry);
    assert.doesNotThrow(() => validateModel({ ...records[0], transform: [] }));
    if (id === 'sheep') assert.deepEqual(records[0].passes, [{ layer: 'fur', when: 'not_sheared', tint: 'wool_color' }]);
    else assert.equal(records[0].passes, undefined);
    if (id === 'conduit' && layer === 'shell') assert.equal(records[0].layers.shell.render, 'solid');
    if (id === 'chest') assert.equal(records[0].layers.single.render, 'cutout_cull');
  }
  const mainOnly = convertModel('minecraft:sheep', { body: part });
  await assert.rejects(applyLegacyPasses([mainOnly]), /minecraft:sheep: missing feature layer fur/);
});
