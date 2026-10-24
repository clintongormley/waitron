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
  test.each([
    "editable",
    "read-out",
    "refusals",
    "timing refused",
    "timing invalid",
    "colour refused",
    "colour popup",
    "moved slips print",
    "moved slips don't print",
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
      printMovedSlips: state !== "moved slips don't print",
      ticketGrouping: state === "moved slips don't print" ? "separate" : "combined",
      printHeldWork: state === "moved slips don't print",
      bumpMode: "ticket",
      changesAfterSending: "held",
      printerIds: ["epson"],
      warmAfterMinutes: 3,
      overdueAfterMinutes: 5,
      forgottenAfterMinutes: 15,
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
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
          "wt-colour-chooser[name=colour]",
        )!.error,
      ).toBe("Choose one of these colours.");
    }
    if (state === "colour popup") {
      const chooser = el.shadowRoot!.querySelector("wt-colour-chooser")!;
      await chooser.updateComplete;
      chooser.show();
      expect(chooser.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    }
    if (state.startsWith("moved slips")) {
      const moved = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        "wt-combobox[name=printMovedSlips]",
      )!;
      const printing = state === "moved slips print";
      expect(moved.value).toBe(printing ? "print" : "dont-print");
      expect(moved.options[0]!.label).toBe("Print");
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
          "wt-combobox[name=ticketGrouping]",
        )!.value,
      ).toBe(printing ? "combined" : "separate");
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
          "wt-switch[name=printHeldWork]",
        )!.checked,
      ).toBe(!printing);
    }
    for (const name of ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"]) {
      await timing(name).updateComplete;
      const root = timing(name).shadowRoot!;
      const input = root.querySelector("input")!;
      const description = (input.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => root.getElementById(id)?.textContent ?? "");
      expect(description.filter((text) => text !== "")).toEqual(
        timing(name).error ? [timing(name).error] : [],
      );
      const group = el.shadowRoot!.querySelector("fieldset")!;
      expect(group.contains(timing(name))).toBe(true);
      expect(group.hasAttribute("aria-describedby")).toBe(false);
      expect(el.shadowRoot!.getElementById("timing-inheritance")).toBeNull();
      expect(timing(name).required).toBe(true);
    }
    await expectNoA11yViolations(host);
  });
});
