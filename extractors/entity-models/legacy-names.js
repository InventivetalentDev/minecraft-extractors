const snake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function tiny(text, namespaces) {
  const [header, ...lines] = text.split(/\r?\n/);
  if (header !== `tiny\t2\t0\t${namespaces}`) throw new Error(`Invalid tiny header: ${header}`);
  const classes = new Map();
  let current;
  for (const line of lines) {
    const columns = line.split('\t');
    if (columns[0] === 'c') {
      current = { name: columns[1], fields: new Map() };
      classes.set(columns[2], current);
    } else if (columns[0] === '' && columns[1] === 'f') current.fields.set(columns[4], columns[3]);
  }
  return classes;
}

export function legacyPartNames({ yarn, intermediary, mojang }) {
  const named = tiny(yarn, 'intermediary\tnamed');
  const official = tiny(intermediary, 'official\tintermediary');
  const mapped = new Map();
  let current;
  for (const line of mojang.split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const type = line.match(/^(\S+) -> (\S+):$/);
    if (type) {
      current = { name: type[1], fields: new Map() };
      mapped.set(type[2], current);
    } else {
      const field = line.match(/^ {4}\S+ ([^\s(]+) -> (\S+)$/);
      if (!field) continue;
      if (current.fields.has(field[2])) throw new Error(`Duplicate Mojang field: ${current.name}.${field[2]}`);
      current.fields.set(field[2], field[1]);
    }
  }
  const result = {};
  for (const [name, type] of named) {
    if (!name.startsWith('net/minecraft/client/')) continue;
    const obfuscated = official.get(type.name);
    const mojangClass = mapped.get(obfuscated?.name);
    if (!mojangClass) continue;
    const fields = {};
    for (const [field, intermediaryField] of type.fields) {
      const mojangField = mojangClass.fields.get(obfuscated.fields.get(intermediaryField));
      if (mojangField !== undefined) fields[field] = snake(mojangField);
    }
    result[name.replaceAll('/', '.')] = { class: snake(mojangClass.name.split(/[.$]/).at(-1)), fields };
  }
  return result;
}
