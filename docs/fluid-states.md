# Fluid state data

`fluid-states.json` contains vanilla block-state inputs for fluid rendering. Its manifest key is `fluidStates`. It supplements `fluids.json`, whose block-level rules remain unchanged. Older manifests can omit this dataset.

The file contains three tables:

| Table | Contents |
| --- | --- |
| `shapes` | Shared occlusion shapes. Each shape is an array of boxes `[minX, minY, minZ, maxX, maxY, maxZ]`, in block units: one full cube is `[0, 0, 0, 1, 1, 1]`. An empty array means no occlusion. |
| `profiles` | Shared fluid and block-rendering facts, described below. |
| `blocks` | Every block ID, its ordered `properties` names, and a `states` array of profile indices. |

## Resolve a state

Property names are sorted. Their possible values come from the same version's `block-states.json`, with their original JSON types preserved. The last property varies fastest. For a block with two properties, compute the index as follows:

```js
let index = 0;
for (const name of block.properties) {
  const values = blockStates[id][name].values;
  const offset = values.indexOf(properties[name]);
  if (offset === -1) throw new Error(`Invalid property: ${name}`);
  index = index * values.length + offset;
}
const profile = fluidStates.profiles[block.states[index]];
```

Supply every property, filling absent values from `block-states.json` defaults. Blocks without properties have one index. Profile and shape indices are local to a dataset; do not persist them independently of its version and hash.

## Profile fields

| Field | Meaning |
| --- | --- |
| `fluid` | Optional contained water or lava: `kind`, `amount` (1–8), `source`, `falling`, and `height` (the native fluid's own height). Absence means no fluid. Waterlogged and other fluid-containing states are included. |
| `renderModel` | Whether the block uses the ordinary model render shape. This does not describe block-entity rendering. |
| `heightSolid` | Vanilla's solid-block predicate for fluid corner-height averaging. |
| `blocksFlow` | Whether the block prevents the flow-vector calculation from sampling fluid below an empty neighbor. This is not a general fluid-spreading or collision rule. |
| `solidRender` | Vanilla's solid-render predicate, used when deciding whether to draw the reverse side of a fluid surface. `null` requires a world-context query. |
| `waterOverlay` | Whether vanilla selects the water-overlay sprite next to this block. |
| `occlusionShape` | Index into `shapes`, with vanilla's `canOcclude` condition applied. `null` means the native shape queried world context and cannot be represented by a static entry. |

Do not substitute one flag for another. Glass, leaves, slabs, and waterlogged blocks can have different height, flow, and occlusion behavior. For 26.3, `blocksFlow` resolves the vanilla `blocks_fluid_flow` tag; earlier releases use their native material or block-state predicate.

Shapes describe effective occlusion, not collision or visible model geometry. Consumers must compare the relevant faces and fluid height; a partial shape does not hide an entire fluid face. Neighbor-dependent heights, flow vectors, and reverse-face decisions still run in the consumer. Resource-pack fluid textures, biome colors, and saved light remain separate inputs.

The dataset does not select a geometry algorithm. In particular, 1.16.5 and 1.17.1 use an older corner-height averaging rule than 1.18.2 onward. Consumers that reproduce a release's fluid geometry must select its rendering rules as well as its data.

## Validation

Extraction enumerates every registered block state and checks profile references against the property domains. Native fixtures cover water, lava, partial shapes, transparent neighbors, and waterlogged states. For sampled states, a separate JavaScript rectangle-coverage check compares the exported boxes with vanilla's fluid-face occlusion result in all six directions at four heights. Manifest validation records the state, sample, and face-check counts.

Unknown context-dependent values remain explicit. The dataset does not simulate fluid spreading, update neighboring block states, or claim that static boxes replace world queries.
