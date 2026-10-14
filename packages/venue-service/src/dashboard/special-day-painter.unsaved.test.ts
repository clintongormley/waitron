import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SpecialDayPainter } from "./special-day-painter.js";
import {
  drag,
  frame,
  grid,
  painterModel,
  part,
  pick,
  settle,
  specialDayApi,
  storedDay,
  type Write,
} from "../testing/special-day-painter-fixture.js";
import "./special-day-painter.js";

/** Awaited before a season days read answers, while set. */
let seasonHold: Promise<unknown> | undefined;
let seasonReads = 0;
/** What a read of `sd1` finds. */
let stored = storedDay();
let dayReads = 0;
/** Awaited before a read of `sd1` answers, while set. */
let dayHold: Promise<unknown> | undefined;
const writes: Write[] = [];
class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = specialDayApi(writes, {
    days: {
      get sd1() {
        return stored;
      },
    },
    dayAfter: () => {
      dayReads++;
      return dayHold;
    },
    seasonAfter: async () => {
      seasonReads++;
      await seasonHold;
    },
  });
  model = painterModel();
  specialDayId: string | null = "sd1";
  date: string | null = null;
  override render() {
    return html`<special-day-painter
        .api=${this.api}
        .model=${this.model}
        .open=${true}
        .specialDayId=${this.specialDayId}
        .date=${this.date}
      ></special-day-painter
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("special-day-painter-leave-app", PainterApp);

let app: PainterApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  seasonHold = undefined;
  stored = storedDay();
  dayHold = undefined;
  writes.length = 0;
  setLocale("en");
});
async function mount(day: { specialDayId?: string | null; date?: string } = {}) {
  app = document.createElement("special-day-painter-leave-app") as PainterApp;
  if (day.specialDayId !== undefined) app.specialDayId = day.specialDayId;
  app.date = day.date ?? null;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const painter: SpecialDayPainter = app.shadowRoot!.querySelector("special-day-painter")!;
  await settle(painter);
  await expect.poll(() => part(painter, "loading")).toBeNull();
  await settle(painter);
  return painter as SpecialDayPainter;
}
const question = () =>
  app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>("wt-unsaved-changes")!;
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  await expect.poll(() => question().open).toBe(true);
  await question().updateComplete;
  question().shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question().open).toBe(false);
}
const dismiss = (painter: SpecialDayPainter) =>
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
const tick = (painter: SpecialDayPainter) =>
  painter.shadowRoot!.querySelector<HTMLInputElement>('input[name="closed.2026-12-14"]')!;

it("✕ with no edits closes at once", async () => {
  const painter = await mount();
  dismiss(painter);
  await expect.poll(() => painter.open).toBe(false);
  expect(question().open).toBe(false);
});

it("✕ with edits asks first: Keep stays with the edit, Discard closes", async () => {
  const painter = await mount();
  tick(painter).click();
  await settle(painter);
  dismiss(painter);
  await choose("keep");
  expect(painter.open).toBe(true);
  expect(tick(painter).checked).toBe(true);
  dismiss(painter);
  await choose("discard");
  await expect.poll(() => painter.open).toBe(false);
});

it("undoing an edit makes Save quiet again and ✕ closes without asking", async () => {
  const painter = await mount();
  tick(painter).click();
  await settle(painter);
  tick(painter).click();
  await settle(painter);
  expect(
    frame(painter).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save]",
    )!.disabled,
  ).toBe(true);
  dismiss(painter);
  await expect.poll(() => painter.open).toBe(false);
  expect(question().open).toBe(false);
});

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
it.each(["before", "after"])(
  "an edit made %s the painter is taken off the page and put back still asks before leaving",
  async (when) => {
    const painter = await mount();
    if (when === "before") {
      tick(painter).click();
      await settle(painter);
    }
    let release!: (value?: unknown) => void;
    seasonHold = new Promise((resolve) => (release = resolve));
    let answered = 0;
    const read = painter.api.readSeasonDays.bind(painter.api);
    painter.api.readSeasonDays = (...args) => read(...args).finally(() => answered++);
    const reads = seasonReads;
    const parent = painter.parentNode!;
    painter.remove();
    await painter.updateComplete;
    expect(unload()).toBe(false);
    // The season read the removal starts answers while the painter is off the page, so no update
    // after it is put back comes from that read.
    await expect.poll(() => seasonReads).toBe(reads + 1);
    release();
    await expect.poll(() => answered).toBe(1);
    await painter.updateComplete;
    seasonHold = undefined;
    parent.insertBefore(painter, parent.firstChild);
    await settle(painter);
    if (when === "after") {
      tick(painter).click();
      await settle(painter);
    }
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose("keep");
    expect(await request).toBe("kept");
    expect(tick(painter).checked).toBe(true);
    expect(unload()).toBe(true);
  },
);

it("a new day whose only edit a refresh drops no longer asks before leaving", async () => {
  const painter = await mount({ specialDayId: null, date: "2026-12-14" });
  const model = painterModel();
  app.model = {
    ...model,
    departments: model.departments.map((department) => ({ ...department, active: true })),
  };
  app.requestUpdate();
  await app.updateComplete;
  await settle(painter);
  await pick(painter, "d2");
  await drag(painter, "2026-12-14", 900, 960);
  expect(unload()).toBe(true);
  app.model = painterModel();
  app.requestUpdate();
  await app.updateComplete;
  await settle(painter);
  expect(frame(painter).refusal).toBe("Old bar is no longer active; its changes were dropped.");
  expect(unload()).toBe(false);
});

const saveButton = (painter: SpecialDayPainter) =>
  frame(painter).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
async function paintDinner(painter: SpecialDayPainter) {
  painter.shadowRoot!.querySelector<HTMLElement>('[data-test="paint-p2"]')!.click();
  await settle(painter);
  await drag(painter, "2026-12-15", 13 * 60, 16 * 60);
}
const dinner = { periodId: "p2", startsAt: "19:00", endsAt: "22:00" };

it("keeps an edited day when a fresh model arrives before the painter, put back on the page, has updated", async () => {
  const painter = await mount();
  await paintDinner(painter);
  expect(grid(painter).days.get("2026-12-15")).toEqual([dinner]);
  let release!: (value?: unknown) => void;
  dayHold = new Promise((resolve) => (release = resolve));
  const reads = dayReads;
  const parent = painter.parentNode!;
  painter.remove();
  painter.model = painterModel();
  parent.insertBefore(painter, parent.firstChild);
  await settle(painter);
  await expect.poll(() => dayReads).toBe(reads + 1);
  expect(grid(painter).days.get("2026-12-15")).toEqual([dinner]);
  expect(unload()).toBe(true);
  expect(saveButton(painter).disabled).toBe(false);
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle(painter);
  expect(grid(painter).days.get("2026-12-15")).toEqual([dinner]);
  expect(unload()).toBe(true);
  expect(saveButton(painter).disabled).toBe(false);
});

it("keeps an edited day when another manager's change to the stored day lands while the painter is off the page", async () => {
  const painter = await mount();
  await paintDinner(painter);
  const reads = dayReads;
  const parent = painter.parentNode!;
  painter.remove();
  stored = storedDay({
    paint: [
      {
        departmentId: "d1",
        date: "2026-12-14",
        ranges: [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }],
      },
    ],
  });
  painter.model = painterModel();
  await expect.poll(() => dayReads).toBe(reads + 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await painter.updateComplete;
  parent.insertBefore(painter, parent.firstChild);
  await settle(painter);
  expect(grid(painter).days.get("2026-12-14")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
  ]);
  expect(grid(painter).days.get("2026-12-15")).toEqual([dinner]);
  expect(unload()).toBe(true);
  expect(saveButton(painter).disabled).toBe(false);
});

it("an edited day keeps the clock revision it was painted under when a fresh model arrives while the painter is off the page", async () => {
  const painter = await mount();
  await paintDinner(painter);
  const parent = painter.parentNode!;
  painter.remove();
  painter.model = { ...painterModel(), clockRevision: 9 };
  await painter.updateComplete;
  parent.insertBefore(painter, parent.firstChild);
  await settle(painter);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0]!.body as { expectedClockRevision: number }).expectedClockRevision).toBe(4);
});
