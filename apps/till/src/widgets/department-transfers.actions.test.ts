import { afterEach, expect, it, vi } from "vitest";
import { mountWidget, cleanupWidgets } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { TillDepartmentTransfers } from "./department-transfers.js";
import type { DepartmentTransferDetail, TableState } from "../api/client.js";

const request = {
  id: "incoming-1",
  tabId: "tab-1",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "ana",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending" as const,
  reason: null,
  createdAt: "2026-10-07T09:00:00.000Z",
  resolvedAt: null,
  revision: 0,
};
const detail: DepartmentTransferDetail = {
  request,
  tab: {
    id: "tab-1",
    revision: 9,
    status: "placed",
    label: "Lunch",
    orderNumber: 12,
    deliveryTableId: null,
  },
  lines: [],
  outstandingWork: [],
};
const zones = [
  {
    id: "terrace",
    name: "Terrace",
    departmentId: "restaurant",
    departmentName: "Restaurant",
    serviceMode: "table_tab" as const,
  },
  {
    id: "deli-counter",
    name: "Deli",
    departmentId: "deli",
    departmentName: "Deli",
    serviceMode: "prepay" as const,
  },
];
afterEach(cleanupWidgets);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
async function mount(refusal?: string, tables: TableState[] = []) {
  const writes: { url: string; body: unknown }[] = [];
  const api = new TillApi("", async (url, init) => {
    if (init?.method === "POST") {
      writes.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return refusal
        ? json({ error: { code: refusal, params: { field: "zoneId" } } }, 409)
        : json({ ...request, status: String(url).endsWith("accept") ? "accepted" : "declined" });
    }
    if (String(url).endsWith("/tables/state")) return json(tables);
    return json(detail);
  });
  const { el } = await mountWidget<TillDepartmentTransfers>("till-department-transfers", {
    api,
    open: true,
    snapshot: {
      incoming: [request],
      receivingAllowed: true,
      sent: [],
      notifications: [],
      error: undefined,
    },
    ...{ serviceZones: zones },
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-view]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-current-tab]")).not.toBeNull());
  return { el, writes };
}
function click(el: TillDepartmentTransfers, selector: string) {
  const button = el.shadowRoot!.querySelector<HTMLElement>(selector);
  expect(button, selector).not.toBeNull();
  button!.click();
}
async function change(el: TillDepartmentTransfers, name: string, value: string) {
  const field = el.shadowRoot!.querySelector(`[name=${name}]`)!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
it("acceptance requires an explicit receiving zone and submits the displayed tab revision", async () => {
  const { el, writes } = await mount();
  click(el, "[data-accept]");
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
        ?.disabled,
    ).toBe(false),
  );
  click(el, "[data-save-transfer]");
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=zoneId]")!.error,
  ).not.toBe("");
  await change(el, "zoneId", "terrace");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() =>
    expect(writes).toEqual([
      {
        url: "/api/department-transfers/incoming-1/accept",
        body: { revision: 9, zoneId: "terrace", tableId: null },
      },
    ]),
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-save-transfer]")).toBeNull());
});
it("decline requires a nonblank reason and preserves it after a refusal", async () => {
  const { el, writes } = await mount("department_transfer.not_pending");
  click(el, "[data-decline]");
  await el.updateComplete;
  click(el, "[data-save-transfer]");
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=reason]")!.error,
  ).not.toBe("");
  await change(el, "reason", "  Closing soon  ");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() =>
    expect(writes).toEqual([
      { url: "/api/department-transfers/incoming-1/decline", body: { reason: "Closing soon" } },
    ]),
  );
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("wt-form-actions")?.getAttribute("data-transfer-actions"),
    ).not.toBeNull(),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[name=reason]")!.value,
  ).toBe("  Closing soon  ");
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
        .disabled,
    ).toBe(false),
  );
});
it("a destination refusal marks the named field without disabling a valid retry", async () => {
  const { el, writes } = await mount("department_transfer.destination_invalid");
  click(el, "[data-accept]");
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
        ?.disabled,
    ).toBe(false),
  );
  await change(el, "zoneId", "terrace");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=zoneId]")!.error,
    ).not.toBe(""),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
      .disabled,
  ).toBe(false);
});

it("a never-answering table read is bounded and closing the dialog aborts it", async () => {
  let tableSignal: AbortSignal | undefined;
  const api = new TillApi("", async (url, init) => {
    if (String(url).endsWith("/tables/state")) {
      tableSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }
    return json(detail);
  });
  const { el } = await mountWidget<TillDepartmentTransfers>("till-department-transfers", {
    api,
    open: true,
    serviceZones: zones,
    snapshot: {
      incoming: [request],
      receivingAllowed: true,
      sent: [],
      notifications: [],
      error: undefined,
    },
  });
  click(el, "[data-view]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-current-tab]")).not.toBeNull());
  vi.useFakeTimers();
  try {
    click(el, "[data-accept]");
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(25_001);
    await el.updateComplete;
    expect(tableSignal?.aborted).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
        .disabled,
    ).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-retry-tables]")).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
  click(el, "[data-retry-tables]");
  await el.updateComplete;
  let closes = 0;
  el.addEventListener("close-transfers", () => {
    closes++;
    el.open = false;
  });
  const closed = new Promise((resolve) =>
    el
      .shadowRoot!.querySelector("wt-dialog")!
      .addEventListener("wt-close", resolve, { once: true }),
  );
  click(el, "[data-close-transfers]");
  await closed;
  await vi.waitFor(() => expect(closes).toBe(1));
  expect(tableSignal?.aborted).toBe(true);
});

it("losing receiving access clears both current work and staged actions", async () => {
  const { el, writes } = await mount();
  click(el, "[data-decline]");
  await el.updateComplete;
  await change(el, "reason", "Closing soon");
  const save = el.shadowRoot!.querySelector<HTMLElement>("[data-save-transfer]")!;
  el.snapshot = { ...el.snapshot, receivingAllowed: false };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-current-tab]")).toBeNull();
  save.click();
  expect(writes).toEqual([]);
});
it("a table outside the chosen zone is refused locally beside the table field", async () => {
  const { el, writes } = await mount();
  click(el, "[data-accept]");
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
        ?.disabled,
    ).toBe(false),
  );
  await change(el, "zoneId", "terrace");
  await change(el, "tableId", "foreign-table");
  click(el, "[data-save-transfer]");
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=tableId]")!.error,
  ).not.toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
      .disabled,
  ).toBe(true);
});

it("acceptance sends a selected table in its chosen zone", async () => {
  const table: TableState = {
    id: "table-one",
    label: "1",
    zoneId: "terrace",
    capacity: 4,
    state: "free",
    hasOpenTab: false,
    condition: "free",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    party: null,
    signals: [],
  };
  const { el, writes } = await mount(undefined, [table]);
  click(el, "[data-accept]");
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
        ?.disabled,
    ).toBe(false),
  );
  await change(el, "zoneId", "terrace");
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { options: { value: string; label: string }[] }>(
      "[name=tableId]",
    )!.options,
  ).toEqual([
    { value: "", label: expect.any(String) },
    { value: "table-one", label: "1" },
  ]);
  await change(el, "tableId", "table-one");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() =>
    expect(writes).toEqual([
      {
        url: "/api/department-transfers/incoming-1/accept",
        body: { revision: 9, zoneId: "terrace", tableId: "table-one" },
      },
    ]),
  );
});
