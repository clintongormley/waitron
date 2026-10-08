import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, MenuPreview, MenuPublicationsAnswer } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import "./menu-publications.js";
import type { MenuPublicationsPanel } from "./menu-publications.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";

type Edition = MenuPublicationsAnswer["editions"][number];

function queued(number: number, activatesAt: string, local: Edition["local"]): Edition {
  return {
    versionId: `v-lunch-${number}`,
    number,
    state: "queued",
    activatesAt,
    queuedAt: "2026-10-07T08:00:00.000Z",
    cancelledAt: null,
    contentHash: String(number).repeat(64),
    local,
  };
}

/** v2 at an ordinary time, and v4 at the first of the two 02:30s on the day the clocks go back. */
const LISTED: MenuPublicationsAnswer = {
  timeZone: "Europe/Madrid",
  live: null,
  editions: [
    queued(2, "2026-10-08T06:00:00.000Z", {
      date: "2026-10-08",
      time: "08:00",
      offset: "+02:00",
      repeated: false,
    }),
    queued(4, "2026-10-25T00:30:00.000Z", {
      date: "2026-10-25",
      time: "02:30",
      offset: "+02:00",
      repeated: true,
    }),
  ],
};

const PREVIEW = {
  clashes: [],
  hash: "d".repeat(64),
  changes: [],
  warnings: [],
  status: { state: "unpublished", clashes: 0 },
  document: {},
  live: null,
} as unknown as MenuPreview;

function repeatedRefusal(time: string) {
  return {
    code: "menu_publication.time_repeated",
    params: {
      date: "2026-10-25",
      time,
      occurrences: [
        { at: "2026-10-25T00:15:00.000Z", offset: "+02:00" },
        { at: "2026-10-25T01:15:00.000Z", offset: "+01:00" },
      ],
    },
  };
}

function stubApi() {
  return {
    getMenuPublications: vi.fn(async () => LISTED),
    scheduleMenuPublication: vi.fn().mockResolvedValue({
      versionId: "v-lunch-5",
      number: 5,
      activatesAt: "2026-10-10T10:00:00.000Z",
    }),
    rescheduleMenuPublication: vi.fn().mockResolvedValue({
      versionId: "v-lunch-2",
      number: 2,
      activatesAt: "2026-10-08T07:00:00.000Z",
    }),
  };
}
type Api = ReturnType<typeof stubApi>;

beforeEach(() => setLocale("en"));
afterEach(async () => {
  await closeReportsDelivered();
  cleanupWidgets();
  setLocale("es-ES");
});

async function flush(el: MenuPublicationsPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")?.updateComplete;
}

async function mount(api: Api = stubApi()) {
  const { el, host } = await mountWidget<MenuPublicationsPanel>("dashboard-menu-publications", {
    api: api as unknown as DashboardApi,
    menuId: "menu-lunch",
    menuName: "Lunch Menu",
    preview: PREVIEW,
  });
  await flush(el);
  return { el, host };
}

function form(el: MenuPublicationsPanel): HTMLElementTagNameMap["wt-dialog"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    'wt-dialog[data-test="schedule-dialog"]',
  )!;
}
function action(el: MenuPublicationsPanel): HTMLElementTagNameMap["wt-button"] {
  return form(el).querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="schedule-submit"]',
  )!;
}
function field(el: MenuPublicationsPanel, name: "date" | "time") {
  return form(el).querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name="${name}"]`)!;
}
function occurrence(el: MenuPublicationsPanel) {
  return form(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="occurrence"]',
  );
}
async function bottom(el: MenuPublicationsPanel): Promise<string> {
  const actions =
    form(el).querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!;
  await actions.updateComplete;
  return actions.error;
}

async function openSchedule(el: MenuPublicationsPanel): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="schedule-open"]')!.click();
  await flush(el);
  await form(el).updateComplete;
}
async function openMove(el: MenuPublicationsPanel, versionId: string): Promise<void> {
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="move-${versionId}"]`)!
    .click();
  await flush(el);
  await form(el).updateComplete;
}

/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function actionState(el: MenuPublicationsPanel) {
  await el.updateComplete;
  const button = action(el);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const held = { variant: "primary", disabled: true, innerDisabled: true };

async function enter(el: MenuPublicationsPanel, name: "date" | "time", value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await flush(el);
}
/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: MenuPublicationsPanel): Promise<void> {
  const inner = action(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await flush(el);
  await flush(el);
}
/** A host `.click()` reaches the action's listener even while its inner button is disabled. */
async function pressHost(el: MenuPublicationsPanel): Promise<void> {
  action(el).click();
  await flush(el);
  await flush(el);
}

describe("the schedule form's Schedule", () => {
  it("opens empty with Schedule quiet and disabled, and an untouched press sends nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openSchedule(el);
    expect(field(el, "date").value).toBe("");
    expect(field(el, "time").value).toBe("");
    expect(await actionState(el)).toEqual(quiet);
    await press(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(form(el).open).toBe(true);
  });

  // With nothing typed no request could go either way, so the field errors and the bottom
  // message are what show whether the handler went past its first check.
  it("a press that reaches Schedule's handler on the untouched form marks nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openSchedule(el);
    await pressHost(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(field(el, "date").error).toBe("");
    expect(field(el, "time").error).toBe("");
    expect(await bottom(el)).toBe("");
  });

  it("one entered field makes Schedule primary and enabled, and clearing it makes it quiet again", async () => {
    const { el } = await mount();
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    expect(await actionState(el)).toEqual(ready);
    await enter(el, "date", "");
    expect(await actionState(el)).toEqual(quiet);
  });

  it("a changed form its own checks refuse keeps its errors and holds Schedule, drawn primary", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await press(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(field(el, "time").error).toBe("Choose a time.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(await actionState(el)).toEqual(held);
    await enter(el, "time", "12:00");
    expect(await actionState(el)).toEqual(ready);
  });

  it("a press after the fields are filled schedules the entered time", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    await press(el);
    expect(api.scheduleMenuPublication.mock.calls).toEqual([
      [
        "menu-lunch",
        { expectedHash: PREVIEW.hash, activatesAt: { date: "2026-10-10", time: "12:00" } },
      ],
    ]);
  });

  it("a refused schedule leaves Schedule enabled", async () => {
    const api = stubApi();
    api.scheduleMenuPublication.mockRejectedValue({
      code: "menu_publication.time_past",
      params: { activatesAt: "2026-10-07T07:59:00.000Z" },
    });
    const { el } = await mount(api);
    await openSchedule(el);
    await enter(el, "date", "2026-10-07");
    await enter(el, "time", "09:59");
    await press(el);
    expect(field(el, "time").error).toBe(codeMessage("menu_publication.time_past"));
    expect(await actionState(el)).toEqual(ready);
  });

  it("is quiet again when opened again after a change was closed", async () => {
    const { el } = await mount();
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await form(el).requestClose("cancel");
    await flush(el);
    expect(form(el).open).toBe(false);
    await openSchedule(el);
    expect(field(el, "date").value).toBe("");
    expect(await actionState(el)).toEqual(quiet);
  });

  it("Close after a change with no leave coordinator closes the form, sending nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    const reported = new Promise((resolve) =>
      form(el).addEventListener("wt-close", resolve, { once: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="schedule-close"]')!.click();
    await reported;
    await flush(el);
    expect(form(el).open).toBe(false);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
  });

  it("Escape after a change with no leave coordinator closes the form", async () => {
    const { el } = await mount();
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => form(el).open).toBe(false);
  });
});

describe("the Change time form's Change time", () => {
  it("opens on the version's stored date and time with Change time quiet and disabled, and an untouched press sends nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openMove(el, "v-lunch-2");
    expect(field(el, "date").value).toBe("2026-10-08");
    expect(field(el, "time").value).toBe("08:00");
    expect(await actionState(el)).toEqual(quiet);
    await press(el);
    await pressHost(el);
    expect(api.rescheduleMenuPublication).not.toHaveBeenCalled();
    expect(form(el).open).toBe(true);
  });

  it("a changed time makes Change time primary and enabled, and the stored time typed back makes it quiet again", async () => {
    const { el } = await mount();
    await openMove(el, "v-lunch-2");
    await enter(el, "time", "09:00");
    expect(await actionState(el)).toEqual(ready);
    await enter(el, "time", "08:00");
    expect(await actionState(el)).toEqual(quiet);
  });

  it("a press after a change moves the version to the new time", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openMove(el, "v-lunch-2");
    await enter(el, "time", "09:00");
    await press(el);
    expect(api.rescheduleMenuPublication.mock.calls).toEqual([
      ["menu-lunch", "v-lunch-2", { activatesAt: { date: "2026-10-08", time: "09:00" } }],
    ]);
  });

  it("an emptied field keeps its error and holds Change time, drawn primary", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openMove(el, "v-lunch-2");
    await enter(el, "time", "");
    await press(el);
    expect(field(el, "time").error).toBe("Choose a time.");
    expect(await actionState(el)).toEqual(held);
    expect(api.rescheduleMenuPublication).not.toHaveBeenCalled();
  });

  it("a refused move leaves Change time enabled", async () => {
    const api = stubApi();
    api.rescheduleMenuPublication.mockRejectedValue({
      code: "menu_publication.time_past",
      params: { activatesAt: "2026-10-07T07:59:00.000Z" },
    });
    const { el } = await mount(api);
    await openMove(el, "v-lunch-2");
    await enter(el, "date", "2026-10-07");
    await press(el);
    expect(field(el, "time").error).toBe(codeMessage("menu_publication.time_past"));
    expect(await actionState(el)).toEqual(ready);
  });

  // The owner's ruling (A331 batch 2a, `docs/backlog/dashboard.md` → Decisions and deliberate limits):
  // a version at one of the two 02:30s of the autumn clock change opens unchanged, so an untouched
  // press does not
  // reach the server's question of which 02:30.
  it("opens a version at a repeated time quiet, and its untouched press asks nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await openMove(el, "v-lunch-4");
    expect(field(el, "date").value).toBe("2026-10-25");
    expect(field(el, "time").value).toBe("02:30");
    expect(await actionState(el)).toEqual(quiet);
    await press(el);
    await pressHost(el);
    expect(api.rescheduleMenuPublication).not.toHaveBeenCalled();
    expect(occurrence(el)).toBeNull();
  });

  it("after a changed time the server finds repeated, holds Change time until a choice, then sends it", async () => {
    const api = stubApi();
    api.rescheduleMenuPublication
      .mockRejectedValueOnce(repeatedRefusal("02:15"))
      .mockResolvedValue({ versionId: "v-lunch-4", number: 4, activatesAt: "x" });
    const { el } = await mount(api);
    await openMove(el, "v-lunch-4");
    await enter(el, "time", "02:15");
    await press(el);
    expect(occurrence(el)).not.toBeNull();
    expect(occurrence(el)!.error).not.toBe("");
    expect(await actionState(el)).toEqual(held);
    await chooseOption(occurrence(el)!, "later");
    await flush(el);
    expect(await actionState(el)).toEqual(ready);
    await press(el);
    expect(api.rescheduleMenuPublication.mock.calls[1]).toEqual([
      "menu-lunch",
      "v-lunch-4",
      { activatesAt: { date: "2026-10-25", time: "02:15", occurrence: "later" } },
    ]);
    expect(form(el).open).toBe(false);
  });

  it("Escape after a change with no leave coordinator closes the form", async () => {
    const { el } = await mount();
    await openMove(el, "v-lunch-2");
    await enter(el, "time", "09:00");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => form(el).open).toBe(false);
  });
});
