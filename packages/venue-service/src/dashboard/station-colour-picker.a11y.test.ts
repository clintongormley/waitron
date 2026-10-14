import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { STATION_COLOURS } from "@waitron/shared";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StationColourPicker } from "./station-colour-picker.js";
import "./station-colour-picker.js";
import "./station-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const LONG = "Pastry and dessert station by the back door";
const stations = STATION_COLOURS.map((colour) => ({
  id: colour,
  name: `${LONG} ${colour}`,
  colour,
}));

describe.each(["light", "dark"] as const)("Station colour picker (%s)", (theme) => {
  describe.each([390, 1280])("at %ipx", (width) => {
    it.each(["en", "es"] as const)(
      "is accessible with every colour used, in %s",
      async (locale) => {
        const previous = [window.innerWidth, window.innerHeight];
        try {
          await page.viewport(width, 1100);
          setLocale(locale);
          const el = (await mountThemed(
            "<station-colour-picker></station-colour-picker>",
            theme,
          )) as StationColourPicker;
          host.style.width = "calc(100vw - 32px)";
          el.value = "teal";
          el.stations = stations;
          el.error =
            locale === "en" ? "Choose one of these colours." : "Elige uno de estos colores.";
          await el.updateComplete;
          await expectNoA11yViolations(host);
        } finally {
          await page.viewport(previous[0]!, previous[1]!);
          setLocale("en");
        }
      },
    );
  });
});

it("wraps its tiles inside the station editor at 390px", async () => {
  const previous = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 1100);
    setLocale("en");
    const editor = (await mountThemed(
      "<prep-station-editor></prep-station-editor>",
      "light",
    )) as HTMLElementTagNameMap["prep-station-editor"];
    host.style.width = "calc(100vw - 32px)";
    editor.station = {
      id: "grill",
      name: "Grill",
      colour: "red",
      active: true,
      showsRestOfOrder: false,
      printerIds: [],
      timingOverrides: {
        warmAfterMinutes: null,
        overdueAfterMinutes: null,
        forgottenAfterMinutes: null,
      },
      timingDefaults: { warmAfterMinutes: 3, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
    };
    editor.stations = stations;
    editor.open = true;
    await editor.updateComplete;
    const picker = editor.shadowRoot!.querySelector("station-colour-picker")!;
    await picker.updateComplete;
    const group = picker.shadowRoot!.querySelector("[role=radiogroup]")!.getBoundingClientRect();
    expect(group.width).toBeGreaterThan(0);
    for (const tile of picker.shadowRoot!.querySelectorAll<HTMLElement>("[role=radio]")) {
      const box = tile.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(group.left - 1);
      expect(box.right).toBeLessThanOrEqual(group.right + 1);
      expect(tile.scrollWidth).toBeLessThanOrEqual(tile.clientWidth + 1);
    }
    expect(group.right).toBeLessThanOrEqual(window.innerWidth);
  } finally {
    await page.viewport(previous[0]!, previous[1]!);
  }
});
