# Third-Party Notices

Author's original source code is distributed under the
[MIT License](LICENSE). Project-owned artwork is recorded in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md); the MIT License does not grant rights
to third-party assets. Author also depends on third-party software and fonts
that remain under their respective licenses.

This file is a practical notice for source users and redistributors, not a
substitute for the license files shipped by each dependency. The checked-in
`aube-lock.yaml`, workspace manifests, Gradle build files, and Gradle dependency
verification metadata are the authoritative dependency inventory for a given
commit.

## Direct Web and Server Dependencies

- [Svelte](https://github.com/sveltejs/svelte) — MIT
- [SvelteKit](https://github.com/sveltejs/kit) — MIT
- [Hono](https://github.com/honojs/hono) — MIT
- [Dexie](https://github.com/dexie/Dexie.js) — Apache-2.0
- [libSQL client](https://github.com/tursodatabase/libsql-client-ts) — MIT
- [Lucide](https://github.com/lucide-icons/lucide) — ISC
- [Noble Hashes](https://github.com/paulmillr/noble-hashes) — MIT
- [uqr](https://github.com/unjs/uqr) — MIT
- [DM Sans](https://github.com/googlefonts/dm-fonts) — Copyright 2014 The DM
  Sans Project Authors; [SIL Open Font License 1.1](https://github.com/googlefonts/dm-fonts/blob/main/Sans/OFL.txt)
- [Figtree](https://github.com/erikdkennedy/figtree) — Copyright 2022 The
  Figtree Project Authors; [SIL Open Font License 1.1](https://github.com/erikdkennedy/figtree/blob/master/OFL.txt)

## Direct Android Dependencies

- AndroidX Activity, Core, SQLite, Compose, and WorkManager —
  [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [ZXing Core](https://github.com/zxing/zxing) —
  [Apache-2.0](https://github.com/zxing/zxing/blob/master/LICENSE)
- [`sqlcipher-android`](https://github.com/sqlcipher/sqlcipher-android) —
  Copyright 2008-2023 Zetetic LLC;
  [SQLCipher community license](https://github.com/sqlcipher/sqlcipher-android/blob/v4.17.0/LICENSE)
- [Bouncy Castle](https://www.bouncycastle.org/) —
  [Bouncy Castle License](https://github.com/bcgit/bc-java/blob/r1rv85v2/LICENSE.html)
- JUnit 4 — Eclipse Public License 1.0
- Android desugared library support — Android/OpenJDK component licenses

## Complete Installed Inventory

After `aube install`, inspect the resolved JavaScript dependency licenses with:

```sh
aube licenses --prod
aube licenses --dev
```

License files are available in each installed package directory. Some optional
platform-specific binary packages omit a `license` metadata field and may appear
as `UNKNOWN`; review the corresponding parent project and included license file
rather than treating `UNKNOWN` as permission to redistribute. Android license
and provenance data should be reviewed from Gradle's resolved dependency
report and the upstream artifacts before distributing an APK:

```sh
cd apps/android
./gradlew :app:dependencies
```

Redistributors of built web bundles, containers, or APKs are responsible for
preserving all required copyright notices, license texts, source offers, and
attributions from the exact dependencies they distribute. Re-run the inventory
and review notices whenever dependencies change.
