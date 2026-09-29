# Print Agent Setup Lockdown and Bluetooth Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close a joined print agent's unauthenticated LAN setup page, let an out-of-touch agent deliberately restart joining after five minutes, remember venue servers across restarts, and move safe Bluetooth pairing and forgetting behind the dashboard's manager permission.

**Architecture:** Ship this in three pull requests that are independently green. The first changes only the agent's persisted state, control loop, and setup page. The second adds backward-compatible Bluetooth inventory and command wire support to the agent without any server issuing commands yet. The third adds the server's bounded in-memory command channel and the dashboard controls; Bluetooth delivery remains unavailable and continues to fail loudly at `liveBtDevicePath`.

**Tech Stack:** TypeScript 7, Hono and `@hono/node-server`, Node.js 26, Lit, Vitest 4 (Node and real Chromium projects), BlueZ `bluetoothctl`, Drizzle-backed server tests through `useVenueDb`.

**Spec:** `docs/superpowers/specs/2026-09-27-print-agent-setup-lockdown-design.md`

## Global Constraints

- Bluetooth delivery is not part of this plan. Do not make `liveBtDevicePath` return a path, claim Bluetooth jobs merely because a device is paired, or imply that a paired printer can print.
- There is no database migration. Commands, delivery acknowledgements, and their latest outcomes live in server memory and expire.
- The page decides access from the socket peer returned by `getConnInfo(c).remote.address`; it never reads `Forwarded` or `X-Forwarded-For`.
- A joined agent is one with a stored token and no stored `pendingVerificationNumber`. The join write persists the number before the token so a crash cannot make an unapproved token look approved.
- Setup access never infers server reachability from `AgentStatus.phase`. Track `outOfTouch` separately, set it only when a router round finds no accepting primary or an authenticated job pull fails for a reason other than refusal, and start it as false after every process restart.
- The configured server stays first in the router. Persisted alternatives never bypass the existing environment pin.
- A denied or revoked agent still clears its token. Saving a new server address, or finishing the five-minute reset window, lets it try again without a process restart.
- Keep the spec's accepted residual risk explicit: someone who can isolate an agent from every server, press reset, and wait out five minutes can repoint that agent after it becomes unjoined. Do not describe the countdown as protection against that attacker.
- Pair and Forget pairing use the existing `printer.manage` permission. Pair accepts only a fresh Bluetooth scan by the named agent; Forget accepts only a pairing the named agent reports now.
- Paired Bluetooth inventory is separate from `visible`: putting it in `visible` would let the server claim jobs whose delivery path is deliberately unimplemented.
- A failed scan, paired-device read, Bluetooth command, or command-result report never prevents that pull's print jobs from being delivered. Bluetooth `info` enrichment is capped and concurrent, so its delay is bounded by one command timeout rather than growing once per discovered device.
- Do not implement or expose Pair or Forget until the real-box prerequisite records the deployed BlueZ pairing, trust/reconnection, and remove behavior. That receipt does not block this plan or P2a; it gates P2b and P2c's hardware commands.
- The dashboard initially hides Bluetooth devices that do not look like printers, but **Show all devices** always exposes them. Pairing does not register a printer, and disabling a registered printer does not forget it.
- All new English and Spanish strings land together. The dashboard wording explicitly says Bluetooth printing is not available yet.
- Every feature or bug fix begins with the named failing test. Preserve existing behavioral assertions and use `git commit -s`; never bypass hooks.

## Review Focus

1. A crash after either join-state write must never classify an unapproved agent as joined. Task 1 pins the number-before-token order and both partial persisted states.
2. A setup-page save racing an in-flight pull must not let the old tick restore the old server list or environment. Task 2 serializes control operations with ticks and holds the pull while the save waits behind it.
3. Approval racing a setup POST must not let the queued POST clear a newly approved token. Tasks 2 and 3 recheck the mutation's precondition inside the serialized operation.
4. A local inventory failure must not be mistaken for loss of the primary, and the restart window before the first probe must fail closed. Tasks 2 and 3 pin the separate `outOfTouch` signal and its false startup value.
5. A lost HTTP response after the server accepts a command outcome must not execute Pair or Forget twice. Tasks 6 and 7 keep an outcome until a successful pull and deduplicate a repeated command id.
6. The same MAC scanned or paired by another agent, or by this agent outside the freshness window, must not authorize a command. Tasks 9 and 10 test agent identity and separate `scannedAt`/`pairedAt` timestamps.
7. A real receipt printer that omits the expected icon, class, and Serial Port UUID must remain reachable through **Show all devices**. Tasks 5 and 11 test the unknown classification and the dashboard escape hatch.

---

## Pull-request division

| Queue item | Branch | Deliverable | Why `main` still works by itself |
| --- | --- | --- | --- |
| P2a | `feat/print-agent-setup-lockdown` | Safe persisted join state, remembered servers, restart-free reconfiguration, five-minute reset window, access-controlled setup page, Bluetooth card/routes removed | No wire response changes and no server dependency; the agent continues to understand today's pull reply. |
| P2b | `feat/print-agent-bluetooth-channel` | After the real-box prerequisite: printer-likeness decoder, paired inventory, measured Pair/Forget host commands, optional command/outcome wire fields, agent execution | All new reply fields are optional. Today's server sends no command, so behavior is unchanged except richer inventory capability that no route consumes yet. |
| P2c | `feat/dashboard-bluetooth-pairing` | Bounded server command store, pair/forget routes and pull integration, printers-only dashboard list, outcomes, wording, visual proof | It consumes the optional P2b wire contract already on `main`; no migration or hardware delivery promise is introduced. |

Land the three pull requests in that order. Before P2c starts, repeat the Lane E overlap check for `apps/dashboard/src/i18n/strings.ts` and `apps/dashboard/src/screens/printers-screen.ts`.

---

## P2a — Agent state, reset control, and setup-page lockdown

### Task 1: Persist safe join state and the venue server list

**Files:**

- Modify: `packages/print-agent/src/host.ts`
- Modify: `packages/print-agent/src/router.ts`
- Modify: `packages/print-agent/src/router.test.ts`
- Modify: `packages/print-agent/src/agent.ts`
- Modify: `packages/print-agent/src/agent.test.ts`
- Modify: `apps/print-agent/src/state.ts`
- Modify: `apps/print-agent/src/state.test.ts`
- Modify: `apps/print-agent/src/host.ts`
- Modify: `apps/print-agent/src/host.test.ts`

**Interfaces:**

- Consumes: `PullReply.servers: ServerEntry[]` and the existing `Router.merge()` environment filtering.
- Produces: `AgentConfig.servers?: ServerEntry[]`; `RouterOptions.initialServers?: ServerEntry[]`; safe join persistence in the order `saveConfig(pending)` then `saveToken(token)`.

- [ ] **Step 1: Write the failing persistence and router tests**

Add these cases before implementation:

```ts
it("preserves the remembered server list on a config round-trip", async () => {
  await state.writeConfig({
    serverUrl: "https://configured.test",
    name: "kitchen",
    servers: [{ url: "https://standby.test", nodeId: "n2" }],
  });
  expect(await state.readConfig()).toMatchObject({
    servers: [{ url: "https://standby.test", nodeId: "n2" }],
  });
});

it("starts with remembered servers after a restart, configured address first", async () => {
  const router = new Router({
    configuredUrl: A,
    initialServers: [{ url: B, nodeId: "n2" }],
    probe,
  });
  expect(router.servers().map(({ url }) => url)).toEqual([A, B]);
});
```

In `agent.test.ts`, add a restart case that receives `B`, persists it, creates a new agent over the same fake host, and proves the new router probes both `A` and `B`. Add a negative case whose remembered `B` reports another environment and prove the token is never sent to it.

- [ ] **Step 2: Run the focused tests and observe the expected failures**

Run:

```bash
pnpm --filter @waitron/print-agent exec vitest run src/router.test.ts src/agent.test.ts
pnpm --filter @waitron/print-agent-app exec vitest run src/state.test.ts src/host.test.ts
```

Expected: compile/assertion failures because `servers` and `initialServers` do not exist and the reply list is not saved.

- [ ] **Step 3: Add the persisted interfaces and strict decoder**

Extend the config and router inputs exactly as follows:

```ts
export interface AgentConfig {
  serverUrl: string;
  name: string;
  environment?: string;
  pendingVerificationNumber?: string;
  servers?: ServerEntry[];
}

export interface RouterOptions {
  configuredUrl: string;
  environment?: string;
  initialServers?: ServerEntry[];
  probe: AgentClient["probeNode"];
}
```

`FileState.readConfig()` accepts only array entries with an HTTP(S) `url` string and an optional string `nodeId`; malformed entries are dropped, not trusted. `createContainerHost.config()` preserves `pendingVerificationNumber` and `servers` when `WAITRON_SERVER_URL` overlays the URL. The router constructor calls `merge(opts.initialServers ?? [])`, which already keeps the configured address first and removes invalid/duplicate origins.

- [ ] **Step 4: Save a changed server list only after a successful pull**

After `r.merge(pulled.value.servers)`, derive the normalized alternatives from `r.servers()` and save them only when their `{url,nodeId}` values differ from `config.servers`. Do not persist router state (`primary`, `standby`, `term`). A failed pull keeps the last successful list.

- [ ] **Step 5: Write the failing join-write-order controls**

Instrument `fakeHost` with ordered `saveConfig` and `saveToken` calls, then assert:

```ts
expect(writes).toEqual([
  ["config", expect.objectContaining({ pendingVerificationNumber: "07" })],
  ["token", "a1.s"],
]);
```

Also create the two crash-shaped restart fixtures:

- pending number present, token absent -> `joined` will later be false and the next join overwrites the old number;
- token present, pending number present -> still pending, never treated as approved.

The first test must fail against today's token-then-config order.

- [ ] **Step 6: Reverse the two join writes and rerun the focused suites**

Persist `pendingVerificationNumber` before `saveToken`. Run the commands from Step 2 and require all tests to pass.

- [ ] **Step 7: Commit the independently tested state change**

```bash
git add packages/print-agent/src apps/print-agent/src/state.ts apps/print-agent/src/state.test.ts apps/print-agent/src/host.ts apps/print-agent/src/host.test.ts
git commit -s -m "Persist print-agent servers and safe pending joins"
```

### Task 2: Add serialized, wakeable agent controls and the five-minute reset

**Files:**

- Modify: `packages/print-agent/src/agent.ts`
- Modify: `packages/print-agent/src/agent.test.ts`
- Modify: `packages/print-agent/src/index.ts`
- Modify: `packages/print-agent/src/testing/fake-host.ts`

**Interfaces:**

- Consumes: persisted `AgentConfig.servers`, token, and current `AgentStatus` from Task 1.
- Produces:

```ts
export interface AgentSetupSnapshot {
  status: AgentStatus;
  config: AgentConfig | null;
  joined: boolean;
  outOfTouch: boolean;
  resetAt?: number;
}

export interface Agent {
  runOnce(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  configure(input: { serverUrl: string; name: string }): Promise<boolean>;
  beginNetworkReset(): Promise<boolean>;
  cancelNetworkReset(): Promise<boolean>;
  setupSnapshot(): Promise<AgentSetupSnapshot>;
  readonly status: AgentStatus;
}
```

- [ ] **Step 1: Write failing control-loop tests**

Add tests for all of these behaviors:

1. `configure()` after a denial clears `halted`, token, pending number, environment, and remembered servers, saves the new `{serverUrl,name}`, wakes a held sleep, and joins without creating a new agent.
2. Hold the approval pull unresolved, let `/setup` observe the still-unjoined snapshot, release approval, and then run the queued `configure()`: it returns false and leaves the newly approved token and config unchanged. The eligibility check is inside the serialized mutation, not just the HTTP route.
3. `beginNetworkReset()` on an approved out-of-touch agent records `resetAt = now + 300_000`, wakes the loop, and does not clear the token yet.
4. A router round with no accepting primary and a non-unauthorized `pullJobs` failure each set `outOfTouch`; a thrown local `visibleDevices()` call, a join-status failure, and the initial post-restart state do not.
5. A successful authenticated pull before the deadline clears `resetAt`, clears `outOfTouch`, and keeps token/config.
6. `cancelNetworkReset()` clears the deadline and leaves token/config intact; a queued cancel that is no longer eligible returns false without changing state.
7. Reaching the deadline while still out of touch clears token and remembered servers, keeps the configured URL/name/environment, clears `halted`/approval/router/reset state, and lets the next tick join again.
8. `setupSnapshot().joined` is true only for `token !== null && pendingVerificationNumber === undefined`.
9. Hold `pullJobs` unresolved, call `configure()`, release the pull, and assert the old tick finishes before the new config is written and cannot overwrite it afterwards.

Use a deferred `sleep` in `fakeHost` for the wake test; do not use a wall-clock sleep.

- [ ] **Step 2: Run the agent test and observe the missing API**

Run:

```bash
pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts
```

Expected: compile failures for the four new methods and behavioral failures for restart-free recovery.

- [ ] **Step 3: Serialize ticks and control operations**

Add one internal promise tail; both `runOnce()` and all three mutating control methods enqueue their bodies on it. A rejection must not poison later work:

```ts
let operation = Promise.resolve();

function exclusive<T>(body: () => Promise<T>): Promise<T> {
  const result = operation.then(body, body);
  operation = result.then(() => undefined, () => undefined);
  return result;
}
```

The `start()` loop calls the public serialized `runOnce()`. This is what makes the held-pull race test meaningful.
Export `AgentSetupSnapshot` from `packages/print-agent/src/index.ts` so the app consumes the public package seam rather than a source deep import.

- [ ] **Step 4: Make the poll sleep interruptible**

Keep a one-shot wake promise/resolver inside `createAgent`. `configure()` and `beginNetworkReset()` resolve it. When an idle tick finishes, `start()` awaits `Promise.race([host.sleep(intervalMs), wakePromise])`, then replaces the one-shot signal. `stop()` also wakes the loop so shutdown does not wait for the poll interval.

- [ ] **Step 5: Implement the control state machine**

Use `RESET_WINDOW_MS = 5 * 60_000` and an internal `outOfTouch = false`. Set it true only in the two spec-defined cases: `!round.anyAccepting`, and an authenticated `pullJobs` failure other than `unauthorized`. Clear it after a successful authenticated pull and when state is reset; do not derive it from `phase`, and do not set it in the outer tick catch, join-status failures, or local inventory failures.

Inside the same `exclusive()` body that mutates state, `configure()` rereads token/config and returns false if the agent is joined; otherwise it writes a fresh config with no environment, pending number, or servers, clears the token and all in-memory approval/router/reset state, wakes, and returns true. `beginNetworkReset()` likewise rereads state and returns false unless joined and `outOfTouch`; repeated accepted presses keep the original deadline rather than extending it. `cancelNetworkReset()` returns false unless a joined agent still owns a deadline. The HTTP checks remain for rendering, but these serialized checks are the authority. A successful authenticated pull clears the deadline. At expiry, clear token and `servers` only if `outOfTouch` is still true, reset in-memory state, report the unjoined status, and allow the next tick to enrol/join.

- [ ] **Step 6: Rerun and prove the call-off guard by deletion**

Run the focused test. In a disposable copy, remove the successful-pull line that clears `resetAt`; the recovery-before-deadline test must fail because the later clock advance clears a valid token. Restore the implementation and rerun green.

- [ ] **Step 7: Commit**

```bash
git add packages/print-agent/src/agent.ts packages/print-agent/src/agent.test.ts packages/print-agent/src/index.ts packages/print-agent/src/testing/fake-host.ts
git commit -s -m "Let a print agent rejoin without restarting"
```

### Task 3: Enforce the setup page's three access states and remove Bluetooth controls

**Files:**

- Modify: `apps/print-agent/src/setup-page.ts`
- Modify: `apps/print-agent/src/setup-page.test.ts`
- Create: `apps/print-agent/src/setup-page.network.test.ts`
- Modify: `apps/print-agent/src/bin.ts`

**Interfaces:**

- Consumes: `Agent.setupSnapshot()`, `configure()`, `beginNetworkReset()`, and `cancelNetworkReset()` from Task 2.
- Produces:

```ts
export interface SetupDeps {
  snapshot: () => Promise<AgentSetupSnapshot>;
  configure: (input: { serverUrl: string; name: string }) => Promise<boolean>;
  beginNetworkReset: () => Promise<boolean>;
  cancelNetworkReset: () => Promise<boolean>;
  envLocked: boolean;
  defaultName: string;
  now: () => number;
}
```

- [ ] **Step 1: Replace the old Bluetooth tests with the access matrix tests**

Delete assertions for the Bluetooth card and its two POST routes, then add each cell from the spec:

```ts
it.each([
  ["unjoined", false, false, "loopback", 200, "serverUrl"],
  ["unjoined", false, false, "network", 200, "serverUrl"],
  ["joined running", true, false, "loopback", 200, "Connected and printing"],
  ["joined running", true, false, "network", 403, "not available on the network"],
  ["joined before first probe", true, false, "loopback", 200, "Checking the venue connection"],
  ["joined before first probe", true, false, "network", 403, "not available on the network"],
  ["joined out of touch", true, true, "loopback", 200, "Join a new network"],
  ["joined out of touch", true, true, "network", 200, "Join a new network"],
])("%s from %s", async (_label, joined, outOfTouch, source, status, text) => {
  // Pass c.env.incoming.socket.remoteAddress through app.request for unit coverage.
});
```

The “before first probe” fixture has an approved token on disk and `status.phase === "unconfigured"`, matching the interval after `bin.ts` begins listening and before `agent.start()` completes its first tick. Cover `127.0.0.1`, another address in `127.0.0.0/8` such as `127.2.3.4`, IPv6 `::1`, IPv4-mapped `::ffff:127.2.3.4`, a private LAN address, and an absent address. Assert a forwarded-for header never changes the result. Assert `/bluetooth/scan` and `/bluetooth/pair` return 404.

- [ ] **Step 2: Test every mutating route**

Add cases proving:

- `/setup` works only while unjoined and still returns 405 when `envLocked`;
- a joined/running agent cannot POST `/setup`, locally or remotely;
- `/network/reset` appears and succeeds only while joined and `outOfTouch`;
- `/network/reset/cancel` appears only during the countdown;
- the page renders a remaining `m:ss` countdown from `resetAt - now()`;
- `/status.json` follows the same network refusal as `/` so it is still available to the compose loopback healthcheck but not leaked over LAN while joined/running.
- if approval completes after the route snapshot but before its queued configure operation, POST `/setup` returns 409 and preserves the approved token; make the same stale-snapshot assertion for reset/cancel, whose agent methods return false when their serialized precondition no longer holds.

- [ ] **Step 3: Add the real-socket negative control**

In `setup-page.network.test.ts`, start `@hono/node-server` on `0.0.0.0` and port `0`, find an `internal: false` interface with `networkInterfaces()`, and request the joined/running page through that address. Request the same server through `127.0.0.1` as the positive control:

```ts
expect((await fetch(`${lanOrigin}/`)).status).toBe(403);
expect((await fetch(`${loopbackOrigin}/`)).status).toBe(200);
```

This test must fail, not skip, if the test host has no non-loopback interface. It is the spec's evidence that the connection itself, not a faked header, decides the gate.

- [ ] **Step 4: Run the tests and observe today's page fail**

Run:

```bash
pnpm --filter @waitron/print-agent-app exec vitest run src/setup-page.test.ts src/setup-page.network.test.ts
```

Expected: the network request returns 200, joined POSTs remain open, reset routes do not exist, and the Bluetooth routes still exist.

- [ ] **Step 5: Implement the socket gate and three render modes**

Import `getConnInfo` from `@hono/node-server/conninfo`. Treat IPv4 `127.0.0.0/8`, its IPv4-mapped IPv6 forms, and IPv6 `::1` as loopback after validating the address; do not reduce loopback to three exact strings. Evaluate `await deps.snapshot()` separately for every request. Do not cache access state and do not read forwarding headers.

For unjoined agents, render the address form (or its existing env-locked read-only variant) plus pending/pairing status. For joined agents with `outOfTouch === false`, including the startup-before-first-probe state, render status only to loopback and return 403 to the network. For joined out-of-touch agents, render status plus the reset button/countdown/cancel controls to both caller classes. Treat a false result from a mutating agent method as a stale-state conflict and return 409; the page's earlier snapshot is never authorization. Remove `scanBluetooth`, `pairBluetooth`, `bluetoothCard`, its script and styles, and both Bluetooth routes.
Replace the current unauthorized copy that says to restart: a cleared token is unjoined, so the page now tells the operator to save the server address and approve the new join.

- [ ] **Step 6: Wire the page to the agent controls**

In `bin.ts`, remove the standalone mutable `status`, read `agent.status` through `setupSnapshot`, and wire the three methods. Keep the server bound to `0.0.0.0`; state changes must not require a restart.

- [ ] **Step 7: Prove the loopback guard by deletion**

In a disposable copy, return `true` from the loopback predicate. Run `setup-page.network.test.ts` and require the LAN request assertion to fail with `received 200`. Restore and rerun both setup-page suites green.

- [ ] **Step 8: Commit**

```bash
git add apps/print-agent/src/setup-page.ts apps/print-agent/src/setup-page.test.ts apps/print-agent/src/setup-page.network.test.ts apps/print-agent/src/bin.ts
git commit -s -m "Close a joined print agent setup page to the LAN"
```

### Task 4: Verify and finish P2a

**Files:**

- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: all P2a behavior.
- Produces: a green standalone branch and a backlog entry narrowed to P2b/P2c plus physical measurements.

- [ ] **Step 1: Update the backlog without claiming Bluetooth delivery**

Replace the old combined setup-page/Bluetooth bullet with the landed P2a behavior and links to the spec/plan. Keep `liveBtDevicePath` and the real-radio receipt explicitly open.

- [ ] **Step 2: Run P2a's focused checks**

```bash
pnpm --filter @waitron/print-agent exec vitest run src/router.test.ts src/agent.test.ts
pnpm --filter @waitron/print-agent-app exec vitest run src/state.test.ts src/host.test.ts src/setup-page.test.ts src/setup-page.network.test.ts
pnpm --filter @waitron/print-agent typecheck
pnpm --filter @waitron/print-agent-app typecheck
git diff --check
```

- [ ] **Step 3: Render and inspect the setup page**

Write representative unjoined, joined/running-local, joined-before-first-probe, joined/out-of-touch, and countdown HTML responses to temporary files and open them with the workspace Playwright Chromium. Inspect desktop and 390px widths. The page has no locale/theme switch, so record that English/light is the only implemented presentation rather than claiming EN/ES or dark-theme coverage.

- [ ] **Step 4: Commit the backlog receipt and run `finish-branch`**

```bash
git add docs/backlog.md
git commit -s -m "Record the print-agent setup lockdown"
```

Use the Codex `finish-branch` skill. This is meaningful authentication-boundary code, so it gets the required Claude run-it whole-branch review. Push normally, wait for required current-head CI, then use the authorized `land-branch` flow under the campaign lock.

---

## P2b — Bluetooth classification and the optional agent command channel

### Task 5: Decode printer-like devices and add paired/forget host operations

**Prerequisite:** The real-box measurement at the end of this plan must be complete before this task starts. Add its captured output as the Pair/Forget decoder fixtures and adjust this task to the measured BlueZ contract. P1 and P2a do not wait for it; P2b and P2c do.

**Files:**

- Modify: `packages/print-agent/src/host.ts`
- Modify: `packages/print-agent/src/index.ts`
- Modify: `apps/print-agent/src/bluetooth.ts`
- Modify: `apps/print-agent/src/bluetooth.test.ts`
- Modify: `apps/print-agent/src/linux-devices.ts`
- Modify: `apps/print-agent/src/linux-devices.test.ts`
- Modify: `apps/print-agent/src/host.ts`
- Modify: `apps/print-agent/src/host.test.ts`

**Interfaces:**

- Consumes: BlueZ `devices`, `devices Paired`, `info <MAC>`, `pair <MAC>`, and `remove <MAC>` output.
- Produces:

```ts
export interface PairedBluetoothDevice {
  localKey: string;
  name?: string;
}

export interface BluetoothCommandResult {
  ok: boolean;
  error?: string;
}

// Add to DiscoveredDevice:
printerLike?: true;

// Add to Host:
pairedBluetooth(): Promise<PairedBluetoothDevice[]>;
forgetBluetooth(mac: string): Promise<BluetoothCommandResult>;
```

- [ ] **Step 1: Read the real-box receipt and state the measured contract**

Confirm the receipt includes a host reboot, printer power cycle, post-reboot reconnect, `Paired`/`Bonded`/`Trusted`, and the exact success and failure text from `remove`. If it does not, stop P2b and ask for the missing observation rather than choosing a decoder or trust policy from documentation. Record in the commit message whether Pair must also run `trust`, what proves reconnection, and which remove output constitutes success.

- [ ] **Step 2: Write the failing BlueZ decoder cases**

Use the captured, redacted Pair/Forget outputs for the command-result fixtures and synthesized `bluetoothctl info` fixtures for classification:

- `Icon: printer`;
- imaging major class plus the printer minor bit;
- UUID `00001101-0000-1000-8000-00805f9b34fb` (Serial Port);
- none of the three;
- malformed/ANSI-colored lines;
- one device whose `info` command throws while another still returns from the scan;
- nine devices, proving only the first eight are enriched and that their `info` calls are started concurrently rather than awaited one by one;
- the measured successful and failed `remove` output, plus the measured Pair/trust sequence.

Pin the sources beside the fixtures: BlueZ's official [`bluetoothctl` manual](https://github.com/bluez/bluez/blob/master/doc/bluetoothctl.rst), BlueZ's [`RemoveDevice` contract](https://github.com/bluez/bluez/blob/master/doc/org.bluez.Adapter.rst), and the Bluetooth SIG [Assigned Numbers](https://www.bluetooth.com/specifications/assigned-numbers/) for the imaging bits and Serial Port UUID.

- [ ] **Step 3: Run the decoder suites and observe missing classification/removal**

```bash
pnpm --filter @waitron/print-agent-app exec vitest run src/bluetooth.test.ts src/linux-devices.test.ts src/host.test.ts
```

Expected: `printerLike`, `forgetBluetooth`, and independent paired inventory do not exist.

- [ ] **Step 4: Implement the decoder and host calls**

`parseBluetoothctlInfo(text)` returns `{printerLike: true}` when any of these holds:

```ts
icon === "printer" ||
((classOfDevice & 0x1f00) === 0x0600 && (classOfDevice & 0x0080) !== 0) ||
uuids.has("00001101-0000-1000-8000-00805f9b34fb")
```

After `devices`, take at most `MAX_BLUETOOTH_INFO_DEVICES = 8` MACs and start their `info` calls together with `Promise.allSettled`; the existing 15-second command timeout therefore bounds the whole enrichment batch rather than multiplying by the device count. Devices beyond the cap stay in the scan unmarked, so **Show all devices** can still expose them. An unreadable `info` leaves that device unmarked; it does not remove it. `pairedBluetooth()` maps `devices Paired` without calling `liveBtDevicePath`. Implement Pair's trust step only if the measurement requires it. `forgetBluetooth()` runs the measured removal command and decodes only the observed success shape as success. Keep `visibleDevices()` unchanged so paired-but-undeliverable devices do not claim jobs.
Export `PairedBluetoothDevice` and `BluetoothCommandResult` from `packages/print-agent/src/index.ts`.

- [ ] **Step 5: Prove the enrichment bound**

Run the nine-device case with eight deferred `info` calls. Assert all eight start before any is released, the ninth is never inspected, and a rejected call still leaves all nine devices in the result. This distinguishes a concurrent fixed-size batch from a sequential 120-second path.

- [ ] **Step 6: Rerun and commit**

```bash
pnpm --filter @waitron/print-agent-app exec vitest run src/bluetooth.test.ts src/linux-devices.test.ts src/host.test.ts
git add packages/print-agent/src/host.ts packages/print-agent/src/index.ts apps/print-agent/src/bluetooth.ts apps/print-agent/src/bluetooth.test.ts apps/print-agent/src/linux-devices.ts apps/print-agent/src/linux-devices.test.ts apps/print-agent/src/host.ts apps/print-agent/src/host.test.ts
git commit -s -m "Describe and forget paired Bluetooth printers"
```

### Task 6: Add bounded, backward-compatible Bluetooth wire types

**Files:**

- Modify: `packages/print-agent/src/client.ts`
- Modify: `packages/print-agent/src/client.test.ts`
- Modify: `packages/print-agent/src/index.ts`

**Interfaces:**

- Consumes: paired inventory and host command results from Task 5.
- Produces:

```ts
export type BluetoothCommandKind = "pair" | "forget";

export interface BluetoothCommand {
  id: string;
  kind: BluetoothCommandKind;
  address: string;
}

export interface BluetoothCommandOutcome {
  id: string;
  ok: boolean;
  error?: string;
}

export interface AgentInventory {
  // existing fields...
  pairedBluetooth: PairedBluetoothDevice[];
  bluetoothOutcomes: BluetoothCommandOutcome[];
}

export interface PullReply {
  // existing fields...
  bluetoothCommands?: BluetoothCommand[];
}
```

_2026-09-29 (P2b): `BluetoothCommand` also carries an optional `pin` (1–16 printable ASCII characters, no spaces), and waitron.sh install switches off bluetoothd's autopair plugin where it can (`deploy/README.md` says when it leaves Bluetooth alone); the dashboard's Pair must ask for the PIN, and the server must never store, log or echo it. See the P2c entry in `docs/backlog.md`._

- [ ] **Step 1: Write failing parser/body tests**

Add client tests that accept no `bluetoothCommands` (old server), accept up to eight valid commands, normalize MACs to uppercase, and drop invalid ids/kinds/MACs and every entry after the eighth. Assert `pullJobs` sends `pairedBluetooth` and `bluetoothOutcomes` exactly.

- [ ] **Step 2: Run and observe the missing fields**

```bash
pnpm --filter @waitron/print-agent exec vitest run src/client.test.ts
```

- [ ] **Step 3: Implement strict optional decoding**

Use a full MAC pattern (`XX:XX:XX:XX:XX:XX`), string ids bounded to 128 characters, and error strings bounded to 500 characters. Invalid optional command entries are ignored; invalid jobs still retain today's whole-reply refusal. This keeps an older or partially upgraded server from stopping printing.
Export `BluetoothCommand`, `BluetoothCommandKind`, and `BluetoothCommandOutcome` from `packages/print-agent/src/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/print-agent/src/client.ts packages/print-agent/src/client.test.ts packages/print-agent/src/index.ts
git commit -s -m "Add the print-agent Bluetooth command wire"
```

### Task 7: Execute each command once and report its outcome on the next pull

**Files:**

- Modify: `packages/print-agent/src/agent.ts`
- Modify: `packages/print-agent/src/agent.test.ts`
- Modify: `packages/print-agent/src/testing/fake-host.ts`

**Interfaces:**

- Consumes: `PullReply.bluetoothCommands`, `Host.pairedBluetooth()`, `Host.pair()`, and `Host.forgetBluetooth()`.
- Produces: paired inventory on every authenticated pull and retained `BluetoothCommandOutcome[]` until the next successful pull.

- [ ] **Step 1: Write the failing behavior tests**

Add cases proving:

- paired Bluetooth inventory is sent separately from `visible` on every pull;
- a paired-inventory throw logs and sends `[]`, while a print job still delivers;
- Pair and Forget reach the matching host method and their outcomes appear in the next pull;
- a host method returning `{ok:false}` and a host method throwing both become failed outcomes without stopping jobs from the same reply;
- print jobs are delivered before Bluetooth commands run;
- a repeated command id is not executed twice;
- an outcome stays queued after a failed pull and is dropped only after a successful pull carrying it;
- after a response-loss-shaped retry, the same outcome is resent but the command is not re-executed.

- [ ] **Step 2: Run and observe failures**

```bash
pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts
```

- [ ] **Step 3: Implement bounded in-memory execution state**

Keep:

```ts
let bluetoothOutcomes: BluetoothCommandOutcome[] = [];
const executedBluetoothCommands = new Set<string>();
```

Build inventory from a caught `pairedBluetooth()` call and the current outcomes. Clear only the outcomes actually sent after `pulled.ok`. Deliver jobs first. Then execute each unseen command serially, catching throws into `{ok:false,error}`; cap remembered ids and outcomes at eight because the wire is capped at eight. Do not persist either list.

- [ ] **Step 4: Rerun, typecheck, and commit**

```bash
pnpm --filter @waitron/print-agent exec vitest run src/client.test.ts src/agent.test.ts
pnpm --filter @waitron/print-agent typecheck
pnpm --filter @waitron/print-agent-app exec vitest run src/bluetooth.test.ts src/linux-devices.test.ts src/host.test.ts
pnpm --filter @waitron/print-agent-app typecheck
git add packages/print-agent/src apps/print-agent/src
git commit -s -m "Run Bluetooth commands through the print-agent pull"
```

### Task 8: Record P2b and finish the agent-channel branch

**Files:**

- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: the optional agent channel.
- Produces: a green P2b branch with the server/dashboard work and hardware measurements still explicit.

- [ ] **Step 1: Update the backlog**

Record classification, paired reporting, and optional command execution. State plainly that no server route issues a command yet and Bluetooth delivery is still unimplemented.

- [ ] **Step 2: Run focused checks and commit**

```bash
pnpm --filter @waitron/print-agent exec vitest run src/client.test.ts src/agent.test.ts
pnpm --filter @waitron/print-agent-app exec vitest run src/bluetooth.test.ts src/linux-devices.test.ts src/host.test.ts
git diff --check
git add docs/backlog.md
git commit -s -m "Record the print-agent Bluetooth channel"
```

- [ ] **Step 3: Run `finish-branch` and land**

Use the full meaningful-code finish path and required Claude run-it review. Wait for current-head CI, then use authorized `land-branch` under the shared lock.

---

## P2c — Server command channel and dashboard pairing

_2026-09-29 (P2b): `BluetoothCommand` also carries an optional `pin` (1–16 printable ASCII characters, no spaces), and waitron.sh install switches off bluetoothd's autopair plugin where it can (`deploy/README.md` says when it leaves Bluetooth alone); the dashboard's Pair must ask for the PIN, and the server must never store, log or echo it. See the P2c entry in `docs/backlog.md`._

### Task 9: Build the bounded in-memory command store

**Files:**

- Create: `apps/server/src/printer-bluetooth-commands.ts`
- Create: `apps/server/src/printer-bluetooth-commands.test.ts`

**Interfaces:**

- Consumes: command/outcome wire types from P2b.
- Produces:

```ts
export interface BluetoothCommandStatus {
  id: string;
  kind: "pair" | "forget";
  address: string;
  state: "pending" | "succeeded" | "failed";
  error?: string;
}

export function createPrinterBluetoothCommands(options?: {
  now?: () => number;
  id?: () => string;
}): {
  enqueue(agentId: string, kind: "pair" | "forget", address: string): BluetoothCommandStatus;
  current(agentId: string): BluetoothCommand[];
  accept(agentId: string, outcomes: BluetoothCommandOutcome[]): void;
  latest(agentId: string, address: string): BluetoothCommandStatus | undefined;
};
```

- [ ] **Step 1: Write store tests first**

Pin a maximum of eight pending addresses per agent, a 60-second command expiry, a 60-second result expiry, replacement/deduplication for the same `{agentId,kind,address}`, and isolation between agents. An outcome is accepted only when its id belongs to that agent's current command; another agent's id and an expired id do nothing.

- [ ] **Step 2: Run and observe the missing module**

```bash
pnpm --filter @waitron/server exec vitest run src/printer-bluetooth-commands.test.ts
```

- [ ] **Step 3: Implement the pure store**

Use `Map`s only. Prune on every public call. `enqueue` returns the existing pending status for an exact duplicate, replaces the opposite operation for the same address, and throws `printer.bluetooth_command_busy` only when a ninth distinct address would be added for one agent. `accept` removes the matching pending command and stores a terminal result.

Because this file throws a registered code, import `./errors.js` at its boundary as the repository's error-registry rule requires.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/printer-bluetooth-commands.ts apps/server/src/printer-bluetooth-commands.test.ts
git commit -s -m "Queue bounded Bluetooth commands per print agent"
```

### Task 10: Validate pair/forget requests and connect the store to agent pulls

**Files:**

- Modify: `apps/server/src/print-api.ts`
- Modify: `apps/server/src/print-api.test.ts`
- Modify: `apps/server/src/print-api.printer-wiring.test.ts`
- Modify: `apps/server/src/errors.ts`
- Modify: `apps/server/src/errors.test.ts`
- Modify: `apps/dashboard/src/i18n/codes.ts`

**Interfaces:**

- Consumes: `createPrinterBluetoothCommands()` and P2b's `pairedBluetooth`, `bluetoothOutcomes`, and `bluetoothCommands` wire fields.
- Produces:

```http
POST /management-api/print-agents/:agentId/bluetooth/pair
POST /management-api/print-agents/:agentId/bluetooth/forget
Content-Type: application/json
{"address":"AA:BB:CC:DD:EE:FF"}
```

Each returns `202 { command: BluetoothCommandStatus }`. `GET /management-api/discovered-printers` adds `printerLike`, `paired`, and `bluetoothCommand` to each relevant Bluetooth row.

- [ ] **Step 1: Write the server refusals first**

In `print-api.test.ts`, add tests that assert exact codes:

- `printer.bluetooth_not_discovered` when the address has no fresh Bluetooth `scannedAt` for that agent;
- the same refusal when only another agent scanned it;
- `printer.bluetooth_not_paired` when Forget has no fresh paired report from that agent;
- the same refusal when only another agent reports it paired;
- `printer.bluetooth_command_busy` on the ninth distinct address.

Also pin success: the command reaches only the named agent's next pull; an outcome from that agent removes it and appears as the latest dashboard status; a failed outcome keeps its bounded reason; expiry removes command/result.

- [ ] **Step 2: Write the timestamp-separation control**

Have one agent scan a MAC once, then report it as paired on later pulls past the scan TTL. Assert Pair is refused even though `pairedAt` is fresh. This forces separate `scannedAt` and `pairedAt` fields instead of one refreshed `lastSeenAt`.

- [ ] **Step 3: Write permission wiring tests**

Extend `print-api.printer-wiring.test.ts` so both routes produce 401 without a management session, 403 for staff lacking `printer.manage`, and 202 for a manager. Keep the existing discovery-permission assertions.

- [ ] **Step 4: Run the failing server tests**

```bash
pnpm --filter @waitron/server exec vitest run src/printer-bluetooth-commands.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/errors.test.ts
```

Expected: routes/fields/codes are absent.

- [ ] **Step 5: Screen and remember the new inventory fields**

Parse `pairedBluetooth` and `bluetoothOutcomes` with the same caps and bounds as P2b. For each discovered entry keep `scannedAt` and `pairedAt` separately; merge rather than overwrite a matching agent/transport/address record. Pair authorization reads only fresh `scannedAt`, exact `agentId`, and `transport === "bluetooth"`. Forget authorization reads only fresh `pairedAt` and exact `agentId`.

- [ ] **Step 6: Mount the routes and pull integration**

Create one command store in `mountPrintApi`. Both routes call the existing `gated(sessionId, ...)`, whose default permission is `printer.manage`. Validate agent id, normalize the MAC, validate the fresh evidence, enqueue, and return 202. On each agent pull, accept that agent's outcomes before returning `bluetoothCommands: commands.current(agentId)`.

- [ ] **Step 7: Register and translate the error codes**

Add the three codes to `apps/server/src/errors.ts`, the HTTP status table, `apps/server/src/errors.test.ts`, and English/Spanish dashboard code strings. These are request errors, not recorded incident codes; still run both repository guards required for any new error code.

Use these registry shapes and statuses:

```ts
"printer.bluetooth_not_discovered": { address: string }; // 409
"printer.bluetooth_not_paired": { address: string }; // 409
"printer.bluetooth_command_busy": Record<string, never>; // 429
```

- [ ] **Step 8: Prove the same-agent guards by deletion**

In disposable copies, remove the agent predicate from Pair and from Forget separately. The corresponding “another agent” test must fail. Restore each guard and rerun green.

- [ ] **Step 9: Run focused server and root guards, then commit**

```bash
pnpm --filter @waitron/server exec vitest run src/printer-bluetooth-commands.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/errors.test.ts
pnpm vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts
git add apps/server/src apps/dashboard/src/i18n/codes.ts
git commit -s -m "Send safe Bluetooth commands to print agents"
```

### Task 11: Add Pair, Forget pairing, printer filtering, and outcome UI

**Files:**

- Modify: `apps/dashboard/src/api/client.ts`
- Modify: `apps/dashboard/src/screens/printers-screen.ts`
- Modify: `apps/dashboard/src/screens/printers-screen.test.ts`
- Modify: `apps/dashboard/src/screens/printers-screen.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**

- Consumes: the two management routes and richer discovered-printer response from Task 10.
- Produces: typed dashboard methods and user-visible Pair/Forget/status/filter controls.

- [ ] **Step 1: Add typed client methods and failing screen tests**

Extend `DiscoveredPrinter` with:

```ts
printerLike?: true;
paired?: true;
bluetoothCommand?: BluetoothCommandStatus;
```

Add:

```ts
pairBluetooth(agentId: string, address: string): Promise<{command: BluetoothCommandStatus}>;
forgetBluetoothPairing(agentId: string, address: string): Promise<{command: BluetoothCommandStatus}>;
```

Then add screen tests that prove:

- an unpaired Bluetooth printer-like row has **Pair**, not **Add**;
- Pair calls the named agent/address and shows pending, success, and the returned failure reason;
- a paired Bluetooth row can be added/restored through today's naming flow;
- a non-printer Bluetooth row is hidden by default and appears after **Show all devices**;
- a wrongly-described but paired/registered printer remains reachable in its normal printer row;
- **Forget pairing** appears only for an inactive Bluetooth printer with a current paired report, never for an active, USB, network, or unreported printer;
- Forget calls the correct agent/address and its terminal result renders;
- opening the add-printer modal again resets **Show all devices** to off;
- the background command poll uses `api.background`, stops at a terminal outcome/expiry or disconnect, and does not overlap itself.

- [ ] **Step 2: Run the browser suite after checking host capacity**

```bash
memory_pressure | grep free
ps -axo pid,ppid,%cpu,%mem,command | rg 'vitest|chromium|playwright'
pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts
```

Expected: new controls and calls are absent. Do not start this beside a background whole-workspace coverage run.

- [ ] **Step 3: Implement independent UI state**

Add `showAllBluetooth`, a per-`agentId:address` command-status map, and a non-overlapping passive polling timer. Pair and Forget are immediate row actions with their own busy state; they do not use the form-wide `submitting` gate. Existing Add/Restore behavior remains value-for-value.

The discovered-table filter is:

```ts
const visible = this.discovered.filter(
  (d) =>
    this.#canAdd(d) &&
    (d.transport !== "bluetooth" || d.printerLike === true || this.showAllBluetooth),
);
```

For an unpaired Bluetooth row, render Pair instead of opening the naming modal. For a paired row, retain Add/Add again. On inactive registered Bluetooth rows, resolve the current paired entry by `printerId` and render Forget pairing in the row actions.

- [ ] **Step 4: Add English and Spanish wording**

Use these exact meanings:

```text
EN: Pair / Forget pairing / Show all devices / Hide other devices
ES: Emparejar / Olvidar emparejamiento / Mostrar todos los dispositivos / Ocultar otros dispositivos
```

Replace `printers.bluetooth_pair_note` with wording that points to Pair on this screen and says Bluetooth printing is not available yet. Do not say pairing makes the printer usable.

- [ ] **Step 5: Extend accessibility coverage**

In `printers-screen.a11y.test.ts`, cover the add modal with a hidden non-printer row, the expanded Show all state, Pair pending/failure, and the inactive printer row with Forget in both themes. Keep the existing full axe run and semantic button names.

- [ ] **Step 6: Rerun dashboard tests and commit**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts
pnpm --filter @waitron/dashboard typecheck
git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/printers-screen.ts apps/dashboard/src/screens/printers-screen.test.ts apps/dashboard/src/screens/printers-screen.a11y.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "Pair Bluetooth printers from the dashboard"
```

### Task 12: Verify P2c visually, update the backlog, and finish

**Files:**

- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: complete P2c behavior.
- Produces: a green final software branch, visual evidence, and Bluetooth delivery explicitly left unimplemented.

- [ ] **Step 1: Run the final focused behavior checks**

```bash
pnpm --filter @waitron/server exec vitest run src/printer-bluetooth-commands.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/errors.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts
pnpm vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts
git diff --check
```

- [ ] **Step 2: Open the real dashboard screen and look**

Start the registered worktree stack with:

```bash
wa-wt demo <worktree-name>
```

Open the real Printers screen first to catch integration/render failures. The demo has no Bluetooth hardware with which to create every transient state, so use the existing dashboard browser mount helper with the same typed fake API fixtures as the behavior tests for the state matrix; run it headed or capture screenshots to a temporary directory outside the repository. Inspect all of these at desktop and 390px phone width, in English and Spanish, in light and dark themes:

- default printers-only list with a non-printer hidden;
- Show all expanded;
- Pair idle and pending;
- Pair success and failure reason;
- inactive paired printer with Forget pairing;
- Bluetooth-unavailable wording.

Record screenshots outside the repository or in the browser-test artifact directory; do not commit them unless the repository already expects that artifact.

- [ ] **Step 3: Update `docs/backlog.md`**

Mark setup-page lockdown, the measured pairing/forget command delivery, printers-only filtering, and dashboard controls complete. Link the real-box receipt that gated P2b. Keep Bluetooth delivery through a real per-device path (`liveBtDevicePath`) explicitly open; this plan deliberately does not build it.

- [ ] **Step 4: Commit and finish**

```bash
git add docs/backlog.md
git commit -s -m "Record dashboard Bluetooth pairing"
```

Run the Codex `finish-branch` skill with the required Claude run-it review, push normally, wait for current-head CI and its selected dashboard/server/package jobs, then use authorized `land-branch` under the shared lock.

---

## Real-box measurement — required before P2b, not before P1 or P2a

_2026-09-29 (A129): the print agent now runs under `deploy/apparmor/waitron-print-agent`, which allows only the bus messages `bluetoothctl list`, `devices` and `scan` were seen to send. Pairing, `trust`, `connect` and `remove` are not among them (`remove` was measured refused on a CI runner), so under it these steps would measure the profile, not BlueZ. Run them with pairing allowed: keep the owner's `compose.override.yml` that sets `apparmor=unconfined` until the measurement is done. See `docs/backlog.md`, B6._
_2026-09-29 (P2b, Task D): the profile now allows pairing with a PIN through interactive `bluetoothctl`, and `remove`; `trust` and `disconnect` were measured still refused (probe run 36585218089, receipts in the profile's header). The owner took the real-box measurement on 2026-09-29 (BlueZ 5.82: the bond alone reconnected after a host reboot and a printer power cycle; `docs/backlog.md`, the entry on the print agent's Bluetooth side (P2b), and the `info` and `remove` output in `apps/print-agent/src/bluetooth.test.ts`), and the profile still allows no `connect`: `Device1.Connect` is not among the members `deploy/apparmor/waitron-print-agent` names._

Run this on the deployed box from the directory that owns `deploy/compose.yml`, replacing the address with the first real Bluetooth receipt printer. Save the complete command output, BlueZ version, box image SHA, printer make/model, and the times at which the printer and host were restarted. Because the container reaches the host BlueZ daemon through `/run/dbus/system_bus_socket`, restarting only the container does not test bond/trust persistence.

First capture and pair:

```bash
MAC='AA:BB:CC:DD:EE:FF'
docker compose exec print-agent bluetoothctl --version
docker compose exec print-agent bluetoothctl info "$MAC"
docker compose exec print-agent bluetoothctl pair "$MAC"
docker compose exec print-agent bluetoothctl info "$MAC"
```

Then power the printer off, reboot the host box, wait for the box and compose project to return, and power the printer on. Re-set `MAC` in the new shell and capture the persisted state and reconnect result:

```bash
MAC='AA:BB:CC:DD:EE:FF'
docker compose exec print-agent bluetoothctl devices Paired
docker compose exec print-agent bluetoothctl info "$MAC"
docker compose exec print-agent bluetoothctl connect "$MAC"
docker compose exec print-agent bluetoothctl info "$MAC"
```

Finally measure both successful removal and the already-removed failure shape:

```bash
MAC='AA:BB:CC:DD:EE:FF'
docker compose exec print-agent bluetoothctl remove "$MAC"
docker compose exec print-agent bluetoothctl devices Paired
docker compose exec print-agent bluetoothctl info "$MAC"
docker compose exec print-agent bluetoothctl remove "$MAC"
```

Record specifically `Icon`, `Class`, every `UUID`, `Paired`, `Bonded`, `Trusted`, whether `connect` succeeds after the host reboot and printer power cycle, and the exact output and exit status from both `remove` calls. Do **not** add `bluetoothctl trust` to production code from documentation alone: if `Trusted: no` after pairing and reconnect fails, pair again, run `bluetoothctl trust "$MAC"`, repeat the host reboot and printer power cycle, and record the difference. P1 and P2a remain landable without this receipt. P2b does not start until the receipt decides the Pair/trust sequence and gives Forget a real success/failure fixture; P2c then consumes that measured channel.
