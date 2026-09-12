# B1 implementation and acceptance

Design: [Connect to a box before entering setup details](../specs/2026-09-12-box-trust-onboarding-design.md).

1. Reproduce the missing routes, missing connection step and incomplete guide with failing tests.
   Probe Chrome's certificate warning separately to constrain what the connection check can claim.
2. Add matching help/download routes to both listeners and point installer output/QR at the guide.
3. Add the setup entry check and failure help, preserving drafts and terminal provisioning responses.
4. Expand the guide across the common OS/browser combinations and record the source boundaries.
5. Run focused regressions, setup/server coverage, a production setup build and the repository gate.
   Inspect the rendered guide at desktop and phone widths and test keyboard disclosures.
6. Update the backlog and UI tracker. Record actual system trust installation/replacement separately
   from browser rendering and API tests. Announce readiness for finish-branch after validation.

## Execution receipts

- Before implementation, `pnpm --filter @waitron/server test src/trust-page.test.ts
  src/discovery-api.test.ts src/landing-app.test.ts`: 3 failed, 17 passed. Missing mirrored paths
  returned 404; the guide lacked the new OS/browser and replacement guidance.
- Before implementation, `pnpm --filter @waitron/setup test src/setup-app.test.ts`: 2 failed,
  65 passed. The new cases expected a connection screen; the existing shell opened mode directly.
- After the entry implementation, the same setup command passed all 67 tests.

- The stale-read regression failed before the generation check: an old rejected boot read displayed
  its error after a newer check succeeded. The fixed shell's 69 tests pass.
- `pnpm --filter @waitron/setup test:coverage`: 30 files, 266 tests passed; statements/lines 96.68%,
  branches 91.02%, functions 97.5%. The first run found seven dark-theme link contrast failures;
  the help links now use the shared primary text colour and the full rerun passes.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`: 242 files,
  3,049 tests passed; statements/lines 97.39%, branches 95.27%, functions 97.82%.
- `pnpm --filter @waitron/setup build` passed. `/tmp/waitron-b1-render.ts` served that build and
  the real landing/discovery handlers with a temporary CA. Chromium, Firefox and WebKit passed
  HTTP/HTTPS guide and certificate downloads, keyboard disclosure, 390/1280-pixel layouts, and
  the connection step's Continue transition. These isolated contexts ignored the fixture's TLS
  error; this is not evidence of installing trust in an OS. Screenshots: `/tmp/waitron-b1-guide-390.png`
  and `/tmp/waitron-b1-guide-1280.png`.
- Full repository gate passed: `pnpm lint && pnpm typecheck && pnpm format:check &&
  TESTCONTAINERS_RYUK_DISABLED=true pnpm test` (exit 0). Logs are
  `/tmp/waitron-b1-gate-{lint,typecheck,format,test}.log`. The final setup wording also passed
  its complete coverage suite; production setup was rebuilt afterwards.
- Physical OS/browser certificate installation and replacement remain pending in `docs/ui-review.md`.
  No venue box was re-imaged or deployed, and no OS trust store was changed by these checks.
