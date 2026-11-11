# B3-19: local network status

**Status: proposed; pending Claude plan review and watcher clearance. Do not build yet.**
Author: separate GPT-6.1 Sol plan-author seat. No implementation, tests or qualification performed.
Queue authority: `~/waitron-campaign-k/queue.md`, B3: “The bootable USB installer — BUILD”; “Remaining: protected host-key delivery and pack integration; restricted host adapters, managed screen/network integration; signed release downloads and qualification; same-box production re-setup; real USB/box/Android checks.”
Owner 2026-11-01: “Yes, build it”, under [the parent plan](2026-10-26-b3-usb-installer.md); [design](../specs/2026-10-21-b3-usb-installer-design.md) §10; parent Tasks 3.1/3.2. This authorises B3, not this technical plan. Watcher 2026-11-12 00:12 prioritises B3 over A1002. Parent slices 1/2/3/5/6/8 remain 0/6; graphics deferred by watcher 2026-11-11 20:38, not dropped.

## Smallest useful result

You can open **Box status** with `system.manage`, see the local box's wired connection/address and current Wi-Fi name, and press **Refresh network status**. This does not prove internet access.
**Choose status only.** My unmeasured estimate for status plus fresh scans exceeds three hours/about 1,000 changed lines, including scan completion/security mapping, browser work and installed-image qualification. Status alone is usable now. Scanning remains unsupported; offer no Scan button.
No join/forget, credentials, boot-copy lifecycle, screen settings, kiosk/graphics, key delivery, release publication, database/migration, new permission/verb/field, ledger or generic RPC. Preserve clocks/tags. Physical Wi-Fi/USB/box/Android, signed release and production re-setup remain outstanding.

## Reuse and implementation decisions

Read receipts: `deploy/box/mkosi.conf:20`, `build.sh:38-47,80-84` install/enable NetworkManager and the host socket/modules. `waitron-box.sh:169-188` dispatches clocks/tags only. `apps/server/src/box-host-api.ts` authorises network reads; `apps/dashboard/src/dashboard-app.ts:302,3091` mounts Box status with `system.manage`. Reuse that navigation.
Reuse `parseHostRequest`, `formatHostReply`, `/run/waitron-box/box.sock`, `boxHostRequests().networkRead(actor)` and `GET /api/box/network`; server files stay unchanged. The server checks permission/mints the actor; the host validates its form.
Create `handleNetworkRead(line, {run}?) -> Promise<string>` in `scripts/box/network-host.mjs`, following `name-tag-host.mjs`. Only canonical network.read reaches commands. Log verb/actor/permission before observation, never settings, SSIDs or raw output.
Use fixed NetworkManager D-Bus reads via `busctl --system --json=short`, with paths discovered from NetworkManager, never caller arguments. Permit property reads/GetSettings, no GetSecrets/mutations. First confirm installed help/introspection/JSON in the existing rig container; absent support goes to the watcher, without adding dependencies.
Map device type/state and IP `AddressData` to `wired:{connected,address}`: connected Ethernet first, then interface-name order; IPv4 before IPv6; validated address or null, always null when disconnected. Select active Wi-Fi first, then interface-name order; preserve active access-point SSID bytes as lowercase `wifi.connectedSsidHex`.
`wifi.savedSsidHex`: active saved profile's SSID, otherwise sole distinct saved Wi-Fi SSID, null only when none; refuse ambiguity. Missing radio gives null connected SSID; failed observation gives `host_failed`, not disconnected. Keep exact reply `{ok:true,wired,wifi,change:null,bootCopy:{state:"pending",reason:null,failure:null}}`: recovery-copy reconciliation remains pending, never inferred from connectivity. Display wired/current Wi-Fi only.
Use a three-second total command budget, remaining-time subprocess deadlines, 64 KiB output caps, no shell and sanitised failures. Forward only network.read from the shell; install the module through the recipe. Preserve input limits, clock restoration, tag lock and socket permissions.
Mount app-owned `dashboard-box-network-panel` outside Box status's health/alert-dependent body. Reuse `wt-button`, help-mode `wt-help-tooltip`, tokens. Load once through `api.background.getBoxNetwork()`; refresh through the active client. No polling/scanning. Separate load errors from other page actions; block overlapping refreshes and discard disconnected replies.
Add `DashboardApi.getBoxNetwork()` with browser-safe types for consumed wired/wifi fields. Render decoded SSIDs as text; use hex for invalid UTF-8/control bytes. Localise unavailable/failed/busy and retry; never turn failure into disconnected status.

## Files and test ownership

- Host: create `scripts/box/network-host.{mjs,test.mjs}`; modify `deploy/box/{waitron-box.sh,build.sh}`, `scripts/waitron-box-sh.test.mjs`. Adapter tests own rejection before commands, observations/hex, missing versus failed reads, profile selection and command limits; shell tests own forwarding/clock/tag preservation.
- Dashboard: modify `apps/dashboard/src/api/{client.ts,client-routes.test.ts}`, `screens/{box-status-screen.ts,box-status-screen.test.ts}`, `i18n/{strings.ts,codes.ts}`, `help-guide.ts`; create `widgets/box-network-panel.{ts,test.ts,a11y.test.ts}` under that source root. Tests own request/cookie/passive mapping, mounting, data/errors, refresh/loading, text safety and axe. Grow fixtures without weakening assertions.
- Support: modify `bench/box-installer/{run.mjs,README.md}`, `scripts/box/{recipe-setup.mjs,recipe-setup.test.mjs}`: extend installed-setup observations/parser, no new rig. Existing `apps/server/src/box-host-api.test.ts` owns auth/actor/passive-route checks; rerun unchanged.
- Docs: `apps/server/src/guide/{en,es}/box-status.md`, shared `{#network}`, guide key `box-status.network`: explain status, refresh and unavailable Wi-Fi changes in second person per `~/.claude/docs-writing-style.md`. Add a dated parent-plan pointer; update B3's paragraph in `docs/backlog/box.md`, retaining 0/6.

## Build and focused verification after clearance

1. Read the TDD skill before code. For each behaviour: assertion first, observed expected red, minimum implementation, observed green. Preserve assertions; no case quota, exclusions or blanket suite run.
2. Host/shell: `pnpm exec vitest run scripts/box/network-host.test.mjs scripts/waitron-box-sh.test.mjs scripts/box/name-tag-host.test.mjs scripts/box/host-protocol.test.mjs scripts/box/recipe-setup.test.mjs`.
3. Deletion control in a disposable candidate: remove the read-only verb guard; canonical join-request test must fail because a host command ran. Restore and rerun green; retain authorised-read control. Commit no mutation.
4. Server contract: `pnpm --filter @waitron/server exec vitest run src/box-host-api.test.ts src/guide-content.test.ts`.
5. Dashboard: `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/screens/box-status-screen.test.ts src/widgets/box-network-panel.test.ts src/widgets/box-network-panel.a11y.test.ts`. Check memory headroom first; run serially beside other lanes. Root guide/token checks: `pnpm exec vitest run scripts/guide-links.test.ts scripts/style-token-names.test.ts`.
6. Inspect the mounted panel in EN/ES, light/dark, 390/1280 px: long names, loading, disconnected/unavailable states; axe in both themes. Keep screenshots local. No staged input or draft scope.

## Installed-image gate and budget

Extend the existing shipped-unit `ExecStartPost` observations: on both installed-setup disk boots send canonical network.read through the deployed socket as uid/gid 10001. Compare its connected wired address with independent guest `ip -j address`; require an actual address. Keep clock/socket-denial checks. `installedFailures` must reject missing/disconnected/mismatched evidence, with literal controls in `recipe-setup.test.mjs`.
Reuse `bench/box-installer/README.md`'s signed-source app/archive inputs, tool container and `bash deploy/box/build.sh /inputs /work/output`. Run there: `timeout -k 10 2100 env B3_INSTALLER_IMAGE=/work/output/waitron-install-dev.img node bench/box-installer/run.mjs --case installed-setup --run-dir /work/network-status`. No fake socket or patched-old-guest qualification.
Bound build/qualification to 50 active minutes, including ≤15 locating inputs/capacity. On unavailability/timeout retain command, source/image identities, serial logs and failure; report gate BLOCKED to watcher at a clean checkpoint, not qualified/completed. VM absence and mock bytes never qualify physical Wi-Fi.
Estimated +/− lines: production +260/−10; tests +330/−5; support +75/−5; docs including plan +110/−5; about 800 changed. Three-hour budget: plan/review 20 min, TDD/build 55, image qualification 50, docs/visual 20, finish reviews/fixes/hook/open PR 35. Record watcher/outage waits separately.
Stop at 1.5× size estimate or three active hours; send watcher the required deviation/over-budget note and smallest cut. Driver obtains Claude plan review/watcher clearance before build; later full-branch `finish-branch` Claude review wave (second seat when required), fresh fix read, signed-off commits, normal hook and current-head CI. None completed here.

## Primary-source provenance for the proposed adapter

| Source, read 2026-11-12 | Source words; implication to verify against the installed image |
| --- | --- |
| [NetworkManager Device](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.Device.html), [IP4Config](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.IP4Config.html) | “State”, “DeviceType”, “Ip4Config”; “an IP address string”. Read host state/address properties, not browser state. |
| [Wireless](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.Device.Wireless.html), [AccessPoint](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.AccessPoint.html) | “ActiveAccessPoint”; “Ssid readable ay”. Preserve SSID bytes; no fresh scan in this cut. |
| [Settings.Connection](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.Settings.Connection.html), [busctl](https://www.freedesktop.org/software/systemd/man/latest/busctl.html) | “This will never include any secrets”; “Retrieve the current value”. Use GetSettings/property reads only; installed command/schema qualification is still required. |
