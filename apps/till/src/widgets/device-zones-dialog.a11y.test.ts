import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DeviceZoneSelection } from "@waitron/venue-service";
import { DeviceZonesDialog } from "./device-zones-dialog.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";

const selection: DeviceZoneSelection = {
  profileId: "profile",
  snapshot: "scope",
  selectedZoneIds: ["bar", "room"],
  startingZoneId: "bar",
  adjusted: false,
  zones: [
    {
      id: "bar",
      name: "Bar",
      departmentId: "dept",
      departmentName: "Venue",
      serviceMode: "prepay",
    },
    {
      id: "room",
      name: "Room",
      departmentId: "dept",
      departmentName: "Venue",
      serviceMode: "table_tab",
    },
  ],
};
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("zones dialog a11y (%s)", (theme) => {
  for (const language of ["en", "es"] as const) {
    for (const state of ["loaded", "dirty", "invalid", "loading", "refusal", "no-zones"] as const) {
      it(`${language}: ${state}`, async () => {
        setLocale(language);
        const { el, host } = await mountWidget<DeviceZonesDialog>(
          "till-device-zones-dialog",
          {
            open: true,
            selection:
              state === "loading"
                ? null
                : state === "no-zones"
                  ? { ...selection, zones: [], selectedZoneIds: [], startingZoneId: null }
                  : selection,
            loading: state === "loading",
          },
          theme,
        );
        await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
        if (state === "dirty" || state === "refusal")
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLInputElement>(
              'input[name="starting-zone"][value="room"]',
            )!,
          );
        if (state === "invalid") {
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLInputElement>(
              'input[name="shown-zone"][value="bar"]',
            )!,
          );
          await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
          expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
        }
        if (state === "refusal") {
          el.refusal = { code: "device_zones.changed", field: "selectedZoneIds" };
          await el.updateComplete;
        }
        await expectNoA11yViolations(host);
        if (state === "loaded") {
          const viewport = { width: innerWidth, height: innerHeight };
          try {
            for (const width of [390, 1280]) {
              await page.viewport(width, 844);
              const table = el.shadowRoot!.querySelector("table")!;
              expect(table.getBoundingClientRect().right).toBeLessThanOrEqual(width);
              expect(table.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
              await page.screenshot({
                path: `../../__screenshots__/a740-device-zones/dialog-${language}-${theme}-${width}.png`,
              });
            }
          } finally {
            await page.viewport(viewport.width, viewport.height);
          }
        }
      });
    }
  }
});
