# Extraction opportunities

These are proposed follow-ups to fluid data, ranked by their usefulness to MineRender. They are research candidates, not implementation commitments. Extract facts from each supported runtime; retain world, position, graphics settings, and item-stack inputs in the consumer.

## 1. Block shading and light properties

Per-state shade brightness, light emission, light attenuation, light permeability, and emissive-rendering flags would support ambient occlusion and lighting after world edits. Saved light values still come from chunk NBT. Model `ambientocclusion`, `shade`, and element light fields already belong to resource-pack models.

Vanilla sources: `BlockBehaviour.BlockStateBase` and `BlockModelLighter` (older releases use `ModelBlockRenderer`). Extract all states, including lit and unlit variants. Methods that accept a world or position need context checks before their results can be treated as constants. API names and light rules vary by release. This should require less new extraction machinery than fluid shapes, but the consumer's lighting algorithm remains separate work.

## 2. Neighbor face-culling rules

Reuse the fluid dataset's occlusion shapes for ordinary blocks. Add the rules behind `BlockState.skipRendering` to hide shared faces between matching glass, panes, bars, and other transparent blocks. MineRender's `ModelCulling` only recognizes opaque full cubes; model `cullface` declarations alone cannot express these neighbor relationships.

Vanilla sources: `HalfTransparentBlock`, `IronBarsBlock`, `LeavesBlock`, and their `skipRendering` overrides. Results depend on both states and the face direction; leaves also depend on graphics settings. Prefer compact, validated rules over a table of every state pair. This needs more rule design than a simple per-state export, but can share the fluid shape representation and validation fixtures.

## 3. Block offsets and versioned render-layer policy

Extract position-offset type and bounds for plants, plus fixed block render-layer assignments where the game uses them. This would support vanilla flower placement and correct legacy glass rendering. MineRender's `SectionModels` chooses layers from atlas transparency and does not apply per-position plant offsets.

Vanilla sources: `BlockBehaviour.Properties.offsetType`, `BlockState.getOffset`, block offset bounds, and older `ItemBlockRenderTypes`. Export offset parameters and an algorithm identifier; calculate each placement from its coordinates. **From 26.1, vanilla chooses render passes from each sprite's transparency**, so a fixed per-block layer table would be wrong for those releases and their resource packs. See the [26.1 block model changes](https://feedback.minecraft.net/hc/en-us/articles/44551668333837-Minecraft-Java-Edition-26-1). Offsets are a smaller follow-up; render layers need an explicit version policy.

## 4. More item component defaults

Extend `item-defaults.json` beyond stack size, damage, and glint with codec-serialized defaults needed by concrete consumers: item names, rarity, equipment, and attribute modifiers. These would support item-derived tooltip content, equipment previews, and default-aware component selectors. MineRender's `has_component` evaluator still rejects `ignore_default` comparisons.

Vanilla sources: `Item.components`, component codecs, and `ItemStack` tooltip/name methods. Store translatable names and component values, not rendered tooltip lines: translations already come from `assets/<namespace>/lang`, and tooltips depend on stack, player, and display options. Pre-component releases need reviewed adapters; absent data must not imply a default was checked. Serialization and registry references make this comparable to, or larger than, fluid extraction across all supported releases.

## 5. Legacy biome ID mappings

A numeric biome ID-to-name mapping would let Anvil imports use saved biome colors before section biome palettes. MineRender's `AnvilParser` reads named section palettes; older chunks store numeric arrays. Reuse mcassets biome definitions and colormaps for the colors.

Vanilla sources: historical biome registries, `ChunkBiomeFix`, and `ChunkHeightAndBiomeFix`. Select mappings by the source world's version/DataVersion, not a newer registry's numeric order. Account for 256-entry column arrays and later 4-block samples; unknown or modded IDs need explicit handling. The vanilla mapping is smaller work than fluid extraction, with separate parser changes.

Entity appearance needs a consumer design before another dataset. The entity pipeline already owns geometry, passes, textures, and animation clips, while mcassets supplies variant and equipment definitions where vanilla exposes them. Saved variant selection, equipment, age, and animation state should use those inputs first; any missing renderer rules belong with the entity extractor. Recipes, tags, translations, fonts, and modern biome definitions should continue to load from mcassets.
