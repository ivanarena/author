# Public GitHub Publication Checklist

This checklist separates publishing Author's source code from publishing a
production service, container, or signed Android APK. Making a repository public
does not prove that a deployment or binary release is production-ready.

## Before Changing Repository Visibility

- [x] Confirm every committed source file, image, font, icon, screenshot, and
      other asset may be redistributed under its stated license. The original
      Author app icon and its derived launcher/favicon files are recorded in
      [Asset Provenance](../ASSET_PROVENANCE.md).
- [x] Review all Git author names and email addresses in the complete history.
      The maintainer accepted the historical public-profile address on September
      17, 2026; repository-local future commits use the GitHub noreply address.
- [ ] Scan every branch, tag, and existing GitHub pull-request head for secrets,
      not only the current checkout:

  ```sh
  git fetch origin '+refs/pull/*/head:refs/remotes/origin/pull/*'
  go run github.com/zricethezav/gitleaks/v8@v8.30.0 git \
    --log-opts="--all" --redact --verbose .
  ```

- [ ] Review tracked environment examples, issues, pull-request descriptions,
      review comments, workflow logs, release pages/evidence, and historical
      artifacts for real credentials, private infrastructure details, or user
      data. Those records may become visible with the repository.
- [ ] Ensure `main` contains the intended public release, all required CI and
      security jobs pass for that exact commit, and the matching version tag is
      immutable.
- [ ] Verify `LICENSE`, `THIRD_PARTY_NOTICES.md`, `SECURITY.md`,
      `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SUPPORT.md` are current.
- [ ] Confirm the privacy and terms pages match the service actually being
      offered. Self-hosters who offer accounts to others need their own legal
      review and operator-specific policy.
- [x] Review every existing GitHub release and asset that will become public.
      On September 17, 2026, all 21 release APKs passed digest, signature,
      cleartext, embedded-origin, and extracted-string secret checks. The
      malformed v1.0.7 APK was removed and its release marked withdrawn; the
      v1.0.0 release now documents its historical package identifier. No staging
      or preview origin was present in a release APK.
- [ ] After these documentation changes reach `main`, add the source, license,
      third-party-notice, support, and latest-supported-release links to every
      retained GitHub release description.
- [x] Delete or expire retained Actions artifacts that were intended to stay
      private, especially production-signed test APKs built against staging.
      On September 17, 2026, all 235 retained artifacts were deleted after
      confirming that completed workflows and release gates do not depend on
      them; future workflows regenerate their reports and artifacts.
- [x] Disable version-specific Preview URLs on the production Cloudflare Worker.
      Uploaded versions inherit production secrets and database bindings, so
      branch previews belong on the isolated staging Worker. The stable
      production route remains enabled and healthy.
- [x] Keep Cloudflare Workers Builds from bypassing release gates. The `main`
      trigger builds but does not deploy, while the non-production trigger uses
      Aube 1.16.0 and uploads only `development`; the manual GitHub Actions
      workflow remains the production deployment authority.

## GitHub Repository Settings

- [ ] Set a concise description, homepage if applicable, and topics such as
      `notes`, `offline-first`, `self-hosted`, `sveltekit`, `sqlite`, and
      `android`.
- [ ] Keep `main` protected: require the applicable CI and Security checks,
      linear history, resolved conversations, and no force-push or deletion.
      Include the full-history secret scan and both CodeQL analyses rather than
      protecting only the build/test workflow.
- [ ] Enable private vulnerability reporting and keep the
      [security advisory form](https://github.com/ivanarena/author/security/advisories/new)
      reachable.
- [ ] Enable code scanning after the repository becomes public. The Security
      workflow automatically uploads CodeQL and OpenSSF Scorecard results for a
      public repository and retains SARIF artifacts for review.
- [ ] Enable the dependency graph, Dependabot alerts and security updates,
      secret scanning, and push protection where GitHub makes them available.
- [ ] Review Actions permissions and keep the default token read-only unless a
      job explicitly needs package, release, or security-event writes. Configure
      the approval policy for workflows submitted from public forks.
- [ ] Decide whether GitHub Discussions or issues will provide public support;
      document that decision in `SUPPORT.md`.
- [ ] Review stale branches, workflow artifacts, Actions caches, environments,
      variables, secrets, and deploy keys. Repository secrets are not exposed by
      a visibility change, but their names, consumers, and rotation policy still
      need review.

## Public Self-Hosting Release

- [ ] Run `aube run release:verify:connected` from a clean checkout.
- [ ] Run `aube run docker:verify` and review the Trivy result.
- [ ] Restore a fresh SQLite or Turso backup into an isolated environment and
      run `db:check`.
- [ ] Publish release notes with supported upgrade paths, known limits, checksums,
      and rollback instructions.
- [ ] If publishing GHCR images, set package visibility deliberately; repository
      visibility does not necessarily change an existing package's visibility.
- [ ] Generate the exact production dependency-license inventory and include all
      license texts, notices, source offers, and font attributions required by
      the web bundle, container, or APK. `THIRD_PARTY_NOTICES.md` is a guide, not
      a generated binary-distribution license bundle.
- [ ] Verify the published image by immutable digest and verify its Cosign
      signature, SBOM attestation, and provenance attestation.
- [ ] If publishing an Android APK, verify its signing certificate, SHA-256,
      configured HTTPS API/update origins, upgrade path, and notification flow.

## Claims

Public copy may describe Author as local-first, self-hostable, and encrypted
before sync. Do not describe it as independently audited, hardened
zero-knowledge, enterprise-grade E2EE, or protected from malicious hosted web
JavaScript unless the missing assurance work has actually been completed.

The detailed release gates remain in [Production Readiness](production-readiness.md).
