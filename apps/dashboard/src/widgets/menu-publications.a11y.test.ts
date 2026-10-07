import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./menu-publications.js";
import type { MenuPublicationsPanel } from "./menu-publications.js";
import type { DashboardApi, MenuPublicationsAnswer } from "../api/client.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const LISTED: MenuPublicationsAnswer = {
  timeZone: "Europe/Madrid",
  live: null,
  editions: [
    {
      versionId: "v-lunch-2",
      number: 2,
      state: "queued",
      activatesAt: "2026-10-08T06:00:00.000Z",
      queuedAt: "2026-10-07T08:00:00.000Z",
      cancelledAt: null,
      contentHash: "2".repeat(64),
      local: { date: "2026-10-08", time: "08:00", offset: "+02:00", repeated: false },
    },
    {
      versionId: "v-lunch-1",
      number: 1,
      state: "cancelled",
      activatesAt: "2026-10-07T20:00:00.000Z",
      queuedAt: "2026-10-07T07:00:00.000Z",
      cancelledAt: "2026-10-07T08:00:00.000Z",
      contentHash: "1".repeat(64),
      local: { date: "2026-10-07", time: "22:00", offset: "+02:00", repeated: false },
    },
  ],
};

const states = ["empty", "loading", "failed", "listed", "cancel dialog", "cancel refused"] as const;
type State = (typeof states)[number];

function stubApi(state: State): DashboardApi {
  return {
    getMenuPublications:
      state === "loading"
        ? vi.fn(() => new Promise(() => {}))
        : state === "failed"
          ? vi.fn().mockRejectedValue({ code: "connection.failed" })
          : vi
              .fn()
              .mockResolvedValue(
                state === "empty"
                  ? { timeZone: "Europe/Madrid", live: null, editions: [] }
                  : LISTED,
              ),
    cancelMenuPublication:
      state === "cancel refused"
        ? vi.fn().mockRejectedValue({ code: "menu_publication.not_queued" })
        : vi.fn(() => new Promise(() => {})),
  } as unknown as DashboardApi;
}

async function settle(el: MenuPublicationsPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")?.updateComplete;
}

describe.each(["light", "dark"] as const)("menu publications (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    setLocale("en");
    const { el, host } = await mountWidget<MenuPublicationsPanel>(
      "dashboard-menu-publications",
      { api: stubApi(state), menuId: "menu-lunch", menuName: "Lunch Menu" },
      theme,
    );
    await settle(el);
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    if (state === "failed") expect(table.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    if (state === "loading") expect(table.loading).toBe(true);
    if (state.startsWith("cancel")) {
      const menu = table.shadowRoot!.querySelector('tr[data-row-key="v-lunch-2"] wt-row-actions')!;
      menu.querySelector<HTMLElement>('[data-test="cancel-v-lunch-2"]')!.click();
      await settle(el);
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
          '[data-test="cancel-dialog"]',
        )!.open,
      ).toBe(true);
    }
    if (state === "cancel refused") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-confirm"]')!.click();
      await vi.waitFor(() =>
        expect(
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            '[data-test="cancel-dialog"] wt-form-actions',
          )!.error,
        ).not.toBe(""),
      );
    }
    await expectNoA11yViolations(host);
  });
});
