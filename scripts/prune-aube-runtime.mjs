import { readdir, realpath, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const appRoot = process.argv[2] ?? '/app';
const store = join(appRoot, 'node_modules', '.aube');
const runtimeModules = join(appRoot, 'apps', 'runtime', 'node_modules');
const reachableStoreEntries = new Set();
const visitedPackages = new Set();

async function packageEntries(nodeModules) {
  const entries = await readdir(nodeModules, { withFileTypes: true }).catch(
    () => []
  );
  const packages = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(path, { withFileTypes: true }).catch(
        () => []
      )) {
        packages.push(join(path, scoped.name));
      }
    } else {
      packages.push(path);
    }
  }
  return packages;
}

async function visitPackage(path) {
  const resolved = await realpath(path).catch(() => null);
  if (!resolved || visitedPackages.has(resolved)) return;
  visitedPackages.add(resolved);

  const storeRelative = relative(store, resolved);
  if (storeRelative && !storeRelative.startsWith(`..${sep}`)) {
    const marker = `${sep}node_modules${sep}`;
    const markerIndex = storeRelative.indexOf(marker);
    if (markerIndex > 0) {
      reachableStoreEntries.add(storeRelative.slice(0, markerIndex));
    }
  }

  for (const dependency of await packageEntries(
    join(resolved, 'node_modules')
  )) {
    await visitPackage(dependency);
  }
}

for (const rootPackage of await packageEntries(runtimeModules)) {
  await visitPackage(rootPackage);
}

for (const entry of await readdir(store).catch(() => [])) {
  if (reachableStoreEntries.has(entry)) continue;
  await rm(join(store, entry), { recursive: true, force: true });
}

const remaining = await readdir(store).catch(() => []);
if (!remaining.length || !(await stat(runtimeModules)).isDirectory()) {
  throw new Error('Runtime dependency pruning removed the production closure');
}
console.log(`Kept ${remaining.length} reachable Aube store entries.`);
