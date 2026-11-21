import { LiveData } from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, DrawerCloseHistoryDto } from "../api/client.js";
import type { SalesScreen } from "../screens/dashboard-sales-screen.js";
import "../screens/dashboard-sales-screen.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const first = {
  at: "2026-11-20T17:00:00Z",
  person: "Alex",
  expected: "10.00",
  counted: "8.00",
  difference: "-2.00",
  cashMoved: true,
};
const history: DrawerCloseHistoryDto = {
  timeZone: "Europe/Madrid",
  closes: [
    {
      id: "pending",
      drawerId: "bar",
      drawerName: "Bar drawer",
      assigned: false,
      deleted: false,
      first,
      recount: null,
      finished: null,
    },
    {
      id: "count",
      drawerId: "kitchen",
      drawerName: "Kitchen drawer",
      assigned: false,
      deleted: false,
      first,
      recount: {
        ...first,
        person: "Robin",
        counted: "9.00",
        difference: "-1.00",
        cashMoved: false,
      },
      finished: {
        id: "close",
        person: "Robin",
        at: "2026-11-20T17:05:00Z",
        bankWithdrawal: "6.00",
        amountLeft: "3.00",
        difference: "-1.00",
        cashAfterCount: "2.00",
      },
    },
  ],
};
const printers = [
  { id: "p1", name: "Counter printer" },
  { id: "p2", name: "Kitchen printer" },
];

function fixture() {
  const liveData = new LiveData();
  const getDrawerCloses = vi.fn().mockResolvedValue(history);
  const printDrawerClose = vi.fn().mockResolvedValue({ jobId: "job" });
  const api = {
    liveData,
    background: { getDrawerCloses },
    getDrawerCloses: vi.fn().mockRejectedValue(new Error("expected a passive read")),
    getReportPrinters: async () => printers,
    getSalesOverview: async () => ({ businessDay: "2026-11-20" }),
    printDrawerClose,
  } as unknown as DashboardApi;
  return { api, getDrawerCloses, printDrawerClose, liveData };
}

const body = (el: SalesScreen) =>
  el.shadowRoot!.querySelector("dashboard-drawer-close-history")?.shadowRoot;
const text = (el: SalesScreen) => body(el)?.textContent ?? "";

it("uses the Sales dates and preserves the drawer filter on a passive refresh", async () => {
  const { api, getDrawerCloses, liveData } = fixture();
  const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
  await vi.waitFor(() => expect(text(el)).toContain("Bar drawer"));
  expect(getDrawerCloses).toHaveBeenLastCalledWith("2026-11-20", "2026-11-20");
  await chooseOption(body(el)!.querySelector('wt-combobox[name="drawerId"]')!, "kitchen");
  await vi.waitFor(() => expect(body(el)!.querySelectorAll("summary")).toHaveLength(1));
  expect(body(el)!.querySelector("summary")!.textContent).toContain("Kitchen drawer");

  getDrawerCloses.mockResolvedValue({
    ...history,
    closes: [history.closes[0]!, { ...history.closes[1]!, drawerName: "Back counter" }],
  });
  liveData.invalidate([{ type: "drawer_entries" }]);
  await vi.waitFor(() =>
    expect(body(el)!.querySelector("summary")!.textContent).toContain("Back counter"),
  );
  expect(body(el)!.querySelectorAll("summary")).toHaveLength(1);
  expect(getDrawerCloses).toHaveBeenLastCalledWith("2026-11-20", "2026-11-20");
});

it("shows the new date range when it has no counts for the previously selected drawer", async () => {
  const { api, getDrawerCloses } = fixture();
  const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
  await vi.waitFor(() => expect(text(el)).toContain("Kitchen drawer"));
  await chooseOption(body(el)!.querySelector('wt-combobox[name="drawerId"]')!, "kitchen");
  getDrawerCloses.mockResolvedValue({ ...history, closes: [history.closes[0]!] });
  el.shadowRoot!.querySelector('[data-test="to-picker"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "2026-11-21" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(body(el)!.querySelector("summary")?.textContent ?? "").toContain("Bar drawer"),
  );
  expect(getDrawerCloses).toHaveBeenLastCalledWith("2026-11-20", "2026-11-21");
});

it.each(["light", "dark"] as const)(
  "shows pending counts and reprint feedback in %s theme",
  async (theme) => {
    const { api, printDrawerClose } = fixture();
    const { el, host } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api }, theme);
    await vi.waitFor(() => expect(body(el)?.querySelectorAll("summary")).toHaveLength(2));
    const [pending, finished] = body(el)!.querySelectorAll("details");
    pending!.open = true;
    finished!.open = true;
    expect(pending!.textContent).toContain("Count pending");
    expect(body(el)!.querySelector('wt-combobox[name="printerId"]')).toBeNull();
    expect(pending!.textContent).toContain("Alex");
    expect(pending!.textContent).toContain("Assign a till");
    expect(pending!.querySelector("wt-button")).toBeNull();
    expect(finished!.textContent).toContain("Robin");
    expect(finished!.textContent).not.toContain("Assign a till");
    expect(finished!.textContent).toContain("Cash moved after the count");
    expect(text(el)).toContain("Pending counts show for any date.");
    await chooseOption(el.shadowRoot!.querySelector('[data-test="print-printer"]')!, "p2");

    printDrawerClose.mockRejectedValueOnce({ code: "printer.not_found" });
    finished!.querySelector<HTMLElement>("wt-button")!.click();
    await vi.waitFor(() =>
      expect(body(el)!.querySelector('[role="alert"]')?.textContent?.trim()).toBeTruthy(),
    );
    expect(printDrawerClose).toHaveBeenCalledWith("close", "p2");
    finished!.querySelector<HTMLElement>("wt-button")!.click();
    await vi.waitFor(() =>
      expect(body(el)!.querySelector('[role="status"]')?.textContent).toContain("Kitchen printer"),
    );
    await expectNoA11yViolations(host);
  },
);
