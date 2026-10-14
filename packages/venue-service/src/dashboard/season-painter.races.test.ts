import { afterEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import type { MenuWeekDay, OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { drag, frame, grid, painterModel, settle } from "../testing/season-painter-fixture.js";
import type { SeasonPainter } from "./season-painter.js";
import "./season-painter.js";

type WeeksBody = {
  departments: { departmentId: string; days: MenuWeekDay[] }[];
  zones: unknown[];
  expectedClockRevision: number;
};
type HeldRead = { snapshot: OpeningHoursModel; answer: (model?: OpeningHoursModel) => void };
type HeldPut = { body: WeeksBody; store: () => void; answer: () => void };

let host: SeasonPainter | undefined;
let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  host?.remove();
  host = undefined;
  detach = undefined;
  setLocale("en");
  vi.useRealTimers();
});

/**
 * A painter on a real `OpeningHoursApi` whose server the test drives: once the painter holds a
 * model, every GET is held until answered, and a PUT is stored and answered in separate steps so
 * another manager's write can land between them. A held GET answers with the store as it was
 * when the read started, unless the test hands it another model. `server.hold = false` answers
 * GETs at once. Without live data, `timer` fakes the watch's interval so the test can fire it.
 */
async function racingPainter(live: boolean, { timer = false } = {}) {
  setLocale("en");
  const server = { stored: painterModel(), hold: true };
  const reads: HeldRead[] = [];
  const puts: HeldPut[] = [];
  const request = (async (_path: string, method: string, body: unknown) => {
    if (method === "GET") {
      const snapshot = structuredClone(server.stored);
      if (!host?.model || !server.hold) return snapshot;
      return new Promise<OpeningHoursModel>((resolve) =>
        reads.push({ snapshot, answer: (model = snapshot) => resolve(model) }),
      );
    }
    const weeks = structuredClone(body) as WeeksBody;
    return new Promise<void>((resolve) =>
      puts.push({
        body: weeks,
        store: () => {
          for (const { departmentId, days } of weeks.departments) {
            const season = server.stored.departments
              .find(({ id }) => id === departmentId)!
              .seasonWeeks.find(({ seasonId }) => seasonId === "winter")!;
            season.week = structuredClone(days);
          }
        },
        answer: () => resolve(),
      }),
    );
  }) as DashboardRequest;
  host = document.createElement("season-painter");
  const liveData = live ? new LiveData() : undefined;
  host.api = new OpeningHoursApi(request, liveData);
  host.seasonId = "winter";
  host.departmentId = "d1";
  host.open = true;
  applyTokens(host);
  document.body.append(host);
  const painter = host;
  if (timer) vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  detach = painter.api.watchOpeningHours(
    (model) => {
      painter.model = model;
    },
    () => {},
    () => {},
  );
  await expect.poll(() => !!painter.model).toBe(true);
  await settle(painter);
  const save = async () => {
    const before = puts.length;
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect.poll(() => puts.length).toBe(before + 1);
    return puts[before]!;
  };
  return { painter, server, reads, puts, save, liveData };
}

const slotsOn = (body: WeeksBody, weekday: number) =>
  body.departments[0]!.days.find((day) => day.weekday === weekday)!.slots;
const wednesday = [{ periodId: "p1", startsAt: "07:00", endsAt: "09:00" }];
const mondayDinner = [{ periodId: "p2", startsAt: "18:00", endsAt: "21:00" }];
const mondayLunch = [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }];

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "a read that started before a save cannot undo it: the week stays as saved, and the next save sends it (%s)",
  async (_, live) => {
    const { painter, reads, save } = await racingPainter(live);
    painter.api.rereadWatches();
    await expect.poll(() => reads.length).toBe(1);
    await drag(painter, "3", 60, 180);
    const first = await save();
    first.store();
    first.answer();
    await expect.poll(() => frame(painter).busy).toBe(false);
    reads[0]!.answer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(painter);
    expect(grid(painter).days.get("3")).toEqual(wednesday);

    await drag(painter, "4", 60, 180);
    await expect.poll(() => reads.length).toBe(2);
    reads[1]!.answer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(painter);
    const second = await save();
    expect(slotsOn(second.body, 3)).toEqual(wednesday);
  },
);

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "another manager's change stored after a save shows one read after the save, and the next save keeps it, even when painted before that read (%s)",
  async (_, live) => {
    const { painter, server, reads, save, liveData } = await racingPainter(live, { timer: !live });
    await drag(painter, "3", 60, 180);
    const first = await save();
    first.store();
    server.stored.departments[0]!.seasonWeeks.find(
      ({ seasonId }) => seasonId === "winter",
    )!.week.find(({ weekday }) => weekday === 1)!.slots = mondayDinner;
    const before = painter.model;
    server.hold = false;
    if (liveData) liveData.invalidate([{ type: QUERY_DEPENDENCIES["opening-hours"][0]! }]);
    else vi.advanceTimersByTime(60_000);
    await expect.poll(() => painter.model !== before).toBe(true);
    server.hold = true;
    const held = reads.length;
    first.answer();
    await expect.poll(() => frame(painter).busy).toBe(false);
    await drag(painter, "4", 60, 180);
    await expect.poll(() => reads.length).toBe(held + 1);
    reads[held]!.answer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(painter);
    expect(grid(painter).days.get("1")).toEqual(mondayDinner);

    const second = await save();
    expect(slotsOn(second.body, 1)).toEqual(mondayDinner);
    expect(slotsOn(second.body, 3)).toEqual(wednesday);
  },
);

it.each([
  ["live data", true],
  ["no live data", false],
])(
  "a read after save 1 that lands during save 2 shows no unstored hours as an edit (%s)",
  async (_, live) => {
    const { painter, server, reads, save } = await racingPainter(live);
    await drag(painter, "3", 60, 180);
    const held = reads.length;
    const first = await save();
    first.store();
    first.answer();
    await expect.poll(() => reads.length).toBe(held + 1);
    await expect.poll(() => frame(painter).busy).toBe(false);
    await drag(painter, "4", 60, 180);
    const mondayOf = () =>
      server.stored.departments[0]!.seasonWeeks.find(
        ({ seasonId }) => seasonId === "winter",
      )!.week.find(({ weekday }) => weekday === 1)!;
    mondayOf().slots = mondayDinner;
    const second = await save();
    reads[held]!.answer(structuredClone(server.stored));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(painter);
    second.store();
    second.answer();
    await expect.poll(() => frame(painter).busy).toBe(false);
    await settle(painter);
    expect(mondayOf().slots).toEqual(mondayLunch);
    expect(grid(painter).days.get("1")).toEqual(mondayLunch);
    expect(frame(painter).dirty).toBe(false);
  },
);
