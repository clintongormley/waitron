import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SeasonPainter } from "./season-painter.js";
import {
  drag,
  frame,
  grid,
  painterApi,
  painterModel,
  pick,
  settle,
  withBar,
  type Write,
} from "../testing/season-painter-fixture.js";
import "./season-painter.js";

let painter: SeasonPainter | undefined;
beforeEach(() => setLocale("en"));
afterEach(() => {
  painter?.remove();
  painter = undefined;
  setLocale("en");
});

async function mount(options: Partial<Pick<SeasonPainter, "zoneId" | "seasonId" | "model">> = {}) {
  const writes: Write[] = [];
  painter = document.createElement("season-painter");
  painter.api = painterApi(writes, () => ({ id: "p-new" }));
  painter.model = options.model ?? painterModel();
  painter.seasonId = options.seasonId ?? "winter";
  painter.departmentId = "d1";
  if (options.zoneId) painter.zoneId = options.zoneId;
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  await painter.updateComplete;
  await frame(painter).updateComplete;
  await grid(painter).updateComplete;
  return { painter, writes };
}
const picker = (el: SeasonPainter) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=department]")!;
const chip = (el: SeasonPainter, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);
it("titles the season's week and steps through the seasons with ‹ and ›", async () => {
  const { painter } = await mount();
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  expect(frame(painter).heading).toBe("Winter week");
  expect(chip(painter, "season")!.textContent!.trim()).toBe("Winter · 1 Dec – 28 Feb");
  expect(grid(painter).columns.map((column) => column.key)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "0",
  ]);
  expect(grid(painter).columns[0]!.label).toBe("Monday");
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
  ]);
  chip(painter, "next-season")!.click();
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(chip(painter, "season")!.textContent!.trim()).toBe("Spring · 1 Mar – 30 Nov");
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  chip(painter, "previous-season")!.click();
  await settle(painter);
  expect(frame(painter).heading).toBe("Winter week");
  expect(navigations).toEqual([
    { seasonId: "spring", departmentId: "d1", zoneId: null },
    { seasonId: "winter", departmentId: "d1", zoneId: null },
  ]);
});

it("lists each active department with its zones beneath, and says the zones follow it", async () => {
  const { painter } = await mount();
  expect(
    picker(painter).options.map(({ value, label, depth }) => [value, label, depth ?? 0]),
  ).toEqual([
    ["d1", "Restaurant", 0],
    ["zone:z1", "Dining room", 1],
    ["zone:z2", "Terrace", 1],
  ]);
  expect(picker(painter).value).toBe("d1");
  expect(chip(painter, "follows")!.textContent!.trim()).toBe(
    "Dining room and Terrace follow Restaurant",
  );
  const link = painter.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!;
  expect(link.textContent!.trim()).toBe("Periods");
  expect(link.getAttribute("href")).toBe("/manage/opening-hours/view/periods/department/d1");
  expect(chip(painter, "hint")!.textContent!.trim()).toBe(
    "Drag down a day to paint · drag over a block to replace it",
  );
});

it("a department paints its periods with Closed erasing; a zone paints Closed over the department's week drawn faded", async () => {
  const { painter } = await mount();
  expect(grid(painter).closedErases).toBe(true);
  expect(grid(painter).underlay.size).toBe(0);
  expect(chip(painter, "paint-p1")).not.toBeNull();
  expect(chip(painter, "paint-p2")).not.toBeNull();
  expect(chip(painter, "new-period")).not.toBeNull();
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  await pick(painter, "zone:z2");
  expect(navigations).toEqual([{ seasonId: "winter", departmentId: "d1", zoneId: "z2" }]);
  expect(grid(painter).closedErases).toBe(false);
  expect(grid(painter).chosen).toBeNull();
  expect(grid(painter).paintable).toEqual([null]);
  expect(grid(painter).days.get("2")).toEqual([
    { periodId: null, startsAt: "15:00", endsAt: "17:00" },
  ]);
  expect(grid(painter).underlay.get("1")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
  ]);
  expect(chip(painter, "paint-p1")).toBeNull();
  expect(chip(painter, "new-period")).toBeNull();
  expect(chip(painter, "paint-closed")!.getAttribute("aria-pressed")).toBe("true");
});

it("keeps the draft across the picker: Restaurant's paint is still there after Terrace", async () => {
  const { painter } = await mount();
  chip(painter, "paint-p2")!.click();
  await settle(painter);
  expect(chip(painter, "paint-p2")!.getAttribute("aria-pressed")).toBe("true");
  await drag(painter, "3", 14 * 60, 17 * 60);
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  await pick(painter, "zone:z2");
  expect(grid(painter).underlay.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  await drag(painter, "4", 0, 3 * 60);
  expect(grid(painter).days.get("4")).toEqual([
    { periodId: null, startsAt: "06:00", endsAt: "09:00" },
  ]);
  await pick(painter, "d1");
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: ["z2"] });
  await pick(painter, "zone:z2");
  expect(grid(painter).days.get("4")).toEqual([
    { periodId: null, startsAt: "06:00", endsAt: "09:00" },
  ]);
});

it("a live model refresh keeps an edited week and reseeds the ones not edited", async () => {
  const { painter } = await mount();
  chip(painter, "paint-p2")!.click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  const next = painterModel();
  const restaurant = next.departments[0]!;
  (restaurant.seasonWeeks[1]!.week[1]!.slots as unknown[]).splice(0, 1);
  (restaurant.zones[1]!.seasonWeeks[1]!.week[5]!.ranges as unknown[]).push({
    startsAt: "10:00",
    endsAt: "11:00",
  });
  painter.model = next;
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
  ]);
  await pick(painter, "zone:z2");
  expect(grid(painter).days.get("5")).toEqual([
    { periodId: null, startsAt: "10:00", endsAt: "11:00" },
  ]);
});

it("+ New period saves the period on its own, keeps the painting and chooses the new period", async () => {
  const { painter, writes } = await mount();
  chip(painter, "paint-p2")!.click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  chip(painter, "new-period")!.click();
  await settle(painter);
  const editor = painter.shadowRoot!.querySelector("period-editor")!;
  await editor.updateComplete;
  expect(editor.period).toBeUndefined();
  const submit = editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!;
  expect(submit.textContent!.trim()).toBe("Add and paint with it");
  for (const [name, value] of [
    ["name", "Christmas"],
    ["menuId", "m1"],
  ])
    editor
      .shadowRoot!.querySelector(`[name=${name}]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  await editor.updateComplete;
  submit.click();
  await expect.poll(() => painter.shadowRoot!.querySelector("period-editor")).toBeNull();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.url).toBe("/management-api/venue-service/departments/d1/menu-periods");
  expect(writes[0]!.method).toBe("POST");
  expect(writes[0]!.body).toMatchObject({ name: "Christmas", expectedClockRevision: 4 });
  const next = painterModel();
  (next.departments[0]!.periods as unknown[]).push({
    ...next.departments[0]!.periods[0]!,
    id: "p-new",
    name: "Christmas",
    colour: "blue",
  });
  painter.model = next;
  await settle(painter);
  expect(grid(painter).chosen).toBe("p-new");
  expect(chip(painter, "paint-p-new")!.getAttribute("aria-pressed")).toBe("true");
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  expect(frame(painter).dirty).toBe(true);
});

it("✎ opens the period editor with that period, and a refusal shows in it", async () => {
  const writes: Write[] = [];
  const { painter } = await mount();
  painter.api = painterApi(writes, () => {
    throw Object.assign(new Error("taken"), { code: "menu_period.name_taken" });
  });
  chip(painter, "edit-p1")!.click();
  await settle(painter);
  const editor = painter.shadowRoot!.querySelector("period-editor")!;
  await editor.updateComplete;
  expect(editor.period?.id).toBe("p1");
  editor
    .shadowRoot!.querySelector("[name=name]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Dinner" }, bubbles: true, composed: true }),
    );
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => editor.refusal?.code).toBe("menu_period.name_taken");
  expect(writes[0]).toMatchObject({
    url: "/management-api/venue-service/menu-periods/p1",
    method: "PATCH",
  });
  expect(painter.shadowRoot!.querySelector("period-editor")).not.toBeNull();
});

it("opens with the department's first period chosen, so a drag with no chip clicked paints it", async () => {
  const { painter } = await mount();
  expect(chip(painter, "paint-p1")!.getAttribute("aria-pressed")).toBe("true");
  expect(grid(painter).chosen).toBe("p1");
  await drag(painter, "3", 7 * 60, 9 * 60);
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "15:00" },
  ]);
});

async function createPeriod(painter: SeasonPainter) {
  chip(painter, "new-period")!.click();
  await settle(painter);
  const editor = painter.shadowRoot!.querySelector("period-editor")!;
  await editor.updateComplete;
  for (const [name, value] of [
    ["name", "Christmas"],
    ["menuId", "m1"],
  ])
    editor
      .shadowRoot!.querySelector(`[name=${name}]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => painter.shadowRoot!.querySelector("period-editor")).toBeNull();
}

it("a period created in one department is chosen only there; another department chooses its own first period", async () => {
  const { painter } = await mount({ model: withBar() });
  await createPeriod(painter);
  expect(grid(painter).chosen).toBe("p-new");
  await pick(painter, "d3");
  expect(grid(painter).chosen).toBe("q1");
  expect(chip(painter, "paint-q1")!.getAttribute("aria-pressed")).toBe("true");
  await drag(painter, "3", 7 * 60, 9 * 60);
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "q1", startsAt: "13:00", endsAt: "15:00" },
  ]);
  await pick(painter, "zone:z2");
  expect(grid(painter).chosen).toBeNull();
  expect(chip(painter, "paint-closed")!.getAttribute("aria-pressed")).toBe("true");
});

it("switching department chooses the new department's first period, leaving its week unedited", async () => {
  const { painter } = await mount({ model: withBar() });
  await createPeriod(painter);
  await pick(painter, "d3");
  expect(grid(painter).chosen).toBe("q1");
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
});

it("‹ and › are disabled when the venue has one season", async () => {
  const model = painterModel();
  const { painter } = await mount({
    model: { ...model, seasons: model.seasons.filter(({ id }) => id === "winter") },
  });
  for (const test of ["previous-season", "next-season"])
    expect((chip(painter, test) as HTMLElementTagNameMap["wt-button"]).disabled).toBe(true);
});

it("a refresh that removes the open season drops its edits, says so beside Save and moves to the season shown", async () => {
  const { painter } = await mount();
  await drag(painter, "3", 7 * 60, 9 * 60);
  expect(frame(painter).dirty).toBe(true);
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  const next = painterModel();
  painter.model = {
    ...next,
    seasons: next.seasons.filter(({ id }) => id !== "winter"),
    currentSeasonId: "spring",
  };
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(frame(painter).refusal).toBe("Winter was removed; its changes were dropped.");
  expect(frame(painter).dirty).toBe(false);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(navigations).toEqual([{ seasonId: "spring", departmentId: "d1", zoneId: null }]);
});

it("a refresh that removes an edited zone drops only that zone's edits, with a notice", async () => {
  const { painter } = await mount();
  await drag(painter, "3", 7 * 60, 9 * 60);
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  const next = painterModel();
  const restaurant = next.departments[0]!;
  painter.model = {
    ...next,
    departments: [
      { ...restaurant, zones: restaurant.zones.filter(({ id }) => id !== "z2") },
      ...next.departments.slice(1),
    ],
  };
  await settle(painter);
  expect(frame(painter).refusal).toBe("Terrace was removed; its changes were dropped.");
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  expect(frame(painter).dirty).toBe(true);
});

it("a refresh that makes an edited department inactive drops its edits, and nothing is left to save", async () => {
  const { painter } = await mount({ model: withBar() });
  await pick(painter, "d3");
  await drag(painter, "3", 7 * 60, 9 * 60);
  expect(frame(painter).dirty).toBe(true);
  const next = withBar();
  painter.model = {
    ...next,
    departments: next.departments.map((department) =>
      department.id === "d3" ? { ...department, active: false } : department,
    ),
  };
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar is no longer active; its changes were dropped.");
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(frame(painter).dirty).toBe(false);
  expect(frame(painter).heading).toBe("Winter week");
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
  ]);
});

it("paints each period chip's swatch in the period's palette colour", async () => {
  const { painter } = await mount();
  const swatch = chip(painter, "paint-p1")!.querySelector<HTMLElement>(".swatch")!;
  const probe = document.createElement("div");
  probe.style.background = "var(--wt-color-palette-green)";
  painter.shadowRoot!.append(probe);
  expect(getComputedStyle(swatch).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
  expect(getComputedStyle(probe).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  probe.remove();
});

it("read-only: only ✕, no paint row, a grid that cannot paint, and the seasons and picker still move", async () => {
  painter = document.createElement("season-painter");
  const writes: Write[] = [];
  painter.api = painterApi(writes);
  painter.model = painterModel();
  painter.seasonId = "winter";
  painter.departmentId = "d1";
  painter.readOnly = true;
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  expect(frame(painter).readOnly).toBe(true);
  expect(grid(painter).readOnly).toBe(true);
  for (const test of ["hint", "paint-closed", "paint-p1", "edit-p1", "new-period"])
    expect(chip(painter, test)).toBeNull();
  expect(painter.shadowRoot!.querySelector("[slot=row]")).toBeNull();
  await drag(painter, "3", 120, 240);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  chip(painter, "next-season")!.click();
  await settle(painter);
  await pick(painter, "zone:z2");
  expect(navigations).toEqual([
    { seasonId: "spring", departmentId: "d1", zoneId: null },
    { seasonId: "spring", departmentId: "d1", zoneId: "z2" },
  ]);
  expect(grid(painter).readOnly).toBe(true);
  expect(writes).toEqual([]);
});

it("a refresh that moves the current season keeps the season being painted and its edits", async () => {
  const { painter } = await mount();
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  chip(painter, "paint-p2")!.click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  painter.model = { ...painterModel(), currentSeasonId: "spring" };
  await settle(painter);
  expect(frame(painter).heading).toBe("Winter week");
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  expect(navigations).toEqual([]);
});

const editorOf = (el: SeasonPainter) => el.shadowRoot!.querySelector("period-editor");
async function openEditor(painter: SeasonPainter, test: string) {
  chip(painter, test)!.click();
  await settle(painter);
  const editor = editorOf(painter)!;
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  return editor;
}
async function cancelEditor(
  painter: SeasonPainter,
  editor: HTMLElementTagNameMap["period-editor"],
) {
  const closed = new Promise((resolve) => editor.addEventListener("period-close", resolve));
  editor.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await closed;
  await settle(painter);
}

it("cancelling the period editor creates nothing, keeps the painting, and + New period opens a fresh editor", async () => {
  const { painter, writes } = await mount();
  chip(painter, "paint-p2")!.click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  const first = await openEditor(painter, "new-period");
  await cancelEditor(painter, first);
  expect(editorOf(painter)).toBeNull();
  const second = await openEditor(painter, "new-period");
  expect(second).not.toBe(first);
  expect(second.period).toBeUndefined();
  await cancelEditor(painter, second);
  const third = await openEditor(painter, "edit-p1");
  expect(third.period?.id).toBe("p1");
  expect(writes).toEqual([]);
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  expect(frame(painter).dirty).toBe(true);
});

it("a save from an earlier, closed period editor writes nothing and leaves the open editor alone", async () => {
  const { painter, writes } = await mount();
  const earlier = await openEditor(painter, "edit-p1");
  await cancelEditor(painter, earlier);
  const current = await openEditor(painter, "new-period");
  earlier.dispatchEvent(
    new CustomEvent("period-save", {
      detail: { periodId: "p1", input: { name: "Brunch" } },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(painter);
  expect(writes).toEqual([]);
  expect(editorOf(painter)).toBe(current);
  expect(current.busy).toBe(false);
});

it("a refresh that removes the open season of a clean painter moves on without a notice", async () => {
  const { painter } = await mount();
  const next = painterModel();
  painter.model = {
    ...next,
    seasons: next.seasons.filter(({ id }) => id !== "winter"),
    currentSeasonId: "spring",
  };
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(frame(painter).refusal).toBe("");
  expect(frame(painter).dirty).toBe(false);
});
