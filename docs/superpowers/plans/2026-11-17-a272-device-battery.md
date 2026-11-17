# A272: device low-battery alerts

**Status:** Corrections reread by Claude; watcher cleared at 2026-11-17 17:56 in Lane F `questions.md`. No owner approval of this design is claimed.
**Authority:** Lane F `questions.md`, watcher 2026-11-17 17:33: “A272 (device low-battery alert) is eligible now: plan first.” Exact ask is A272 in that lane’s `queue.md`; it requests a battery alert, English/Spanish wording, one guide line per language, no database change, and backlog deletion.

## Usable result and reuse

A manager with `hardware.manage` sees one ongoing dashboard alert per active, undeleted device with a fresh low battery; it names the device/percentage and opens Devices. Reuse `listDevices(tx)` from `@waitron/layouts` for active/deleted filtering (`device-profile-store.ts:347–371`), the existing alert registry and the reader thresholds: 11–20% warning, 0–10% error, above 20% quiet.

A report is fresh through exactly 600,000 ms old, matching `devices-screen.ts:269–281`; strictly older reports do not alert. Require a level, report time and explicitly false charging state. Zero is a reading. Apply to every reporting form factor. Recompute on each read, so charging, recovery, expiry, deactivation or deletion clears it. The till already resends every five minutes (`apps/till/src/api/battery-report.ts:9`).

**Interface:** `deviceBatteryAlertSource(): AlertSource` in `apps/server/src/alert-sources.ts`, normal transactional `read({ tx, now })`, local `DEVICE_BATTERY_STALE_MS = 10 * 60_000`. Area `devices`, permission `hardware.manage`, code `device.battery_low`, params `{ device: string; percent: number }`, key `device.battery_low:${id}`, `since: null`, screen `devices`. Register unconditionally in `boot.ts`, outside Payments gating. Ongoing alerts need no incident claim (`alerts.ts:128`).

## Build and verify with failing tests first

1. **Source owns decisions.** In `apps/server/src/alert-sources.test.ts`, use `useVenueDb`, the existing `seedDevice` (`@waitron/db/testing/seed.js`) and a fixed clock; set battery fields by direct test-body updates. Table-test 0/10/11/20/21%; test charging, never-reported, exactly ten minutes versus ten minutes plus 1 ms, inactive/deleted exclusion, distinct keys for two devices, and a stable key on rename. One reread after charging proves removal. Assert full alerts and source permission/area. Run `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts -t deviceBatteryAlertSource`, observe failure, implement the factory in `apps/server/src/alert-sources.ts` and params in `apps/server/src/errors.ts`, then require a counted pass.

2. **Boot owns wiring.** Extend the existing Payments-Off fixture in `apps/server/src/boot.payments-off-alerts.test.ts`: seed a fresh low device before start and assert its full alert from `/management-api/alerts`, preserving absent-reader assertions. Run that file to fail, register the factory in `apps/server/src/boot.ts`, then rerun to pass. Its existing cases cover absent and retained Payments tables.

3. **Dashboard owns wording/labels.** Add bilingual interpolation/charging-instruction cases in `apps/dashboard/src/i18n/alerts.test.ts` and area-label cases in `apps/dashboard/src/widgets/alert-format.test.ts`, restoring language afterwards. Run both to fail; add `device.battery_low` to `apps/dashboard/src/i18n/alert-messages.ts` and “Devices”/“Dispositivos” to `apps/dashboard/src/i18n/strings.ts`; rerun to pass. Wording names `{device}`, `{percent}` and says to charge it. Run `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts` unchanged.

4. **Guide and backlog.** No Devices guide exists on base `cac9f098`. Reuse the Devices-table paragraphs in `apps/server/src/guide/{en,es}/printers.md#printer-details`, as Claude recommends, after the existing Devices-table paragraph (EN line 53, ES line 58), with one actionable sentence: “Waitron alerts you when a device's battery is low; if its battery reading in **Devices** is grey, check its charge on the device itself.” Spanish: “Waitron te avisa cuando la batería de un dispositivo está baja; si su lectura de batería en **Dispositivos** está en gris, comprueba su carga en el propio dispositivo.” Do not explain automatic threshold/charging decisions, per `conventions-ui.md:122–132`. Run existing server `src/guide-content.test.ts` and `src/guide-pages.test.ts`; inspect both rendered languages in both themes at phone width. Remove only A272’s backlog entry and adjoining spare blank line (three lines).

## Bounds and size

No schema/migration, reporting change, incident/write, persistence, queue/timer, dependency, notification channel, helper, new guide page or UI/help bubble. Commands above are planned, not executed here; use `pnpm --filter <package> exec vitest run <named files>` for the dashboard, boot and guide checks. Normal hook and current-head CI follow during finish-branch.
Forecast excluding this plan: production +40–65/−0; tests +90–150/−0; test support +0/−0; guide +2–4/−0; backlog +0/−3. Existing behavioural assertions remain intact.
