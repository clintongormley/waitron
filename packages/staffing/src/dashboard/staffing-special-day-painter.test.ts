import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens, registerIcons } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { StaffingBlock } from "../slots.js";
import type { SpecialDayStaffing, SpecialDayStaffingEdit } from "../staffing-types.js";
import type { StaffingGrid } from "./staffing-grid.js";
import type { StaffingSpecialDayPainter } from "./staffing-special-day-painter.js";
import "./staffing-special-day-painter.js";
import { STAFF_ROLES, headChef, sous } from "../testing/season-staffing-fixture.js";
import {
  specialDayApi,
  specialDayStaffing,
  type SpecialDayApiOptions,
} from "../testing/special-day-staffing-fixture.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

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
}
async function mount(options: Options = {}) {
  const { api, request } = specialDayApi(options);
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

it("draws a department's opening hours that date behind it, and nothing behind a prep station", async () => {
  const { painter } = await mount();
  expect(grid(painter).guides.get("eve")).toEqual([{ startsAt: "12:00", endsAt: "16:00" }]);
  expect(grid(painter).guides.get("day")).toEqual([]);
  await pick(painter, "station:st-kitchen");
  expect([...grid(painter).guides.values()].flat()).toEqual([]);
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
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith("staffing", { month: "2026-12", area: "department:dep-bar" }),
  );
});

it("✕ without an area in the address returns to the month alone", async () => {
  const { painter, open } = await mount();
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
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

it("speaks Spanish", async () => {
  setLocale("es");
  const { painter } = await mount();
  expect(grid(painter).columns.map(({ label }) => label)).toEqual(["jue 24 dic", "vie 25 dic"]);
  expect(byTest(painter, "new-staff-role")!.textContent!.trim()).toBe("+ Nuevo rol de personal");
});
