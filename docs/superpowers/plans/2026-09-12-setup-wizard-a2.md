# Setup wizard A2 implementation

Design: [Setup wizard A2](../specs/2026-09-12-setup-wizard-a2-design.md).

1. Reproduce unknown-path behavior and implement setup-only redirects with asset/API controls.
2. Add country-owned Demo generation and fiscal-owned defaults; test both boundaries before wiring the wizard.
3. Shorten Demo, preserve review/back behavior, clear generated data on mode changes, and implement shop field help/errors/defaults.
4. Add first-operator and certificate help, native reveal controls and platform-specific export guidance.
5. Add the operation-description dashboard read/write/editor with fiscal validation and authorization tests.
6. Run affected coverage and the complete gate, audit changed behavior against documentation, update A2, and report readiness for finish-branch.

## Implementation and checks

Steps 1–6 are complete. Regression tests first reproduced the missing redirects, defaults,
Demo field hiding, password controls and dashboard endpoints. Two additional failing probes caught
an accepted manager session from another tenant and the lost province-based language default after
leaving Demo; both now pass.

Changed-package coverage passed with:

```sh
TESTCONTAINERS_RYUK_DISABLED=true node scripts/run-with-deadline.mjs 1200 -- pnpm \
  --filter @waitron/server --filter @waitron/fiscal-verifactu --filter @waitron/fiscal \
  --filter @waitron/country-es --filter @waitron/country --filter @waitron/dashboard \
  --workspace-concurrency=2 -r test:coverage
pnpm --filter @waitron/setup test:coverage
```

The complete gate passed: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
(with `TESTCONTAINERS_RYUK_DISABLED=true` for tests). After the workspace run had passed setup,
the final setup changes were checked again with its coverage (292 tests), `typecheck` and `lint`.
The workspace run completed every package, including those outside the changed set.
Certificate guide selection is covered in
Chromium; the export steps were checked against FNMT's linked documentation rather than executed
against personal certificates in the operating-system stores.

## Branch review

Rebased onto `5a0bcb288491db0419801bdd3a91965b01e8aa0a`, retaining #330's initial connection
screen and discovery request alongside A2's defaults. The combined setup suite passed 303 tests.
One Claude Opus 5 run-it review took 375 seconds and reproduced no critical or important defect.
Its deletion test caught removal of the new route's tenant comparison; its browser probe confirmed
that a generated Demo identity does not survive navigation into Live.

The accepted accessibility finding now has a failing-then-passing browser assertion: Next focuses
the existing explanation when Demo defaults are unavailable. A new real-PostgreSQL regression records
a sale, edits the description through the management route, records another sale, and reads both
fiscal records. The earlier record retains its text and the later one receives the edit; all 11
location-settings route tests pass. The reported `/manage` prose is within the explicitly historical
walkthrough, and GET-only redirects match the browser-navigation requirement.

Server-staged configuration cleanup across mode changes was not exercised by this review; A2 clears
the local import request flag and does not claim to remove the server artifact. Physical certificate
export remains unverified as stated above.

After the first green PR run, #333 advanced main with overlapping dashboard navigation and strings.
A second rebase onto `025276c7c76f1e401a37ecd116c8d1108836bcbf` applied cleanly. The required fresh
Claude Opus 5 review took 185 seconds and reproduced no correctness or regression defect. It ran
the real-PG invoice regression and deleted the fiscal validator: the control-character and length
cases then failed, while the generic type/blank checks still passed. The original value-preservation
decision is now explicit in the design. Future country packs without Demo generation remain outside
the enabled setup list; enabling one requires a separate Demo-flow decision.

The force-push hook selected #333's packages after rebase. Its resolved dependencies covered A2's
dashboard, server, setup and fiscal-verifactu, but omitted country, country-es and fiscal. Explicit
typechecks and coverage covered those three. An unnecessarily overlapping fiscal-verifactu run
failed writing `coverage/.tmp/coverage-41.json` with `ENOENT`; Vitest 3.2.7's coverage provider
creates and removes the directory under `reportsDirectory` (`coverage.DfSpMS-b.js:3998,4013–4023,4070`).
The follow-up used a separate `/tmp` report directory. Never infer the selected dependency set
from the hook's short package label alone.

The second workspace run passed every package except one dashboard test: `service-status-screen`
reported Playwright's `Frame was detached` on Enter. Its focused suite then passed all 15 tests
without a code change; that rerun does not explain the first failure. The original log and screenshot
are retained with the finishing artifacts rather than treating it as a repaired regression.
The subsequent full dashboard coverage run passed all 1,682 tests without a code change. The
force-push hook passed in 546 seconds; the isolated fiscal-verifactu coverage run passed all 400
tests and its thresholds. Combined with the explicit country/fiscal checks, coverage includes every
A2 package despite the hook's incorrect initial scope.
