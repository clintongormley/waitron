import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SeasonPainter } from "./season-painter.js";
import {
  drag,
  frame,
  grid,
  painterApi,
  painterModel,
  pick,
  settle,
  slot,
  withBar,
  withDays,
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
/** The painter model with Restaurant open 06:00–12:00 on the given weekdays, so a zone may close then. */
const openOn = (...weekdays: number[]) =>
  withDays(
    painterModel(),
    "d1",
    Object.fromEntries(weekdays.map((weekday) => [weekday, [slot("p1", "06:00", "12:00")]])),
  );
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
  expect(frame(painter).heading).toBe("Winter: standard week");
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
  expect(frame(painter).heading).toBe("Spring: standard week");
  expect(chip(painter, "season")!.textContent!.trim()).toBe("Spring · 1 Mar – 30 Nov");
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  chip(painter, "previous-season")!.click();
  await settle(painter);
  expect(frame(painter).heading).toBe("Winter: standard week");
  expect(navigations).toEqual([
    { seasonId: "spring", departmentId: "d1", zoneId: null },
    { seasonId: "winter", departmentId: "d1", zoneId: null },
  ]);
});

it("titles the painter '<season>: standard week' and says which weeks it edits, in English and Spanish", async () => {
  const { painter } = await mount();
  expect(frame(painter).heading).toBe("Winter: standard week");
  expect(chip(painter, "season")!.textContent!.trim()).toBe("Winter · 1 Dec – 28 Feb");
  const covers = chip(painter, "covers")!;
  expect(covers.getAttribute("slot")).toBe("row");
  expect(covers.textContent!.trim()).toBe(
    "Every week from 1 Dec to 28 Feb opens these hours, except on special days.",
  );
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-text-muted)";
  painter.shadowRoot!.append(probe);
  expect(getComputedStyle(covers).color, "muted").toBe(getComputedStyle(probe).color);
  probe.remove();
  const row = painter.shadowRoot!.querySelectorAll("[slot=row]");
  expect([...row].indexOf(covers), "the line sits before the paint row").toBe(0);
  expect(row.length).toBe(2);
  painter.remove();
  setLocale("es");
  const spanish = (await mount()).painter;
  expect(frame(spanish).heading).toBe("Winter: semana estándar");
  expect(chip(spanish, "covers")!.textContent!.trim()).toBe(
    "Cada semana del 1 dic al 28 feb abre con este horario, salvo los días especiales.",
  );
});

it("a viewer sees the line saying which weeks it edits too", async () => {
  painter = document.createElement("season-painter");
  painter.api = painterApi([]);
  painter.model = painterModel();
  painter.seasonId = "winter";
  painter.departmentId = "d1";
  painter.readOnly = true;
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  expect(frame(painter).heading).toBe("Winter: standard week");
  expect(chip(painter, "covers")!.textContent!.trim()).toBe(
    "Every week from 1 Dec to 28 Feb opens these hours, except on special days.",
  );
});

it("lists each active department with its zones beneath", async () => {
  const { painter } = await mount();
  expect(
    picker(painter).options.map(({ value, label, depth }) => [value, label, depth ?? 0]),
  ).toEqual([
    ["d1", "Restaurant", 0],
    ["zone:z1", "Dining room", 1],
    ["zone:z2", "Terrace", 1],
  ]);
  expect(picker(painter).value).toBe("d1");
  expect(chip(painter, "follows")).toBeNull();
  const link = painter.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!;
  expect(link.textContent!.trim()).toBe("Periods");
  expect(link.getAttribute("href")).toBe("/manage/opening-hours/view/year/window/periods");
  expect(link.hasAttribute("data-own-click")).toBe(true);
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

it("a zone's Closed stroke keeps only the times its department is open", async () => {
  const { painter } = await mount({
    model: withDays(painterModel(), "d1", { 5: [slot("p2", "19:30", "02:00")] }),
  });
  await pick(painter, "zone:z2");
  await drag(painter, "5", 17.5 * 60, 21 * 60);
  expect(grid(painter).days.get("5")).toEqual([
    { periodId: null, startsAt: "23:30", endsAt: "02:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: [], zones: ["z2"] });
});

it("a zone stroke on a day its department is closed paints nothing, leaves Save quiet and says 'A zone can only close while its department is open.' beside Save", async () => {
  const { painter } = await mount();
  await pick(painter, "zone:z2");
  await drag(painter, "3", 0, 3 * 60);
  expect(grid(painter).days.get("3")).toEqual([]);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(frame(painter).dirty).toBe(false);
  expect(
    frame(painter).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save]",
    )!.disabled,
  ).toBe(true);
  expect(frame(painter).refusal).toBe("A zone can only close while its department is open.");
});

describe("a zone's Copy to…", () => {
  /** Restaurant open Mon and Thu 13:00–16:00 and Wed 06:00–12:00; Terrace closed Mon 14:00–15:00
   *  and Wed 08:00–09:00. */
  function terraceModel() {
    const model = withDays(painterModel(), "d1", {
      3: [slot("p1", "06:00", "12:00")],
      4: [slot("p1", "13:00", "16:00")],
    });
    const terrace = model.departments[0]!.zones[1]!.seasonWeeks.find(
      ({ seasonId }) => seasonId === "winter",
    )!;
    terrace.week = terrace.week.map(({ weekday, ranges }) => ({
      weekday,
      ranges:
        weekday === 1
          ? [{ startsAt: "14:00", endsAt: "15:00" }]
          : weekday === 3
            ? [{ startsAt: "08:00", endsAt: "09:00" }]
            : ranges,
    }));
    return model;
  }
  async function copyMondayTo(el: SeasonPainter, key: string) {
    const g = grid(el);
    const menu = g.shadowRoot!.querySelector<HTMLElement>(
      `.heading[data-column="1"] wt-row-actions`,
    )!;
    await userEvent.click(menu);
    await userEvent.click(
      [...menu.querySelectorAll<HTMLElement>("wt-button")].find(
        (button) => button.textContent!.trim() === "Copy to…",
      )!,
    );
    await g.updateComplete;
    const chooser = g.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
    await userEvent.click(chooser.querySelector<HTMLInputElement>(`input[name="copyTo-${key}"]`)!);
    await g.updateComplete;
    await userEvent.click(
      [...chooser.querySelectorAll<HTMLElement>("wt-button")].find(
        (button) => button.textContent!.trim() === "Copy",
      )!,
    );
    await settle(el);
  }

  it("onto a day where none of its Closed paint lies inside the department's hours replaces that day, its own closures going, and says why beside Save", async () => {
    const { painter } = await mount({ model: terraceModel() });
    await pick(painter, "zone:z2");
    expect(grid(painter).days.get("3")).toEqual([
      { periodId: null, startsAt: "08:00", endsAt: "09:00" },
    ]);
    await copyMondayTo(painter, "3");
    expect(grid(painter).days.get("3")).toEqual([]);
    expect(grid(painter).days.get("1")).toEqual([
      { periodId: null, startsAt: "14:00", endsAt: "15:00" },
    ]);
    expect(painter.edited()).toEqual({ departments: [], zones: ["z2"] });
    expect(frame(painter).refusal).toBe("A zone can only close while its department is open.");
  });

  it("onto a day whose hours hold its Closed paint lands that paint", async () => {
    const { painter } = await mount({ model: terraceModel() });
    await pick(painter, "zone:z2");
    expect(grid(painter).days.get("4")).toEqual([]);
    await copyMondayTo(painter, "4");
    expect(grid(painter).days.get("4")).toEqual([
      { periodId: null, startsAt: "14:00", endsAt: "15:00" },
    ]);
    expect(painter.edited()).toEqual({ departments: [], zones: ["z2"] });
    expect(frame(painter).refusal).toBe("");
  });
});

it("a zone's day with its department closed shows 'Restaurant closed all day' behind its paint", async () => {
  const { painter } = await mount();
  const column = (key: string) =>
    grid(painter).shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
  expect(grid(painter).closedBehind.size).toBe(0);
  expect(column("3").querySelector(".all-closed.behind")).toBeNull();
  await pick(painter, "zone:z2");
  expect(column("3").querySelector(".all-closed.behind")!.textContent!.trim()).toBe(
    "Restaurant closed all day",
  );
  expect(column("3").querySelector(".block")).toBeNull();
  expect(column("2").querySelector(".all-closed.behind")!.textContent!.trim()).toBe(
    "Restaurant closed all day",
  );
  expect(grid(painter).days.get("2")).toEqual([
    { periodId: null, startsAt: "15:00", endsAt: "17:00" },
  ]);
  expect(column("2").querySelectorAll(".block.closed")).toHaveLength(1);
  expect(column("1").querySelector(".all-closed.behind")).toBeNull();
});

it("the label behind a zone's paint follows a refresh of its department's week and a change of language", async () => {
  const { painter } = await mount();
  const behind = (key: string) =>
    grid(painter)
      .shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${key}"] .all-closed.behind`)
      ?.textContent?.trim();
  await pick(painter, "zone:z2");
  expect(behind("3")).toBe("Restaurant closed all day");
  painter.model = openOn(3);
  await settle(painter);
  expect(behind("3")).toBeUndefined();
  expect(behind("4")).toBe("Restaurant closed all day");
  setLocale("es");
  painter.requestUpdate();
  await settle(painter);
  expect(behind("4")).toBe("Restaurant cerrado todo el día");
});

it("a painter render that changes nothing leaves a zone's grid alone", async () => {
  const { painter } = await mount();
  await pick(painter, "zone:z2");
  const updated = vi.spyOn(grid(painter) as unknown as { updated(): void }, "updated");
  for (let round = 0; round < 3; round++) {
    painter.requestUpdate();
    await painter.updateComplete;
    await grid(painter).updateComplete;
  }
  expect(updated).toHaveBeenCalledTimes(0);
});

it("widening a department's day leaves its zones unedited", async () => {
  const { painter } = await mount({
    model: withDays(painterModel(), "d1", { 2: [slot("p1", "13:00", "18:00")] }),
  });
  await drag(painter, "2", 12 * 60, 14 * 60);
  expect(grid(painter).days.get("2")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "20:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("a department change on a day its zone has no closure leaves the zone unedited", async () => {
  const { painter } = await mount();
  chip(painter, "paint-closed")!.click();
  await settle(painter);
  await drag(painter, "1", 8 * 60, 10 * 60);
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "14:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("keeps the draft across the picker: Restaurant's paint is still there after Terrace", async () => {
  const { painter } = await mount({ model: openOn(4) });
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

it("a live model refresh takes the untouched days of an edited week and reseeds the weeks not edited", async () => {
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
  expect(grid(painter).days.get("1")).toEqual([]);
  await pick(painter, "zone:z2");
  expect(grid(painter).days.get("5")).toEqual([
    { periodId: null, startsAt: "10:00", endsAt: "11:00" },
  ]);
});

it("a live model refresh on an edited zone week takes another day's change and keeps the painted day", async () => {
  const { painter } = await mount({ zoneId: "z2", model: openOn(4) });
  await drag(painter, "4", 0, 3 * 60);
  const closedMorning = [{ periodId: null, startsAt: "06:00", endsAt: "09:00" }];
  expect(grid(painter).days.get("4")).toEqual(closedMorning);
  const next = openOn(4);
  const terrace = next.departments[0]!.zones[1]!.seasonWeeks[1]!.week;
  (terrace[5]!.ranges as unknown[]).push({ startsAt: "10:00", endsAt: "11:00" });
  (terrace[4]!.ranges as unknown[]).push({ startsAt: "20:00", endsAt: "22:00" });
  painter.model = next;
  await settle(painter);
  expect(grid(painter).days.get("5")).toEqual([
    { periodId: null, startsAt: "10:00", endsAt: "11:00" },
  ]);
  expect(grid(painter).days.get("4")).toEqual(closedMorning);
  expect(painter.edited()).toEqual({ departments: [], zones: ["z2"] });
});

it("+ New period saves the period on its own, keeps the painting and chooses the new period", async () => {
  const { painter, writes } = await mount();
  chip(painter, "paint-p2")!.click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  chip(painter, "new-period")!.click();
  await settle(painter);
  const editor = painter.shadowRoot!.querySelector("period-dialog")!;
  await editor.updateComplete;
  expect(editor.period).toBeUndefined();
  const submit = editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!;
  expect(submit.textContent!.trim()).toBe("Add and paint with it");
  expect(editor.shadowRoot!.querySelector("[name=floorPlanId]")).toBeNull();
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
  await expect.poll(() => painter.shadowRoot!.querySelector("period-dialog")).toBeNull();
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

it("each period chip offers a visible '✎ Edit', named 'Edit <period>'", async () => {
  const { painter } = await mount();
  const edit = chip(painter, "edit-p1")!;
  expect(edit.textContent!.replace(/\s+/g, " ").trim()).toBe("✎ Edit");
  expect(edit.getAttribute("aria-label")).toBe("Edit Lunch");
  expect(edit.querySelector('[aria-hidden="true"]')?.textContent).toBe("✎");
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-primary-text)";
  probe.style.display = "block";
  probe.style.blockSize = "var(--wt-tap-min)";
  painter.shadowRoot!.append(probe);
  expect(edit.getBoundingClientRect().height).toBeGreaterThanOrEqual(
    probe.getBoundingClientRect().height,
  );
  expect(getComputedStyle(edit).color).toBe(getComputedStyle(probe).color);
  probe.remove();
  painter.remove();
  setLocale("es");
  const spanish = (await mount()).painter;
  const editar = chip(spanish, "edit-p1")!;
  expect(editar.textContent!.replace(/\s+/g, " ").trim()).toBe("✎ Editar");
  expect(editar.getAttribute("aria-label")).toBe("Editar Lunch");
});

it("✎ opens the period dialog with that period, and a refusal shows in it", async () => {
  const writes: Write[] = [];
  const { painter } = await mount();
  painter.api = painterApi(writes, () => {
    throw Object.assign(new Error("taken"), { code: "menu_period.name_taken" });
  });
  chip(painter, "edit-p1")!.click();
  await settle(painter);
  const editor = painter.shadowRoot!.querySelector("period-dialog")!;
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
  expect(painter.shadowRoot!.querySelector("period-dialog")).not.toBeNull();
});

const PAINTED_IN = "/management-api/venue-service/menu-periods/painted-in";
const paintedInFor = (url: string) =>
  url.startsWith(`${PAINTED_IN}?`)
    ? new URL(url, location.origin).searchParams.get("periodId")
    : undefined;
/** An api whose Painted-in read waits on the returned `answer`, counting each read and the
 *  period it asks about. */
function paintedInApi() {
  const reads: string[] = [];
  const asked: (string | null)[] = [];
  let answer!: (rows: unknown) => void;
  const api = new OpeningHoursApi((async (url: string, method: string) => {
    const periodId = paintedInFor(url);
    if (periodId !== undefined) {
      reads.push(method);
      asked.push(periodId);
      return new Promise<unknown>((resolve) => (answer = resolve));
    }
    return painterModel();
  }) as DashboardRequest);
  return { api, reads, asked, answer: (rows: unknown) => answer(rows) };
}
const paintedRows = [
  {
    periodId: "p1",
    seasons: [
      { id: "winter", name: "Winter" },
      { id: "autumn", name: "Autumn" },
    ],
    specialDays: [{ id: "sd1", name: "Christmas Day" }],
  },
  { periodId: "p2", seasons: [{ id: "spring", name: "Spring" }], specialDays: [] },
];
const paintedChips = (dialog: HTMLElementTagNameMap["period-dialog"]) =>
  [...dialog.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=painted-in] .chip")].map(
    (chip) => ({
      text: chip.textContent!.trim(),
      tag: chip.localName,
      special: chip.hasAttribute("data-special-day"),
      tinted: chip.hasAttribute("data-tint"),
    }),
  );

it("✎ opens the period dialog with where the period is painted, read once, as plain chips", async () => {
  const { painter } = await mount();
  const { api, reads, asked, answer } = paintedInApi();
  painter.api = api;
  chip(painter, "edit-p1")!.click();
  await settle(painter);
  const dialog = painter.shadowRoot!.querySelector("period-dialog")!;
  await dialog.updateComplete;
  expect(dialog.period?.id).toBe("p1");
  expect(reads).toEqual(["GET"]);
  expect(asked).toEqual(["p1"]);
  expect(dialog.shadowRoot!.querySelector("[data-test=painted-in]")).toBeNull();
  answer(paintedRows);
  await expect
    .poll(() => dialog.shadowRoot!.querySelector("[data-test=painted-in]"))
    .not.toBeNull();
  expect(paintedChips(dialog)).toEqual([
    { text: "Winter", tag: "span", special: false, tinted: true },
    { text: "Autumn", tag: "span", special: false, tinted: false },
    { text: "Christmas Day", tag: "span", special: true, tinted: false },
  ]);
  expect(dialog.shadowRoot!.querySelector("[data-test=painted-in] a")).toBeNull();
  expect(dialog.paintedInLinks).toBe(false);
  expect(dialog.departmentId).toBe("d1");
  expect(dialog.seasons).toBe(painter.model.seasons);
  expect(dialog.shadowRoot!.querySelector("[data-test=delete-period]")).toBeNull();
  await settle(painter);
  expect(reads).toEqual(["GET"]);
});

it("+ New period reads nothing and draws no Painted in; a failed or malformed read draws none either", async () => {
  const { painter } = await mount();
  const { api, reads } = paintedInApi();
  painter.api = api;
  chip(painter, "new-period")!.click();
  await settle(painter);
  const dialog = painter.shadowRoot!.querySelector("period-dialog")!;
  await dialog.updateComplete;
  expect(reads).toEqual([]);
  expect(dialog.shadowRoot!.querySelector("[data-test=painted-in]")).toBeNull();
  dialog.shadowRoot!.querySelector<HTMLElement>("[slot=cancel] wt-button")!.click();
  await expect.poll(() => painter.shadowRoot!.querySelector("period-dialog")).toBeNull();
  // Checked once the promise the dialog awaits has settled, where a failed read and a good one
  // differ: the control answers and must already show the section at that same point.
  async function editOnceReadSettles(answer: () => Promise<unknown>) {
    let read: Promise<unknown> | undefined;
    const api = new OpeningHoursApi((async (url: string) =>
      paintedInFor(url) !== undefined ? answer() : painterModel()) as DashboardRequest);
    const readPaintedIn = api.readPaintedIn.bind(api);
    api.readPaintedIn = (periodId) =>
      (read = readPaintedIn(periodId)) as ReturnType<typeof readPaintedIn>;
    painter.api = api;
    chip(painter, "edit-p1")!.click();
    await settle(painter);
    expect(read, "the Painted-in read was made").toBeDefined();
    await Promise.allSettled([read]);
    await settle(painter);
    const edit = painter.shadowRoot!.querySelector("period-dialog")!;
    await edit.updateComplete;
    expect(edit.period?.id).toBe("p1");
    const section = edit.shadowRoot!.querySelector("[data-test=painted-in]");
    edit.shadowRoot!.querySelector<HTMLElement>("[slot=cancel] wt-button")!.click();
    await expect.poll(() => painter.shadowRoot!.querySelector("period-dialog")).toBeNull();
    return section;
  }
  expect(await editOnceReadSettles(async () => paintedRows)).not.toBeNull();
  expect(
    await editOnceReadSettles(async () => {
      throw Object.assign(new Error("down"), { code: "server.unavailable" });
    }),
  ).toBeNull();
  expect(await editOnceReadSettles(async () => ({ unexpected: "shape" }))).toBeNull();
});

it("a Painted-in read that answers after the dialog closed changes nothing", async () => {
  const { painter } = await mount();
  const first = paintedInApi();
  painter.api = first.api;
  chip(painter, "edit-p1")!.click();
  await settle(painter);
  const closing = painter.shadowRoot!.querySelector("period-dialog")!;
  await closing.updateComplete;
  closing.shadowRoot!.querySelector<HTMLElement>("[slot=cancel] wt-button")!.click();
  await expect.poll(() => painter.shadowRoot!.querySelector("period-dialog")).toBeNull();
  const second = paintedInApi();
  painter.api = second.api;
  chip(painter, "edit-p2")!.click();
  await settle(painter);
  const reopened = painter.shadowRoot!.querySelector("period-dialog")!;
  await reopened.updateComplete;
  expect(reopened.period?.id).toBe("p2");
  expect(second.asked).toEqual(["p2"]);
  first.answer(paintedRows);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await settle(painter);
  await reopened.updateComplete;
  expect(reopened.paintedIn).toBeUndefined();
  expect(reopened.shadowRoot!.querySelector("[data-test=painted-in]")).toBeNull();
  second.answer(paintedRows);
  await expect.poll(() => paintedChips(reopened).map(({ text }) => text)).toEqual(["Spring"]);
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
  const editor = painter.shadowRoot!.querySelector("period-dialog")!;
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
  await expect.poll(() => painter.shadowRoot!.querySelector("period-dialog")).toBeNull();
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
  expect(frame(painter).heading).toBe("Spring: standard week");
  expect(frame(painter).refusal).toBe("Winter was removed; its changes were dropped.");
  expect(frame(painter).dirty).toBe(false);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(navigations).toEqual([{ seasonId: "spring", departmentId: "d1", zoneId: null }]);
});

it("a refresh that removes an edited zone drops only that zone's edits, with a notice", async () => {
  const { painter } = await mount({ model: openOn(4) });
  await drag(painter, "3", 7 * 60, 9 * 60);
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  const next = openOn(4);
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
  expect(frame(painter).heading).toBe("Winter: standard week");
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
  expect(painter.shadowRoot!.querySelector("[slot=row]:not([data-test=covers])")).toBeNull();
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
  expect(frame(painter).heading).toBe("Winter: standard week");
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  expect(navigations).toEqual([]);
});

const editorOf = (el: SeasonPainter) => el.shadowRoot!.querySelector("period-dialog");
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
  editor: HTMLElementTagNameMap["period-dialog"],
) {
  const closed = new Promise((resolve) => editor.addEventListener("period-close", resolve));
  editor.shadowRoot!.querySelector<HTMLElement>("[slot=cancel] wt-button")!.click();
  await closed;
  await settle(painter);
}

it("cancelling the period dialog creates nothing, keeps the painting, and + New period opens a fresh dialog", async () => {
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

it("a save from an earlier, closed period dialog writes nothing and leaves the open dialog alone", async () => {
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
  expect(frame(painter).heading).toBe("Spring: standard week");
  expect(frame(painter).refusal).toBe("");
  expect(frame(painter).dirty).toBe(false);
});

/** Restaurant as the demo venue has it: a long name, four zones and four periods. */
function busyRestaurant() {
  const model = painterModel();
  const restaurant = model.departments[0]!;
  const zone = restaurant.zones[0]!;
  const period = restaurant.periods[0]!;
  return {
    ...model,
    departments: [
      {
        ...restaurant,
        name: "Restaurant and bar",
        zones: [
          ...restaurant.zones,
          { ...zone, id: "z3", name: "Downstairs bar" },
          { ...zone, id: "z4", name: "Upstairs bar" },
        ],
        periods: [
          ...restaurant.periods,
          { ...period, id: "p3", name: "Breakfast", colour: "amber" as const },
          { ...period, id: "p4", name: "Afternoon", colour: "blue" as const },
        ],
      },
      ...model.departments.slice(1),
    ],
  };
}
/** How many lines an element's text runs to. */
function lines(el: Element): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
}
const overlap = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe.each(["en", "es"] as const)("the bar (%s)", (locale) => {
  it("at 390px fits the screen, keeps ✕, Cancel and Save on it, and leaves most of the height to the grid", async () => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(390, 844);
      setLocale(locale);
      const { painter } = await mount({ model: busyRestaurant() });
      for (const zone of [undefined, "zone:z2"]) {
        if (zone) await pick(painter, zone);
        const bar = frame(painter).shadowRoot!;
        const body = bar
          .querySelector("wt-modal")!
          .shadowRoot!.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth, "nothing in the painter scrolls sideways").toBeLessThanOrEqual(
          body.clientWidth,
        );
        for (const test of ["dismiss", "cancel", "save"]) {
          const box = bar.querySelector(`[data-test=${test}]`)!.getBoundingClientRect();
          expect(box.left, test).toBeGreaterThanOrEqual(0);
          expect(box.right, test).toBeLessThanOrEqual(390);
        }
        const shown = [
          chip(painter, "season")!,
          picker(painter),
          chip(painter, "covers")!,
          chip(painter, "periods-link")!,
        ].map((el) => el.getBoundingClientRect());
        for (const [i, box] of shown.entries()) {
          expect(box.left, `item ${i}`).toBeGreaterThanOrEqual(0);
          expect(box.right, `item ${i}`).toBeLessThanOrEqual(390);
          for (const other of shown.slice(i + 1))
            expect(overlap(box, other), `item ${i} overlaps another`).toBe(false);
        }
        expect(grid(painter).getBoundingClientRect().height).toBeGreaterThan(844 / 2);
      }
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });

  it("at 1280px the line saying which weeks it edits reads on one line", async () => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(1280, 900);
      setLocale(locale);
      const { painter } = await mount({ model: busyRestaurant() });
      expect(lines(chip(painter, "covers")!)).toBe(1);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
});

it("at 1280×900 the grid fills the space under the paint row, still showing the whole day", async () => {
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

it("at 1280×900 the week's seven days fit side by side, with no edge faded", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(1280, 900);
    const { painter } = await mount();
    const scroll = grid(painter).shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(grid(painter).columns).toHaveLength(7);
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    expect(grid(painter).hasAttribute("data-overflow")).toBe(false);
    expect(getComputedStyle(scroll).maskImage).toBe("none");
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});

it("a refresh that removes two edited zones names both in one notice", async () => {
  const { painter } = await mount({ model: openOn(3, 4) });
  await pick(painter, "zone:z1");
  await drag(painter, "3", 0, 3 * 60);
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  expect(painter.edited()).toEqual({ departments: [], zones: ["z1", "z2"] });
  const next = openOn(3, 4);
  painter.model = {
    ...next,
    departments: [{ ...next.departments[0]!, zones: [] }, ...next.departments.slice(1)],
  };
  await settle(painter);
  expect(frame(painter).refusal).toBe(
    "Dining room and Terrace were removed; their changes were dropped.",
  );
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(frame(painter).dirty).toBe(false);
});

it("a department id the venue does not hold shows its first active department", async () => {
  const { painter } = await mount({ model: withBar() });
  painter.departmentId = "gone";
  await settle(painter);
  expect(picker(painter).value).toBe("d1");
  expect(grid(painter).days.get("1")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
  ]);
  expect(grid(painter).chosen).toBe("p1");
});

it("a refresh that leaves no active department draws nothing and navigates to no department", async () => {
  const { painter } = await mount();
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  const next = painterModel();
  painter.model = {
    ...next,
    departments: next.departments.map((department) => ({ ...department, active: false })),
  };
  await painter.updateComplete;
  expect(painter.shadowRoot!.querySelector("painter-frame")).toBeNull();
  expect(navigations).toEqual([{ seasonId: "winter", departmentId: "", zoneId: null }]);
});

it("a department with no periods opens with Closed chosen", async () => {
  const model = withBar();
  const { painter } = await mount({
    model: {
      ...model,
      departments: model.departments.map((department) =>
        department.id === "d3" ? { ...department, periods: [] } : department,
      ),
    },
  });
  await pick(painter, "d3");
  expect(grid(painter).chosen).toBeNull();
  expect(chip(painter, "paint-closed")!.getAttribute("aria-pressed")).toBe("true");
  expect(chip(painter, "paint-q1")).toBeNull();
});

it("with one season, ‹ and › activated by script stay on the season and navigate nowhere", async () => {
  const model = painterModel();
  const { painter } = await mount({
    model: { ...model, seasons: model.seasons.filter(({ id }) => id === "winter") },
  });
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  await drag(painter, "3", 7 * 60, 9 * 60);
  chip(painter, "previous-season")!.click();
  chip(painter, "next-season")!.click();
  await settle(painter);
  expect(frame(painter).heading).toBe("Winter: standard week");
  expect(navigations).toEqual([]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("✎ and + New period do nothing while a period dialog is open", async () => {
  const { painter } = await mount();
  const editor = await openEditor(painter, "edit-p1");
  chip(painter, "edit-p2")!.click();
  chip(painter, "new-period")!.click();
  await settle(painter);
  expect(editorOf(painter)).toBe(editor);
  expect(editor.period?.id).toBe("p1");
});

/** Opens ✎ Lunch, renames it Brunch and submits; the PATCH is answered by `answer`. */
async function renameLunch(painter: SeasonPainter, answer: () => unknown) {
  const writes: Write[] = [];
  painter.api = painterApi(writes, answer);
  const reread = vi.spyOn(painter.api, "rereadWatches");
  const editor = await openEditor(painter, "edit-p1");
  editor
    .shadowRoot!.querySelector("[name=name]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Brunch" }, bubbles: true, composed: true }),
    );
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  return { editor, writes, reread };
}

it("✎ saving a period closes the dialog, rereads, and keeps that period chosen", async () => {
  const { painter } = await mount();
  const { writes, reread } = await renameLunch(painter, () => ({}));
  await expect.poll(() => editorOf(painter)).toBeNull();
  expect(writes[0]).toMatchObject({
    url: "/management-api/venue-service/menu-periods/p1",
    method: "PATCH",
  });
  expect(writes[0]!.body).toMatchObject({ name: "Brunch", expectedClockRevision: 4 });
  expect(reread).toHaveBeenCalledTimes(1);
  expect(grid(painter).chosen).toBe("p1");
});

it("closing the period dialog while its save is in flight keeps it open until the save lands", async () => {
  const { painter } = await mount();
  let answer!: () => void;
  const { editor } = await renameLunch(
    painter,
    () => new Promise<void>((resolve) => (answer = resolve)),
  );
  await expect.poll(() => editor.busy).toBe(true);
  editor.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await settle(painter);
  expect(editorOf(painter)).toBe(editor);
  answer();
  await expect.poll(() => editorOf(painter)).toBeNull();
});

it("a period save refused after the painter left the page puts no refusal on the dialog", async () => {
  const { painter } = await mount();
  let refuse!: (error: unknown) => void;
  const late = new Promise((_, reject) => (refuse = reject));
  const { editor, reread } = await renameLunch(painter, () => late);
  painter.remove();
  refuse({ code: "menu_period.name_taken" });
  await late.catch(() => undefined);
  await editor.updateComplete;
  expect(editor.refusal).toBeUndefined();
  expect(reread).not.toHaveBeenCalled();
});

it("a period the live model no longer lists leaves the draft, which is clean when that was its only edit", async () => {
  const { painter } = await mount();
  await drag(painter, "3", 120, 240);
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p1", startsAt: "08:00", endsAt: "10:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  const next = painterModel();
  const restaurant = next.departments[0]!;
  restaurant.periods = restaurant.periods.filter(({ id }) => id !== "p1");
  (restaurant.seasonWeeks[1]!.week[1]!.slots as unknown[]).splice(0, 1);
  painter.model = next;
  await settle(painter);
  expect(grid(painter).days.get("3")).toEqual([]);
  expect(grid(painter).days.get("1")).toEqual([]);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
});

it("the Periods link asks for the Periods window on a plain left click, and leaves every other click to the browser", async () => {
  const { painter } = await mount();
  const link = chip(painter, "periods-link")!;
  const asked: unknown[] = [];
  const seen: boolean[] = [];
  const record = (event: Event) => asked.push((event as CustomEvent).detail);
  // Bubbling on window runs after the link's own listener; cancelling here keeps the test page.
  const settled = (event: Event) => {
    seen.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener("calendar-window-open", record);
  window.addEventListener("click", settled);
  try {
    const press = (init: MouseEventInit = {}) =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...init }),
      );
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ])
      press(init);
    expect(seen).toEqual([false, false, false, false, false]);
    expect(asked).toEqual([]);
    press();
    expect(seen.at(-1)).toBe(true);
    expect(asked).toEqual([{ window: "periods" }]);
  } finally {
    document.removeEventListener("calendar-window-open", record);
    window.removeEventListener("click", settled);
  }
});
