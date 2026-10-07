import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { DataTableColumn } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./menu-publications.js";
import { overtakeSentence, type MenuPublicationsPanel } from "./menu-publications.js";
import type {
  ActivationTime,
  DashboardApi,
  MenuPreview,
  MenuPublicationsAnswer,
} from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

type Edition = MenuPublicationsAnswer["editions"][number];

function edition(
  number: number,
  state: Edition["state"],
  activatesAt: string,
  local: Partial<Edition["local"]> & { date: string; time: string },
): Edition {
  return {
    versionId: `v-lunch-${number}`,
    number,
    state,
    activatesAt,
    queuedAt: "2026-10-07T08:00:00.000Z",
    cancelledAt: state === "cancelled" ? "2026-10-07T08:30:00.000Z" : null,
    contentHash: String(number).repeat(64),
    local: { offset: "+02:00", repeated: false, ...local },
  };
}

/** As the route lists them: the queued editions soonest first, then the settled ones. */
function queue(): MenuPublicationsAnswer {
  return {
    timeZone: "Europe/Madrid",
    live: {
      versionId: "v-lunch-1",
      number: 1,
      since: "2026-10-07T08:00:00.000Z",
      local: { date: "2026-10-07", time: "10:00", offset: "+02:00", repeated: false },
    },
    editions: [
      edition(2, "queued", "2026-10-08T06:00:00.000Z", { date: "2026-10-08", time: "08:00" }),
      edition(4, "queued", "2026-10-25T01:30:00.000Z", {
        date: "2026-10-25",
        time: "02:30",
        offset: "+01:00",
        repeated: true,
      }),
      edition(3, "cancelled", "2026-10-09T06:00:00.000Z", { date: "2026-10-09", time: "08:00" }),
      edition(1, "activated", "2026-10-07T08:00:00.000Z", { date: "2026-10-07", time: "10:00" }),
    ],
  };
}

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  return {
    getMenuPublications: vi.fn(async () => queue()),
    cancelMenuPublication: vi.fn().mockResolvedValue(undefined),
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
    ...overrides,
  } as unknown as DashboardApi & {
    getMenuPublications: ReturnType<typeof vi.fn>;
    cancelMenuPublication: ReturnType<typeof vi.fn>;
    scheduleMenuPublication: ReturnType<typeof vi.fn>;
    rescheduleMenuPublication: ReturnType<typeof vi.fn>;
  };
}

const DRAFT_HASH = "d".repeat(64);

/** The open menu's preview: no clashes, v1 live, and a draft unlike every listed edition. */
function draftPreview(overrides: Partial<MenuPreview> = {}): MenuPreview {
  return {
    clashes: [],
    hash: DRAFT_HASH,
    changes: [],
    warnings: [],
    status: {
      state: "changed",
      clashes: 0,
      version: 1,
      publishedAt: "2026-10-07T08:00:00.000Z",
      hash: "1".repeat(64),
    },
    document: {} as MenuPreview["document"],
    live: null,
    ...overrides,
  };
}

async function flush(el: MenuPublicationsPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table");
  if (table) await table.updateComplete;
}

async function mount(
  api: DashboardApi = stubApi(),
  props: Partial<MenuPublicationsPanel> = {},
): Promise<MenuPublicationsPanel> {
  const { el } = await mountWidget<MenuPublicationsPanel>("dashboard-menu-publications", {
    api,
    menuId: "menu-lunch",
    menuName: "Lunch Menu",
    ...props,
  });
  await flush(el);
  return el;
}

function table(el: MenuPublicationsPanel) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="editions"]',
  )!;
}

function cell(el: MenuPublicationsPanel, testId: string): string | null {
  const found = table(el).shadowRoot!.querySelector(`[data-test="${testId}"]`);
  return found === null ? null : found.textContent!.replace(/\s+/g, " ").trim();
}

function rowMenu(el: MenuPublicationsPanel, versionId: string) {
  return table(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `tr[data-row-key="${versionId}"] wt-row-actions`,
  );
}

function dialog(el: MenuPublicationsPanel): HTMLElementTagNameMap["wt-dialog"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    'wt-dialog[data-test="cancel-dialog"]',
  )!;
}

function inShadow(el: MenuPublicationsPanel, testId: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`);
}

async function openCancel(el: MenuPublicationsPanel, versionId = "v-lunch-2"): Promise<void> {
  rowMenu(el, versionId)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  rowMenu(el, versionId)!.querySelector<HTMLElement>(`[data-test="cancel-${versionId}"]`)!.click();
  await flush(el);
}

async function messageIn(confirmation: HTMLElementTagNameMap["wt-dialog"]): Promise<string> {
  return (
    (await formMessageOf(confirmation.querySelector("wt-form-actions")!))?.textContent?.trim() ?? ""
  );
}

beforeEach(() => {
  setLocale("en");
});
afterEach(async () => {
  await closeReportsDelivered();
  cleanupWidgets();
  setLocale("es-ES");
});

describe("a menu's scheduled versions", () => {
  it("reads the open menu's editions and lists each with its venue-local time and state", async () => {
    const api = stubApi();
    const el = await mount(api);
    expect(api.getMenuPublications).toHaveBeenCalledWith("menu-lunch");
    expect(cell(el, "version-v-lunch-2")).toBe("Version 2");
    expect(cell(el, "time-v-lunch-2")).toBe("8 Oct 2026, 08:00");
    expect(cell(el, "state-v-lunch-2")).toBe("Scheduled");
    expect(cell(el, "time-v-lunch-4")).toBe("25 Oct 2026, 02:30 (UTC+01:00)");
    expect(cell(el, "state-v-lunch-4")).toBe("Scheduled");
    expect(cell(el, "version-v-lunch-3")).toBe("Version 3");
    expect(cell(el, "time-v-lunch-3")).toBe("9 Oct 2026, 08:00");
    expect(cell(el, "state-v-lunch-3")).toBe("Cancelled");
    expect(cell(el, "state-v-lunch-1")).toBe("Activated");
    expect(
      [...table(el).shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
        row.getAttribute("data-row-key"),
      ),
    ).toEqual(["v-lunch-2", "v-lunch-4", "v-lunch-3", "v-lunch-1"]);
  });

  it("lists them in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    expect(cell(el, "version-v-lunch-2")).toBe("Versión 2");
    expect(cell(el, "time-v-lunch-2")).toBe("8 oct 2026, 08:00");
    expect(cell(el, "state-v-lunch-2")).toBe("Programada");
    expect(cell(el, "time-v-lunch-4")).toBe("25 oct 2026, 02:30 (UTC+01:00)");
    expect(cell(el, "state-v-lunch-3")).toBe("Cancelada");
    expect(cell(el, "state-v-lunch-1")).toBe("Activada");
  });

  it("keeps a row menu, pinned at the end, on the queued rows alone", async () => {
    const el = await mount();
    const columns = table(el).columns as DataTableColumn<unknown>[];
    expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    for (const queued of ["v-lunch-2", "v-lunch-4"]) {
      const menu = rowMenu(el, queued)!;
      expect(menu.querySelector(`[data-test="cancel-${queued}"]`)!.textContent!.trim()).toBe(
        "Cancel this version",
      );
    }
    expect(rowMenu(el, "v-lunch-2")!.getAttribute("label")).toBe("Actions: Version 2");
    expect(rowMenu(el, "v-lunch-3")).toBeNull();
    expect(rowMenu(el, "v-lunch-1")).toBeNull();
  });

  it("mutes the state of a settled version and leaves a queued one in the text colour", async () => {
    const el = await mount();
    const colour = (testId: string) =>
      getComputedStyle(table(el).shadowRoot!.querySelector(`[data-test="${testId}"]`)!).color;
    const probe = document.createElement("span");
    el.shadowRoot!.append(probe);
    probe.style.color = "var(--wt-color-text-muted)";
    const muted = getComputedStyle(probe).color;
    probe.style.color = "var(--wt-color-text)";
    const text = getComputedStyle(probe).color;
    probe.remove();
    expect(muted).not.toBe(text);
    expect(colour("state-v-lunch-3")).toBe(muted);
    expect(colour("state-v-lunch-1")).toBe(muted);
    expect(colour("state-v-lunch-2")).toBe(text);
  });

  it("keeps the Actions heading on one line inside text that may break anywhere", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<MenuPublicationsPanel>("dashboard-menu-publications", {
      api,
      menuId: "menu-lunch",
      menuName: "Lunch Menu",
    });
    host.style.overflowWrap = "anywhere";
    await flush(el);
    const heading = table(el).shadowRoot!.querySelector("th[data-actions]")!;
    const words = document.createRange();
    words.selectNodeContents(heading);
    expect(heading.textContent!.trim()).toBe("Actions");
    expect(new Set([...words.getClientRects()].map((rect) => Math.round(rect.top))).size).toBe(1);
  });

  it("asks before cancelling, and Keep it sends nothing", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openCancel(el);
    expect(dialog(el).open).toBe(true);
    expect(inShadow(el, "cancel-question")!.textContent!.trim()).toBe(
      "Cancel version 2, scheduled for 8 Oct 2026, 08:00? Its number is not used again.",
    );
    inShadow(el, "cancel-keep")!.click();
    await flush(el);
    expect(dialog(el).open).toBe(false);
    expect(api.cancelMenuPublication).not.toHaveBeenCalled();
  });

  it("asks in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    await openCancel(el);
    expect(inShadow(el, "cancel-question")!.textContent!.trim()).toBe(
      "¿Cancelar la versión 2, programada para el 8 oct 2026, 08:00? Su número no se vuelve a usar.",
    );
  });

  it("cancels the version once on confirmation, closes the dialog and reads the list again", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await flush(el);
    expect(api.cancelMenuPublication.mock.calls).toEqual([["menu-lunch", "v-lunch-2"]]);
    expect(dialog(el).open).toBe(false);
    expect(api.getMenuPublications).toHaveBeenCalledTimes(2);
  });

  it("closes the dialog after a cancel whose list read then fails, and shows that as a load failure", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(queue())
      .mockRejectedValue({ code: "connection.failed" });
    const api = stubApi({ getMenuPublications: read });
    const el = await mount(api);
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await flush(el);
    expect(api.cancelMenuPublication).toHaveBeenCalledTimes(1);
    expect(dialog(el).open).toBe(false);
    expect(table(el).errorMessage).toBe(codeMessage("connection.failed"));
    expect(inShadow(el, "editions-retry")).not.toBeNull();
  });

  it("hands focus back to the row menu after Keep it, and to the heading after a cancel", async () => {
    const el = await mount();
    await openCancel(el);
    inShadow(el, "cancel-keep")!.click();
    await flush(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const trigger = rowMenu(el, "v-lunch-2")!.shadowRoot!.querySelector("button")!;
    expect(rowMenu(el, "v-lunch-2")!.shadowRoot!.activeElement).toBe(trigger);
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("h2"));
  });

  it("closes on Escape, sending nothing", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openCancel(el);
    dialog(el).shadowRoot!.querySelector("dialog")!.close();
    await closeReportsDelivered();
    await flush(el);
    expect(dialog(el).open).toBe(false);
    expect(api.cancelMenuPublication).not.toHaveBeenCalled();
  });

  it("sends one cancel however often the confirmation is pressed while it is out", async () => {
    let answer!: () => void;
    const api = stubApi({
      cancelMenuPublication: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const el = await mount(api);
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    expect(api.cancelMenuPublication).toHaveBeenCalledTimes(1);
    answer();
    await flush(el);
    await flush(el);
    expect(dialog(el).open).toBe(false);
  });

  it("drops a list that arrives for a menu it no longer follows, and waits for the new one", async () => {
    let lunch!: (value: MenuPublicationsAnswer) => void;
    let dinner!: (value: MenuPublicationsAnswer) => void;
    const read = vi.fn(
      (menuId: string) =>
        new Promise<MenuPublicationsAnswer>((resolve) => {
          if (menuId === "menu-lunch") lunch = resolve;
          else dinner = resolve;
        }),
    );
    const el = await mount(stubApi({ getMenuPublications: read }));
    el.menuId = "menu-dinner";
    await flush(el);
    await flush(el);
    lunch(queue());
    await flush(el);
    expect(cell(el, "version-v-lunch-2")).toBeNull();
    expect(table(el).loading).toBe(true);
    dinner({ timeZone: "Europe/Madrid", live: null, editions: [] });
    await flush(el);
    await flush(el);
    expect(table(el).loading).toBe(false);
    expect(table(el).shadowRoot!.textContent).toContain("No versions are scheduled.");
  });

  it("does not show the list read after a cancel once it follows another menu", async () => {
    let refreshed!: (value: MenuPublicationsAnswer) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce(queue())
      .mockImplementationOnce(
        () => new Promise<MenuPublicationsAnswer>((resolve) => (refreshed = resolve)),
      )
      .mockResolvedValue({ timeZone: "Europe/Madrid", live: null, editions: [] });
    const el = await mount(stubApi({ getMenuPublications: read }));
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    el.menuId = "menu-dinner";
    await flush(el);
    await flush(el);
    refreshed(queue());
    await flush(el);
    expect(read.mock.calls).toEqual([["menu-lunch"], ["menu-lunch"], ["menu-dinner"]]);
    expect(cell(el, "version-v-lunch-2")).toBeNull();
  });

  it("clears a failed re-read's error once a later live read succeeds", async () => {
    const live = new LiveData();
    const read = vi
      .fn()
      .mockResolvedValueOnce(queue())
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue(queue());
    const el = await mount(stubApi({ liveData: live, getMenuPublications: read }));
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await flush(el);
    expect(table(el).errorMessage).toBe(codeMessage("connection.failed"));
    live.invalidate([{ type: "menu_scheduled_publications" }]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    await flush(el);
    await flush(el);
    expect(table(el).errorMessage).toBe("");
    expect(inShadow(el, "editions-retry")).toBeNull();
    expect(cell(el, "version-v-lunch-2")).toBe("Version 2");
  });

  it.each(["menu_publication.not_queued", "menu_publication.not_found"])(
    "reads the list again after a %s refusal, keeping the dialog and its sentence",
    async (code) => {
      const settled = queue();
      settled.editions[0] = { ...settled.editions[0]!, state: "activated" };
      const read = vi.fn().mockResolvedValueOnce(queue()).mockResolvedValue(settled);
      const api = stubApi({
        getMenuPublications: read,
        cancelMenuPublication: vi.fn().mockRejectedValue({ code, params: {} }),
      });
      const el = await mount(api);
      await openCancel(el);
      inShadow(el, "cancel-confirm")!.click();
      await flush(el);
      await flush(el);
      expect(read).toHaveBeenCalledTimes(2);
      expect(cell(el, "state-v-lunch-2")).toBe("Activated");
      expect(rowMenu(el, "v-lunch-2")).toBeNull();
      expect(dialog(el).open).toBe(true);
      expect(await messageIn(dialog(el))).toBe(codeMessage(code));
    },
  );

  it("keeps the dialog's refusal when a live read succeeds after it", async () => {
    const live = new LiveData();
    const api = stubApi({
      liveData: live,
      cancelMenuPublication: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await mount(api);
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await flush(el);
    live.invalidate([{ type: "menu_scheduled_publications" }]);
    await vi.waitFor(() => expect(api.getMenuPublications).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(dialog(el).open).toBe(true);
    expect(await messageIn(dialog(el))).toBe(codeMessage("connection.failed"));
  });

  it("follows another menu when it is given one, dropping the first menu's list", async () => {
    const other = { timeZone: "Europe/Madrid", live: null, editions: [] };
    const read = vi.fn(async (menuId: string) => (menuId === "menu-lunch" ? queue() : other));
    const el = await mount(stubApi({ getMenuPublications: read }));
    expect(cell(el, "version-v-lunch-2")).toBe("Version 2");
    el.menuId = "menu-dinner";
    await flush(el);
    await flush(el);
    expect(read).toHaveBeenLastCalledWith("menu-dinner");
    expect(cell(el, "version-v-lunch-2")).toBeNull();
    expect(table(el).shadowRoot!.textContent).toContain("No versions are scheduled.");
  });

  it("shows a refusal at the end of the dialog and keeps it open", async () => {
    const api = stubApi({
      cancelMenuPublication: vi.fn().mockRejectedValue({
        code: "menu_publication.not_queued",
        params: { menuId: "menu-lunch", versionId: "v-lunch-2", state: "activated" },
      }),
    });
    const el = await mount(api);
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await flush(el);
    expect(api.cancelMenuPublication).toHaveBeenCalledTimes(1);
    expect(dialog(el).open).toBe(true);
    expect(await messageIn(dialog(el))).toBe(codeMessage("menu_publication.not_queued"));
  });

  it("says so when nothing is scheduled", async () => {
    const el = await mount(
      stubApi({
        getMenuPublications: vi.fn(async () => ({
          timeZone: "Europe/Madrid",
          live: null,
          editions: [],
        })),
      }),
    );
    expect(table(el).emptyMessage).toBe("No versions are scheduled.");
    expect(table(el).shadowRoot!.textContent).toContain("No versions are scheduled.");
  });

  it("shows a failed read with Try again, which reads the list again", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu_publication.clock_unreadable", params: {} })
      .mockResolvedValue(queue());
    const el = await mount(stubApi({ getMenuPublications: read }));
    expect(table(el).errorMessage).toBe(codeMessage("menu_publication.clock_unreadable"));
    inShadow(el, "editions-retry")!.click();
    await flush(el);
    await flush(el);
    expect(read).toHaveBeenCalledTimes(2);
    expect(table(el).errorMessage).toBe("");
    expect(inShadow(el, "editions-retry")).toBeNull();
    expect(cell(el, "version-v-lunch-2")).toBe("Version 2");
  });

  it("reads the list again when the schedule changes", async () => {
    const live = new LiveData();
    let answer = queue();
    const read = vi.fn(async () => answer);
    const el = await mount(stubApi({ liveData: live, getMenuPublications: read }));
    expect(cell(el, "state-v-lunch-2")).toBe("Scheduled");
    answer = queue();
    answer.editions[0] = { ...answer.editions[0]!, state: "cancelled" };
    live.invalidate([{ type: "menu_scheduled_publications" }]);
    await vi.waitFor(() => expect(cell(el, "state-v-lunch-2")).toBe("Cancelled"));
    expect(read).toHaveBeenCalledTimes(2);
  });
});

const OVERTAKES = "menu_publication.overtakes_queued";
const V2_IN_THE_WAY = {
  versionId: "v-lunch-2",
  number: 2,
  activatesAt: "2026-10-08T06:00:00.000Z",
};
const V3_IN_THE_WAY = {
  versionId: "v-lunch-3",
  number: 3,
  activatesAt: "2026-10-09T06:00:00.000Z",
};
const V4_IN_THE_WAY = {
  versionId: "v-lunch-4",
  number: 4,
  activatesAt: "2026-10-25T01:30:00.000Z",
};
const REPEATED = {
  code: "menu_publication.time_repeated",
  params: {
    date: "2026-10-25",
    time: "02:30",
    occurrences: [
      { at: "2026-10-25T00:30:00.000Z", offset: "+02:00" },
      { at: "2026-10-25T01:30:00.000Z", offset: "+01:00" },
    ],
  },
};

type Field = HTMLElementTagNameMap["wt-input"];
type Choice = HTMLElementTagNameMap["wt-combobox"];

function scheduleDialog(el: MenuPublicationsPanel): HTMLElementTagNameMap["wt-dialog"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    'wt-dialog[data-test="schedule-dialog"]',
  )!;
}

function field(el: MenuPublicationsPanel, name: "date" | "time"): Field {
  return scheduleDialog(el).querySelector<Field>(`wt-input[name="${name}"]`)!;
}

function occurrence(el: MenuPublicationsPanel): Choice | null {
  return scheduleDialog(el).querySelector<Choice>('wt-combobox[name="occurrence"]');
}

function submitButton(el: MenuPublicationsPanel): HTMLElementTagNameMap["wt-button"] {
  return scheduleDialog(el).querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="schedule-submit"]',
  )!;
}

async function openSchedule(el: MenuPublicationsPanel): Promise<void> {
  inShadow(el, "schedule-open")!.click();
  await flush(el);
  await scheduleDialog(el).updateComplete;
}

async function enter(el: MenuPublicationsPanel, name: "date" | "time", value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await flush(el);
}

async function submit(el: MenuPublicationsPanel): Promise<void> {
  submitButton(el).click();
  await flush(el);
  await flush(el);
  await flush(el);
}

async function bottom(el: MenuPublicationsPanel): Promise<string> {
  return messageIn(scheduleDialog(el));
}

/** Opens the form on a draft unlike every edition, enters the time and submits it. */
async function scheduleAt(
  api: ReturnType<typeof stubApi>,
  date: string,
  time: string,
): Promise<MenuPublicationsPanel> {
  const el = await mount(api, { preview: draftPreview() });
  await openSchedule(el);
  await enter(el, "date", date);
  await enter(el, "time", time);
  await submit(el);
  return el;
}

describe("scheduling a publication", () => {
  it("opens a form with a required date and a required time, both marked", async () => {
    const el = await mount(stubApi(), { preview: draftPreview() });
    expect(inShadow(el, "schedule-open")!.textContent!.trim()).toBe("Schedule a publication…");
    await openSchedule(el);
    expect(scheduleDialog(el).open).toBe(true);
    for (const [name, type, label] of [
      ["date", "date", "Date"],
      ["time", "time", "Time"],
    ] as const) {
      const input = field(el, name);
      expect(input.type).toBe(type);
      expect(input.label).toBe(label);
      expect(input.required).toBe(true);
      expect(input.shadowRoot!.querySelector("label [data-required]")).not.toBeNull();
      expect(input.shadowRoot!.querySelector("input")!.name).toBe(name);
    }
    expect(occurrence(el)).toBeNull();
    expect(submitButton(el).textContent!.trim()).toBe("Schedule");
    expect(submitButton(el).disabled).toBe(false);
    expect(await bottom(el)).toBe("");
  });

  it("explains empty fields beside each and at the bottom, focuses the first, and holds the action until both are filled", async () => {
    const api = stubApi();
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await submit(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(field(el, "date").error).toBe("Choose a date.");
    expect(field(el, "time").error).toBe("Choose a time.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(el.shadowRoot!.activeElement).toBe(field(el, "date"));
    expect(submitButton(el).disabled).toBe(true);
    await enter(el, "date", "2026-10-10");
    expect(field(el, "date").error).toBe("");
    expect(field(el, "time").error).toBe("Choose a time.");
    expect(submitButton(el).disabled).toBe(true);
    await enter(el, "time", "12:00");
    expect(field(el, "time").error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(submitButton(el).disabled).toBe(false);
  });

  it("schedules the previewed menu once at the entered venue time, closes, and reads the list again", async () => {
    const api = stubApi();
    const el = await scheduleAt(api, "2026-10-10", "12:00");
    expect(api.scheduleMenuPublication.mock.calls).toEqual([
      [
        "menu-lunch",
        { expectedHash: DRAFT_HASH, activatesAt: { date: "2026-10-10", time: "12:00" } },
      ],
    ]);
    expect(scheduleDialog(el).open).toBe(false);
    expect(api.getMenuPublications).toHaveBeenCalledTimes(2);
  });

  it("schedules on Enter in a field", async () => {
    const api = stubApi();
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    await userEvent.keyboard("{Enter}");
    await flush(el);
    await flush(el);
    expect(api.scheduleMenuPublication).toHaveBeenCalledTimes(1);
    expect(scheduleDialog(el).open).toBe(false);
  });

  it("sends one schedule however often the action is pressed while it is out", async () => {
    let answer!: (value: unknown) => void;
    const api = stubApi({
      scheduleMenuPublication: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    submitButton(el).click();
    submitButton(el).click();
    await flush(el);
    expect(api.scheduleMenuPublication).toHaveBeenCalledTimes(1);
    answer({ versionId: "v-lunch-5", number: 5, activatesAt: "2026-10-10T10:00:00.000Z" });
    await flush(el);
    await flush(el);
    expect(scheduleDialog(el).open).toBe(false);
  });

  it.each([
    [
      "en",
      "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move it earlier, then try again.",
      "Correct the highlighted fields to continue.",
    ],
    [
      "es-ES",
      "La versión 2, programada para el 8 oct 2026, 08:00, debe publicarse antes. Cancélala o adelántala y vuelve a intentarlo.",
      "Corrige los campos marcados para continuar.",
    ],
  ])(
    "names the version in the way under the time field when a schedule would overtake it (%s)",
    async (locale, sentence, fix) => {
      setLocale(locale);
      const api = stubApi({
        scheduleMenuPublication: vi.fn().mockRejectedValue({
          code: OVERTAKES,
          params: { menuId: "menu-lunch", overtaken: [V2_IN_THE_WAY] },
        }),
      });
      const el = await scheduleAt(api, "2026-10-08", "08:00");
      expect(api.scheduleMenuPublication).toHaveBeenCalledTimes(1);
      expect(api.getMenuPublications).toHaveBeenCalledTimes(2);
      expect(field(el, "time").error).toBe(sentence);
      expect(field(el, "date").error).toBe("");
      expect(await bottom(el)).toBe(fix);
      expect(field(el, "date").value).toBe("2026-10-08");
      expect(field(el, "time").value).toBe("08:00");
      expect(scheduleDialog(el).open).toBe(true);
      expect(submitButton(el).disabled).toBe(false);
      expect(api.cancelMenuPublication).not.toHaveBeenCalled();
      expect(
        [...scheduleDialog(el).querySelectorAll("wt-button")].map((button) =>
          button.getAttribute("data-test"),
        ),
      ).toEqual(["schedule-close", "schedule-submit"]);
      await enter(el, "time", "07:00");
      expect(field(el, "time").error).toBe("");
      expect(await bottom(el)).toBe("");
    },
  );

  it("names every version in the way in one sentence when there are several", async () => {
    const listed = queue();
    listed.editions[2] = { ...listed.editions[2]!, state: "queued", cancelledAt: null };
    const api = stubApi({
      getMenuPublications: vi.fn(async () => listed),
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: OVERTAKES,
        params: { menuId: "menu-lunch", overtaken: [V2_IN_THE_WAY, V3_IN_THE_WAY] },
      }),
    });
    const el = await scheduleAt(api, "2026-10-08", "07:00");
    expect(field(el, "time").error).toBe(
      "Versions 2 (8 Oct 2026, 08:00) and 3 (9 Oct 2026, 08:00) must go live first. Cancel them or move them earlier, then try again.",
    );
  });

  it("falls back to the code's sentence when the list cannot be read after the refusal", async () => {
    const api = stubApi({
      getMenuPublications: vi
        .fn()
        .mockResolvedValueOnce(queue())
        .mockRejectedValue({ code: "connection.failed" }),
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: OVERTAKES,
        params: { menuId: "menu-lunch", overtaken: [V2_IN_THE_WAY] },
      }),
    });
    const el = await scheduleAt(api, "2026-10-08", "08:00");
    expect(api.getMenuPublications).toHaveBeenCalledTimes(2);
    expect(field(el, "time").error).toBe(codeMessage(OVERTAKES));
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(submitButton(el).disabled).toBe(false);
  });

  it("falls back to the code's sentence when the list read after the refusal no longer has the version", async () => {
    const changed = queue();
    changed.editions.shift();
    const api = stubApi({
      getMenuPublications: vi.fn().mockResolvedValueOnce(queue()).mockResolvedValue(changed),
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: OVERTAKES,
        params: { menuId: "menu-lunch", overtaken: [V2_IN_THE_WAY] },
      }),
    });
    const el = await scheduleAt(api, "2026-10-08", "08:00");
    expect(field(el, "time").error).toBe(codeMessage(OVERTAKES));
  });

  it.each([
    ["en", "The clock skips 02:30 on 28 Mar 2027. Choose another time."],
    ["es-ES", "El reloj se salta las 02:30 el 28 mar 2027. Elige otra hora."],
  ])("says under the time field when the venue clock skips it (%s)", async (locale, sentence) => {
    setLocale(locale);
    const api = stubApi({
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: "menu_publication.time_skipped",
        params: { date: "2027-03-28", time: "02:30" },
      }),
    });
    const el = await scheduleAt(api, "2027-03-28", "02:30");
    expect(field(el, "time").error).toBe(sentence);
    expect(submitButton(el).disabled).toBe(false);
  });

  it("says under the time field when the time has passed", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: "menu_publication.time_past",
        params: { activatesAt: "2026-10-07T07:59:00.000Z" },
      }),
    });
    const el = await scheduleAt(api, "2026-10-07", "09:59");
    expect(field(el, "time").error).toBe(codeMessage("menu_publication.time_past"));
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(submitButton(el).disabled).toBe(false);
  });

  it.each(["menu.changed_since_preview", "menu_publication.unchanged"])(
    "shows a %s refusal in the bottom message alone",
    async (code) => {
      const api = stubApi({
        scheduleMenuPublication: vi.fn().mockRejectedValue({ code, params: {} }),
      });
      const el = await scheduleAt(api, "2026-10-10", "12:00");
      expect(field(el, "date").error).toBe("");
      expect(field(el, "time").error).toBe("");
      expect(await bottom(el)).toBe(codeMessage(code));
      expect(scheduleDialog(el).open).toBe(true);
      expect(submitButton(el).disabled).toBe(false);
    },
  );

  it("asks which of a repeated time, holds the action until one is chosen, and sends the choice", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValueOnce(REPEATED)
        .mockResolvedValue({ versionId: "v-lunch-5", number: 5, activatesAt: "x" }),
    });
    const el = await scheduleAt(api, "2026-10-25", "02:30");
    const choice = occurrence(el)!;
    expect(choice).not.toBeNull();
    expect(choice.required).toBe(true);
    expect(choice.options).toEqual([
      { value: "earlier", label: "First 02:30 (UTC+02:00)" },
      { value: "later", label: "Second 02:30 (UTC+01:00)" },
    ]);
    expect(choice.error).toBe(
      "02:30 happens twice on 25 Oct 2026, because the clocks go back. Choose which.",
    );
    expect(field(el, "time").error).toBe("");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(submitButton(el).disabled).toBe(true);
    await chooseOption(choice, "later");
    await flush(el);
    expect(occurrence(el)!.error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(submitButton(el).disabled).toBe(false);
    await submit(el);
    expect(api.scheduleMenuPublication.mock.calls[1]).toEqual([
      "menu-lunch",
      {
        expectedHash: DRAFT_HASH,
        activatesAt: { date: "2026-10-25", time: "02:30", occurrence: "later" },
      },
    ]);
    expect(scheduleDialog(el).open).toBe(false);
  });

  it.each(["date", "time"] as const)(
    "removes the choice of a repeated time when the %s changes",
    async (name) => {
      const api = stubApi({ scheduleMenuPublication: vi.fn().mockRejectedValue(REPEATED) });
      const el = await scheduleAt(api, "2026-10-25", "02:30");
      expect(occurrence(el)).not.toBeNull();
      await enter(el, name, name === "date" ? "2026-10-26" : "03:30");
      expect(occurrence(el)).toBeNull();
      expect(submitButton(el).disabled).toBe(false);
      await submit(el);
      expect(api.scheduleMenuPublication.mock.calls[1]![1].activatesAt).not.toHaveProperty(
        "occurrence",
      );
    },
  );

  it("offers the repeated time's two choices in Spanish", async () => {
    setLocale("es-ES");
    const api = stubApi({ scheduleMenuPublication: vi.fn().mockRejectedValue(REPEATED) });
    const el = await scheduleAt(api, "2026-10-25", "02:30");
    expect(occurrence(el)!.options.map((option) => option.label)).toEqual([
      "Primera 02:30 (UTC+02:00)",
      "Segunda 02:30 (UTC+01:00)",
    ]);
  });

  it("offers no schedule without a preview, while the preview has clashes, or when the draft is the latest edition", async () => {
    const offered = async (preview: MenuPreview | null, listed = queue()) => {
      const el = await mount(stubApi({ getMenuPublications: vi.fn(async () => listed) }), {
        preview,
      });
      const found = inShadow(el, "schedule-open") !== null;
      cleanupWidgets();
      return found;
    };
    expect(await offered(draftPreview())).toBe(true);
    expect(await offered(null)).toBe(false);
    expect(await offered(draftPreview({ clashes: [{}] as MenuPreview["clashes"] }))).toBe(false);
    expect(await offered(draftPreview({ hash: "4".repeat(64) }))).toBe(false);
    // v2 is queued, but v4 follows it, so a draft like v2 is a change from v4.
    expect(await offered(draftPreview({ hash: "2".repeat(64) }))).toBe(true);
    const nothingQueued = { ...queue(), editions: queue().editions.slice(2) };
    expect(await offered(draftPreview({ hash: "1".repeat(64) }), nothingQueued)).toBe(false);
    expect(await offered(draftPreview(), nothingQueued)).toBe(true);
  });
});

describe("overtakeSentence", () => {
  it("asks for a lower-numbered version to be cancelled or moved earlier", () => {
    expect(overtakeSentence([V2_IN_THE_WAY], 3, queue())).toBe(
      "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move it earlier, then try again.",
    );
  });

  it("asks for a higher-numbered version to be cancelled or moved later", () => {
    expect(overtakeSentence([V3_IN_THE_WAY], 2, queue())).toBe(
      "Version 3, scheduled for 9 Oct 2026, 08:00, must go live after this one. Cancel it or move it later, then try again.",
    );
  });

  it("treats every version as lower when nothing is being moved", () => {
    expect(overtakeSentence([V4_IN_THE_WAY], null, queue())).toBe(
      "Version 4, scheduled for 25 Oct 2026, 02:30 (UTC+01:00), must go live first. Cancel it or move it earlier, then try again.",
    );
  });

  it("gives a repeated local time its offset", () => {
    expect(overtakeSentence([V4_IN_THE_WAY], 3, queue())).toBe(
      "Version 4, scheduled for 25 Oct 2026, 02:30 (UTC+01:00), must go live after this one. Cancel it or move it later, then try again.",
    );
  });

  it("names several versions on each side, the lower ones first", () => {
    expect(overtakeSentence([V4_IN_THE_WAY, V3_IN_THE_WAY, V2_IN_THE_WAY], 1, queue())).toBe(
      "Versions 2 (8 Oct 2026, 08:00), 3 (9 Oct 2026, 08:00), and 4 (25 Oct 2026, 02:30 (UTC+01:00)) must go live after this one. Cancel them or move them later, then try again.",
    );
    expect(overtakeSentence([V4_IN_THE_WAY, V2_IN_THE_WAY], 3, queue())).toBe(
      "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move it earlier, then try again. " +
        "Version 4, scheduled for 25 Oct 2026, 02:30 (UTC+01:00), must go live after this one. Cancel it or move it later, then try again.",
    );
    expect(overtakeSentence([V3_IN_THE_WAY, V2_IN_THE_WAY], null, queue())).toBe(
      "Versions 2 (8 Oct 2026, 08:00) and 3 (9 Oct 2026, 08:00) must go live first. Cancel them or move them earlier, then try again.",
    );
  });

  it("names them in Spanish", () => {
    setLocale("es-ES");
    expect(overtakeSentence([V2_IN_THE_WAY, V3_IN_THE_WAY], null, queue())).toBe(
      "Las versiones 2 (8 oct 2026, 08:00) y 3 (9 oct 2026, 08:00) deben publicarse antes. Cancélalas o adelántalas y vuelve a intentarlo.",
    );
    expect(overtakeSentence([V3_IN_THE_WAY], 2, queue())).toBe(
      "La versión 3, programada para el 9 oct 2026, 08:00, debe publicarse después de esta. Cancélala o retrásala y vuelve a intentarlo.",
    );
    expect(overtakeSentence([V3_IN_THE_WAY, V4_IN_THE_WAY], 2, queue())).toBe(
      "Las versiones 3 (9 oct 2026, 08:00) y 4 (25 oct 2026, 02:30 (UTC+01:00)) deben publicarse después de esta. Cancélalas o retrásalas y vuelve a intentarlo.",
    );
  });

  it("answers null when a version the refusal names is not in the list", () => {
    const missing = { versionId: "v-lunch-9", number: 9, activatesAt: "2026-11-01T09:00:00.000Z" };
    expect(overtakeSentence([V2_IN_THE_WAY, missing], null, queue())).toBeNull();
    expect(overtakeSentence([], null, queue())).toBeNull();
  });
});

describe("placing a schedule refusal by what it carries", () => {
  it("puts a refused date under the date field", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "activatesAt.date" },
      }),
    });
    const el = await scheduleAt(api, "2026-10-10", "12:00");
    expect(field(el, "date").error).toBe(codeMessage("management.request_invalid"));
    expect(field(el, "time").error).toBe("");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(el.shadowRoot!.activeElement).toBe(field(el, "date"));
    await enter(el, "date", "2026-10-11");
    expect(field(el, "date").error).toBe("");
  });

  it("puts a refused body that names no field of the form, or no params, in the bottom message", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValueOnce({
          code: "management.request_invalid",
          params: { field: "activatesAt" },
        })
        .mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await scheduleAt(api, "2026-10-10", "12:00");
    expect(field(el, "date").error).toBe("");
    expect(field(el, "time").error).toBe("");
    expect(await bottom(el)).toBe(codeMessage("management.request_invalid"));
    await submit(el);
    expect(await bottom(el)).toBe(codeMessage("connection.failed"));
  });

  it("puts a refused choice of a time the form does not show in the bottom message", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "activatesAt.occurrence" },
      }),
    });
    const el = await scheduleAt(api, "2026-10-10", "12:00");
    expect(field(el, "time").error).toBe("");
    expect(await bottom(el)).toBe(codeMessage("management.request_invalid"));
  });

  it("puts a refused choice of a repeated time under that choice", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValueOnce(REPEATED)
        .mockRejectedValue({
          code: "management.request_invalid",
          params: { field: "activatesAt.occurrence" },
        }),
    });
    const el = await scheduleAt(api, "2026-10-25", "02:30");
    await chooseOption(occurrence(el)!, "earlier");
    await submit(el);
    expect(occurrence(el)!.error).toBe(codeMessage("management.request_invalid"));
    await chooseOption(occurrence(el)!, "later");
    await flush(el);
    expect(occurrence(el)!.error).toBe("");
  });

  it("keeps a refusal that names no field until the next submission, beside a marked field", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValue({ code: "menu.changed_since_preview", params: {} }),
    });
    const el = await scheduleAt(api, "2026-10-10", "12:00");
    await enter(el, "time", "");
    expect(await bottom(el)).toBe(
      `${codeMessage("menu.changed_since_preview")} Correct the highlighted fields to continue.`,
    );
    expect(field(el, "time").error).toBe("Choose a time.");
  });

  it("falls back without reading the list when the refusal names no editions", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValue({ code: OVERTAKES, params: { menuId: "menu-lunch" } }),
    });
    const el = await scheduleAt(api, "2026-10-08", "08:00");
    expect(api.getMenuPublications).toHaveBeenCalledTimes(1);
    expect(field(el, "time").error).toBe(codeMessage(OVERTAKES));
  });

  it("falls back to the code's sentence for a repeated or skipped time it cannot read", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValueOnce({ code: "menu_publication.time_repeated", params: {} })
        .mockRejectedValueOnce({
          code: "menu_publication.time_repeated",
          params: { date: "2026-10-25", time: "02:30", occurrences: [{ at: "x" }] },
        })
        .mockRejectedValue({ code: "menu_publication.time_skipped", params: {} }),
    });
    const el = await scheduleAt(api, "2026-10-25", "02:30");
    expect(occurrence(el)).toBeNull();
    expect(await bottom(el)).toBe(codeMessage("menu_publication.time_repeated"));
    await submit(el);
    expect(occurrence(el)).toBeNull();
    expect(await bottom(el)).toBe(codeMessage("menu_publication.time_repeated"));
    await submit(el);
    expect(field(el, "time").error).toBe(codeMessage("menu_publication.time_skipped"));
  });

  it("closes a clean form on Cancel, sending nothing, and hands focus back to its button", async () => {
    const api = stubApi();
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    inShadow(el, "schedule-close")!.click();
    await flush(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scheduleDialog(el).open).toBe(false);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(el.shadowRoot!.activeElement).toBe(inShadow(el, "schedule-open"));
  });

  it("hands focus to the heading when the schedule leaves nothing more to schedule", async () => {
    const scheduled = queue();
    scheduled.editions.splice(2, 0, {
      ...scheduled.editions[1]!,
      versionId: "v-lunch-5",
      number: 5,
      contentHash: DRAFT_HASH,
    });
    const read = vi.fn().mockResolvedValueOnce(queue()).mockResolvedValue(scheduled);
    const el = await scheduleAt(stubApi({ getMenuPublications: read }), "2026-10-26", "12:00");
    await flush(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scheduleDialog(el).open).toBe(false);
    expect(inShadow(el, "schedule-open")).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("h2"));
  });

  it("drops the form, and a refusal that arrives later, when it follows another menu", async () => {
    let refuse!: (reason: unknown) => void;
    const api = stubApi({
      scheduleMenuPublication: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    submitButton(el).click();
    await flush(el);
    el.menuId = "menu-dinner";
    await flush(el);
    expect(scheduleDialog(el).open).toBe(false);
    refuse({ code: "menu_publication.time_past", params: {} });
    await flush(el);
    expect(field(el, "time").error).toBe("");
  });
});

describe("schedule fix round 1", () => {
  it("ignores edits while a schedule is out, and places its refusal against the values it sent", async () => {
    let refuse!: (reason: unknown) => void;
    const api = stubApi({
      scheduleMenuPublication: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-25");
    await enter(el, "time", "02:30");
    submitButton(el).click();
    await flush(el);
    expect(field(el, "time").disabled).toBe(true);
    expect(field(el, "date").disabled).toBe(true);
    field(el, "time").dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "03:30" }, bubbles: true, composed: true }),
    );
    await flush(el);
    refuse(REPEATED);
    await flush(el);
    await flush(el);
    expect(field(el, "time").value).toBe("02:30");
    expect(field(el, "time").disabled).toBe(false);
    expect(occurrence(el)!.label).toBe("Which 02:30");
    await chooseOption(occurrence(el)!, "earlier");
    await flush(el);
    await submit(el);
    expect(api.scheduleMenuPublication.mock.calls[1]![1].activatesAt).toEqual({
      date: "2026-10-25",
      time: "02:30",
      occurrence: "earlier",
    });
  });

  it("says why nothing happens when the preview is gone at the press", async () => {
    const api = stubApi();
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    el.preview = null;
    await flush(el);
    await submit(el);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(await bottom(el)).toBe(
      "The preview could not be read, so nothing was scheduled. Try again once the preview shows.",
    );
    expect(submitButton(el).disabled).toBe(false);
  });

  it("says it in Spanish too", async () => {
    setLocale("es-ES");
    const el = await mount(stubApi(), { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    el.preview = null;
    await flush(el);
    await submit(el);
    expect(await bottom(el)).toBe(
      "No se pudo leer la vista previa, así que no se ha programado nada. Vuelve a intentarlo cuando se muestre la vista previa.",
    );
  });

  it("rewords a refusal it is showing when the screen language changes", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: OVERTAKES,
        params: { menuId: "menu-lunch", overtaken: [V2_IN_THE_WAY] },
      }),
    });
    const el = await scheduleAt(api, "2026-10-08", "08:00");
    expect(field(el, "time").error).toBe(
      "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move it earlier, then try again.",
    );
    try {
      setLocale("es-ES");
      await flush(el);
      expect(field(el, "time").error).toBe(
        "La versión 2, programada para el 8 oct 2026, 08:00, debe publicarse antes. Cancélala o adelántala y vuelve a intentarlo.",
      );
      expect(await bottom(el)).toBe("Corrige los campos marcados para continuar.");
    } finally {
      setLocale("en");
    }
  });

  it("rewords a skipped time it is showing when the screen language changes", async () => {
    const api = stubApi({
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: "menu_publication.time_skipped",
        params: { date: "2027-03-28", time: "02:30" },
      }),
    });
    const el = await scheduleAt(api, "2027-03-28", "02:30");
    try {
      setLocale("es-ES");
      await flush(el);
      expect(field(el, "time").error).toBe(
        "El reloj se salta las 02:30 el 28 mar 2027. Elige otra hora.",
      );
    } finally {
      setLocale("en");
    }
  });

  it("keeps a newer live list when an older re-read after a cancel resolves later", async () => {
    const live = new LiveData();
    const newer = queue();
    newer.editions[0] = { ...newer.editions[0]!, state: "cancelled" };
    let older!: (value: MenuPublicationsAnswer) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce(queue())
      .mockImplementationOnce(
        () => new Promise<MenuPublicationsAnswer>((resolve) => (older = resolve)),
      )
      .mockResolvedValue(newer);
    const el = await mount(stubApi({ liveData: live, getMenuPublications: read }));
    await openCancel(el);
    inShadow(el, "cancel-confirm")!.click();
    await flush(el);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    live.invalidate([{ type: "menu_scheduled_publications" }]);
    await vi.waitFor(() => expect(cell(el, "state-v-lunch-2")).toBe("Cancelled"));
    older(queue());
    await flush(el);
    await flush(el);
    expect(cell(el, "state-v-lunch-2")).toBe("Cancelled");
  });

  it("keeps a newer live list when the overtake re-read resolves later", async () => {
    const live = new LiveData();
    const newer = queue();
    newer.editions[0] = { ...newer.editions[0]!, state: "cancelled" };
    let older!: (value: MenuPublicationsAnswer) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce(queue())
      .mockImplementationOnce(
        () => new Promise<MenuPublicationsAnswer>((resolve) => (older = resolve)),
      )
      .mockResolvedValue(newer);
    const api = stubApi({
      liveData: live,
      getMenuPublications: read,
      scheduleMenuPublication: vi.fn().mockRejectedValue({
        code: OVERTAKES,
        params: { menuId: "menu-lunch", overtaken: [V2_IN_THE_WAY] },
      }),
    });
    const el = await mount(api, { preview: draftPreview() });
    await openSchedule(el);
    await enter(el, "date", "2026-10-08");
    await enter(el, "time", "08:00");
    submitButton(el).click();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    live.invalidate([{ type: "menu_scheduled_publications" }]);
    await vi.waitFor(() => expect(cell(el, "state-v-lunch-2")).toBe("Cancelled"));
    older(queue());
    await flush(el);
    await flush(el);
    expect(cell(el, "state-v-lunch-2")).toBe("Cancelled");
    expect(field(el, "time").error).toBe(
      "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move it earlier, then try again.",
    );
  });

  it("gives the choice of a repeated time a placeholder", async () => {
    const api = stubApi({ scheduleMenuPublication: vi.fn().mockRejectedValue(REPEATED) });
    const el = await scheduleAt(api, "2026-10-25", "02:30");
    expect(occurrence(el)!.placeholder).toBe("Choose a time");
  });

  it("gives it in Spanish", async () => {
    setLocale("es-ES");
    const api = stubApi({ scheduleMenuPublication: vi.fn().mockRejectedValue(REPEATED) });
    const el = await scheduleAt(api, "2026-10-25", "02:30");
    expect(occurrence(el)!.placeholder).toBe("Elige una hora");
  });
});

interface KeptEdition {
  versionId: string;
  number: number;
  state: Edition["state"];
  activatesAt: string;
  local: { date: string; time: string };
  contentHash: string;
}

/**
 * Keeps Lunch Menu's editions as the server does, v1 live, and refuses a placement that overtakes
 * a queued edition by the plan's rule. Every method the widget calls other than the list read is
 * recorded in `writes`, including any this stub does not define.
 */
function editionServer() {
  const kept: KeptEdition[] = [
    {
      versionId: "v-lunch-1",
      number: 1,
      state: "activated",
      activatesAt: "2026-10-07T08:00:00.000Z",
      local: { date: "2026-10-07", time: "10:00" },
      contentHash: "1".repeat(64),
    },
  ];
  const writes: string[] = [];
  // Every date these cases use is in summer time in Madrid.
  const instant = ({ date, time }: { date: string; time: string }) =>
    new Date(`${date}T${time}:00+02:00`).toISOString();
  const listed = (): MenuPublicationsAnswer => {
    const shown = (edition: KeptEdition): Edition => ({
      versionId: edition.versionId,
      number: edition.number,
      state: edition.state,
      activatesAt: edition.activatesAt,
      queuedAt: "2026-10-07T08:00:00.000Z",
      cancelledAt: edition.state === "cancelled" ? "2026-10-07T09:00:00.000Z" : null,
      contentHash: edition.contentHash,
      local: { ...edition.local, offset: "+02:00", repeated: false },
    });
    const queued = kept
      .filter((edition) => edition.state === "queued")
      .sort((a, b) => a.activatesAt.localeCompare(b.activatesAt));
    const settled = kept
      .filter((edition) => edition.state !== "queued")
      .sort((a, b) => b.number - a.number);
    const live = settled.find((edition) => edition.state === "activated")!;
    return {
      timeZone: "Europe/Madrid",
      live: {
        versionId: live.versionId,
        number: live.number,
        since: live.activatesAt,
        local: { ...live.local, offset: "+02:00", repeated: false },
      },
      editions: [...queued, ...settled].map(shown),
    };
  };
  const refuseOvertaking = (placed: KeptEdition) => {
    const overtaken = kept
      .filter(
        (other) =>
          other.state === "queued" &&
          other.versionId !== placed.versionId &&
          ((other.number < placed.number && other.activatesAt >= placed.activatesAt) ||
            (other.number > placed.number && other.activatesAt <= placed.activatesAt)),
      )
      .sort((a, b) => a.number - b.number)
      .map(({ versionId, number, activatesAt }) => ({ versionId, number, activatesAt }));
    if (overtaken.length > 0)
      throw { code: OVERTAKES, params: { menuId: "menu-lunch", overtaken } };
  };
  const calls = {
    getMenuPublications: vi.fn(async () => listed()),
    scheduleMenuPublication: vi.fn(
      async (_menuId: string, input: { expectedHash: string; activatesAt: ActivationTime }) => {
        writes.push("scheduleMenuPublication");
        const number = Math.max(...kept.map((edition) => edition.number)) + 1;
        const placed: KeptEdition = {
          versionId: `v-lunch-${number}`,
          number,
          state: "queued",
          activatesAt: instant(input.activatesAt),
          local: { date: input.activatesAt.date, time: input.activatesAt.time },
          contentHash: input.expectedHash,
        };
        refuseOvertaking(placed);
        kept.push(placed);
        return { versionId: placed.versionId, number, activatesAt: placed.activatesAt };
      },
    ),
    rescheduleMenuPublication: vi.fn(
      async (_menuId: string, versionId: string, input: { activatesAt: ActivationTime }) => {
        writes.push("rescheduleMenuPublication");
        const moved = kept.find((edition) => edition.versionId === versionId)!;
        const placed: KeptEdition = {
          ...moved,
          activatesAt: instant(input.activatesAt),
          local: { date: input.activatesAt.date, time: input.activatesAt.time },
        };
        refuseOvertaking(placed);
        Object.assign(moved, placed);
        return { versionId, number: moved.number, activatesAt: moved.activatesAt };
      },
    ),
    cancelMenuPublication: vi.fn(async (_menuId: string, versionId: string) => {
      writes.push("cancelMenuPublication");
      kept.find((edition) => edition.versionId === versionId)!.state = "cancelled";
    }),
  };
  const api = new Proxy(calls, {
    get(target, name) {
      if (name in target) return target[name as keyof typeof target];
      if (typeof name !== "string" || name === "liveData" || name === "then") return undefined;
      return async () => {
        writes.push(name);
      };
    },
  }) as unknown as DashboardApi;
  return { api, calls, writes };
}

function rowActions(el: MenuPublicationsPanel, versionId: string): string[] {
  return [...rowMenu(el, versionId)!.querySelectorAll("wt-button")].map(
    (button) => `${button.getAttribute("data-test")}: ${button.textContent!.trim()}`,
  );
}

async function openMove(el: MenuPublicationsPanel, versionId: string): Promise<void> {
  rowMenu(el, versionId)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  rowMenu(el, versionId)!.querySelector<HTMLElement>(`[data-test="move-${versionId}"]`)!.click();
  await flush(el);
  await scheduleDialog(el).updateComplete;
}

/** Schedules the preview the panel holds through the form, then draws the list it reads after. */
async function scheduleThrough(el: MenuPublicationsPanel, date: string, time: string) {
  await openSchedule(el);
  await enter(el, "date", date);
  await enter(el, "time", time);
  await submit(el);
  expect(scheduleDialog(el).open).toBe(false);
}

/** Closes the form and waits for its close report, which the browser sends a task later. */
async function closeForm(el: MenuPublicationsPanel): Promise<void> {
  const reported = new Promise((resolve) =>
    scheduleDialog(el).addEventListener("wt-close", resolve, { once: true }),
  );
  inShadow(el, "schedule-close")!.click();
  await reported;
  await flush(el);
}

/** A draft edit: the menu now differs from every edition. */
async function editDraft(el: MenuPublicationsPanel, hash: string): Promise<void> {
  el.preview = draftPreview({ hash });
  await flush(el);
}

function rows(el: MenuPublicationsPanel): string[] {
  return [...table(el).shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")]
      .slice(0, 3)
      .map((td) => td.textContent!.replace(/\s+/g, " ").trim())
      .join(" | "),
  );
}

const FIX_FIELDS = {
  en: "Correct the highlighted fields to continue.",
  "es-ES": "Corrige los campos marcados para continuar.",
} as const;

describe("changing a queued version's time", () => {
  it.each([
    {
      locale: "en",
      sentence:
        "Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it or move it earlier, then try again.",
      action: "Change time",
      cancelled: "Cancelled",
      scheduled: "Scheduled",
      moved: "7 Oct 2026, 16:00",
      four: "Version 4",
    },
    {
      locale: "es-ES",
      sentence:
        "La versión 2, programada para el 8 oct 2026, 08:00, debe publicarse antes. Cancélala o adelántala y vuelve a intentarlo.",
      action: "Cambiar la hora",
      cancelled: "Cancelada",
      scheduled: "Programada",
      moved: "7 oct 2026, 16:00",
      four: "Versión 4",
    },
  ] as const)(
    "refuses to move v3 before v2 until v2 is cancelled, then moves it, leaving the draft alone ($locale)",
    async ({ locale, sentence, action, cancelled, scheduled, moved, four }) => {
      setLocale(locale);
      onTestFinished(() => setLocale("en"));
      const server = editionServer();
      const el = await mount(server.api, { preview: draftPreview({ hash: "a".repeat(64) }) });
      await scheduleThrough(el, "2026-10-08", "08:00");
      await editDraft(el, "b".repeat(64));
      await scheduleThrough(el, "2026-10-09", "08:00");
      await editDraft(el, "c".repeat(64));
      expect(cell(el, "state-v-lunch-3")).toBe(scheduled);
      const before = rows(el);

      await openMove(el, "v-lunch-3");
      await enter(el, "date", "2026-10-07");
      await enter(el, "time", "16:00");
      await submit(el);
      expect(field(el, "time").error).toBe(sentence);
      expect(field(el, "date").error).toBe("");
      expect(await bottom(el)).toBe(FIX_FIELDS[locale]);
      expect(field(el, "date").value).toBe("2026-10-07");
      expect(field(el, "time").value).toBe("16:00");
      expect(scheduleDialog(el).open).toBe(true);
      expect(submitButton(el).textContent!.trim()).toBe(action);
      expect(submitButton(el).disabled).toBe(false);
      expect(rows(el)).toEqual(before);
      expect(
        [...scheduleDialog(el).querySelectorAll("wt-button")].map((button) =>
          button.getAttribute("data-test"),
        ),
      ).toEqual(["schedule-close", "schedule-submit"]);
      expect(server.calls.cancelMenuPublication).not.toHaveBeenCalled();
      await closeForm(el);
      expect(scheduleDialog(el).open).toBe(false);

      await openCancel(el, "v-lunch-2");
      inShadow(el, "cancel-confirm")!.click();
      await flush(el);
      await flush(el);
      expect(server.calls.cancelMenuPublication.mock.calls).toEqual([["menu-lunch", "v-lunch-2"]]);
      expect(cell(el, "state-v-lunch-2")).toBe(cancelled);

      await openMove(el, "v-lunch-3");
      await enter(el, "date", "2026-10-07");
      await enter(el, "time", "16:00");
      await submit(el);
      expect(server.calls.rescheduleMenuPublication.mock.calls.at(-1)).toEqual([
        "menu-lunch",
        "v-lunch-3",
        { activatesAt: { date: "2026-10-07", time: "16:00" } },
      ]);
      expect(scheduleDialog(el).open).toBe(false);
      await flush(el);
      expect(cell(el, "state-v-lunch-3")).toBe(scheduled);
      expect(cell(el, "time-v-lunch-3")).toBe(moved);
      expect(server.writes).toEqual([
        "scheduleMenuPublication",
        "scheduleMenuPublication",
        "rescheduleMenuPublication",
        "cancelMenuPublication",
        "rescheduleMenuPublication",
      ]);
      expect(el.preview!.hash).toBe("c".repeat(64));

      expect(inShadow(el, "schedule-open")).not.toBeNull();
      await scheduleThrough(el, "2026-10-10", "08:00");
      expect(await server.calls.scheduleMenuPublication.mock.results.at(-1)!.value).toMatchObject({
        number: 4,
      });
      await flush(el);
      expect(cell(el, "version-v-lunch-4")).toBe(four);
    },
  );

  it.each([
    {
      locale: "en",
      sentence:
        "Version 3, scheduled for 9 Oct 2026, 08:00, must go live after this one. Cancel it or move it later, then try again.",
    },
    {
      locale: "es-ES",
      sentence:
        "La versión 3, programada para el 9 oct 2026, 08:00, debe publicarse después de esta. Cancélala o retrásala y vuelve a intentarlo.",
    },
  ] as const)(
    "refuses to move v2 after v3, naming v3 as the one that must go live after it ($locale)",
    async ({ locale, sentence }) => {
      setLocale(locale);
      onTestFinished(() => setLocale("en"));
      const server = editionServer();
      const el = await mount(server.api, { preview: draftPreview({ hash: "a".repeat(64) }) });
      await scheduleThrough(el, "2026-10-08", "08:00");
      await editDraft(el, "b".repeat(64));
      await scheduleThrough(el, "2026-10-09", "08:00");
      const before = rows(el);

      await openMove(el, "v-lunch-2");
      await enter(el, "date", "2026-10-10");
      await enter(el, "time", "08:00");
      await submit(el);
      expect(field(el, "time").error).toBe(sentence);
      expect(await bottom(el)).toBe(FIX_FIELDS[locale]);
      expect(scheduleDialog(el).open).toBe(true);
      expect(rows(el)).toEqual(before);
      expect(server.calls.rescheduleMenuPublication).toHaveBeenCalledTimes(1);
      expect(server.calls.cancelMenuPublication).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      locale: "en",
      actions: ["move-v-lunch-2: Change time", "cancel-v-lunch-2: Cancel this version"],
      heading: "Change the time of version 2",
      intro:
        "Version 2 of Lunch Menu goes live at the date and time you choose, on the venue's clock (Europe/Madrid).",
      action: "Change time",
    },
    {
      locale: "es-ES",
      actions: ["move-v-lunch-2: Cambiar la hora", "cancel-v-lunch-2: Cancelar esta versión"],
      heading: "Cambiar la hora de la versión 2",
      intro:
        "La versión 2 de Lunch Menu se publica en la fecha y la hora que elijas, según el reloj del local (Europe/Madrid).",
      action: "Cambiar la hora",
    },
  ] as const)(
    "offers Change time beside Cancel on queued rows, starting at the version's own time ($locale)",
    async ({ locale, actions, heading, intro, action }) => {
      setLocale(locale);
      onTestFinished(() => setLocale("en"));
      // No preview: moving a version does not depend on the draft.
      const el = await mount();
      expect(rowActions(el, "v-lunch-2")).toEqual(actions);
      expect(rowActions(el, "v-lunch-4").map((entry) => entry.split(":")[0])).toEqual([
        "move-v-lunch-4",
        "cancel-v-lunch-4",
      ]);
      expect(rowMenu(el, "v-lunch-3")).toBeNull();
      expect(rowMenu(el, "v-lunch-1")).toBeNull();
      await openMove(el, "v-lunch-2");
      expect(scheduleDialog(el).open).toBe(true);
      expect(scheduleDialog(el).heading).toBe(heading);
      expect(inShadow(el, "schedule-intro")!.textContent!.trim()).toBe(intro);
      expect(field(el, "date").value).toBe("2026-10-08");
      expect(field(el, "time").value).toBe("08:00");
      expect(field(el, "date").required).toBe(true);
      expect(field(el, "time").required).toBe(true);
      expect(submitButton(el).textContent!.trim()).toBe(action);
      expect(await bottom(el)).toBe("");
    },
  );

  it("moves a version without a preview, closes, and reads the list again", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openMove(el, "v-lunch-2");
    await enter(el, "time", "09:00");
    await submit(el);
    expect(api.rescheduleMenuPublication.mock.calls).toEqual([
      ["menu-lunch", "v-lunch-2", { activatesAt: { date: "2026-10-08", time: "09:00" } }],
    ]);
    expect(api.scheduleMenuPublication).not.toHaveBeenCalled();
    expect(scheduleDialog(el).open).toBe(false);
    expect(api.getMenuPublications).toHaveBeenCalledTimes(2);
  });

  it("explains an emptied field as the schedule form does", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openMove(el, "v-lunch-2");
    await enter(el, "time", "");
    await submit(el);
    expect(field(el, "time").error).toBe("Choose a time.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(submitButton(el).disabled).toBe(true);
    expect(api.rescheduleMenuPublication).not.toHaveBeenCalled();
  });

  it.each([
    [
      "menu_publication.time_skipped",
      { date: "2027-03-28", time: "02:30" },
      "The clock skips 02:30 on 28 Mar 2027. Choose another time.",
    ],
    ["menu_publication.time_past", { activatesAt: "2026-10-07T07:59:00.000Z" }, null],
  ])("puts a %s refusal under the time field", async (code, params, sentence) => {
    const api = stubApi({ rescheduleMenuPublication: vi.fn().mockRejectedValue({ code, params }) });
    const el = await mount(api);
    await openMove(el, "v-lunch-2");
    await enter(el, "date", "2027-03-28");
    await enter(el, "time", "02:30");
    await submit(el);
    expect(field(el, "time").error).toBe(sentence ?? codeMessage(code));
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(scheduleDialog(el).open).toBe(true);
    expect(submitButton(el).disabled).toBe(false);
  });

  it("asks which of a repeated time and sends the choice with the move", async () => {
    const reschedule = vi
      .fn()
      .mockRejectedValueOnce(REPEATED)
      .mockResolvedValue({ versionId: "v-lunch-2", number: 2, activatesAt: "x" });
    const el = await mount(stubApi({ rescheduleMenuPublication: reschedule }));
    await openMove(el, "v-lunch-2");
    await enter(el, "date", "2026-10-25");
    await enter(el, "time", "02:30");
    await submit(el);
    expect(occurrence(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);
    await chooseOption(occurrence(el)!, "earlier");
    await flush(el);
    await submit(el);
    expect(reschedule.mock.calls[1]).toEqual([
      "menu-lunch",
      "v-lunch-2",
      { activatesAt: { date: "2026-10-25", time: "02:30", occurrence: "earlier" } },
    ]);
    expect(scheduleDialog(el).open).toBe(false);
  });

  it.each(["menu_publication.not_queued", "menu_publication.not_found"])(
    "says %s in the bottom message and reads the list again",
    async (code) => {
      const api = stubApi({
        rescheduleMenuPublication: vi.fn().mockRejectedValue({ code, params: {} }),
      });
      const el = await mount(api);
      await openMove(el, "v-lunch-2");
      await enter(el, "time", "09:00");
      await submit(el);
      expect(await bottom(el)).toBe(codeMessage(code));
      expect(field(el, "time").error).toBe("");
      expect(scheduleDialog(el).open).toBe(true);
      expect(api.getMenuPublications).toHaveBeenCalledTimes(2);
    },
  );

  it("hands focus back to the row menu when the form closes", async () => {
    const el = await mount();
    await openMove(el, "v-lunch-2");
    await closeForm(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const trigger = rowMenu(el, "v-lunch-2")!.shadowRoot!.querySelector("button")!;
    expect(rowMenu(el, "v-lunch-2")!.shadowRoot!.activeElement).toBe(trigger);
  });

  it("opens the schedule form empty, and for a new version, after Change time", async () => {
    const api = stubApi();
    const el = await mount(api, { preview: draftPreview() });
    await openMove(el, "v-lunch-2");
    await closeForm(el);
    await openSchedule(el);
    expect(scheduleDialog(el).heading).toBe("Schedule Lunch Menu");
    expect(field(el, "date").value).toBe("");
    expect(submitButton(el).textContent!.trim()).toBe("Schedule");
    await enter(el, "date", "2026-10-10");
    await enter(el, "time", "12:00");
    await submit(el);
    expect(api.scheduleMenuPublication).toHaveBeenCalledTimes(1);
  });
});
