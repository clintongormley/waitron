# A272: device low-battery alerts

**Status:** Draft for Claude read, then watcher clearance before building. The owner authorised the queue task; no owner-approved design exists.
**Request:** Lane F `queue.md`, A272: device battery alerts, bilingual wording and Devices guide, no database change; delete its backlog entry.

## Smallest usable result

Show one ongoing dashboard alert per active, undeleted device with a fresh low-battery report. Name the device and percentage; link to Devices. Reuse `hardware.manage`, checked at `apps/server/src/device-api.ts:267–272`.
Reuse `BATTERY_WARN = 20` and `BATTERY_ERROR = 10`: 11–20% warns, 0–10% is an error, and above 20% is quiet. A report is fresh through exactly 600,000 ms old; strictly older reports do not alert, matching `apps/dashboard/src/screens/devices-screen.ts:269–280`. Missing level, report time or charging state does not alert; only an explicitly non-charging device qualifies. Zero is a real reading. Apply to every reporting form factor.

Reuse `listDevices(tx)` from `@waitron/layouts` (`packages/layouts/src/device-profile-store.ts:330–376`) for active/deleted filtering. Use the source read's `now`; the till already resends every five minutes (`apps/till/src/api/battery-report.ts:9`). Recompute each read; charging, recovery, expiry, deactivation or deletion removes the alert.

**Interface:** `deviceBatteryAlertSource(): AlertSource` in `apps/server/src/alert-sources.ts`, with normal transactional `read({ tx, now }): Promise<readonly OngoingAlert[]>`. Area `devices`, permission `hardware.manage`, code `device.battery_low`, params `{ device: string; percent: number }`, key `device.battery_low:${id}`, `since: null`, screen `devices`. Register unconditionally in `boot.ts`'s `serverAlertSources`, outside Payments gating. Local constant: `DEVICE_BATTERY_STALE_MS = 10 * 60_000`.

Ongoing alerts take area/permission from their source (`apps/server/src/alerts.ts:116–134`); add no incident claim. Add the new area's English/Spanish display labels, “Devices” / “Dispositivos”.

## Exact files and tasks

1. **Source and wiring, failing tests first.** Extend `apps/server/src/alert-sources.test.ts` under `deviceBatteryAlertSource`, using `useVenueDb` and existing fixtures. Assert full alert objects at 0, 10, 11, 20 and 21%; a missing level and timestamp; charging and unknown charging; age exactly ten minutes and ten minutes plus 1 ms; inactive/deleted exclusion; two distinct ids with identical readings; stable key after a label change. Reread after charging, recovery and expiry to assert removal. Assert the source's permission/area here. Pin the test clock.
   Run `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts -t deviceBatteryAlertSource`; observe the missing factory/behaviour fail. Implement only the factory in `apps/server/src/alert-sources.ts` and declare its params in `apps/server/src/errors.ts`; rerun for a counted pass.
   Extend the existing Payments-Off fixture in `apps/server/src/boot.payments-off-alerts.test.ts`: seed a fresh low device before server start and assert its complete ongoing alert from `/management-api/alerts`, retaining the absent-reader assertions. Run `pnpm --filter @waitron/server exec vitest run src/boot.payments-off-alerts.test.ts`, observe the missing alert fail, then register the factory in `apps/server/src/boot.ts` and rerun. This owns boot wiring, including Payments absent.

2. **Wording and area labels, failing assertions first.** Add cases to `apps/dashboard/src/i18n/alerts.test.ts` for the device name, percentage including zero, and charging instruction in both languages; extend `apps/dashboard/src/widgets/alert-format.test.ts` for both area labels, restoring language after each case. Observe missing wording/labels fail with the command below before editing `apps/dashboard/src/i18n/alert-messages.ts` and `apps/dashboard/src/i18n/strings.ts`.
   Copy: EN “Device “{device}” battery is low ({percent}%). Charge it now.” ES “La batería del dispositivo «{device}» está baja ({percent} %). Cárgalo ahora.”
   Run `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alert-format.test.ts`; require counted passes. Run existing root guards: `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts`.

3. **Guide discrepancy and backlog.** At main `cac9f098`, `apps/server/src/guide-catalogue.ts:6–30` omits Devices and `git ls-files 'apps/server/src/guide/*/*'` contains no Devices page. **Watcher clearance is required for this proposed handling:** create only `apps/server/src/guide/en/devices.md` and `apps/server/src/guide/es/devices.md`, with a title, matching `## Battery {#battery}` / `## Batería {#battery}` headings and one actionable sentence: “When a low-battery alert names a device, charge it.” / “Cuando un aviso de batería baja indique un dispositivo, cárgalo.” Register `devices` in `apps/server/src/guide-catalogue.ts` and bilingual names in `apps/server/src/i18n/guide-pages.ts`.
   First add a bilingual catalogue/content assertion in `apps/server/src/guide-content.test.ts`; run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and observe missing registration/content fail. Add the pages/registration and rerun with `src/guide-pages.test.ts`. Inspect both rendered languages in both themes at phone width using the existing frame. Remove only A272's two-line entry at `docs/backlog.md:1106–1107` when the behaviour is complete.

## Bounds and forecast

Exclude schema/migrations, reporting changes, incidents/writes, durable state, queues/timers, new dependencies/channels/helpers, UI/help bubbles and a wider guide project. Test responsibilities are source decisions/recovery, boot wiring, dashboard wording/formatting, and guide registration/rendering.
Forecast excluding this plan: production +45–75/−0 lines; tests +130–210/−0; test support +0–15/−0, preferring existing fixtures; guide text +10–14/−0; backlog +0/−2. Commands are planned, not executed here; normal hook/current-head CI belong to the later runner finish-branch work.
