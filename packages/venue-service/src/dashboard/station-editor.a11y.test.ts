import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StationEditor } from "./station-editor.js";
import "./station-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("Station editor (%s)", (theme) => {
  test.each(["editable", "read-out", "refusals"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<prep-station-editor></prep-station-editor>",
      theme,
    )) as StationEditor;
    el.station = {
      id: "grill",
      name: "Grill",
      active: true,
      showsRestOfOrder: true,
      printerIds: ["epson"],
    };
    el.printers = [
      { id: "epson", name: "Epson" },
      { id: "pass", name: "Pass printer", watcherId: "expo" },
    ];
    el.watchers = [{ id: "expo", name: "Expo", printerIds: ["pass"] }];
    el.canManagePrinters = state !== "read-out";
    el.open = true;
    await el.updateComplete;
    if (state === "refusals") {
      el.shadowRoot!.querySelector("wt-input[name=stationName]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "" } }),
      );
      el.refusal = { code: "printer.makes_and_watches", params: { printerId: "pass" } };
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
      ).toBe("Enter a name.");
    }
    await expectNoA11yViolations(host);
  });
});
