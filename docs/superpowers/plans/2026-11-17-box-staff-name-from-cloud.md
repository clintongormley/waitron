# The box takes its staff name from Cloud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Dispatch every implementer as `subagent_type: "implementer"` (medium effort); reviews stay at high effort. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A connected test box asks Cloud for a staff certificate for whatever staff name Cloud currently gives it, installs it and serves that name, with no `WAITRON_STAFF_ORIGIN` setting. A change of name needs nobody at the box.

**Architecture:** One Waitron pull request.
- The name the box **asks for** is the `staffHostname` in the `remote_access` service configuration of Cloud's installation configuration reply, which the box already saves as `state.lifecycle.view`. The staff exchange's discovery reply must name the same host.
- The name the box **serves** is the one DNS name in its installed `cloud/staff.crt`. A small holder keeps it in memory and changes it only when a certificate for a new name is installed, at which point the listener's TLS context is reloaded at once.
- One gate function decides whether the staff entrance may be open and whether certificates may be requested. The boot re-checks it on every Cloud pass and whenever the remote-access switch changes.

**Tech Stack:** TypeScript, Hono, `@hono/node-server`, Vitest, the fake Cloud in `apps/server/test/cloud-installation-fixture.ts`.

**Spec:** Cloud repository, `docs/superpowers/specs/2026-11-17-custom-domain-one-record-design.md` (owner-approved 2026-11-17). See the section *Renewal runs by itself* → "The box takes its staff name from Cloud (the Waitron part)", and the last two bullets of *What the tests must show* → "Renewal by itself".

**The other plan, and order:** Cloud's plan (`docs/superpowers/plans/2026-11-17-custom-domain-one-record.md` in the Cloud repository) carries the name first. **Its PR 1 must have landed before this PR is built.** That PR stores each venue's names once, and pins in `packages/remote-access/test/installation-configuration-names.test.ts` that the configuration reply's `staffHostname` is the current staff name after placement, a custom name and a cell move. The field itself is not new: Cloud already stores the placement, including `staffHostname`, as the `remote_access` configuration (Cloud `packages/remote-access/src/placement.ts:84,114,168,213`). The discovery reply already returns `hostname` (Cloud `packages/remote-access/src/staff-exchange.ts`).

**Risk trigger: yes.** This changes who the staff entrance answers: the origin gate in `createStaffApp`, which `requireManagementChangeFromOwnPage` relies on for staff-entrance requests. It also changes how staff TLS certificates are requested and reloaded, and it depends on a contract with the Cloud repository. It takes the full review path.

## Global Constraints

- Production is unchanged: a box whose `WAITRON_ENV` is `production` never requests a staff certificate, never opens the staff entrance, and gains no new start refusal.
- The staff entrance's origin is `https://<served name>`, with no port. The listener keeps `WAITRON_STAFF_HOST` (default unchanged) and `WAITRON_STAFF_PORT` (default `8443`). Certificate requests keep their 8-second deadline.
- `apps/server/scripts/cloud-certificate.ts csr|install` stays: Cloud's `scripts/staff-certificate-receipt.mjs` drives the database exchange with it.
- `WAITRON_STAFF_ORIGIN` is no longer read anywhere. There is no fallback or warning, under Waitron's "No backwards-compatibility … code until Waitron is in production" rule.

## Every reader of `config.staff.origin` and `WAITRON_STAFF_ORIGIN`

Found with `grep -rn -E "staff\.origin|WAITRON_STAFF_ORIGIN|staffHostname|config\.staff" apps/server docs deploy`.

| Reader | What it does today | After this PR |
| --- | --- | --- |
| `apps/server/src/config.ts:466-484` | Parses the setting; `config.staff` exists only when it is set | `config.staff` is `{host, port}` whenever the box is not production |
| `apps/server/src/boot.ts:4430-4436` | Waits for a first certificate when Cloud and `config.staff` exist | The entrance follows the gate (Task 5) |
| `apps/server/src/boot.ts:4683-4692` | Hands `new URL(config.staff.origin).hostname` to the Cloud job; only then does the job run the staff step | The job runs the staff step only when the gate allows a request, and says nothing when it does not |
| `apps/server/src/cloud-remote.ts:187` (`createStaffApp(app, staff.origin)`) | Refuses (404) any request whose URL origin is not the setting: the staff entrance's own-page gate | Compares with `https://<served name>` from the holder |
| `apps/server/src/cloud-remote.ts:194` (`watchTlsFiles(..., hostname)`) | Reloads only a chain for the setting's name, every 10 s | Reloads only a chain for the served name, every 10 s, and at once on install |
| `apps/server/src/own-page.ts` (`requireManagementChangeFromOwnPage`) | For staff-entrance requests, `sentFromThisOrigin` compares `Origin` with the request URL's origin, which `createStaffApp` has pinned | Code unchanged; covered by Task 6 |
| `apps/server/src/request-from-box.ts` (`managementOriginFor`, `managementSite`) | Derive the origin and the passkey site ID from the request URL on the staff entrance | Code unchanged; follow the served name |
| `apps/server/src/cloud-emergency.ts`, `cloud-client.ts` `staffOrigin` | Named "staff" but fed `config.managementOrigin` (`boot.ts:4066`, `backup-recovery-pack-api.ts:217`) | Not a reader; untouched |
| Docs: `apps/server/README.md:302-309,343`, `docs/developers/cloud-connection.md:315-317,477`, `deploy/tunnel/README.md:27-40` | Tell people to set it | Rewritten (Task 6) |
| Tests: `config.test.ts`, `boot.management-origin.test.ts`, `boot.failed-start.test.ts`, `boot.mirror.test.ts`, `cloud-worker.test.ts`, `cloud-staff-certificate.test.ts`, `cloud-remote.test.ts` | Set the variable or pass `staffHostname` | Setup changes; assertions kept |

## Builder's calls made in this plan (one line each)

1. **Requested name:** Cloud's installation configuration reply (`remote_access` `configuration.staffHostname`), as the contract already says ("Take hostname and revision from the current installation configuration"). If the discovery reply's `hostname` differs, the pass installs nothing.
2. **Served name:** the single DNS name in the installed `cloud/staff.crt`, read at start and changed in memory only when a certificate for a new name is installed. No new state file.
3. **The gate:** the entrance is open and certificates may be requested only when all of these hold:
   - the box is not production;
   - it is not a mirror;
   - `remoteAccessEnabled !== false`, the Settings switch that `cloud-tunnel.ts:59` already honours;
   - the saved Cloud view lists `remote_access` as `provisioning` or `ready` with a usable `staffHostname`.

   The entrance also needs an installed chain. A leftover certificate file alone opens nothing.
4. **Closing:** the gate is re-checked after every Cloud job pass and after the remote-access switch saves, and the listener closes as soon as the gate fails.
   - **Why closing on the switch adds no new reach rule:** the switch is the owner's A951-S Settings on/off ("Remote dashboard access, Settings on/off … are implemented in PR #2543", `docs/backlog/replication-cloud.md` A951, under the owner's 9 November 2026 decision). Switching it off already removes the tunnel peer (`apps/server/src/cloud-tunnel.ts:59` → `rm(peer.json)`), and the staff entrance listens on `WAITRON_STAFF_HOST`, which defaults to `127.0.0.1` (`apps/server/src/config.ts:136,482`). Closing the entrance keeps it shut on the condition that already cuts it off.
5. **Switch gap closed:** on install, the holder adopts the new name and the listener's secure context is replaced in the same call, so no 10-second window remains.

## Review Focus

1. **Staff-host passkeys after a name change.** On the staff entrance the passkey site ID is the request's hostname (`request-from-box.ts:58-60`), so passkeys enrolled at the old name will not work at the new one; password sign-in must. Task 6 asserts that passkey options at the new name carry the new ID and that password sign-in works. The docs say staff-host passkeys are enrolled again after a name change.
2. **A name Cloud sends that the box cannot use** (uppercase, an IP address, over 253 characters, missing): no CSR, no request, no log line, and the served name and certificate are unchanged. Test in Task 2.
3. **A restart in the middle of a switch.** Cloud says the new name while the old chain is installed. After a restart the box serves the old name and resumes asking for the new one. Test in Task 6.
4. **Production.** `WAITRON_ENV=production` with a staff chain present opens no entrance, sends no request and refuses no start. Test in Task 5.
5. **Remote access withdrawn while the entrance is open.** Cloud withdraws `remote_access`, or the owner switches remote access off: the entrance closes, and it reopens only when the gate holds again. Closing on the switch matches what the switch already does to the tunnel (builder's call 4). Test in Task 5.

---

## PR — The box takes its staff name from Cloud

Depends on: Cloud plan PR 1 landed. Six tasks.

### Task 1: Read the names and decide the gate

**Files:**
- Create: `apps/server/src/cloud-staff-name.ts`
- Modify: `apps/server/src/cloud-remote.ts` (`createStaffCsr` uses `isStaffHostname`)
- Test: `apps/server/src/cloud-staff-name.test.ts`

**Interfaces:**
- Produces:
  - `isStaffHostname(value: unknown): value is string` — the rule now inline in `createStaffCsr` (lowercase labels, a dot, ≤ 253, not an IPv4 address).
  - `cloudStaffHostname(state: SavedCloudState | undefined): string | undefined` — returns a name only when `state.remoteAccessEnabled !== false` and the `remote_access` service of `state.lifecycle.view.services` is `provisioning` or `ready` with a `configuration.staffHostname` that passes `isStaffHostname`.
  - `staffEntranceAllowed(input: { environment: ServerConfig["environment"]; isMirror: boolean; state: SavedCloudState | undefined }): boolean` — true when the box is not production, is not a mirror, and `cloudStaffHostname(state)` is defined.
  - `interface StaffName { current(): string | undefined; origin(): string | undefined; adopt(hostname: string): void }` and `createStaffName(stateDir: string): StaffName`.
    - The initial value is the single DNS subject-alternative name of `<stateDir>/cloud/staff.crt` (`CLOUD_STAFF_CERT_FILE`).
    - It is `undefined` when the file is missing, unreadable, or names anything other than exactly one DNS name.
    - `origin()` is `https://${current()}`; `adopt` throws on a value that fails `isStaffHostname`.

- [ ] **Step 1: Write the failing tests**:
  - `cloudStaffHostname reads the remote access configuration's staff name` — `ready` and `provisioning` give the name; `unconfigured`, `failed`, no service, and `remoteAccessEnabled: false` give `undefined`.
  - `cloudStaffHostname ignores a name the box cannot use` — `"STAFF.example.test"`, `"10.0.0.1"`, a 254-character name, a number.
  - `staffEntranceAllowed holds only when every condition holds` — one case per condition turned off.
  - `createStaffName serves the installed certificate's one DNS name` — mint it with `mintSelfSignedServerCert({hostnames:["staff.example.test"], ipAddresses:[], now:new Date()})`; no file, and two names, both give `undefined`.
  - `adopt changes the served name and refuses an unusable one`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/cloud-staff-name.test.ts`; FAIL (module not found).
- [ ] **Step 3: Implement**; make `createStaffCsr` call `isStaffHostname`.
- [ ] **Step 4: Run** the new file and `src/cloud-remote.test.ts`; PASS. **Commit** `git commit -s -m "Read the box's staff name from Cloud and from its installed certificate"`.

### Task 2: Ask for Cloud's name, and stay quiet when there is none

**Files:**
- Modify: `apps/server/src/cloud-staff-certificate.ts` (`refreshStaffCertificate`), `apps/server/src/cloud-client.ts` (`staffCertificate`), `apps/server/src/cloud-worker.ts`
- Test: `apps/server/src/cloud-staff-certificate.test.ts`, `apps/server/src/cloud-worker.test.ts`

**Interfaces:**
- Consumes: `cloudStaffHostname` (Task 1).
- Produces:
  - `refreshStaffCertificate(state: SavedCloudState, stateDir: string, signal?: AbortSignal, onRefusal?: OnRefusal, isCurrent?: () => Promise<boolean>): Promise<string | undefined>`.
    - It returns the name whose fresh chain is installed, or `undefined` while Cloud's answer is pending.
    - It throws `cloud.not_configured` when `cloudStaffHostname(state)` is `undefined`, as well as in the existing cases.
    - The CSR is made after discovery, for that name, and every reply must carry the same `hostname`.
  - `CloudConnection.staffCertificate(signal?: AbortSignal): Promise<string | undefined>` and `CloudConnection.staffHostname(): Promise<string | undefined>` (the saved state through `cloudStaffHostname`).
  - `cloudConnectionJob` options: `staffHostname?: string` becomes `staffCertificates?: () => Promise<boolean>`, and `onStaffCertificate?: (hostname: string, signal: AbortSignal) => unknown`. The staff step runs only when `staffCertificates()` is true; otherwise it is skipped with no call and no log line.

- [ ] **Step 1: Write the failing tests**:
  - `cloud-staff-certificate.test.ts`: `asks for the staff name in Cloud's installation configuration` — the configuration says `staff-v-<venue>.venues.example.test`; the submit body's `hostname` and the CSR's single name are that name; the function returns that name.
  - `a changed staff name in Cloud leads to a request and install for the new name, keeping the old chain until it arrives` — first `staff.old.example.test` is installed; then Cloud says `staff.new.example.test` and answers `pending`: `undefined` is returned and the old chain stays; then `ready`: `"staff.new.example.test"` is returned. The key file is the same throughout.
  - `a discovery reply naming another host than the configuration installs nothing` — `cloud.unavailable`; no submit; the chain is unchanged.
  - `an unusable or missing name in Cloud sends nothing` — `cloud.not_configured` with zero calls (Review Focus 2).
  - `cloud-worker.test.ts`: `a box whose Cloud view lists no usable remote access staff name skips the staff step without a request or a log line` — `staffCertificates` returns false; `staffCertificate` is never called; `onError` is never called.
  - Existing cases keep their assertions and stop passing a hostname; `cloud-worker.test.ts:74-110,142+` use `staffCertificates: async () => true` (Changed test checks).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/cloud-staff-certificate.test.ts src/cloud-worker.test.ts`; the new cases FAIL.
- [ ] **Step 3: Implement.** Take the name from `cloudStaffHostname(state)`; move `createStaffCsr` after discovery; keep `installedFresh(stateDir, name)` as the first check.
- [ ] **Step 4: Run again**; PASS. **Commit** `git commit -s -m "Ask Cloud for a staff certificate for the name Cloud gives the box"`.

### Task 3: Configuration without `WAITRON_STAFF_ORIGIN`

**Files:**
- Modify: `apps/server/src/config.ts` (`ServerConfig["staff"]` is `{ host: string; port: number } | undefined`: defined, with its port-clash check, only when the environment is not production)
- Test: `apps/server/src/config.test.ts`

**Interfaces:**
- Produces: `config.staff` has no `origin`; `config.staff` is `undefined` in production.

- [ ] **Step 1: Write the failing tests**:
  - `staff host and port are configured on a box that is not production` — `loadConfig({}, ROOT, STATE_ROOT).staff` equals `{host: <DEFAULT_HTTP_HOST>, port: 8443}`.
  - `a production box has no staff listener settings and no new refusal` — with `WAITRON_ENV: "production"` and `WAITRON_STAFF_PORT` clashing with `WAITRON_HTTP_PORT`, no throw and `staff` is `undefined`.
  - `the staff port still refuses a clash on a box that is not production` (`listener_port_conflict`).
  - The cases at `config.test.ts:796-917` drop `WAITRON_STAFF_ORIGIN` and keep their port assertions. The invalid-origin case near line 810 is deleted with the rule it tested (Changed test checks).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/config.test.ts`; FAIL. First, `grep -rn "8443" apps/server/src --include='*.test.ts'` for any test whose own port now clashes; fix its setup, not its assertion.
- [ ] **Step 3: Implement.** `boot.ts` and `cloud-remote.ts` do not compile against `staff.origin` until Task 4, so Tasks 3 and 4 go to one implementer.
- [ ] **Step 4: Run** `src/config.test.ts`; PASS. **Commit** with Task 4.

### Task 4: The entrance follows the served name

**Files:**
- Modify: `apps/server/src/cloud-remote.ts` (`createStaffApp(app, origin: () => string | undefined)`; `startStaffListener(config: Pick<ServerConfig,"staff"|"stateDir">, app, log, staffName: StaffName)` returns `{ close(): Promise<void>; isListening(): boolean; reload(): void }`)
- Modify: `apps/server/src/tls.ts` (`watchTlsFiles(server, files, hostname: string | (() => string), onError, intervalMs?)` returns `{ checkNow(): void }`)
- Modify: `apps/server/src/boot.ts` (only the call sites, for type compatibility; the gate wiring is Task 5)
- Test: `apps/server/src/cloud-remote.test.ts`

**Interfaces:**
- Consumes: `StaffName` (Task 1); `config.staff` (Task 3).

- [ ] **Step 1: Write the failing tests**:
  - `the staff entrance follows the served name` — through `createStaffApp(app, () => holder.origin())`, `https://staff.old.example.test/manage` is 200 and `https://staff.new.example.test/manage` is 404; after `holder.adopt("staff.new.example.test")` the reverse holds.
  - `refuses another venue hostname…` (line 223) keeps its assertions with a holder.
  - `reload serves a chain for the adopted name at once and refuses one for another name` — the TLS handshake shows the new chain immediately after `reload()`, with no waiting for the interval.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/config.test.ts src/cloud-remote.test.ts`; FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, plus `pnpm --filter @waitron/server typecheck`; PASS. **Commit** `git commit -s -m "Serve the staff entrance under the installed certificate's name"`.

### Task 5: The boot opens and closes the entrance by the gate

**Files:**
- Modify: `apps/server/src/boot.ts` (~4430 and ~4683):
  - read the saved Cloud state once at start;
  - open the listener when `staffEntranceAllowed(...)` holds and `staffName.current()` is defined;
  - after each Cloud pass and after the remote-access switch saves, re-check and close or open;
  - on `onStaffCertificate(hostname)`, call `staffName.adopt(hostname)` then `listener.reload()`, or start the listener if it is closed and the gate holds.
- Modify: `apps/server/src/cloud-client.ts` (a `onRemoteAccessChanged?: () => void` connection option, called after the switch's save at lines 699–705)
- Test: `apps/server/src/boot.staff-entrance-gate.test.ts` (new), `apps/server/src/boot.failed-start.test.ts`, `apps/server/src/boot.management-origin.test.ts`, `apps/server/src/boot.mirror.test.ts`, `apps/server/src/boot.test.ts`

- [ ] **Step 1: Write the failing tests**:
  - `boot.staff-entrance-gate.test.ts` (Cloud at `installationFixture`, a chain installed for `staff.example.test`):
    - `opens the entrance when Cloud lists remote access with a staff name and a chain is installed`;
    - `closes it when Cloud withdraws remote access` (the service becomes `unconfigured`; after the next pass the staff port refuses connections);
    - `closes it when remote access is switched off` (the switch API; closed by the time the call returns). This mirrors what the switch already does to the tunnel peer (`cloud-tunnel.ts:59`); see builder's call 4;
    - `a leftover certificate file alone keeps it closed` (no Cloud view, or no `remote_access`).
  - `boot.test.ts` (alongside its existing `WAITRON_ENV: "production"` starts at lines 732, 1337, 1365): `a production box with a staff chain opens no entrance and starts no certificate requests` (`startStaffListener` is not called; the staff step is never run; the start succeeds) (Review Focus 4).
  - `boot.failed-start.test.ts` (~570), `boot.management-origin.test.ts` (129-140, 335, 573) and `boot.mirror.test.ts` (~397): drop `WAITRON_STAFF_ORIGIN`; give the start a saved Cloud view listing `remote_access` with the staff name (through the suite's existing Cloud seam, or `installationFixture` where the suite has none); keep every assertion. `workerOptions?.staffHostname` becomes `await workerOptions?.staffCertificates?.()` being `true`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.staff-entrance-gate.test.ts src/boot.test.ts src/boot.failed-start.test.ts src/boot.management-origin.test.ts src/boot.mirror.test.ts`; the new cases FAIL.
- [ ] **Step 3: Implement.** `onStaffCertificate` returns early unless the signal is live and the box is primary, as today.
- [ ] **Step 4: Run again**; PASS, and read the counts. **Commit** `git commit -s -m "Open the staff entrance only while Cloud and the owner allow it"`.

### Task 6: A name change end to end against a fake Cloud; docs

**Files:**
- Test: `apps/server/src/boot.staff-name-switch.test.ts` (new; boots with `WAITRON_CLOUD_ORIGIN` at `installationFixture`)
- Modify: `apps/server/README.md` (lines 302-309 and the table row at 343: remove `WAITRON_STAFF_ORIGIN`; the entrance opens once Cloud's staff certificate is installed and follows Cloud's name), `docs/developers/cloud-connection.md` (315-317 and 477: the box takes its staff name from Cloud's configuration reply; staff-host passkeys are enrolled again after a name change), `deploy/tunnel/README.md` (27-40: drop the export and the Compose line), `docs/backlog/replication-cloud.md` (A951 entry: one sentence that the box follows Cloud's staff name)

- [ ] **Step 1: Write the test** `changing the staff name in Cloud leads the box to ask for, install and serve a certificate for the new name, with no setting changed`:
  1. Cloud names `staff.old.example.test` and answers `ready`. After a pass, the entrance answers at the old name with that chain (TLS `servername`; the peer certificate covers the old name).
  2. Cloud changes the configuration and discovery to `staff.new.example.test` and answers `pending`. After a pass the box still serves the old name and chain, and a management POST through the entrance with `Origin: https://staff.old.example.test` passes the own-page check.
  3. Cloud answers `ready` for the new name. Immediately after that pass:
     - the entrance serves the new chain;
     - `https://staff.new.example.test` is answered and the old name is 404;
     - a POST with `Origin: https://staff.old.example.test` to a `https://staff.new.example.test` URL, carrying the manager cookie, is refused with `management.origin_refused`.
  4. Passkey sign-in options at the new name carry `rpId: "staff.new.example.test"`, and password sign-in at the new name succeeds (Review Focus 1).

  Second test: `a box restarted mid-switch serves the old name and resumes asking for the new one` — stop after step 2 and start again: the entrance serves the old name, and the next pass submits for the new name with the same key (Review Focus 3).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.staff-name-switch.test.ts`; PASS. Then a deletion control: make `createStaffApp` compare with the start-up name instead of the getter, see step 3's refusal assertion fail, and restore it.
- [ ] **Step 3:** Edit the docs. Run `pnpm exec prettier --check apps/server/README.md`; `docs/` is ignored by prettier, so read those changes yourself.
- [ ] **Step 4: Commit** `git commit -s -m "Test a staff name change from Cloud end to end and document it"`.
