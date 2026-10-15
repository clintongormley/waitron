import axe from "axe-core";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { OfflineCustodyApp } from "./offline-app.js";
import { custodyRequest } from "../testing/custodian-fixture.js";

let app: OfflineCustodyApp | undefined;
afterEach(() => {
  app?.remove();
});
async function audit(el: HTMLElement) {
  const result = await axe.run(el);
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })),
  ).toEqual([]);
}
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en", "es"] as const) {
    it(`renders and exposes usable initial/recovery/existing/stopped controls in ${locale} ${theme}`, async () => {
      app = new OfflineCustodyApp();
      document.body.append(app);
      await app.updateComplete;
      if (locale === "es")
        await userEvent.click(page.getByRole("button", { name: "ES", exact: true }));
      if (theme === "dark")
        await userEvent.click(
          page.getByRole("button", { name: locale === "en" ? "Dark" : "Oscuro", exact: true }),
        );
      await page.viewport(390, 844);
      const actual = getComputedStyle(app).backgroundColor;
      expect(actual).toBe(theme === "light" ? "rgb(247, 247, 248)" : "rgb(16, 18, 22)");
      await audit(app);
      await userEvent.click(
        page.getByRole("button", {
          name: locale === "en" ? "Check secret paper" : "Comprobar papel secreto",
          exact: true,
        }),
      );
      await audit(app);
      await userEvent.click(
        page.getByRole("button", {
          name: locale === "en" ? "Close and clear" : "Cerrar y limpiar",
          exact: true,
        }),
      );
      await audit(app);
      app.remove();
      app = new OfflineCustodyApp();
      document.body.append(app);
      await app.updateComplete;
      if (locale === "es")
        await userEvent.click(page.getByRole("button", { name: "ES", exact: true }));
      if (theme === "dark")
        await userEvent.click(
          page.getByRole("button", { name: locale === "en" ? "Dark" : "Oscuro", exact: true }),
        );
      await userEvent.click(
        page.getByRole("button", { name: locale === "en" ? "New kit" : "Primer kit", exact: true }),
      );
      const input = app.shadowRoot!.querySelector<HTMLInputElement>('input[name="host-request"]')!;
      const files = new DataTransfer();
      files.items.add(new File([JSON.stringify(await custodyRequest())], "public-request.json"));
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await userEvent.click(
        page.getByRole("button", {
          name: locale === "en" ? "Load setup request" : "Cargar configuración",
          exact: true,
        }),
      );
      await userEvent.click(
        page.getByRole("button", {
          name: locale === "en" ? "Yes — use its custodian" : "Sí — usar su custodia",
          exact: true,
        }),
      );
      await audit(app);
      const main = app.shadowRoot!.querySelector("main")!;
      expect(main.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await page.viewport(1280, 800);
      await audit(app);
    });
  }
