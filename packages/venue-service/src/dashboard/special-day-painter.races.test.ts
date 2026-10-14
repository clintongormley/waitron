import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import {
  drag,
  frame,
  grid,
  painterModel,
  part,
  savedFrom,
  settle,
  specialDayApi,
  storedDay,
  type Write,
} from "../testing/special-day-painter-fixture.js";
import "./special-day-painter.js";

let painter: SpecialDayPainter | undefined;
let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  painter?.remove();
  painter = undefined;
  detach = undefined;
  setLocale("en");
});

const DEC_14 = "2026-12-14";
const DEC_15 = "2026-12-15";
const DEC_31 = "2026-12-31";
const dinner = (startsAt: string, endsAt: string) => ({ periodId: "p2", startsAt, endsAt });
const lunch = (startsAt: string, endsAt: string) => ({ periodId: "p1", startsAt, endsAt });
/** Minutes after the 06:00 changeover. */
const at = (clock: string) =>
  (Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) - 360 + 1440) % 1440;
type Body = SpecialDayInput & { expectedClockRevision: number };

/** Reads that wait while `held`, each until its release is called. */
function gate() {
  const waiting: (() => void)[] = [];
  const state = {
    held: false,
    waiting,
    after: () => (state.held ? new Promise<void>((resolve) => waiting.push(resolve)) : undefined),
  };
  return state;
}

/**
 * A painter on stored day `sd1`, fed its model by a real opening hours watch, as the screen feeds
 * it. A save is stored as the server would, then answered once `saveGate` lets it; `storedBefore`
 * runs once the save is stored and before it answers, as another manager's write landing then.
 */
async function racingPainter(live: boolean) {
  setLocale("en");
  const server = {
    day: storedDay({
      paint: [{ departmentId: "d1", date: DEC_14, ranges: [dinner("20:00", "21:00")] }],
    }),
    model: painterModel(),
  };
  const days: Record<string, SpecialDayDetail> = {
    get sd1() {
      return server.day;
    },
  };
  const writes: Write[] = [];
  const dayReads = gate();
  const modelReads = gate();
  const saves = gate();
  const hooks: { storedBefore?: () => void } = {};
  const liveData = live ? new LiveData() : undefined;
  painter = document.createElement("special-day-painter");
  painter.api = specialDayApi(writes, {
    days,
    dayAfter: dayReads.after,
    model: () => structuredClone(server.model),
    modelAfter: modelReads.after,
    liveData,
    answer: async (write) => {
      server.day = savedFrom(write, server.day);
      const answer = structuredClone(server.day);
      hooks.storedBefore?.();
      await saves.after();
      return answer;
    },
  });
  painter.specialDayId = "sd1";
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  const el = painter;
  detach = el.api.watchOpeningHours(
    (model) => {
      el.model = model;
    },
    () => {},
    () => {},
  );
  await expect.poll(() => !!el.model).toBe(true);
  await settle(el);
  await expect.poll(() => part(el, "loading")).toBeNull();
  await expect.poll(() => grid(el)?.days.get(DEC_14)).toEqual([dinner("20:00", "21:00")]);
  const save = async () => {
    const before = writes.length;
    frame(el).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect.poll(() => writes.length).toBe(before + 1);
    return writes[before]!.body as Body;
  };
  return { painter: el, server, writes, dayReads, modelReads, saves, hooks, save };
}

async function paint(el: SpecialDayPainter, period: "p1" | "p2", date: LocalDate, span: string[]) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="paint-${period}"]`)!.click();
  await settle(el);
  await drag(el, date, at(span[0]!), at(span[1]!));
}
const pause = async (el: SpecialDayPainter) => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle(el);
};

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "another manager's paint on a date this draft did not change shows, on an owner the draft changed, and the next save does not send the old paint back (%s)",
  async (_, live) => {
    const { painter, server, save } = await racingPainter(live);
    await paint(painter, "p2", DEC_15, ["19:00", "22:00"]);
    server.day = storedDay({
      dates: [...storedDay().dates, { date: DEC_31, closedAllDay: false }],
      paint: [
        { departmentId: "d1", date: DEC_14, ranges: [dinner("20:00", "22:00")] },
        { departmentId: "d1", date: DEC_31, ranges: [lunch("13:00", "16:00")] },
      ],
    });
    painter.api.rereadWatches();
    await expect.poll(() => grid(painter).days.get(DEC_31)).toEqual([lunch("13:00", "16:00")]);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("20:00", "22:00")]);
    expect(grid(painter).days.get(DEC_15)).toEqual([dinner("19:00", "22:00")]);

    await paint(painter, "p1", DEC_14, ["10:00", "11:00"]);
    const body = await save();
    expect(body.paint).toEqual([
      {
        departmentId: "d1",
        date: DEC_14,
        ranges: [lunch("10:00", "11:00"), dinner("20:00", "22:00")],
      },
      { departmentId: "d1", date: DEC_15, ranges: [dinner("19:00", "22:00")] },
    ]);
  },
);

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "another manager's paint stored while a save is in flight shows at the first read after it, beside paint made since the save (%s)",
  async (_, live) => {
    const { painter, server, modelReads, saves, hooks, save } = await racingPainter(live);
    await paint(painter, "p2", DEC_15, ["19:00", "22:00"]);
    saves.held = true;
    hooks.storedBefore = () => {
      server.day = {
        ...server.day,
        paint: server.day.paint.map((entry) =>
          entry.date === DEC_14 ? { ...entry, ranges: [dinner("20:00", "22:00")] } : entry,
        ),
      };
    };
    await save();
    await expect.poll(() => saves.waiting.length).toBe(1);
    modelReads.held = true;
    saves.held = false;
    saves.waiting.shift()!();
    await expect.poll(() => frame(painter).busy).toBe(false);
    await expect.poll(() => modelReads.waiting.length).toBe(1);
    await paint(painter, "p1", DEC_15, ["10:00", "11:00"]);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("20:00", "21:00")]);
    modelReads.held = false;
    modelReads.waiting.shift()!();
    await expect.poll(() => grid(painter).days.get(DEC_14)).toEqual([dinner("20:00", "22:00")]);
    expect(grid(painter).days.get(DEC_15)).toEqual([
      lunch("10:00", "11:00"),
      dinner("19:00", "22:00"),
    ]);

    hooks.storedBefore = undefined;
    const body = await save();
    expect(body.paint).toEqual([
      {
        departmentId: "d1",
        date: DEC_15,
        ranges: [lunch("10:00", "11:00"), dinner("19:00", "22:00")],
      },
    ]);
  },
);

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "a read of the day that started before a save and answers after it does not undo the save (%s)",
  async (_, live) => {
    const { painter, dayReads, modelReads, save } = await racingPainter(live);
    dayReads.held = true;
    painter.api.rereadWatches();
    await expect.poll(() => dayReads.waiting.length).toBe(1);
    dayReads.held = false;
    await paint(painter, "p2", DEC_15, ["19:00", "22:00"]);
    modelReads.held = true;
    await save();
    await expect.poll(() => frame(painter).busy).toBe(false);
    dayReads.waiting.shift()!();
    await pause(painter);
    expect(grid(painter).days.get(DEC_15)).toEqual([dinner("19:00", "22:00")]);
    expect(frame(painter).dirty).toBe(false);
    modelReads.held = false;
    for (const release of modelReads.waiting.splice(0)) release();
  },
);

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "a model read that started before a save and answers after the save's own reread does not replace its model (%s)",
  async (_, live) => {
    const { painter, server, modelReads, save } = await racingPainter(live);
    modelReads.held = true;
    painter.api.rereadWatches();
    await expect.poll(() => modelReads.waiting.length).toBe(1);
    await paint(painter, "p2", DEC_15, ["19:00", "22:00"]);
    // The clock moves on during the save, as another manager's changeover edit would move it.
    server.model = { ...painterModel(), clockRevision: 5 };
    const shown = painter.model;
    await save();
    await expect.poll(() => frame(painter).busy).toBe(false);
    if (live) {
      // Live data reads one at a time, so the save's reread starts once the older read answers.
      modelReads.waiting[0]!();
      await pause(painter);
      expect(painter.model).toBe(shown);
    }
    await expect.poll(() => modelReads.waiting.length).toBe(2);
    modelReads.held = false;
    modelReads.waiting[1]!();
    await expect.poll(() => painter.model.clockRevision).toBe(5);
    modelReads.waiting[0]!();
    await pause(painter);
    expect(painter.model.clockRevision).toBe(5);

    await paint(painter, "p1", DEC_14, ["10:00", "11:00"]);
    const body = await save();
    expect(body.expectedClockRevision).toBe(5);
  },
);
