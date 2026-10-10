import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { PrepStationsApi } from "./routing-client.js";
import { StationDisableDialog } from "./station-disable-dialog.js";
afterEach(async () => {
  cleanup();
  setLocale("en");
  await page.viewport(1280, 720);
});
describe.each(["light", "dark"] as const)("Disable dialog %s", (theme) => {
  it.each(["en", "es"] as const)("renders %s at phone and desktop widths", async (locale) => {
    for (const width of [390, 1280]) {
      cleanup();
      await page.viewport(width, 720);
      await mountThemed("<div></div>", theme);
      setLocale(locale);
      const dialog = new StationDisableDialog();
      dialog.stationId = "kitchen";
      dialog.stationName = "Downstairs kitchen";
      dialog.namingCells = ["Food · Terrace", "Bread · Every zone"];
      dialog.api = new PrepStationsApi(
        async () =>
          ({
            openDishCount: 3,
            destinations: [{ id: "bar", name: "Bar", isDefault: true }],
          }) as never,
      );
      host.append(dialog);
      await expect
        .poll(() => dialog.shadowRoot?.querySelector("wt-combobox")?.options.length)
        .toBe(2);
      const combo = dialog.shadowRoot!.querySelector("wt-combobox")!;
      await combo.updateComplete;
      expect(combo.shadowRoot!.querySelector("button")!.name).toBe("openDishes");
      expect(combo.options.map((row) => row.label)).toEqual(
        locale === "en"
          ? ["Leave here to finish", "Send to Bar"]
          : ["Dejar aquí para terminar", "Enviar a Bar"],
      );
      const confirm = dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=disable-confirm]")!;
      expect(confirm.textContent!.trim()).toBe(locale === "en" ? "Disable" : "Deshabilitar");
      await expectNoA11yViolations(host);
      const modal = dialog.shadowRoot!.querySelector("wt-modal")!;
      await modal.updateComplete;
      const rect = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(window.innerWidth).toBe(width);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
    }
  });
  it.each(["loading", "read-error", "no-work", "write-error"])("checks %s", async (state) => {
    await mountThemed("<div></div>", theme);
    setLocale("en");
    const dialog = new StationDisableDialog();
    dialog.stationId = "kitchen";
    dialog.stationName = "Kitchen";
    dialog.api = new PrepStationsApi((async (_path: string, method: string) => {
      if (state === "loading") return new Promise(() => {});
      if (state === "read-error" || method === "DELETE") throw { code: "connection.failed" };
      return { openDishCount: state === "no-work" ? 0 : 3, destinations: [] };
    }) as never);
    host.append(dialog);
    await dialog.updateComplete;
    if (state === "read-error")
      await expect
        .poll(() => dialog.shadowRoot!.querySelector("[data-test=disable-retry]"))
        .not.toBeNull();
    else if (state !== "loading")
      await expect
        .poll(
          () =>
            dialog.shadowRoot!.querySelector("wt-combobox")?.options.length ??
            dialog
              .shadowRoot!.querySelector("[data-test=disable-confirm]")
              ?.hasAttribute("disabled"),
        )
        .toBe(state === "no-work" ? false : 1);
    if (state === "write-error") {
      dialog
        .shadowRoot!.querySelector("wt-combobox")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "__leave__" } }));
      await dialog.updateComplete;
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=disable-confirm]")!.click();
      await expect.poll(() => dialog.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});
