# minecraft-extractors

Extraction tools for [minecraft-entity-models](https://github.com/InventivetalentDev/minecraft-entity-models) and [minerender-data](https://github.com/InventivetalentDev/minerender-data). This repository owns their Java extractors, version adapters, reviewed source mappings, tests, and publication commands. The two data repositories retain their version branches and published file layouts.

## Extract

Use Node.js 22.12+ and a JDK: Java 17+ through 1.20.1, Java 21+ for 1.20.6 and 1.21 releases, or Java 25+ for 26 releases. Set `JAVA_HOME` to select a JDK. No Node dependencies need installing.

```sh
node --test
node tools/extract.js --version 1.21.11 --output out/1.21.11
```

The output directory must not exist. The command prepares the client, mappings, libraries, and JAR index once, then extracts both datasets into `out/1.21.11/entity-models/` and `out/1.21.11/minerender-data/`. Output becomes available only after every selected dataset passes validation. Select one dataset with `--dataset entity-models` or `--dataset minerender-data`; its output still uses the named subdirectory.

Downloads and remapped clients are hash-checked and cached in `.cache/minecraft-extractors`. Use `--cache DIR` to reuse a cache, including one from either predecessor repository. `--offline` requires the cached client, remapped JAR when applicable, dependencies, and texture checks. To check reproducibility, repeat extraction to another output directory with `--offline`, then compare the directories.

Version support belongs to each extractor. Registry extraction supports **1.16.5, 1.17.1, 1.18.2, 1.19.4, 1.20.1, 1.20.6, 1.21.5, 1.21.11, 26.1.2, 26.2, and 26.3**; selecting it for another version fails before runtime preparation. These releases include reviewed block-preview rules and legacy block mappings. Older item APIs are normalized into the same component-keyed item defaults as modern releases.

`item-defaults.json` describes per-item defaults. Items whose only default is a `minecraft:max_stack_size` of 64 are omitted; consumers treat a missing item as that default. Before data components, `minecraft:enchantment_glint_override` is emitted only when the item's default stack has glint. A missing override does not mean every stack of that item lacks glint. In 1.16.5, 1.17.1, and 1.18.2, potions, splash potions, and lingering potions with effects have glint even though their default stacks do not. Consumers must evaluate that stack-dependent rule separately; Minecraft removed it in 1.19.4.

`item-properties.json` adds `{ schemaVersion: 1, componentFormat, items }` without changing the sparse defaults. Each item has a native text-JSON `name`, `rarity`, `equipmentSlot`, and `attributeModifiers` (`attribute`, `slot`, `id`, `amount`, `operation`). Slots are explicit equipment slots; modifier IDs retain native UUIDs or namespaced IDs. The equipment slot is the native legacy choice or modern equippable slot, with `mainhand` as the fallback; it does not describe which entities can equip the item. On 1.20.6 and later, `componentFormat: "native"` adds `components` with all persistent registry defaults serialized by that release's codecs, including original attribute slot groups. Earlier releases use `componentFormat: "legacy"` and omit `components`. Names and rarity describe the default stack, not custom stack data.

`block-tints.json` retains preview colors and can include `biome` with `grass`, `foliage`, `dry_foliage`, or `water`. Consumers use that biome color when world context is available. Without it, they use the preview rule; grass preview rules also select biome grass colors.

`fluid-states.json` adds per-state fluid contents, occlusion shapes, and separate height, flow, and overlay rules. Repeated shapes and profiles share indices. The existing `fluids.json` remains unchanged. See the [data format and native validation](docs/fluid-states.md). `waterOverlay` mirrors reviewed renderer code; its sprite-selection rule has no independent runtime check.

`block-appearance.json` supplies sparse position-offset rules in block units and a versioned `renderLayers` policy. Omitted offsets are zero; `minecraft-position-v1` uses vanilla's signed position hash with y=0, float-rounded 4-bit fractions, horizontal clamping, and downward vertical offsets. Extraction checks every state at six coordinates, including negative positions and the world border. Before 26.1, `source: "block"` provides fixed layer overrides as a string, or a `solidLeaves`/`cutoutLeaves` object when leaf modes differ; omitted blocks use `solid`. From 26.1, `source: "sprite"` maps opaque, cutout, and translucent material transparency to layers; consumers must evaluate the active resource pack's materials instead of assigning a fixed layer to each block. These layers apply to terrain rendered from block models. Water and lava surfaces use separate fluid-layer selection, so their omitted block entries do not mean their fluid layer is solid. Item render types are also separate.

`block-lighting.json` provides per-state ambient-occlusion brightness (`shadeBrightness`, 0–1), emitted and blocked light (`lightEmission` and `lightBlock`, 0–15), and the `propagatesSkylightDown`, `useShapeForLightOcclusion`, `emissiveRendering`, and `lightPermeable` predicates. Before 26.3, `lightPermeable` mirrors reviewed ambient-occlusion renderer code without an independent runtime check; from 26.3, it calls the native predicate. World-dependent values are `null`; they are not sampled defaults. The `profiles` and `blocks` tables use the same property order and state indexing as `fluid-states.json`. These are renderer inputs; saved light and final vertex brightness still require world data and consumer algorithms. Validation checks field types and complete state indexing. Older manifests can omit this dataset.

`legacy-biomes.json` maps historical numeric IDs from chunk `Biomes` arrays to names in the target Minecraft version. `source` identifies the runtime's explicit ID mapping in 1.16.5/1.17.1 or the later `ChunkHeightAndBiomeFix` conversion table. From 1.18, native biome data fixes migrate that table's names from schema 2832 to the manifest's `dataVersion`; every result must exist in the target biome registry. Numeric IDs remain historical, not current registry indices. For example, ID 3 resolves to `mountains` in 1.17.1 and `windswept_hills` in 1.18.2. Unknown or modded IDs remain absent, including IDs that vanilla silently replaces with plains.

`block-culling.json` stores shared `skipRendering` rule profiles and indices only for blocks with a rule; omitted blocks do not skip faces. Leaf membership comes from the leaf rule, and a bar group is included only in versions that use it. Rules use both states, direction, and the caller's `cutoutLeaves` setting; fluid comparisons reuse `fluid-states.json`. A false result still needs shape occlusion and model `cullface` checks. Extraction validates native state pairs in all six directions and both leaf modes, and rejects unreviewed method overrides. Fixtures retain shared states and a 12-bit result mask per pair.

Entity extraction retains the reviewed 1.17.1, 1.20.1, 1.21.11, and 26.1.2 adapters, native extraction for other compatible releases, and the separate 1.16.5 conversion path. A successful native-only run does not include unreviewed procedural animations or block-model variants. Extraction always uses the requested version's runtime; it does not substitute another version's output.

For Minecraft 1.16.5 registry data, use `--dataset minerender-data`. Entity extraction requires the original [entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/08a79ec11ab236884f78906a3b593b402e987667/packages/minerender/src/entity/entityModels.json) and [block-entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/08a79ec11ab236884f78906a3b593b402e987667/packages/minerender/src/entity/blockEntityModels.json). The converter augments them using the pinned Yarn runtime:

```sh
node tools/extract.js --version 1.16.5 --dataset entity-models \
  --entity-dump entityModels.json --block-entity-dump blockEntityModels.json \
  --output out/1.16.5
```

`--legacy-cache DIR` selects an existing Yarn tool cache. The direct converter remains available at `extractors/entity-models/convert-legacy.js`. `--fixtures FILE` retains native registry validation samples outside the output directory, for example `--fixtures out/fixtures-1.21.11.json`.

Registry validation checks item defaults and potion colors against each release's native APIs. Minecraft 1.16.5 does not expose native durability-bar methods; its manifest lists that check under `validation.unavailableChecks`. Its item stack, damage, and potion checks still run.

## Validate and publish

Dataset formats are documented in [minecraft-entity-models](https://github.com/InventivetalentDev/minecraft-entity-models#readme) and [minerender-data](https://github.com/InventivetalentDev/minerender-data#readme). Registry manifests identify this tooling repository, its Git revision, and a content hash. Entity files retain their existing schema, including the local-only texture report.

Commit tooling before extracting publishable registry data. Clone each destination repository separately and pass its checkout explicitly:

```sh
node tools/validate.js --dataset minerender-data --version 1.21.11 --input out/1.21.11/minerender-data
node tools/publish.js --dataset minerender-data --version 1.21.11 \
  --input out/1.21.11/minerender-data --repository ../minerender-data
node tools/publish.js --dataset entity-models --version 1.21.11 \
  --input out/1.21.11/entity-models --repository ../minecraft-entity-models
```

Publication validates the files and prepares a data-only version branch in a temporary worktree of the destination repository. It preserves that branch's history and excludes entity texture reports. Pass `--push` to fetch and push the version branch; divergent local and remote branches require reconciliation. Publishing into the tooling repository is rejected. Publishing the two datasets is separate, so a failed push to one destination does not roll back the other.

After the CDN purge endpoint is deployed, set `DATASET_PURGE_TOKEN` in the publishing environment to refresh the CDN after pushing `minerender-data`. The publisher purges the version and aliases, then checks the manifest bytes, every dataset's hash and size, and the version index. It retries stale data for up to ten minutes. A failed refresh fails the command but leaves the version branch published; rerun the same command to retry. Without the token, publication relies on the CDN's cache expiry. Entity publication and local preparation do not call the CDN.

The CLI also runs under a VPS scheduler. `node tools/versions.js --repository ../minerender-data --after 2026-10-10` lists up to ten unpublished releases after an explicit cutoff. It only lists versions; it does not extract or publish. `--version VERSION` resolves one exact version and its required Java version. No schedule is configured in this repository.

## Manual GitHub execution

The **Extract Minecraft datasets** workflow uses a standard GitHub-hosted Ubuntu runner and accepts a version, dataset selection, and an optional publishing flag. It runs tests, then extracts and validates each selected dataset once. Enable `verify-reproducibility` to extract again offline and compare every output byte; this option is off by default. Publishing is also off by default, and validated output is available as a downloadable artifact for three days. For 1.16.5, select `minerender-data`; entity extraction requires the CLI and original dumps.

Publishing is allowed only from `main`. Configure a GitHub App installed on the two data repositories with **Contents: read and write**, then set the repository variable `DATA_APP_CLIENT_ID` and secret `DATA_APP_PRIVATE_KEY`. The workflow creates a short-lived token restricted to those repositories after successful validation. No publishing credentials are needed for extraction-only runs. Pull requests do not trigger this workflow.

For CDN refreshes, add the optional repository secret `DATASET_PURGE_TOKEN` with the token configured on the CDN's `/minerender-data/purge` endpoint.

## Source layout

- `lib/`: shared downloads, runtime preparation, dataset selection, and extractor identity.
- `extractors/entity-models/`: entity and block-entity geometry, render passes, textures, animation profiles, and legacy conversion.
- `extractors/minerender-data/`: registry extraction, native behavioral checks, and reviewed source mappings under `sources/`.
- `tools/`: combined extraction, validation, version lookup, and publication entry points.
- `test/`: migrated dataset tests and shared runtime/publication coverage.
