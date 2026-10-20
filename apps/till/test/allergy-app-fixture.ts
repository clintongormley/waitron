import { vi } from "vitest";
import "../src/till-app.js";
import { userEvent } from "vitest/browser";
import type { AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import { deviceZonesFixture } from "./device-zones.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import { draftServer, mountWidget, type DraftServer } from "../src/widgets/test-helpers.js";
import { TillApp } from "../src/till-app.js";
import type { TillLockScreen } from "../src/screens/till-lock-screen.js";
import type { TillFloorScreen } from "../src/screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "../src/screens/till-table-order-screen.js";
import type { TillMenuBrowser } from "../src/widgets/menu-browser.js";
import type { TillPartyAllergyDialog } from "../src/widgets/party-allergy-dialog.js";
import type { FormFactor, CapabilityFlag } from "../src/layout.js";
import type {
  TableParty,
  TableState,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "../src/api/client.js";
export const unit = {
  id: "unit-each",
  name: { es: "unit", en: "unit" },
  abbreviation: { es: "ea", en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

export function offer(id: string, name: string, courseId: string | null = null): TillMenuOffer {
  return {
    id,
    menuId: "lunch",
    productId: `product-${id}`,
    grossPrice: null,
    unitPrice: "5.00",
    available: true,
    image: null,
    description: null,
    menuName: "Lunch",
    placements: [[]],
    name,
    customerName: null,
    kitchenName: null,
    unit,
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId,
    offeredModifiers: [],
    variants: [],
  } satisfies TillMenuOffer;
}

export function catalogue(
  version: string,
  prices: Record<string, string> = {},
): ZoneOfferCatalogue {
  const offers = [
    offer("offer-beer", "Beer", "drinks"),
    offer("offer-steak", "Steak", "mains"),
    offer("offer-flan", "Flan", "desserts"),
  ].map((each) => ({ ...each, unitPrice: prices[each.name] ?? each.unitPrice }));
  return {
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    context: {
      departmentName: "Restaurant",
      zoneId: "z1",
      departmentId: "department-bar",
      serviceMode: "table_tab",
    },
    defaultMenuId: "lunch",
    menus: [
      {
        id: "lunch",
        name: "Lunch",
        isDefault: true,
        orderable: true,
        sendable: true,
        audience: "customer",
        versionId: version,
        structure: {
          members: offers.map((each) => ({
            kind: "product" as const,
            menuItemId: each.id,
            productId: each.productId,
          })),
        },
        home: {
          shortcuts: [],
          handheld: HOME_DISPLAY_DEFAULTS.handheld,
          till: HOME_DISPLAY_DEFAULTS.till,
        },
      },
    ],
    offers,
  };
}

export const courses = [
  { id: "drinks", name: "Drinks", displayOrder: 0, heldUntilFired: true },
  { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
  { id: "desserts", name: "Desserts", displayOrder: 2, heldUntilFired: true },
];

export function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v1",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

export function table(id: string, label: string, tableParty: TableParty | null): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: tableParty === null ? "free" : "open-tab",
    condition: tableParty === null ? "free" : "held",
    hasOpenTab: tableParty !== null,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: tableParty,
  };
}

export const table4 = table("t4", "4", party());
export const table7 = table(
  "t7",
  "7",
  party({ id: "v7", revision: 9, mainBillId: "wo-7", tableIds: ["t7"] }),
);

export const drillFormFactor: FormFactor = "till";

export function till(formFactor: FormFactor) {
  return {
    locale: "en",
    invoiceLocale: "es-ES",
    venueName: "Bar Pepe",
    nif: "B12345678",
    orderFlow: "prepay" as const,
    receiptPrintMode: "auto" as const,
    bumpMode: "line" as const,
    fireControl: "waiter" as const,
    courses,
    cardProvider: "none" as const,
    tipsEnabled: false,
    formFactor: formFactor,
    capabilities: ["print-receipt"] as CapabilityFlag[],
    inactivityTimeoutSeconds: null,
    nodeId: "n1",
    servers: [],
  };
}

export let server: DraftServer;
export let api: Record<string, ReturnType<typeof vi.fn>>;

export function stubApi(overrides: Record<string, unknown> = {}) {
  server.bills.add("wo-7");
  server.bills.add("wo-new");
  return {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Spanish" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "en",
      loginDefault: "en",
    }),
    getTill: vi.fn().mockResolvedValue(till(drillFormFactor)),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...catalogue("v1"),
      context: { ...catalogue("v1").context, zoneId: "zc" },
    }),
    listZoneOffers: vi.fn().mockResolvedValue(catalogue("v1")),
    menuState: vi.fn(() => new Promise(() => {})),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([table4, table7]),
    listZones: vi
      .fn()
      .mockResolvedValue([
        { id: "z1", name: "Dining room", displayOrder: 0, active: true, serviceMode: "table_tab" },
      ]),
    listStatuses: vi.fn().mockResolvedValue([]),
    getBillBalance: vi.fn(async (workingOrderId: string) => ({
      workingOrderId,
      status: "open",
      total: "3.00",
      received: "0.00",
      reserved: "0.00",
      outstanding: "3.00",
      tips: "0.00",
      payments: [],
      paidLines: [],
    })),
    getPartyBills: vi.fn().mockResolvedValue([]),
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    readCurrentOrders: vi.fn().mockResolvedValue({
      revision: 3,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      groups: [],
      ungrouped: [],
      reminder: null,
    }),
    listPrintProblems: vi.fn().mockResolvedValue({ problems: [] }),
    submitGroups: vi.fn().mockRejectedValue(new Error("the table no longer sends groups inline")),
    listDrafts: server.listDrafts,
    saveDraft: server.saveDraft,
    submitDraft: server.submitDraft,
    readPartyAllergy: vi.fn().mockImplementation(async () => allergyView("none")),
    savePartyAllergy: vi.fn().mockImplementation(async () => ({
      ...allergyView("none"),
      snapshot: { ...allergyView("none").snapshot, revision: 4 },
    })),
    previewPartyAllergy: vi
      .fn()
      .mockImplementation(async (_partyId: string, target: AllergySendTarget) =>
        allergyView(null, target),
      ),
    takeOverDraft: server.takeOverDraft,
    logout: vi.fn().mockResolvedValue(undefined),
    sendLines: vi.fn().mockResolvedValue(undefined),
    fireGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    fireHeldLine: vi.fn().mockResolvedValue({ revision: 4 }),
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

export async function mountApp(
  overrides: Record<string, unknown> = {},
  sessionActivity?: TillApp["sessionActivity"],
  theme?: "light" | "dark",
) {
  api = stubApi(overrides);
  return mountWidget<TillApp>(
    "till-app",
    {
      api: api as unknown as TillApi,
      ...(sessionActivity ? { sessionActivity } : {}),
    },
    theme,
  );
}

export async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

export function emit(source: Element, type: string, detail?: unknown): void {
  if (
    type === "change-line" &&
    typeof detail === "object" &&
    detail !== null &&
    !Object.hasOwn(detail, "expectedEdit")
  ) {
    detail = { ...detail, expectedEdit: (source as TillTableOrderScreen).billEdit };
  }
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

export const lock = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
export const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-shell")!;
export const cardGrid = (el: TillApp) => el;
export const floor = (el: TillApp) =>
  cardGrid(el)?.shadowRoot?.querySelector<TillFloorScreen>("till-floor-screen") ?? null;
export const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  cardGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  null;
export const browser = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser");
export const draft = (el: TillApp) => tableOrder(el)!.draftStore!;

export async function signIn(el: TillApp, personId = "p1", displayName = "Ana"): Promise<void> {
  server.personId = personId;
  server.personName = displayName;
  emit(lock(el), "logged-in", { personId, displayName, permissions: [] });
  await flush(el);
}

export async function openTable(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  await flush(el);
  await signIn(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el)!, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

/** Taps a dish's tile, without waiting. */
export async function addDish(el: TillApp): Promise<void> {
  const tile = [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.querySelector(".name")?.textContent === "Steak",
  )!;
  await userEvent.click(tile);
  await flush(el);
  const review = tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review && review.getBoundingClientRect().width > 0) await userEvent.click(review);
  await flush(el);
}
export const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillPartyAllergyDialog>("till-party-allergy-dialog");
export function allergyView(
  answer: null | "none" | "allergies",
  target?: AllergySendTarget,
): PartyAllergyRead {
  return {
    partyId: "v1",
    snapshot: { answer, guests: [], ticks: [], changedAt: null, changedBy: null, revision: 3 },
    dishes:
      target?.kind === "draft"
        ? target.lineIds.map((id) => ({
            line: { kind: "draft", id },
            billId: "wo-4",
            name: "Steak",
            quantity: "1.000",
            allergens: null,
            extras: [],
            sentAt: null,
            offeredBefore: false,
          }))
        : target === undefined
          ? []
          : [
              {
                line: { kind: "working", id: "held-line" },
                billId: "wo-4",
                name: "Steak",
                quantity: "1.000",
                allergens: null,
                extras: [],
                sentAt: null,
                offeredBefore: true,
              },
            ],
  };
}

export function resetAllergyFixture(): void {
  server = draftServer();
}
