import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi, MenuPreview } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";
import { MenuPublicationsPanel } from "./menu-publications.js";

const WARNINGS: MenuPreview["warnings"] = [
  {
    kind: "allergens_unreviewed",
    products: [
      { id: "bread", name: "Staff bread", parentName: null },
      { id: "large", name: "Large", parentName: "Soup" },
    ],
  },
];
function preview(): MenuPreview {
  return {
    hash: "draft",
    changes: [],
    warnings: structuredClone(WARNINGS),
    clashes: [],
    live: null,
    document: menuDocument([], {}),
    status: { state: "unpublished", clashes: 0 },
  };
}
const q = <T extends HTMLElement = HTMLElement>(el: MenuPublicationsPanel, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector)!;
async function field(el: MenuPublicationsPanel, name: "date" | "time", value: string) {
  const input = q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`);
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function mount(
  props: Partial<MenuPublicationsPanel> = {},
  schedule = vi
    .fn()
    .mockResolvedValue({ number: 1, versionId: "v1", activatesAt: "2030-01-01T12:00:00Z" }),
  theme: "light" | "dark" = "light",
) {
  const api = {
    getMenuPublications: vi
      .fn()
      .mockResolvedValue({ timeZone: "Europe/Madrid", live: null, editions: [] }),
    scheduleMenuPublication: schedule,
  };
  const mounted = await mountWidget<MenuPublicationsPanel>(
    "dashboard-menu-publications",
    {
      api: api as unknown as DashboardApi,
      menuId: "lunch",
      menuName: "Lunch",
      preview: preview(),
      ...props,
    },
    theme,
  );
  const { el } = mounted;
  await expect.poll(() => q(el, '[data-test="schedule-open"]')).not.toBeNull();
  await userEvent.click(q(el, '[data-test="schedule-open"]'));
  await el.updateComplete;
  await field(el, "date", "2030-01-01");
  await field(el, "time", "12:00");
  return { ...mounted, api };
}
async function submit(el: MenuPublicationsPanel) {
  await userEvent.click(q(el, '[data-test="schedule-submit"]'));
  await el.updateComplete;
}
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("es");
});

describe("scheduling with allergen warnings", () => {
  it("confirms the warning snapshot before queueing once, even after repeated activation", async () => {
    const { el, api } = await mount();
    await submit(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    const confirm = q(el, '[data-test="publish-confirm"]');
    expect(confirm).not.toBeNull();
    expect(
      [...q(el, '[data-test="publish-confirmation"]').querySelectorAll("a")].map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/manage/catalogue/product/bread", "/manage/catalogue/product/large"]);
    q(el, '[data-test="schedule-submit"]').click();
    await el.updateComplete;
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    confirm.click();
    confirm.click();
    await el.updateComplete;
    await expect.poll(() => api.scheduleMenuPublication.mock.calls.length).toBe(1);
    expect(api.scheduleMenuPublication.mock.calls).toEqual([
      ["lunch", { expectedHash: "draft", activatesAt: { date: "2030-01-01", time: "12:00" } }],
    ]);
  });
  it.each(["cancel", "Escape"])("keeps the draft and queues nothing on %s", async (how) => {
    const { el, api } = await mount();
    await submit(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(q(el, '[data-test="publish-confirmation"]')).not.toBeNull();
    if (how === "cancel") await userEvent.click(q(el, '[data-test="publish-cancel"]'));
    else await userEvent.keyboard("{Escape}");
    await closeReportsDelivered();
    await el.updateComplete;
    expect(q<HTMLElementTagNameMap["wt-dialog"]>(el, '[data-test="schedule-dialog"]').open).toBe(
      true,
    );
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, '[name="date"]').value).toBe("2030-01-01");
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, '[name="time"]').value).toBe("12:00");
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
  });
  it.each(["preview", "null", "time", "menu", "disconnect"])(
    "retires consent on %s change",
    async (what) => {
      const { el, host, api } = await mount();
      await submit(el);
      expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
      const confirm = q(el, '[data-test="publish-confirm"]');
      expect(confirm).not.toBeNull();
      if (what === "preview") el.preview = { ...preview() };
      else if (what === "null") el.preview = null;
      else if (what === "time") await field(el, "time", "13:00");
      else if (what === "menu") el.menuId = "other";
      else {
        el.remove();
        await el.updateComplete;
        host.append(el);
      }
      confirm.click();
      await el.updateComplete;
      expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    },
  );
  it("schedules directly without warnings", async () => {
    const { el, api } = await mount({ preview: { ...preview(), warnings: [] } });
    await submit(el);
    await expect.poll(() => api.scheduleMenuPublication.mock.calls.length).toBe(1);
    expect(q(el, '[data-test="publish-confirmation"]')).toBeNull();
  });
  it("requests a fresh preview after stale-hash refusal, keeps the draft and needs new consent", async () => {
    const schedule = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.changed_since_preview" })
      .mockResolvedValue({ number: 1, versionId: "v1", activatesAt: "2030-01-01T12:00:00Z" });
    const { el } = await mount({}, schedule);
    const retry = vi.fn();
    el.addEventListener("wt-preview-retry", retry);
    await submit(el);
    expect(schedule).not.toHaveBeenCalled();
    await userEvent.click(q(el, '[data-test="publish-confirm"]'));
    await expect.poll(() => retry.mock.calls.length).toBe(1);
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, '[name="date"]').value).toBe("2030-01-01");
    el.preview = { ...preview(), hash: "fresh" };
    await el.updateComplete;
    await submit(el);
    expect(schedule).toHaveBeenCalledTimes(1);
    await userEvent.click(q(el, '[data-test="publish-confirm"]'));
    await expect.poll(() => schedule.mock.calls.length).toBe(2);
    expect(schedule.mock.calls[1]![1].expectedHash).toBe("fresh");
  });
  it("ignores the previous menu's reply while the next menu's request is pending", async () => {
    let resolveFirst!: (value: unknown) => void, resolveSecond!: (value: unknown) => void;
    const schedule = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { el } = await mount({}, schedule);
    await submit(el);
    expect(schedule).not.toHaveBeenCalled();
    await userEvent.click(q(el, '[data-test="publish-confirm"]'));
    await expect.poll(() => schedule.mock.calls.length).toBe(1);
    el.menuId = "other";
    el.preview = { ...preview(), hash: "second" };
    await el.updateComplete;
    await expect.poll(() => q(el, '[data-test="schedule-open"]')).not.toBeNull();
    await userEvent.click(q(el, '[data-test="schedule-open"]'));
    await el.updateComplete;
    await field(el, "date", "2030-01-02");
    await field(el, "time", "13:00");
    await submit(el);
    await userEvent.click(q(el, '[data-test="publish-confirm"]'));
    await expect.poll(() => schedule.mock.calls.length).toBe(2);
    resolveFirst({ number: 1 });
    await schedule.mock.results[0]!.value;
    await el.updateComplete;
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="schedule-submit"]').loading).toBe(
      true,
    );
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(
        el,
        '[data-test="schedule-submit"]',
      ).shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled,
    ).toBe(true);
    expect(q<HTMLElementTagNameMap["wt-dialog"]>(el, '[data-test="schedule-dialog"]').open).toBe(
      true,
    );
    resolveSecond({ number: 2 });
    await expect
      .poll(() => q<HTMLElementTagNameMap["wt-dialog"]>(el, '[data-test="schedule-dialog"]').open)
      .toBe(false);
  });
  it.each(["light", "dark"] as const)(
    "renders the scheduled confirmation accessibly in %s",
    async (theme) => {
      const { el, host, api } = await mount({}, undefined, theme);
      await submit(el);
      expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
      expect(q(el, '[data-test="publish-confirmation"]')).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});

it.each([390, 1280])(
  "keeps long warning links inside the scheduled confirmation at %i",
  async (width) => {
    const before = { width: innerWidth, height: innerHeight };
    try {
      await page.viewport(width, 844);
      expect(innerWidth).toBe(width);
      const proposed = preview();
      proposed.warnings = [
        {
          kind: "allergens_unreviewed",
          products: [{ id: "bread", name: "Unbroken".repeat(80), parentName: null }],
        },
      ];
      const { el, api } = await mount({ preview: proposed });
      await submit(el);
      expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
      const confirmation = q<HTMLElementTagNameMap["wt-dialog"]>(
        el,
        '[data-test="publish-confirmation"]',
      );
      expect(confirmation).not.toBeNull();
      await confirmation.updateComplete;
      const bounds = confirmation.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      const link = confirmation.querySelector("a")!.getBoundingClientRect();
      expect(link.right).toBeLessThanOrEqual(bounds.right);
      expect(link.left).toBeGreaterThanOrEqual(bounds.left);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it.each(["light", "dark"] as const)(
  "paints scheduled warning links from the text token in %s",
  async (theme) => {
    const { el, host, api } = await mount({}, undefined, theme);
    host.style.setProperty("--wt-color-primary-text", "rgb(12, 34, 56)");
    await submit(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    const link = q(el, '[data-test="publish-confirmation"]').querySelector("a")!;
    expect(getComputedStyle(link).color).toBe("rgb(12, 34, 56)");
  },
);

it.each(["light", "dark"] as const)(
  "paints the ready confirmation action in its active colour in %s",
  async (theme) => {
    const { el, host, api } = await mount({}, undefined, theme);
    host.style.setProperty("--wt-color-primary", "rgb(12, 34, 56)");
    host.style.setProperty("--wt-color-primary-hover", "rgb(12, 34, 56)");
    await submit(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    const action = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish-confirm"]');
    await action.updateComplete;
    expect(action.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
    expect(getComputedStyle(action.shadowRoot!.querySelector("button")!).backgroundColor).toBe(
      "rgb(12, 34, 56)",
    );
  },
);
