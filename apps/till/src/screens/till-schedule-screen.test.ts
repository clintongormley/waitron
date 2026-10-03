import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtCombobox } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { localIsoDate, scheduleWindow } from "./till-schedule-screen.js";
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

async function mount(api: TillApi): Promise<{ el: TillScheduleScreen; host: HTMLElement }> {
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

async function setSelect(el: TillScheduleScreen, selector: string, value: string): Promise<void> {
  await chooseOption(root(el).querySelector(selector)!, value);
}

function setInput(el: TillScheduleScreen, selector: string, value: string): void {
  root(el)
    .querySelector(selector)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
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
      listMySwaps: vi
        .fn()
        .mockResolvedValue([{ ...swaps[0], id: "sw-x", requestedByPersonId: "ghost" }]),
    });
    const { el } = await mount(api);
    expect(root(el).textContent).toContain("ghost");
  });

  it("shows only swaps offered to me that are still requested, each with an Accept control", async () => {
    const { el } = await mount(stubApi());
    const swapRows = root(el).querySelectorAll(".swap");
    expect(swapRows).toHaveLength(1);
    expect(swapRows[0]!.getAttribute("data-swap")).toBe("sw-offered");
    expect(root(el).querySelector('[data-swap="sw-accepted"]')).toBeNull();
    expect(root(el).querySelector('[data-swap="sw-mine"]')).toBeNull();
    expect(root(el).textContent).toContain("Colega");
  });

  it("Accept calls acceptSwap for that swap and reloads the lists", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    root(el).querySelector<HTMLElement>("wt-button.accept")!.click();
    await flush(el);
    expect(api.acceptSwap).toHaveBeenCalledWith("sw-offered");
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
    await setSelect(el, 'wt-combobox[name="cover-shift"]', "s1");
    await setSelect(el, 'wt-combobox[name="cover-colleague"]', "col1");
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("wt-button.cover-submit")!.click();
    await flush(el);
    expect(api.requestSwap).toHaveBeenCalledWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
  });

  it("picks the shift, the colleague and the kind of absence from the shared dropdowns", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const dropdown = (name: string) =>
      root(el).querySelector<WtCombobox>(`wt-combobox[name="${name}"]`);
    const shift = dropdown("cover-shift");
    const colleague = dropdown("cover-colleague");
    const kind = dropdown("abs-kind");
    for (const box of [shift, colleague, kind]) {
      expect(box).not.toBeNull();
      expect(box!.getAttribute("search")).toBe("auto");
      expect(box!.searchPlaceholder).toBe(t("form.combobox_search"));
      expect(box!.noResultsLabel).toBe(t("form.combobox_no_results"));
    }
    expect(shift!.label).toBe(t("schedule.cover_shift"));
    expect(shift!.placeholder).toBe("—");
    expect(shift!.options).toEqual([
      { value: "", label: "—" },
      { value: "s1", label: "2026-05-04 09:00–17:00 · bar" },
    ]);
    expect(shift!.value).toBe("");
    expect(colleague!.label).toBe(t("schedule.cover_colleague"));
    expect(colleague!.placeholder).toBe("—");
    expect(colleague!.options).toEqual([
      { value: "", label: "—" },
      { value: "col1", label: "Colega" },
    ]);
    expect(kind!.label).toBe(t("schedule.absence_kind"));
    expect(kind!.options).toEqual(
      ["holiday", "sick_leave", "leave", "unpaid"].map((value) => ({
        value,
        label: t(`schedule.kind.${value}` as Parameters<typeof t>[0]),
      })),
    );
    expect(kind!.value).toBe("holiday");

    await chooseOption(shift!, "s1");
    await chooseOption(colleague!, "col1");
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("wt-button.cover-submit")!.click();
    await flush(el);
    expect(api.requestSwap).toHaveBeenCalledWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
    expect(shift!.value).toBe("");
    expect(colleague!.value).toBe("");
  });

  it("draws each dropdown wide enough for its whole label, before anything is chosen", async () => {
    const { el } = await mount(stubApi());
    for (const name of ["cover-shift", "cover-colleague", "abs-kind"]) {
      const box = root(el).querySelector<WtCombobox>(`wt-combobox[name="${name}"]`)!;
      await box.updateComplete;
      const label = box.shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
      expect({ name, cut: label.scrollWidth > label.clientWidth }).toEqual({ name, cut: false });
    }
  });

  it("excludes the operator from the colleague picker (you cannot offer to yourself)", async () => {
    const { el } = await mount(stubApi());
    const options = root(el)
      .querySelector<WtCombobox>('wt-combobox[name="cover-colleague"]')!
      .options.map((o) => o.value);
    expect(options).toContain("col1");
    expect(options).not.toContain("me");
  });

  it("Request time off submits the kind, dates and note", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await setSelect(el, 'wt-combobox[name="abs-kind"]', "leave");
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
    expect(root(el).textContent).toContain(codeMessage("absence.overlaps"));
    expect(root(el).textContent).not.toContain("absence.overlaps");
  });

  it("surfaces a codeless rejection as the generic banner", async () => {
    const api = stubApi({ acceptSwap: vi.fn().mockRejectedValue(new Error("offline")) });
    const { el } = await mount(api);
    expect(root(el).querySelector(".notice")).toBeNull();
    root(el).querySelector<HTMLElement>("wt-button.accept")!.click();
    await vi.waitFor(() =>
      expect(root(el).querySelector('.notice[role="alert"]')?.textContent).toBe(
        codeMessage("server.internal"),
      ),
    );
    expect(api.listMySwaps).toHaveBeenCalledOnce();
  });

  it("does not offer a shift until both the shift and the colleague are chosen", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const submit = root(el).querySelector<HTMLElement>("wt-button.cover-submit")!;
    await setSelect(el, 'wt-combobox[name="cover-shift"]', "s1");
    await el.updateComplete;
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    await setSelect(el, 'wt-combobox[name="cover-shift"]', "");
    await setSelect(el, 'wt-combobox[name="cover-colleague"]', "col1");
    await el.updateComplete;
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    await flush(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
  });

  it("does not request time off until both dates are given", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const submit = root(el).querySelector<HTMLElement>("wt-button.abs-submit")!;
    setInput(el, "wt-input.abs-from", "2026-07-01");
    await el.updateComplete;
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    setInput(el, "wt-input.abs-from", "");
    setInput(el, "wt-input.abs-to", "2026-07-05");
    await el.updateComplete;
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    await flush(el);
    expect(api.requestAbsence).not.toHaveBeenCalled();
  });

  it.each(["wt-input.abs-from", "wt-input.abs-to", "wt-input.abs-note"])(
    "Enter in %s submits the time-off request",
    async (field) => {
      const api = stubApi();
      const { el } = await mount(api);
      setInput(el, "wt-input.abs-from", "2026-07-01");
      setInput(el, "wt-input.abs-to", "2026-07-05");
      await el.updateComplete;
      const host = root(el).querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        field,
      )!;
      await host.updateComplete;
      host
        .shadowRoot!.querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
        );
      await vi.waitFor(() =>
        expect(api.requestAbsence).toHaveBeenCalledWith({
          kind: "holiday",
          startsOn: "2026-07-01",
          endsOn: "2026-07-05",
          note: null,
        }),
      );
    },
  );

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

  it("leaves a gap under the load-failed alert, before the first list's heading", async () => {
    const api = stubApi({ listMyShifts: vi.fn().mockRejectedValue(new Error("network")) });
    const { el } = await mount(api);
    const alert = root(el).querySelector<HTMLElement>('[role="alert"]')!;
    expect(Number.parseFloat(getComputedStyle(alert).marginBottom)).toBeGreaterThan(0);
  });

  it("does not call a list that never loaded empty when the first load fails", async () => {
    const api = stubApi({ listMyShifts: vi.fn().mockRejectedValue(new Error("network")) });
    const { el } = await mount(api);
    const text = root(el).textContent!;
    expect(root(el).querySelector('[role="alert"]')?.textContent).toContain(
      t("schedule.load_failed"),
    );
    expect(text).not.toContain(t("schedule.loading"));
    expect(text).not.toContain(t("schedule.shifts_empty"));
    expect(text).not.toContain(t("schedule.swaps_empty"));
    expect(text).not.toContain(t("schedule.absences_empty"));
  });

  it("keeps the loaded rows when a later reload fails", async () => {
    const listMyShifts = vi
      .fn()
      .mockResolvedValueOnce(shifts)
      .mockRejectedValueOnce(new Error("network"));
    const { el } = await mount(stubApi({ listMyShifts }));
    root(el).querySelector<HTMLElement>("wt-button.accept")!.click();
    await vi.waitFor(() => expect(root(el).textContent).toContain(t("schedule.load_failed")));
    expect(listMyShifts).toHaveBeenCalledTimes(2);
    expect(root(el).querySelectorAll(".shift")).toHaveLength(1);
    expect(root(el).querySelectorAll(".swap")).toHaveLength(1);
    expect(root(el).querySelectorAll(".absence")).toHaveLength(1);
  });

  it("announces the loading line as a status while the first load is pending", async () => {
    const api = stubApi({ listMyShifts: vi.fn().mockReturnValue(new Promise(() => {})) });
    const { el } = await mount(api);
    const status = root(el).querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(t("schedule.loading"));
  });

  it("drops a chosen shift that a reload no longer lists, and keeps one it still lists", async () => {
    const earlier: MyShift = {
      ...shifts[0]!,
      id: "s0",
      startsAt: "2026-05-03T09:00:00Z",
      endsAt: "2026-05-03T17:00:00Z",
    };
    const listMyShifts = vi
      .fn()
      .mockResolvedValueOnce(shifts)
      .mockResolvedValueOnce([earlier, ...shifts])
      .mockResolvedValueOnce([earlier]);
    const api = stubApi({ listMyShifts });
    const { el } = await mount(api);
    const shift = root(el).querySelector<WtCombobox>('wt-combobox[name="cover-shift"]')!;
    const submit = root(el).querySelector<HTMLElement>("wt-button.cover-submit")!;
    await setSelect(el, 'wt-combobox[name="cover-shift"]', "s1");
    await setSelect(el, 'wt-combobox[name="cover-colleague"]', "col1");
    await el.updateComplete;
    expect(submit.hasAttribute("disabled")).toBe(false);

    root(el).querySelector<HTMLElement>("wt-button.accept")!.click();
    await vi.waitFor(() => expect(listMyShifts).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(shift.value).toBe("s1");
    expect(submit.hasAttribute("disabled")).toBe(false);

    root(el).querySelector<HTMLElement>("wt-button.accept")!.click();
    await vi.waitFor(() => expect(listMyShifts).toHaveBeenCalledTimes(3));
    await flush(el);
    expect(root(el).querySelectorAll(".shift")).toHaveLength(1);
    expect(shift.value).toBe("");
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    await flush(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
  });

  it("drops a chosen colleague the staff list no longer offers, and keeps one it still offers", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const colleague = root(el).querySelector<WtCombobox>('wt-combobox[name="cover-colleague"]')!;
    const submit = root(el).querySelector<HTMLElement>("wt-button.cover-submit")!;
    await setSelect(el, 'wt-combobox[name="cover-shift"]', "s1");
    await setSelect(el, 'wt-combobox[name="cover-colleague"]', "col1");
    await el.updateComplete;

    el.staff = [
      { personId: "me", displayName: "Yo" },
      { personId: "col2", displayName: "Otra" },
      { personId: "col1", displayName: "Colega" },
    ];
    await el.updateComplete;
    expect(colleague.value).toBe("col1");
    expect(submit.hasAttribute("disabled")).toBe(false);

    el.staff = [
      { personId: "me", displayName: "Yo" },
      { personId: "col2", displayName: "Otra" },
    ];
    await el.updateComplete;
    expect(colleague.value).toBe("");
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    await flush(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
  });

  it("drops a chosen colleague who becomes the operator", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const colleague = root(el).querySelector<WtCombobox>('wt-combobox[name="cover-colleague"]')!;
    const submit = root(el).querySelector<HTMLElement>("wt-button.cover-submit")!;
    await setSelect(el, 'wt-combobox[name="cover-shift"]', "s1");
    await setSelect(el, 'wt-combobox[name="cover-colleague"]', "col1");
    await el.updateComplete;
    expect(submit.hasAttribute("disabled")).toBe(false);
    el.operatorPersonId = "col1";
    await el.updateComplete;
    expect(colleague.value).toBe("");
    expect(submit.hasAttribute("disabled")).toBe(true);
    submit.click();
    await flush(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
  });
});

describe("localIsoDate / scheduleWindow (LOCAL wall-date window bounds)", () => {
  it("formats a Date's LOCAL calendar date as zero-padded YYYY-MM-DD", () => {
    // January is month 0 and the day is single-digit, so this also checks the `+ 1` and the padStart.
    const d = new Date(2026, 0, 5, 12, 0, 0); // 2026-01-05 12:00 local
    expect(localIsoDate(d)).toBe("2026-01-05");
    expect(localIsoDate(d)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  });

  it("uses the LOCAL date, not the UTC date, when the two differ (the regression guard)", () => {
    // A real Date's local and UTC dates diverge only on a non-UTC test host, so a stub makes this
    // deterministic.
    const localMay4ButUtcMay5 = {
      getFullYear: () => 2026,
      getMonth: () => 4, // May, 0-indexed
      getDate: () => 4,
      toISOString: () => "2026-05-05T00:30:00.000Z", // the next day in UTC
    } as unknown as Date;
    expect(localIsoDate(localMay4ButUtcMay5)).toBe("2026-05-04");
  });

  it("builds a half-open [from, to) window of LOCAL dates spanning `days`", () => {
    const now = new Date(2026, 4, 4, 12, 0, 0); // 2026-05-04 12:00 local
    expect(scheduleWindow(now, 14)).toEqual({ from: "2026-05-04", to: "2026-05-18" });
  });

  it("advances the upper bound on a copy, leaving the caller's Date untouched", () => {
    const now = new Date(2026, 4, 4, 12, 0, 0);
    scheduleWindow(now, 14);
    expect(localIsoDate(now)).toBe("2026-05-04"); // `now` not mutated by the `+ days`
  });
});
