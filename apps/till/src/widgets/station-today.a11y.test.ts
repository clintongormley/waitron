import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { TillStationToday } from "./station-today.js";
import "./station-today.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("station today %s", (theme) => {
  it.each([
    ["open", true, false, true, null, "open"],
    ["opened", true, false, true, "open", "opened_by_hand"],
    ["closed", true, false, false, "closed", "closed_by_hand"],
    ["out of hours", true, false, false, null, "out_of_hours"],
    ["default", true, true, true, null, "default"],
    ["switched off", false, false, false, null, "switched_off"],
  ] as const)(
    "has no violations while %s",
    async (_label, active, isDefault, open, byHand, why) => {
      const { el, host } = await mountWidget<TillStationToday>(
        "till-station-today",
        {
          station: {
            id: "grill",
            name: "Parrilla",
            active,
            isDefault,
            open,
            byHand,
            sendsTo: open ? null : "bar",
            why,
          },
          stations: [{ id: "bar", name: "Barra" }],
        },
        theme,
      );
      expect(el.shadowRoot).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});

describe.each(["light", "dark"] as const)("device station today %s", (theme) => {
  it.each(["close", "manager", "PIN", "refused PIN"] as const)(
    "has no violations at %s",
    async (step) => {
      const api = new TillApi(
        "",
        async (_path, init) =>
          new Response(
            JSON.stringify(
              init?.method === "PUT"
                ? { error: { code: "pin.invalid", params: {} } }
                : {
                    destinations: [{ id: "pass", name: "Pase", isDefault: true }],
                    authorizers: [{ personId: "manager", displayName: "Ana" }],
                  },
            ),
            {
              status: init?.method === "PUT" ? 403 : 200,
              headers: { "content-type": "application/json" },
            },
          ),
      );
      const { el, host } = await mountWidget<TillStationToday>(
        "till-station-today",
        {
          api,
          deviceMode: true,
          station: {
            id: "grill",
            name: "Parrilla",
            active: true,
            isDefault: false,
            open: true,
            byHand: null,
            sendsTo: null,
            why: "open",
          },
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
      await expect
        .poll(() => el.shadowRoot!.querySelector("till-station-today-dialog"))
        .not.toBeNull();
      const close = el.shadowRoot!.querySelector("till-station-today-dialog")!;
      await close.updateComplete;
      if (step !== "close") {
        close.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
        await expect
          .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
          .not.toBeNull();
        const pin = el.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
        await pin.updateComplete;
        if (step !== "manager") {
          pin.shadowRoot!.querySelector<HTMLElement>('[data-person="manager"]')!.click();
          await pin.updateComplete;
          if (step === "refused PIN") {
            pin.dispatchEvent(
              new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
            );
            await expect.poll(() => pin.error).toBe("pin.invalid");
            await pin.updateComplete;
          }
        }
      }
      await expectNoA11yViolations(host);
    },
  );
});
