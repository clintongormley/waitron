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
- **Trace every consumer before changing a field** (CLAUDE.md §1/§3). Before dropping `agent_id`/`usb_path`, `grep -rn "agent_id\|usbPath\|usb_path\|agentId" packages apps` and update or note every reader (schema doc comments, `runtime.ts` `ClaimedJob`, the pull-reply mapping, the dashboard client types, any e2e/boot suite pinning the pull-reply body with `toEqual`).
- **A name-filtered pass hides broken wire-body suites** (CLAUDE.md §2). The GET→POST pull change and the `usbPath→localKey` reply change will break any `toEqual`-pinned wire-body/e2e test — run the affected package UNFILTERED before believing green.
- **Coverage:** `@waitron/print-agent`, `apps/print-agent`, `packages/printing` at 90/90/85/85; `packages/db` at 98/98/98/95.
- **Migration regeneration hazard (CLAUDE.md §2 / backlog):** `pnpm --filter @waitron/db db:generate` may propose `DROP TABLE "bookings" CASCADE` (a stale snapshot artifact). Inspect every generated SQL file and delete any DROP the change did not intend before staging.
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you expect (CLAUDE.md §4).
- **Per-task verify:** the changed package's `pnpm --filter <pkg> test:coverage` + `lint` + `typecheck` + `format:check`. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`; run `pnpm reap` if a prior run was interrupted.

## Sequencing note — the shared-type interlock (read before executing)

Tasks 2–5 are **one interlocking shared-type change**. Task 2 edits the exported types of `@waitron/print-agent` (`PrintTransport`, `PrinterTarget`, `Host`, `WireJob`, `pullJobs`) and Task 4 changes `claimPrintJobs`'s signature — and `@waitron/printing`, `apps/server` and `apps/print-agent` all depend on `@waitron/print-agent`, while `apps/server` depends on `@waitron/printing`. So:

- **The whole-workspace `pnpm typecheck` does NOT pass between Tasks 2 and 5.** Adding `bluetooth` to `PrintTransport` breaks `printers.ts`'s `REQUIRED_FIELDS` record until Task 3; renaming `PrinterTarget.usbPath → devicePath` breaks `runtime.ts` until Task 4; the new `Host` methods break `apps/print-agent` until its stubs (added in Task 2) and real impls (Task 6); the 4-arg `claimPrintJobs` breaks the server call until Task 4's stopgap. **Assert whole-workspace `pnpm typecheck` green only at the END of Task 5**, not after Tasks 2/3/4. Within the block, run each package's own tests where that package compiles, and commit per task.
- **Compile-keeping stubs/stopgaps** are called out in the tasks: Task 2 adds stub `Host` methods to `apps/print-agent` (real impls in Task 6) and updates this package's own fakes; Task 4 adds a one-line server call-site stopgap so `apps/server` keeps compiling until Task 5 supplies the real inventory.
- **The `Host` seam here intentionally supersedes spec §7's sketch** (recorded decision): the spec sketched `visibleKeys()`/`resolve(target)`/`ResolvedSink`; the plan ships `visibleDevices()` (carries make/model for the discovered list), `resolve(job): PrinterTarget`, and `scan(kinds?)`. Coherent and slightly richer; noted so a spec reader is not surprised.

Tasks 1, 6, 7, 8 are outside the interlock (1 is pure DB; 6/7/8 consume the settled contract) and each ends green on its own.

---

## File Structure

**Modify:**
- `packages/db/src/schema/printers.ts` — drop `agentId`/`usbPath`; add `localKey`; add `bluetooth` enum value.
- `packages/db/src/schema/print-jobs.ts` — add `claimedBy`.
- `packages/db/drizzle/*` — regenerated core migration + a `--custom` twin (CHECK rewrite, explicit FK drop, `(tenant_id, claimed_by)` FK, partial UNIQUE, grants).
- `packages/print-agent/src/{transport,host,client,agent}.ts` — the shared contract (Task 2).
- `packages/printing/src/{printers,errors,runtime}.ts` — write-path (Task 3) + claim/report (Task 4).
- `apps/server/src/print-api.ts` — create/patch bodies, POST pull + inventory, discovery window, discovered list, STATUS map.
- `apps/print-agent/src/*` — stub Host methods (Task 2) then real Linux impls + setup-page Bluetooth (Task 6); Dockerfile/compose access.
- `apps/dashboard/src/screens/printers-screen.ts` + `apps/dashboard/src/api/client.ts` — transport-aware flow, discovered list.
- the `apps/server` end-to-end print suite (Task 8).

**Create:** none (no new tables, no new packages).

---

## Task 1: Schema + migration — derive-not-store shape

**Files:**
- Modify: `packages/db/src/schema/printers.ts:12,35-76`, `packages/db/src/schema/print-jobs.ts:40-79`
- Create/Modify: `packages/db/drizzle/*` (regenerated pair)
- Test: `packages/db/src/schema/printing.test.ts` (extend; real PG via `describeEachTarget` for the CHECK/FK/unique)

**Interfaces:**
- Produces: `printers.local_key` (text, null for network_tcp/cloud_poll); `print_transport` value `bluetooth`; `print_jobs.claimed_by` (uuid, null); partial UNIQUE `printers_local_key_key` on `(tenant_id, location_id, local_key) WHERE local_key IS NOT NULL`; the `(tenant_id, claimed_by) → print_agents(tenant_id, id)` composite FK.

- [ ] **Step 1: Trace consumers.** `grep -rn "agent_id\|usbPath\|usb_path\|agentId" packages apps` and list every reader touched by dropping `printers.agent_id`/`usb_path` (schema doc comments, `runtime.ts` `ClaimedJob.usb_path`, `print-api.ts:330` reply map, `printers.ts` write-path, `apps/dashboard/src/api/client.ts` types, any `toEqual`-pinned wire-body test). These are handled in Tasks 2–7; this step is to confirm the set before editing.

- [ ] **Step 2: Write the failing schema tests** (real PG):

```ts
it("rejects a usb printer with no local_key (CHECK 23514)", async () => {
  await expect(insertPrinter({ transport: "usb", localKey: null })).rejects.toMatchObject({ code: "23514" });
});
it("accepts usb keyed on a serial and bluetooth keyed on a MAC", async () => {
  await expect(insertPrinter({ transport: "usb", localKey: "SN-ABC123" })).resolves.toBeDefined();
  await expect(insertPrinter({ transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" })).resolves.toBeDefined();
});
it("rejects a network_tcp printer with no host (CHECK 23514)", async () => {
  await expect(insertPrinter({ transport: "network_tcp", host: null })).rejects.toMatchObject({ code: "23514" });
});
it("rejects a second registration of the same (location, local_key) (UNIQUE 23505)", async () => {
  await insertPrinter({ transport: "usb", localKey: "SN-DUP" });
  await expect(insertPrinter({ transport: "usb", localKey: "SN-DUP" })).rejects.toMatchObject({ code: "23505" });
});
it("allows two NULL-local_key printers in one location (partial index)", async () => {
  await insertPrinter({ transport: "network_tcp", host: "10.0.0.1" });
  await expect(insertPrinter({ transport: "network_tcp", host: "10.0.0.2" })).resolves.toBeDefined();
});
it("rejects claimed_by naming an agent in another tenant (composite FK 23503)", async () => { /* insert a print_jobs row with a foreign claimed_by → 23503 */ });
it("verifies the old (tenant_id, agent_id) FK is gone", async () => { /* query pg_constraint: no constraint referencing printers.agent_id remains */ });
```

- [ ] **Step 3: Run to verify they fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test -- printing` → FAIL.

- [ ] **Step 4: Edit the schema.** In `printers.ts`:

```ts
export const printTransport = pgEnum("print_transport", ["usb", "network_tcp", "bluetooth", "cloud_poll"]);
// In the table: REMOVE agentId and usbPath. ADD:
localKey: text("local_key"), // usb: device serial; bluetooth: MAC. NULL for network_tcp/cloud_poll.
// Keep host, port, pollId, pollTokenHash, ticketScope, active. Update the table doc: no agent_id; local_key
// is the stable device id; the CHECK, the partial UNIQUE, and the (tenant_id, printer_id) FK on print_jobs
// stay hand-written in the --custom migration.
```

In `print-jobs.ts`, after `printerId`:

```ts
// The agent currently holding this job (set on claim, overwritten by a lease reclaim). Bare column: the
// tenant-consistent (tenant_id, claimed_by) → print_agents composite FK is hand-written in the --custom
// migration (MATCH SIMPLE skips it on NULL). Authorises the report — only the claimer reports its own job
// (runtime.ts). NULL while queued and after the job leaves `printing`.
claimedBy: uuid("claimed_by"),
```

- [ ] **Step 5: Regenerate the migration pair** (CLAUDE.md §3 recipe). `pnpm --filter @waitron/db db:generate --name central_printer_provisioning` for the enum value + column add/drop, then `db:generate:custom --name central_printer_provisioning_sql` for the hand-written DDL:

```sql
-- The old (tenant_id, agent_id) → print_agents FK and the old printers_transport_fields_ck were
-- hand-written (not generated), so db:generate will NOT emit a DROP for them. Drop them EXPLICITLY —
-- do not rely on DROP COLUMN cascading to a composite constraint (verify by reading pg_constraint back).
ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_agent_id_fk;
ALTER TABLE printers DROP CONSTRAINT IF EXISTS printers_transport_fields_ck;
ALTER TABLE printers ADD CONSTRAINT printers_transport_fields_ck CHECK (
  (transport = 'usb'         AND local_key IS NOT NULL) OR
  (transport = 'bluetooth'   AND local_key IS NOT NULL) OR
  (transport = 'network_tcp' AND host      IS NOT NULL) OR
  (transport = 'cloud_poll'  AND poll_id   IS NOT NULL)
);
CREATE UNIQUE INDEX printers_local_key_key ON printers (tenant_id, location_id, local_key) WHERE local_key IS NOT NULL;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_claimed_by_fk
  FOREIGN KEY (tenant_id, claimed_by) REFERENCES print_agents (tenant_id, id) MATCH SIMPLE;
-- Grants: app_user keeps its printers/print_jobs privileges; local_key/claimed_by inherit the table
-- grants. Confirm by reading privileges.test.ts — NEVER widen a grant to make a test pass.
```

(Use the real generated constraint names — confirm `printers_agent_id_fk` against the baseline SQL; substitute the actual name.) **Heed the bookings-DROP hazard:** open every generated file and delete any unintended DROP.

- [ ] **Step 6: Run schema + guards** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`; then the root guards `classification-complete`, `append-only-enable-always` (no table added/removed — run to prove classification unchanged) and `pnpm --filter @waitron/db test -- privileges`. Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -s -m "feat(db): printers keyed on local_key, jobs record claimed_by (central printer provisioning)"`

---

## Task 2: `@waitron/print-agent` — the shared contract (transport, seam, wire, loop)

> Interlock task — see the Sequencing note. Do NOT assert whole-workspace typecheck here; it goes green in Task 5.

**Files:**
- Modify: `packages/print-agent/src/transport.ts:15-35,96-139`, `host.ts:8-52`, `client.ts:8-76,188-232,278-286`, `agent.ts:98-126,129-255`
- Modify: `apps/print-agent/src/<host>.ts` — add **stub** `Host` methods (real impls in Task 6)
- Test: `packages/print-agent/src/{transport,client,agent}.test.ts`

**Interfaces (Produces):**
- `type PrintTransport = "usb" | "network_tcp" | "bluetooth" | "cloud_poll"`
- `type TransportKind = "usb" | "network_tcp" | "bluetooth"` (discoverable transports; excludes cloud_poll)
- `interface PrinterTarget { id; transport: PrintTransport; host: string | null; port: number | null; devicePath: string | null }`
- `interface VisibleDevice { transport: "usb" | "bluetooth"; localKey: string; make?: string; model?: string }`
- `interface DiscoveredDevice { transport: PrintTransport; localKey?: string; host?: string; port?: number; make?: string; model?: string; name?: string }`
- `interface PairResult { ok: boolean; localKey?: string; error?: string }`
- `Host` gains `visibleDevices(): Promise<VisibleDevice[]>`, `scan(kinds?: TransportKind[]): Promise<DiscoveredDevice[]>`, `resolve(job: WireJob): Promise<PrinterTarget>`, `pair(mac: string): Promise<PairResult>`
- `WireJob { …; localKey: string | null }` (replaces `usbPath`); `PullReply { …; discoveryUntil: number | null }`
- `pullJobs(url, token, inventory: { visible: VisibleDevice[]; scanned: DiscoveredDevice[] }): Promise<Result<PullReply>>`

- [ ] **Step 1: transport.ts — failing test then change.**

```ts
it("routes a bluetooth job to a device-path write", async () => {
  const file = tmpFile();
  const t = new RoutingTransport({ network_tcp: new FakeSink(), usb: new UsbTransport(), bluetooth: new UsbTransport() });
  await t.send({ id: "p", transport: "bluetooth", host: null, port: null, devicePath: file }, esc().line("x").bytes());
  expect(readFileSync(file)).toEqual(Buffer.from(esc().line("x").bytes()));
});
```

Change: `PrintTransport += "bluetooth"`; add `TransportKind`; `PrinterTarget.usbPath → devicePath` (update `UsbTransport.send` to write `printer.devicePath`, rename guard/message); add `bluetooth` to `TransportAdapters` + a `case "bluetooth"` in `RoutingTransport` (a device-path writer; a distinct `BluetoothTransport` class is acceptable and preferred so its error text is its own). `cloud_poll` still rejects.

- [ ] **Step 2: client.ts — failing test then change.**

```ts
it("posts the inventory and parses discoveryUntil + localKey", async () => {
  const fetch = fakeFetch({ nodeId: "n", servers: [], jobs: [{ id: "j", printerId: "p", transport: "usb", localKey: "SN-1", payload: "AA==" }], discoveryUntil: 123 });
  const r = await createClient({ fetch }).pullJobs("http://s", "tok", { visible: [{ transport: "usb", localKey: "SN-1" }], scanned: [] });
  expect(r.ok && r.value.jobs[0].localKey).toBe("SN-1");
  expect(r.ok && r.value.discoveryUntil).toBe(123);
  expect(fakeFetch.lastInit.method).toBe("POST");
});
```

Change: `WireJob.usbPath → localKey` (parse `e.localKey`); `PullReply` gains `discoveryUntil: number | null` (`typeof b.discoveryUntil === "number" ? b.discoveryUntil : null`); `pullJobs` takes `inventory` and uses `method: "POST"`, `content-type: application/json`, `body: JSON.stringify(inventory)`.

- [ ] **Step 3: host.ts — add the seam types + methods** (interface only). Add `VisibleDevice`, `DiscoveredDevice`, `PairResult`, `TransportKind` (re-export from transport.ts), and the four methods to `Host`. Add a one-line note that this supersedes spec §7's sketch.

- [ ] **Step 4: agent.ts — failing loop tests then change.** Extend the fake host in `agent.test.ts` with the four methods:

```ts
it("reports visible devices on every pull", async () => { /* host.visibleDevices → [{usb,SN-1}]; assert client.pullJobs body.visible carries it */ });
it("scans only within a discovery window", async () => {
  // reply1 discoveryUntil = now+10s → NEXT tick calls host.scan and includes scanned in the pull body;
  // reply2 discoveryUntil = null → host.scan NOT called.
});
it("resolves a usb job before sending", async () => {
  // host.resolve(job) → { transport:'usb', devicePath:'/tmp/x', host:null, port:null }; assert transport.send got that target.
});
it("marks a job failed when resolve throws (device gone)", async () => {
  // host.resolve rejects → push reports failed, loop continues.
});
```

Change in `agent.ts`:
- `tick()` gathers `const visible = await host.visibleDevices();`; a cross-tick `discoveryUntil` (from the previous reply) drives `const scanned = host.now() < discoveryUntil ? await host.scan() : []`; pass `{ visible, scanned }` to `client.pullJobs(current, token, …)`.
- Store `pulled.value.discoveryUntil ?? 0` into the cross-tick variable.
- `push(job, …)`: `const target = await host.resolve(job);` inside the try, then `await host.transport.send(target, job.payload)`. A throwing `resolve` falls into the existing catch → `failed`.

- [ ] **Step 5: Stub the container host** in `apps/print-agent` so it still satisfies `Host`: `visibleDevices()` → `[]`, `scan()` → `[]`, `pair()` → `{ ok: false, error: "not implemented on this host yet" }`, `resolve(job)` → passthrough (`{ id: job.printerId, transport: job.transport, host: job.host, port: job.port, devicePath: job.localKey }`). Task 6 replaces these. Add a `// TODO(Task 6): real Linux implementation` note pointing at this plan.

- [ ] **Step 6: Run** — `pnpm --filter @waitron/print-agent test:coverage` → PASS; `pnpm --filter @waitron/print-agent typecheck` + the app's typecheck (both compile now, via the stubs). Do NOT run whole-workspace typecheck (it fails until Task 5 — Sequencing note).

- [ ] **Step 7: Commit** — `git commit -s -m "feat(print-agent): bluetooth transport, device seam (visibleDevices/scan/resolve/pair), inventory-carrying pull"`

---

## Task 3: printing write-path — create/update/list by local_key

> Interlock task. Consuming Task 2's `PrintTransport` (now with `bluetooth`) fixes `REQUIRED_FIELDS`'s exhaustiveness.

**Files:**
- Modify: `packages/printing/src/printers.ts:31-44,67-92,105-140,151-175,186-276`, `errors.ts:20-37`
- Test: `packages/printing/src/printers.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; Task 2 `PrintTransport`.
- Produces: `CreatePrinterInput { name, transport, host?, port?, localKey?, pollId? }`; `UpdatePrinterInput` (fields, connection + `localKey` nullable); `PrinterRow { id, name, transport, host, port, localKey, pollId, ticketScope, active }`; error `printer.already_registered { localKey }`.

- [ ] **Step 1: Failing unit tests** (PGlite — logic + mapping):

```ts
it("creates a usb printer from a serial", async () => {
  expect((await createPrinter(tx, cfg, { name: "Cocina", transport: "usb", localKey: "SN-1" })).id).toBeDefined();
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

- [ ] **Step 3: Edit `errors.ts`** — add the code, update the doc:

```ts
/** A create/register whose stable device key (USB serial / Bluetooth MAC) already names a printer in
 * this venue — the partial UNIQUE (tenant_id, location_id, local_key). `localKey` is echoed so the
 * dashboard can point at the existing registration. */
"printer.already_registered": { localKey: string };
// Update printer.invalid_config's doc: required fields are now host (network_tcp), local_key
// (usb/bluetooth), poll_id (cloud_poll); no transport requires agent_id.
```

- [ ] **Step 4: Edit `printers.ts`.** Drop `agentId`/`usbPath` from `CreatePrinterInput`/`UpdatePrinterInput`/`PrinterRow`; add `localKey`. New `REQUIRED_FIELDS`:

```ts
const REQUIRED_FIELDS: Record<PrintTransport, readonly (keyof CreatePrinterInput)[]> = {
  usb: ["localKey"], bluetooth: ["localKey"], network_tcp: ["host"], cloud_poll: ["pollId"],
};
```

`createPrinter`/`updatePrinter` write `localKey`; `listPrinters` selects `localKey: printers.localKey`. Rewrite `translatePrinterWriteError` (the agent FK is gone):

```ts
const UNIQUE_VIOLATION = "23505";
function translatePrinterWriteError(error: unknown, localKey: string | undefined): never {
  if (localKey !== undefined && isPgError(error, UNIQUE_VIOLATION)) throw new AppError("printer.already_registered", { localKey });
  if (isPgError(error, CHECK_VIOLATION)) throw new AppError("printer.invalid_config", { reason: "transport_fields" });
  throw error;
}
// callers pass input.localKey / patch.localKey ?? undefined.
```

- [ ] **Step 5: Run** — `pnpm --filter @waitron/printing test:coverage` → PASS (this package compiles; `runtime.ts` still references old `PrinterTarget.usbPath` — Task 4 fixes it, so a whole-package typecheck of printing may still fail on runtime.ts; that is expected and resolved next task).

- [ ] **Step 6: Commit** — `git commit -s -m "feat(printing): create/update printers by local_key; printer.already_registered"`

---

## Task 4: runtime — derived eligibility, claimed_by, distinct-agents race

> Interlock task. Fixes `runtime.ts` against Task 2's `PrinterTarget.devicePath` and adds the server call-site stopgap so `apps/server` keeps compiling.

**Files:**
- Modify: `packages/printing/src/runtime.ts:82-90,139-182,214-239,261-268`; a one-line stopgap in `apps/server/src/print-api.ts:314`
- Test: `packages/printing/src/runtime.eligibility.test.ts` (new), `runtime.race.test.ts` (add distinct-agents)

**Interfaces:**
- Consumes: Task 1 schema; Task 2 `PrinterTarget`; Task 3 `createPrinter`.
- Produces: `claimPrintJobs(tx, cfg, agentId, ctx: { locationId: string; visibleKeys: string[] }): Promise<ClaimedJob[]>`; `ClaimedJob` replaces `usb_path` with `local_key`; `reportPrintJob` (same signature) authorised by `claimed_by`.

- [ ] **Step 1: Failing eligibility tests** (real PG — eligibility + skip-locked; PGlite serialises → a race is a false pass, CLAUDE.md §4):

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

Prove the venue conjunct by deleting `p.location_id = ${ctx.locationId}` and confirm the usb negative control (empty `visibleKeys`) fails for the right reason (scoped by keys, not location).

- [ ] **Step 2: Run to verify fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test -- eligibility` → FAIL.

- [ ] **Step 3: Edit `claimPrintJobs`:**

```ts
export type ClaimedJob = { id: string; printer_id: string; payload: Buffer; transport: PrintTransport; host: string | null; port: number | null; local_key: string | null; };

export async function claimPrintJobs(tx, cfg, agentId, ctx: { locationId: string; visibleKeys: string[] }) {
  // Empty visibleKeys ⇒ the usb/bt branch matches nothing (`in ()` degenerates — the drain.ts hazard,
  // runtime.ts:168-171), so guard with `false`. `in ${array}` is the proven-correct expansion (NOT
  // `= any(…)`/`in (${ids})`).
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

Update the header comment: the join is no longer the authorization scope (eligibility is derived from venue + visible keys — spec §3); `claimed_by` records the holder and a lease reclaim overwrites it.

- [ ] **Step 4: Edit `reportPrintJob`** — scope by `claimed_by`, drop the printers join (printers are never hard-deleted, so nothing is lost); keep the tenant + `status='printing'` idempotency guards:

```ts
const result = await tx.execute<{ id: string }>(sql`
  update print_jobs set ${setClause}
  where print_jobs.tenant_id = ${cfg.tenantId} and print_jobs.id = ${jobId}
    and print_jobs.status = 'printing' and print_jobs.claimed_by = ${agentId}
  returning print_jobs.id`);
```

Update the header: the authorization scope is now `claimed_by` (proven by deletion).

- [ ] **Step 5: Edit `runAgentOnce`** — local-mode target uses `local_key` as the device path (local mode + FakeSink ignores `devicePath`; real resolution is the host's job, Task 6):

```ts
const target: PrinterTarget = { id: job.printer_id, transport: job.transport, host: job.host, port: job.port, devicePath: job.local_key };
```

Add `locationId` + `visibleKeys` to `AgentRuntimeDeps` and pass them into `claimPrintJobs`; local-mode callers default `visibleKeys: []`.

- [ ] **Step 6: Server call-site stopgap.** In `apps/server/src/print-api.ts:314`, change the call to keep the workspace compiling until Task 5:

```ts
// STOPGAP (Task 4): pass the agent's venue + an empty visible-key set so the tree compiles; Task 5
// replaces [] with the inventory the agent posts, enabling USB/BT claims. IP claims work already.
return claimPrintJobs(tx, deps.cfg, agentId, { locationId: deps.cfg.locationId, visibleKeys: [] });
```

- [ ] **Step 7: Add the distinct-agents race test** (real PG) in `runtime.race.test.ts`: two `agentId`s, one `network_tcp` printer, N queued jobs; run both agents' `claimPrintJobs` concurrently in separate transactions; assert the union of claimed ids has no duplicate and totals N. Prove the lock by deleting `for update of j skip locked` → a duplicate appears.

- [ ] **Step 8: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test:coverage` → PASS. Whole-workspace `pnpm typecheck` still fails on `apps/server`'s pull-reply map (`usb_path` → not yet `local_key`) — expected, fixed in Task 5.

- [ ] **Step 9: Commit** — `git commit -s -m "feat(printing): derive claim eligibility from venue + visible keys; report by claimed_by; distinct-agents race test"`

---

## Task 5: server routes — inventory pull, discovery window, discovered list

> Interlock task — the LAST of the block. Assert whole-workspace `pnpm typecheck` green at the end of this task.

**Files:**
- Modify: `apps/server/src/print-api.ts:135-152,303-335,408-432,444-480` + two new routes + in-memory stores in `mountPrintApi`
- Test: `apps/server/src/print-api.test.ts` (PGlite), `apps/server/src/print-api.pg.test.ts` (real PG grants)

**Interfaces:**
- Consumes: Task 3 verbs, Task 4 `claimPrintJobs(…, ctx)`, Task 2 wire shapes.
- Produces: `POST /print-api/agent/jobs` (was GET) reading `{ visible, scanned }`; reply `{ nodeId, servers, jobs:[{…, localKey}], discoveryUntil }`; `POST /management-api/printer-discovery/start` → `{ discoveryUntil }`; `GET /management-api/discovered-printers` → `[{ agentId, agentName, transport, localKey?, host?, port?, make?, model?, name?, alreadyRegistered }]`.

- [ ] **Step 1: Failing route tests:**

```ts
it("POST /print-api/agent/jobs carries the inventory and claims by key", async () => { /* register usb printer SN-1; enqueue; pull visible:[{usb,SN-1}] → 1 job carrying localKey; pull visible:[] → 0 */ });
it("returns discoveryUntil after a discovery window is opened", async () => { /* POST printer-discovery/start (manage) → discoveryUntil; agent pull reply carries it */ });
it("GET /management-api/discovered-printers lists reported devices, marking registered ones", async () => { /* agent pull reports SN-1 + SN-2; register SN-1; list shows SN-1 alreadyRegistered:true, SN-2 false */ });
it("POST /management-api/printers with a duplicate local_key → 409", async () => { /* … */ });
it("create requires localKey for usb (422) and ignores agentId/usbPath", async () => { /* … */ });
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @waitron/server test -- print-api` → FAIL.

- [ ] **Step 3: In-memory stores + STATUS.** In `mountPrintApi`, closure-scoped:

```ts
// Transient venue state (spec §6): the discovered inventory + the discovery window live in memory — no
// table (owner, 2026-09-09). Agent polls rebuild them within ~2s of a restart.
interface DiscoveredEntry { agentId: string; transport: string; localKey?: string; host?: string; port?: number; make?: string; model?: string; name?: string; lastSeenAt: number; }
const discovered = new Map<string, DiscoveredEntry>(); // key: `${agentId}:${transport}:${localKey ?? host+":"+port}`
let discoveryUntil = 0; // epoch ms; 0 = closed
const DISCOVERY_WINDOW_MS = 3 * 60_000;
const DISCOVERED_TTL_MS = 15_000;
```

Add `"printer.already_registered": 409` to `STATUS` (§9). Import `isNotNull` from `drizzle-orm`.

- [ ] **Step 4: Rewrite the pull as POST.** `app.post("/print-api/agent/jobs", …)`: after `requireAgent`, `readJsonBody<{ visible?: unknown; scanned?: unknown }>`, shape-screen to `VisibleDevice[]`/`DiscoveredDevice[]` (drop malformed entries), upsert into `discovered` (stamp `lastSeenAt = Date.now()`), `const visibleKeys = visible.filter(v => v.transport === "usb" || v.transport === "bluetooth").map(v => v.localKey)`, then:

```ts
const claimed = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
  await asAppUser(tx);
  return claimPrintJobs(tx, deps.cfg, agentId, { locationId: deps.cfg.locationId, visibleKeys });
});
const held = await deps.readMembership();
return c.json({ nodeId: deps.cfg.nodeId, servers: routableServers(held),
  jobs: claimed.map(j => ({ id: j.id, printerId: j.printer_id, transport: j.transport, host: j.host, port: j.port, localKey: j.local_key, payload: Buffer.from(j.payload).toString("base64") })),
  discoveryUntil: discoveryUntil > Date.now() ? discoveryUntil : null });
```

Note: `deps.cfg.locationId` is this server's location, which equals the agent's location under one-location-per-DB. A future multi-location tenant reads the agent's own `print_agents.location_id` instead — leave a `// TODO(multi-location)` comment.

- [ ] **Step 5: Two management routes.**

```ts
app.post("/management-api/printer-discovery/start", (c) => run(c, log, async () => {
  const sessionId = requireManagementSession(c);
  await gated(sessionId, async () => {}); // authorises printer.manage (a session DB read); no printer/job work
  discoveryUntil = Date.now() + DISCOVERY_WINDOW_MS;
  return c.json({ discoveryUntil });
}));

app.get("/management-api/discovered-printers", (c) => run(c, log, async () => {
  const sessionId = requireManagementSession(c);
  const now = Date.now();
  for (const [k, e] of discovered) if (now - e.lastSeenAt > DISCOVERED_TTL_MS) discovered.delete(k);
  const { registered, agents } = await gated(sessionId, async (tx) => ({
    registered: await tx.select({ localKey: printers.localKey }).from(printers)
      .where(and(eq(printers.tenantId, deps.cfg.tenantId), isNotNull(printers.localKey))),
    agents: await tx.select({ id: printAgents.id, name: printAgents.name }).from(printAgents)
      .where(eq(printAgents.tenantId, deps.cfg.tenantId)), // tenant predicate — CLAUDE.md §3
  }));
  const names = new Map(agents.map(a => [a.id, a.name]));
  const keys = new Set(registered.map(r => r.localKey));
  return c.json([...discovered.values()].map(e => ({ agentId: e.agentId, agentName: names.get(e.agentId) ?? null,
    transport: e.transport, localKey: e.localKey, host: e.host, port: e.port, make: e.make, model: e.model, name: e.name,
    alreadyRegistered: e.localKey !== undefined && keys.has(e.localKey) })));
}));
```

- [ ] **Step 6: create/patch bodies.** In `POST /management-api/printers`: remove the `agentId`/`usbPath` reads, add `const localKey = optionalString(body.localKey, "localKey"); if (localKey !== undefined) input.localKey = localKey;`. In `PATCH`: remove `agentId`/`usbPath`, add `const localKey = nullableOptionalString(body.localKey, "localKey"); if (localKey !== undefined) patch.localKey = localKey;`. Remove the now-unused `optionalUuid`/`nullableOptionalUuid` if grep shows no other user.

- [ ] **Step 7: Run** — `pnpm --filter @waitron/server test:coverage -- print-api` then the real-PG grants suite; then the package **UNFILTERED** (`pnpm --filter @waitron/server test:coverage`) to catch any `toEqual`-pinned wire-body/boot suite the GET→POST + `localKey` change broke. Finally **whole-workspace `pnpm typecheck` → PASS** (the interlock closes here). Expected: PASS.

- [ ] **Step 8: Commit** — `git commit -s -m "feat(server): inventory-carrying pull, discovery window + discovered-printers, create/patch by localKey"`

---

## Task 6: apps/print-agent — real container Host + Bluetooth setup page

**Files:**
- Modify: `apps/print-agent/src/*` (replace Task 2's stubs), the setup page, `Dockerfile` + Track P compose note
- Test: `apps/print-agent/src/*.test.ts` (fixture-based) + a manual hardware receipt

**Interfaces:** Consumes Task 2's `Host` contract. Produces the concrete Linux host; no new exported types.

> Exact OS calls are confirmed on the arriving USB/Bluetooth printer (2026-09-10, spec §7). TDD what is hardware-independent (parsing) against fixtures; gate live paths behind a manual receipt. Do NOT assert an unverified OS behaviour in a comment (CLAUDE.md §1) — state the experiment.

- [ ] **Step 1: USB `visibleDevices`/`resolve` against sysfs fixtures.** Write an internal `readUsbPrinters(sysfsRoot): (VisibleDevice & { devicePath: string })[]` that walks sysfs correlating a `usblp`/`/dev/usb/lpN` node to its parent device `serial`/`manufacturer`/`product`. Test against a checked-in tmpdir fixture (no hardware):

```ts
it("reads serial + device path from a sysfs fixture", async () => {
  const root = writeSysfsFixture({ lp: "lp0", serial: "SN-ABC", manufacturer: "Epson", product: "TM-T20" });
  expect(await readUsbPrinters(root)).toEqual([{ transport: "usb", localKey: "SN-ABC", make: "Epson", model: "TM-T20", devicePath: `${root}/dev/usb/lp0` }]);
});
```

`Host.visibleDevices()` returns the usb list (mapped to `VisibleDevice`, dropping `devicePath`) plus paired BT (Step 3). `Host.resolve(job)` for usb/bluetooth looks `job.localKey` up via the **internal** `readUsbPrinters`/paired-BT list (which retains `devicePath`), returning `{ id, transport, host: null, port: null, devicePath }`, and throws `new Error("device <key> not attached")` if absent; for `network_tcp` it passes `host`/`port` through with `devicePath: null`. (Do NOT call the public `visibleDevices()` — it has no `devicePath`.)

- [ ] **Step 2: Network `scan` against captured responses.** Implement mDNS `_pdl-datastream._tcp` + a bounded 9100 sweep behind `scan(["network_tcp"])`; unit-test the response parser against a captured packet/fake socket (host-safe). Live multicast is exercised under host networking (Step 5) + the receipt.

- [ ] **Step 3: Bluetooth `scan`/`pair`/paired-list.** Over BlueZ (DBus): `scan(["bluetooth"])` runs an inquiry → `{ transport:"bluetooth", localKey: mac, name }`; `pair(mac)` bonds → `PairResult`; paired devices feed `visibleDevices`/`resolve`. Unit-test the DBus-reply decoding against fixtures; live radio is the receipt. If containerised BlueZ proves infeasible, record the finding + the packaging fix in spec §7 — the seam is unchanged.

- [ ] **Step 4: Setup-page Bluetooth section.** Add a **Bluetooth** panel to the Hono setup page: **Scan** (`host.scan(["bluetooth"])`), a found-devices list, a per-device **Pair** (`host.pair(mac)`) showing the result. Test with `app.request` + a fake host. LAN, secret-free (as #289).

- [ ] **Step 5: Container access.** In `Dockerfile`/compose: broader USB (`/dev/bus/usb` + sysfs), host networking (or a documented macvlan) for mDNS, the BlueZ DBus socket for Bluetooth — each with a one-line why. Track P wires the same beside the server (spec §2.2 owed item).

- [ ] **Step 6: Hardware receipt (2026-09-10).** With the real printer: (a) printer-class (`/dev/usb/lpN`) vs vendor-specific — record it; (b) one USB test-print end to end; (c) Bluetooth pair + one BT test-print; (d) mDNS finds the HP over the LAN. Record in spec §7/§12 and here; adjust `resolve`/`scan` to what the hardware presents.

- [ ] **Step 7: Run + commit** — `pnpm --filter <apps/print-agent's package name> test:coverage`; `git commit -s -m "feat(print-agent-app): Linux USB/network/Bluetooth host + setup-page pairing"`.

---

## Task 7: dashboard — transport-aware create flow + discovered list

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (create form `:1089-1174`, submit `:576-597`, state `:263-269`, transports `:61-67`, per-row `:907-1022`), `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/screens/printers-screen.test.ts` (browser mode)

**Interfaces:** Consumes Task 5 routes. Produces client methods `createPrinter({ name, transport, host?, port?, localKey? })`, `startPrinterDiscovery(): Promise<{ discoveryUntil }>`, `listDiscoveredPrinters(): Promise<DiscoveredPrinter[]>`.

- [ ] **Step 1: Failing component tests** (browser mode — check memory headroom first, CLAUDE.md §2/§4):

```ts
it("adds an IP printer with name + host + port, no agent picker", async () => { /* fill, submit, assert createPrinter called with {transport:'network_tcp', host, port} and NO agentId */ });
it("registers a discovered USB printer by picking it and naming it", async () => { /* stub listDiscoveredPrinters → [{transport:'usb', localKey:'SN-1', make, agentName, alreadyRegistered:false}]; Register → name → createPrinter({transport:'usb', localKey:'SN-1', name}) */ });
it("shows already-registered discovered devices as registered (no Register action)", async () => { /* alreadyRegistered:true row */ });
it("Scan opens a discovery window", async () => { /* click Scan → startPrinterDiscovery called */ });
```

- [ ] **Step 2: Run to verify fail** — dashboard browser suite → FAIL.

- [ ] **Step 3: Client methods** in `api/client.ts` mirroring the existing `createPrinter`/`listPrinters` fetch shape: `startPrinterDiscovery` → `POST /management-api/printer-discovery/start`; `listDiscoveredPrinters` → `GET /management-api/discovered-printers`; drop `agentId`/`usbPath` from the printer create/patch payloads, add `localKey`.

- [ ] **Step 4: Rewrite the create section.** Remove the agent `<select>` (`:1120-1130`), its ref/reconcile (`:276-303`), and the `usbPath` field. Split by transport (`TRANSPORTS = ["network_tcp", "usb", "bluetooth"]`):
  - `network_tcp`: name + host + port, plus a **Scan** button (`startPrinterDiscovery`) listing discovered `network_tcp` results to pre-fill host/port.
  - `usb`/`bluetooth`: a **discovered-printers list** (`listDiscoveredPrinters`, filtered to the transport) with a per-unregistered-row **Register** button that prompts for a name → `createPrinter({ transport, localKey, name })`.
  - `bluetooth`: a one-line note — "Pair the printer first on the box's setup page (`http://<box>:9110`)."
  In the per-row display (`:907-1022`) drop the agent column; optionally show "last seen on <agentName>" from the discovered list.

- [ ] **Step 5: Run + commit** — dashboard `test:coverage` (browser) → PASS; `git commit -s -m "feat(dashboard): transport-aware printer create + discovered-printers list"`.

---

## Task 8: end-to-end + dev + security review

**Files:** the `apps/server` end-to-end print suite; `apps/server/scripts/dev-setup.ts` (optional dev seed)

- [ ] **Step 1: End-to-end** (real `mountPrintApi` on PGlite, agent `runOnce` with `fetch` → the Hono app). Failing test: register an IP printer + a USB printer (via `createPrinter`), the agent joins + is accepted, `enqueuePrintJob` on each; the agent pulls **carrying a fake inventory** including the USB serial; bytes land on a loopback TCP listener (IP) and a fake device sink (USB); both jobs `done`; then revoke → the loop reports `unauthorized` and claims nothing. Wire the fake `Host.resolve` to map the USB serial to the fake sink and `visibleDevices` to report it.

- [ ] **Step 2: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` UNFILTERED → PASS.

- [ ] **Step 3: Optional dev seed** — if useful, seed one `network_tcp` printer at a dev sink in `dev-setup.ts` so `wa-wt reset` shows a printer; skip if it complicates boot. Commit only if added.

- [ ] **Step 4: Security review.** Run the mandated `security-review` on the diff (the authz boundary moved to venue/visible-keys + `claimed_by`). Confirm by RUNNING, not reading: a two-tenant / cross-agent probe as `app_user` (rolsuper=f) — a foreign agent cannot claim or report another venue's jobs, and a USB job is only claimable by an agent reporting the key. Record the experiment.

- [ ] **Step 5: Full gate + commit** — `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. `git commit -s -m "test(printing): end-to-end register→pull-with-inventory→deliver; revoke halts"`.

---

## Self-Review

**Spec coverage:** §2(a) derive-not-store → Tasks 1,4,5,7. §2(b) USB discovery + serial key → Tasks 1,2,3,5,6,7. §2(c) IP discoverable, host:port key → Tasks 2(scan),5(discovered),6(mDNS),7(Scan). §2(d) Bluetooth transport + box-local pairing → Tasks 1(enum),2(transport),6(pair+setup page),7. §2(e) windowed discovery → Tasks 2(loop),5(window),7. §2(f) no drivers → inherent (raw ESC/POS device-path/TCP write); page printers out of scope. §2(g) in-memory stores, drop-recreate → Tasks 5,1. §3 eligibility → Task 4. §4 schema → Task 1. §5 claim/report + race → Task 4. §6 discovery split → Tasks 2,5,6. §7 seam → Tasks 2,6 (with the recorded §7-supersession note). §8 loop/wire → Task 2. §9 routes → Task 5. §10 dashboard → Task 7. §11 security → Task 8. §12 tests → every task + Task 6 receipts + Task 8 review. §13 follow-ups (MAC-keyed IP, per-claim token) deliberately unbuilt.

**Sequencing (the review's B1/B2):** the shared-type interlock is now explicit — Task 2 lands the `@waitron/print-agent` contract first (with `apps/print-agent` stubs + fake updates keeping compile), Task 3 fixes `REQUIRED_FIELDS` exhaustiveness, Task 4 fixes `runtime.ts` against `devicePath` and stopgaps the server call, Task 5 closes the loop and is the single point where whole-workspace `pnpm typecheck` is asserted green. No task references a type its predecessors have not produced.

**Placeholder scan:** Task 6's OS code is fixture-tested + hardware-receipt-gated (spec commits to 2026-09-10), not a placeholder — seam contract and fixture tests are concrete; only live-radio/live-multicast assertions wait on hardware. No "TBD"/"add validation"/"similar to Task N".

**Type consistency:** `PrintTransport`(+bluetooth)/`TransportKind`/`PrinterTarget.devicePath`/`VisibleDevice`/`DiscoveredDevice`/`PairResult`/`WireJob.localKey`/`PullReply.discoveryUntil`/`pullJobs(…, inventory)` (Task 2) are consumed with matching shapes by Task 4 (`ClaimedJob.local_key`, `runAgentOnce` target), Task 5 (reply `localKey`/`discoveryUntil`, `claimPrintJobs(…, ctx)`), Task 6 (`resolve` via internal `readUsbPrinters`, `scan(kinds?)`). `scan` is `scan(kinds?: TransportKind[])` everywhere (Task 2 defn, Task 4 loop `host.scan()`, Task 6 `host.scan(["bluetooth"])`). `printer.already_registered { localKey }` (Task 3) → 409 (Task 5). Consistent.
