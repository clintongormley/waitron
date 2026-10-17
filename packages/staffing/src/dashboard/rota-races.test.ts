import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import type { RotaWeek } from "../staffing-types.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { StaffingApi } from "./client.js";
import { RotaView } from "./rota-view.js";
const A = "2026-11-30",
  B = "2026-12-07";
const frames: HTMLElement[] = [];
/** Resizes the window and waits for its `resize` event, which can land after `page.viewport`
 *  answers: left to land in the next test, it closes that test's open popup. */
async function resizeViewport(width: number, height: number) {
  if (innerWidth === width && innerHeight === height) return;
  const resized = new Promise((resolve) => addEventListener("resize", resolve, { once: true }));
  await page.viewport(width, height);
  await resized;
}
async function useViewport(width: number, height: number) {
  const before = [innerWidth, innerHeight] as const;
  await resizeViewport(width, height);
  onTestFinished(() => resizeViewport(...before));
}
/** Scrolls the page home and waits for the scroll event, so it cannot reach a later popup and
 *  close it: a popup closes on a scroll that leaves its anchor out of view. */
async function scrollHome() {
  if (scrollX === 0 && scrollY === 0) return;
  const done = new Promise((resolve) => addEventListener("scroll", resolve, { once: true }));
  scrollTo(0, 0);
  await done;
}
afterEach(async () => {
  await scrollHome();
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Warnings = { breaches: RosterBreach[]; ruleset: WorkTimeRuleset | null };
const quiet = (): Warnings => ({ breaches: [], ruleset: null });
async function mount(
  config: {
    read?: (week: string) => Promise<RotaWeek>;
    warnings?: (week: string) => Promise<Warnings>;
    publish?: () => Promise<unknown>;
    change?: (week: string) => Promise<unknown>;
    fill?: () => Promise<unknown>;
  } = {},
) {
  setLocale("en");
  const live = new LiveData();
  const request = vi.fn(async (path: string, method: string, body?: { week: string }) => {
    if (method === "GET" && path.includes("/rota?")) {
      const week = decodeURIComponent(path.split("week=")[1]!);
      return config.read ? config.read(week) : rotaWeek(week);
    }
    if (method === "GET" && path.includes("/roster/breaches?")) {
      const week = decodeURIComponent(path.split("period=")[1]!);
      return config.warnings ? config.warnings(week) : quiet();
    }
    if (path.endsWith("/publish")) return config.publish?.() ?? { breaches: [] };
    if (path.endsWith("/rota/shifts")) return config.fill?.() ?? { shiftId: "new" };
    if (path.endsWith("/change-week"))
      return config.change?.(body!.week) ?? { versionId: "copy", openSwaps: [] };
    throw Error(`unexpected ${method} ${path}`);
  });
  const api = new StaffingApi(request as unknown as DashboardRequest, live);
  const actions = {
    published: undefined as Promise<unknown> | undefined,
    changes: new Map<string, Promise<unknown>>(),
  };
  const publish = api.publishRota.bind(api);
  api.publishRota = (id) => {
    const pending = publish(id);
    actions.published = pending;
    return pending;
  };
  const change = api.changeRotaWeek.bind(api);
  api.changeRotaWeek = (week) => {
    const pending = change(week);
    actions.changes.set(week, pending);
    return pending;
  };
  let initialWarnings: Promise<void> | undefined;
  const watch = api.watchRotaWarnings.bind(api);
  api.watchRotaWarnings = (q, l, w, apply) => {
    const result = watch(q, l, w, apply);
    if (w === A) initialWarnings = result;
    return result;
  };
  const frame = document.createElement("div");
  frame.style.width = "1280px";
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = new RotaView();
  el.api = api;
  el.week = A;
  el.canWrite = true;
  el.open = () => undefined;
  frame.append(el);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-area")).toBeTruthy());
  return { el, live, request, actions, initial: () => initialWarnings! };
}
const click = (el: Element, selector: string) => {
  const b = el.shadowRoot!.querySelector<HTMLElement>(selector);
  expect(b, selector).toBeTruthy();
  b!.click();
};
const ready = async (el: RotaView) => {
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(
      (
        el.shadowRoot!.querySelector(
          "[data-test=publish-week]",
        )! as HTMLElementTagNameMap["wt-button"]
      ).disabled,
    ).toBe(false),
  );
};
it("releases the old warning read before the next week's rota arrives", async () => {
  const warnings = deferred<Warnings>(),
    read = deferred<RotaWeek>();
  const { el, request, initial } = await mount({
    read: (w) => (w === A ? Promise.resolve(rotaWeek(A)) : read.promise),
    warnings: (w) => (w === A ? warnings.promise : Promise.resolve(quiet())),
  });
  el.week = B;
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([p]) => p.endsWith(`week=${B}`))).toBe(true),
  );
  warnings.reject({ code: "connection.failed" });
  await warnings.promise.catch(() => undefined);
  await initial().catch(() => undefined);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain("Could not load labour warnings");
  read.resolve(rotaWeek(B));
  await ready(el);
});
it("keeps a newly opened publication dialog when an older week's publication answers late", async () => {
  const old = deferred<{ breaches: RosterBreach[] }>();
  const { el, actions } = await mount({ publish: () => old.promise });
  await ready(el);
  click(el, "[data-test=publish-week]");
  await el.updateComplete;
  const dialog = () =>
    el.shadowRoot!.querySelector<import("./publish-dialog.js").PublishDialog>(
      "rota-publish-dialog",
    )!;
  await dialog().updateComplete;
  click(dialog(), "[data-test=publish]");
  el.week = B;
  await ready(el);
  click(el, "[data-test=publish-week]");
  await el.updateComplete;
  expect(dialog().open).toBe(true);
  old.resolve({ breaches: [] });
  await actions.published;
  await el.updateComplete;
  expect(dialog().open).toBe(true);
  expect(dialog().week.week).toBe(B);
});
it("keeps the new week's swap notice when an older Change this week answers late", async () => {
  const old = deferred<{
    versionId: string;
    openSwaps: { swapId: string; fromShiftId: string }[];
  }>();
  let draftB = false;
  const { el, actions } = await mount({
    read: async (w) => {
      const r = rotaWeek(w);
      r.version = {
        id: w,
        status: w === B && draftB ? "draft" : "published",
        changedSincePublished: false,
      };
      return r;
    },
    change: async (w) => {
      if (w === A) return old.promise;
      draftB = true;
      return { versionId: "new-b", openSwaps: [{ swapId: "b", fromShiftId: "b" }] };
    },
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=change-week]")).toBeTruthy(),
  );
  click(el, "[data-test=change-week]");
  el.week = B;
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=change-week]")).toBeTruthy(),
  );
  click(el, "[data-test=change-week]");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 swap request is open"));
  old.resolve({
    versionId: "old-a",
    openSwaps: Array.from({ length: 4 }, () => ({ swapId: "a", fromShiftId: "a" })),
  });
  await actions.changes.get(A);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("1 swap request is open");
  expect(el.shadowRoot!.textContent).not.toContain("4 swap requests");
});
it("closes an open shift editor when another manager publishes its week", async () => {
  let published = false;
  const { el, live } = await mount({
    read: async (w) => {
      const r = rotaWeek(w);
      if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
      return r;
    },
  });
  await ready(el);
  const area = el.shadowRoot!.querySelector("rota-by-area")!;
  click(area, "[data-slot=filled]");
  await el.updateComplete;
  const editor = () =>
    el.shadowRoot!.querySelector<import("./shift-edit-dialog.js").ShiftEditDialog>(
      "rota-shift-dialog",
    )!;
  expect(editor().open).toBe(true);
  published = true;
  live.invalidate([{ type: "roster_versions" }]);
  await vi.waitFor(() => expect(editor().open).toBe(false));
});

const popupOpen = (el: RotaView) =>
  el
    .shadowRoot!.querySelector("rota-popup")!
    .shadowRoot!.querySelector("[popover]")!
    .matches(":popover-open");
async function openPicker(el: RotaView) {
  const area = el.shadowRoot!.querySelector<RotaView>("rota-by-area")!;
  await area.updateComplete;
  click(area, "[data-slot=empty]");
  await vi.waitFor(() => expect(popupOpen(el)).toBe(true));
  const picker = el.shadowRoot!.querySelector<RotaView>("slot-picker")!;
  await picker.updateComplete;
  return picker;
}
it.each(["lands", "is refused"])(
  "a fill that %s after the week has moved on leaves the new week's picker alone",
  async (outcome) => {
    const old = deferred<unknown>();
    const { el } = await mount({ fill: () => old.promise });
    click(await openPicker(el), "[data-person=marc]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeTruthy());
    el.week = B;
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<RotaView & { week: { week: string } }>("rota-by-area")?.week
          .week,
      ).toBe(B),
    );
    const picker = await openPicker(el);
    if (outcome === "lands") old.resolve({ shiftId: "late" });
    else old.reject({ code: "connection.failed" });
    await old.promise.catch(() => undefined);
    await new Promise(requestAnimationFrame);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBe(picker);
    expect(popupOpen(el)).toBe(true);
    expect(picker.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(
      picker.shadowRoot!.querySelector<HTMLButtonElement>("[data-person=marc]")!.disabled,
    ).toBe(false);
  },
);
/** A read without the areas named in `gone`, and without the slots named in `taken`, as the rota
 *  reads once an area stops being active or a slot leaves the plan on another screen. */
function without(gone: Set<string>, taken: Set<string> = new Set()) {
  return async (w: string) => {
    const r = rotaWeek(w);
    r.areas = r.areas.filter((a) => !gone.has(a.area.id));
    for (const day of r.days) {
      day.areas = day.areas.filter((a) => !gone.has(a.area.id));
      for (const a of day.areas)
        a.match.slots = a.match.slots.filter((s) => !taken.has(s.slot.key));
    }
    return r;
  };
}
const shownAreas = (el: RotaView) =>
  el.shadowRoot!.querySelector<RotaView & { week: RotaWeek }>("rota-by-area")?.week.areas.length;
it("closes the slot picker when its area stops being active, and keeps it when another area does", async () => {
  const gone = new Set<string>();
  const { el, live } = await mount({ read: without(gone) });
  const picker = await openPicker(el);
  gone.add("restaurant");
  live.invalidate([{ type: "departments" }]);
  await vi.waitFor(() => expect(shownAreas(el)).toBe(1));
  await el.updateComplete;
  await new Promise(requestAnimationFrame);
  expect(el.shadowRoot!.querySelector("slot-picker")).toBe(picker);
  expect(popupOpen(el)).toBe(true);
  gone.add("kitchen");
  live.invalidate([{ type: "kitchen_stations" }]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-person")).toBeTruthy());
  expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
  await vi.waitFor(() => expect(popupOpen(el)).toBe(false));
});
it("keeps a fill's slot picker open while it is in flight when another area stops being active", async () => {
  const fill = deferred<unknown>();
  const gone = new Set<string>();
  const { el, live } = await mount({ fill: () => fill.promise, read: without(gone) });
  const picker = await openPicker(el);
  click(picker, "[data-person=marc]");
  gone.add("restaurant");
  live.invalidate([{ type: "departments" }]);
  await vi.waitFor(() => expect(shownAreas(el)).toBe(1));
  await el.updateComplete;
  await new Promise(requestAnimationFrame);
  expect(el.shadowRoot!.querySelector("slot-picker")).toBe(picker);
  expect(popupOpen(el)).toBe(true);
  fill.resolve({ shiftId: "new" });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
});
it.each(["lands", "is refused"])(
  "closes a fill's slot picker when the last area stops being active while the fill is in flight, and the fill that %s afterwards draws no picker",
  async (outcome) => {
    const fill = deferred<unknown>();
    const gone = new Set<string>();
    const { el, live } = await mount({ fill: () => fill.promise, read: without(gone) });
    click(await openPicker(el), "[data-person=marc]");
    gone.add("kitchen").add("restaurant");
    live.invalidate([{ type: "kitchen_stations" }]);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-person")).toBeTruthy());
    await new Promise(requestAnimationFrame);
    expect(el.shadowRoot!.querySelector("rota-by-area")).toBeNull();
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
    await vi.waitFor(() => expect(popupOpen(el)).toBe(false));
    if (outcome === "lands") fill.resolve({ shiftId: "new" });
    else fill.reject({ code: "connection.failed" });
    await fill.promise.catch(() => undefined);
    if (outcome === "is refused")
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=fill-error]")?.textContent).toContain(
          "Could not fill the slot",
        ),
      );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
    expect(popupOpen(el)).toBe(false);
  },
);
it("closes a fill's slot picker when its slot leaves the plan while the fill is in flight", async () => {
  const fill = deferred<unknown>();
  const taken = new Set<string>();
  const { el, live } = await mount({ fill: () => fill.promise, read: without(new Set(), taken) });
  click(await openPicker(el), "[data-person=marc]");
  taken.add("empty");
  live.invalidate([{ type: "staffing_blocks" }]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
  await vi.waitFor(() => expect(popupOpen(el)).toBe(false));
  fill.resolve({ shiftId: "new" });
  await fill.promise;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
});
/** The read once the Sous chef staff role is deleted, which deletes its painted blocks: a later
 *  Head chef block on Friday then takes the freed place, and its slot the key `empty`. */
function sousDeleted(w: string) {
  const r = rotaWeek(w);
  r.staffRoles = r.staffRoles.filter((role) => role.id !== "sous");
  for (const p of r.people) p.staffRoleIds = p.staffRoleIds.filter((id) => id !== "sous");
  const sousShifts = new Set(
    r.shifts.filter((s) => s.staffRoleId === "sous").map((s) => s.shiftId),
  );
  r.shifts = r.shifts.filter((s) => !sousShifts.has(s.shiftId));
  for (const day of r.days)
    for (const a of day.areas) {
      a.match.over = a.match.over.filter((id) => !sousShifts.has(id));
      a.match.slots = a.match.slots.flatMap((s) =>
        s.slot.staffRoleId !== "sous"
          ? [s]
          : s.slot.key === "empty"
            ? [
                {
                  slot: { ...s.slot, staffRoleId: "head", startsAt: "18:00", endsAt: "23:00" },
                  status: { kind: "unfilled" as const },
                },
              ]
            : [],
      );
    }
  return r;
}
it.each(["idle", "in flight"])(
  "closes the slot picker when its staff role is deleted, while a fill is %s",
  async (fill) => {
    const pending = deferred<unknown>();
    let deleted = false;
    const { el, live } = await mount({
      fill: () => pending.promise,
      read: async (w) => (deleted ? sousDeleted(w) : rotaWeek(w)),
    });
    const picker = await openPicker(el);
    if (fill === "in flight") click(picker, "[data-person=marc]");
    deleted = true;
    live.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector<RotaView>("rota-by-area")!
          .shadowRoot!.querySelector("[data-slot=empty]")!.textContent,
      ).toContain("18:00"),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
    await vi.waitFor(() => expect(popupOpen(el)).toBe(false));
    pending.resolve({ shiftId: "new" });
  },
);
it("a person's open slots drop a deleted staff role's slots and keep the menu working", async () => {
  let deleted = false;
  const { el, live } = await mount({
    read: async (w) => (deleted ? sousDeleted(w) : rotaWeek(w)),
  });
  el.params = { area: "everyone" };
  const grid = () => el.shadowRoot!.querySelector<RotaView>("rota-by-person")!;
  await vi.waitFor(() => expect(grid()).toBeTruthy());
  await grid().updateComplete;
  click(grid(), '[data-person=marc] td[data-day="2026-12-04"] [data-test=day-add]');
  await vi.waitFor(() => expect(popupOpen(el)).toBe(true));
  const menu = () => el.shadowRoot!.querySelector<RotaView>("rota-open-slots")!;
  await menu().updateComplete;
  expect(menu().shadowRoot!.textContent).toContain("Sous chef");
  deleted = true;
  live.invalidate([{ type: "staff_roles" }]);
  await vi.waitFor(() => expect(menu().shadowRoot!.textContent).toContain("18:00–23:00"));
  expect(menu().shadowRoot!.textContent).not.toContain("Sous chef");
  expect(popupOpen(el)).toBe(true);
});
it("a picker that closes as a page scroll takes its slot out of view stays closed when the grid redraws before the close lands", async () => {
  await useViewport(1280, 900);
  const { el } = await mount();
  const spacer = document.createElement("div");
  spacer.style.height = "8000px";
  el.parentElement!.append(spacer);
  await openPicker(el);
  const scrolled = new Promise<void>((resolve) =>
    // Asked for after the popup's own scroll handler asks for its frame, so it runs in that frame
    // once the popup has hidden, before its close event.
    window.addEventListener(
      "scroll",
      () =>
        requestAnimationFrame(() => {
          expect(popupOpen(el)).toBe(false);
          el.canWrite = false;
          resolve();
        }),
      { once: true },
    ),
  );
  window.scrollBy(0, 3000);
  await scrolled;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
  expect(popupOpen(el)).toBe(false);
  await scrollHome();
  el.canWrite = true;
  await el.updateComplete;
  await openPicker(el);
});
/** The read once Friday's Sous chef block is repainted: the same place in the day, so its slot
 *  keeps the key `empty` and its staff role, under other times or another changeover. */
function repainted(change: "times" | "changeover") {
  return (w: string) => {
    const r = rotaWeek(w);
    const friday = r.days[4]!;
    const listed = friday.areas[0]!.match.slots[0]!;
    if (change === "times")
      listed.slot = { ...listed.slot, startsAt: "10:00", endsAt: "18:00", start: 240, end: 720 };
    else {
      friday.cutover = "07:00";
      listed.slot = { ...listed.slot, start: 120, end: 600 };
    }
    return r;
  };
}
const shownFriday = (el: RotaView) =>
  el.shadowRoot!.querySelector<RotaView & { week: RotaWeek }>("rota-by-area")?.week.days[4];
it.each([
  ["other times", "idle", "times"],
  ["other times", "in flight", "times"],
  ["another changeover", "idle", "changeover"],
] as const)(
  "closes the slot picker when its slot takes %s under it, while a fill is %s",
  async (_, fill, change) => {
    const pending = deferred<unknown>();
    let moved = false;
    const { el, live } = await mount({
      fill: () => pending.promise,
      read: async (w) => (moved ? repainted(change)(w) : rotaWeek(w)),
    });
    const picker = await openPicker(el);
    if (fill === "in flight") click(picker, "[data-person=marc]");
    moved = true;
    live.invalidate([{ type: "staffing_blocks" }]);
    await vi.waitFor(() =>
      expect(
        change === "times"
          ? shownFriday(el)?.areas[0]!.match.slots[0]!.slot.startsAt
          : shownFriday(el)?.cutover,
      ).toBe(change === "times" ? "10:00" : "07:00"),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
    await vi.waitFor(() => expect(popupOpen(el)).toBe(false));
    pending.resolve({ shiftId: "new" });
  },
);
