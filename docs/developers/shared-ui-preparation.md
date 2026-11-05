# Prepare the shared UI package

Cloud needs a registry artifact it can trace to Waitron source. Keep using
`@waitron/ui-core` with `workspace:*` in Waitron. Prepare a separate private
`@waitron-io/ui-core` release for Cloud; its release number can differ from the
source manifest's version.

Start with a clean, installed checkout at the exact source commit selected by
Cloud's release process. Create an empty output directory outside that checkout:

```sh
mkdir /tmp/waitron-ui-0.2.0
node scripts/release/prepare-ui.mjs /path/to/clean/waitron /tmp/waitron-ui-0.2.0 \
  --release-version 0.2.0 --source-commit "$SELECTED_SOURCE_SHA"
```

Take the release version from Cloud's durable reservation. The extra
`--source-commit` argument binds preparation to the caller's selected full SHA;
preparation refuses a different checkout, tracked or untracked source changes,
and nonempty output. The build runs the package's existing `prepack` script.
Changes to tracked source or its commit during that build are refused too.
Ignored files and installed dependencies are outside that cleanliness check, so
use Cloud's isolated frozen-lockfile source job for release preparation.

The output contains `waitron-io-ui-core-0.2.0.tgz` and `preparation.json`.
The staged manifest records the original repository, commit and source version
in `waitronSource`. It retains built JavaScript, declarations, export paths,
CSS and the Lit peer, removes development and lifecycle metadata, and points at
Cloud's existing restricted GitHub Packages association. Both delivered notices
must equal the selected source's `LICENSE` and `LICENSE-GRANTS.md` byte for byte.

The receipt records the tarball hash and npm integrity value, manifest and notice
hashes, preparation-script hash, tool versions and hashes of tracked UI-package,
root build/lock/licence and workflow inputs. It is build evidence, not a source
CI verdict or a version reservation. Cloud must independently select successful
trusted main runs at that exact SHA, validate its complete build-input inventory,
reserve the version, review these bytes and perform its upload/readback checks.
This utility neither selects green source nor publishes a package.

Exercise both workspace and staged identities with the same independent
TypeScript, bundle, browser and accessibility checks:

```sh
pnpm --filter @waitron/ui-core test:package
```

To test a particular prepared artifact, pass its absolute path:

```sh
UI_PACKAGE_TARBALL=/tmp/waitron-ui-0.2.0/waitron-io-ui-core-0.2.0.tgz \
  pnpm --filter @waitron/ui-core test:package
```

That option tests only the supplied registry artifact. It checks its source
version against this checkout and the SHA's spelling; compare the full
`waitronSource.commit` and tarball integrity with the selected release record
before accepting it. Cloud's portal, image and authenticated registry-install
qualification still belong to Cloud's release process.
