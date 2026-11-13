import { expect, it } from "vitest";
import { page } from "vitest/browser";
import type { GuestMenuPreview } from "./guest-menu-preview.js";
import "./guest-menu-preview.js";
it("lets a manager open the rendered page and change its language", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  const api = new DashboardApi("", async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname !== "/management-api/catalogues/menu/guest-preview" || init?.method !== "GET")
      return new Response("wrong request", { status: 404 });
    const language = url.searchParams.get("language") || "en";
    return new Response(
      JSON.stringify({
        html: `<!doctype html><html lang="${language}"><title>The Restaurant</title><h1>${language === "es" ? "Spanish key" : "Allergen key"}</h1><a href="#last">Last section</a><section id="last">Last dish</section></html>`,
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
      .poll(() => el.shadowRoot!.querySelector("iframe")?.contentDocument?.body.textContent)
      .toContain("Allergen key");
    const frame = el.shadowRoot!.querySelector("iframe")!;
    await expect.poll(() => Boolean(frame.contentDocument?.querySelector("a"))).toBe(true);
    const navigated = new Promise<void>((resolve) => {
      frame.contentWindow!.addEventListener("hashchange", () => resolve(), { once: true });
      frame.addEventListener("load", () => resolve(), { once: true });
    });
    frame.contentDocument!.querySelector<HTMLAnchorElement>("a")!.click();
    await navigated;
    expect(frame.contentDocument!.querySelector("h1")?.textContent).toBe("Allergen key");
    const choose = el.shadowRoot!.querySelector("wt-combobox")!;
    choose.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "es" }, bubbles: true, composed: true }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("iframe")?.contentDocument?.body.textContent)
      .toContain("Spanish key");
    await el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    el.menuId = "missing";
    await el.updateComplete;
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect.poll(() => el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
    expect(el.shadowRoot!.querySelector("iframe")).toBeNull();
  } finally {
    cleanupWidgets();
  }
});
