# Package Manager

Aube is the package manager for this repo.

The repo uses `aube-lock.yaml`. Do not add other package-manager lockfiles.

## Install

```sh
curl https://mise.run | sh
mise use -g node@24
mise use -g aube@1.8.0
```

For fish:

```fish
curl https://mise.run/fish | sh
exec fish
mise use -g node@24
mise use -g aube@1.8.0
aube --version
```

If you already installed mise but fish cannot find it, add activation manually:

```fish
echo 'mise activate fish | source' >> ~/.config/fish/config.fish
mise activate fish | source
mise use -g aube@1.8.0
```

Alternative Aube install paths are Homebrew, Cargo, npm, Ubuntu PPA, and Fedora/RHEL COPR. Use `aube --version` to verify.

## Daily Commands

```sh
aube install
aube -F @author/web run dev
aube -F @author/web run build
aube -F @author/web run check
aube run test
aube run release:verify
```

## Build Scripts

`aube-workspace.yaml` includes:

```yaml
onlyBuiltDependencies:
  - esbuild
```

That explicitly approves the Vite/esbuild native build step.
