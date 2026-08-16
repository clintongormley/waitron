import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./till-schedule-screen.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillScheduleScreen } from "./till-schedule-screen.js";
import type { MyAbsence, MyShift, MySwap, StaffMember, TillApi } from "../api/client.js";

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

const swaps: MySwap[] = [
  {
    id: "sw-offered",
    requestedByPersonId: "col1",
    fromShiftId: "s2",
    toPersonId: "me",
    toShiftId: null,
    status: "requested",
    createdAt: "2026-05-01T10:00:00Z",
    direction: "offered_to_me",
  },
  // Offered to me but already accepted — must NOT show an Accept control.
  {
    id: "sw-accepted",
    requestedByPersonId: "col1",
    fromShiftId: "s3",
    toPersonId: "me",
    toShiftId: null,
    status: "accepted",
    createdAt: "2026-05-01T09:00:00Z",
    direction: "offered_to_me",
  },
  // Requested by me — belongs to neither the offered-to-me list.
  {
    id: "sw-mine",
    requestedByPersonId: "me",
    fromShiftId: "s1",
    toPersonId: "col1",
    toShiftId: null,
    status: "requested",
    createdAt: "2026-05-02T09:00:00Z",
    direction: "requested_by_me",
  },
];

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

const staff: StaffMember[] = [
  { personId: "me", displayName: "Yo" },
  { personId: "col1", displayName: "Colega" },
];

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    listMyShifts: vi.fn().mockResolvedValue(shifts),
    listMySwaps: vi.fn().mockResolvedValue(swaps),
    listMyAbsences: vi.fn().mockResolvedValue(absences),
    requestSwap: vi.fn().mockResolvedValue({ swapId: "new" }),
    acceptSwap: vi.fn().mockResolvedValue(undefined),
    requestAbsence: vi.fn().mockResolvedValue({ absenceId: "new" }),
    ...overrides,
  } as unknown as TillApi;
}

async function mount(
  api: TillApi,
): Promise<{ el: TillScheduleScreen; host: HTMLElement }> {
  const mounted = await mountWidget<TillScheduleScreen>("till-schedule-screen", {
    api,
    staff,
    operatorPersonId: "me",
  });
  await flush(mounted.el);
  return mounted;
}

/** Wait for the on-connect load's microtasks to settle, then the render. */
async function flush(el: TillScheduleScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function root(el: TillScheduleScreen): ShadowRoot {
  return el.shadowRoot!;
}

function setSelect(el: TillScheduleScreen, selector: string, value: string): void {
  const select = root(el).querySelector<HTMLSelectElement>(selector)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

function setInput(el: TillScheduleScreen, selector: string, value: string): void {
  root(el)
    .querySelector(selector)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }));
}

afterEach(cleanupWidgets);

describe("till-schedule-screen", () => {
  it("renders my upcoming shifts", async () => {
    const { el } = await mount(stubApi());
    const rows = root(el).querySelectorAll(".shift");
    expect(rows).toHaveLength(1);
    expect(root(el).textContent).toContain("2026-05-04 09:00–17:00");
    expect(root(el).textContent).toContain("bar");
  });

  it("renders a shift with no role without a trailing role separator", async () => {
    const api = stubApi({
      listMyShifts: vi.fn().mockResolvedValue([{ ...shifts[0], id: "s-norole", role: null }]),
    });
    const { el } = await mount(api);
    expect(root(el).textContent).toContain("2026-05-04 09:00–17:00");
    expect(root(el).textContent).not.toContain("· null");
  });

  it("names an off-roster swap requester by their id when they are not on the roster", async () => {
    const api = stubApi({
      listMySwaps: vi.fn().mockResolvedValue([
        { ...swaps[0], id: "sw-x", requestedByPersonId: "ghost" },
      ]),
    });
    const { el } = await mount(api);
    // Not on the roster (`staff` has only me + col1), so the raw id shows as a defensive fallback.
    expect(root(el).textContent).toContain("ghost");
  });

  it("shows only swaps offered to me that are still requested, each with an Accept control", async () => {
    const { el } = await mount(stubApi());
    const swapRows = root(el).querySelectorAll(".swap");
    expect(swapRows).toHaveLength(1);
    expect(swapRows[0]!.getAttribute("data-swap")).toBe("sw-offered");
    // The accepted one and my own request are excluded.
    expect(root(el).querySelector('[data-swap="sw-accepted"]')).toBeNull();
    expect(root(el).querySelector('[data-swap="sw-mine"]')).toBeNull();
    // The requester is named from the roster, not shown as a raw id.
    expect(root(el).textContent).toContain("Colega");
  });

  it("Accept calls acceptSwap for that swap and reloads the lists", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    root(el).querySelector<HTMLElement>("wt-button.accept")!.click();
    await flush(el);
    expect(api.acceptSwap).toHaveBeenCalledWith("sw-offered");
    // Reloaded: listMySwaps ran on connect AND again after the accept.
    expect(api.listMySwaps).toHaveBeenCalledTimes(2);
  });

  it("renders my time off with its kind, dates and status", async () => {
    const { el } = await mount(stubApi());
    expect(root(el).querySelectorAll(".absence")).toHaveLength(1);
    expect(root(el).textContent).toContain(t("schedule.kind.holiday"));
    expect(root(el).textContent).toContain("2026-06-01");
    expect(root(el).textContent).toContain(t("schedule.status.requested"));
  });

  it("Request cover offers the chosen shift to the chosen colleague (toShiftId null)", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    setSelect(el, "select.cover-shift", "s1");
    setSelect(el, "select.cover-colleague", "col1");
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("wt-button.cover-submit")!.click();
    await flush(el);
    expect(api.requestSwap).toHaveBeenCalledWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
  });

  it("excludes the operator from the colleague picker (you cannot offer to yourself)", async () => {
    const { el } = await mount(stubApi());
    const options = [
      ...root(el).querySelectorAll<HTMLOptionElement>("select.cover-colleague option"),
    ].map((o) => o.value);
    expect(options).toContain("col1");
    expect(options).not.toContain("me");
  });

  it("Request time off submits the kind, dates and note", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    setSelect(el, "select.abs-kind", "leave");
    setInput(el, "wt-input.abs-from", "2026-07-01");
    setInput(el, "wt-input.abs-to", "2026-07-05");
    setInput(el, "wt-input.abs-note", "Boda");
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("wt-button.abs-submit")!.click();
    await flush(el);
    expect(api.requestAbsence).toHaveBeenCalledWith({
      kind: "leave",
      startsOn: "2026-07-01",
      endsOn: "2026-07-05",
      note: "Boda",
    });
  });

  it("surfaces an overlap rejection as a friendly banner, never the raw code", async () => {
    const api = stubApi({
      requestAbsence: vi.fn().mockRejectedValue({ code: "absence.overlaps" }),
    });
    const { el } = await mount(api);
    setInput(el, "wt-input.abs-from", "2026-08-12");
    setInput(el, "wt-input.abs-to", "2026-08-18");
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("wt-button.abs-submit")!.click();
    await flush(el);
    expect(root(el).textContent).toContain(codeMessage("absence.overlaps", "es"));
    expect(root(el).textContent).not.toContain("absence.overlaps");
  });

  it("ignores a re-fired Accept while one is still in flight (the busy guard)", async () => {
    // acceptSwap never resolves, so the first tap leaves the action in flight; a synchronous second tap
    // (before the disabled re-render lands) must be a no-op — the `busy` guard, one request per action.
    const acceptSwap = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    const { el } = await mount(stubApi({ acceptSwap }));
    const btn = root(el).querySelector<HTMLElement>("wt-button.accept")!;
    btn.click();
    btn.click();
    expect(acceptSwap).toHaveBeenCalledOnce();
  });

  it("emits back-to-counter when Back is tapped", async () => {
    const { el } = await mount(stubApi());
    const seen = vi.fn();
    el.addEventListener("back-to-counter", seen);
    root(el).querySelector<HTMLElement>("wt-button.back")!.click();
    expect(seen).toHaveBeenCalledOnce();
  });

  it("shows a load-failed status when the initial load rejects", async () => {
    const api = stubApi({ listMyShifts: vi.fn().mockRejectedValue(new Error("network")) });
    const { el } = await mount(api);
    expect(root(el).textContent).toContain(t("schedule.load_failed"));
  });
});
