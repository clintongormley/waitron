# Publish the shared UI and signing packages

Cloud consumes a private registry release of Waitron's shared account controls.
Keep using `@waitron/ui-core` with `workspace:*` in Waitron; the published package
has the separate name `@waitron-io/ui-core`.

When a push to `main` changes `packages/ui-core/**` or `packages/contract/**`,
[Publish shared packages](../../.github/workflows/publish-ui.yml) checks both source
packages, builds the merged commit and checks each tarball in an independent
consumer: UI in Chromium, signing in Node. It publishes `0.2.<workflow run number>` to GitHub Packages.
The source manifest keeps its workspace version. Publications share a concurrency
queue; one workflow runs at a time, with independent jobs for the two packages.

The owner stores `UI_PACKAGES_WRITE_TOKEN` as an Actions secret. Only the final
publish step receives it. The prepared manifest keeps the existing Cloud
repository association and records the full Waitron commit in `waitronSource.commit`.
Both packages carry built JavaScript, declarations, Elastic License 2.0 and
`LICENSE-GRANTS.md`. UI also carries CSS and its Lit peer; the signing package has no peers.

For contract, the final step checks the token’s authenticated identity, `write:packages`
scope and its private Cloud association. The contract package may be absent before
its first upload. After upload, the same
check requires its private association; registry output records the numbered version's
integrity, source commit and repository. A pre-upload pass alone does not establish
permission to create a new package. Cloud must then install that exact version with
its own workflow token; a refused install needs a package access grant for Cloud.

Check the workflow result after a qualifying merge. Read the final step’s log before
retrying a failed run: the upload may have succeeded before a later metadata check
failed. A retry uses the same version and cannot upload it again. The next qualifying
merge attempts a new numbered version. An older run can
be refused if a higher package version has already been published. There is no
scheduled publisher or catch-up process.

The [first publication on 7 November 2026](https://github.com/clintongormley/waitron/actions/runs/42376444927)
released private `@waitron-io/ui-core@0.2.1`. Its downloaded registry tarball records
`47dda656b641794051c64d3752937ea7f2929f51` in `waitronSource.commit`; its SHA-512 integrity
and both licence files were checked against the registry metadata and source files.
That run established upload to the existing Cloud-associated package. Cloud owns
authenticated installation, dependency updates and portal/image
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

## Inspect the signing package locally

You can use the same preparation and installed-package checks for the Node signing
package. Select `contract` explicitly; omitting the selector still prepares UI:

```sh
mkdir /tmp/waitron-contract-inspection
node scripts/release/prepare-ui.mjs /path/to/clean/waitron /tmp/waitron-contract-inspection \
  --release-version 0.2.742 --source-commit "$(git rev-parse HEAD)" --package contract
CONTRACT_PACKAGE_TARBALL=/tmp/waitron-contract-inspection/waitron-io-contract-0.2.742.tgz \
  CONTRACT_PACKAGE_RELEASE_VERSION=0.2.742 \
  CONTRACT_PACKAGE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  pnpm --filter @waitron/contract test:package
```

The contract has no runtime or peer dependencies. Its installed consumer checks
declarations and the three signing formats in Node, using the shared archive,
source-commit and licence checks. UI keeps its Lit peer and browser checks.
Changes to that shared installed-package checker select both packages in pull-request CI.
The publishing workflow selects both packages. A local check still does not establish
registry access or that Cloud can install the released version with its own credential.
