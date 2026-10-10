# minecraft-extractors

Extraction tools for [minecraft-entity-models](https://github.com/InventivetalentDev/minecraft-entity-models) and [minerender-data](https://github.com/InventivetalentDev/minerender-data). This repository owns their Java extractors, version adapters, reviewed source mappings, tests, and publication commands. The two data repositories retain their version branches and published file layouts.

## Extract

Use Node.js 22.12+ and a JDK: Java 17+ for older entity versions, Java 21+ for 1.21.5/1.21.11, or Java 25+ for 26.1.2. Set `JAVA_HOME` to select a JDK. No Node dependencies need installing.

```sh
node --test
node tools/extract.js --version 1.21.11 --output out/1.21.11
```

The output directory must not exist. The command prepares the client, mappings, libraries, and JAR index once, then extracts both datasets into `out/1.21.11/entity-models/` and `out/1.21.11/minerender-data/`. Output becomes available only after every selected dataset passes validation. Select one dataset with `--dataset entity-models` or `--dataset minerender-data`; its output still uses the named subdirectory.

Downloads and remapped clients are hash-checked and cached in `.cache/minecraft-extractors`. Use `--cache DIR` to reuse a cache, including one from either predecessor repository. `--offline` requires the cached client, remapped JAR when applicable, dependencies, and texture checks. To check reproducibility, repeat extraction to another output directory with `--offline`, then compare the directories.

Version support belongs to each extractor. Registry extraction supports 1.21.5 and 1.21.11; selecting it for another version fails before runtime preparation. Use `--dataset entity-models` for other entity versions. Entity extraction retains the reviewed 1.17.1, 1.20.1, 1.21.11, and 26.1.2 adapters, native extraction for other compatible releases, and the separate 1.16.5 conversion path. An unavailable adapter or incompatible game API must not be replaced by another version's output. Entity procedural profiles and registry preview/legacy rules remain explicitly reviewed per version.

For Minecraft 1.16.5, supply the original [entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/08a79ec11ab236884f78906a3b593b402e987667/packages/minerender/src/entity/entityModels.json) and [block-entity dump](https://raw.githubusercontent.com/InventivetalentDev/MineRender/08a79ec11ab236884f78906a3b593b402e987667/packages/minerender/src/entity/blockEntityModels.json) to the converter. It augments the dumps using the pinned Yarn runtime:

```sh
node tools/extract.js --version 1.16.5 --dataset entity-models \
  --entity-dump entityModels.json --block-entity-dump blockEntityModels.json \
  --output out/1.16.5
```

`--legacy-cache DIR` selects an existing Yarn tool cache. The direct converter remains available at `extractors/entity-models/convert-legacy.js`. `--fixtures FILE` retains native registry validation samples outside the output directory, for example `--fixtures out/fixtures-1.21.11.json`.

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

The CLI also runs under a VPS scheduler. `node tools/versions.js --repository ../minerender-data --after 2026-10-10` lists up to ten unpublished releases after an explicit cutoff. It only lists versions; it does not extract or publish. `--version VERSION` resolves one exact version and its required Java version. No schedule is configured in this repository.

## Manual GitHub execution

The **Extract Minecraft datasets** workflow uses a standard GitHub-hosted Ubuntu runner and accepts a version, dataset selection, and an optional publishing flag. It runs tests, extracts twice, and compares every output byte. Its default is extraction and validation only; validated output is available as a downloadable artifact for three days. The workflow supports modern extraction; use the CLI for 1.16.5 with the original dumps.

Publishing is allowed only from `main`. Configure a GitHub App installed on the two data repositories with **Contents: read and write**, then set the repository variable `DATA_APP_CLIENT_ID` and secret `DATA_APP_PRIVATE_KEY`. The workflow creates a short-lived token restricted to those repositories after successful validation. No publishing credentials are needed for extraction-only runs. Pull requests do not trigger this workflow.

## Source layout

- `lib/`: shared downloads, runtime preparation, dataset selection, and extractor identity.
- `extractors/entity-models/`: entity and block-entity geometry, render passes, textures, animation profiles, and legacy conversion.
- `extractors/minerender-data/`: registry extraction, native behavioral checks, and reviewed source mappings under `sources/`.
- `tools/`: combined extraction, validation, version lookup, and publication entry points.
- `test/`: migrated dataset tests and shared runtime/publication coverage.
