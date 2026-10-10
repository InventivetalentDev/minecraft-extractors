import com.google.gson.GsonBuilder;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.TreeMap;
import net.minecraft.SharedConstants;
import net.minecraft.core.Registry;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.alchemy.Potion;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.material.Fluids;

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
        data.put("dyes", dyes);
        write(Path.of(args[0]), data);
        if (fixtures) {
            var fixture = new LinkedHashMap<String, Object>();
            fixture.put("minecraftVersion", minecraftVersion);
            fixture.put("capabilities", Map.of("itemBars", itemBars));
            fixture.put("items", itemFixtures);
            fixture.put("potions", potionFixtures);
            fixture.put("effectMixtures", effectMixtures());
            write(Path.of(args[1]), fixture);
        }
        System.out.println("Extracted Minecraft " + minecraftVersion + ": " + counts);
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
