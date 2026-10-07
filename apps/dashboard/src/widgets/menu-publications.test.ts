import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataTableColumn } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./menu-publications.js";
import type { MenuPublicationsPanel } from "./menu-publications.js";
import type { DashboardApi, MenuPublicationsAnswer } from "../api/client.js";
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
    ...overrides,
  } as unknown as DashboardApi & {
    getMenuPublications: ReturnType<typeof vi.fn>;
    cancelMenuPublication: ReturnType<typeof vi.fn>;
  };
}

async function flush(el: MenuPublicationsPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table");
  if (table) await table.updateComplete;
}

async function mount(api = stubApi()): Promise<MenuPublicationsPanel> {
  const { el } = await mountWidget<MenuPublicationsPanel>("dashboard-menu-publications", {
    api,
    menuId: "menu-lunch",
    menuName: "Lunch Menu",
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
