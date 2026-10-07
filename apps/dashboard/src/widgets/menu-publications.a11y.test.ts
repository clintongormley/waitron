import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./menu-publications.js";
import type { MenuPublicationsPanel } from "./menu-publications.js";
import type { DashboardApi, MenuPreview, MenuPublicationsAnswer } from "../api/client.js";
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

const PREVIEW = {
  clashes: [],
  hash: "d".repeat(64),
  changes: [],
  warnings: [],
  status: {
    state: "changed",
    clashes: 0,
    version: 1,
    publishedAt: "2026-10-07T08:00:00.000Z",
    hash: "1".repeat(64),
  },
  document: {},
  live: null,
} as unknown as MenuPreview;

const scheduleStates = {
  "schedule form": null,
  "schedule field errors": null,
  "schedule overtaken": {
    code: "menu_publication.overtakes_queued",
    params: {
      menuId: "menu-lunch",
      overtaken: [{ versionId: "v-lunch-2", number: 2, activatesAt: "2026-10-08T06:00:00.000Z" }],
    },
  },
  "schedule occurrence": {
    code: "menu_publication.time_repeated",
    params: {
      date: "2026-10-25",
      time: "02:30",
      occurrences: [
        { at: "2026-10-25T00:30:00.000Z", offset: "+02:00" },
        { at: "2026-10-25T01:30:00.000Z", offset: "+01:00" },
      ],
    },
  },
} as const;
type ScheduleState = keyof typeof scheduleStates;

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

describe.each(["light", "dark"] as const)("the schedule form (%s)", (theme) => {
  it.each(Object.keys(scheduleStates) as ScheduleState[])(
    "renders %s accessibly",
    async (state) => {
      setLocale("en");
      const refusal = scheduleStates[state];
      const api = {
        getMenuPublications: vi.fn().mockResolvedValue(LISTED),
        scheduleMenuPublication: vi.fn().mockRejectedValue(refusal),
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<MenuPublicationsPanel>(
        "dashboard-menu-publications",
        { api, menuId: "menu-lunch", menuName: "Lunch Menu", preview: PREVIEW },
        theme,
      );
      await settle(el);
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="schedule-open"]')!.click();
      await settle(el);
      const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
        '[data-test="schedule-dialog"]',
      )!;
      expect(dialog.open).toBe(true);
      const submit = dialog.querySelector<HTMLElement>('[data-test="schedule-submit"]')!;
      if (refusal !== null) {
        const [date, time] =
          state === "schedule occurrence" ? ["2026-10-25", "02:30"] : ["2026-10-08", "08:00"];
        for (const [name, value] of [
          ["date", date],
          ["time", time],
        ] as const) {
          const input = dialog.querySelector<HTMLElementTagNameMap["wt-input"]>(
            `[name="${name}"]`,
          )!;
          await userEvent.fill(
            page.elementLocator(input.shadowRoot!.querySelector("input")!),
            value,
          );
        }
      }
      if (state !== "schedule form") {
        submit.click();
        await vi.waitFor(() =>
          expect(
            dialog.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
              .error,
          ).not.toBe(""),
        );
      }
      if (state === "schedule occurrence")
        expect(dialog.querySelector('wt-combobox[name="occurrence"]')).not.toBeNull();
      if (state === "schedule overtaken")
        expect(
          dialog.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="time"]')!.error,
        ).toContain("Version 2");
      await settle(el);
      await expectNoA11yViolations(host);
    },
  );
});
