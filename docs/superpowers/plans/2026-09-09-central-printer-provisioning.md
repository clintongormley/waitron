# Central Printer Provisioning Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stored printer→agent binding with eligibility derived from what each box can currently reach, make USB/Bluetooth/IP printers discoverable and centrally registered, and add Bluetooth as a third live transport.

**Architecture:** A printer no longer names a serving agent. `printers.agent_id`/`usb_path` are removed; `printers.local_key` holds the stable device id (USB serial / Bluetooth MAC). The job-claim query scopes IP printers to the agent's venue and USB/Bluetooth printers to the keys the agent reports seeing that poll; `print_jobs.claimed_by` records the holder and authorises the report. Agents report their visible devices on every poll and run expensive active discovery (network mDNS/sweep, Bluetooth inquiry) only inside a dashboard-opened window; the discovered inventory and the window live in server memory. Bluetooth pairing is a box-local action on the agent's LAN setup page.

**Tech Stack:** TypeScript (Node 24), pnpm workspaces, Drizzle ORM + PostgreSQL, Hono (server), Lit (dashboard), Vitest (+ PGlite, Testcontainers real-PG, headless-Chromium browser mode).

**Spec:** [docs/superpowers/specs/2026-09-09-central-printer-provisioning-design.md](../specs/2026-09-09-central-printer-provisioning-design.md) — read it alongside this plan; the plan argues from it.

## Global Constraints

- **Pre-production: drop-and-recreate, no backfill** (CLAUDE.md §3). The schema change regenerates the core migration; no data migration.
- **Never build SQL by string concatenation** — Drizzle `sql\`… ${value}\`` parameterises; utility DDL (CHECK/FK/UNIQUE/GRANT) is hand-written in the `--custom` migration (CLAUDE.md §3).
- **Error codes name the DOMAIN CONCEPT, never the package**, and are never renamed once shipped (CLAUDE.md §3). New code lives in `packages/printing/src/errors.ts`.
- **A by-id read still needs its own tenant predicate** — one-tenant-per-DB is not the query's isolation boundary (CLAUDE.md §3). Every new query carries `tenant_id = cfg.tenantId`.
- **`@waitron/print-agent` is db-free** — no `@waitron/db`/`@waitron/printing` import; the dependency runs the other way. Enforced by the `import-x/no-restricted-paths` zone in `eslint.config.js`.
- **Coverage:** `@waitron/print-agent`, `apps/print-agent`, `packages/printing` at 90/90/85/85; `packages/db` at 98/98/98/95.
- **Migration regeneration hazard (CLAUDE.md §2 / backlog):** `pnpm --filter @waitron/db db:generate` may propose `DROP TABLE "bookings" CASCADE` (a stale snapshot artifact). Inspect every generated SQL file and delete any DROP the change did not intend before staging.
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you expect (CLAUDE.md §4).
- **Per-task verify:** the changed package's `pnpm --filter <pkg> test:coverage` + `lint` + `typecheck` + `format:check`; run `pnpm typecheck` (whole workspace) once when a shared type changes. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`; run `pnpm reap` if a prior run was interrupted.

---

## File Structure

**Modify:**
- `packages/db/src/schema/printers.ts` — drop `agentId`/`usbPath`; add `localKey`; add `bluetooth` enum value; add partial-unique constraint marker.
- `packages/db/src/schema/print-jobs.ts` — add `claimedBy`.
- `packages/db/drizzle/*` — regenerated core migration + a `--custom` twin (CHECK rewrite, `(tenant_id, printer_id)` FK kept, new `(tenant_id, claimed_by)` FK, partial UNIQUE on `local_key`, grants).
- `packages/db/src/schema/printing.test.ts` (or the existing printer/print-job schema tests) — CHECK per transport, FKs, partial unique.
- `packages/printing/src/printers.ts` — `CreatePrinterInput`/`UpdatePrinterInput`/`PrinterRow`, `REQUIRED_FIELDS`, `createPrinter`/`updatePrinter`/`listPrinters`, `translatePrinterWriteError`.
- `packages/printing/src/errors.ts` — add `printer.already_registered`; update `printer.invalid_config` doc.
- `packages/printing/src/runtime.ts` — `claimPrintJobs` (eligibility + `claimed_by` + RETURNING `local_key`), `ClaimedJob`, `reportPrintJob` (by `claimed_by`), `runAgentOnce` target.
- `packages/print-agent/src/transport.ts` — `PrintTransport += "bluetooth"`; `PrinterTarget.usbPath → devicePath`; `usb`/`bluetooth` adapters; `RoutingTransport`.
- `packages/print-agent/src/host.ts` — `Host` gains `visibleDevices`/`scan`/`resolve`/`pair`; new `VisibleDevice`/`DiscoveredDevice`/`PairResult` types.
- `packages/print-agent/src/client.ts` — `WireJob.usbPath → localKey`; `PullReply.discoveryUntil`; `pullJobs` becomes POST carrying inventory.
- `packages/print-agent/src/agent.ts` — report inventory each tick; scan within the window; `resolve` before `send`.
- `apps/server/src/print-api.ts` — create/patch bodies (`localKey`), pull→POST with inventory + in-memory discovered store + `discoveryUntil` reply, two new management routes, STATUS map (`printer.already_registered` 409).
- `apps/print-agent/src/*` — the real container `Host` implementations (USB sysfs scan/resolve, network mDNS/sweep scan, Bluetooth inquiry/pair/resolve) + the setup-page Bluetooth section; `Dockerfile`/compose access.
- `apps/dashboard/src/screens/printers-screen.ts` + `apps/dashboard/src/api/client.ts` — transport-aware create flow, discovered-printers list, discover button, drop the agent dropdown/column, new client methods.
- `apps/server/src/print-api.e2e` (the existing end-to-end suite in `apps/server`) — register + pull-with-inventory + bytes-land + revoke.

**Create:** none (no new tables, no new packages).

---

## Task 1: Schema + migration — derive-not-store shape

**Files:**
- Modify: `packages/db/src/schema/printers.ts:12` (enum), `:35-76` (columns/constraints)
- Modify: `packages/db/src/schema/print-jobs.ts:40-79`
- Create/Modify: `packages/db/drizzle/*` (regenerated pair)
- Test: `packages/db/src/schema/printing.test.ts` (extend the existing printer/print-job schema suite — real PG via `describeEachTarget` for the CHECK/FK/unique)

**Interfaces:**
- Produces: `printers.local_key` (text, null for network_tcp/cloud_poll); `print_transport` enum value `bluetooth`; `print_jobs.claimed_by` (uuid, null); partial UNIQUE `printers_local_key_key` on `(tenant_id, location_id, local_key) WHERE local_key IS NOT NULL`; the `(tenant_id, claimed_by) → print_agents(tenant_id, id)` composite FK.
- Consumes: nothing.

- [ ] **Step 1: Write the failing schema tests.** In the printer/print-job schema suite, add real-PG cases:

```ts
// usb/bluetooth require local_key; network_tcp requires host; cloud_poll requires poll_id.
it("rejects a usb printer with no local_key (CHECK 23514)", async () => {
  await expect(insertPrinter({ transport: "usb", localKey: null })).rejects.toMatchObject({ code: "23514" });
});
it("accepts a usb printer keyed on a serial", async () => {
  await expect(insertPrinter({ transport: "usb", localKey: "SN-ABC123" })).resolves.toBeDefined();
});
it("accepts a bluetooth printer keyed on a MAC", async () => {
  await expect(insertPrinter({ transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" })).resolves.toBeDefined();
});
it("rejects a network_tcp printer with no host (CHECK 23514)", async () => {
  await expect(insertPrinter({ transport: "network_tcp", host: null })).rejects.toMatchObject({ code: "23514" });
});
it("rejects a second registration of the same (location, local_key) (UNIQUE 23505)", async () => {
  await insertPrinter({ transport: "usb", localKey: "SN-DUP" });
  await expect(insertPrinter({ transport: "usb", localKey: "SN-DUP" })).rejects.toMatchObject({ code: "23505" });
});
it("allows two printers with NULL local_key in one location (partial index)", async () => {
  await insertPrinter({ transport: "network_tcp", host: "10.0.0.1" });
  await expect(insertPrinter({ transport: "network_tcp", host: "10.0.0.2" })).resolves.toBeDefined();
});
it("rejects claimed_by naming an agent in another tenant (composite FK 23503)", async () => { /* insert job with foreign claimed_by → 23503 */ });
```

Match the existing suite's helpers (`describeEachTarget`, the printer insert helper); if none exists, insert via `db.insert(printers)` with `tenantId`/`locationId` from the harness fixtures.

- [ ] **Step 2: Run to verify they fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test -- printing` → FAIL (columns/constraints not yet changed).

- [ ] **Step 3: Edit the schema.** In `printers.ts`:

```ts
export const printTransport = pgEnum("print_transport", ["usb", "network_tcp", "bluetooth", "cloud_poll"]);
// …in the table: REMOVE agentId and usbPath. ADD:
localKey: text("local_key"), // usb: device serial; bluetooth: MAC. NULL for network_tcp/cloud_poll.
// …keep host, port, pollId, pollTokenHash, ticketScope, active.
// The transport-required-field CHECK, the partial UNIQUE, and the (tenant_id, printer_id) FK stay
// hand-written in the --custom migration (a bare column carries no FK; a partial index is not a schema
// primitive here). Update the table doc comment: no agent_id; local_key is the stable device id.
```

In `print-jobs.ts` add after `printerId`:

```ts
// The agent currently holding this job (set on claim, cleared/overwritten by a lease reclaim). Bare
// column: the tenant-consistent (tenant_id, claimed_by) → print_agents composite FK is hand-written in
// the --custom migration (MATCH SIMPLE skips it on NULL). Authorises the report — only the claimer
// reports its own job (runtime.ts). NULL while queued and after the job leaves `printing`.
claimedBy: uuid("claimed_by"),
```

- [ ] **Step 4: Regenerate the migration pair.** Follow CLAUDE.md §3's recipe. `pnpm --filter @waitron/db db:generate --name central_printer_provisioning` for the enum value + column add/drop, then `db:generate:custom --name central_printer_provisioning_sql` for the hand-written DDL. In the custom SQL:

```sql
-- Rewrite printers_transport_fields_ck: usb/bluetooth need local_key; network_tcp needs host; cloud_poll needs poll_id.
ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_transport_fields_ck;
ALTER TABLE printers ADD CONSTRAINT printers_transport_fields_ck CHECK (
  (transport = 'usb'         AND local_key IS NOT NULL) OR
  (transport = 'bluetooth'   AND local_key IS NOT NULL) OR
  (transport = 'network_tcp' AND host      IS NOT NULL) OR
  (transport = 'cloud_poll'  AND poll_id   IS NOT NULL)
);
-- Partial UNIQUE: one registered printer per physical device per venue.
CREATE UNIQUE INDEX printers_local_key_key ON printers (tenant_id, location_id, local_key) WHERE local_key IS NOT NULL;
-- Keep the (tenant_id, printer_id) FK from print_jobs; ADD the claimer FK.
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_claimed_by_fk
  FOREIGN KEY (tenant_id, claimed_by) REFERENCES print_agents (tenant_id, id) MATCH SIMPLE;
-- The (tenant_id, agent_id) → print_agents FK on printers is GONE (agent_id dropped); ensure the
-- generated migration drops that constraint too.
-- Grants: app_user keeps its existing printers/print_jobs privileges; local_key/claimed_by inherit the
-- table grants. Confirm no new GRANT is needed by reading privileges.test.ts (never widen to pass).
```

**Heed the bookings-DROP hazard:** open every generated SQL file; delete any `DROP TABLE`/unrelated statement the change did not intend.

- [ ] **Step 5: Run schema + guard tests** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`, then the root guards: `pnpm --filter @waitron/root test -- classification-complete append-only-enable-always` (no table added/removed → classification unchanged; run it to prove so). Also `pnpm --filter @waitron/db test -- privileges` (grants unchanged). Expected: PASS.

- [ ] **Step 6: Commit** — `git add packages/db && git commit -s -m "feat(db): printers keyed on local_key, jobs record claimed_by (central printer provisioning)"`

---

## Task 2: printing write-path — create/update/list by local_key

**Files:**
- Modify: `packages/printing/src/printers.ts:31-44,67-92,105-140,151-175,186-276`
- Modify: `packages/printing/src/errors.ts:20-37`
- Test: `packages/printing/src/printers.test.ts` (the existing write-path suite)

**Interfaces:**
- Consumes: Task 1's `printers.local_key`, the partial UNIQUE, `bluetooth` enum.
- Produces: `CreatePrinterInput { name, transport, host?, port?, localKey?, pollId? }`; `UpdatePrinterInput` (same fields, connection fields + `localKey` nullable); `PrinterRow { id, name, transport, host, port, localKey, pollId, ticketScope, active }`; error `printer.already_registered { localKey }`.

- [ ] **Step 1: Write failing unit tests** (PGlite is fine — logic + error mapping, no grants):

```ts
it("creates a usb printer from a serial", async () => {
  const { id } = await createPrinter(tx, cfg, { name: "Cocina", transport: "usb", localKey: "SN-1" });
  expect(id).toBeDefined();
});
it("rejects a usb printer with no local_key before any write", async () => {
  await expect(createPrinter(tx, cfg, { name: "X", transport: "usb" }))
    .rejects.toMatchObject({ code: "printer.invalid_config", params: { reason: "usb_missing_localKey" } });
});
it("maps a duplicate local_key to printer.already_registered", async () => {
  await createPrinter(tx, cfg, { name: "A", transport: "usb", localKey: "SN-DUP" });
  await expect(createPrinter(tx, cfg, { name: "B", transport: "usb", localKey: "SN-DUP" }))
    .rejects.toMatchObject({ code: "printer.already_registered", params: { localKey: "SN-DUP" } });
});
it("creates a bluetooth printer from a MAC", async () => {
  await expect(createPrinter(tx, cfg, { name: "BT", transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" })).resolves.toBeDefined();
});
it("lists printers with local_key, no agentId field", async () => {
  await createPrinter(tx, cfg, { name: "N", transport: "network_tcp", host: "10.0.0.9" });
  const rows = await listPrinters(tx, cfg);
  expect(rows[0]).toMatchObject({ transport: "network_tcp", localKey: null, host: "10.0.0.9" });
  expect(rows[0]).not.toHaveProperty("agentId");
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @waitron/printing test -- printers` → FAIL.

- [ ] **Step 3: Edit `errors.ts`** — add the code and update the doc comment:

```ts
/** A create/register whose stable device key (USB serial / Bluetooth MAC) already names a printer in
 * this venue — the partial UNIQUE (tenant_id, location_id, local_key). `localKey` is echoed so the
 * dashboard can point at the existing registration. */
"printer.already_registered": { localKey: string };
// Update printer.invalid_config's doc: required fields are now host (network_tcp), local_key
// (usb/bluetooth), poll_id (cloud_poll); no transport requires agent_id.
```

- [ ] **Step 4: Edit `printers.ts`.** Drop `agentId`/`usbPath` from `CreatePrinterInput`, `UpdatePrinterInput`, `PrinterRow`; add `localKey`. New `REQUIRED_FIELDS`:

```ts
const REQUIRED_FIELDS: Record<PrintTransport, readonly (keyof CreatePrinterInput)[]> = {
  usb: ["localKey"],
  bluetooth: ["localKey"],
  network_tcp: ["host"],
  cloud_poll: ["pollId"],
};
```

`createPrinter`/`updatePrinter`: write `localKey: input.localKey` instead of `agentId`/`usbPath`; `listPrinters` selects `localKey: printers.localKey`. Rewrite `translatePrinterWriteError` — the agent FK is gone, add the unique mapping:

```ts
const UNIQUE_VIOLATION = "23505";
function translatePrinterWriteError(error: unknown, localKey: string | undefined): never {
  if (localKey !== undefined && isPgError(error, UNIQUE_VIOLATION)) {
    throw new AppError("printer.already_registered", { localKey });
  }
  if (isPgError(error, CHECK_VIOLATION)) {
    throw new AppError("printer.invalid_config", { reason: "transport_fields" });
  }
  throw error;
}
// callers pass input.localKey / patch.localKey ?? undefined instead of agentId.
```

- [ ] **Step 5: Run tests** — `pnpm --filter @waitron/printing test:coverage` → PASS.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(printing): create/update printers by local_key; printer.already_registered"`

---

## Task 3: runtime — derived eligibility, claimed_by, distinct-agents race

**Files:**
- Modify: `packages/printing/src/runtime.ts:82-90,139-182,214-239,261-268`
- Test: `packages/printing/src/runtime.eligibility.test.ts` (new), `packages/printing/src/runtime.race.test.ts` (add distinct-agents case)

**Interfaces:**
- Consumes: Task 1 schema; Task 2 `createPrinter`.
- Produces: `claimPrintJobs(tx, cfg, agentId, ctx: { locationId: string; visibleKeys: string[] }): Promise<ClaimedJob[]>` where `ClaimedJob` replaces `usb_path` with `local_key`; `reportPrintJob` unchanged signature, authorised by `claimed_by`.

- [ ] **Step 1: Write failing eligibility tests** (real PG — the eligibility + `skip locked`; PGlite serialises so a race is a false pass, CLAUDE.md §4):

```ts
it("claims a network_tcp job for any agent in the venue", async () => {
  const p = await createPrinter(tx, cfg, { name: "IP", transport: "network_tcp", host: "10.0.0.5" });
  await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
  const claimed = await claimPrintJobs(tx, cfg, otherAgentId, { locationId: cfg.locationId, visibleKeys: [] });
  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({ transport: "network_tcp", host: "10.0.0.5", local_key: null });
});
it("claims a usb job only for an agent that reports its serial", async () => {
  const p = await createPrinter(tx, cfg, { name: "USB", transport: "usb", localKey: "SN-9" });
  await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
  expect(await claimPrintJobs(tx, cfg, agentId, { locationId: cfg.locationId, visibleKeys: [] })).toHaveLength(0);
  expect(await claimPrintJobs(tx, cfg, agentId, { locationId: cfg.locationId, visibleKeys: ["SN-9"] })).toHaveLength(1);
});
it("stamps claimed_by and lets only the claimer report", async () => {
  const p = await createPrinter(tx, cfg, { name: "IP", transport: "network_tcp", host: "10.0.0.5" });
  const { id: jobId } = await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
  await claimPrintJobs(tx, cfg, agentId, { locationId: cfg.locationId, visibleKeys: [] });
  expect((await reportPrintJob(tx, cfg, { agentId: otherAgentId, jobId, outcome: { status: "done" } })).updated).toBe(false);
  expect((await reportPrintJob(tx, cfg, { agentId, jobId, outcome: { status: "done" } })).updated).toBe(true);
});
```

Delete the `p.location_id = ${ctx.locationId}` conjunct and confirm the usb test's negative control (empty `visibleKeys`) still passes for the right reason (a claim scoped by keys, not location).

- [ ] **Step 2: Run to verify fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test -- eligibility` → FAIL (signature/behaviour).

- [ ] **Step 3: Edit `claimPrintJobs`.** Signature gains `ctx`; the scope conjunct and the RETURNING change; the UPDATE stamps `claimed_by`:

```ts
export type ClaimedJob = { id: string; printer_id: string; payload: Buffer; transport: PrintTransport; host: string | null; port: number | null; local_key: string | null; };

export async function claimPrintJobs(tx, cfg, agentId, ctx: { locationId: string; visibleKeys: string[] }) {
  // Eligibility (design §3): network_tcp → any agent in the venue; usb/bluetooth → an agent reporting
  // the key. Empty visibleKeys ⇒ the usb/bt branch matches nothing (an `in ()` degenerates — the
  // drain.ts hazard), so guard it with `false`.
  const usbBt = ctx.visibleKeys.length > 0
    ? sql`(p.transport in ('usb','bluetooth') and p.local_key in ${ctx.visibleKeys})`
    : sql`false`;
  const picked = await tx.execute<{ id: string }>(sql`
    select j.id from print_jobs j
    join printers p on p.tenant_id = j.tenant_id and p.id = j.printer_id
    where j.tenant_id = ${cfg.tenantId}
      and p.active = true
      and ( (p.transport = 'network_tcp' and p.location_id = ${ctx.locationId}) or ${usbBt} )
      and ( j.status = 'queued'
            or (j.status = 'failed' and j.attempts < ${MAX_DELIVERY_ATTEMPTS})
            or (j.status = 'printing' and (j.claimed_at is null
                 or j.claimed_at < now() - ${PRINT_JOB_LEASE_MS}::double precision * interval '1 millisecond')) )
    order by j.created_at limit ${PULL_BATCH_LIMIT} for update of j skip locked`);
  if (picked.rows.length === 0) return [];
  const ids = picked.rows.map((r) => r.id);
  const claimed = await tx.execute<ClaimedJob>(sql`
    update print_jobs set status = 'printing', claimed_at = now(), claimed_by = ${agentId}
    from printers p
    where print_jobs.tenant_id = p.tenant_id and print_jobs.printer_id = p.id and print_jobs.id in ${ids}
    returning print_jobs.id, print_jobs.printer_id, print_jobs.payload, p.transport, p.host, p.port, p.local_key`);
  return claimed.rows;
}
```

Update the header comment: the join is no longer the authorization scope (eligibility is derived); `claimed_by` records the holder.

- [ ] **Step 4: Edit `reportPrintJob`** — scope by `claimed_by`, drop the printers join:

```ts
const result = await tx.execute<{ id: string }>(sql`
  update print_jobs set ${setClause}
  where print_jobs.tenant_id = ${cfg.tenantId}
    and print_jobs.id = ${jobId}
    and print_jobs.status = 'printing'
    and print_jobs.claimed_by = ${agentId}
  returning print_jobs.id`);
```

- [ ] **Step 5: Edit `runAgentOnce`** — the local-mode target uses `local_key`. Since local mode has no live device map, treat `local_key` as the device path for the fake/local case:

```ts
const target: PrinterTarget = { id: job.printer_id, transport: job.transport, host: job.host, port: job.port, devicePath: job.local_key };
```

(Local mode + FakeSink ignores `devicePath`; the real resolution is the agent host's job — Task 4/6.) Pass `ctx` through `AgentRuntimeDeps` (add `locationId` + `visibleKeys`); default `visibleKeys: []` in local-mode callers.

- [ ] **Step 6: Add the distinct-agents race test** in `runtime.race.test.ts` (real PG): two `agentId`s, one `network_tcp` printer, N queued jobs; run both agents' `claimPrintJobs` concurrently in separate transactions; assert the union of claimed ids has no duplicate and totals N. Prove the lock by deleting `for update of j skip locked` → a duplicate claim appears.

- [ ] **Step 7: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test:coverage` → PASS. Then `pnpm typecheck` (ClaimedJob/PrinterTarget are shared).

- [ ] **Step 8: Commit** — `git commit -s -m "feat(printing): derive claim eligibility from venue + visible keys; report by claimed_by; distinct-agents race test"`

---

## Task 4: print-agent package — new transport, seam, wire, loop

**Files:**
- Modify: `packages/print-agent/src/transport.ts:15-35,96-139`
- Modify: `packages/print-agent/src/host.ts:8-52`
- Modify: `packages/print-agent/src/client.ts:8-76,188-232,278-286`
- Modify: `packages/print-agent/src/agent.ts:98-126,129-255`
- Test: `packages/print-agent/src/transport.test.ts`, `client.test.ts`, `agent.test.ts` (existing suites)

**Interfaces:**
- Consumes: Task 3's wire shape (`local_key`), the discovery-window reply (Task 5).
- Produces (the db-free contract the app host in Task 6 and the server in Task 5 implement against):
  - `type PrintTransport = "usb" | "network_tcp" | "bluetooth" | "cloud_poll"`
  - `interface PrinterTarget { id; transport; host; port; devicePath: string | null }`
  - `interface VisibleDevice { transport: "usb" | "bluetooth"; localKey: string; make?: string; model?: string }`
  - `interface DiscoveredDevice { transport: PrintTransport; localKey?: string; host?: string; port?: number; make?: string; model?: string; name?: string }`
  - `interface PairResult { ok: boolean; localKey?: string; error?: string }`
  - `Host` gains `visibleDevices(): Promise<VisibleDevice[]>`, `scan(): Promise<DiscoveredDevice[]>`, `resolve(job: WireJob): Promise<PrinterTarget>`, `pair(mac: string): Promise<PairResult>`
  - `WireJob { …; localKey: string | null }` (was `usbPath`); `PullReply { …; discoveryUntil: number | null }`
  - `pullJobs(url, token, inventory: { visible: VisibleDevice[]; scanned: DiscoveredDevice[] }): Promise<Result<PullReply>>`

- [ ] **Step 1: transport.ts — failing test then change.** Add a bluetooth-target test and a device-path USB test:

```ts
it("routes a bluetooth job to a device-path write", async () => {
  const file = tmpFile();
  const t = new RoutingTransport({ network_tcp: new FakeSink(), usb: new UsbTransport(), bluetooth: new UsbTransport() });
  await t.send({ id: "p", transport: "bluetooth", host: null, port: null, devicePath: file }, esc().line("x").bytes());
  expect(readFileSync(file)).toEqual(Buffer.from(esc().line("x").bytes()));
});
```

Then: `PrintTransport += "bluetooth"`; `PrinterTarget.usbPath → devicePath`; `UsbTransport.send` writes to `printer.devicePath` (rename the guard/message); add a `bluetooth` slot to `TransportAdapters` and a `case "bluetooth"` to `RoutingTransport` (dispatch to the bluetooth adapter — a `UsbTransport`-shaped device-path writer is acceptable for MVP; a distinct `BluetoothTransport` class with its own error text is cleaner and is what Task 6 may specialise). Keep `cloud_poll` rejecting.

- [ ] **Step 2: client.ts — failing test then change.** Test that `pullJobs` POSTs the inventory and parses `discoveryUntil` + `localKey`:

```ts
it("posts the inventory and parses discoveryUntil + localKey", async () => {
  const fetch = fakeFetch({ nodeId: "n", servers: [], jobs: [{ id: "j", printerId: "p", transport: "usb", localKey: "SN-1", payload: "AA==" }], discoveryUntil: 123 });
  const r = await createClient({ fetch }).pullJobs("http://s", "tok", { visible: [{ transport: "usb", localKey: "SN-1" }], scanned: [] });
  expect(r.ok && r.value.jobs[0].localKey).toBe("SN-1");
  expect(r.ok && r.value.discoveryUntil).toBe(123);
  expect(fakeFetch.lastInit.method).toBe("POST"); // inventory carried in the body
});
```

Then: `WireJob.usbPath → localKey` (parse `e.localKey`); `PullReply` gains `discoveryUntil: number | null` (parse `typeof b.discoveryUntil === "number" ? … : null`); `pullJobs` takes `inventory` and switches to `method: "POST"` with `body: JSON.stringify(inventory)` and `content-type: application/json`.

- [ ] **Step 3: host.ts — add the seam types + methods** (interface only; no test — it is a type). Add `VisibleDevice`, `DiscoveredDevice`, `PairResult`, and the four methods to `Host`.

- [ ] **Step 4: agent.ts — failing loop tests then change.** Add to `agent.test.ts` a fake host exposing `visibleDevices`/`scan`/`resolve`/`pair`:

```ts
it("reports visible devices on every pull", async () => { /* fake host.visibleDevices → [{usb,SN-1}]; assert client.pullJobs got it */ });
it("scans only within a discovery window", async () => {
  // reply1 discoveryUntil = now+10s → next tick calls host.scan and includes scanned in the pull body
  // reply2 discoveryUntil = null → host.scan NOT called
});
it("resolves a usb job before sending", async () => {
  // host.resolve(job) → { transport:'usb', devicePath:'/tmp/x' }; assert transport.send got that target
});
it("marks a job failed when resolve throws (device gone)", async () => {
  // host.resolve rejects → push reports failed, loop continues
});
```

Then in `agent.ts`:
- `tick()` gathers `const visible = await host.visibleDevices();` and, when `windowOpen` (a cross-tick `discoveryUntil` from the last reply, compared to `host.now()`), `const scanned = await host.scan()` else `[]`; pass `{ visible, scanned }` to `client.pullJobs(current, token, …)`.
- Store `discoveryUntil` from `pulled.value.discoveryUntil` into a cross-tick variable so the *next* tick scans.
- `push(job, …)`: `const target = await host.resolve(job);` inside the try, then `await host.transport.send(target, job.payload)`. A throwing `resolve` lands in the existing catch → `failed`.

- [ ] **Step 5: Run** — `pnpm --filter @waitron/print-agent test:coverage` → PASS; `pnpm typecheck`.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(print-agent): bluetooth transport, device seam (visibleDevices/scan/resolve/pair), inventory-carrying pull"`

---

## Task 5: server routes — inventory pull, discovery window, discovered list

**Files:**
- Modify: `apps/server/src/print-api.ts:135-152,303-335,408-432,444-480` + add two routes + in-memory stores in `mountPrintApi`
- Test: `apps/server/src/print-api.test.ts` (PGlite), `apps/server/src/print-api.pg.test.ts` (real PG grants)

**Interfaces:**
- Consumes: Task 2 verbs, Task 3 `claimPrintJobs(…, ctx)`, Task 4 wire shapes.
- Produces: `POST /print-api/agent/jobs` (was GET) reading `{ visible, scanned }`; reply `{ nodeId, servers, jobs:[{…, localKey}], discoveryUntil }`; `POST /management-api/printer-discovery/start` → `{ discoveryUntil }`; `GET /management-api/discovered-printers` → `[{ agentId, agentName, transport, localKey?, host?, port?, make?, model?, name?, alreadyRegistered }]`.

- [ ] **Step 1: Write failing route tests:**

```ts
it("POST /print-api/agent/jobs carries the inventory and claims by key", async () => { /* register usb printer SN-1; enqueue; pull with visible:[{usb,SN-1}] → 1 job carrying localKey; pull with visible:[] → 0 jobs */ });
it("returns discoveryUntil after a discovery window is opened", async () => { /* POST printer-discovery/start (manage session) → discoveryUntil; the agent pull reply carries it */ });
it("GET /management-api/discovered-printers lists reported devices, marking registered ones", async () => { /* agent pull reports visible SN-1 + SN-2; register SN-1; discovered list shows SN-2 alreadyRegistered:false, SN-1 alreadyRegistered:true */ });
it("POST /management-api/printers with a duplicate local_key → 409 printer.already_registered", async () => { /* … */ });
it("create rejects agentId/usbPath fields (ignored) and requires localKey for usb", async () => { /* usb with no localKey → 422 */ });
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @waitron/server test -- print-api` → FAIL.

- [ ] **Step 3: Add in-memory stores + STATUS.** In `mountPrintApi`, closure-scoped:

```ts
// Transient venue state (design §6): the discovered inventory and the discovery window live in memory —
// no table (owner, 2026-09-09). Rebuilt by agent polls within a couple of seconds of a restart.
interface DiscoveredEntry { agentId: string; transport: string; localKey?: string; host?: string; port?: number; make?: string; model?: string; name?: string; lastSeenAt: number; }
const discovered = new Map<string, DiscoveredEntry>(); // key: `${agentId}:${transport}:${localKey ?? host+":"+port}`
let discoveryUntil = 0; // epoch ms; 0 = closed
const DISCOVERY_WINDOW_MS = 3 * 60_000;
const DISCOVERED_TTL_MS = 15_000; // prune entries older than a few missed polls
```

Add `"printer.already_registered": 409` to `STATUS`.

- [ ] **Step 4: Rewrite the pull as POST.** `app.post("/print-api/agent/jobs", …)`: after `requireAgent`, read `readJsonBody<{ visible?: unknown; scanned?: unknown }>`, validate to `VisibleDevice[]`/`DiscoveredDevice[]` (shape-screen, ignore malformed entries), upsert them into `discovered` (stamp `lastSeenAt = Date.now()`), derive `const visibleKeys = visible.filter(v => v.transport==='usb'||v.transport==='bluetooth').map(v => v.localKey)`, then:

```ts
const claimed = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
  await asAppUser(tx);
  return claimPrintJobs(tx, deps.cfg, agentId, { locationId: deps.cfg.locationId, visibleKeys });
});
// reply: jobs map usb_path → localKey; add discoveryUntil (0 → null)
return c.json({ nodeId: deps.cfg.nodeId, servers: routableServers(held),
  jobs: claimed.map(j => ({ id: j.id, printerId: j.printer_id, transport: j.transport, host: j.host, port: j.port, localKey: j.local_key, payload: Buffer.from(j.payload).toString("base64") })),
  discoveryUntil: discoveryUntil > Date.now() ? discoveryUntil : null });
```

- [ ] **Step 5: Add the two management routes.**

```ts
app.post("/management-api/printer-discovery/start", (c) => run(c, log, async () => {
  const sessionId = requireManagementSession(c);
  await gated(sessionId, async () => {}); // authorise printer.manage (no DB work)
  discoveryUntil = Date.now() + DISCOVERY_WINDOW_MS;
  return c.json({ discoveryUntil });
}));

app.get("/management-api/discovered-printers", (c) => run(c, log, async () => {
  const sessionId = requireManagementSession(c);
  const now = Date.now();
  for (const [k, e] of discovered) if (now - e.lastSeenAt > DISCOVERED_TTL_MS) discovered.delete(k);
  const [registered, agents] = await gated(sessionId, async (tx) => [
    await tx.select({ localKey: printers.localKey }).from(printers).where(and(eq(printers.tenantId, deps.cfg.tenantId), isNotNull(printers.localKey))),
    await tx.select({ id: printAgents.id, name: printAgents.name }).from(printAgents),
  ]);
  const names = new Map(agents.map(a => [a.id, a.name]));
  const keys = new Set(registered.map(r => r.localKey));
  return c.json([...discovered.values()].map(e => ({ agentId: e.agentId, agentName: names.get(e.agentId) ?? null, transport: e.transport, localKey: e.localKey, host: e.host, port: e.port, make: e.make, model: e.model, name: e.name, alreadyRegistered: e.localKey !== undefined && keys.has(e.localKey) })));
}));
```

(Import `isNotNull` from `drizzle-orm`.)

- [ ] **Step 6: Update create/patch bodies.** In `POST /management-api/printers`: remove the `agentId`/`usbPath` reads, add `const localKey = optionalString(body.localKey, "localKey"); if (localKey !== undefined) input.localKey = localKey;`. In `PATCH`: remove `agentId`/`usbPath`, add `const localKey = nullableOptionalString(body.localKey, "localKey"); if (localKey !== undefined) patch.localKey = localKey;`. Remove the now-unused `nullableOptionalUuid`/`optionalUuid` if nothing else uses them (grep first).

- [ ] **Step 7: Run** — `pnpm --filter @waitron/server test:coverage -- print-api` (PGlite) then the real-PG grants suite; run the package UNFILTERED before believing green (CLAUDE.md §2 — boot/e2e suites pin wire bodies). Expected: PASS.

- [ ] **Step 8: Commit** — `git commit -s -m "feat(server): inventory-carrying pull, discovery window + discovered-printers, create/patch by localKey"`

---

## Task 6: apps/print-agent — real container Host + Bluetooth setup page

**Files:**
- Modify: `apps/print-agent/src/*` (the container `Host` implementation, the setup page)
- Modify: `apps/print-agent/Dockerfile` + Track P compose note (device/network/DBus access)
- Test: `apps/print-agent/src/*.test.ts` (fixture-based unit tests) + a manual hardware receipt

**Interfaces:**
- Consumes: Task 4's `Host` contract (`visibleDevices`/`scan`/`resolve`/`pair`, `PrinterTarget.devicePath`).
- Produces: the concrete Linux host; no new exported types.

> The exact OS calls are confirmed on the arriving USB/Bluetooth printer (2026-09-10, spec §7). TDD what is hardware-independent (parsing) against fixtures; gate the live paths behind a manual receipt. Do NOT assert an unverified OS behaviour in a comment (CLAUDE.md §1) — state the experiment.

- [ ] **Step 1: USB `visibleDevices`/`resolve` against sysfs fixtures.** Write a parser `readUsbPrinters(sysfsRoot): VisibleDevice & { devicePath }` that walks `<root>/class/usbmisc` or `<root>/bus/usb/devices/*/serial` correlating a `usblp`/`/dev/usb/lpN` node to its parent device `serial`. Test it against a checked-in fixture tree (a `tmpdir` mimicking sysfs) — no hardware:

```ts
it("reads serial + device path from a sysfs fixture", async () => {
  const root = writeSysfsFixture({ lp: "lp0", serial: "SN-ABC", manufacturer: "Epson", product: "TM-T20" });
  expect(await readUsbPrinters(root)).toEqual([{ transport: "usb", localKey: "SN-ABC", make: "Epson", model: "TM-T20", devicePath: `${root}/dev/usb/lp0` }]);
});
```

`Host.visibleDevices` returns the usb list (+ paired BT from Step 3); `Host.resolve(job)` for usb/bluetooth looks the `localKey` up in a fresh `visibleDevices()` and returns `{ …, devicePath }`, throwing `new Error("device <key> not attached")` if absent; for network_tcp it passes `host`/`port` through with `devicePath: null`.

- [ ] **Step 2: Network `scan` against captured responses.** Implement an mDNS query for `_pdl-datastream._tcp` and a bounded 9100 sweep behind `scan()`; unit-test the *response parser* against a captured mDNS packet / a fake socket (parsing only, host-safe). The live multicast path is exercised only under host networking (Step 5) and the hardware receipt.

- [ ] **Step 3: Bluetooth `scan`/`pair`/paired-list.** Implement over BlueZ (DBus): `scan()` runs an inquiry and returns `{ transport: "bluetooth", localKey: mac, name }`; `pair(mac)` triggers the bond and returns `PairResult`; paired devices feed `visibleDevices`. Unit-test the DBus-reply decoding against fixtures; the live radio is the hardware receipt. If containerised BlueZ proves infeasible, record the finding and the packaging fix in the spec's §7 — the seam is unchanged.

- [ ] **Step 4: Setup-page Bluetooth section.** Add to the Hono setup page a **Bluetooth** panel: a **Scan** button (`host.scan(['bluetooth'])`), a list of found devices, and a **Pair** button per device (`host.pair(mac)`), showing the result. Test with `app.request` (no listener), fake host. Keep it LAN, secret-free (as #289).

- [ ] **Step 5: Container access.** In the `Dockerfile`/compose: mount broader USB (`/dev/bus/usb` + the sysfs it needs), host networking (or a documented macvlan) for mDNS, and the BlueZ DBus socket for Bluetooth — each with a one-line comment on why. Track P wires the same into the box compose beside the server (spec §2.2 owed item).

- [ ] **Step 6: Hardware receipt (2026-09-10).** With the real printer: (a) does it enumerate printer-class (`/dev/usb/lpN` appears) or vendor-specific? record it; (b) one USB test-print end to end; (c) pair over Bluetooth and one BT test-print; (d) confirm mDNS discovery finds the HP over the LAN. Record outcomes in the spec §7/§12 and here. Adjust `resolve`/`scan` to what the hardware actually presents.

- [ ] **Step 7: Run + commit** — `pnpm --filter @waitron/print-agent-app test:coverage` (use the app's real filter name); `git commit -s -m "feat(print-agent-app): Linux USB/network/Bluetooth host + setup-page pairing"`.

---

## Task 7: dashboard — transport-aware create flow + discovered list

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (create form `:1089-1174`, submit `:576-597`, state `:263-269`, transports `:61-67`, per-row `:907-1022`)
- Modify: `apps/dashboard/src/api/client.ts` (printer methods + two new)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts` (browser mode)

**Interfaces:**
- Consumes: Task 5 routes.
- Produces: client methods `createPrinter({ name, transport, host?, port?, localKey? })`, `startPrinterDiscovery(): Promise<{ discoveryUntil }>`, `listDiscoveredPrinters(): Promise<DiscoveredPrinter[]>`.

- [ ] **Step 1: Failing component tests** (browser mode — check headroom first, CLAUDE.md §2/§4):

```ts
it("adds an IP printer with name + host + port, no agent picker", async () => { /* fill, submit, assert client.createPrinter called with {transport:'network_tcp', host, port} and NO agentId */ });
it("registers a discovered USB printer by picking it and naming it", async () => { /* stub listDiscoveredPrinters → [{transport:'usb', localKey:'SN-1', make, agentName, alreadyRegistered:false}]; click Register; enter name; assert createPrinter({transport:'usb', localKey:'SN-1', name}) */ });
it("shows already-registered discovered devices as registered", async () => { /* alreadyRegistered:true row has no Register action */ });
it("Scan opens a discovery window", async () => { /* click Scan → client.startPrinterDiscovery called */ });
```

- [ ] **Step 2: Run to verify fail** — the dashboard browser suite → FAIL.

- [ ] **Step 3: Add client methods** in `api/client.ts` mirroring the existing `createPrinter`/`listPrinters` fetch shape: `startPrinterDiscovery` → `POST /management-api/printer-discovery/start`; `listDiscoveredPrinters` → `GET /management-api/discovered-printers`; drop `agentId`/`usbPath` from the printer create/patch payloads, add `localKey`.

- [ ] **Step 4: Rewrite the create section.** Remove the **agent `<select>`** (`:1120-1130`) and its ref/reconcile (`:276-303`) and the `usbPath` field. Split the form by transport (`TRANSPORTS = ["network_tcp", "usb", "bluetooth"]`):
  - `network_tcp`: name + host + port, plus a **Scan** button that calls `startPrinterDiscovery` and lists discovered `network_tcp` results to pre-fill host/port.
  - `usb`/`bluetooth`: a **discovered-printers list** (from `listDiscoveredPrinters`, filtered to the transport) with a **Register** button per unregistered row that prompts for a name and calls `createPrinter({ transport, localKey, name })`.
  - `bluetooth`: a one-line note — "Pair the printer first on the box's setup page (`http://<box>:9110`)."
  In the per-row display (`:907-1022`) drop the agent column; optionally show "last seen on <agentName>" from the discovered list.

- [ ] **Step 5: Run + commit** — dashboard `test:coverage` (browser) → PASS; `git commit -s -m "feat(dashboard): transport-aware printer create + discovered-printers list"`.

---

## Task 8: end-to-end + dev + security review

**Files:**
- Modify: the `apps/server` end-to-end print suite; `apps/server/scripts/dev-setup.ts` (optional dev seed)
- Test: the e2e suite

- [ ] **Step 1: End-to-end (real `mountPrintApi` on PGlite, agent `runOnce` with `fetch` → the Hono app).** Failing test: register an IP printer + a USB printer (via `createPrinter`), the agent joins + is accepted, `enqueuePrintJob` on each; the agent pulls **carrying a fake inventory** that includes the USB serial; the bytes land on a loopback TCP listener (IP) and a fake device sink (USB); both jobs `done`. Then revoke → the loop reports `unauthorized` and claims nothing. Wire the agent's fake `Host.resolve` to map the USB serial to the fake sink and `visibleDevices` to report it.

- [ ] **Step 2: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` unfiltered → PASS.

- [ ] **Step 3: Optional dev seed** — if useful, seed one `network_tcp` printer pointing at a dev sink in `dev-setup.ts` so `wa-wt reset` shows a printer; skip if it complicates the boot. Commit only if added.

- [ ] **Step 4: Security review.** Run the mandated `security-review` on the diff (the authz boundary moved to venue/visible-keys + `claimed_by`). Confirm by RUNNING, not reading: a two-tenant / cross-agent probe as `app_user` (rolsuper=f) that a foreign agent cannot claim or report another venue's jobs, and that a USB job is only claimable by an agent reporting the key. Record the experiment.

- [ ] **Step 5: Full gate + commit** — `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` (the pre-push scoped gate covers the rest). `git commit -s -m "test(printing): end-to-end register→pull-with-inventory→deliver; revoke halts"`.

---

## Self-Review

**Spec coverage:** §2(a) derive-not-store → Tasks 1,3,5,7. §2(b) USB discovery + serial key → Tasks 1,2,4,5,6,7. §2(c) IP discoverable, host:port key → Tasks 4(scan),5(discovered),6(mDNS),7(Scan button). §2(d) Bluetooth transport + box-local pairing → Tasks 1(enum),4(transport),6(pair + setup page),7. §2(e) windowed discovery → Tasks 4(loop),5(window),7(Scan). §2(f) no drivers → inherent (raw ESC/POS device-path/TCP write, Task 4/6); page printers out of scope (not built). §2(g) in-memory stores, drop-recreate → Tasks 5,1. §3 eligibility SQL → Task 3. §4 schema → Task 1. §5 claim/report + race → Task 3. §6 discovery split (always-on presence vs windowed scan) → Tasks 4,5,6. §7 Host seam + feasibility → Tasks 4,6. §8 loop/wire → Task 4. §9 routes → Task 5. §10 dashboard → Task 7. §11 security → Task 8. §12 tests → every task's test steps + Task 6 receipts + Task 8 review. §13 follow-ups (MAC-keyed IP, per-claim token) deliberately not built. No spec section is without a task.

**Placeholder scan:** Task 6's OS-specific code is intentionally fixture-tested + hardware-receipt-gated (the spec commits to confirming on 2026-09-10), not a placeholder — the seam contract and the fixture tests are concrete; only the live-radio/live-multicast assertions wait on hardware, as the spec requires. No "TBD"/"add validation"/"similar to Task N" anywhere.

**Type consistency:** `PrinterTarget.devicePath` (Task 4) is used by Task 3's `runAgentOnce` and Task 6's `resolve`. `ClaimedJob.local_key` (Task 3) → the pull maps it to `WireJob.localKey` (Task 4) → the server reply field `localKey` (Task 5). `claimPrintJobs(…, ctx: { locationId, visibleKeys })` (Task 3) is called with exactly that shape in Task 5. `VisibleDevice`/`DiscoveredDevice` (Task 4) are produced by Task 6's host and consumed by Task 5's pull/discovered routes. `printer.already_registered { localKey }` (Task 2) is mapped to 409 in Task 5. Consistent throughout.
