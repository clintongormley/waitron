import { expect, it } from "vitest";
import { page } from "vitest/browser";
import type { GuestMenuPreview } from "./guest-menu-preview.js";
import "./guest-menu-preview.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("lets a manager open the rendered page and change its language", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  const translated = deferred<void>();
  const earlier = deferred<Response>();
  const finished = deferred<void>();
  const api = new DashboardApi("", async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/management-api/catalogues/waiting/guest-preview") return earlier.promise;
    if (
      url.pathname !== "/management-api/catalogues/menu/guest-preview" ||
      init?.method !== "GET" ||
      new Headers(init?.headers).has("x-waitron-live")
    )
      return new Response("wrong request", { status: 404 });
    const language = url.searchParams.get("language") || "en";
    if (language === "es") await translated.promise;
    return new Response(
      JSON.stringify({
        html: `<!doctype html><html lang="${language}"><title>The Restaurant</title><h1>${language === "es" ? "Spanish key" : "Allergen key"}</h1><a href="#last">Last section</a><section id="last">Last dish</section></html>`,
        language,
        languages: ["en", "es"],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const read = api.getGuestMenuPreview.bind(api);
  api.getGuestMenuPreview = async (...args) => {
    const result = await read(...args);
    if (args[0] === "waiting") finished.resolve();
    return result;
  };
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
    frame.contentDocument!.querySelector<HTMLAnchorElement>("a")!.click();
    await expect.poll(() => frame.contentWindow!.location.hash).toBe("#last");
    expect(frame.contentWindow!.location.protocol).toBe("blob:");
    expect(frame.contentDocument!.querySelector("h1")?.textContent).toBe("Allergen key");
    const choose = el.shadowRoot!.querySelector("wt-combobox")!;
    const trigger = choose.shadowRoot!.querySelector<HTMLButtonElement>("button.trigger")!;
    trigger.focus();
    choose.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "es" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(choose.isConnected).toBe(true);
    expect(choose.shadowRoot!.activeElement).toBe(trigger);
    translated.resolve();
    await expect
      .poll(() => el.shadowRoot!.querySelector("iframe")?.contentDocument?.body.textContent)
      .toContain("Spanish key");
    el.menuId = "waiting";
    await el.updateComplete;
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect.poll(() => Boolean(el.shadowRoot!.querySelector("[role=status]"))).toBe(true);
    el.menuId = "missing";
    await el.updateComplete;
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect.poll(() => el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
    earlier.resolve(
      new Response(
        JSON.stringify({ html: "<h1>Earlier menu</h1>", language: "en", languages: ["en"] }),
      ),
    );
    await finished.promise;
    await new Promise(requestAnimationFrame);
    expect(el.shadowRoot!.querySelector("iframe")).toBeNull();
  } finally {
    translated.resolve();
    earlier.resolve(new Response("null"));
    cleanupWidgets();
  }
});
