import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { MyScheduleScreen, scheduleWindow } from "./my-schedule-screen.js";
import type { DashboardApi, MyAbsence, MyShift, MySwap, RosterEntry } from "../api/client.js";

const roster: RosterEntry[] = [
  { personId: "me", displayName: "Yo" },
  { personId: "col1", displayName: "Colega" },
];
const shifts: MyShift[] = [
  {
    id: "s1",
    locationId: "loc1",
    startsAt: "2026-05-04T09:00:00Z",
    startsOffsetMinutes: 0,
    endsAt: "2026-05-04T17:00:00Z",
    endsOffsetMinutes: 0,
    role: "bar",
    rosterVersionId: null,
  },
];
const offeredToMe: MySwap = {
  id: "sw-offered",
  requestedByPersonId: "col1",
  fromShiftId: "s2",
  toPersonId: "me",
  toShiftId: null,
  status: "requested",
  createdAt: "2026-05-01T10:00:00Z",
  direction: "offered_to_me",
};
const requestedByMe: MySwap = {
  id: "sw-mine",
  requestedByPersonId: "me",
  fromShiftId: "s1",
  toPersonId: "col1",
  toShiftId: null,
  status: "requested",
  createdAt: "2026-05-02T10:00:00Z",
  direction: "requested_by_me",
};
const absences: MyAbsence[] = [
  {
    id: "a1",
    personId: "me",
    kind: "holiday",
    startsOn: "2026-06-01",
    endsOn: "2026-06-03",
    status: "requested",
    note: null,
    createdAt: "2026-05-01T10:00:00Z",
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getStaffRoster: vi.fn().mockResolvedValue(roster),
    listMyShifts: vi.fn().mockResolvedValue(shifts),
    listMySwaps: vi.fn().mockResolvedValue([offeredToMe, requestedByMe]),
    listMyAbsences: vi.fn().mockResolvedValue(absences),
    requestSwap: vi.fn().mockResolvedValue({ swapId: "sw9" }),
    acceptSwap: vi.fn().mockResolvedValue(undefined),
    requestAbsence: vi.fn().mockResolvedValue({ absenceId: "ab9" }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: MyScheduleScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

/** Drive a native `<select>` by data-test: set the value and fire `change`. */
function selectValue(el: MyScheduleScreen, dataTest: string, value: string): void {
  const sel = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${dataTest}]`)!;
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
}

/** Drive a `wt-input` by data-test: the screen listens for the widget's own composed `wt-change`
 * (its `<input>` lives in wt-input's shadow root, unreachable via a descendant selector). */
function setInput(el: MyScheduleScreen, dataTest: string, value: string): void {
  el.shadowRoot!.querySelector(`[data-test=${dataTest}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function mount(api: DashboardApi): Promise<{ el: MyScheduleScreen }> {
  return mountWidget<MyScheduleScreen>("dashboard-my-schedule-screen", { api, myPersonId: "me" });
}

afterEach(cleanupWidgets);

describe("scheduleWindow", () => {
  it("returns a half-open [today, today+days) window as YYYY-MM-DD", () => {
    expect(scheduleWindow(new Date("2026-05-04T08:00:00Z"), 14)).toEqual({
      from: "2026-05-04",
      to: "2026-05-18",
    });
  });
});

describe("my-schedule-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-my-schedule-screen")).toBe(MyScheduleScreen);
  });

  it("loads and renders the three lists, resolving colleague names via the roster", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    expect(api.getStaffRoster).toHaveBeenCalledTimes(1);
    expect(api.listMyShifts).toHaveBeenCalledTimes(1);
    expect(api.listMySwaps).toHaveBeenCalledTimes(1);
    expect(api.listMyAbsences).toHaveBeenCalledTimes(1);
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain("bar"); // the shift's role
    expect(text).toContain("Colega"); // a colleague name resolved from the roster
    expect(text).toContain("Vacaciones"); // absence kind, es
    expect(text).toContain("Solicitada"); // absence status, es
  });

  it("shows an Accept only on a swap offered to me that is still requested", async () => {
    const { el } = await mount(stubApi());
    await flush(el);
    // The swap offered to me has an Accept…
    expect(el.shadowRoot!.querySelector("[data-test=accept-sw-offered]")).not.toBeNull();
    // …the one I requested does not (I cannot accept my own offer).
    expect(el.shadowRoot!.querySelector("[data-test=accept-sw-mine]")).toBeNull();
  });

  it("accepts a swap offered to me → calls acceptSwap and reloads the lists", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=accept-sw-offered]")!.click();
    await flush(el);
    expect(api.acceptSwap).toHaveBeenCalledWith("sw-offered");
    // The lists reload after the action (a second shifts fetch); the roster is NOT refetched.
    expect(api.listMyShifts).toHaveBeenCalledTimes(2);
    expect(api.getStaffRoster).toHaveBeenCalledTimes(1);
  });

  it("offers one of my shifts to a colleague → requestSwap with a null return leg, never a personId", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    selectValue(el, "cover-shift", "s1");
    selectValue(el, "cover-colleague", "col1");
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cover-submit]")!.click();
    await flush(el);
    expect(api.requestSwap).toHaveBeenCalledWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
  });

  it("excludes myself from the colleague picker", async () => {
    const { el } = await mount(stubApi());
    await flush(el);
    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=cover-colleague] option"),
    ].map((o) => o.value);
    expect(options).toContain("col1");
    expect(options).not.toContain("me");
  });

  it("requests time off → requestAbsence with the form fields (a blank note becomes null)", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    setInput(el, "abs-from", "2026-07-01");
    setInput(el, "abs-to", "2026-07-05");
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=abs-submit]")!.click();
    await flush(el);
    expect(api.requestAbsence).toHaveBeenCalledWith({
      kind: "holiday",
      startsOn: "2026-07-01",
      endsOn: "2026-07-05",
      note: null,
    });
  });

  it("carries a non-blank note through and a chosen kind", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    selectValue(el, "abs-kind", "sick_leave");
    setInput(el, "abs-from", "2026-08-01");
    setInput(el, "abs-to", "2026-08-02");
    setInput(el, "abs-note", "Doctor");
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=abs-submit]")!.click();
    await flush(el);
    expect(api.requestAbsence).toHaveBeenCalledWith({
      kind: "sick_leave",
      startsOn: "2026-08-01",
      endsOn: "2026-08-02",
      note: "Doctor",
    });
  });

  it("does not submit a cover with an unfilled shift or colleague", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    // Submit with nothing selected — the button is disabled and the guard drops it.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cover-submit]")!.click();
    await flush(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
  });

  it("does not submit an absence with unfilled dates", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=abs-submit]")!.click();
    await flush(el);
    expect(api.requestAbsence).not.toHaveBeenCalled();
  });

  it("surfaces a rejected action as the notice banner (never the raw code) and releases busy for a retry", async () => {
    const api = stubApi({
      acceptSwap: vi.fn().mockRejectedValue({ code: "swap.not_acceptable" }),
    });
    const { el } = await mount(api);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=accept-sw-offered]")!.click();
    await flush(el);
    const banner = el.shadowRoot!.querySelector("[data-test=notice]");
    expect(banner?.textContent ?? "").toContain("Ese cambio de turno ya no se puede aceptar");
    expect(banner?.textContent ?? "").not.toContain("swap.not_acceptable"); // never the raw code
    // busy was released in the finally, so a second attempt fires rather than being single-flighted away.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=accept-sw-offered]")!.click();
    await flush(el);
    expect(api.acceptSwap).toHaveBeenCalledTimes(2);
  });

  it("single-flights a double-clicked action (at most one accept per burst)", async () => {
    // acceptSwap stays pending so both clicks land inside the same in-flight window.
    let resolve: () => void = () => {};
    const gate = new Promise<void>((r) => (resolve = r));
    const api = stubApi({ acceptSwap: vi.fn().mockReturnValue(gate) });
    const { el } = await mount(api);
    await flush(el);
    const btn = el.shadowRoot!.querySelector<HTMLElement>("[data-test=accept-sw-offered]")!;
    btn.click();
    btn.click();
    expect(api.acceptSwap).toHaveBeenCalledTimes(1);
    resolve();
  });

  it("shows the load-failed banner when the initial load rejects, never a stuck spinner", async () => {
    const api = stubApi({ listMyShifts: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mount(api);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).not.toBeNull();
    // The loading spinner is gone (the lists defaulted to empty on failure).
    expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull();
  });

  it("labels a role-less shift without a trailing role, and names an off-roster swap party by raw id", async () => {
    const roleless: MyShift = { ...shifts[0]!, id: "s-noRole", role: null };
    const fromStranger: MySwap = {
      ...offeredToMe,
      id: "sw-stranger",
      requestedByPersonId: "ghost", // not on the roster → falls back to the raw id
    };
    const api = stubApi({
      listMyShifts: vi.fn().mockResolvedValue([roleless]),
      listMySwaps: vi.fn().mockResolvedValue([fromStranger]),
    });
    const { el } = await mount(api);
    await flush(el);
    const shiftText = el.shadowRoot!.querySelector("[data-test=shift-s-noRole]")!.textContent ?? "";
    expect(shiftText).toContain("2026-05-04 09:00–17:00");
    expect(shiftText).not.toContain("·"); // no role separator when role is null
    // An unknown counterparty renders its raw id rather than an empty string.
    expect(
      el.shadowRoot!.querySelector("[data-test=swap-sw-stranger]")!.textContent ?? "",
    ).toContain("ghost");
  });

  it("shows the empty prompts when every list is empty", async () => {
    const api = stubApi({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mount(api);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=shifts-empty]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=swaps-empty]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=absences-empty]")).not.toBeNull();
  });
});
