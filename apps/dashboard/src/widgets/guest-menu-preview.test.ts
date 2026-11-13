import { expect, it } from "vitest";
import { page } from "vitest/browser";
import type { GuestMenuPreview } from "./guest-menu-preview.js";
import "./guest-menu-preview.js";
it("lets a manager open the rendered page and change its language", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  const api = new DashboardApi("", async (input) => {
    const language = new URL(String(input), location.origin).searchParams.get("language") || "en";
    return new Response(
      JSON.stringify({
        html: `<!doctype html><html lang="${language}"><title>The Restaurant</title><p>${language === "es" ? "Spanish key" : "Allergen key"}</p></html>`,
        language,
        languages: ["en", "es"],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const { el } = await mountWidget<GuestMenuPreview>("dashboard-guest-menu-preview", {
    api,
    menuId: "menu",
  });
  try {
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("iframe")?.srcdoc)
      .toContain("The Restaurant");
    const choose = el.shadowRoot!.querySelector("wt-combobox")!;
    choose.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "es" }, bubbles: true, composed: true }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("iframe")?.srcdoc)
      .toContain("Spanish key");
  } finally {
    cleanupWidgets();
  }
});
