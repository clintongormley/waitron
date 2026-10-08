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
      if (state !== "schedule form") {
        // A date alone, for the field errors state: the press then explains the missing time.
        const entries: (readonly ["date" | "time", string])[] =
          state === "schedule field errors"
            ? [["date", "2026-10-08"]]
            : state === "schedule occurrence"
              ? [
                  ["date", "2026-10-25"],
                  ["time", "02:30"],
                ]
              : [
                  ["date", "2026-10-08"],
                  ["time", "08:00"],
                ];
        for (const [name, value] of entries) {
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
      if (state === "schedule field errors")
        expect(
          dialog.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="time"]')!.error,
        ).toBe("Choose a time.");
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

const MOVE_LISTED: MenuPublicationsAnswer = {
  ...LISTED,
  editions: [
    LISTED.editions[0]!,
    {
      ...LISTED.editions[0]!,
      versionId: "v-lunch-3",
      number: 3,
      activatesAt: "2026-10-09T06:00:00.000Z",
      contentHash: "3".repeat(64),
      local: { date: "2026-10-09", time: "08:00", offset: "+02:00", repeated: false },
    },
    LISTED.editions[1]!,
  ],
};

const moveStates = {
  "change time form": null,
  "change time overtaken": {
    code: "menu_publication.overtakes_queued",
    params: {
      menuId: "menu-lunch",
      overtaken: [{ versionId: "v-lunch-3", number: 3, activatesAt: "2026-10-09T06:00:00.000Z" }],
    },
  },
  "change time occurrence": scheduleStates["schedule occurrence"],
} as const;
type MoveState = keyof typeof moveStates;

describe.each(["light", "dark"] as const)("the Change time form (%s)", (theme) => {
  it.each(Object.keys(moveStates) as MoveState[])("renders %s accessibly", async (state) => {
    setLocale("en");
    const refusal = moveStates[state];
    const api = {
      getMenuPublications: vi.fn().mockResolvedValue(MOVE_LISTED),
      rescheduleMenuPublication: vi.fn().mockRejectedValue(refusal),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<MenuPublicationsPanel>(
      "dashboard-menu-publications",
      { api, menuId: "menu-lunch", menuName: "Lunch Menu" },
      theme,
    );
    await settle(el);
    el.shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>('[data-test="move-v-lunch-2"]')!
      .click();
    await settle(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
      '[data-test="schedule-dialog"]',
    )!;
    expect(dialog.open).toBe(true);
    if (refusal !== null) {
      const [date, time] =
        state === "change time occurrence" ? ["2026-10-25", "02:30"] : ["2026-10-10", "08:00"];
      for (const [name, value] of [
        ["date", date],
        ["time", time],
      ] as const) {
        const input = dialog.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
        await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
      }
      dialog.querySelector<HTMLElement>('[data-test="schedule-submit"]')!.click();
      await vi.waitFor(() =>
        expect(
          dialog.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error,
        ).not.toBe(""),
      );
    }
    if (state === "change time occurrence")
      expect(dialog.querySelector('wt-combobox[name="occurrence"]')).not.toBeNull();
    if (state === "change time overtaken")
      expect(
        dialog.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="time"]')!.error,
      ).toContain("Version 3");
    await settle(el);
    await expectNoA11yViolations(host);
  });
});

async function mountScheduling(theme: "light" | "dark") {
  setLocale("en");
  const api = {
    getMenuPublications: vi.fn(async () => LISTED),
    scheduleMenuPublication: vi.fn(),
    rescheduleMenuPublication: vi.fn(),
  } as unknown as DashboardApi;
  const { el, host } = await mountWidget<MenuPublicationsPanel>(
    "dashboard-menu-publications",
    { api, menuId: "menu-lunch", menuName: "Lunch Menu", preview: PREVIEW },
    theme,
  );
  await settle(el);
  return { el, host };
}
function scheduleForm(el: MenuPublicationsPanel): HTMLElementTagNameMap["wt-dialog"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    'wt-dialog[data-test="schedule-dialog"]',
  )!;
}
async function openSchedule(el: MenuPublicationsPanel): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="schedule-open"]')!.click();
  await settle(el);
  await scheduleForm(el).updateComplete;
}
async function openMove(el: MenuPublicationsPanel, versionId: string): Promise<void> {
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="move-${versionId}"]`)!
    .click();
  await settle(el);
  await scheduleForm(el).updateComplete;
}
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function actionState(el: MenuPublicationsPanel) {
  await el.updateComplete;
  const button = scheduleForm(el).querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="schedule-submit"]',
  )!;
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function enter(el: MenuPublicationsPanel, name: "date" | "time", value: string) {
  const input = scheduleForm(el).querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await settle(el);
}

describe.each(["light", "dark"] as const)("the schedule form's action states (%s)", (theme) => {
  it.each(["schedule", "move"] as const)("is accessible with the %s action quiet", async (kind) => {
    const { el, host } = await mountScheduling(theme);
    if (kind === "schedule") await openSchedule(el);
    else await openMove(el, "v-lunch-2");
    expect(await actionState(el)).toEqual(quiet);
    await expectNoA11yViolations(host);
  });

  it.each(["schedule", "move"] as const)(
    "is accessible with the %s action primary after a change",
    async (kind) => {
      const { el, host } = await mountScheduling(theme);
      if (kind === "schedule") await openSchedule(el);
      else await openMove(el, "v-lunch-2");
      await enter(el, "date", "2026-10-10");
      expect(await actionState(el)).toEqual(ready);
      await expectNoA11yViolations(host);
    },
  );
});
