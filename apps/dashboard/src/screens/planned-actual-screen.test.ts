import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, PersonSummary, PlannedVsActualRow } from "../api/client.js";
import { PlannedActualScreen } from "./planned-actual-screen.js";
import { MS_PER_DAY, mondayOf, today } from "../date-utils.js";
import type { WtInput } from "@waitron/ui";

const staff: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];
const rows: PlannedVsActualRow[] = [
  {
    personId: "p1",
    workDate: "2026-03-02",
    plannedMinutes: 240,
    workedMinutes: 225,
    lateMinutes: 15,
    noShow: false,
    unplanned: false,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(staff),
    getPlannedVsActual: vi.fn().mockResolvedValue(rows),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: PlannedActualScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

/** Sends the week field's `wt-change`, as a date the operator finished typing does. */
function chooseWeek(week: HTMLElement, value: string): void {
  week.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

describe("planned-actual-screen", () => {
  it("loads staff and the week's rows on connect, resolving the person name", async () => {
    const api = stubApi({ getLocations: vi.fn() });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(api.getLocations).not.toHaveBeenCalled();
    const monday = mondayOf(today());
    expect(api.getPlannedVsActual).toHaveBeenCalledWith(
      monday,
      new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * MS_PER_DAY).toISOString().slice(0, 10),
    );
    expect(el.shadowRoot!.textContent).toContain("Ana");
    expect(el.shadowRoot!.textContent).toContain("240");
  });

  it("passes a Monday..Monday+7 half-open window (from = Monday, to = from + 7 days)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const week = el.shadowRoot!.querySelector<WtInput>("[data-test=week-picker]")!;
    chooseWeek(week, "2026-04-08"); // a Wednesday → Monday 2026-04-06, to 2026-04-13
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith("2026-04-06", "2026-04-13");
  });

  it("shows the empty prompt when the week has no rows", async () => {
    const api = stubApi({ getPlannedVsActual: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).not.toBeNull();
  });

  it("shows no empty prompt while the opening rows read is still pending", async () => {
    const api = stubApi({ getPlannedVsActual: vi.fn(() => new Promise<never>(() => {})) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=week-picker]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).toBeNull();
  });

  it("shows the error banner and no empty prompt when the opening rows read fails, and the empty prompt once a read answers with no rows", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        getPlannedVsActual: vi
          .fn()
          .mockRejectedValueOnce({ code: "connection.failed" })
          .mockResolvedValue([]),
      }),
      { liveData },
    );
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=error]")?.textContent?.trim()).toBe(
        codeMessage("connection.failed"),
      ),
    );
    expect(el.shadowRoot!.querySelector("[data-test=week-picker]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).toBeNull();
    liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=empty]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.querySelector("[data-test=error]")).toBeNull();
  });

  it("shows the error banner when a load rejects", async () => {
    const api = stubApi({
      getPlannedVsActual: vi.fn().mockRejectedValue({ code: "convenio.not_found" }),
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("renders the no-show / unplanned flags, and the raw id when the person is unknown", async () => {
    const api = stubApi({
      getPlannedVsActual: vi.fn().mockResolvedValue([
        {
          personId: "ghost",
          workDate: "2026-03-03",
          plannedMinutes: 0,
          workedMinutes: 60,
          lateMinutes: 0,
          noShow: true,
          unplanned: true,
        },
      ]),
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain("Ausencia"); // planned.no_show, es
    expect(text).toContain("No previsto"); // planned.unplanned, es
    expect(text).toContain("ghost"); // raw id shown when the person is not in the staff list
  });

  it("ignores a cleared week input (Invalid Date) without reloading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenCalledTimes(1);
    const week = el.shadowRoot!.querySelector<WtInput>("[data-test=week-picker]")!;
    chooseWeek(week, "");
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected week change as the error banner", async () => {
    const api = stubApi({
      getPlannedVsActual: vi
        .fn()
        .mockResolvedValueOnce(rows) // initial connect load succeeds
        .mockRejectedValue({ code: "convenio.not_found" }), // the week-change load rejects
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const week = el.shadowRoot!.querySelector<WtInput>("[data-test=week-picker]")!;
    chooseWeek(week, "2026-04-08");
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("falls back to server.internal when a thrown error carries no code", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });
});

it("refreshes displayed rows when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-planned-actual-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["rows"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.getPlannedVsActual).mockResolvedValue([]);
  liveData.invalidate([{ type: "shifts", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.getPlannedVsActual).toHaveBeenCalledTimes(2);
});

describe("planned-actual-screen week field", () => {
  it("picks the week from a labelled date field showing the Monday, and a picked day loads its week", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const week = el.shadowRoot!.querySelector("wt-input[data-test=week-picker]") as HTMLElement & {
      type: string;
      label: string;
      name: string;
      value: string;
    };
    expect(week.type).toBe("date");
    expect(week.name).toBe("week");
    expect(week.label).toBe(t("planned.week"));
    expect(new Date(`${week.value}T00:00:00Z`).getUTCDay()).toBe(1);
    week.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "2026-04-08" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith("2026-04-06", "2026-04-13");
  });

  it("keeps the week field at its own width on a wide screen", async () => {
    const [width, height] = [window.innerWidth, window.innerHeight];
    await page.viewport(1280, 800);
    try {
      const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
        api: stubApi(),
      });
      await flush(el);
      const week = el.shadowRoot!.querySelector("wt-input[data-test=week-picker]")!;
      expect(week.getBoundingClientRect().width).toBeLessThan(el.getBoundingClientRect().width / 2);
    } finally {
      await page.viewport(width, height);
    }
  });
});

describe("planned-actual-screen — recovery after the server answers again", () => {
  const errorText = (el: PlannedActualScreen) =>
    el.shadowRoot!.querySelector("[data-test=error]")?.textContent?.trim();

  it("clears a failed rows read's message once the server answers again", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        getPlannedVsActual: vi
          .fn()
          .mockRejectedValueOnce({ code: "connection.failed" })
          .mockResolvedValue(rows),
      }),
      { liveData },
    );
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await vi.waitFor(() => expect(errorText(el)).toBe(codeMessage("connection.failed")));
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).toBeNull();
    liveData.refresh();
    await vi.waitFor(() => expect(errorText(el)).toBeUndefined());
    expect(el.shadowRoot!.textContent).toContain("240");
  });

  it("shows the staff names once the staff read that failed on opening succeeds", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        listStaff: vi
          .fn()
          .mockRejectedValueOnce({ code: "connection.failed" })
          .mockResolvedValue(staff),
      }),
      { liveData },
    );
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await vi.waitFor(() =>
      expect((el as unknown as { errorKey: string | null }).errorKey).toBe("connection.failed"),
    );
    liveData.refresh();
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Ana"));
    expect(el.shadowRoot!.textContent).toContain("240");
    await vi.waitFor(() => expect(errorText(el)).toBeUndefined());
  });
});
