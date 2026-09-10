# CI failures in run 34507423350

The [failed run](https://github.com/clintongormley/waitron/actions/runs/34507423350)
tested `101849854d5b18b1d3eac6c68a915a051317d3f9`. Its dashboard and db shard 1 failed;
`ci` failed because those dependencies failed. `git diff <that SHA> d726ba97 --
packages/db apps/dashboard` printed no changes: the affected package trees matched
this investigation's starting commit on main.

## Dashboard

The job log names `profile-screen.test.ts:216`: `startRegistration` was the real
async function when the test expected a spy. It does not show why the mock missed.

Both the ordinary local coverage run (98 files, 1,430 tests) and a four-file run
placing unmocked accessibility suites before mocked login/profile suites passed.
A local pass therefore does not establish that the failure is repaired.

A controlled preload reproduces the reported error. In `apps/dashboard`, create a
temporary `src/webauthn-preload.repro.ts` containing:

```ts
import "@simplewebauthn/browser";
```

Use a temporary `vitest.repro.config.ts` to load it before the tests:

```ts
import { mergeConfig } from "vitest/config";
import config from "./vitest.config.js";
export default mergeConfig(config, {
  test: {
    fileParallelism: false,
    setupFiles: ["./src/webauthn-preload.repro.ts"],
  },
});
```

Run from the workspace root:

```sh
pnpm --filter @waitron/dashboard exec vitest run --config vitest.repro.config.ts src/screens/profile-screen.test.ts src/screens/login-screen.test.ts
```

With the original tests, 32 tests failed and nine passed: profile reported the
same non-spy error, and login reported `mockClear is not a function`. With the
revised tests, all 41 passed under the same preload. Delete both temporary files
after the experiment. The recorded probe also sorted accessibility files first;
only the two non-accessibility files were selected for this preload comparison.

The tests now stub `navigator.credentials.get/create` and use the real WebAuthn
library. Assertions cover the decoded challenge/user id passed to the browser,
the returned credential fields encoded for the server, the challenge handle,
login completion, and authenticated passkey removal. Loading the library early
no longer bypasses the stub. This experiment does **not** establish the exact
import ordering that occurred on CI.

## Database

The failed shard uploaded `db-blob-1` even though its coverage merge was skipped.
You can retrieve it with `gh run download 34507423350 --name db-blob-1` while the
artifact is retained (one day). Decode `blob-1.json` with `flatted.parse`, the
serializer used by the installed Vitest, rather than ordinary `JSON.parse`.

The report names `src/deployment.test.ts`. Collection failed at
`resolveTargets` in `src/testing/harness.ts` with `REQUIRE_DOCKER is set but Docker
is not available`. Global setup had already started/migrated the shared container;
other real-Postgres suites in the shard passed. The old probe ran `docker info`
with a ten-second timeout in each isolated test-file module graph and converted
any exception into `false`. It discarded the cause, so this report cannot tell
you whether that command timed out or failed for another reason. It is not a
receipt for a PostgreSQL container-start or lock-contention failure.

`harness.docker.test.ts` supplies a shared handle and makes the CLI throw a timeout.
Before the fix, the availability assertion failed (`false` instead of `true`);
afterwards all three probes passed. They also check successful CLI caching without
a shared container and the required-Docker error when neither is available.
The existing harness smoke suite still creates/queries both real PostgreSQL and
PGlite databases. The full db coverage run passed 557 tests with two skips and
99.24% statements/lines, 98.25% branches, 99.35% functions.

The availability check now uses the handle supplied by global setup before
considering the CLI fallback. Database connections and new container starts still
run and can fail; this change does not retry or suppress those failures.

## Failure visibility

Both sharded packages (`db` and `server`) retain the blob reporter and add the
default console reporter. The existing root workflow guard failed when the console
reporter was missing and passed after both scripts changed. You can read a failed
test directly in future shard logs without depending on a successful coverage
merge or an unexpired artifact.

A deliberate failing `reporter.repro.test.ts` run through `test:shard` printed
`FAIL src/testing/reporter.repro.test.ts` and its assertion, exited 1, and wrote
a nonempty `/tmp/waitron-reporter-control.json` blob. The temporary test was
removed after this control.

## Final validation (2026-09-10)

`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, and
`TESTCONTAINERS_RYUK_DISABLED=true REQUIRE_DOCKER=1 pnpm test` all exited 0.
The final dashboard coverage run passed all 98 files and 1,430 tests with
98.24% statements/lines, 93.63% branches, and 96.54% functions. The db coverage
result is recorded above. No CI rerun was used as evidence of repair.
