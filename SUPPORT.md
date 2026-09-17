# Support

Author is maintained as a small open-source personal notes app. Community
support is best-effort; there is no guaranteed response time or hosted-service
SLA.

## Before Asking

- Read the [self-hosting guide](docs/self-hosting.md).
- Check [setup](docs/setup.md), [operations](docs/operations.md), and the
  [production-readiness checklist](docs/production-readiness.md).
- Search existing GitHub issues and release notes.
- Reproduce with the latest supported release when possible.

For a setup or bug report, include:

- the Author version or commit;
- deployment type: Docker/SQLite, Node, Cloudflare/Turso, or Android;
- operating system, browser, and Android version where relevant;
- exact steps and the expected/actual result; and
- sanitized logs that contain no note text, email addresses, tokens, database
  URLs, recovery material, passwords, or other secrets.

Do not upload production databases or `.env` files.

## Where to Report

- Use a GitHub issue for reproducible non-security bugs and documentation
  problems.
- Open a discussion or proposal issue before a substantial feature or product
  direction change.
- Use [SECURITY.md](SECURITY.md) for vulnerabilities. Never post exploit or
  credential details publicly.
- Review [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code.

Self-hosted operators are responsible for their infrastructure, TLS, backups,
monitoring, account policy, legal notices, and incident response. The project
cannot recover lost encryption keys, recovery codes, databases, or signing
keys.
