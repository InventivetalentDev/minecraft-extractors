import { remapClips } from './procedural-sampling.js';

const MODEL = 'net.minecraft.client.model.';
const STATE = 'net.minecraft.client.renderer.entity.state.';

export function proceduralAnimations1215(requests, records = []) {
  const result = requests.map(request => {
    const name = request.class.slice(request.class.lastIndexOf('.') + 1);
    const model = { TropicalFishLargeModel: 'TropicalFishModelB', TropicalFishSmallModel: 'TropicalFishModelA',
      DragonHeadModel: 'dragon.DragonHeadModel' }[name] ?? name;
    const result = { ...request,
      class: request.class.startsWith(MODEL) ? MODEL + model : request.class,
      parameters: request.parameters.map(type => type === STATE + 'AvatarRenderState' ? STATE + 'PlayerRenderState' : type),
    };
    switch (name) {
      case 'IllagerModel':
        result.clips = remapClips(request.clips, ([{ speedValue, ...state }]) => [state]);
        break;
      case 'ChestModel':
      case 'BannerFlagModel':
        result.parameters = ['float'];
        break;
      case 'ShulkerBoxRenderer$ShulkerBoxModel':
        result.method = 'animate';
        result.parameters = ['float'];
        break;
      case 'BookModel':
        result.parameters = Array(4).fill('float');
        result.clips = remapClips(request.clips, ([state]) => [state.animationPos, state.pageFlip1, state.pageFlip2, state.open]);
        break;
      case 'DragonHeadModel':
      case 'PiglinHeadModel':
        result.parameters = Array(3).fill('float');
        result.clips = remapClips(request.clips, ([state]) => [state.animationPos, state.yRot, state.xRot]);
        break;
      case 'BellModel':
        result.parameters = ['net.minecraft.world.level.block.entity.BellBlockEntity', 'float'];
        result.clips = remapClips(request.clips, ([state]) => [{
          $entity: result.parameters[0], getters: {}, fields: {
            ticks: Math.floor(state.ticks), shaking: state.shakeDirection !== null, clickDirection: state.shakeDirection,
          },
        }, state.ticks % 1]);
        break;
    }
    return result;
  });
  const layers = new Map(records.map(record => [record.id, record.layers]));
  for (const request of [...result]) {
    if (request.layer) continue;
    const overlay = { CatModel: 'collar', CreeperModel: 'armor', TropicalFishModelA: 'pattern',
      TropicalFishModelB: 'pattern' }[request.class.slice(MODEL.length)];
    for (const layer of [overlay, 'inner_armor', 'outer_armor'].filter(Boolean)) {
      const models = request.models.filter(id => layers.get(id)?.[layer]);
      if (!models.length) continue;
      result.push({ ...request, models, layer,
        ...(layer.endsWith('_armor') ? {
          copyPose: { sourceLayer: 'main', targetClass: MODEL + 'HumanoidModel', method: 'copyPropertiesTo' },
        } : {}),
        clips: Object.fromEntries(Object.entries(request.clips).map(([name, animation]) => [`${name}_${layer}`, animation])),
      });
    }
  }
  return result;
}
