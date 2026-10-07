import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillApi, type DepartmentTransfer } from "../api/client.js";
import { TillDepartmentTransfers } from "./department-transfers.js";

const sent: DepartmentTransfer = {
  id: "sent-one",
  tabId: "tab-one",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "ana",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending",
  reason: null,
  createdAt: "2026-10-07T09:00:00Z",
  resolvedAt: null,
  revision: 0,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
afterEach(cleanupWidgets);
async function mount(rows: DepartmentTransfer[] = [], refused = false) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const api = new TillApi("", async (url, init) => {
    calls.push({
      url: String(url),
      method: String(init?.method),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (init?.method === "POST")
      return refused
        ? json(
            {
              error: {
                code: "management.request_invalid",
                params: { field: "destinationDepartmentId" },
              },
            },
            409,
          )
        : json({ ...sent, status: String(url).endsWith("withdraw") ? "withdrawn" : "pending" });
    return json({ destinations: [{ id: "restaurant", name: "Restaurant" }] });
  });
  const { el } = await mountWidget<TillDepartmentTransfers>("till-department-transfers", {
    api,
    open: true,
    currentTabId: "tab-one",
    currentTabLabel: "Tab 12 — Lunch",
    snapshot: {
      incoming: [],
      sent: rows,
      receivingAllowed: false,
      notifications: [],
      error: undefined,
    },
  });
  return { el, calls };
}
function click(el: TillDepartmentTransfers, selector: string) {
  const target = el.shadowRoot!.querySelector<HTMLElement>(selector);
  expect(target, selector).not.toBeNull();
  target!.click();
}
async function choose(el: TillDepartmentTransfers, value: string) {
  const field = el.shadowRoot!.querySelector("[name=destinationDepartmentId]")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function begin(el: TillDepartmentTransfers) {
  click(el, "[data-request-transfer]");
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
        ?.disabled,
    ).toBe(false),
  );
}
it("requests the selected tab only after an explicit permitted destination choice", async () => {
  const { el, calls } = await mount();
  await begin(el);
  expect(el.shadowRoot!.textContent).toContain("Tab 12 — Lunch");
  click(el, "[data-save-transfer]");
  await el.updateComplete;
  expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=destinationDepartmentId]")!
      .error,
  ).not.toBe("");
  await choose(el, "unpermitted");
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
      .disabled,
  ).toBe(true);
  await choose(el, "restaurant");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() =>
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      {
        url: "/api/working-orders/tab-one/department-transfers",
        method: "POST",
        body: { destinationDepartmentId: "restaurant" },
      },
    ]),
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[name=destinationDepartmentId]")).toBeNull(),
  );
  expect(calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual([
    "/api/department-transfers/destinations",
  ]);
});
it("a refused request retains the destination and marks the field with a valid retry enabled", async () => {
  const { el, calls } = await mount([], true);
  await begin(el);
  await choose(el, "restaurant");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        "[name=destinationDepartmentId]",
      )!.error,
    ).not.toBe(""),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[name=destinationDepartmentId]")!
      .value,
  ).toBe("restaurant");
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
      .disabled,
  ).toBe(false);
});
it("pending sender history allows withdrawal and prevents another request for that tab", async () => {
  const { el, calls } = await mount([sent]);
  expect(el.shadowRoot!.querySelector("[data-request-transfer]")).toBeNull();
  let changed = 0;
  el.addEventListener("transfer-changed", () => changed++);
  click(el, "[data-withdraw-transfer]");
  await vi.waitFor(() => expect(changed).toBe(1));
  expect(calls).toEqual([
    { url: "/api/department-transfers/sent-one/withdraw", method: "POST", body: null },
  ]);
  el.snapshot = { ...el.snapshot, sent: [{ ...sent, status: "declined", reason: "Closing soon" }] };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-withdraw-transfer]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("Closing soon");
  expect(el.shadowRoot!.querySelector("[data-request-transfer]")).not.toBeNull();
});
it("changing the current tab retires request controls so a departed Save cannot submit", async () => {
  const { el, calls } = await mount();
  await begin(el);
  await choose(el, "restaurant");
  const save = el.shadowRoot!.querySelector<HTMLElement>("[data-save-transfer]")!;
  Object.assign(el, { currentTabId: "tab-two", currentTabLabel: "Tab 13" });
  await el.updateComplete;
  save.click();
  expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  expect(el.shadowRoot!.querySelector("[name=destinationDepartmentId]")).toBeNull();
});

it("a successful request stays pending locally while its durable queue refresh is still outstanding", async () => {
  const { el, calls } = await mount();
  await begin(el);
  await choose(el, "restaurant");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-save-transfer]")).toBeNull());
  expect(el.shadowRoot!.querySelector("[data-request-transfer]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-sent=sent-one]")?.textContent).toContain(
    "Transfer pending",
  );
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

it("a destination read can be cancelled and a late reply cannot repopulate a reopened request", async () => {
  let answer!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  let reads = 0;
  const api = new TillApi("", async (_, init) => {
    if (++reads === 1) {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    }
    return json({ destinations: [{ id: "restaurant", name: "Restaurant" }] });
  });
  const { el } = await mountWidget<TillDepartmentTransfers>("till-department-transfers", {
    api,
    open: true,
    currentTabId: "tab-one",
    snapshot: {
      incoming: [],
      sent: [],
      notifications: [],
      receivingAllowed: false,
      error: undefined,
    },
  });
  click(el, "[data-request-transfer]");
  await el.updateComplete;
  click(el, "[data-cancel-transfer]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[name=destinationDepartmentId]")).toBeNull(),
  );
  expect(signal?.aborted).toBe(true);
  await begin(el);
  answer(json({ destinations: [{ id: "departed", name: "Departed department" }] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { options: unknown[] }>(
      "[name=destinationDepartmentId]",
    )!.options,
  ).toEqual([{ value: "restaurant", label: "Restaurant" }]);
});
it("a refused withdrawal keeps the pending request actionable and displays its refusal", async () => {
  const { el, calls } = await mount([sent], true);
  click(el, "[data-withdraw-transfer]");
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-withdraw-transfer]")!
      .disabled,
  ).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-sent=sent-one]")?.textContent).toContain(
    "Transfer pending",
  );
});

it.each(["restaurant", "deli"])(
  "a department refusal names the chosen field only when its carried id is %s",
  async (departmentId) => {
    const api = new TillApi("", async (_, init) =>
      init?.method === "POST"
        ? json(
            { error: { code: "department_transfer.desk_unavailable", params: { departmentId } } },
            409,
          )
        : json({ destinations: [{ id: "restaurant", name: "Restaurant" }] }),
    );
    const { el } = await mountWidget<TillDepartmentTransfers>("till-department-transfers", {
      api,
      open: true,
      currentTabId: "tab-one",
      snapshot: {
        incoming: [],
        sent: [],
        notifications: [],
        receivingAllowed: false,
        error: undefined,
      },
    });
    await begin(el);
    await choose(el, "restaurant");
    click(el, "[data-save-transfer]");
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
          .disabled,
      ).toBe(false),
    );
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-transfer-actions]")!
          .error,
      ).not.toBe(""),
    );
    const field = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      "[name=destinationDepartmentId]",
    )!;
    if (departmentId === "restaurant")
      expect(field.error).toBe(
        "That department has no usable receiving desk. Ask a manager to check its transfer settings.",
      );
    else {
      expect(field.error).toBe("");
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-transfer-actions]")!
          .error,
      ).toBe(
        "That department has no usable receiving desk. Ask a manager to check its transfer settings.",
      );
    }
  },
);

it("disconnecting clears a local request acknowledgement before the widget is reused", async () => {
  const { el } = await mount();
  await begin(el);
  await choose(el, "restaurant");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-sent=sent-one]")).not.toBeNull(),
  );
  const parent = el.parentElement!;
  el.remove();
  parent.appendChild(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-sent=sent-one]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-request-transfer]")).not.toBeNull();
});

it("withdraws a just-sent request before polling and immediately permits a new destination", async () => {
  const { el } = await mount();
  await begin(el);
  await choose(el, "restaurant");
  click(el, "[data-save-transfer]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-withdraw-transfer]")).not.toBeNull(),
  );
  expect(el.snapshot.sent).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-request-transfer]")).toBeNull();
  click(el, "[data-withdraw-transfer]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-request-transfer]")).not.toBeNull(),
  );
  expect(el.shadowRoot!.querySelector("[data-withdraw-transfer]")).toBeNull();
});
