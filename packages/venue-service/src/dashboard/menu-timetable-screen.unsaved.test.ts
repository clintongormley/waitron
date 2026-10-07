import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { MenuSlot, MenuTimetableModel } from "../menu-timetable-types.js";
import { MenuTimetableApi } from "./menu-timetable-client.js";
import type { MenuTimetableScreen } from "./menu-timetable-screen.js";
import "./menu-timetable-screen.js";

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});
const monday = [slot("mananas", "08:00", "12:00")];
const christmas = [slot("mananas", "10:00", "13:00")];

const model: MenuTimetableModel = {
  menus: ["Desayunos", "Cena", "Café", "Brunch"].map((name) => ({
    id: `m-${name}`,
    name,
    active: true,
  })),
  timeZone: "Europe/Madrid",
  clockReadable: true,
  civilDate: "2026-10-07",
  departments: [
    {
      id: "restaurant",
      name: "Restaurant",
      active: true,
      menuIds: ["m-Desayunos", "m-Cena", "m-Café", "m-Brunch"],
      allDayMenuId: "m-Café",
      periods: [
        {
          id: "brunch",
          name: "Brunch",
          menuId: "m-Brunch",
          uses: [{ kind: "special_date", specialDateId: "pasada", date: "2025-12-25" }],
        },
        {
          id: "mananas",
          name: "Mañanas",
          menuId: "m-Desayunos",
          uses: [{ kind: "week", weekday: 1 }],
        },
        { id: "noches", name: "Noches", menuId: "m-Cena", uses: [] },
      ],
      week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekday === 1 ? monday : [],
      })),
      zones: [{ id: "barra", name: "Barra", active: true, allDayMenuId: null, periodMenus: [] }],
    },
  ],
  specialDates: [
    {
      id: "pasada",
      date: "2025-12-25",
      name: "Navidad pasada",
      timetables: [{ departmentId: "restaurant", slots: [slot("brunch", "11:00", "15:00")] }],
    },
    {
      id: "navidad",
      date: "2026-12-25",
      name: "Navidad",
      timetables: [{ departmentId: "restaurant", slots: christmas }],
    },
  ],
};

class MenuLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: MenuTimetableApi;
  override render() {
    return html`<dashboard-menu-timetable-screen .api=${this.api}></dashboard-menu-timetable-screen>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Discard unsaved changes?",
        keepLabel: "Keep editing",
        discardLabel: "Discard changes",
      })}`;
  }
}
customElements.define("menu-timetable-leave-test-app", MenuLeaveApp);
let app: MenuLeaveApp;
afterEach(() => app?.remove());

/** `write` answers every write in turn; `refreshFails` refuses every read after the first. */
async function mount(write: () => Promise<void> = async () => {}, refreshFails = false) {
  setLocale("en");
  const writes: unknown[] = [];
  let reads = 0;
  const request = async (path: string, method: string, body?: unknown) => {
    if (method === "GET") {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(model);
    }
    writes.push([method, path, body]);
    await write();
  };
  app = document.createElement("menu-timetable-leave-test-app") as MenuLeaveApp;
  app.api = new MenuTimetableApi(request as DashboardRequest);
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<MenuTimetableScreen>(
    "dashboard-menu-timetable-screen",
  )!;
  await expect.poll(() => screen.shadowRoot!.querySelector('[data-test="menus"]')).not.toBeNull();
  return { screen, writes };
}

async function settle(screen: MenuTimetableScreen) {
  for (let turn = 0; turn < 3; turn++) {
    await screen.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Searches the screen's shadow root and every shadow root under it. */
function find<T extends Element = HTMLElement>(screen: Element, selector: string): T | null {
  const search = (root: ParentNode): T | null => {
    const found = root.querySelector<T>(selector);
    if (found) return found;
    for (const child of root.querySelectorAll("*"))
      if (child.shadowRoot) {
        const inner = search(child.shadowRoot);
        if (inner) return inner;
      }
    return null;
  };
  return search(screen.shadowRoot!);
}
type Field = HTMLElement & { value: string };
async function setField(screen: MenuTimetableScreen, name: string, value: string) {
  const field = find<Field>(screen, `[name="${name}"]`)!;
  expect(field, name).not.toBeNull();
  field.value = value;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(screen);
}
const fieldValue = (screen: MenuTimetableScreen, name: string) =>
  find<Field>(screen, `[name="${name}"]`)!.value;
const modal = (screen: MenuTimetableScreen) =>
  screen.shadowRoot!.querySelector<HTMLElement>("wt-modal");
const dialogOpen = (screen: MenuTimetableScreen) =>
  modal(screen)?.shadowRoot!.querySelector("dialog")?.open ?? false;
async function press(screen: MenuTimetableScreen, test: string) {
  const button = screen.shadowRoot!.querySelector<HTMLElement>(`wt-modal [data-test="${test}"]`)!;
  expect(button, test).not.toBeNull();
  button.click();
  await settle(screen);
}
const cancelDisabled = (screen: MenuTimetableScreen) =>
  screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    'wt-modal [data-test="cancel-editor"]',
  )!.disabled;

/** Opens a `wt-row-actions` menu in the row of `table` whose first cell reads `first`. */
async function rowAction(screen: MenuTimetableScreen, table: string, first: string, test: string) {
  const host = screen.shadowRoot!.querySelector(`wt-data-table[data-test="${table}"]`)!;
  const row = [...host.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr")].find(
    (tr) => tr.querySelector("td, th")?.textContent?.trim() === first,
  )!;
  expect(row, first).toBeDefined();
  const action = row.querySelector<HTMLElement>(`[data-test="${test}"]`)!;
  action.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  action.click();
  await settle(screen);
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}

const draftList = (screen: MenuTimetableScreen) =>
  [...screen.shadowRoot!.querySelectorAll('wt-modal [data-test="menu-row"] .menu-name')]
    .map((name) => name.textContent!.trim())
    .join(", ");
async function moveSecondUp(screen: MenuTimetableScreen) {
  const rows = screen.shadowRoot!.querySelectorAll('wt-modal [data-test="menu-row"]');
  rows[1]!.querySelector<HTMLElement>('[data-test="move-up"]')!.click();
  await settle(screen);
}

interface Kind {
  name: string;
  open(screen: MenuTimetableScreen): Promise<void>;
  edit(screen: MenuTimetableScreen): Promise<void>;
  revert(screen: MenuTimetableScreen): Promise<void>;
  value(screen: MenuTimetableScreen): string;
  opened: string;
  edited: string;
  body: unknown[];
}

const KINDS: Kind[] = [
  {
    name: "the department's menu list",
    open: async (screen) => {
      screen.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-menus"]')!.click();
      await settle(screen);
    },
    edit: moveSecondUp,
    revert: moveSecondUp,
    value: draftList,
    opened: "Desayunos, Cena, Café, Brunch",
    edited: "Cena, Desayunos, Café, Brunch",
    body: [
      "PUT",
      "/management-api/venue-service/departments/restaurant/menus",
      { menuIds: ["m-Cena", "m-Desayunos", "m-Café", "m-Brunch"] },
    ],
  },
  {
    name: "a period's name and menu",
    open: (screen) => rowAction(screen, "periods", "Noches", "edit-period"),
    edit: (screen) => setField(screen, "name", "Cenas"),
    revert: (screen) => setField(screen, "name", " Noches "),
    value: (screen) => fieldValue(screen, "name"),
    opened: "Noches",
    edited: "Cenas",
    body: [
      "PATCH",
      "/management-api/venue-service/menu-periods/noches",
      { name: "Cenas", menuId: "m-Cena" },
    ],
  },
  {
    name: "a weekday's slots",
    open: async (screen) => {
      screen
        .shadowRoot!.querySelector<HTMLElement>(
          'table[data-test="menu-week"] tr[data-weekday="1"] button.cell',
        )!
        .click();
      await settle(screen);
    },
    edit: (screen) => setField(screen, "monday.periods.0.opensAt", "08:30"),
    revert: (screen) => setField(screen, "monday.periods.0.opensAt", "08:00"),
    value: (screen) => fieldValue(screen, "monday.periods.0.opensAt"),
    opened: "08:00",
    edited: "08:30",
    body: [
      "PUT",
      "/management-api/venue-service/departments/restaurant/menu-week",
      {
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [slot("mananas", "08:30", "12:00")] : [],
        })),
      },
    ],
  },
  {
    name: "a special date's slots",
    open: (screen) => rowAction(screen, "menu-dates", "Fri, 25 Dec 2026", "edit-date-menus"),
    edit: (screen) => setField(screen, "date.periods.0.opensAt", "10:30"),
    revert: (screen) => setField(screen, "date.periods.0.opensAt", "10:00"),
    value: (screen) => fieldValue(screen, "date.periods.0.opensAt"),
    opened: "10:00",
    edited: "10:30",
    body: [
      "PUT",
      "/management-api/venue-service/special-dates/navidad/menu-timetables/restaurant",
      { slots: [slot("mananas", "10:30", "13:00")] },
    ],
  },
];

describe.each(KINDS)("Menu timetable: $name", (kind) => {
  it("asks on Escape and Cancel, keeps the edit on Keep, and closes on Discard without a write", async () => {
    const { screen, writes } = await mount();
    await kind.open(screen);
    expect(unload()).toBe(false);
    await kind.edit(screen);
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(dialogOpen(screen)).toBe(true);
    await choose("keep");
    expect(dialogOpen(screen)).toBe(true);
    expect(kind.value(screen)).toBe(kind.edited);
    await press(screen, "cancel-editor");
    await choose("discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });

  it("asks when the dashboard leaves, holds the edit on Keep, and on Discard leaves with the opened values back", async () => {
    const { screen, writes } = await mount();
    await kind.open(screen);
    await kind.edit(screen);
    let left = 0;
    const leave = () =>
      app.leave.coordinator.request({
        scopes: "all",
        reason: "navigation",
        proceed: () => {
          left++;
        },
      });
    const kept = leave();
    await choose("keep");
    expect(await kept).toBe("kept");
    expect(left).toBe(0);
    expect(dialogOpen(screen)).toBe(true);
    expect(kind.value(screen)).toBe(kind.edited);
    expect(unload()).toBe(true);
    const discarded = leave();
    await choose("discard");
    expect(await discarded).toBe("proceeded");
    expect(left).toBe(1);
    await settle(screen);
    expect(kind.value(screen)).toBe(kind.opened);
    expect(unload()).toBe(false);
    expect(writes).toEqual([]);
  });

  it("closes without a question when nothing was changed, or a change was put back", async () => {
    const { screen } = await mount();
    await kind.open(screen);
    await press(screen, "cancel-editor");
    await expect.poll(() => modal(screen)).toBeNull();
    expect((await question()).open).toBe(false);
    await kind.open(screen);
    await kind.edit(screen);
    await kind.revert(screen);
    expect(unload()).toBe(false);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => modal(screen)).toBeNull();
    expect((await question()).open).toBe(false);
  });

  it("commits the exact body it saved, before a refresh that fails", async () => {
    const { screen, writes } = await mount(undefined, true);
    await kind.open(screen);
    await kind.edit(screen);
    await press(screen, "save-editor");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(writes).toEqual([kind.body]);
    expect(unload()).toBe(false);
    expect((await question()).open).toBe(false);
    await expect
      .poll(() => screen.shadowRoot!.querySelector('[data-test="page-alert"]'))
      .not.toBeNull();
  });

  it("stays edited after a refused save", async () => {
    const { screen, writes } = await mount(async () => {
      throw { code: "connection.failed" };
    });
    await kind.open(screen);
    await kind.edit(screen);
    await press(screen, "save-editor");
    await expect.poll(() => cancelDisabled(screen)).toBe(false);
    expect(writes).toEqual([kind.body]);
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    await choose("keep");
    expect(dialogOpen(screen)).toBe(true);
    expect(kind.value(screen)).toBe(kind.edited);
  });

  it("lets go of the draft when the screen leaves, and protects it again against the first copy when it comes back", async () => {
    const { screen } = await mount();
    await kind.open(screen);
    await kind.edit(screen);
    screen.remove();
    expect(unload()).toBe(false);
    app.shadowRoot!.append(screen);
    await settle(screen);
    expect(kind.value(screen)).toBe(kind.edited);
    expect(unload()).toBe(true);
    await kind.revert(screen);
    expect(unload()).toBe(false);
  });
});

describe("Menu timetable: a list draft waiting behind Use normal week", () => {
  async function behindNormalWeek(write: () => Promise<void> = async () => {}) {
    let answered = 0;
    const mounted = await mount(async () => {
      if (++answered === 1)
        throw {
          code: "department_menu.in_use",
          params: {
            departmentId: "restaurant",
            menuId: "m-Brunch",
            uses: [{ kind: "period", periodId: "brunch" }],
          },
        };
      await write();
    });
    const { screen } = mounted;
    screen.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-menus"]')!.click();
    await settle(screen);
    const rows = screen.shadowRoot!.querySelectorAll('wt-modal [data-test="menu-row"]');
    rows[3]!.querySelector<HTMLElement>('[data-test="remove-menu"]')!.click();
    await settle(screen);
    await press(screen, "save-editor");
    await expect
      .poll(() => screen.shadowRoot!.querySelector('wt-modal [data-test="use-normal-week"]'))
      .not.toBeNull();
    await press(screen, "use-normal-week");
    expect(modal(screen)!.getAttribute("heading")).toBe("Use the normal week");
    return mounted;
  }

  it("keeps the list draft protected while the date is asked about, and goes back to it without a question", async () => {
    const { screen, writes } = await behindNormalWeek();
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => modal(screen)?.getAttribute("heading")).toBe("Menus for Restaurant");
    expect((await question()).open).toBe(false);
    expect(draftList(screen)).toBe("Desayunos, Cena, Café");
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    await choose("discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it("goes back to the still-edited list after the date is put on the normal week", async () => {
    const { screen, writes } = await behindNormalWeek();
    await press(screen, "save-editor");
    await expect.poll(() => modal(screen)?.getAttribute("heading")).toBe("Menus for Restaurant");
    expect(writes.at(-1)).toEqual([
      "DELETE",
      "/management-api/venue-service/special-dates/pasada/menu-timetables/restaurant",
      undefined,
    ]);
    expect(draftList(screen)).toBe("Desayunos, Cena, Café");
    expect(unload()).toBe(true);
    await press(screen, "cancel-editor");
    await choose("keep");
    expect(dialogOpen(screen)).toBe(true);
  });
});

describe("Menu timetable: what saves at once or only confirms", () => {
  it("a zone-table choice writes at once and holds nothing to protect", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { screen, writes } = await mount(() => held);
    await chooseOption(find(screen, '[name="zones.barra.periods.mananas.menuId"]')!, "m-Café");
    await settle(screen);
    expect(writes).toEqual([
      [
        "PUT",
        "/management-api/venue-service/zones/barra/period-menus/mananas",
        { menuId: "m-Café" },
      ],
    ]);
    expect(unload()).toBe(false);
    release();
    await settle(screen);
    expect(unload()).toBe(false);
  });

  it("deleting a period only confirms, so Cancel and Escape close without a question", async () => {
    const { screen, writes } = await mount();
    await rowAction(screen, "periods", "Noches", "delete-period");
    expect(unload()).toBe(false);
    await press(screen, "cancel-editor");
    await expect.poll(() => modal(screen)).toBeNull();
    await rowAction(screen, "periods", "Noches", "delete-period");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => modal(screen)).toBeNull();
    expect((await question()).open).toBe(false);
    expect(writes).toEqual([]);
  });
});
