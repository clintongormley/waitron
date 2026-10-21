import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { KitchenScreen } from "./kitchen-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

function client() {
  const requests: { path: string; method: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    requests.push({ path: String(path), method: init?.method ?? "GET", body: init?.body });
    const value = String(path).endsWith("bump-mode")
      ? { mode: "ticket" }
      : { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
    return new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json" },
    });
  });
  return { api: new DashboardApi("", fetchImpl), requests };
}

describe("A773 dashboard waiter authority", () => {
  it.each([false, true])("reads only retained kitchen settings (readOnly=%s)", async (readOnly) => {
    const { api, requests } = client();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api, readOnly });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=timing-values]")).not.toBeNull(),
    );
    expect(requests.map(({ path }) => path).sort()).toEqual([
      "/management-api/bump-mode",
      "/management-api/kitchen-timing-defaults",
    ]);
    expect(el.shadowRoot!.querySelector('[data-test^="fire-"]')).toBeNull();
    expect(el.shadowRoot!.querySelectorAll("section")).toHaveLength(2);
    if (readOnly) {
      expect(el.shadowRoot!.textContent).toContain(t("kitchen.bump_ticket"));
      expect(el.shadowRoot!.querySelector("wt-button")).toBeNull();
    }
  });

  it("changes preparation mode without a cooking-authority request", async () => {
    const { api, requests } = client();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=bump-ticket]")?.getAttribute("variant")).toBe(
        "primary",
      ),
    );
    const line = el.shadowRoot!.querySelector<HTMLElement>("[data-test=bump-line]")!;
    await userEvent.click(line);
    await vi.waitFor(() =>
      expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(1),
    );
    expect(requests.filter(({ method }) => method === "PUT")).toEqual([
      { path: "/management-api/bump-mode", method: "PUT", body: JSON.stringify({ mode: "line" }) },
    ]);
    expect(line.getAttribute("variant")).toBe("primary");
    expect(requests.some(({ path }) => path.includes("fire-control"))).toBe(false);
  });
});

describe.each(["light", "dark"] as const)("A773 dashboard authority (%s)", (theme) => {
  it.each([
    ["en-GB", 390],
    ["en-GB", 1280],
    ["es-ES", 390],
    ["es-ES", 1280],
  ] as const)("keeps the retained controls accessible in %s at %i px", async (locale, width) => {
    const previousLocale = currentLocale();
    const viewport = [window.innerWidth, window.innerHeight] as const;
    onTestFinished(async () => {
      setLocale(previousLocale);
      await page.viewport(...viewport);
    });
    setLocale(locale);
    await page.viewport(width, 844);
    expect(window.innerWidth).toBe(width);
    const { api } = client();
    const { el, host } = await mountWidget<KitchenScreen>(
      "dashboard-kitchen-screen",
      { api },
      theme,
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=timing-values]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.querySelector('[data-test^="fire-"]')).toBeNull();
    expect(
      [...el.shadowRoot!.querySelectorAll("section")].map(
        (section) => section.getAttribute("aria-label") ?? section.querySelector("h2")?.textContent,
      ),
    ).toEqual([t("kitchen.bump_mode"), t("kitchen.timing_title")]);
    for (const button of el.shadowRoot!.querySelectorAll("wt-button")) {
      const native = button.shadowRoot!.querySelector("button")!;
      const box = native.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(native.disabled).toBe(false);
    }
    await expectNoA11yViolations(host);
    await page.screenshot({
      element: host,
      path: `__screenshots__/look/a773-dashboard-authority-${locale}-${theme}-${width}.png`,
    });
  });
});
