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

it("reads sharing passively, changes the default menu's sharing, and lets a refused action retry", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  let enabled = false;
  let revision = 0;
  let refuse = true;
  const api = new DashboardApi("", async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/management-api/guest-menu") {
      if (init?.method === "GET") {
        if (new Headers(init.headers).get("x-waitron-live") !== "1")
          return new Response("", { status: 400 });
      } else if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          enabled: boolean;
          expectedRevision: number;
        };
        if (refuse) {
          refuse = false;
          revision++;
          return new Response(JSON.stringify({ error: { code: "settings.out_of_date" } }), {
            status: 409,
          });
        }
        if (body.expectedRevision !== revision || body.enabled === enabled)
          return new Response("", { status: 400 });
        enabled = body.enabled;
        revision++;
      } else return new Response("", { status: 405 });
      return new Response(JSON.stringify({ enabled, revision, available: enabled }));
    }
    return new Response("null");
  });
  const { el } = await mountWidget<GuestMenuPreview>("dashboard-guest-menu-preview", {
    api,
    menuId: "menu",
  });
  try {
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect
      .poll(
        () =>
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("#sharing-action")
            ?.disabled,
      )
      .toBe(false);
    const action = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("#sharing-action")!;
    await page.elementLocator(action()).click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("#sharing-error")?.textContent)
      .toBeTruthy();
    await expect.poll(() => action().disabled).toBe(false);
    await page.elementLocator(action()).click();
    await expect.poll(() => enabled).toBe(true);
    await expect
      .poll(() => el.shadowRoot!.querySelector("a[href='/public/menu']")?.textContent)
      .toBeTruthy();
    await expect
      .poll(() => el.shadowRoot!.querySelector("#sharing-error")?.textContent ?? "")
      .toBe("");
    await page.elementLocator(action()).click();
    await expect.poll(() => enabled).toBe(false);
    expect(revision).toBe(3);
  } finally {
    cleanupWidgets();
  }
});

it("keeps unknown sharing distinct from Off and explains an unavailable publication", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { t } = await import("../i18n/t.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  let failed = true;
  const api = new DashboardApi("", async (input) =>
    String(input).includes("/guest-preview")
      ? new Response("null")
      : failed
        ? new Response("", { status: 500 })
        : new Response(JSON.stringify({ enabled: true, revision: 1, available: false })),
  );
  const { el } = await mountWidget<GuestMenuPreview>("dashboard-guest-menu-preview", {
    api,
    menuId: "menu",
  });
  try {
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect.poll(() => el.shadowRoot!.querySelector("#sharing-error")).toBeTruthy();
    expect(el.shadowRoot!.textContent).not.toContain(t("menus.guest_sharing_off"));
    failed = false;
    await page
      .elementLocator(el)
      .getByRole("button", { name: t("content_languages.retry") })
      .click();
    await expect
      .poll(() => el.shadowRoot!.textContent)
      .toContain(t("menus.guest_sharing_unavailable"));
    expect(el.shadowRoot!.querySelector("a[href='/public/menu']")).toBeNull();
  } finally {
    cleanupWidgets();
  }
});
