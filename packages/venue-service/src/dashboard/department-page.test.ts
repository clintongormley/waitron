import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { VenueServiceView } from "./client.js";
import type { DepartmentPage } from "./department-page.js";
import "./department-page.js";
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      defaultServiceMode: "table_tab",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", defaultServiceMode: "prepay", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      defaultServiceMode: "prepay",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Terrace",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z3",
      name: "Same",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z4",
      name: "Other",
      departmentId: "d2",
      departmentName: "Deli",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
  ],
  floorZones: [],
  readiness: [],
  salePolicies: {
    departments: [
      {
        departmentId: "d1",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    ],
    zones: [
      {
        zoneId: "z1",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
        effective: {
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
      {
        zoneId: "z2",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: "on_request",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "on_request",
          printTradingName: false,
        },
      },
      {
        zoneId: "z3",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
    ],
  },
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};

let el: DepartmentPage;
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
async function mount(view = structuredClone(model)) {
  el = document.createElement("department-page") as DepartmentPage;
  applyTokens(el);
  el.model = view;
  el.departmentId = "d1";
  document.body.append(el);
  await el.updateComplete;
  expect(el.shadowRoot, "department page renders").not.toBeNull();
  return el;
}

it("always puts the parent trail above the one h1 even for one department", async () => {
  const view = structuredClone(model);
  view.departments = [view.departments[0]!];
  await mount(view);
  const root = el.shadowRoot!;
  const nav = root.querySelector("nav")!;
  expect(nav.getAttribute("aria-label")).toBe("Departments");
  const link = nav.querySelector("a")!;
  expect(link.textContent!.trim()).toBe("Departments");
  expect(link.getAttribute("href")).toBe("/manage/venue-operations");
  expect(nav.textContent).toContain("›");
  expect(root.querySelectorAll("h1")).toHaveLength(1);
  expect(root.querySelector("h1")!.textContent).toBe("Restaurant");
  expect(
    nav.compareDocumentPosition(root.querySelector("h1")!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it.each(["settings", "zones"] as const)(
  "%s leaves opening-hours editing on its separate page",
  async (tab) => {
    await mount();
    el.view = tab;
    await el.updateComplete;
    const roots: ShadowRoot[] = [el.shadowRoot!];
    for (const root of roots) {
      expect(root.querySelector('[data-test="hours"]')).toBeNull();
      expect(root.querySelector('[data-test="hours-actions"]')).toBeNull();
      expect(root.querySelector('[data-test="new-hours"]')).toBeNull();
      for (const node of root.querySelectorAll<HTMLElement>("*")) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
      }
    }
  },
);
it("leaves modifier clicks on the parent link to the browser", async () => {
  await mount();
  const link = el.shadowRoot!.querySelector("nav a")!;
  let intercepted: boolean | undefined;
  const capture = (event: Event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  };
  el.addEventListener("click", capture);
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    const event = new MouseEvent("click", {
      bubbles: true,
      composed: true,
      cancelable: true,
      [modifier]: true,
    });
    link.dispatchEvent(event);
    expect(intercepted).toBe(false);
  }
});
it("wraps a long one-word heading at phone width", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 844);
    const view = structuredClone(model);
    view.departments[0]!.name = "Restaurant".repeat(30);
    await mount(view);
    const h1 = el.shadowRoot!.querySelector("h1")!;
    expect(window.innerWidth).toBe(390);
    expect(h1.scrollWidth).toBeLessThanOrEqual(h1.clientWidth);
    const text = document.createRange();
    text.selectNodeContents(h1);
    expect(text.getClientRects().length).toBeGreaterThan(1);
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});
it("shows only this department's readiness on its Setup line", async () => {
  const view = structuredClone(model);
  view.readiness = [
    { code: "department.no_periods", departmentId: "d1", departmentName: "Restaurant" },
    { code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Terrace" },
    { code: "zone.menu_empty", zoneId: "z2", zoneName: "Bar", menuId: "m", menuName: "Lunch" },
    { code: "department.no_periods", departmentId: "d2", departmentName: "Deli" },
    { code: "venue.default_station_missing" },
  ];
  await mount(view);
  const setup = el.shadowRoot!.querySelector("[data-test=setup]")!;
  expect(setup.textContent).toContain("Restaurant has no opening periods.");
  expect(setup.textContent).toContain("Terrace");
  expect(setup.textContent).toContain("Bar: Lunch");
  expect(setup.textContent).not.toContain("Deli");
  expect(setup.textContent).not.toContain("default preparation station");
  expect(setup.querySelector("a")!.getAttribute("href")).toBe(
    "/manage/opening-hours/department/d1",
  );
});
it("shows disabled status and forwards Enable for this department", async () => {
  const view = structuredClone(model);
  view.departments[0]!.active = false;
  await mount(view);
  expect(el.shadowRoot!.querySelector("[data-test=department-status]")!.textContent).toBe(
    "(Disabled)",
  );
  expect(el.shadowRoot!.querySelector("[data-test=setup]")!.textContent).toContain("Disabled");
  const heard: unknown[] = [];
  el.addEventListener("enable-department", (e) => heard.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-department]")!.click();
  expect(heard).toEqual([{ departmentId: "d1" }]);
});
it("takes the selected view as input and emits a tab destination", async () => {
  await mount();
  el.view = "zones";
  await el.updateComplete;
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  expect(tabs.value).toBe("zones");
  const heard: unknown[] = [];
  el.addEventListener("view-change", (e) => heard.push((e as CustomEvent).detail));
  tabs.shadowRoot!.querySelector<HTMLElement>("[data-key=settings]")!.click();
  expect(heard).toEqual([{ view: "settings" }]);
});
it("omits the Setup line when there are no issues", async () => {
  await mount();
  expect(el.shadowRoot!.querySelector("[data-test=setup]")).toBeNull();
});
it("renders no department editor for an unknown id", async () => {
  await mount();
  el.departmentId = "missing";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("h1")).toBeNull();
  expect(el.shadowRoot!.querySelector("department-settings")).toBeNull();
});

it.each(["plain", "ctrlKey", "metaKey", "shiftKey", "altKey"])(
  "an Opening hours %s click remains a browser link outside the application shell",
  async (modifier) => {
    const view = structuredClone(model);
    view.readiness = [
      { code: "department.no_periods", departmentId: "d1", departmentName: "Restaurant" },
    ];
    await mount(view);
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=setup] a")!;
    const before = location.href;
    let prevented: boolean | undefined;
    el.addEventListener(
      "click",
      (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        ...(modifier === "plain" ? {} : { [modifier]: true }),
      }),
    );
    expect(prevented).toBe(false);
    expect(location.href).toBe(before);
    expect(link.getAttribute("href")).toBe("/manage/opening-hours/department/d1");
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  },
);
