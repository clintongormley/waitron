import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { AdjustmentsApi } from "./client.js";
import type { AdjustmentReportScreen } from "./adjustment-report-screen.js";
import "./adjustment-report-screen.js";
import {
  ALEX,
  alexEntries,
  emptyReport,
  fixtureReport,
  onePage,
} from "../../test/report-fixtures.js";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

async function settle(el: AdjustmentReportScreen): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function screen(
  theme: "light" | "dark",
  overrides: Record<string, unknown> = {},
): Promise<AdjustmentReportScreen> {
  setLocale("en");
  await mountThemed("<div></div>", theme);
  const api = {
    getReport: vi.fn().mockResolvedValue(fixtureReport()),
    listEntries: vi.fn().mockResolvedValue(onePage(alexEntries())),
    ...overrides,
  } as Record<string, unknown>;
  api.background = api;
  const el = document.createElement("dashboard-adjustment-report-screen") as AdjustmentReportScreen;
  el.api = api as unknown as AdjustmentsApi;
  host.append(el);
  await settle(el);
  return el;
}

async function openRow(el: AdjustmentReportScreen, key: string): Promise<void> {
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] .row-activate`)!
    .click();
  await settle(el);
}

const openAlex = (el: AdjustmentReportScreen) => openRow(el, ALEX);

describe.each(["light", "dark"] as const)("adjustment report accessibility (%s)", (theme) => {
  test("the report over a day with adjustments", async () => {
    const el = await screen(theme);
    expect(el.shadowRoot!.querySelector('[data-test="people"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the report over a day without any", async () => {
    const el = await screen(theme, { getReport: vi.fn().mockResolvedValue(emptyReport()) });
    expect(el.shadowRoot!.querySelector('[data-test="none"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("one person's adjustments listed", async () => {
    const el = await screen(theme);
    await openAlex(el);
    expect(el.shadowRoot!.querySelector('[data-test="entries"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="by-action-heading"]')!.textContent).toBe(
      "Alex's adjustments by action",
    );
    await expectNoA11yViolations(host);
  });

  test("the guests' adjustments listed, with their breakdowns", async () => {
    const el = await screen(theme, { listEntries: vi.fn().mockResolvedValue(onePage([])) });
    await openRow(el, "guests");
    expect(el.shadowRoot!.querySelector('[data-test="no-reasons"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="by-action-heading"]')!.textContent).toBe(
      "Guests' adjustments by action",
    );
    await expectNoA11yViolations(host);
  });

  test("a list with more to show, whose next page could not be loaded", async () => {
    const listEntries = vi.fn((_from: string, _to: string, _of: unknown, page?: object) =>
      page === undefined
        ? Promise.resolve({ entries: alexEntries(), next: "c1" })
        : Promise.reject({ code: "x" }),
    );
    const el = await screen(theme, { listEntries });
    await openAlex(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="show-more"]')!.click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('[data-test="more-error"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="show-more"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("a list that could not be loaded", async () => {
    const el = await screen(theme, { listEntries: vi.fn().mockRejectedValue({ code: "x" }) });
    await openAlex(el);
    await expectNoA11yViolations(host);
  });

  test("a report that could not be loaded", async () => {
    const el = await screen(theme, { getReport: vi.fn().mockRejectedValue({ code: "x" }) });
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("a range that runs backwards", async () => {
    const el = await screen(theme);
    const from = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      'wt-input[name="from"]',
    )!;
    const box = from.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    box.value = "2026-09-30";
    box.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(el);
    expect(from.error).not.toBe("");
    await expectNoA11yViolations(host);
  });
});
