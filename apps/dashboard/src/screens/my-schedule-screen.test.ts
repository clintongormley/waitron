import { LiveData } from "@waitron/dashboard-kit";
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

function selectValue(el: MyScheduleScreen, dataTest: string, value: string): void {
  const sel = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${dataTest}]`)!;
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
}

/** `wt-input`'s own `<input>` is in its shadow root, so the widget's `wt-change` is fired directly. */
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
    expect(el.shadowRoot!.querySelector("[data-test=accept-sw-offered]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=accept-sw-mine]")).toBeNull();
  });

  it("accepts a swap offered to me → calls acceptSwap and reloads the lists", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=accept-sw-offered]")!.click();
    await flush(el);
    expect(api.acceptSwap).toHaveBeenCalledWith("sw-offered");
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
    expect(banner?.textContent ?? "").not.toContain("swap.not_acceptable");
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

it("refreshes displayed shifts when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-my-schedule-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["shifts"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listMyShifts).mockResolvedValue([]);
  liveData.invalidate([{ type: "shifts", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listMyShifts).toHaveBeenCalledTimes(2);
});

describe("my-schedule-screen — keyboard submit and partial loads", () => {
  it.each(["abs-from", "abs-to", "abs-note"])(
    "requests time off on Enter in the %s field",
    async (dataTest) => {
      const api = stubApi();
      const { el } = await mount(api);
      await flush(el);
      setInput(el, "abs-from", "2026-07-01");
      setInput(el, "abs-to", "2026-07-05");
      setInput(el, "abs-note", "boda");
      await flush(el);
      const field = el.shadowRoot!.querySelector<
        HTMLElement & { updateComplete: Promise<unknown> }
      >(`[data-test=${dataTest}]`)!;
      await field.updateComplete;
      field.shadowRoot!.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
      expect(api.requestAbsence).toHaveBeenCalledExactlyOnceWith({
        kind: "holiday",
        startsOn: "2026-07-01",
        endsOn: "2026-07-05",
        note: "boda",
      });
    },
  );

  it("shows my shifts as soon as they arrive, while swaps and absences are still loading", async () => {
    const api = stubApi({
      listMySwaps: vi.fn().mockReturnValue(new Promise(() => {})),
      listMyAbsences: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    const { el } = await mount(api);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=shift-s1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#swaps-h")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#absences-h")).not.toBeNull();
    expect(
      el.shadowRoot!.querySelectorAll("[data-test^=swap-], [data-test^=absence-]"),
    ).toHaveLength(0);
    for (const list of ["swaps", "absences"]) {
      const loading = el.shadowRoot!.querySelector(`[data-test=${list}-loading]`);
      expect(loading?.textContent ?? "").toContain("Cargando…");
      expect(loading?.getAttribute("role")).toBe("status");
      expect(el.shadowRoot!.querySelector(`[data-test=${list}-empty]`)).toBeNull();
    }
  });

  it("marks the page-level loading line as a status", async () => {
    const { el } = await mount(
      stubApi({ listMyShifts: vi.fn().mockReturnValue(new Promise(() => {})) }),
    );
    await flush(el);
    const loading = el.shadowRoot!.querySelector("[data-test=loading]");
    expect(loading?.textContent ?? "").toContain("Cargando…");
    expect(loading?.getAttribute("role")).toBe("status");
  });

  it.each([
    ["shifts", "listMyShifts", "loading"],
    ["swaps", "listMySwaps", "swaps-loading"],
    ["absences", "listMyAbsences", "absences-loading"],
  ] as const)(
    "says neither empty nor loading for %s when its read fails, beside the load-failed banner",
    async (list, method, loadingId) => {
      const { el } = await mount(
        stubApi({ [method]: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
      );
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector(`[data-test=${list}-empty]`)).toBeNull();
      expect(el.shadowRoot!.querySelector(`[data-test=${loadingId}]`)).toBeNull();
    },
  );

  it("says neither empty nor loading for any list when the roster read fails", async () => {
    const api = stubApi({
      getStaffRoster: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mount(api);
    await flush(el);
    expect(api.listMyShifts).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).not.toBeNull();
    for (const [list, loadingId] of [
      ["shifts", "loading"],
      ["swaps", "swaps-loading"],
      ["absences", "absences-loading"],
    ]) {
      expect(el.shadowRoot!.querySelector(`[data-test=${list}-empty]`)).toBeNull();
      expect(el.shadowRoot!.querySelector(`[data-test=${loadingId}]`)).toBeNull();
    }
  });

  it.each([
    ["shifts", "listMyShifts", "listMySwaps", "loading", "shift-s1"],
    ["swaps", "listMySwaps", "listMyAbsences", "swaps-loading", "swap-sw-offered"],
    ["absences", "listMyAbsences", "listMySwaps", "absences-loading", "absence-a1"],
  ] as const)(
    "says nothing for %s while it is still open after a sibling read fails, then shows it when it arrives",
    async (list, pendingMethod, failingMethod, loadingId, rowId) => {
      const loaded = {
        listMyShifts: shifts,
        listMySwaps: [offeredToMe, requestedByMe],
        listMyAbsences: absences,
      };
      let arrive: () => void = () => {};
      const held = new Promise((r) => (arrive = () => r(loaded[pendingMethod])));
      const { el } = await mount(
        stubApi({
          [pendingMethod]: vi.fn().mockReturnValue(held),
          [failingMethod]: vi.fn().mockRejectedValue({ code: "server.internal" }),
        }),
      );
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector(`[data-test=${list}-empty]`)).toBeNull();
      expect(el.shadowRoot!.querySelector(`[data-test=${loadingId}]`)).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull();
      arrive();
      await flush(el);
      expect(el.shadowRoot!.querySelector(`[data-test=${rowId}]`)).not.toBeNull();
    },
  );
});

describe("my-schedule-screen — dropdowns that keep their choice", () => {
  function chosenText(el: MyScheduleScreen, dataTest: string): string | undefined {
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${dataTest}]`)!;
    return select.selectedOptions[0]?.textContent?.trim();
  }

  it("keeps the chosen colleague when the roster refreshes in a different order", async () => {
    const liveData = new LiveData();
    const withCol2: RosterEntry[] = [...roster, { personId: "col2", displayName: "Segunda" }];
    const api = Object.assign(stubApi({ getStaffRoster: vi.fn().mockResolvedValue(withCol2) }), {
      liveData,
    });
    const { el } = await mount(api);
    await flush(el);
    selectValue(el, "cover-colleague", "col2");
    await flush(el);
    vi.mocked(api.getStaffRoster).mockResolvedValue([...withCol2].reverse());
    liveData.invalidate([{ type: "persons", id: "col2" }]);
    await vi.waitFor(() => expect(api.getStaffRoster).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(chosenText(el, "cover-colleague")).toBe("Segunda");
  });

  it("keeps the chosen shift when my shifts refresh in a different order", async () => {
    const liveData = new LiveData();
    const second: MyShift = { ...shifts[0]!, id: "s2", role: "cocina" };
    const api = Object.assign(
      stubApi({ listMyShifts: vi.fn().mockResolvedValue([shifts[0]!, second]) }),
      { liveData },
    );
    const { el } = await mount(api);
    await flush(el);
    selectValue(el, "cover-shift", "s2");
    await flush(el);
    vi.mocked(api.listMyShifts).mockResolvedValue([second, shifts[0]!]);
    liveData.invalidate([{ type: "shifts", id: "s2" }]);
    await vi.waitFor(() => expect(api.listMyShifts).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(chosenText(el, "cover-shift")).toContain("cocina");
  });

  it.each([
    {
      field: "shift",
      refresh: (api: DashboardApi) => {
        vi.mocked(api.listMyShifts).mockResolvedValue([shifts[0]!]);
        return { type: "shifts", id: "s2", read: api.listMyShifts };
      },
    },
    {
      field: "colleague",
      refresh: (api: DashboardApi) => {
        vi.mocked(api.getStaffRoster).mockResolvedValue(roster);
        return { type: "persons", id: "col2", read: api.getStaffRoster };
      },
    },
  ])(
    "drops the chosen $field when a refresh removes it, so it cannot be submitted",
    async ({ field, refresh }) => {
      const liveData = new LiveData();
      const api = Object.assign(
        stubApi({
          listMyShifts: vi.fn().mockResolvedValue([shifts[0]!, { ...shifts[0]!, id: "s2" }]),
          getStaffRoster: vi
            .fn()
            .mockResolvedValue([...roster, { personId: "col2", displayName: "Segunda" }]),
        }),
        { liveData },
      );
      const { el } = await mount(api);
      await flush(el);
      selectValue(el, "cover-shift", "s2");
      selectValue(el, "cover-colleague", "col2");
      await flush(el);
      const { type, id, read } = refresh(api);
      liveData.invalidate([{ type, id }]);
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      await flush(el);
      expect(chosenText(el, `cover-${field}`)).toBe("—");
      const submit = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-test=cover-submit]",
      )!;
      expect(submit.disabled).toBe(true);
      submit.click();
      await flush(el);
      expect(api.requestSwap).not.toHaveBeenCalled();
    },
  );

  it("opens the absence-kind dropdown on a kind that is not the first", async () => {
    const api = stubApi();
    const { el } = await mountWidget<MyScheduleScreen>("dashboard-my-schedule-screen", {
      api,
      myPersonId: "me",
      absKind: "sick_leave",
    } as Partial<MyScheduleScreen>);
    await flush(el);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=abs-kind]")!;
    expect(select.selectedOptions[0]?.value).toBe("sick_leave");
  });
});

describe("my-schedule-screen — each list's own load failure", () => {
  const lists = [
    ["shifts", "listMyShifts", "No se pudieron cargar tus turnos"],
    ["swaps", "listMySwaps", "No se pudieron cargar tus cambios de turno"],
    ["absences", "listMyAbsences", "No se pudieron cargar tus ausencias"],
  ] as const;

  it.each(lists)(
    "says under %s, and only there, that its read failed",
    async (list, method, text) => {
      const { el } = await mount(
        stubApi({ [method]: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
      );
      await flush(el);
      const notice = el.shadowRoot!.querySelector(`section.${list} [data-test=${list}-failed]`);
      expect(notice?.textContent ?? "").toContain(text);
      expect(notice?.getAttribute("role")).toBe("alert");
      for (const [other] of lists) {
        if (other !== list) {
          expect(el.shadowRoot!.querySelector(`[data-test=${other}-failed]`)).toBeNull();
        }
      }
    },
  );

  it("clears a list's notice, and the page's, when a later refresh delivers its rows", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        listMySwaps: vi
          .fn()
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue([offeredToMe]),
      }),
      { liveData },
    );
    const { el } = await mount(api);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=swaps-failed]")).not.toBeNull();
    liveData.invalidate([{ type: "shift_swaps", id: "changed-elsewhere" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=swap-sw-offered]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.querySelector("[data-test=swaps-failed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).toBeNull();
  });

  it("keeps a sibling's notice when another list's refresh arrives", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({ listMyAbsences: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
      { liveData },
    );
    const { el } = await mount(api);
    await flush(el);
    vi.mocked(api.listMySwaps).mockResolvedValue([]);
    liveData.invalidate([{ type: "shift_swaps", id: "changed-elsewhere" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=swaps-empty]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.querySelector("[data-test=absences-failed]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).not.toBeNull();
  });

  it("says so under a list whose refresh fails after it had loaded, keeping its rows", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    await flush(el);
    vi.mocked(api.listMySwaps).mockRejectedValue({ code: "server.internal" });
    liveData.invalidate([{ type: "shift_swaps", id: "changed-elsewhere" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=swaps-failed]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.querySelector("[data-test=shifts-failed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=absences-failed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=swap-sw-offered]")).not.toBeNull();
  });

  it("offers a retry that reads the failed list again and clears its notice", async () => {
    const api = stubApi({
      listMyAbsences: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(absences),
    });
    const { el } = await mount(api);
    await flush(el);
    const retry = el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]");
    expect(retry?.textContent ?? "").toContain("Reintentar");
    retry!.click();
    await flush(el);
    expect(api.listMyAbsences).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=absence-a1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=absences-failed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
  });

  it("says a retried list is loading again, not failed, while its second read is open", async () => {
    const api = stubApi({
      listMyAbsences: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockReturnValue(new Promise(() => {})),
    });
    const { el } = await mount(api);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=absences-loading]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=absences-failed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).toBeNull();
  });

  it("retries the roster, and then the lists, after the roster read failed", async () => {
    const api = stubApi({
      getStaffRoster: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(roster),
    });
    const { el } = await mount(api);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]")!.click();
    await flush(el);
    expect(api.getStaffRoster).toHaveBeenCalledTimes(2);
    expect(api.listMyShifts).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=shift-s1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).toBeNull();
  });

  it("reads the lists once the roster arrives on a later refresh after its first read failed", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        getStaffRoster: vi
          .fn()
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(roster),
      }),
      { liveData },
    );
    const { el } = await mount(api);
    await flush(el);
    expect(api.listMyShifts).not.toHaveBeenCalled();
    liveData.invalidate([{ type: "persons", id: "col1" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=shift-s1]")).not.toBeNull(),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=swap-sw-offered]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=absence-a1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=load-failed]")).toBeNull();
    liveData.invalidate([{ type: "persons", id: "col1" }]);
    await vi.waitFor(() => expect(api.getStaffRoster).toHaveBeenCalledTimes(3));
    await flush(el);
    expect(api.listMyShifts).toHaveBeenCalledTimes(1);
    expect(api.listMySwaps).toHaveBeenCalledTimes(1);
    expect(api.listMyAbsences).toHaveBeenCalledTimes(1);
  });
});
