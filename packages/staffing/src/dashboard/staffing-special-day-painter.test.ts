import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, registerIcons, DROPDOWN_ICONS } from "@waitron/ui";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { StaffingApi } from "./client.js";
import type { StaffingBlock } from "../slots.js";
import type { SpecialDayStaffing, SpecialDayStaffingEdit } from "../staffing-types.js";
import type { StaffingGrid } from "./staffing-grid.js";
import type { StaffingSpecialDayPainter } from "./staffing-special-day-painter.js";
import "./staffing-special-day-painter.js";
import { STAFFING_STRINGS } from "./strings.js";
import { STAFF_ROLES, headChef, sous } from "../testing/season-staffing-fixture.js";
import {
  specialDayApi,
  specialDayStaffing,
  type SpecialDayApiOptions,
} from "../testing/special-day-staffing-fixture.js";

import { LUNCH_GUIDE, BAR_GUIDE } from "../testing/season-staffing-fixture.js";

registerIcons({
  ...DROPDOWN_ICONS,
  close:
    "M3.7 2.6 8 6.9l4.3-4.3 1.1 1.1L9.1 8l4.3 4.3-1.1 1.1L8 9.1l-4.3 4.3-1.1-1.1L6.9 8 2.6 3.7Z",
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
  minus: "M2.5 7.25H13.5V8.75H2.5Z",
});

let painter: StaffingSpecialDayPainter | undefined;
beforeEach(() => setLocale("en"));
afterEach(() => {
  painter?.remove();
  painter = undefined;
  setLocale("en");
});

interface Options extends SpecialDayApiOptions {
  area?: string;
  readOnly?: boolean;
  liveData?: LiveData;
}
async function mount(options: Options = {}) {
  const { api: fixtureApi, request } = specialDayApi(options);
  const api = options.liveData
    ? new StaffingApi(request as unknown as DashboardRequest, options.liveData)
    : fixtureApi;
  const open = vi.fn();
  painter = document.createElement("staffing-special-day-painter");
  painter.api = api;
  painter.specialDayId = "xmas";
  painter.month = "2026-12";
  if (options.area) painter.area = options.area;
  painter.readOnly = options.readOnly ?? false;
  painter.open = open;
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  return { painter, request, open };
}
async function settle(el: StaffingSpecialDayPainter) {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
}
const root = (el: StaffingSpecialDayPainter) => el.shadowRoot!;
const frame = (el: StaffingSpecialDayPainter) =>
  root(el).querySelector<HTMLElementTagNameMap["painter-frame"]>("painter-frame")!;
/** The frame sends painter-close from wt-modal's wt-close, which the browser fires on the next
 *  rendered frame, so a test waits for it rather than for a timer. */
function closed(painter: StaffingSpecialDayPainter) {
  return new Promise<void>((resolve) =>
    frame(painter).addEventListener("painter-close", () => resolve(), { once: true }),
  );
}
const grid = (el: StaffingSpecialDayPainter) =>
  root(el).querySelector<StaffingGrid>("staffing-grid")!;
const byTest = (el: StaffingSpecialDayPainter, test: string) =>
  root(el).querySelector<HTMLElement>(`[data-test="${test}"]`);
const picker = (el: StaffingSpecialDayPainter) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=area]")!;
const saveButton = (el: StaffingSpecialDayPainter) =>
  frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
async function pick(el: StaffingSpecialDayPainter, value: string) {
  picker(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function paint(el: StaffingSpecialDayPainter, key: string, blocks: StaffingBlock[] | null) {
  grid(el).dispatchEvent(
    new CustomEvent("staffing-change", { detail: { key, blocks }, bubbles: true, composed: true }),
  );
  await settle(el);
}
const reads = (request: ReturnType<typeof specialDayApi>["request"]) =>
  request.mock.calls.filter(([path, method]) => path.endsWith("/xmas") && method === "GET");
const dinner: StaffingBlock = {
  staffRoleId: "sc",
  headcount: 1,
  startsAt: "19:00",
  endsAt: "23:00",
};
/** A read that answers at once the first time and, after that, only when `answer` is called. */
function heldRereads() {
  let count = 0;
  const held: { answer: (read: SpecialDayStaffing) => void } = { answer: () => undefined };
  const read = () =>
    ++count === 1
      ? Promise.resolve(specialDayStaffing())
      : new Promise<SpecialDayStaffing>((resolve) => (held.answer = resolve));
  return { read, held, count: () => count };
}

it("titles the special day and draws one column per date, which may follow the season, from one passive read", async () => {
  const { painter, request } = await mount();
  expect(frame(painter).open).toBe(true);
  expect(frame(painter).heading).toBe("Christmas");
  expect(grid(painter).columns).toEqual([
    { key: "eve", label: "Thu 24 Dec" },
    { key: "day", label: "Fri 25 Dec" },
  ]);
  expect(grid(painter).followable).toBe(true);
  expect(grid(painter).days.get("eve")).toEqual([headChef]);
  expect(grid(painter).days.get("day")).toBeNull();
  expect(grid(painter).cutover).toBe("06:00");
  expect(grid(painter).target).toBe("xmas/department:dep-restaurant");
  expect(request).toHaveBeenCalledWith(
    "/management-api/staffing/special-days/xmas",
    "GET",
    undefined,
    { passive: true },
  );
});

it("keeps the same columns from one render to the next", async () => {
  const { painter } = await mount();
  const columns = grid(painter).columns;
  await paint(painter, "day", [dinner]);
  expect(grid(painter).columns).toBe(columns);
});

it("has no stepping between special days", async () => {
  const { painter } = await mount();
  expect(byTest(painter, "previous-season")).toBeNull();
  expect(byTest(painter, "next-season")).toBeNull();
  expect(byTest(painter, "season")).toBeNull();
});

it("lists the departments and then the prep stations, grouped, and starts from the address's area", async () => {
  const { painter } = await mount({ area: "station:st-kitchen" });
  expect(picker(painter).options).toEqual([
    { value: "department:dep-restaurant", label: "Restaurant", group: "Departments" },
    { value: "department:dep-bar", label: "Bar", group: "Departments" },
    { value: "station:st-kitchen", label: "Kitchen", group: "Prep stations" },
  ]);
  expect(picker(painter).value).toBe("station:st-kitchen");
  expect(grid(painter).days.get("eve")).toEqual([sous]);
  expect(grid(painter).days.get("day")).toEqual([]);
});

it("starts from the first area when the address names one the venue does not have", async () => {
  const { painter } = await mount({ area: "station:gone" });
  expect(picker(painter).value).toBe("department:dep-restaurant");
});

it("keeps each area's edits while the picker moves between them, never writing the address", async () => {
  const { painter, open } = await mount();
  await paint(painter, "day", [dinner]);
  await pick(painter, "department:dep-bar");
  expect(grid(painter).days.get("day")).toBeNull();
  await paint(painter, "eve", []);
  await pick(painter, "department:dep-restaurant");
  expect(grid(painter).days.get("day")).toEqual([dinner]);
  await pick(painter, "department:dep-bar");
  expect(grid(painter).days.get("eve")).toEqual([]);
  await pick(painter, "station:nowhere");
  expect(picker(painter).value).toBe("department:dep-bar");
  expect(open).not.toHaveBeenCalled();
});

it("hands the grid the same hours map until the read, the area or the columns change", async () => {
  const { painter } = await mount();
  const guides = grid(painter).guides;
  await paint(painter, "eve", [dinner]);
  expect(grid(painter).days.get("eve")).toEqual([dinner]);
  expect(grid(painter).guides).toBe(guides);
  await pick(painter, "station:st-kitchen");
  expect(grid(painter).guides).not.toBe(guides);
});

it("draws a department's opening hours that date behind it, and sending hours behind a prep station", async () => {
  const { painter } = await mount();
  expect(grid(painter).guides.get("eve")).toEqual([{ ...LUNCH_GUIDE }]);
  expect(grid(painter).guides.get("day")).toEqual([]);
  await pick(painter, "station:st-kitchen");
  expect(grid(painter).guides.get("eve")).toEqual([
    { ...LUNCH_GUIDE, endsAt: "15:30" },
    { ...BAR_GUIDE, endsAt: "17:30" },
  ]);
  expect(grid(painter).guides.get("day")).toEqual([]);
});

it("draws no hours behind a date the read gives no guide for", async () => {
  const { painter } = await mount({
    read: async () => ({ ...specialDayStaffing(), guides: {} }),
  });
  expect(grid(painter).guides.get("eve")).toEqual([]);
});

it("offers the staff roles as chips, the first chosen, with + New staff role and How many", async () => {
  const { painter } = await mount();
  const chips = [...root(painter).querySelectorAll<HTMLElement>("[data-test^=staff-role-]")];
  expect(chips.map((chip) => chip.textContent!.trim())).toEqual(["Head chef", "Sous chef"]);
  expect(grid(painter).chosen).toBe("hc");
  expect(grid(painter).staffRoles).toEqual(STAFF_ROLES);
  chips[1]!.click();
  await settle(painter);
  expect(grid(painter).chosen).toBe("sc");
  expect(byTest(painter, "new-staff-role")!.textContent!.trim()).toBe("+ New staff role");
  const howMany = root(painter).querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
    "wt-number-stepper[name=headcount]",
  )!;
  howMany.value = "60";
  howMany.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "60" }, bubbles: true, composed: true }),
  );
  await settle(painter);
  expect(grid(painter).headcount).toBe(50);
  expect(howMany.value).toBe("50");
});

it("+ New staff role opens the staff role dialog beside the frame, and a saved one becomes the chip", async () => {
  const { painter } = await mount();
  byTest(painter, "new-staff-role")!.click();
  await settle(painter);
  const dialog = root(painter).querySelector<HTMLElementTagNameMap["staff-role-dialog"]>(
    "painter-frame + staff-role-dialog",
  )!;
  expect(dialog.open).toBe(true);
  expect(dialog.staffRoles).toEqual(STAFF_ROLES);
  const created = {
    id: "dw",
    name: "Dishwasher",
    colour: "amber" as const,
    position: 2,
    holderIds: [],
  };
  dialog.dispatchEvent(
    new CustomEvent("staff-role-saved", { detail: created, bubbles: true, composed: true }),
  );
  dialog.dispatchEvent(
    new CustomEvent("staff-role-close", { detail: { wrote: true }, bubbles: true, composed: true }),
  );
  await settle(painter);
  expect(dialog.open).toBe(false);
  expect(grid(painter).chosen).toBe("dw");
});

it("says why the staff roles could not be read", async () => {
  const { painter } = await mount({
    staffRoles: () => Promise.reject({ code: "connection.failed" }),
  });
  expect(byTest(painter, "roles-error")!.textContent).toContain("Could not load the staff roles");
});

it("Save sends only the edited area dates in one write, Follow the season as null and Clear as empty, then reads again", async () => {
  const sent: SpecialDayStaffingEdit[][] = [];
  const { painter, request } = await mount({
    save: async (_, edits) => {
      sent.push(edits);
    },
  });
  expect(saveButton(painter).disabled).toBe(true);
  await paint(painter, "eve", null);
  await paint(painter, "day", null);
  await pick(painter, "department:dep-bar");
  await paint(painter, "day", []);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "eve", [dinner]);
  await paint(painter, "eve", [sous]);
  expect(saveButton(painter).disabled).toBe(false);
  saveButton(painter).click();
  await settle(painter);
  expect(sent).toEqual([
    [
      { area: { kind: "department", id: "dep-restaurant" }, dateId: "eve", blocks: null },
      { area: { kind: "department", id: "dep-bar" }, dateId: "day", blocks: [] },
    ],
  ]);
  expect(request).toHaveBeenCalledWith(
    "/management-api/staffing/special-days/xmas",
    "PUT",
    expect.anything(),
  );
  expect(reads(request)).toHaveLength(2);
  expect(saveButton(painter).disabled).toBe(true);
});

it("following the season again on a date that followed it is no change", async () => {
  const { painter } = await mount();
  await paint(painter, "day", [dinner]);
  expect(saveButton(painter).disabled).toBe(false);
  await paint(painter, "day", null);
  expect(saveButton(painter).disabled).toBe(true);
});

it("after a save, takes in the fresh read but keeps a date edited while it was on its way", async () => {
  const { read, held } = heldRereads();
  const { painter } = await mount({ read });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await paint(painter, "eve", null);
  const fresh = specialDayStaffing();
  fresh.areas[0]!.dates = [
    { dateId: "eve", date: "2026-12-24", blocks: [headChef, dinner] },
    { dateId: "day", date: "2026-12-25", blocks: [dinner] },
  ];
  held.answer(fresh);
  await settle(painter);
  expect(grid(painter).days.get("eve")).toBeNull();
  expect(grid(painter).days.get("day")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(false);
});

it("a refusal naming an edit shows that area and marks its date, keeping the draft", async () => {
  const { painter } = await mount({
    save: () => Promise.reject({ code: "staffing.invalid", params: { field: "edits.1.blocks.0" } }),
  });
  await paint(painter, "day", [dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "day", [dinner]);
  await pick(painter, "department:dep-bar");
  saveButton(painter).click();
  await settle(painter);
  expect(picker(painter).value).toBe("station:st-kitchen");
  expect(grid(painter).columnErrors).toEqual(
    new Map([["day", "Some of the details are not valid"]]),
  );
  expect(frame(painter).refusal).toBe("Kitchen, Fri 25 Dec: Some of the details are not valid");
  await pick(painter, "department:dep-restaurant");
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(grid(painter).days.get("day")).toEqual([dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "day", null);
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(frame(painter).refusal).toBe("");
});

it("hands the grid the same column errors while only something else changes", async () => {
  const { painter } = await mount({
    save: () => Promise.reject({ code: "staffing.invalid", params: { field: "edits.1.blocks.0" } }),
  });
  await paint(painter, "day", [dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "day", [dinner]);
  await pick(painter, "department:dep-bar");
  saveButton(painter).click();
  await settle(painter);
  const errors = grid(painter).columnErrors;
  expect(errors.size).toBe(1);
  root(painter).querySelectorAll<HTMLElement>("[data-test^=staff-role-]")[1]!.click();
  await settle(painter);
  expect(grid(painter).chosen).toBe("sc");
  expect(grid(painter).columnErrors).toBe(errors);
});

it("any other refusal shows its message beside Save and keeps the draft", async () => {
  const { painter } = await mount({
    save: () => Promise.reject({ code: "special_day.not_found" }),
  });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(frame(painter).refusal).not.toBe("");
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(grid(painter).days.get("day")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(false);
});

it("✕ returns to the month at the address's area", async () => {
  const { painter, open } = await mount({ area: "department:dep-bar" });
  const close = closed(painter);
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await close;
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith("staffing", { month: "2026-12", area: "department:dep-bar" }),
  );
});

it("✕ without an area in the address returns to the month alone", async () => {
  const { painter, open } = await mount();
  const close = closed(painter);
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await close;
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith("staffing", { month: "2026-12" }));
});

it("read-only: only ✕, no chips, and a grid that cannot change", async () => {
  const { painter } = await mount({ readOnly: true });
  expect(frame(painter).readOnly).toBe(true);
  expect(byTest(painter, "paint-row")).toBeNull();
  expect(root(painter).querySelector("staff-role-dialog")).toBeNull();
  expect(grid(painter).readOnly).toBe(true);
});

it("says it is loading, then why the special day could not be read", async () => {
  let fail: (error: unknown) => void = () => undefined;
  const { painter } = await mount({
    read: () => new Promise((_, reject) => (fail = reject)),
  });
  expect(frame(painter).heading).toBe("Staffing");
  expect(byTest(painter, "loading")).not.toBeNull();
  expect(grid(painter)).toBeNull();
  fail({ code: "special_day.not_found" });
  await settle(painter);
  expect(byTest(painter, "loading")).toBeNull();
  expect(byTest(painter, "load-error")!.textContent).toContain("Could not load the staffing");
});

it("ignores a read that answers after the address has moved to another special day", async () => {
  let first: (read: SpecialDayStaffing) => void = () => undefined;
  const { painter } = await mount({
    read: (specialDayId) =>
      specialDayId === "xmas"
        ? new Promise((resolve) => (first = resolve))
        : Promise.resolve({ ...specialDayStaffing(), name: "New Year" }),
  });
  painter.specialDayId = "new-year";
  await settle(painter);
  first(specialDayStaffing());
  await settle(painter);
  expect(frame(painter).heading).toBe("New Year");
});

it.each(["succeeds", "is refused"])(
  "a save that %s after the address moved to another special day changes nothing there",
  async (outcome) => {
    let finish: () => void = () => undefined;
    let refuse: (error: unknown) => void = () => undefined;
    const { painter } = await mount({
      save: () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve;
          refuse = reject;
        }),
    });
    await paint(painter, "day", [dinner]);
    saveButton(painter).click();
    await settle(painter);
    painter.specialDayId = "new-year";
    await settle(painter);
    if (outcome === "succeeds") finish();
    else refuse({ code: "staffing.invalid", params: { field: "edits.0" } });
    await settle(painter);
    expect(frame(painter).refusal).toBe("");
    expect(frame(painter).busy).toBe(false);
    expect(grid(painter).days.get("day")).toBeNull();
    expect(saveButton(painter).disabled).toBe(true);
  },
);

it("sends nothing more while a save is on its way", async () => {
  let finish: () => void = () => undefined;
  const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  const { painter } = await mount({ save });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(frame(painter).busy).toBe(true);
  expect(grid(painter).readOnly).toBe(true);
  frame(painter).dispatchEvent(new CustomEvent("painter-save", { bubbles: true, composed: true }));
  await settle(painter);
  expect(save).toHaveBeenCalledTimes(1);
  finish();
  await settle(painter);
  expect(frame(painter).busy).toBe(false);
});

it("keeps its draft when taken off the page and put back, reading only the staff roles again", async () => {
  const { painter, request } = await mount();
  await paint(painter, "day", [dinner]);
  const parent = painter.parentNode!;
  painter.remove();
  await new Promise((resolve) => setTimeout(resolve, 20));
  parent.append(painter);
  await settle(painter);
  expect(reads(request)).toHaveLength(1);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/staff-roles"))).toHaveLength(2);
  expect(grid(painter).days.get("day")).toEqual([dinner]);
  expect(frame(painter).dirty).toBe(true);
});

it("says the save went through but the staffing could not be read again, until a read succeeds", async () => {
  let count = 0;
  const { painter } = await mount({
    read: () =>
      ++count === 2
        ? Promise.reject({ code: "connection.failed" })
        : Promise.resolve(specialDayStaffing()),
  });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(byTest(painter, "load-error")).toBeNull();
  expect(grid(painter).days.get("day")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(true);
  expect(frame(painter).refusal).toMatch(/^Saved; could not refresh: /);
  await paint(painter, "eve", []);
  saveButton(painter).click();
  await settle(painter);
  expect(count).toBe(3);
  expect(frame(painter).refusal).toBe("");
});

it("takes only the latest re-read after two saves, whatever order they answer in", async () => {
  const answers: ((read: SpecialDayStaffing) => void)[] = [];
  let count = 0;
  const { painter } = await mount({
    read: () =>
      ++count === 1
        ? Promise.resolve(specialDayStaffing())
        : new Promise((resolve) => answers.push(resolve)),
  });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await paint(painter, "day", [sous]);
  saveButton(painter).click();
  await settle(painter);
  expect(answers).toHaveLength(2);
  const older = specialDayStaffing();
  older.areas[0]!.dates[1]!.blocks = [dinner];
  answers[0]!(older);
  await settle(painter);
  expect(grid(painter).days.get("day")).toEqual([sous]);
  const newer = specialDayStaffing();
  newer.areas[0]!.dates[1]!.blocks = [sous];
  answers[1]!(newer);
  await settle(painter);
  expect(grid(painter).days.get("day")).toEqual([sous]);
  expect(saveButton(painter).disabled).toBe(true);
});

it.each(["fails", "succeeds"])(
  "a re-read that %s after a later save was refused leaves the refusal shown",
  async (outcome) => {
    let answer: (read: SpecialDayStaffing) => void = () => undefined;
    let fail: (error: unknown) => void = () => undefined;
    let count = 0;
    let saves = 0;
    const { painter } = await mount({
      read: () =>
        ++count === 1
          ? Promise.resolve(specialDayStaffing())
          : new Promise((resolve, reject) => {
              answer = resolve;
              fail = reject;
            }),
      save: () =>
        ++saves === 1 ? Promise.resolve() : Promise.reject({ code: "special_day.not_found" }),
    });
    await paint(painter, "day", [dinner]);
    saveButton(painter).click();
    await settle(painter);
    await paint(painter, "eve", []);
    saveButton(painter).click();
    await settle(painter);
    const refusal = frame(painter).refusal;
    expect(refusal).not.toBe("");
    if (outcome === "fails") fail({ code: "connection.failed" });
    else answer(specialDayStaffing());
    await settle(painter);
    expect(frame(painter).refusal).toBe(refusal);
  },
);

it("says the venue has no departments or prep stations, and draws no grid to paint", async () => {
  const { painter } = await mount({
    read: async () => ({ ...specialDayStaffing(), areas: [], guides: {} }),
  });
  expect(frame(painter).heading).toBe("Christmas");
  expect(byTest(painter, "no-areas")!.textContent).toContain("no departments or prep stations");
  expect(grid(painter)).toBeNull();
  expect(picker(painter)).toBeNull();
  expect(byTest(painter, "paint-row")).toBeNull();
});

it("drops the edits of an area a re-read no longer has, and says so beside Save", async () => {
  const { read, held } = heldRereads();
  const { painter } = await mount({ read });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await pick(painter, "department:dep-bar");
  await paint(painter, "eve", [dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "day", null);
  const fresh = specialDayStaffing();
  fresh.areas = fresh.areas.filter(({ name }) => name === "Restaurant");
  held.answer(fresh);
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar and Kitchen were removed; their changes were dropped.");
  expect(picker(painter).value).toBe("department:dep-restaurant");
  expect(saveButton(painter).disabled).toBe(true);
  await paint(painter, "eve", [dinner]);
  expect(frame(painter).refusal).toBe("");
});

it("drops an edit on a date a re-read no longer has, and names the date beside Save", async () => {
  const { read, held } = heldRereads();
  const { painter } = await mount({ read });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await paint(painter, "eve", []);
  const fresh = specialDayStaffing();
  for (const area of fresh.areas) area.dates = area.dates.filter(({ dateId }) => dateId !== "eve");
  held.answer(fresh);
  await settle(painter);
  expect(grid(painter).columns.map(({ key }) => key)).toEqual(["day"]);
  expect(frame(painter).refusal).toBe(
    "Thu 24 Dec was removed from this special day; its changes were dropped.",
  );
  expect(saveButton(painter).disabled).toBe(true);
});

it("names a removed area and removed dates together, and in Spanish", async () => {
  setLocale("es");
  const { read, held } = heldRereads();
  const { painter } = await mount({ read });
  await paint(painter, "day", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await paint(painter, "eve", []);
  await paint(painter, "day", []);
  await pick(painter, "department:dep-bar");
  await paint(painter, "eve", [dinner]);
  const fresh = specialDayStaffing();
  fresh.areas = fresh.areas
    .filter(({ name }) => name !== "Bar")
    .map((area) => ({ ...area, dates: [] }));
  held.answer(fresh);
  await settle(painter);
  expect(frame(painter).refusal).toBe(
    "Bar se eliminó; sus cambios se descartaron. " +
      "jue 24 dic y vie 25 dic se quitaron de este día especial; sus cambios se descartaron.",
  );
});

it("says the special day has no dates, and draws no grid to paint", async () => {
  const { painter } = await mount({
    read: async () => ({
      ...specialDayStaffing(),
      areas: specialDayStaffing().areas.map((area) => ({ ...area, dates: [] })),
      guides: {},
    }),
  });
  expect(frame(painter).heading).toBe("Christmas");
  expect(byTest(painter, "no-dates")!.textContent).toBe("This special day has no dates yet.");
  expect(grid(painter)).toBeNull();
  expect(picker(painter)).toBeNull();
  expect(byTest(painter, "paint-row")).toBeNull();
});

it("says in Spanish that the special day has no dates", async () => {
  setLocale("es");
  const { painter } = await mount({
    read: async () => ({
      ...specialDayStaffing(),
      areas: specialDayStaffing().areas.map((area) => ({ ...area, dates: [] })),
    }),
  });
  // Read from the catalogue: its word for dates is on the English-only list.
  const text = byTest(painter, "no-dates")!.textContent;
  expect(text).toBe(STAFFING_STRINGS.es["staffing.painter.no_dates"]);
  expect(text).not.toBe(STAFFING_STRINGS.en["staffing.painter.no_dates"]);
});

it("How many shows the number just chosen when it is left before the painter draws again", async () => {
  const { painter } = await mount();
  const howMany = root(painter).querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
    "wt-number-stepper[name=headcount]",
  )!;
  howMany.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "5" }, bubbles: true, composed: true }),
  );
  howMany.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  expect(howMany.value).toBe("5");
  howMany.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "2.5" }, bubbles: true, composed: true }),
  );
  expect(howMany.value).toBe("5");
  await settle(painter);
  expect(grid(painter).headcount).toBe(5);
});

it("speaks Spanish", async () => {
  setLocale("es");
  const { painter } = await mount();
  expect(grid(painter).columns.map(({ label }) => label)).toEqual(["jue 24 dic", "vie 25 dic"]);
  expect(byTest(painter, "new-staff-role")!.textContent!.trim()).toBe("+ Nuevo rol de personal");
});

it("at 1280×900 the grid fills the frame's height under the paint row, still showing the whole day", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(1280, 900);
    const { painter } = await mount();
    const slot = grid(painter).getBoundingClientRect();
    const scroll = grid(painter).shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    expect(slot.height).toBeGreaterThan(600);
    expect(Math.abs(scroll.getBoundingClientRect().bottom - slot.bottom)).toBeLessThan(1);
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});

it.each([
  { locale: "en", readOnly: false },
  { locale: "es", readOnly: false },
  { locale: "en", readOnly: true },
  { locale: "es", readOnly: true },
])(
  "A724 explains department and station shading ($locale, readOnly=$readOnly)",
  async ({ locale, readOnly }) => {
    setLocale(locale);
    const { painter } = await mount({ readOnly });
    expect(STAFFING_STRINGS.es["staffing.painter.guide_department"]).not.toBe(
      STAFFING_STRINGS.en["staffing.painter.guide_department"],
    );
    expect(STAFFING_STRINGS.es["staffing.painter.guide_station"]).not.toBe(
      STAFFING_STRINGS.en["staffing.painter.guide_station"],
    );
    expect(frame(painter).heading).toBe("Christmas");
    expect(root(painter).querySelector('[data-test="guide-hint"]')?.textContent?.trim()).toBe(
      locale === "es"
        ? STAFFING_STRINGS.es["staffing.painter.guide_department"].replace(
            "{department}",
            "Restaurant",
          )
        : "Shaded: Restaurant's opening hours, by period",
    );
    await pick(painter, "station:st-kitchen");
    expect(grid(painter).guideKind).toBe("station");
    expect(grid(painter).guideDepartmentIds).toEqual(["dep-restaurant", "dep-bar"]);
    expect(root(painter).querySelector('[data-test="guide-hint"]')?.textContent?.trim()).toBe(
      locale === "es"
        ? STAFFING_STRINGS.es["staffing.painter.guide_station"].replace("{station}", "Kitchen")
        : "Shaded: when Kitchen gets orders, one lane per department that sends it dishes",
    );
    expect(root(painter).querySelector('[data-test="paint-row"]') === null).toBe(readOnly);
  },
);

const a724LookCases = ([390, 1280] as const).flatMap((width) =>
  (["light", "dark"] as const).flatMap((theme) =>
    (["en", "es"] as const).flatMap((locale) =>
      (["department", "station"] as const).map((kind) => ({ width, theme, locale, kind })),
    ),
  ),
);
it.each(a724LookCases)(
  "A724 LOOK $width $theme $locale $kind",
  async ({ width, theme, locale, kind }) => {
    const previous = [innerWidth, innerHeight];
    try {
      await page.viewport(width, 900);
      setLocale(locale);
      const read = specialDayStaffing();
      const longName = "Restaurant and terrace with a long department name";
      read.areas[0]!.name = longName;
      for (const columns of Object.values(read.guides))
        for (const ranges of Object.values(columns))
          for (const range of ranges)
            if (range.departmentId === "dep-restaurant") range.departmentName = longName;
      read.guides["department:dep-restaurant"]!.eve!.push(
        {
          ...LUNCH_GUIDE,
          periodId: "tea",
          periodName: "Tea",
          periodColour: "amber",
          departmentName: longName,
          startsAt: "16:00",
          endsAt: "16:15",
        },
        {
          ...LUNCH_GUIDE,
          periodId: "dinner",
          periodName: "Dinner",
          periodColour: "purple",
          departmentName: longName,
          startsAt: "19:00",
          endsAt: "00:00",
        },
      );
      read.guides["station:st-kitchen"]!.eve!.push({
        ...LUNCH_GUIDE,
        periodId: "dinner",
        periodName: "Dinner",
        periodColour: "purple",
        departmentName: longName,
        startsAt: "19:00",
        endsAt: "23:30",
      });
      const { painter } = await mount({
        read: async () => read,
        area: kind === "department" ? "department:dep-restaurant" : "station:st-kitchen",
      });
      painter.setAttribute("data-theme", theme);
      await settle(painter);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(innerWidth).toBe(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const hint = root(painter).querySelector<HTMLElement>('[data-test="guide-hint"]')!;
      const hintBox = hint.getBoundingClientRect();
      expect(hintBox.width).toBeGreaterThan(0);
      expect(hintBox.left).toBeGreaterThanOrEqual(0);
      expect(hintBox.right).toBeLessThanOrEqual(width);
      const gridEl = grid(painter);
      await gridEl.updateComplete;
      expect(
        gridEl.shadowRoot!.querySelector<HTMLElement>(".day")!.getBoundingClientRect().height,
      ).toBeGreaterThan(300);
      const save = saveButton(painter)
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!
        .getBoundingClientRect();
      expect(save.width).toBeGreaterThan(0);
      expect(save.right).toBeLessThanOrEqual(width);
      expect(save.bottom).toBeLessThanOrEqual(900);
      await page.screenshot({
        path: `__screenshots__/look/a724-special-${kind}-${locale}-${theme}-${width}.png`,
      });
      if (width === 390) {
        const scroll = gridEl.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
        const ruler = gridEl.shadowRoot!.querySelector<HTMLElement>(".times")!;
        const left = ruler.getBoundingClientRect().left;
        scroll.scrollLeft = scroll.scrollWidth;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(ruler.getBoundingClientRect().left).toBeCloseTo(left, 0);
        await page.screenshot({
          path: `__screenshots__/look/a724-special-${kind}-${locale}-${theme}-${width}-scrolled.png`,
        });
      }
    } finally {
      await page.viewport(previous[0]!, previous[1]!);
      setLocale("en");
    }
  },
);

for (const [locale, hint] of [
  ["en", "Drag down a day to paint"],
  ["es", "Arrastra hacia abajo en un día para pintar"],
] as const)
  it(`A710 shows Opening hours' painting hint and creation action in ${locale}`, async () => {
    setLocale(locale);
    const { painter } = await mount();
    expect(byTest(painter, "hint")?.textContent?.trim()).toBe(hint);
    expect(byTest(painter, "guide-hint")?.textContent?.trim()).not.toBe("");
  });
for (const [locale, action] of [
  ["en", "Add and paint with it"],
  ["es", "Añadir y pintar con él"],
] as const)
  it(`A710 labels the painter's staff-role creation action in ${locale}`, async () => {
    setLocale(locale);
    const { painter } = await mount();
    byTest(painter, "new-staff-role")!.click();
    await settle(painter);
    const dialog = root(painter).querySelector("staff-role-dialog")!;
    await dialog.updateComplete;
    const save = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-staff-role]",
    )!;
    expect(save.textContent?.trim()).toBe(action);
  });

it("A710 restores the native paint-row How many text, including a correction equal to its last render", async () => {
  const { painter } = await mount();
  const control = root(painter).querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
    "wt-number-stepper[name=headcount]",
  )!;
  await control.updateComplete;
  const input = control.shadowRoot!.querySelector("input")!;
  for (const [typed, shown] of [
    ["0", "1"],
    ["60", "50"],
    ["2.5", "50"],
  ] as const) {
    input.value = typed;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(painter);
    expect(input.value, typed).toBe(shown);
    expect(grid(painter).headcount).toBe(Number(shown));
  }
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(painter);
  expect(input.value).toBe("");
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  await settle(painter);
  expect(input.value).toBe("50");
  expect(grid(painter).headcount).toBe(50);
});

it("reads the staff roles again when a role changes, not when a person does", async () => {
  const liveData = new LiveData();
  const { painter, request } = await mount({ liveData });
  const roleReads = () => request.mock.calls.filter(([path]) => path.endsWith("/staff-roles"));
  expect(roleReads()).toHaveLength(1);
  liveData.invalidate([{ type: "persons" }]);
  await settle(painter);
  expect(roleReads()).toHaveLength(1);
  liveData.invalidate([{ type: "staff_roles" }]);
  await vi.waitFor(() => expect(roleReads()).toHaveLength(2));
  liveData.clear();
});
