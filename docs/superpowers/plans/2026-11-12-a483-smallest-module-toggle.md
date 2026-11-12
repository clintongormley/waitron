# A483: smallest module switch

**PLAN FOR APPROVAL.** Lane D `queue.md`, A483-rest; source read at `478cc04cb9`, not runtime verification. Await Claude and watcher clearance; no owner approval claimed. Implement inline. References: `docs/backlog/architecture.md:270/702`, A483 #1544, current A646 plan (2026-11-11).

**Choose bookings.** Descriptor receipt: `packages/composition/src/modules.ts:229–389`. Counts below come from each package’s `src/classification.ts` (workforce:11/44, workforce-es:6, payments:11/25, bookings:9, staffing:4).

| Module | Owned tables | Migration-set tables | Append-only |
| --- | ---: | ---: | ---: |
| workforce | 16 | 21 | 2 |
| workforce-es | 1 | 1 | 0 |
| payments | 9 | 10 | 3 |
| bookings | 1 | 1 | 0 |
| staffing | 5 | workforce’s 21 | 0 |

Staffing requires workforce and uses `tablesIn: "workforce"`; zero independent migrations does not mean zero tables. Bookings ties workforce-es without its rules/export consumers (`apps/server/src/workforce-api.ts`, `boot.ts:2446`).

**Watcher decision:** permit a maintenance restart for this first switch? Recommend reusing boot admission. This departs from A646’s no-restart design (§“Applying a change”); if refused, revise this plan before building.

1. **Retained protection prerequisite.** In `apps/server/src/{boot,append-only-watch}.ts`, separate migration selection from protection selection. Keep setup-all/trading-enabled `orderedMigrationSets` → `migrationOptionsFor` → `applyMigrations` (`boot.ts:1227`). Do not migrate dormant sets. For installed toggleable sets, reuse `journalHashes`/`imageMigrationHashes` and classifications against today’s single baselines; refuse unknown/malformed history, orphan tables or missing declared tables before repair. No historical-schema catalogue. Extend the selected protection list with dormant toggleable declarations. Reuse `missingBeforeMigration`, `installAppendOnlyTriggers`, `assertAppendOnlyIntact` and `tamperWatchJob`: restore missing pairs with the existing warning, refuse altered pairs, retain expectations during trading. This explicitly required shared repair covers disabled workforce/payments records; bookings itself has no append-only table. New markers on existing dormant tables need installation without enabling their module.

2. **Bookings-only command.** Extend `mountModulesApi` in `modules-api.ts`: primary-only, administrator (`person.admin`) POST `/management-api/modules/bookings/state`, boolean desired/expected state. Serialize authorization and fresh read/merge/write through existing database turns; preserve unrelated overrides using `readModuleConfig`/`writeModuleConfig`. Reject stale state and other module ids. Reuse `restartAfterResponse`/`restartProcess`. Keep GET reporting boot-applied state until restart. In dashboard `api/client.ts` and `screens/modules-screen.ts`, expose only bookings On/Off, explain interruption, confirm, then reconnect/reload. Boot migrates before admitting routes, floor annotations, feeds and `/me` navigation. Preserve installed-module table-removal checks (`boot.ts:2441`); Off retains bookings, On reveals them again. Other four switches remain unavailable.

**TDD:** add assertions, observe intended failure, implement minimally, rerun with a passing Tests count. Server owners: `append-only-watch.test.ts`/`boot.failed-start.test.ts` cover dormant repair, altered-trigger refusal, missing tables, new markers, never-installed control and running tampering; `modules-api.test.ts` covers authorization/stale/concurrent writes; new `boot.module-toggle.test.ts` owns restart, first installation and populated Off/On, including routes/floor/feeds/navigation. Preserve `boot.table-removal.test.ts`. Dashboard `modules-screen.test.ts` owns confirmation/reconnect/refusal. Use `useVenueDb`; no outside fixture writes while serving.

Run `pnpm --filter @waitron/server exec vitest run src/{append-only-watch,boot.failed-start,modules-api,boot.module-toggle,boot.table-removal}.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run src/screens/modules-screen.test.ts`; `pnpm exec vitest run scripts/append-only-triggers.test.ts`. Update EN/ES `apps/server/src/guide/{en,es}/modules.md`, dashboard wording, developer protection claims and A483/A646 backlog limits; inspect both themes/phone width. Normal hook, current-head CI and migration/append-only risk review wave follow.

**Estimate:** production ~250–350 lines; tests ~300–450; support/docs ~50–80. Exclude other switches, live switching, new records/protocols/frameworks, fiscal behavior/fiscal-none transitions, pragma monitoring and altered-trigger recovery tooling.
