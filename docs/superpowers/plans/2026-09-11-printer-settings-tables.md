# Implementation

1. Add failing tests for the three table layout and modal interactions.
2. Add agent host reporting/rename, exact printer statistics and a safe stored-job preview API.
3. Move printing rules to their own page, preserving their behavioral tests.
4. Replace inline printer forms with tables, row menus and validated add/edit modals. Keep pairing,
   discovery, re-allow and diagnostic-print behavior available.
5. Update both locales and documentation; run focused tests/coverage and the whole repository gate.

Validation commands (run from the feature worktree; browser and PostgreSQL tests run on the host):

- `pnpm --filter @waitron/ui test:coverage` — modal layout, focus and accessibility.
- `pnpm --filter @waitron/dashboard test:coverage` — printer tables, modals, discovery, previews and printing rules.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` — authenticated APIs, statistics and preview isolation.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` — schema and configuration export.
- `pnpm lint && pnpm typecheck && pnpm format:check && TESTCONTAINERS_RYUK_DISABLED=true pnpm test` — complete repository gate.

Each command must finish successfully; coverage commands must also meet their package thresholds.
