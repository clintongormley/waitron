import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, registerIcons } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { StaffingBlock } from "../slots.js";
import type { SeasonStaffing, SeasonStaffingEdit } from "../staffing-types.js";
import type { StaffingGrid } from "./staffing-grid.js";
import type { StaffingSeasonPainter } from "./staffing-season-painter.js";
import "./staffing-season-painter.js";
import {
  STAFF_ROLES,
  headChef,
  seasonApi,
  seasonStaffing,
  sous,
  type SeasonApiOptions,
} from "../testing/season-staffing-fixture.js";

import { LUNCH_GUIDE, BAR_GUIDE } from "../testing/season-staffing-fixture.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

let painter: StaffingSeasonPainter | undefined;
beforeEach(() => setLocale("en"));
afterEach(() => {
  painter?.remove();
  painter = undefined;
  setLocale("en");
});

interface Options extends SeasonApiOptions {
  seasonId?: string;
  area?: string;
  readOnly?: boolean;
}
async function mount(options: Options = {}) {
  const { api, request } = seasonApi(options);
  const open = vi.fn();
  painter = document.createElement("staffing-season-painter");
  painter.api = api;
  painter.seasonId = options.seasonId ?? "winter";
  painter.month = "2026-12";
  if (options.area) painter.area = options.area;
  painter.readOnly = options.readOnly ?? false;
  painter.open = open;
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  return { painter, request, open };
}
async function settle(el: StaffingSeasonPainter) {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
}
const root = (el: StaffingSeasonPainter) => el.shadowRoot!;
const frame = (el: StaffingSeasonPainter) =>
  root(el).querySelector<HTMLElementTagNameMap["painter-frame"]>("painter-frame")!;
/** The frame sends painter-close from wt-modal's wt-close, which the browser fires on the next
 *  rendered frame, so a test waits for it rather than for a timer. */
function closed(painter: StaffingSeasonPainter) {
  return new Promise<void>((resolve) =>
    frame(painter).addEventListener("painter-close", () => resolve(), { once: true }),
  );
}
const grid = (el: StaffingSeasonPainter) => root(el).querySelector<StaffingGrid>("staffing-grid")!;
const byTest = (el: StaffingSeasonPainter, test: string) =>
  root(el).querySelector<HTMLElement>(`[data-test="${test}"]`);
const picker = (el: StaffingSeasonPainter) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=area]")!;
const saveButton = (el: StaffingSeasonPainter) =>
  frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
async function pick(el: StaffingSeasonPainter, value: string) {
  picker(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function paint(el: StaffingSeasonPainter, key: string, blocks: StaffingBlock[]) {
  grid(el).dispatchEvent(
    new CustomEvent("staffing-change", { detail: { key, blocks }, bubbles: true, composed: true }),
  );
  await settle(el);
}
const dinner: StaffingBlock = {
  staffRoleId: "sc",
  headcount: 1,
  startsAt: "19:00",
  endsAt: "23:00",
};

it("titles the season's week and draws the first area's weekdays, Monday first, from one passive read", async () => {
  const { painter, request } = await mount();
  expect(frame(painter).open).toBe(true);
  expect(frame(painter).heading).toBe("Winter week");
  expect(byTest(painter, "season")!.textContent!.trim()).toBe("Winter · 1 Dec – 28 Feb");
  expect(grid(painter).columns.map(({ key }) => key)).toEqual(["1", "2", "3", "4", "5", "6", "0"]);
  expect(grid(painter).columns.map(({ label }) => label)).toEqual([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);
  expect(grid(painter).days.get("2")).toEqual([headChef]);
  expect(grid(painter).days.get("1")).toEqual([]);
  expect(grid(painter).cutover).toBe("06:00");
  expect(grid(painter).target).toBe("winter/department:dep-restaurant");
  expect(request).toHaveBeenCalledWith(
    "/management-api/staffing/seasons/winter",
    "GET",
    undefined,
    {
      passive: true,
    },
  );
});

it("keeps the same columns from one render to the next", async () => {
  const { painter } = await mount();
  const columns = grid(painter).columns;
  await paint(painter, "3", [dinner]);
  expect(grid(painter).columns).toBe(columns);
});

it("steps to the previous and next season through the address, keeping the month and area", async () => {
  const { painter, open } = await mount({ area: "station:st-kitchen" });
  byTest(painter, "next-season")!.click();
  expect(open).toHaveBeenLastCalledWith("staffing", {
    month: "2026-12",
    area: "station:st-kitchen",
    painter: "season",
    season: "spring",
  });
  byTest(painter, "previous-season")!.click();
  expect(open).toHaveBeenLastCalledWith("staffing", {
    month: "2026-12",
    area: "station:st-kitchen",
    painter: "season",
    season: "autumn",
  });
});

it("reads the new season when the address steps to it", async () => {
  const { painter, request } = await mount();
  painter.seasonId = "spring";
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(grid(painter).days.get("2")).toEqual([]);
  expect(request).toHaveBeenCalledWith(
    "/management-api/staffing/seasons/spring",
    "GET",
    undefined,
    { passive: true },
  );
});

it("cannot step with only one season", async () => {
  const one = async () => ({ ...seasonStaffing(), seasons: [seasonStaffing().seasons[2]!] });
  const { painter, open } = await mount({ read: one });
  const previous = byTest(painter, "previous-season") as HTMLElementTagNameMap["wt-button"];
  expect(previous.disabled).toBe(true);
  previous.click();
  byTest(painter, "next-season")!.click();
  expect(open).not.toHaveBeenCalled();
});

it("lists the departments and then the prep stations, grouped, and starts from the address's area", async () => {
  const { painter } = await mount({ area: "station:st-kitchen" });
  expect(picker(painter).options).toEqual([
    { value: "department:dep-restaurant", label: "Restaurant", group: "Departments" },
    { value: "department:dep-bar", label: "Bar", group: "Departments" },
    { value: "station:st-kitchen", label: "Kitchen", group: "Prep stations" },
  ]);
  expect(picker(painter).value).toBe("station:st-kitchen");
  expect(grid(painter).days.get("5")).toEqual([sous]);
});

it("starts from the first area when the address names one the season does not have", async () => {
  const { painter } = await mount({ area: "station:gone" });
  expect(picker(painter).value).toBe("department:dep-restaurant");
});

it("keeps each area's edits while the picker moves between them, never writing the address", async () => {
  const { painter, open } = await mount();
  await paint(painter, "3", [dinner]);
  await pick(painter, "department:dep-bar");
  expect(grid(painter).days.get("3")).toEqual([]);
  await paint(painter, "4", [dinner]);
  await pick(painter, "department:dep-restaurant");
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  await pick(painter, "department:dep-bar");
  expect(grid(painter).days.get("4")).toEqual([dinner]);
  await pick(painter, "station:nowhere");
  expect(picker(painter).value).toBe("department:dep-bar");
  expect(open).not.toHaveBeenCalled();
});

it("hands the grid the same hours map until the read, the area or the columns change", async () => {
  const { painter } = await mount();
  const guides = grid(painter).guides;
  await paint(painter, "3", [dinner]);
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  expect(grid(painter).guides).toBe(guides);
  await pick(painter, "station:st-kitchen");
  expect(grid(painter).guides).not.toBe(guides);
});

it("draws a department's opening hours behind its weekdays, and sending hours behind a prep station", async () => {
  const { painter } = await mount();
  expect(grid(painter).guides.get("2")).toEqual([{ ...LUNCH_GUIDE }]);
  expect(grid(painter).guides.get("3")).toEqual([]);
  await pick(painter, "station:st-kitchen");
  expect(grid(painter).guides.get("1")).toEqual([{ ...LUNCH_GUIDE, endsAt: "15:30" }]);
  expect(grid(painter).guides.get("2")).toEqual([
    { ...LUNCH_GUIDE, endsAt: "15:30" },
    { ...BAR_GUIDE, endsAt: "17:30" },
  ]);
  expect(grid(painter).guides.get("0")).toEqual([]);
});

it("offers the staff roles as chips, the first chosen, with + New staff role and How many", async () => {
  const { painter } = await mount();
  const chips = [...root(painter).querySelectorAll<HTMLElement>("[data-test^=staff-role-]")];
  expect(chips.map((chip) => chip.textContent!.trim())).toEqual(["Head chef", "Sous chef"]);
  expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  expect(grid(painter).chosen).toBe("hc");
  expect(grid(painter).staffRoles).toEqual(STAFF_ROLES);
  chips[1]!.click();
  await settle(painter);
  expect(grid(painter).chosen).toBe("sc");
  expect(byTest(painter, "new-staff-role")!.textContent!.trim()).toBe("+ New staff role");
  const howMany = root(painter).querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
    "wt-number-stepper[name=headcount]",
  )!;
  expect(howMany.min).toBe(1);
  expect(howMany.max).toBe(50);
  expect(grid(painter).headcount).toBe(1);
  howMany.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "3" }, bubbles: true, composed: true }),
  );
  await settle(painter);
  expect(grid(painter).headcount).toBe(3);
  howMany.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await settle(painter);
  expect(grid(painter).headcount).toBe(3);
});

it("+ New staff role opens the staff role dialog beside the frame, and a saved one becomes the chip", async () => {
  const { painter } = await mount();
  byTest(painter, "new-staff-role")!.click();
  await settle(painter);
  const dialog = root(painter).querySelector<HTMLElementTagNameMap["staff-role-dialog"]>(
    "painter-frame + staff-role-dialog",
  )!;
  expect(dialog.open).toBe(true);
  expect(dialog.staffRole).toBeUndefined();
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
  expect(byTest(painter, "staff-role-dw")!.getAttribute("aria-pressed")).toBe("true");
});

it("says why the staff roles could not be read", async () => {
  const { painter } = await mount({
    staffRoles: () => Promise.reject({ code: "connection.failed" }),
  });
  expect(byTest(painter, "roles-error")!.textContent).toContain("Could not load the staff roles");
});

it("Save sends only the edited area weekdays in one write, then reads the season again", async () => {
  const sent: SeasonStaffingEdit[][] = [];
  const { painter, request } = await mount({
    save: async (_, edits) => {
      sent.push(edits);
    },
  });
  expect(saveButton(painter).disabled).toBe(true);
  await paint(painter, "3", [dinner]);
  await paint(painter, "2", [headChef]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "0", [dinner]);
  expect(saveButton(painter).disabled).toBe(false);
  saveButton(painter).click();
  await settle(painter);
  expect(sent).toEqual([
    [
      { area: { kind: "department", id: "dep-restaurant" }, weekday: 3, blocks: [dinner] },
      { area: { kind: "station", id: "st-kitchen" }, weekday: 0, blocks: [dinner] },
    ],
  ]);
  expect(request).toHaveBeenCalledWith(
    "/management-api/staffing/seasons/winter",
    "PUT",
    expect.anything(),
  );
  expect(
    request.mock.calls.filter(([path, method]) => path.endsWith("/winter") && method === "GET"),
  ).toHaveLength(2);
  expect(saveButton(painter).disabled).toBe(true);
});

it("after a save, takes in the fresh read but keeps a day edited while it was on its way", async () => {
  let answer: (read: SeasonStaffing) => void = () => undefined;
  let reads = 0;
  const { painter } = await mount({
    read: (seasonId) =>
      ++reads === 1
        ? Promise.resolve(seasonStaffing(seasonId))
        : new Promise((resolve) => (answer = resolve)),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await paint(painter, "4", [dinner]);
  const fresh = seasonStaffing();
  fresh.areas[0]!.weekdays = { 1: [headChef], 3: [dinner], 4: [headChef] };
  answer(fresh);
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual([headChef]);
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  expect(grid(painter).days.get("4")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(false);
});

it("a refusal naming an edit shows that area and marks its day, keeping the draft", async () => {
  const { painter } = await mount({
    save: () => Promise.reject({ code: "staffing.invalid", params: { field: "edits.1.blocks.0" } }),
  });
  await paint(painter, "3", [dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "6", [dinner]);
  await pick(painter, "department:dep-bar");
  saveButton(painter).click();
  await settle(painter);
  expect(picker(painter).value).toBe("station:st-kitchen");
  expect(grid(painter).columnErrors).toEqual(new Map([["6", "Some of the details are not valid"]]));
  expect(frame(painter).refusal).toBe("Kitchen, Saturday: Some of the details are not valid");
  expect(grid(painter).days.get("6")).toEqual([dinner]);
  await pick(painter, "department:dep-restaurant");
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "6", []);
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(frame(painter).refusal).toBe("");
});

it("hands the grid the same column errors while only something else changes", async () => {
  const { painter } = await mount({
    save: () => Promise.reject({ code: "staffing.invalid", params: { field: "edits.1.blocks.0" } }),
  });
  await paint(painter, "3", [dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "6", [dinner]);
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
    save: () => Promise.reject({ code: "staffing.invalid", params: { field: "edits.9" } }),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(frame(painter).refusal).toBe("Some of the details are not valid");
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(false);
});

it("a refusal with no field shows the code's message", async () => {
  const { painter } = await mount({ save: () => Promise.reject({ code: "connection.failed" }) });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(frame(painter).refusal).not.toBe("");
  expect(grid(painter).columnErrors.size).toBe(0);
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
  expect(grid(painter).readOnly).toBe(true);
});

it("says it is loading, then why the season could not be read", async () => {
  let fail: (error: unknown) => void = () => undefined;
  const { painter } = await mount({
    read: () => new Promise((_, reject) => (fail = reject)),
  });
  expect(frame(painter).heading).toBe("Staffing");
  expect(byTest(painter, "loading")).not.toBeNull();
  expect(grid(painter)).toBeNull();
  fail({ code: "season.not_found" });
  await settle(painter);
  expect(byTest(painter, "loading")).toBeNull();
  expect(byTest(painter, "load-error")!.textContent).toContain("Could not load the staffing");
});

it("ignores a read that answers after the address has stepped to another season", async () => {
  let first: (read: SeasonStaffing) => void = () => undefined;
  const { painter } = await mount({
    read: (seasonId) =>
      seasonId === "winter"
        ? new Promise((resolve) => (first = resolve))
        : Promise.resolve(seasonStaffing(seasonId)),
  });
  painter.seasonId = "spring";
  await settle(painter);
  first(seasonStaffing("winter"));
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(grid(painter).days.get("2")).toEqual([]);
});

it("keeps its draft when taken off the page and put back, reading only the staff roles again", async () => {
  const { painter, request } = await mount();
  await paint(painter, "3", [dinner]);
  const parent = painter.parentNode!;
  painter.remove();
  parent.append(painter);
  await settle(painter);
  expect(
    request.mock.calls.filter(([path, method]) => path.endsWith("/winter") && method === "GET"),
  ).toHaveLength(1);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/staff-roles"))).toHaveLength(2);
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(false);
});

it("keeps the saved draft when the read after a save fails", async () => {
  let reads = 0;
  const { painter } = await mount({
    read: (seasonId) =>
      ++reads === 1
        ? Promise.resolve(seasonStaffing(seasonId))
        : Promise.reject({ code: "connection.failed" }),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(reads).toBe(2);
  expect(byTest(painter, "load-error")).toBeNull();
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  expect(saveButton(painter).disabled).toBe(true);
});

it("sends nothing more while a save is on its way", async () => {
  let finish: () => void = () => undefined;
  const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  const { painter } = await mount({ save });
  await paint(painter, "3", [dinner]);
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

it.each(["succeeds", "is refused"])(
  "a save that %s after the address stepped to another season changes nothing there",
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
    await paint(painter, "3", [dinner]);
    saveButton(painter).click();
    await settle(painter);
    painter.seasonId = "spring";
    await settle(painter);
    if (outcome === "succeeds") finish();
    else refuse({ code: "staffing.invalid", params: { field: "edits.0" } });
    await settle(painter);
    expect(frame(painter).heading).toBe("Spring week");
    expect(frame(painter).refusal).toBe("");
    expect(frame(painter).busy).toBe(false);
    expect(grid(painter).days.get("3")).toEqual([]);
    expect(saveButton(painter).disabled).toBe(true);
  },
);

it("a cleared day is an empty day", async () => {
  const { painter } = await mount();
  grid(painter).dispatchEvent(
    new CustomEvent("staffing-change", {
      detail: { key: "2", blocks: null },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(painter);
  expect(grid(painter).days.get("2")).toEqual([]);
});

it("a saved staff role the chips already show is chosen, not added again", async () => {
  const { painter } = await mount();
  byTest(painter, "new-staff-role")!.click();
  await settle(painter);
  root(painter)
    .querySelector("staff-role-dialog")!
    .dispatchEvent(
      new CustomEvent("staff-role-saved", {
        detail: STAFF_ROLES[1],
        bubbles: true,
        composed: true,
      }),
    );
  await settle(painter);
  expect(grid(painter).staffRoles).toEqual(STAFF_ROLES);
  expect(grid(painter).chosen).toBe("sc");
});

it("speaks Spanish", async () => {
  setLocale("es");
  const { painter } = await mount();
  expect(frame(painter).heading).toBe("Semana de Winter");
  expect(grid(painter).columns[0]!.label).toBe("lunes");
  expect(byTest(painter, "new-staff-role")!.textContent!.trim()).toBe("+ Nuevo rol de personal");
  expect(picker(painter).options[2]!.group).toBe("Estaciones de preparación");
});

it("keeps its draft dirty when put back on the page in a later task", async () => {
  const { painter, request } = await mount();
  await paint(painter, "3", [dinner]);
  const parent = painter.parentNode!;
  painter.remove();
  await new Promise((resolve) => setTimeout(resolve, 20));
  parent.append(painter);
  await settle(painter);
  expect(grid(painter).days.get("3")).toEqual([dinner]);
  expect(frame(painter).dirty).toBe(true);
  expect(saveButton(painter).disabled).toBe(false);
  expect(request.mock.calls.filter(([path]) => path.endsWith("/staff-roles"))).toHaveLength(2);
});

it("takes only the latest re-read after two saves, whatever order they answer in", async () => {
  const answers: ((read: SeasonStaffing) => void)[] = [];
  let reads = 0;
  const { painter } = await mount({
    read: (seasonId) =>
      ++reads === 1
        ? Promise.resolve(seasonStaffing(seasonId))
        : new Promise((resolve) => answers.push(resolve)),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await paint(painter, "3", [sous]);
  saveButton(painter).click();
  await settle(painter);
  expect(answers).toHaveLength(2);
  const older = seasonStaffing();
  older.areas[0]!.weekdays = { 2: [headChef], 3: [dinner] };
  answers[0]!(older);
  await settle(painter);
  expect(grid(painter).days.get("3")).toEqual([sous]);
  const newer = seasonStaffing();
  newer.areas[0]!.weekdays = { 2: [headChef], 3: [sous] };
  answers[1]!(newer);
  await settle(painter);
  expect(grid(painter).days.get("3")).toEqual([sous]);
  expect(saveButton(painter).disabled).toBe(true);
});

it("says the save went through but the staffing could not be read again, until a read succeeds", async () => {
  let reads = 0;
  const { painter } = await mount({
    read: (seasonId) =>
      ++reads === 2
        ? Promise.reject({ code: "connection.failed" })
        : Promise.resolve(seasonStaffing(seasonId)),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  expect(frame(painter).refusal).toMatch(/^Saved; could not refresh: /);
  await paint(painter, "4", [dinner]);
  expect(frame(painter).refusal).toMatch(/^Saved; could not refresh: /);
  saveButton(painter).click();
  await settle(painter);
  expect(reads).toBe(3);
  expect(frame(painter).refusal).toBe("");
});

it.each(["fails", "succeeds"])(
  "a re-read that %s after a later save was refused leaves the refusal shown",
  async (outcome) => {
    let answer: (read: SeasonStaffing) => void = () => undefined;
    let fail: (error: unknown) => void = () => undefined;
    let reads = 0;
    let saves = 0;
    const { painter } = await mount({
      read: (seasonId) =>
        ++reads === 1
          ? Promise.resolve(seasonStaffing(seasonId))
          : new Promise((resolve, reject) => {
              answer = resolve;
              fail = reject;
            }),
      save: () =>
        ++saves === 1 ? Promise.resolve() : Promise.reject({ code: "season.not_found" }),
    });
    await paint(painter, "3", [dinner]);
    saveButton(painter).click();
    await settle(painter);
    await paint(painter, "4", [dinner]);
    saveButton(painter).click();
    await settle(painter);
    const refusal = frame(painter).refusal;
    expect(refusal).not.toBe("");
    if (outcome === "fails") fail({ code: "connection.failed" });
    else answer(seasonStaffing());
    await settle(painter);
    expect(frame(painter).refusal).toBe(refusal);
  },
);

it("says the venue has no departments or prep stations, and draws no grid to paint", async () => {
  const { painter } = await mount({
    read: async () => ({ ...seasonStaffing(), areas: [], guides: {} }),
  });
  expect(byTest(painter, "no-areas")!.textContent).toContain("no departments or prep stations");
  expect(grid(painter)).toBeNull();
  expect(picker(painter)).toBeNull();
  expect(byTest(painter, "paint-row")).toBeNull();
  expect(byTest(painter, "season")).not.toBeNull();
});

it("puts How many back to the number it paints when it is given one it cannot use, a blank once it is left", async () => {
  const { painter } = await mount();
  const howMany = root(painter).querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
    "wt-number-stepper[name=headcount]",
  )!;
  const type = async (value: string) => {
    howMany.value = value;
    howMany.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await settle(painter);
  };
  await type("3");
  expect(howMany.value).toBe("3");
  for (const [typed, shown] of [
    ["2.5", "3"],
    ["0", "1"],
    ["60", "50"],
  ] as const) {
    await type(typed);
    expect(howMany.value).toBe(shown);
    expect(grid(painter).headcount).toBe(Number(shown));
  }
  await type("");
  expect(howMany.value).toBe("");
  expect(grid(painter).headcount).toBe(50);
  howMany.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  await settle(painter);
  expect(howMany.value).toBe("50");
});

it("drops the edits of an area a re-read no longer has, and says so beside Save", async () => {
  let answer: (read: SeasonStaffing) => void = () => undefined;
  let reads = 0;
  const { painter } = await mount({
    read: (seasonId) =>
      ++reads === 1
        ? Promise.resolve(seasonStaffing(seasonId))
        : new Promise((resolve) => (answer = resolve)),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await pick(painter, "department:dep-bar");
  await paint(painter, "4", [dinner]);
  await pick(painter, "station:st-kitchen");
  await paint(painter, "1", [dinner]);
  const fresh = seasonStaffing();
  fresh.areas = fresh.areas.filter(({ name }) => name === "Restaurant");
  answer(fresh);
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar and Kitchen were removed; their changes were dropped.");
  expect(picker(painter).value).toBe("department:dep-restaurant");
  expect(saveButton(painter).disabled).toBe(true);
  await paint(painter, "5", [dinner]);
  expect(frame(painter).refusal).toBe("");
});

it("names only the removed areas that held edits, one in the singular", async () => {
  let answer: (read: SeasonStaffing) => void = () => undefined;
  let reads = 0;
  const { painter } = await mount({
    read: (seasonId) =>
      ++reads === 1
        ? Promise.resolve(seasonStaffing(seasonId))
        : new Promise((resolve) => (answer = resolve)),
  });
  await paint(painter, "3", [dinner]);
  saveButton(painter).click();
  await settle(painter);
  await pick(painter, "department:dep-bar");
  await paint(painter, "4", [dinner]);
  const fresh = seasonStaffing();
  fresh.areas = fresh.areas.filter(({ name }) => name === "Restaurant");
  answer(fresh);
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar was removed; its changes were dropped.");
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
