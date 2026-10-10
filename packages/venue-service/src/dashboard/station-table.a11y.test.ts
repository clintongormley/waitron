import { afterEach, describe, expect, it } from "vitest";
import { html } from "lit";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PrepStation } from "./routing-client.js";
import "./station-table.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});

const stations = [
  { id: "bar", name: "Bar", active: true, isDefault: true, displayOrder: 0 },
  { id: "old", name: "Old kitchen", active: false, isDefault: false, displayOrder: 1 },
] as PrepStation[];

describe.each(["light", "dark"] as const)("station table (%s)", (theme) => {
  it.each(["manager", "supervisor", "empty"] as const)("checks %s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("prep-station-table");
    el.stations = state === "empty" ? [] : stations;
    el.statusNotes = { old: "Switched off" };
    el.actions =
      state === "manager"
        ? Object.fromEntries(
            stations.map((station) => [
              station.id,
              html`<button type="button" aria-label=${`${station.name} actions`}>⋮</button>`,
            ]),
          )
        : {};
    if (state === "manager")
      el.outputs = {
        bar: {
          printedOn: "Epson",
          shownOn: html`<span>Pantalla Cocina — station screen</span>
            <a href="/manage/devices">Devices</a>`,
        },
        old: { printedOn: "No printer", shownOn: "None" },
      };
    host.append(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rows = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(state === "empty" ? 0 : 2);
    if (state === "manager")
      expect(rows[0]!.querySelector('[data-test="printed-on-bar"]')?.textContent).toBe("Epson");
    await expectNoA11yViolations(host);
  });
});
