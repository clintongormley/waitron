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
