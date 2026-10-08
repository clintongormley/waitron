import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, MyShift, RosterEntry } from "../api/client.js";
import "./my-schedule-screen.js";
import type { MyScheduleScreen } from "./my-schedule-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const roster: RosterEntry[] = [
  { personId: "me", displayName: "Me" },
  { personId: "col1", displayName: "Ana" },
  { personId: "col2", displayName: "Luis" },
];
const shift: MyShift = {
  id: "s1",
  locationId: "loc1",
  startsAt: "2026-05-04T09:00:00Z",
  startsOffsetMinutes: 0,
  endsAt: "2026-05-04T17:00:00Z",
  endsOffsetMinutes: 0,
  role: "bar",
  rosterVersionId: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
}

function stubApi() {
  return {
    getStaffRoster: vi.fn(async () => roster),
    listMyShifts: vi.fn(async () => [shift]),
    listMySwaps: vi.fn(async () => []),
    listMyAbsences: vi.fn(async () => []),
    acceptSwap: vi.fn(async () => {}),
    requestSwap: vi.fn(async () => ({ swapId: "sw9" })),
    requestAbsence: vi.fn(async () => ({ absenceId: "ab9" })),
  };
}

async function mountLoaded(api = stubApi()) {
  setLocale("en-GB");
  const { el } = await mountWidget<MyScheduleScreen>("dashboard-my-schedule-screen", {
    api: api as unknown as DashboardApi,
    myPersonId: "me",
  });
  await vi.waitFor(() => expect(q(el, "[data-test=shift-s1]")).not.toBeNull());
  await el.updateComplete;
  return { el, api };
}

const q = <T extends HTMLElement = HTMLElement>(el: MyScheduleScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

type Action = "cover-submit" | "abs-submit";
function action(el: MyScheduleScreen, which: Action) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${which}]`)!;
}
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: MyScheduleScreen, which: Action) {
  await el.updateComplete;
  const button = action(el, which);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: MyScheduleScreen, which: Action) {
  await userEvent.click(
    page.elementLocator(action(el, which).shadowRoot!.querySelector("button")!),
    {
      force: true,
    },
  );
  await el.updateComplete;
}
async function choose(el: MyScheduleScreen, dataTest: string, value: string) {
  await chooseOption(q(el, `[data-test=${dataTest}]`)!, value);
  await el.updateComplete;
}
async function type(el: MyScheduleScreen, dataTest: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `[data-test=${dataTest}]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function settle(el: MyScheduleScreen) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe("the cover request", () => {
  it("opens quiet, and a press sends nothing", async () => {
    const { el, api } = await mountLoaded();
    expect(await state(el, "cover-submit")).toEqual(quiet);
    await press(el, "cover-submit");
    expect(api.requestSwap).not.toHaveBeenCalled();
  });

  it("wakes once both fields are chosen, and choosing the empty values back quiets it", async () => {
    const { el } = await mountLoaded();
    await choose(el, "cover-shift", "s1");
    expect(await state(el, "cover-submit")).toEqual(blocked);
    await choose(el, "cover-colleague", "col1");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await choose(el, "cover-colleague", "");
    await choose(el, "cover-shift", "");
    expect(await state(el, "cover-submit")).toEqual(quiet);
  });

  it("after a request is sent, the cleared form is quiet again", async () => {
    const { el, api } = await mountLoaded();
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    expect(api.requestSwap).toHaveBeenCalledExactlyOnceWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
    await vi.waitFor(async () => expect(await state(el, "cover-submit")).toEqual(quiet));
  });

  it("a filled form that matches the request just sent is quiet, and a press sends nothing", async () => {
    const api = stubApi();
    const reply = deferred<{ swapId: string }>();
    api.requestSwap.mockImplementationOnce(() => reply.promise);
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    await choose(el, "cover-colleague", "col2");
    reply.resolve({ swapId: "sw9" });
    await vi.waitFor(async () => expect(await state(el, "cover-submit")).toEqual(ready));
    await choose(el, "cover-colleague", "col1");
    expect(await state(el, "cover-submit")).toEqual(quiet);
    await press(el, "cover-submit");
    // A host `.click()` reaches the listener even while the inner button is disabled, so this proves
    // the handler itself sends nothing for an unchanged form.
    action(el, "cover-submit").click();
    await settle(el);
    expect(api.requestSwap).toHaveBeenCalledTimes(1);
  });
});

describe("the absence request", () => {
  it("opens quiet, and a press sends nothing", async () => {
    const { el, api } = await mountLoaded();
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await press(el, "abs-submit");
    expect(api.requestAbsence).not.toHaveBeenCalled();
  });

  it("one edit wakes it, and typing the original value back quiets it", async () => {
    const { el } = await mountLoaded();
    await choose(el, "abs-kind", "sick_leave");
    expect(await state(el, "abs-submit")).toEqual(blocked);
    await choose(el, "abs-kind", "holiday");
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await type(el, "abs-to", "");
    expect(await state(el, "abs-submit")).toEqual(blocked);
    await type(el, "abs-from", "");
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await type(el, "abs-note", "Wedding");
    expect(await state(el, "abs-submit")).toEqual(blocked);
    await type(el, "abs-note", "");
    expect(await state(el, "abs-submit")).toEqual(quiet);
  });

  it("after a request is sent, the cleared form is quiet again", async () => {
    const { el, api } = await mountLoaded();
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    await type(el, "abs-note", "Wedding");
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledExactlyOnceWith({
      kind: "holiday",
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      note: "Wedding",
    });
    await vi.waitFor(async () => expect(await state(el, "abs-submit")).toEqual(quiet));
  });

  it("a filled form that matches the request just sent is quiet, and a press sends nothing", async () => {
    const api = stubApi();
    const reply = deferred<{ absenceId: string }>();
    api.requestAbsence.mockImplementationOnce(() => reply.promise);
    const { el } = await mountLoaded(api);
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    await press(el, "abs-submit");
    await type(el, "abs-note", "Wedding");
    reply.resolve({ absenceId: "ab9" });
    await vi.waitFor(async () => expect(await state(el, "abs-submit")).toEqual(ready));
    await type(el, "abs-note", "");
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await press(el, "abs-submit");
    action(el, "abs-submit").click();
    await settle(el);
    expect(api.requestAbsence).toHaveBeenCalledTimes(1);
  });
});
