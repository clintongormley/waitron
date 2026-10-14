import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StationEditor } from "./station-editor.js";
import "./station-editor.js";

// axe does not score a placeholder's contrast, so the placeholder-hinted timings measure their own.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("Station editor (%s)", (theme) => {
  test.each([
    "editable",
    "read-out",
    "refusals",
    "timing refused",
    "timing invalid",
    "colour refused",
  ])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<prep-station-editor></prep-station-editor>",
      theme,
    )) as StationEditor;
    el.station = {
      id: "grill",
      name: "Grill",
      colour: "orange",
      active: true,
      showsRestOfOrder: true,
      printerIds: ["epson"],
      timingOverrides: {
        warmAfterMinutes: null,
        overdueAfterMinutes: 5,
        forgottenAfterMinutes: null,
      },
      timingDefaults: { warmAfterMinutes: 3, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
    };
    el.printers = [
      { id: "epson", name: "Epson" },
      { id: "pass", name: "Pass printer" },
    ];
    el.stations = [
      { id: "grill", name: "Grill", colour: "orange" },
      { id: "bar", name: "Bar", colour: "blue" },
      { id: "pizza", name: "Pizza oven", colour: "orange" },
    ];
    el.canManagePrinters = state !== "read-out";
    el.open = true;
    await el.updateComplete;
    if (state === "refusals") {
      el.shadowRoot!.querySelector("wt-input[name=stationName]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "" } }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
      el.refusal = { code: "printer.not_found", params: { printerId: "pass" } };
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
      ).toBe("Enter a name.");
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!.error,
      ).toBe("Choose active printers.");
    }
    const timing = (name: string) =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name=${name}]`)!;
    if (state === "timing refused") {
      timing("warmAfterMinutes").dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "4" } }),
      );
      el.refusal = {
        code: "station.thresholds_invalid",
        params: { field: "overdueAfterMinutes" },
      };
      await el.updateComplete;
      expect(timing("overdueAfterMinutes").error).toBe(
        "Use whole minutes with warm < overdue < forgotten.",
      );
    }
    if (state === "timing invalid") {
      timing("warmAfterMinutes").dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "0" } }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
      await el.updateComplete;
      expect(timing("warmAfterMinutes").error).toBe(
        "Use whole minutes with warm < overdue < forgotten.",
      );
    }
    if (state === "colour refused") {
      el.refusal = { code: "management.request_invalid", params: { field: "colour" } };
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["station-colour-picker"]>(
          "station-colour-picker",
        )!.error,
      ).toBe("Choose one of these colours.");
    }
    for (const name of ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"]) {
      await timing(name).updateComplete;
      const root = timing(name).shadowRoot!;
      const input = root.querySelector("input")!;
      const description = (input.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => root.getElementById(id)?.textContent ?? "");
      expect(description[0]).toBe("Leave blank to use the venue default.");
      const placeholder = getComputedStyle(input, "::placeholder").color;
      const field = getComputedStyle(root.querySelector(".field")!).backgroundColor;
      expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
    }
    await expectNoA11yViolations(host);
  });
});
