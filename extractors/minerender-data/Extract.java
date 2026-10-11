import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.mojang.serialization.Codec;
import com.mojang.serialization.DynamicOps;
import com.mojang.serialization.JsonOps;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.mojang.serialization.Dynamic;
import it.unimi.dsi.fastutil.ints.Int2IntFunction;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.BiConsumer;
import net.minecraft.SharedConstants;
import net.minecraft.core.Registry;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.Bootstrap;
import net.minecraft.util.datafix.DataFixers;
import net.minecraft.util.datafix.fixes.References;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.alchemy.Potion;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.HalfTransparentBlock;
import net.minecraft.world.level.block.IronBarsBlock;
import net.minecraft.world.level.block.LeavesBlock;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.material.Fluids;
import net.minecraft.world.level.material.FlowingFluid;
import net.minecraft.world.phys.shapes.VoxelShape;
import net.minecraft.world.phys.Vec3;

/** Extracts facts from the bootstrapped vanilla registries in the supplied client JAR. */
public class Extract {
    private static Registry<MobEffect> effectRegistry;
    private static Method itemComponents;
    private static Method componentGet;
    private static Class<?> componentTypes;
    private static Method nativePotionColor;
    private static boolean itemBars;
    private static Object registryLookup;

    public static void main(String[] args) throws Exception {
        if (args.length < 1 || args.length > 2) {
            throw new IllegalArgumentException("Usage: Extract <data.json> [fixtures.json]");
        }
        Method detectVersion = optionalMethod(SharedConstants.class, "tryDetectVersion");
        if (detectVersion != null) detectVersion.invoke(null);
        Bootstrap.bootStrap();
        initializeComponents();
        Object version = SharedConstants.getCurrentVersion();
        String minecraftVersion = (String) accessor(version, "name", "getName");
        Object dataVersion = accessor(version, "dataVersion", "getDataVersion", "getWorldVersion");
        int dataVersionNumber = dataVersion instanceof Integer ? (Integer) dataVersion : (Integer) accessor(dataVersion, "version", "getVersion");
        boolean fixtures = args.length == 2;
        itemBars = !minecraftVersion.equals("1.16.5");
        itemComponents = optionalMethod(Item.class, "components");
        if (itemComponents != null) {
            componentTypes = Class.forName("net.minecraft.core.component.DataComponents");
            componentGet = Class.forName("net.minecraft.core.component.DataComponentMap").getMethod("get",
                Class.forName("net.minecraft.core.component.DataComponentType"));
            nativePotionColor = Class.forName("net.minecraft.world.item.alchemy.PotionContents").getMethod("getColorOptional", Iterable.class);
        } else {
            nativePotionColor = Class.forName("net.minecraft.world.item.alchemy.PotionUtils").getMethod("getColor", Collection.class);
        }
        Registry<Item> itemRegistry = registry("ITEM");
        effectRegistry = registry("MOB_EFFECT");
        Registry<Potion> potionRegistry = registry("POTION");
        Registry<Block> blockRegistry = registry("BLOCK");

        var itemProperties = new ItemProperties();
        var items = new TreeMap<String, Object>();
        var itemFixtures = new TreeMap<String, Object>();
        for (Item item : itemRegistry) {
            String id = itemRegistry.getKey(item).toString();
            items.put(id, itemDefaults(item));
            itemProperties.add(id, item);
            if (fixtures) {
                var samples = new ArrayList<Object>();
                ItemStack clean = item.getDefaultInstance();
                for (int count : new int[] {1, 8, 16, 32, 64}) {
                    var stack = clean.copy();
                    stack.setCount(count);
                    samples.add(itemSample(stack));
                }
                if (clean.getMaxDamage() > 0) {
                    for (int damage : new int[] {clean.getMaxDamage() / 2, clean.getMaxDamage()}) {
                        var stack = clean.copy();
                        stack.setDamageValue(damage);
                        samples.add(itemSample(stack));
                    }
                }
                itemFixtures.put(id, samples);
            }
        }

        var effects = new TreeMap<String, Integer>();
        for (MobEffect effect : effectRegistry) {
            effects.put(effectRegistry.getKey(effect).toString(), effect.getColor() & 0xffffff);
        }
        var potions = new TreeMap<String, Object>();
        var potionFixtures = new TreeMap<String, Object>();
        for (Potion potion : potionRegistry) {
            String id = potionRegistry.getKey(potion).toString();
            var entries = new ArrayList<Object>();
            for (var effect : potion.getEffects()) {
                if (!effect.isVisible()) throw new IllegalStateException("Invisible built-in potion effect: " + id);
                entries.add(new TreeMap<>(Map.of("id", effectId(effect), "amplifier", effect.getAmplifier())));
            }
            potions.put(id, entries);
            if (fixtures) potionFixtures.put(id, potionColor(potion.getEffects()));
        }

        var blocks = new TreeMap<String, Object>();
        var fluids = new TreeMap<String, Object>();
        for (Block block : blockRegistry) {
            String id = blockRegistry.getKey(block).toString();
            BlockState state = block.defaultBlockState();
            var properties = new TreeMap<String, Object>();
            for (var property : state.getProperties()) properties.put(property.getName(), propertyData(state, property));
            blocks.put(id, properties);

            // Waterlogged blocks are handled by their state property, not an intrinsic fluid rule.
            if (properties.containsKey("waterlogged")) continue;
            var fluid = state.getFluidState();
            if (fluid.isEmpty()) continue;
            String kind;
            if (fluid.getType() == Fluids.WATER || fluid.getType() == Fluids.FLOWING_WATER) kind = "water";
            else if (fluid.getType() == Fluids.LAVA || fluid.getType() == Fluids.FLOWING_LAVA) kind = "lava";
            else throw new IllegalStateException("Unsupported intrinsic fluid in " + id);
            var rule = new LinkedHashMap<String, Object>();
            rule.put("kind", kind);
            if (block instanceof LiquidBlock) {
                if (!state.hasProperty(LiquidBlock.LEVEL)) throw new IllegalStateException("Missing fluid level in " + id);
                rule.put("levelProperty", LiquidBlock.LEVEL.getName());
            }
            rule.put("renderModel", state.getRenderShape() == RenderShape.MODEL);
            fluids.put(id, rule);
        }
        var fluidStates = new FluidStates(blockRegistry, fixtures);
        var appearance = new BlockAppearance(blockRegistry, fixtures);
        var blockLighting = new BlockLighting(blockRegistry, minecraftVersion);
        var legacyBiomes = new LegacyBiomes(dataVersionNumber, fixtures);
        var blockCulling = new BlockCulling(blockRegistry, fixtures);

        var dyes = new TreeMap<String, Object>();
        for (var dye : DyeColor.values()) {
            var entry = new LinkedHashMap<String, Object>();
            entry.put("id", dye.getId());
            entry.put("textureDiffuseColor", dyeColor(dye));
            entry.put("fireworkColor", dye.getFireworkColor() & 0xffffff);
            entry.put("textColor", dye.getTextColor() & 0xffffff);
            dyes.put(dye.getName(), entry);
        }
        var counts = new TreeMap<String, Integer>();
        counts.put("items", items.size());
        counts.put("effects", effects.size());
        counts.put("potions", potions.size());
        counts.put("blocks", blocks.size());
        counts.put("fluids", fluids.size());
        counts.put("fluidStates", fluidStates.stateCount);
        counts.put("blockLighting", blockLighting.stateCount);
        counts.put("blockCulling", blockCulling.blocks.size());
        counts.put("dyes", dyes.size());
        var metadata = new LinkedHashMap<String, Object>();
        metadata.put("minecraftVersion", minecraftVersion);
        metadata.put("dataVersion", dataVersionNumber);
        metadata.put("counts", counts);
        var data = new LinkedHashMap<String, Object>();
        data.put("metadata", metadata);
        data.put("itemDefaults", items);
        data.put("itemProperties", itemProperties.data());
        data.put("potionColors", new TreeMap<>(Map.of("effects", effects, "potions", potions)));
        data.put("blockStates", blocks);
        data.put("fluids", fluids);
        data.put("fluidStates", fluidStates.data());
        data.put("blockAppearance", appearance.data());
        data.put("blockLighting", blockLighting.data());
        data.put("legacyBiomes", legacyBiomes.data());
        data.put("blockCulling", blockCulling.data());
        data.put("dyes", dyes);
        write(Path.of(args[0]), data);
        if (fixtures) {
            var fixture = new LinkedHashMap<String, Object>();
            fixture.put("minecraftVersion", minecraftVersion);
            fixture.put("capabilities", Map.of("itemBars", itemBars));
            fixture.put("items", itemFixtures);
            fixture.put("itemProperties", Map.of("items", itemProperties.items.size(),
                "componentRoundTrips", itemProperties.componentRoundTrips, "persistentComponents", itemProperties.persistentComponents));
            fixture.put("potions", potionFixtures);
            fixture.put("effectMixtures", effectMixtures());
            fixture.put("fluidStates", Map.of("stateCount", fluidStates.stateCount, "samples", fluidStates.samples));
            fixture.put("blockAppearance", appearance.fixtures());
            fixture.put("legacyBiomes", legacyBiomes.samples);
            fixture.put("blockCulling", Map.of("blockCount", blocks.size(), "states", blockCulling.sampleStates, "pairs", blockCulling.samples));
            write(Path.of(args[1]), fixture);
        }
        System.out.println("Extracted Minecraft " + minecraftVersion + ": " + counts);
    }

    private static final class BlockAppearance {
        private final Map<String, Object> offsets = new TreeMap<>();
        private final Map<String, Object> layers = new TreeMap<>();
        private final List<Object> offsetSamples = new ArrayList<>();
        private final List<Object> layerSamples = new ArrayList<>();
        private int stateCount;
        private int offsetChecks;
        private int layerChecks;
        private static final int[][] POSITIONS = {{0, 0, 0}, {1, 7, 2}, {-17, -64, 31},
            {7, 255, -3}, {7, -20, -3}, {30000000, 319, -30000000}};

        private BlockAppearance(Registry<Block> registry, boolean fixtures) throws Exception {
            Method offset;
            try { offset = BlockState.class.getMethod("getOffset", BlockPos.class); }
            catch (NoSuchMethodException older) { offset = BlockState.class.getMethod("getOffset", BlockGetter.class, BlockPos.class); }
            Method layer = null, setCutout = null;
            Class<?> types = null;
            try { types = Class.forName("net.minecraft.client.renderer.ItemBlockRenderTypes"); }
            catch (ClassNotFoundException spriteLayers) {}
            var overrides = new TreeMap<String, Object>();
            if (types != null) {
                layer = types.getMethod("getChunkRenderType", BlockState.class);
                try { setCutout = types.getMethod("setCutoutLeaves", boolean.class); }
                catch (NoSuchMethodException older) { setCutout = types.getMethod("setFancy", boolean.class); }
                layers.put("source", "block");
                layers.put("default", "solid");
                layers.put("blocks", overrides);
            } else {
                Class<?> transparency = Class.forName("com.mojang.blaze3d.platform.Transparency");
                Method byTransparency = Class.forName("net.minecraft.client.renderer.chunk.ChunkSectionLayer")
                    .getMethod("byTransparency", transparency);
                Method of = transparency.getMethod("of", boolean.class, boolean.class);
                layers.put("source", "sprite");
                for (boolean transparent : new boolean[] {false, true}) {
                    for (boolean translucent : new boolean[] {false, true}) {
                        String value = layerName(byTransparency.invoke(null, of.invoke(null, transparent, translucent)));
                        String key = translucent ? "translucent" : transparent ? "cutout" : "opaque";
                        if (layers.containsKey(key) && !layers.get(key).equals(value)) throw new IllegalStateException("Unsupported sprite layer policy");
                        layers.put(key, value);
                        if (fixtures) layerSamples.add(Map.of("transparent", transparent, "translucent", translucent, "layer", value));
                        layerChecks++;
                    }
                }
            }
            for (Block block : registry) {
                String id = registry.getKey(block).toString();
                BlockState defaultState = block.defaultBlockState();
                Vec3 origin = offset(offset, defaultState, BlockPos.ZERO);
                double horizontal = Math.abs(origin.x), vertical = Math.abs(origin.y);
                if (origin.z != origin.x || origin.x > 0 || origin.y > 0) throw new IllegalStateException("Unsupported block offset: " + id);
                if (horizontal != 0 || vertical != 0) offsets.put(id, Map.of("type", vertical == 0 ? "xz" : "xyz",
                    "horizontal", horizontal, "vertical", vertical));
                var defaultLayers = new TreeMap<String, String>();
                for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                    stateCount++;
                    for (int[] coordinates : POSITIONS) {
                        BlockPos pos = new BlockPos(coordinates[0], coordinates[1], coordinates[2]);
                        Vec3 actual = offset(offset, state, pos);
                        long seed = net.minecraft.util.Mth.getSeed(pos.getX(), 0, pos.getZ());
                        double x = Math.max(-horizontal, Math.min(horizontal, ((float) (seed & 15L) / 15.0F - 0.5) * 0.5));
                        double y = ((float) (seed >> 4 & 15L) / 15.0F - 1.0) * vertical;
                        double z = Math.max(-horizontal, Math.min(horizontal, ((float) (seed >> 8 & 15L) / 15.0F - 0.5) * 0.5));
                        if (actual.x != x || actual.y != y || actual.z != z) throw new IllegalStateException("Unsupported block offset at " + pos + ": " + id);
                        offsetChecks++;
                        if (fixtures && state == defaultState) offsetSamples.add(Map.of("block", id,
                            "position", List.of(pos.getX(), pos.getY(), pos.getZ()), "offset", List.of(actual.x, actual.y, actual.z)));
                    }
                    if (layer != null) {
                        for (boolean cutout : new boolean[] {false, true}) {
                            setCutout.invoke(null, cutout);
                            String name = cutout ? "cutoutLeaves" : "solidLeaves";
                            String value = layerName(layer.invoke(null, state));
                            String previous = defaultLayers.putIfAbsent(name, value);
                            if (previous != null && !previous.equals(value)) throw new IllegalStateException("State-dependent block layer: " + id);
                            layerChecks++;
                            if (fixtures && state == defaultState) layerSamples.add(Map.of("block", id, "cutoutLeaves", cutout, "layer", value));
                        }
                    }
                }
                if (!defaultLayers.isEmpty()) {
                    String solid = defaultLayers.get("solidLeaves"), cutout = defaultLayers.get("cutoutLeaves");
                    if (!solid.equals(cutout)) overrides.put(id, defaultLayers);
                    else if (!solid.equals("solid")) overrides.put(id, solid);
                }
            }
            if (setCutout != null) setCutout.invoke(null, true);
        }

        private static Vec3 offset(Method method, BlockState state, BlockPos pos) throws Exception {
            return (Vec3) (method.getParameterCount() == 1 ? method.invoke(state, pos) : method.invoke(state, STATIC_WORLD, pos));
        }

        private static String layerName(Object layer) throws Exception {
            if (layer instanceof Enum<?>) return ((Enum<?>) layer).name().toLowerCase(java.util.Locale.ROOT);
            for (String name : new String[] {"solid", "cutoutMipped", "cutout", "translucent", "tripwire"}) {
                if (layer == Class.forName("net.minecraft.client.renderer.RenderType").getMethod(name).invoke(null)) {
                    return name.equals("cutoutMipped") ? "cutout_mipped" : name;
                }
            }
            throw new IllegalStateException("Unsupported chunk render layer: " + layer);
        }

        private Map<String, Object> data() {
            return Map.of("offsetAlgorithm", "minecraft-position-v1", "offsets", offsets, "renderLayers", layers);
        }

        private Map<String, Object> fixtures() {
            return Map.of("stateCount", stateCount, "offsetChecks", offsetChecks, "layerChecks", layerChecks,
                "offsets", offsetSamples, "layers", layerSamples);
        }
    }

    private static final class LegacyBiomes {
        private final String source;
        private final Map<String, String> ids = new TreeMap<>();
        private final List<Object> samples = new ArrayList<>();

        private LegacyBiomes(int dataVersion, boolean fixtures) throws Exception {
            Class<?> owner;
            java.lang.reflect.Field field;
            Method lookup;
            boolean dataFix = false;
            try {
                owner = Class.forName("net.minecraft.data.worldgen.biome.Biomes");
                field = owner.getDeclaredField("TO_NAME");
                lookup = owner.getMethod("byId", int.class);
            } catch (ClassNotFoundException | NoSuchFieldException later) {
                owner = Class.forName("net.minecraft.util.datafix.fixes.ChunkHeightAndBiomeFix");
                field = owner.getDeclaredField("BIOMES_BY_ID");
                lookup = owner.getDeclaredMethod("makeBiomeContainer", Dynamic.class, Int2IntFunction.class);
                lookup.setAccessible(true);
                dataFix = true;
            }
            source = owner.getName();
            field.setAccessible(true);
            Map<?, ?> values = (Map<?, ?>) field.get(null);
            Set<String> registered = registeredBiomes();
            for (var entry : values.entrySet()) {
                if (!(entry.getKey() instanceof Integer)) throw new IllegalStateException("Non-numeric legacy biome ID");
                String name = dataFix ? (String) entry.getValue() : accessor(entry.getValue(), "location").toString();
                if (dataFix) name = migrateName(name, dataVersion);
                if (!registered.contains(name)) throw new IllegalStateException("Unregistered target biome: " + name);
                ids.put(entry.getKey().toString(), name);
            }
            if (fixtures) {
                var sampleIds = new ArrayList<Integer>();
                for (Object id : values.keySet()) sampleIds.add((Integer) id);
                sampleIds.addAll(List.of(-1, 176, 255, 9999));
                sampleIds.sort(Integer::compareTo);
                for (int id : sampleIds) {
                    String nativeName;
                    if (dataFix) {
                        Int2IntFunction storage = index -> id;
                        Dynamic<?> converted = (Dynamic<?>) lookup.invoke(null, new Dynamic<>(JsonOps.INSTANCE, new JsonObject()), storage);
                        nativeName = migrateName(converted.get("palette").asStream().findFirst().orElseThrow().asString().result().orElseThrow(), dataVersion);
                    } else {
                        Object key = lookup.invoke(null, id);
                        nativeName = key == null ? null : accessor(key, "location").toString();
                    }
                    var sample = new LinkedHashMap<String, Object>();
                    sample.put("id", id);
                    sample.put("known", values.containsKey(id));
                    sample.put("nativeName", nativeName);
                    sample.put("registered", nativeName != null && registered.contains(nativeName));
                    samples.add(sample);
                }
            }
        }

        private static String migrateName(String name, int dataVersion) {
            // The numeric conversion table predates the biome renames after schema 2832.
            return DataFixers.getDataFixer().update(References.BIOME,
                new Dynamic<>(JsonOps.INSTANCE, new JsonPrimitive(name)), 2832, dataVersion).asString().result().orElseThrow();
        }

        private static Set<String> registeredBiomes() throws Exception {
            var names = new HashSet<String>();
            try {
                var registry = (Registry<?>) Class.forName("net.minecraft.data.BuiltinRegistries").getField("BIOME").get(null);
                for (Object key : registry.keySet()) names.add(key.toString());
            } catch (ClassNotFoundException | NoSuchFieldException modern) {
                if (registryLookup == null) {
                    Class<?> vanilla = Class.forName("net.minecraft.data.registries.VanillaRegistries");
                    Method lookup = optionalMethod(vanilla, "createWorldLookup");
                    if (lookup == null) lookup = vanilla.getMethod("createLookup");
                    registryLookup = lookup.invoke(null);
                }
                Object key = Class.forName("net.minecraft.core.registries.Registries").getField("BIOME").get(null);
                Object lookup = Class.forName("net.minecraft.core.HolderLookup$Provider")
                    .getMethod("lookupOrThrow", Class.forName("net.minecraft.resources.ResourceKey")).invoke(registryLookup, key);
                var keys = (java.util.stream.Stream<?>) Class.forName("net.minecraft.core.HolderLookup")
                    .getMethod("listElementIds").invoke(lookup);
                for (Object entry : keys.toList()) names.add(accessor(entry, "identifier", "location").toString());
            }
            return names;
        }

        private Map<String, Object> data() {
            return Map.of("format", "legacy-numeric", "source", source, "ids", ids);
        }
    }

    private static final class FluidStates extends StateProfiles {
        private final List<Object> shapes = new ArrayList<>();
        private final Map<Object, Integer> shapeIndices = new LinkedHashMap<>();
        private final List<Object> samples = new ArrayList<>();
        private final Set<Object> sampled = new HashSet<>();
        private final Method occlusionShape = stateMethod("getOcclusionShape");
        private final Method solidRender = stateMethod("isSolidRender");
        private final Method solid = optionalMethod(BlockState.class, "isSolid");
        private final Method blocksMotion = optionalMethod(BlockState.class, "blocksMotion");
        private final Method material = optionalMethod(BlockState.class, "getMaterial");
        private final Method nativeOcclusion;
        private final Set<String> flowBlocking;
        private final boolean fixtures;
        private static final Set<String> SAMPLE_BLOCKS = Set.of("air", "stone", "water", "lava", "bubble_column", "kelp",
            "seagrass", "glass", "oak_leaves", "oak_slab", "oak_stairs", "snow", "farmland", "dirt_path", "soul_sand",
            "ice", "iron_bars", "oak_fence", "oak_fence_gate", "oak_trapdoor", "moving_piston", "oak_sign");
        private static final Direction[] DIRECTIONS = {Direction.EAST, Direction.WEST, Direction.UP, Direction.DOWN, Direction.SOUTH, Direction.NORTH};

        private FluidStates(Registry<Block> registry, boolean fixtures) throws Exception {
            this.fixtures = fixtures;
            flowBlocking = blocksMotion == null && material == null
                ? blockTag("minecraft:blocks_fluid_flow", registry, new HashSet<>(), true) : Set.of();
            Class<?> renderer;
            try { renderer = Class.forName("net.minecraft.client.renderer.block.LiquidBlockRenderer"); }
            catch (ClassNotFoundException renamed) { renderer = Class.forName("net.minecraft.client.renderer.block.FluidRenderer"); }
            nativeOcclusion = java.util.Arrays.stream(renderer.getDeclaredMethods())
                .filter(method -> method.getName().equals("isFaceOccludedByState")).findFirst().orElseThrow();
            nativeOcclusion.setAccessible(true);
            extract(registry);
        }

        private Map<String, Object> data() {
            return Map.of("shapes", shapes, "profiles", profiles, "blocks", blocks);
        }

        @Override
        Map<String, Object> profile(String id, List<Property<?>> properties, BlockState state) throws Exception {
            var profile = new LinkedHashMap<String, Object>();
            var fluid = state.getFluidState();
            if (!fluid.isEmpty()) {
                String kind;
                if (fluid.getType() == Fluids.WATER || fluid.getType() == Fluids.FLOWING_WATER) kind = "water";
                else if (fluid.getType() == Fluids.LAVA || fluid.getType() == Fluids.FLOWING_LAVA) kind = "lava";
                else throw new IllegalStateException("Unsupported fluid in " + id);
                profile.put("fluid", Map.of("kind", kind, "amount", fluid.getAmount(), "source", fluid.isSource(),
                    "falling", fluid.hasProperty(FlowingFluid.FALLING) && fluid.getValue(FlowingFluid.FALLING), "height", fluid.getOwnHeight()));
            }
            Object stateMaterial = material == null ? null : material.invoke(state);
            profile.put("renderModel", state.getRenderShape() == RenderShape.MODEL);
            profile.put("heightSolid", solid == null ? accessor(stateMaterial, "isSolid") : solid.invoke(state));
            profile.put("blocksFlow", blocksMotion != null ? blocksMotion.invoke(state)
                : stateMaterial != null ? accessor(stateMaterial, "blocksMotion") : flowBlocking.contains(id));
            profile.put("solidRender", staticValue(solidRender, state));
            profile.put("waterOverlay", state.getBlock() instanceof HalfTransparentBlock || state.getBlock() instanceof LeavesBlock);
            Object boxes = state.canOcclude() ? staticValue(occlusionShape, state) : List.of();
            var complete = new LinkedHashMap<>(profile);
            complete.put("occlusionShape", boxes == null ? null : intern(boxes, shapes, shapeIndices));
            if (fixtures && SAMPLE_BLOCKS.contains(id.substring(id.indexOf(':') + 1)) && sampled.add(complete)) {
                var values = new TreeMap<String, Object>();
                for (var property : properties) values.put(property.getName(), stateValue(state, property));
                var tests = new ArrayList<Object>();
                if (boxes != null) {
                    for (Direction direction : DIRECTIONS) {
                        for (float height : new float[] {0.125F, 0.5F, 8.0F / 9.0F, 1.0F}) {
                            Object result = nativeOcclusion.getParameterCount() == 3
                                ? nativeOcclusion.invoke(null, direction, height, state)
                                : nativeOcclusion.invoke(null, STATIC_WORLD, direction, height, BlockPos.ZERO, state);
                            tests.add(Map.of("direction", direction.getName(), "height", height, "occluded", result));
                        }
                    }
                }
                var sample = new LinkedHashMap<String, Object>();
                sample.put("block", id);
                sample.put("properties", values);
                sample.put("profile", profile);
                sample.put("shape", boxes);
                sample.put("occlusion", tests);
                samples.add(sample);
            }
            return complete;
        }

        @SuppressWarnings("unchecked")
        private static Set<String> blockTag(String id, Registry<Block> registry, Set<String> visiting, boolean required) throws Exception {
            if (!id.contains(":")) id = "minecraft:" + id;
            if (!visiting.add(id)) throw new IllegalStateException("Cyclic block tag: " + id);
            String[] parts = id.split(":", 2);
            String resource = "data/" + parts[0] + "/tags/block/" + parts[1] + ".json";
            try (var input = Extract.class.getClassLoader().getResourceAsStream(resource)) {
                if (input == null) {
                    if (!required) return Set.of();
                    throw new IllegalStateException("Missing block tag: " + id);
                }
                var data = new Gson().fromJson(new InputStreamReader(input, StandardCharsets.UTF_8), Map.class);
                var result = new HashSet<String>();
                var known = new HashSet<String>();
                for (Block block : registry) known.add(registry.getKey(block).toString());
                for (Object entry : (List<?>) data.get("values")) {
                    String target = entry instanceof String ? (String) entry : (String) ((Map<?, ?>) entry).get("id");
                    boolean entryRequired = entry instanceof String || !Boolean.FALSE.equals(((Map<?, ?>) entry).get("required"));
                    if (target.startsWith("#")) result.addAll(blockTag(target.substring(1), registry, visiting, entryRequired));
                    else {
                        if (!target.contains(":")) target = "minecraft:" + target;
                        if (known.contains(target)) result.add(target);
                        else if (entryRequired) throw new IllegalStateException("Unknown block " + target + " in tag " + id);
                    }
                }
                return result;
            } finally { visiting.remove(id); }
        }
    }

    private static final class BlockLighting extends StateProfiles {
        private final Method shadeBrightness = stateMethod("getShadeBrightness");
        private final Method lightBlock = stateMethod("getLightDampening", "getLightBlock");
        private final Method skylight = stateMethod("propagatesSkylightDown");
        private final Method emissive = stateMethod("emissiveRendering");
        private final Method lightPermeable = optionalMethod(BlockState.class, "isLightPermeable");
        private final Method viewBlocking;
        private final boolean legacyAmbientOcclusion;
        private BlockLighting(Registry<Block> registry, String version) throws Exception {
            legacyAmbientOcclusion = version.equals("1.16.5");
            viewBlocking = lightPermeable == null && !legacyAmbientOcclusion ? stateMethod("isViewBlocking") : null;
            extract(registry);
        }

        private Map<String, Object> data() {
            return Map.of("profiles", profiles, "blocks", blocks);
        }

        @Override
        Map<String, Object> profile(String id, List<Property<?>> properties, BlockState state) throws Exception {
            var result = new LinkedHashMap<String, Object>();
            result.put("shadeBrightness", staticValue(shadeBrightness, state));
            result.put("lightEmission", state.getLightEmission());
            result.put("lightBlock", staticValue(lightBlock, state));
            result.put("propagatesSkylightDown", staticValue(skylight, state));
            result.put("useShapeForLightOcclusion", state.useShapeForLightOcclusion());
            result.put("emissiveRendering", staticValue(emissive, state));
            result.put("lightPermeable", staticValue((world, pos) -> lightPermeable(state, world, pos)));
            return result;
        }

        private boolean lightPermeable(BlockState state, BlockGetter world, BlockPos pos) throws Exception {
            if (lightPermeable != null) return (Boolean) lightPermeable.invoke(state);
            if (!legacyAmbientOcclusion && !(Boolean) stateValue(viewBlocking, state, world, pos)) return true;
            return (Integer) stateValue(lightBlock, state, world, pos) == 0;
        }
    }

    private abstract static class StateProfiles {
        final List<Object> profiles = new ArrayList<>();
        final Map<Object, Integer> profileIndices = new LinkedHashMap<>();
        final Map<String, Object> blocks = new TreeMap<>();
        int stateCount;

        final void extract(Registry<Block> registry) throws Exception {
            var entries = registry.stream().sorted(Comparator.comparing(block -> registry.getKey(block).toString())).toList();
            for (Block block : entries) {
                String id = registry.getKey(block).toString();
                var properties = block.getStateDefinition().getProperties().stream().sorted(Comparator.comparing(Property::getName)).toList();
                var indices = new ArrayList<Integer>();
                visit(id, properties, 0, block.defaultBlockState(), indices);
                int nativeCount = block.getStateDefinition().getPossibleStates().size();
                if (indices.size() != nativeCount) throw new IllegalStateException("Incomplete block states: " + id);
                stateCount += nativeCount;
                blocks.put(id, Map.of("properties", properties.stream().map(Property::getName).toList(), "states", indices));
            }
        }

        private <T extends Comparable<T>> void visit(String id, List<Property<?>> properties, int index, BlockState state,
            List<Integer> indices) throws Exception {
            if (index < properties.size()) {
                @SuppressWarnings("unchecked") Property<T> property = (Property<T>) properties.get(index);
                for (T value : property.getPossibleValues()) visit(id, properties, index + 1, state.setValue(property, value), indices);
                return;
            }
            indices.add(intern(profile(id, properties, state), profiles, profileIndices));
        }

        abstract Map<String, Object> profile(String id, List<Property<?>> properties, BlockState state) throws Exception;
    }

    // A world-dependent result cannot be represented by one profile for a block state.
    private static final BlockGetter STATIC_WORLD = (BlockGetter) Proxy.newProxyInstance(BlockGetter.class.getClassLoader(),
        new Class<?>[] {BlockGetter.class}, (proxy, method, args) -> {
            // Vanilla's maximum light level is constant; block and entity reads need a real world.
            if (method.getName().equals("getMaxLightLevel")) return method.invoke(EmptyBlockGetter.INSTANCE);
            throw new ContextRead();
        });

    private static <T extends Comparable<T>> Object stateValue(BlockState state, Property<T> property) {
        return propertyValue(property, state.getValue(property));
    }

    private static int intern(Object value, List<Object> entries, Map<Object, Integer> indices) {
        Integer existing = indices.get(value);
        if (existing != null) return existing;
        int index = entries.size();
        entries.add(value);
        indices.put(value, index);
        return index;
    }

    private static Method stateMethod(String... names) {
        for (String name : names) {
            Method modern = optionalMethod(BlockState.class, name);
            if (modern != null) return modern;
            try { return BlockState.class.getMethod(name, BlockGetter.class, BlockPos.class); }
            catch (NoSuchMethodException missing) {}
        }
        throw new IllegalStateException("Missing block state method: " + String.join(", ", names));
    }

    private static Object stateValue(Method method, BlockState state, BlockGetter world, BlockPos pos) throws Exception {
        return method.getParameterCount() == 0 ? method.invoke(state) : method.invoke(state, world, pos);
    }

    private static Object staticValue(Method method, BlockState state) throws Exception {
        return staticValue((world, pos) -> stateValue(method, state, world, pos));
    }

    private static Object staticValue(StateCall call) throws Exception {
        try {
            Object value = normalized(call.get(STATIC_WORLD, BlockPos.ZERO));
            Object shifted = normalized(call.get(STATIC_WORLD, new BlockPos(7, 31, -3)));
            return java.util.Objects.equals(value, shifted) ? value : null;
        } catch (InvocationTargetException error) {
            if (error.getCause() instanceof ContextRead) return null;
            throw error;
        }
    }

    private interface StateCall {
        Object get(BlockGetter world, BlockPos pos) throws Exception;
    }

    private static Object normalized(Object value) {
        if (!(value instanceof VoxelShape)) return value;
        var boxes = new ArrayList<List<Double>>();
        for (var box : ((VoxelShape) value).toAabbs()) boxes.add(List.of(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ));
        boxes.sort((left, right) -> {
            for (int axis = 0; axis < 6; axis++) {
                int compared = Double.compare(left.get(axis), right.get(axis));
                if (compared != 0) return compared;
            }
            return 0;
        });
        return boxes;
    }

    private static final class ContextRead extends RuntimeException {}
    private static final class BlockCulling {
        private final List<Object> profiles = new ArrayList<>();
        private final Map<Object, Integer> profileIndices = new LinkedHashMap<>();
        private final Map<String, Integer> blocks = new TreeMap<>();
        private final Map<String, List<String>> groups = new TreeMap<>();
        private final List<Object> samples = new ArrayList<>();
        private final List<Object> sampleStates = new ArrayList<>();
        private final Map<Object, Integer> sampleStateIndices = new LinkedHashMap<>();
        private final Registry<Block> registry;
        private final Method cutoutLeaves;
        private final Object barsTag;

        private BlockCulling(Registry<Block> registry, boolean fixtures) throws Exception {
            this.registry = registry;
            Method leaves;
            try { leaves = LeavesBlock.class.getMethod("setCutoutLeaves", boolean.class); }
            catch (NoSuchMethodException absent) { leaves = null; }
            cutoutLeaves = leaves;
            Object tag;
            try { tag = Class.forName("net.minecraft.tags.BlockTags").getField("BARS").get(null); }
            catch (NoSuchFieldException absent) { tag = null; }
            barsTag = tag;
            if (barsTag != null) groups.put("bars", FluidStates.blockTag("minecraft:bars", registry, new HashSet<>(), true).stream().sorted().toList());
            var entries = registry.stream().sorted(Comparator.comparing(block -> registry.getKey(block).toString())).toList();
            for (Block block : entries) {
                String id = registry.getKey(block).toString();
                Method method = skipMethod(block.getClass());
                String owner = method.getDeclaringClass().getName();
                Map<String, Object> rule;
                switch (owner) {
                    case "net.minecraft.world.level.block.state.BlockBehaviour": continue;
                    case "net.minecraft.world.level.block.HalfTransparentBlock":
                    case "net.minecraft.world.level.block.PowderSnowBlock": rule = Map.of("type", "same_block"); break;
                    case "net.minecraft.world.level.block.MangroveRootsBlock":
                        if (!id.equals("minecraft:mangrove_roots")) throw new IllegalStateException("Unreviewed mangrove root: " + id);
                        rule = Map.of("type", "same_block_vertical"); break;
                    case "net.minecraft.world.level.block.IronBarsBlock":
                        rule = barsTag == null ? Map.of("type", "connected") : Map.of("type", "connected", "group", "bars"); break;
                    case "net.minecraft.world.level.block.LeavesBlock":
                        if (cutoutLeaves == null) throw new IllegalStateException("Missing leaf graphics setting");
                        rule = Map.of("type", "leaves"); break;
                    case "net.minecraft.world.level.block.LiquidBlock":
                        var fluid = block.defaultBlockState().getFluidState().getType();
                        String kind;
                        if (fluid == Fluids.WATER || fluid == Fluids.FLOWING_WATER) kind = "water";
                        else if (fluid == Fluids.LAVA || fluid == Fluids.FLOWING_LAVA) kind = "lava";
                        else throw new IllegalStateException("Unreviewed culling fluid: " + id);
                        rule = Map.of("type", "fluid", "kind", kind); break;
                    default: throw new IllegalStateException("Unreviewed skipRendering override: " + id + " (" + owner + ")");
                }
                blocks.put(id, intern(rule, profiles, profileIndices));
            }
            if (fixtures) fixtures(entries);
        }

        private Map<String, Object> data() {
            var data = new LinkedHashMap<String, Object>();
            data.put("profiles", profiles);
            data.put("blocks", blocks);
            if (!groups.isEmpty()) data.put("groups", groups);
            return data;
        }

        private static Method skipMethod(Class<?> type) throws Exception {
            while (type != null) {
                try { return type.getDeclaredMethod("skipRendering", BlockState.class, BlockState.class, Direction.class); }
                catch (NoSuchMethodException absent) { type = type.getSuperclass(); }
            }
            throw new IllegalStateException("Missing skipRendering method");
        }

        private void fixtures(List<Block> entries) throws Exception {
            var known = new TreeMap<String, Block>();
            for (Block block : entries) known.put(registry.getKey(block).toString(), block);
            var pairs = new LinkedHashMap<String, BlockState[]>();
            var air = known.get("minecraft:air").defaultBlockState();
            for (Block block : entries) {
                addPair(pairs, block.defaultBlockState(), block.defaultBlockState());
                addPair(pairs, block.defaultBlockState(), air);
            }
            var neighbors = new ArrayList<BlockState>();
            for (String name : List.of("air", "stone", "glass", "white_stained_glass", "black_stained_glass", "glass_pane",
                "white_stained_glass_pane", "black_stained_glass_pane", "iron_bars", "copper_bars", "water", "lava",
                "bubble_column", "kelp", "oak_slab", "oak_leaves", "birch_leaves", "mangrove_roots", "powder_snow")) {
                Block block = known.get("minecraft:" + name);
                if (block != null) neighbors.addAll(block.getStateDefinition().getPossibleStates());
            }
            var tested = new HashSet<Integer>();
            for (Block block : entries) {
                int profile = blocks.getOrDefault(registry.getKey(block).toString(), -1);
                if (!tested.add(profile)) continue;
                for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                    for (BlockState neighbor : neighbors) addPair(pairs, state, neighbor);
                }
            }
            // Bars of different materials share faces only when the runtime's tag permits it.
            var bars = entries.stream().filter(block -> block instanceof IronBarsBlock).toList();
            for (Block block : bars) for (Block neighbor : bars) {
                addPair(pairs, connected(block.defaultBlockState()), connected(neighbor.defaultBlockState()));
            }
            var savedTags = new LinkedHashMap<Object, Object>();
            java.lang.reflect.Field tagField = null;
            java.lang.reflect.Field leafField = null;
            Object savedLeaves = null;
            try {
                if (barsTag != null) {
                    Class<?> reference = Class.forName("net.minecraft.core.Holder$Reference");
                    tagField = reference.getDeclaredField("tags"); tagField.setAccessible(true);
                    Method bind = reference.getDeclaredMethod("bindTags", Collection.class); bind.setAccessible(true);
                    Method holder = Block.class.getMethod("builtInRegistryHolder");
                    for (Block block : entries) {
                        Object value = holder.invoke(block);
                        savedTags.put(value, tagField.get(value));
                        // Bind only the vanilla tag read by skipRendering, then restore the registry.
                        bind.invoke(value, groups.get("bars").contains(registry.getKey(block).toString()) ? Set.of(barsTag) : Set.of());
                    }
                }
                if (cutoutLeaves != null) {
                    leafField = LeavesBlock.class.getDeclaredField("cutoutLeaves"); leafField.setAccessible(true);
                    savedLeaves = leafField.get(null);
                }
                for (BlockState[] pair : pairs.values()) {
                    int mask = 0, bit = 0;
                    for (boolean cutout : new boolean[] {false, true}) {
                        if (cutoutLeaves != null) cutoutLeaves.invoke(null, cutout);
                        for (Direction direction : FluidStates.DIRECTIONS) {
                            if (pair[0].skipRendering(pair[1], direction)) mask |= 1 << bit;
                            bit++;
                        }
                    }
                    samples.add(List.of(intern(stateData(pair[0]), sampleStates, sampleStateIndices),
                        intern(stateData(pair[1]), sampleStates, sampleStateIndices), mask));
                }
            } finally {
                if (tagField != null) for (var entry : savedTags.entrySet()) tagField.set(entry.getKey(), entry.getValue());
                if (leafField != null) leafField.set(null, savedLeaves);
            }
        }

        private static void addPair(Map<String, BlockState[]> pairs, BlockState state, BlockState neighbor) {
            pairs.putIfAbsent(state + "/" + neighbor, new BlockState[] {state, neighbor});
        }

        private static BlockState connected(BlockState state) {
            for (String name : List.of("north", "east", "south", "west")) {
                var property = state.getBlock().getStateDefinition().getProperty(name);
                state = state.setValue((BooleanProperty) property, true);
            }
            return state;
        }

        private Map<String, Object> stateData(BlockState state) {
            var properties = new TreeMap<String, Object>();
            for (var property : state.getProperties()) properties.put(property.getName(), stateValue(state, property));
            return Map.of("block", registry.getKey(state.getBlock()).toString(), "properties", properties);
        }
    }

    private static <T extends Comparable<T>> Map<String, Object> propertyData(BlockState state, Property<T> property) {
        String type;
        String valueType;
        if (property instanceof BooleanProperty) type = valueType = "boolean";
        else if (property instanceof IntegerProperty) type = valueType = "int";
        else if (property instanceof EnumProperty) {
            type = "enum";
            valueType = property.getValueClass().getSimpleName();
        } else throw new IllegalStateException("Unsupported property type: " + property.getClass().getName());
        var values = new ArrayList<Object>();
        for (T value : property.getPossibleValues()) values.add(propertyValue(property, value));
        var entry = new LinkedHashMap<String, Object>();
        entry.put("default", propertyValue(property, state.getValue(property)));
        entry.put("type", type);
        entry.put("valueType", valueType);
        entry.put("values", values);
        return entry;
    }

    private static <T extends Comparable<T>> Object propertyValue(Property<T> property, T value) {
        return value instanceof Boolean || value instanceof Integer ? value : property.getName(value);
    }

    private static Map<String, Object> itemSample(ItemStack stack) throws Exception {
        var result = new LinkedHashMap<String, Object>();
        result.put("count", stack.getCount());
        result.put("maxStackSize", stack.getMaxStackSize());
        result.put("maxDamage", stack.getMaxDamage());
        result.put("damage", stack.getDamageValue());
        result.put("damageable", stack.isDamageableItem());
        if (itemBars && !stack.isEmpty()) {
            result.put("barVisible", accessor(stack, "isBarVisible"));
            result.put("barWidth", accessor(stack, "getBarWidth"));
            result.put("barColor", (Integer) accessor(stack, "getBarColor") & 0xffffff);
        }
        return result;
    }

    private static String effectId(MobEffectInstance effect) throws Exception {
        Object value = effect.getEffect();
        if (!(value instanceof MobEffect)) value = accessor(value, "value");
        return effectRegistry.getKey((MobEffect) value).toString();
    }

    private static Integer potionColor(Collection<MobEffectInstance> effects) throws Exception {
        Object color = nativePotionColor.invoke(null, effects);
        if (color instanceof OptionalInt) {
            var optional = (OptionalInt) color;
            return optional.isPresent() ? optional.getAsInt() & 0xffffff : null;
        }
        return (Integer) color & 0xffffff;
    }

    private static MobEffectInstance effectInstance(MobEffect effect, int amplifier, boolean visible) throws Exception {
        Class<?> type = itemComponents == null ? MobEffect.class : Class.forName("net.minecraft.core.Holder");
        Object value = itemComponents == null ? effect : Registry.class.getMethod("wrapAsHolder", Object.class).invoke(effectRegistry, effect);
        return MobEffectInstance.class.getConstructor(type, int.class, int.class, boolean.class, boolean.class)
            .newInstance(value, 100, amplifier, false, visible);
    }

    private static List<Object> effectMixtures() throws Exception {
        var effects = effectRegistry.stream().sorted(Comparator.comparing(effect -> effectRegistry.getKey(effect).toString())).toList();
        var mixtures = new ArrayList<Object>();
        for (int i = 0; i < effects.size(); i++) {
            for (int amplifier : new int[] {0, 1, 255}) {
                for (boolean visible : new boolean[] {false, true}) {
                    var instances = List.of(
                        effectInstance(effects.get(i), amplifier, visible),
                        effectInstance(effects.get((i + 1) % effects.size()), 1, true));
                    var values = new ArrayList<Object>();
                    for (var effect : instances) {
                        values.add(new TreeMap<>(Map.of("id", effectId(effect), "amplifier", effect.getAmplifier(), "show_particles", effect.isVisible())));
                    }
                    var sample = new LinkedHashMap<String, Object>();
                    sample.put("effects", values);
                    sample.put("color", potionColor(instances));
                    mixtures.add(sample);
                }
            }
        }
        return mixtures;
    }

    private static Map<String, Object> itemDefaults(Item item) throws Exception {
        var entry = new TreeMap<String, Object>();
        if (itemComponents == null) {
            entry.put("minecraft:max_stack_size", accessor(item, "getMaxStackSize"));
            int damage = (Integer) accessor(item, "getMaxDamage");
            if (damage > 0) {
                entry.put("minecraft:max_damage", damage);
                entry.put("minecraft:damage", 0);
            }
            if (item.getDefaultInstance().hasFoil()) entry.put("minecraft:enchantment_glint_override", true);
        } else {
            Object components = itemComponents.invoke(item);
            for (String name : new String[] {"max_stack_size", "max_damage", "damage", "enchantment_glint_override"}) {
                Object type = componentTypes.getField(name.toUpperCase(java.util.Locale.ROOT)).get(null);
                Object value = componentGet.invoke(components, type);
                if (value != null) entry.put("minecraft:" + name, value);
            }
        }
        return entry;
    }

    private static final class ItemProperties {
        final Map<String, Object> items = new TreeMap<>();
        final Registry<Object> attributes = registry("ATTRIBUTE");
        final Codec<Object> componentCodec;
        final Codec<Object> textCodec;
        final DynamicOps<JsonElement> ops;
        final Method eachModifier;
        final Method legacySlot;
        int componentRoundTrips;
        int persistentComponents;

        @SuppressWarnings("unchecked")
        ItemProperties() throws Exception {
            if (itemComponents != null) {
                if (registryLookup == null) {
                    Class<?> vanilla = Class.forName("net.minecraft.data.registries.VanillaRegistries");
                    Method lookup = optionalMethod(vanilla, "createWorldLookup");
                    if (lookup == null) lookup = vanilla.getMethod("createLookup");
                    registryLookup = lookup.invoke(null);
                }
                ops = (DynamicOps<JsonElement>) Class.forName("net.minecraft.core.HolderLookup$Provider")
                    .getMethod("createSerializationContext", DynamicOps.class).invoke(registryLookup, JsonOps.INSTANCE);
                componentCodec = (Codec<Object>) Class.forName("net.minecraft.core.component.DataComponentMap").getField("CODEC").get(null);
                textCodec = (Codec<Object>) Class.forName("net.minecraft.network.chat.ComponentSerialization").getField("CODEC").get(null);
                eachModifier = ItemStack.class.getMethod("forEachModifier", EquipmentSlot.class, BiConsumer.class);
            } else {
                componentCodec = null;
                textCodec = null;
                eachModifier = null;
                ops = JsonOps.INSTANCE;
            }
            Method slot = Mob.class.getMethod("getEquipmentSlotForItem", ItemStack.class);
            legacySlot = Modifier.isStatic(slot.getModifiers()) ? slot : null;
        }

        void add(String id, Item item) throws Exception {
            var entry = new LinkedHashMap<String, Object>();
            ItemStack stack = item.getDefaultInstance();
            Object name = stack.getHoverName();
            JsonElement encodedName = textCodec != null ? encode(textCodec, name) : (JsonElement)
                Class.forName("net.minecraft.network.chat.Component$Serializer")
                    .getMethod("toJsonTree", Class.forName("net.minecraft.network.chat.Component")).invoke(null, name);
            entry.put("name", encodedName);
            entry.put("rarity", stack.getRarity().name().toLowerCase(java.util.Locale.ROOT));
            EquipmentSlot slot = EquipmentSlot.MAINHAND;
            if (legacySlot != null) slot = (EquipmentSlot) legacySlot.invoke(null, stack);
            else {
                Object type = componentTypes.getField("EQUIPPABLE").get(null);
                Object value = componentGet.invoke(itemComponents.invoke(item), type);
                if (value != null) slot = (EquipmentSlot) accessor(value, "slot");
            }
            entry.put("equipmentSlot", slot.getName());
            var modifiers = new ArrayList<Map<String, Object>>();
            for (EquipmentSlot current : EquipmentSlot.values()) {
                if (eachModifier != null) {
                    BiConsumer<Object, Object> consumer = (attribute, modifier) -> {
                        try { modifiers.add(modifier(accessor(attribute, "value"), modifier, current)); }
                        catch (Exception failure) { throw new IllegalStateException(failure); }
                    };
                    eachModifier.invoke(stack, current, consumer);
                } else {
                    var values = (com.google.common.collect.Multimap<?, ?>) ItemStack.class
                        .getMethod("getAttributeModifiers", EquipmentSlot.class).invoke(stack, current);
                    for (var value : values.entries()) modifiers.add(modifier(value.getKey(), value.getValue(), current));
                }
            }
            modifiers.sort(Comparator.comparing(value -> value.get("slot") + ":" + value.get("attribute") + ":" + value.get("id")));
            entry.put("attributeModifiers", modifiers);
            if (componentCodec != null) {
                Object components = itemComponents.invoke(item);
                JsonElement encoded = encode(componentCodec, components);
                Object decoded = componentCodec.parse(ops, encoded).result().orElseThrow(() -> new IllegalStateException("Cannot decode components: " + id));
                if (!encoded.equals(encode(componentCodec, decoded))) throw new IllegalStateException("Component codec round trip differs: " + id);
                var componentRegistry = registry("DATA_COMPONENT_TYPE");
                for (Object type : (Set<?>) Class.forName("net.minecraft.core.component.DataComponentMap").getMethod("keySet").invoke(components)) {
                    if (componentRegistry.getKey(type) == null) throw new IllegalStateException("Unregistered component: " + id);
                    if (!(Boolean) Class.forName("net.minecraft.core.component.DataComponentType").getMethod("isTransient").invoke(type)) {
                        if (componentGet.invoke(decoded, type) == null)
                            throw new IllegalStateException("Decoded default component is missing: " + id + "/" + componentRegistry.getKey(type));
                        persistentComponents++;
                    }
                }
                componentRoundTrips++;
                entry.put("components", encoded);
            }
            items.put(id, entry);
        }

        private Map<String, Object> modifier(Object attribute, Object modifier, EquipmentSlot slot) throws Exception {
            Object operation = accessor(modifier, "operation", "getOperation");
            String name = switch (((Enum<?>) operation).name()) {
                case "ADDITION", "ADD_VALUE" -> "add_value";
                case "MULTIPLY_BASE", "ADD_MULTIPLIED_BASE" -> "add_multiplied_base";
                case "MULTIPLY_TOTAL", "ADD_MULTIPLIED_TOTAL" -> "add_multiplied_total";
                default -> throw new IllegalStateException("Unknown attribute operation: " + operation);
            };
            return new TreeMap<>(Map.of("attribute", attributes.getKey(attribute).toString(), "slot", slot.getName(),
                "id", accessor(modifier, "id", "getId").toString(), "amount", accessor(modifier, "amount", "getAmount"), "operation", name));
        }

        private JsonElement encode(Codec<Object> codec, Object value) {
            var result = codec.encodeStart(ops, value);
            return result.result().orElseThrow(() -> new IllegalStateException("Cannot encode item property: " + result.error()));
        }

        Map<String, Object> data() {
            return Map.of("schemaVersion", 1, "componentFormat", componentCodec == null ? "legacy" : "native", "items", items);
        }
    }

    private static int dyeColor(DyeColor dye) throws Exception {
        Object color = accessor(dye, "getTextureDiffuseColor", "getTextureDiffuseColors");
        if (color instanceof Integer) return (Integer) color & 0xffffff;
        float[] channels = (float[]) color;
        return Math.round(channels[0] * 255) << 16 | Math.round(channels[1] * 255) << 8 | Math.round(channels[2] * 255);
    }

    @SuppressWarnings("unchecked")
    private static <T> Registry<T> registry(String name) throws Exception {
        Class<?> registries;
        try { registries = Class.forName("net.minecraft.core.registries.BuiltInRegistries"); }
        catch (ClassNotFoundException older) { registries = Registry.class; }
        return (Registry<T>) registries.getField(name).get(null);
    }

    private static void initializeComponents() throws Exception {
        Class<?> registries;
        try { registries = Class.forName("net.minecraft.core.registries.BuiltInRegistries"); }
        catch (ClassNotFoundException older) { return; }
        java.lang.reflect.Field initializers;
        try { initializers = registries.getField("DATA_COMPONENT_INITIALIZERS"); }
        catch (NoSuchFieldException older) { return; }
        Object builder = initializers.get(null);
        Class<?> vanilla = Class.forName("net.minecraft.data.registries.VanillaRegistries");
        Method lookup = optionalMethod(vanilla, "createWorldLookup");
        if (lookup == null) lookup = vanilla.getMethod("createLookup");
        registryLookup = lookup.invoke(null);
        var pending = (List<?>) builder.getClass().getMethod("build", Class.forName("net.minecraft.core.HolderLookup$Provider"))
            .invoke(builder, registryLookup);
        Method apply = Class.forName("net.minecraft.core.component.DataComponentInitializers$PendingComponents").getMethod("apply");
        for (Object components : pending) apply.invoke(components);
    }

    private static Method optionalMethod(Class<?> type, String name) {
        try { return type.getMethod(name); }
        catch (NoSuchMethodException missing) { return null; }
    }

    private static Object accessor(Object value, String... names) throws Exception {
        for (String name : names) {
            Method method = optionalMethod(value.getClass(), name);
            if (method != null) return method.invoke(value);
        }
        throw new NoSuchMethodException(value.getClass().getName() + ": " + String.join(", ", names));
    }

    private static void write(Path path, Object data) throws Exception {
        Files.writeString(path, new GsonBuilder().setPrettyPrinting().serializeNulls().disableHtmlEscaping().create().toJson(data) + "\n");
    }
}
