import { expect, it, vi } from "vitest";
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

it("shares one settings revision between appearance and sharing actions in either order", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  let settings = {
    enabled: false,
    available: false,
    revision: 0,
    paper: undefined as import("@waitron/shared").GuestMenuPaperAppearance | undefined,
  };
  const api = new DashboardApi("", async (input, init) => {
    if (String(input).includes("guest-preview"))
      return new Response(
        JSON.stringify({
          html: "<h1>Lunch</h1>",
          language: "en",
          languages: ["en"],
          versionId: "captured",
          members: [
            { name: "Lunch", section: true },
            { name: "Wine", section: true },
          ],
        }),
      );
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (body.expectedRevision !== settings.revision)
        return new Response(JSON.stringify({ error: { code: "settings.out_of_date" } }), {
          status: 409,
        });
      settings = {
        enabled: body.enabled,
        available: body.enabled,
        revision: settings.revision + 1,
        paper: body.paper ?? settings.paper,
      };
    }
    return new Response(JSON.stringify(settings));
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
          el
            .shadowRoot!.querySelector("dashboard-guest-menu-paper")
            ?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-button"]>("#preview-paper")
            ?.disabled,
      )
      .toBe(false);
    const paper = el.shadowRoot!.querySelector("dashboard-guest-menu-paper")!;
    const root = paper.shadowRoot!;
    expect((paper as HTMLElement & { versionId: string }).versionId).toBe("captured");
    const font = root.querySelector('[name="paper-font"]')!;
    font.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "sans" } }));
    await page.elementLocator(root.querySelector("#save-paper")!).click();
    await expect.poll(() => settings.revision).toBe(1);
    await expect
      .poll(() => root.querySelector<HTMLElementTagNameMap["wt-button"]>("#save-paper")!.disabled)
      .toBe(true);
    await page.elementLocator(el.shadowRoot!.querySelector("#sharing-action")!).click();
    await expect.poll(() => settings.enabled).toBe(true);
    await page.elementLocator(el.shadowRoot!.querySelector("#sharing-action")!).click();
    await expect.poll(() => settings.enabled).toBe(false);
    font.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "serif" } }));
    await page.elementLocator(root.querySelector("#save-paper")!).click();
    await expect.poll(() => settings.revision).toBe(4);
    await expect
      .poll(() => root.querySelector<HTMLElementTagNameMap["wt-button"]>("#save-paper")!.disabled)
      .toBe(true);
    expect(settings.paper?.font).toBe("serif");
    expect(el.shadowRoot!.querySelector("#sharing-error")).toBeNull();
    await el.shadowRoot!.querySelector("wt-modal")!.requestClose("navigation");
    await expect.poll(() => el.shadowRoot!.querySelector("dashboard-guest-menu-paper")).toBeNull();
    settings = { ...settings, revision: 5, paper: { ...settings.paper!, font: "sans" } };
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect
      .poll(
        () =>
          el
            .shadowRoot!.querySelector("dashboard-guest-menu-paper")
            ?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="paper-font"]')
            ?.value,
      )
      .toBe("sans");
  } finally {
    cleanupWidgets();
  }
});

it("refreshes Cloud confirmation passively while preserving the open paper draft", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  const { t } = await import("../i18n/t.js");
  let state = "pending";
  const api = new DashboardApi("", async (input, init) => {
    if (String(input).endsWith("/management-api/guest-menu")) {
      expect(new Headers(init?.headers).get("x-waitron-live")).toBe("1");
      return new Response(
        JSON.stringify({
          enabled: true,
          available: true,
          revision: 1,
          delivery: { state, receivedAt: state === "current" ? "2026-11-14T05:00:00.000Z" : null },
        }),
      );
    }
    return new Response(
      JSON.stringify({
        html: "<h1>Lunch</h1>",
        language: "en",
        languages: ["en"],
        versionId: "v1",
        members: [],
      }),
    );
  });
  const { el } = await mountWidget<GuestMenuPreview>("dashboard-guest-menu-preview", {
    api,
    menuId: "menu",
  });
  try {
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("#cloud-delivery")?.textContent)
      .toBe(t("menus.guest_cloud_pending"));
    const paper = el.shadowRoot!.querySelector("dashboard-guest-menu-paper")!;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await el.shadowRoot!.querySelector("wt-modal")!.requestClose("navigation");
    await expect.poll(() => el.shadowRoot!.querySelector("dashboard-guest-menu-paper")).toBeNull();
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("#cloud-delivery")?.textContent)
      .toBe(t("menus.guest_cloud_pending"));
    const reopenedPaper = el.shadowRoot!.querySelector("dashboard-guest-menu-paper")!;
    expect(reopenedPaper).not.toBe(paper);
    state = "current";
    await vi.advanceTimersByTimeAsync(60000);
    await expect
      .poll(() => el.shadowRoot!.querySelector("#cloud-delivery")?.textContent)
      .toBe(t("menus.guest_cloud_current"));
    expect(el.shadowRoot!.querySelector("dashboard-guest-menu-paper")).toBe(reopenedPaper);
    expect(el.shadowRoot!.querySelector('a[href^="https://"]')).toBeNull();
  } finally {
    vi.useRealTimers();
    api.liveData.clear();
    cleanupWidgets();
  }
});
