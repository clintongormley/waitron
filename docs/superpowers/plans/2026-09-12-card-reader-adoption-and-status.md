# Card reader adoption and status

Implement the [approved design](../specs/2026-09-12-card-reader-adoption-and-status-design.md).

1. Add failing provider tests for account reader listing, structured status, unavailable status and
   Stripe's millisecond timestamp. Extend the common contract and both seats; update all test seats
   and both browser status mirrors. Preserve the pairing completion assertions.
2. Add server regressions for adoption, credential changes during listing, local enable/disable,
   rename and separate unpair. Exercise tenant isolation on real PostgreSQL as `app_user`, including
   the available-reader comparison and adoption of the same vendor reference in two tenants.
   Rename the payments schema column to `disabled_at` without a compatibility migration.
3. Add browser regressions before the generic discovery dialog, row menu, forms, filters, battery,
   details and explicit refresh. Preserve provider pairing dialogs; cancellation returns to discovery.
   Move SumUp's pairing cancellation to the separate unpair endpoint.
4. Run affected package coverage and the full repository gate. Use deletion controls for forged
   adoption and Unknown status, and the seconds/milliseconds control for Stripe. Audit current prose
   and update the backlog. Confirm adoption and battery on the owner's Solo when live access permits.

The Stripe SDK timestamp is already milliseconds: JavaScript `Date` takes milliseconds, so use the
value directly to produce ISO text. Dividing by 1000 is needed only for a seconds-based date API.


## Verification receipts

- Provider tests failed before implementation: missing `readers.list`, missing telemetry, and the old
  unreachable detail. The updated SumUp and Stripe suites passed (26 and 21 tests respectively).
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/payments-api.pg.test.ts`
  passed the route regressions. The suite queries `current_user` and `rolsuper` and gets
  `{ role: "app_user", rolsuper: false }`; it then exercises the two-tenant operations through the
  real management routes. Full server coverage includes the final 33 route regressions.
- Removing the adoption list check made the forged-reference regression receive 201 instead of 422.
  Removing the dashboard's `unreachable` check made its Chromium regression display Offline instead
  of Unknown. Treating Stripe's timestamp as seconds returned year 58667 instead of 2026. Each
  control restored its source in a `finally` block before the passing coverage runs.
- Package `test:coverage` passed: Payments 409 tests, SumUp 128, Stripe 131, dashboard 1,621, server
  3,003. These are whole-package runs, including the provider browser projects and PostgreSQL fixtures.
- `pnpm --filter @waitron/payments db:generate --name reader_adoption` reported no schema changes;
  the renamed CREATE statement and saved snapshots agree with the source schema.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and the full `pnpm test` passed. The final
  workspace test command exited 0; its log is `/private/tmp/waitron-adoption-workspace-gate.log`.
  Earlier attempts and their retained failure evidence are described below.
- Live Solo adoption and a comparison with its reported battery remain pending environment access.


The next full-gate attempt stopped before the WireGuard change-feed test body: Testcontainers timed
out waiting for a published port. `docker inspect c58e09f22340` showed PostgreSQL healthy and
`HostConfig.PortBindings["5432/tcp"] = [{ HostIp: "", HostPort: "0" }]`, but
`NetworkSettings.Ports["5432/tcp"] = []`. The focused change-feed suite then passed both LAN and
WireGuard cases without code changes. That rerun does not explain or fix the missing Docker binding.
The failed gate log and container state were retained in `/private/tmp/waitron-adoption-workspace-test-final.log`
and `/private/tmp/waitron-adoption-wireguard-container.txt`.
