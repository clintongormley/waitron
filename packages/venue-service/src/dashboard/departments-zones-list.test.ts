import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./departments-list.js";
beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  setLocale("en");
  localStorage.clear();
  sessionStorage.clear();
});
async function setup(request?: DashboardRequest) {
  const el = (await mount(
    "<departments-list></departments-list>",
  )) as HTMLElementTagNameMap["departments-list"];
  el.model = structuredClone(zonesModel);
  Object.assign(el, {
    api: new VenueServiceApi(request ?? ((async () => ({ tables: [] })) as DashboardRequest)),
  });
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return { el, table };
}
it("keeps departments expanded with each active zone indented below its owning row", async () => {
  const { table } = await setup();
  expect(table.columns.map(({ key }) => key)).toEqual([
    "name",
    "orderStart",
    "paidWhen",
    "receiptPrintMode",
    "actions",
  ]);
  expect(table.columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
  expect(
    [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) => [
      row.getAttribute("data-row-key"),
      row.getAttribute("aria-level"),
    ]),
  ).toEqual([
    ["department:d1", "1"],
    ["zone:z1", "2"],
    ["zone:z2", "2"],
    ["zone:z3", "2"],
    ["department:d2", "1"],
    ["zone:z4", "2"],
  ]);
  expect(table.shadowRoot!.querySelectorAll(".tree-toggle")).toHaveLength(0);
  expect(table.shadowRoot!.querySelectorAll("[data-test^=zone-grip-]")).toHaveLength(4);
});
it("styles only raw-null inheritance even when an explicit value equals its department", async () => {
  const { table } = await setup();
  const raw = table.shadowRoot!.querySelector('[data-row-key="zone:z2"]')!;
  const explicit = table.shadowRoot!.querySelector('[data-row-key="zone:z3"]')!;
  expect(raw, "zone rows are shown under their departments").not.toBeNull();
  expect(explicit, "explicit zone rows are shown").not.toBeNull();
  expect(raw.querySelector("[part~=inherited-orderStart]")!.textContent).toBe("Table service");
  expect(raw.querySelector("[part~=inherited-paidWhen]")!.textContent).toBe(
    "Paid before preparation",
  );
  expect(raw.querySelector("[part~=inherited-receiptPrintMode]")).toBeNull();
  expect(explicit.querySelector("[part~=inherited]")).toBeNull();
  const inherited = raw.querySelector("[part~=inherited]")!;
  expect(getComputedStyle(inherited).fontStyle).toBe("italic");
  expect(getComputedStyle(inherited).color).not.toBe(
    getComputedStyle(explicit.querySelector("[part~=policy]")!).color,
  );
});
it("each row opens its own editor and department menus offer Edit, Add a zone, Edit receipt and Delete", async () => {
  const { el, table } = await setup();
  const opened = vi.fn(),
    zone = vi.fn();
  el.addEventListener("open-department", opened);
  el.addEventListener("edit-zone", zone);
  expect(
    table.shadowRoot!.querySelector('[data-row-key="zone:z1"]'),
    "the editable zone row is shown",
  ).not.toBeNull();
  await userEvent.click(
    table.shadowRoot!.querySelector('[data-row-key="department:d1"] .row-activate')!,
  );
  await userEvent.click(table.shadowRoot!.querySelector('[data-row-key="zone:z1"] .row-activate')!);
  expect(opened.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d1" },
  ]);
  expect(zone.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { zoneId: "z1" },
  ]);
  const menu = table.shadowRoot!.querySelector('[data-row-key="department:d1"] wt-row-actions')!;
  expect(
    [...menu.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
  ).toEqual(["Edit", "Add zone", "Edit receipt", "Delete"]);
});
it("opening a zone menu reads its floor plan passively and offers Add or Edit according to placed tables", async () => {
  const reads: unknown[][] = [];
  const { el, table } = await setup((async (...args) => {
    reads.push(args);
    return {
      tables: [
        {
          id: "t1",
          fixed: true,
          placement: { x: 0, y: 0, width: 2, height: 2, shape: "rect", rotation: 0 },
        },
      ],
    };
  }) as DashboardRequest);
  expect(reads).toEqual([]);
  const menu = table.shadowRoot!.querySelector('[data-row-key="zone:z1"] wt-row-actions')!;
  expect(menu, "the zone has its own row menu").not.toBeNull();
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await expect
    .poll(() =>
      el
        .shadowRoot!.querySelector("wt-data-table")!
        .shadowRoot!.querySelector('[data-test="floor-plan-zone-z1"]')
        ?.textContent?.trim(),
    )
    .toBe("Edit floor plan");
  expect(reads).toEqual([
    ["/management-api/zones/z1/floor-plan", "GET", undefined, { passive: true }],
  ]);
  expect(
    table.shadowRoot!.querySelector('[data-test="floor-plan-zone-z1"]')!.getAttribute("href"),
  ).toBe("/manage/floor-plan/zone/z1?back=%2Fmanage%2Fvenue-operations");
});
it("a removed menu subject releases its floor-plan watch", async () => {
  const { el, table } = await setup();
  const detach = vi.fn();
  vi.spyOn(el.api!, "watchZoneFloorPlan").mockReturnValue(detach);
  const menu = table.shadowRoot!.querySelector('[data-row-key="zone:z1"] wt-row-actions')!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  el.model = { ...el.model!, zones: el.model!.zones.filter((row) => row.id !== "z1") };
  await el.updateComplete;
  expect(detach).toHaveBeenCalledExactlyOnceWith();
});

it("names missing department receipt setup and opens that receipt without activating the row", async () => {
  const { el, table } = await setup();
  el.model!.readiness.push(
    Object.assign(
      {},
      {
        code: "department.operation_description_required" as const,
        departmentId: "d1",
        departmentName: "Restaurant",
      },
    ),
  );
  el.requestUpdate();
  await el.updateComplete;
  await table.updateComplete;
  const row = table.shadowRoot!.querySelector('[data-row-key="department:d1"]')!;
  expect(row.textContent).toContain("Set up the tax-agency description");
  const receipt = vi.fn(),
    edit = vi.fn();
  el.addEventListener("edit-receipt", receipt);
  el.addEventListener("open-department", edit);
  const action = row.querySelector<HTMLElement>("[data-test=receipt-setup-d1]");
  expect(action, "missing-description setup offers its receipt editor").not.toBeNull();
  await userEvent.click(action!);
  expect(receipt.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d1" },
  ]);
  expect(edit).not.toHaveBeenCalled();
  el.receiptAvailable = () => false;
  await el.updateComplete;
  await table.updateComplete;
  expect(row.textContent).toContain("Set up the tax-agency description");
  expect(row.querySelector("[data-test=receipt-setup-d1]")).toBeNull();
});
