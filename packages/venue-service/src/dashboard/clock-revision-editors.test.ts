import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import type { SeasonPainter } from "./season-painter.js";
import {
  drag,
  frame,
  painterApi,
  painterModel,
  pick,
  settle,
  type Write,
} from "../testing/season-painter-fixture.js";
import "./season-painter.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const el of hosts.splice(0)) el.remove();
});
const at = (clockRevision: number) => ({ ...painterModel(), clockRevision });
async function mount(kind: "department" | "zone") {
  const writes: Write[] = [];
  const el = document.createElement("season-painter");
  el.api = painterApi(writes);
  el.model = at(7);
  el.seasonId = "winter";
  el.departmentId = "d1";
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await settle(el);
  if (kind === "zone") await pick(el, "zone:z1");
  return { el, writes };
}
/** Paints Wednesday 07:00–09:00: Lunch in Restaurant's week, Closed in Dining room's. */
const paint = (el: SeasonPainter) => drag(el, "3", 60, 3 * 60);
async function save(el: SeasonPainter, writes: Write[]) {
  frame(el).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  return writes[0]!.body as {
    expectedClockRevision: number;
    departments: { days: unknown[] }[];
    zones: { days: unknown[] }[];
  };
}
const painted = (kind: "department" | "zone") =>
  kind === "department"
    ? { weekday: 3, slots: [{ periodId: "p1", startsAt: "07:00", endsAt: "09:00" }] }
    : { weekday: 3, ranges: [{ startsAt: "07:00", endsAt: "09:00" }] };

for (const kind of ["department", "zone"] as const) {
  it(`${kind} keeps a dirty draft's opening clock revision through a live model replacement`, async () => {
    const { el, writes } = await mount(kind);
    await paint(el);
    el.model = at(8);
    await settle(el);
    const body = await save(el, writes);
    expect(body.expectedClockRevision).toBe(7);
    expect((kind === "department" ? body.departments : body.zones)[0]!.days).toContainEqual(
      painted(kind),
    );
  });
}

for (const kind of ["department", "zone"] as const) {
  it(`${kind} adopts a clock-only refresh while clean before the next edit`, async () => {
    const { el, writes } = await mount(kind);
    el.model = at(8);
    await settle(el);
    await paint(el);
    const body = await save(el, writes);
    expect(body.expectedClockRevision).toBe(8);
    expect((kind === "department" ? body.departments : body.zones)[0]!.days).toContainEqual(
      painted(kind),
    );
  });
}
