# Contributing to Author

Thank you for helping improve Author. The project intentionally stays small: a
plain-text, offline-first notes app with explicit, conflict-safe sync.

## Before Opening a Change

- Search existing issues and pull requests.
- Use a discussion or issue for product-direction changes before writing code.
- Keep proposals within the current scope: no blocks, rich-text storage,
  Markdown rendering, public sharing, or collaboration unless the project
  direction changes explicitly.
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md), not a
  public issue.
- Use [SUPPORT.md](SUPPORT.md) for setup and usage questions.

## Development Setup

Requirements:

- Node.js 24.12 or newer
- Aube 1.16.0
- JDK 21 and an Android SDK for Android changes

```sh
curl https://mise.run | sh
mise use -g node@24
mise use -g aube@1.16.0
aube install
cp apps/web/.env.example apps/web/.env
aube -F @author/web run dev
```

Use Aube and the checked-in `aube-lock.yaml`. Do not add npm, pnpm, Yarn, or Bun
lockfiles. More details are in [docs/package-manager.md](docs/package-manager.md)
and [docs/setup.md](docs/setup.md).

## Change Guidelines

- Keep local writes independent of the network.
- Prefer explicit conflicts over silent overwrite behavior.
- Never drop pending local records during sync or repair.
- Keep web, server, shared packages, and Android contracts aligned.
- Keep local-only sync metadata out of API contracts.
- Preserve keyboard and screen-reader access for note actions and settings.
- Do not include secrets, production data, private notes, recovery material, or
  customer information in code, fixtures, screenshots, issues, or logs.
- Keep changes focused; avoid unrelated formatting or refactors.

Read [docs/sync-protocol.md](docs/sync-protocol.md) and
[docs/conflict-handling.md](docs/conflict-handling.md) before changing sync,
repository, encryption, or Android sync behavior.

## Tests

Run the narrowest relevant test while developing, then the applicable project
gates:

```sh
aube run quality
aube run test
aube run test:e2e
aube -F @author/web run build
aube run android:verify
```

For Android, shared contracts, auth, encryption, storage, or sync changes, also
run connected instrumentation when an emulator or device is available:

```sh
aube run android:verify:connected
```

Release-affecting changes should follow
[docs/production-readiness.md](docs/production-readiness.md).

## Pull Requests

A pull request should:

- explain the user-visible problem and the chosen solution;
- identify data-safety, migration, security, or compatibility effects;
- list the exact validation commands run;
- include focused tests for changed behavior;
- update setup, operations, protocol, or schema docs when behavior changes; and
- avoid generated build output and unrelated local files.

Pull requests are licensed under the repository's [MIT License](LICENSE). By
submitting a contribution, you confirm that you have the right to provide it
under that license. Contributors must follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
