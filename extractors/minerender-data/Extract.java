import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
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
import net.minecraft.SharedConstants;
import net.minecraft.core.Registry;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.alchemy.Potion;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.HalfTransparentBlock;
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

        var items = new TreeMap<String, Object>();
        var itemFixtures = new TreeMap<String, Object>();
        for (Item item : itemRegistry) {
            String id = itemRegistry.getKey(item).toString();
            items.put(id, itemDefaults(item));
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
        var blockLighting = new BlockLighting(blockRegistry, minecraftVersion, fixtures);

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
        counts.put("dyes", dyes.size());
        var metadata = new LinkedHashMap<String, Object>();
        metadata.put("minecraftVersion", minecraftVersion);
        metadata.put("dataVersion", dataVersionNumber);
        metadata.put("counts", counts);
        var data = new LinkedHashMap<String, Object>();
        data.put("metadata", metadata);
        data.put("itemDefaults", items);
        data.put("potionColors", new TreeMap<>(Map.of("effects", effects, "potions", potions)));
        data.put("blockStates", blocks);
        data.put("fluids", fluids);
        data.put("fluidStates", fluidStates.data());
        data.put("blockAppearance", appearance.data());
        data.put("blockLighting", blockLighting.data());
        data.put("dyes", dyes);
        write(Path.of(args[0]), data);
        if (fixtures) {
            var fixture = new LinkedHashMap<String, Object>();
            fixture.put("minecraftVersion", minecraftVersion);
            fixture.put("capabilities", Map.of("itemBars", itemBars));
            fixture.put("items", itemFixtures);
            fixture.put("potions", potionFixtures);
            fixture.put("effectMixtures", effectMixtures());
            fixture.put("fluidStates", Map.of("stateCount", fluidStates.stateCount, "samples", fluidStates.samples));
            fixture.put("blockAppearance", appearance.fixtures());
            fixture.put("blockLighting", Map.of("stateCount", blockLighting.stateCount, "samples", blockLighting.samples,
                "contextChecks", blockLighting.contextChecks));
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
        private final boolean fixtures;
        private final List<Object> samples = new ArrayList<>();
        private final Set<Object> sampled = new HashSet<>();
        private int contextChecks;
        private static final Set<String> SAMPLE_BLOCKS = Set.of("air", "stone", "glass", "tinted_glass", "oak_leaves",
            "water", "lava", "oak_slab", "oak_stairs", "snow", "farmland", "soul_sand", "ice", "packed_ice",
            "furnace", "redstone_lamp", "redstone_ore", "redstone_torch", "sea_pickle", "candle", "campfire",
            "glowstone", "light", "sculk", "sculk_sensor", "sculk_shrieker", "magma_block", "moving_piston", "powder_snow");
        private static final BlockPos[] SAMPLE_POSITIONS = {new BlockPos(-97, 173, 61), new BlockPos(2048, -31, -2048)};

        private BlockLighting(Registry<Block> registry, String version, boolean fixtures) throws Exception {
            this.fixtures = fixtures;
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
            if (fixtures) {
                boolean sample = SAMPLE_BLOCKS.contains(id.substring(id.indexOf(':') + 1)) && sampled.add(List.of(id, result));
                var checks = new ArrayList<Object>();
                for (BlockPos pos : SAMPLE_POSITIONS) {
                    var values = nativeValues(state, EmptyBlockGetter.INSTANCE, pos);
                    for (var field : result.entrySet()) {
                        if (field.getValue() != null && !field.getValue().equals(values.get(field.getKey()))) {
                            throw new IllegalStateException("Context-dependent lighting in " + id + ": " + field.getKey());
                        }
                    }
                    contextChecks++;
                    if (sample) checks.add(Map.of("position", List.of(pos.getX(), pos.getY(), pos.getZ()), "values", values));
                }
                if (sample) {
                    var values = new TreeMap<String, Object>();
                    for (var property : properties) values.put(property.getName(), stateValue(state, property));
                    samples.add(Map.of("block", id, "properties", values, "profile", result, "checks", checks));
                }
            }
            return result;
        }

        private Map<String, Object> nativeValues(BlockState state, BlockGetter world, BlockPos pos) throws Exception {
            return Map.of("shadeBrightness", stateValue(shadeBrightness, state, world, pos),
                "lightEmission", state.getLightEmission(), "lightBlock", stateValue(lightBlock, state, world, pos),
                "propagatesSkylightDown", stateValue(skylight, state, world, pos),
                "useShapeForLightOcclusion", state.useShapeForLightOcclusion(),
                "emissiveRendering", stateValue(emissive, state, world, pos),
                "lightPermeable", lightPermeable(state, world, pos));
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
        var pending = (List<?>) builder.getClass().getMethod("build", Class.forName("net.minecraft.core.HolderLookup$Provider"))
            .invoke(builder, lookup.invoke(null));
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
