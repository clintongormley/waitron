# Publish the shared UI package

Cloud consumes a private registry release of Waitron's shared account controls.
Keep using `@waitron/ui-core` with `workspace:*` in Waitron; the published package
has the separate name `@waitron-io/ui-core`.

When a push to `main` changes `packages/ui-core/**`,
[Publish shared UI](../../.github/workflows/publish-ui.yml) checks the source
package, builds the merged commit and checks its tarball in an independent
browser consumer. It publishes `0.2.<workflow run number>` to GitHub Packages.
The source manifest keeps its workspace version. Publications share a concurrency
queue and run one at a time.

The owner stores `UI_PACKAGES_WRITE_TOKEN` as an Actions secret. Only the final
publish step receives it. The prepared manifest keeps the existing Cloud
repository association and records the full Waitron commit in `waitronSource.commit`.
The package carries built JavaScript, declarations, CSS, the Lit peer dependency,
Elastic License 2.0 and `LICENSE-GRANTS.md`.

Check the workflow result after a qualifying merge. A publication error fails the
run; the next qualifying merge attempts a new numbered version. There is no
scheduled publisher or catch-up process. The first real publication from this
workflow must still establish that its token can publish to the existing private
package. Cloud owns authenticated installation, dependency updates and portal/image
qualification under its [approved release plan](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/plans/2026-11-06-simple-private-ui-release.md).

## Inspect a package locally

To prepare a tarball without publishing, start with a clean, installed checkout
at the commit you want to inspect. Create an empty output directory outside it:

```sh
mkdir /tmp/waitron-ui-inspection
node scripts/release/prepare-ui.mjs /path/to/clean/waitron /tmp/waitron-ui-inspection \
  --release-version 0.2.742 --source-commit "$(git rev-parse HEAD)"
```

Preparation checks the selected commit and source cleanliness, builds the package
and writes `waitron-io-ui-core-0.2.742.tgz` and `preparation.json`. The latter is
local build evidence; the publisher does not upload it or use it to allocate a
version. Give concurrent preparations separate checkouts because each build writes
`dist`. Ignored files and installed dependencies are outside the cleanliness check.

Run the independent consumer against these exact bytes:

```sh
UI_PACKAGE_TARBALL=/tmp/waitron-ui-inspection/waitron-io-ui-core-0.2.742.tgz \
  UI_PACKAGE_RELEASE_VERSION=0.2.742 \
  UI_PACKAGE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  pnpm --filter @waitron/ui-core test:package
```

Without these variables, `test:package` checks both the workspace tarball and a
locally staged `0.2.0` artifact. It checks declarations, bundling, browser behavior
and accessibility. A local pass does not establish registry access.
