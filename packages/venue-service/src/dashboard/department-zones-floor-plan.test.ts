import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type ZoneFloorPlan } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./department-zones.js";

const placement = (x: number) => ({
  x,
  y: 0,
  width: 2,
  height: 2,
  shape: "rect" as const,
  rotation: 0,
});
const placed: ZoneFloorPlan = {
  tables: [
    { id: "t1", fixed: true, placement: placement(0) },
    { id: "t2", fixed: false, placement: placement(3) },
    { id: null, fixed: false, placement: null },
  ],
};
const unplaced: ZoneFloorPlan = {
  tables: [{ id: null, fixed: false, placement: null }],
};
const back = (zone: string) =>
  `/manage/floor-plan/zone/${zone}?back=%2Fmanage%2Fvenue-operations%2Fdepartment%2Fd1%2Fview%2Fzones%2Fzone%2F${zone}`;

let el: HTMLElementTagNameMap["department-zones"];
let reads: string[];
beforeEach(() => {
  setLocale("en");
  reads = [];
});
afterEach(() => {
  el?.remove();
  setLocale("en");
});
function planRequest(plans: (zone: string) => Promise<unknown>): DashboardRequest {
  return (async (path: string) => {
    const zone = /^\/management-api\/zones\/([^/]+)\/floor-plan$/.exec(path)?.[1];
    if (zone === undefined)
      return {
        timeZone: "Europe/Madrid",
        clockReadable: true,
        dayCutover: "06:00",
        menus: [],
        namedDays: [],
        departments: [],
      };
    reads.push(decodeURIComponent(zone));
    return plans(decodeURIComponent(zone));
  }) as DashboardRequest;
}
async function mount(zone: string, request: DashboardRequest, liveData?: LiveData) {
  el = document.createElement("department-zones");
  el.api = new VenueServiceApi(request, liveData);
  el.model = structuredClone(zonesModel);
  el.departmentId = "d1";
  el.zone = zone;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
}
const link = () => el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=zone-floor-plan]");
const linkText = () => link()?.textContent?.trim();
const preview = () => el.shadowRoot!.querySelector("wt-floor-plan-preview");
const alert = () => el.shadowRoot!.querySelector("[data-test=floor-plan-error]");

it("a zone whose plan has placed tables shows its preview above Edit floor plan", async () => {
  await mount(
    "z2",
    planRequest(async () => structuredClone(placed)),
  );
  await expect.poll(() => preview()).not.toBeNull();
  expect(preview()!.tables).toEqual([
    { key: "t1", fixed: true, placement: placement(0) },
    { key: "t2", fixed: false, placement: placement(3) },
  ]);
  expect(preview()!.label).toBe("Floor plan: Bar");
  expect(linkText()).toBe("Edit floor plan");
  expect(link()!.getAttribute("href")).toBe(back("z2"));
  expect(
    preview()!.compareDocumentPosition(link()!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(reads).toEqual(["z2"]);
});

it("keeps the preview's tables when the panel redraws for something else", async () => {
  await mount(
    "z2",
    planRequest(async () => structuredClone(placed)),
  );
  await expect.poll(() => preview()).not.toBeNull();
  const drawn = preview()!.tables;
  const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  fields.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: { value: { ...fields.value, paidWhen: "ticket_then_pay" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(fields.value.paidWhen).toBe("ticket_then_pay");
  expect(preview()!.tables).toBe(drawn);
});

it.each([
  ["only live tables offered for adoption", unplaced],
  [
    "only saved tables with no place yet",
    { tables: [{ id: "t9", fixed: false, placement: null }] },
  ],
  ["no tables at all", { tables: [] }],
])("a zone whose plan has %s shows no preview and Add a floor plan", async (_, plan) => {
  await mount(
    "z1",
    planRequest(async () => structuredClone(plan)),
  );
  await expect.poll(linkText).toBe("Add a floor plan");
  expect(preview()).toBeNull();
  expect(link()!.getAttribute("href")).toBe(back("z1"));
});

it("while the plan loads the link reads Edit floor plan and no preview shows", async () => {
  await mount(
    "z2",
    planRequest(() => new Promise(() => {})),
  );
  await expect.poll(() => reads).toEqual(["z2"]);
  expect(linkText()).toBe("Edit floor plan");
  expect(preview()).toBeNull();
  expect(alert()).toBeNull();
});

it("choosing another zone reads that zone's plan and ignores a late reply for the earlier one", async () => {
  let answerBar!: (plan: ZoneFloorPlan) => void;
  await mount(
    "z2",
    planRequest((zone) =>
      zone === "z2"
        ? new Promise((resolve) => (answerBar = resolve))
        : Promise.resolve(structuredClone(unplaced)),
    ),
  );
  await expect.poll(() => reads).toEqual(["z2"]);
  el.zone = "z1";
  await el.updateComplete;
  await expect.poll(linkText).toBe("Add a floor plan");
  expect(reads).toEqual(["z2", "z1"]);
  answerBar(structuredClone(placed));
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  expect(preview()).toBeNull();
  expect(linkText()).toBe("Add a floor plan");
});

it("a live change to the plan updates the preview", async () => {
  const live = new LiveData();
  let current: ZoneFloorPlan = structuredClone(placed);
  await mount(
    "z2",
    planRequest(async () => structuredClone(current)),
    live,
  );
  await expect.poll(() => preview()?.tables.length).toBe(2);
  current = {
    tables: [...placed.tables, { id: "t3", fixed: false, placement: placement(6) }],
  };
  live.invalidate([{ type: "floor_plan_tables" }]);
  await expect.poll(() => preview()?.tables.length).toBe(3);
  current = { tables: [] };
  live.invalidate([{ type: "dining_tables" }]);
  await expect.poll(linkText).toBe("Add a floor plan");
  expect(preview()).toBeNull();
});

it("a failed read shows one alert and keeps Edit floor plan", async () => {
  await mount(
    "z2",
    planRequest(async () => {
      throw { code: "server.unavailable" };
    }),
  );
  await expect
    .poll(() => alert()?.textContent?.trim())
    .toBe("The floor plan could not be loaded. It will be tried again.");
  expect(alert()!.getAttribute("role")).toBe("alert");
  expect(linkText()).toBe("Edit floor plan");
  expect(link()!.getAttribute("href")).toBe(back("z2"));
  expect(preview()).toBeNull();
});

it("a good read after a failed one clears the alert and shows the plan", async () => {
  const live = new LiveData();
  let failing = true;
  await mount(
    "z2",
    planRequest(async () => {
      if (failing) throw { code: "server.unavailable" };
      return structuredClone(placed);
    }),
    live,
  );
  await expect.poll(alert).not.toBeNull();
  expect(preview()).toBeNull();
  failing = false;
  live.invalidate([{ type: "floor_plans" }]);
  await expect.poll(() => preview()?.tables.map((table) => table.key)).toEqual(["t1", "t2"]);
  expect(alert()).toBeNull();
  expect(linkText()).toBe("Edit floor plan");
});

it("a disabled zone reads no plan and shows neither preview nor link", async () => {
  el = document.createElement("department-zones");
  el.model = {
    ...structuredClone(zonesModel),
    zones: zonesModel.zones.map((z) => ({ ...z, active: z.id !== "z2" })),
  };
  el.api = new VenueServiceApi(planRequest(async () => structuredClone(placed)));
  el.departmentId = "d1";
  el.zone = "z2";
  document.body.append(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  expect(reads).toEqual([]);
  expect(preview()).toBeNull();
  expect(link()).toBeNull();
});

it("stops reading the plan once the panel is removed", async () => {
  const live = new LiveData();
  await mount(
    "z2",
    planRequest(async () => structuredClone(placed)),
    live,
  );
  await expect.poll(() => preview()).not.toBeNull();
  el.remove();
  live.invalidate([{ type: "floor_plan_tables" }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(reads).toEqual(["z2"]);
});

it("words both links and the preview's name in Spanish", async () => {
  setLocale("es");
  await mount(
    "z2",
    planRequest(async (zone) => structuredClone(zone === "z2" ? placed : unplaced)),
  );
  await expect.poll(() => preview()?.label).toBe("Plano de sala: Bar");
  expect(linkText()).toBe("Editar plano de sala");
  el.zone = "z1";
  await el.updateComplete;
  await expect.poll(linkText).toBe("Añadir un plano de sala");
});
