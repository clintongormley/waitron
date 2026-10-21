import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { PartyAllergyRead } from "@waitron/module";
import type { ExpoOrder, StationQueueGroup, TillApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TillPartyAllergyDialog } from "../widgets/party-allergy-dialog.js";
import { TillStationScreen } from "./till-station-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";
import "./till-expo-screen.js";

const locale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const thresholds = { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
const party = { id: "party-1", revision: 7 };
const group = {
  id: "group-1",
  position: 1,
  displayNumber: 1,
  numberPartyId: party.id,
  state: "held" as const,
};
const stationItem = {
  allergy: null,
  id: "ticket-1",
  workingOrderLineId: "line-1",
  state: "queued" as const,
  name: "Soup",
  quantity: "1.000",
  course: { id: "course-1", name: "Starter", displayOrder: 1 },
  firedAt: null,
};
const stationGroup: StationQueueGroup = {
  kitchenNote: null,
  orderId: "bill-1",
  orderNumber: 5,
  label: "Table 4",
  queuedAt: "2026-10-20T10:00:00Z",
  status: "placed",
  thresholds,
  party,
  items: [{ ...stationItem, group }],
};
const expoItem = {
  allergy: null,
  id: "ticket-1",
  name: "Soup",
  qty: "1.000",
  stationName: "Kitchen",
  state: "queued" as const,
  firedAt: null,
  awayAt: null,
  queuedAt: "2026-10-20T10:00:00Z",
  thresholds,
  band: "fresh" as const,
};
const expoOrder: ExpoOrder = {
  kitchenNote: null,
  orderId: "bill-1",
  orderNumber: 5,
  tableLabel: "Table 4",
  openedMinutes: 2,
  worstBand: "fresh",
  party,
  courses: [],
  groups: [
    {
      groupId: group.id,
      position: 1,
      displayNumber: 1,
      numberPartyId: party.id,
      state: "held",
      fired: false,
      away: false,
      items: [expoItem],
    },
  ],
};
function view(answer: PartyAllergyRead["snapshot"]["answer"] = null): PartyAllergyRead {
  return {
    partyId: party.id,
    snapshot: { answer, guests: [], ticks: [], changedAt: null, changedBy: null, revision: 7 },
    dishes: [
      {
        line: { kind: "working", id: "line-1" },
        billId: "bill-1",
        name: "Soup",
        quantity: "1.000",
        allergens: {},
        extras: [],
        sentAt: null,
        offeredBefore: false,
      },
      {
        line: { kind: "working", id: "line-2" },
        billId: "bill-2",
        name: "Bread",
        quantity: "2.000",
        allergens: { gluten: { kinds: ["wheat"] } },
        extras: [],
        sentAt: null,
        offeredBefore: false,
      },
    ],
  };
}
function fixture(kind: "group" | "course", deviceMode = false) {
  const courseOrder = {
    ...expoOrder,
    party: undefined,
    groups: undefined,
    courses: [
      {
        courseId: "course-1",
        courseName: "Starter",
        displayOrder: 1,
        fired: false,
        away: false,
        items: [expoItem],
      },
    ],
  };
  const orders = [kind === "group" ? expoOrder : courseOrder];
  return {
    listStations: vi.fn().mockResolvedValue([
      {
        id: "station-1",
        name: "Kitchen",
        isDefault: true,
        active: true,
        open: true,
        byHand: null,
        sendsTo: null,
        why: "default",
      },
    ]),
    getStationQueue: vi.fn().mockResolvedValue({
      items: [kind === "group" ? stationGroup : { ...stationGroup, items: [stationItem] }],
      notices: [],
      printersDown: [],
    }),
    getDeviceStationScreen: vi.fn().mockResolvedValue({
      stations: [
        {
          id: "station-1",
          name: "Kitchen",
          available: true,
          today: { open: true, isDefault: true, byHand: null, sendsTo: null, why: "default" },
          queue: [kind === "group" ? stationGroup : { ...stationGroup, items: [stationItem] }],
          notices: [],
          printersDown: [],
        },
      ],
    }),
    getExpoQueue: vi.fn().mockResolvedValue(orders),
    getDevicePassScreen: vi.fn().mockResolvedValue({ orders, stations: [], zones: null }),
    getFindBill: vi.fn().mockResolvedValue({ workingOrderId: "bill-1", partyId: party.id }),
    previewPartyAllergy: vi.fn<TillApi["previewPartyAllergy"]>().mockResolvedValue(view()),
    fireGroup: vi.fn<TillApi["fireGroup"]>().mockResolvedValue({ revision: 8 }),
    fireCourse: vi.fn<TillApi["fireCourse"]>().mockResolvedValue(undefined),
    fireDeviceGroup: vi.fn<TillApi["fireDeviceGroup"]>().mockResolvedValue({ revision: 8 }),
    fireDeviceCourse: vi.fn<TillApi["fireDeviceCourse"]>().mockResolvedValue(undefined),
    deviceMode,
  };
}
type Screen = TillStationScreen | TillExpoScreen;
async function mount(
  screen: "station" | "expo",
  kind: "group" | "course",
  api = fixture(kind),
  theme: "light" | "dark" = "light",
) {
  const { el } = await mountWidget<Screen>(
    `till-${screen}-screen`,
    {
      api: api as unknown as TillApi,
      embedded: true,
      runsPass: true,
      ...{ fireControl: screen === "station" ? "kitchen" : "expo" },
      deviceMode: api.deviceMode,
    },
    theme,
  );
  await vi.waitFor(() =>
    expect(
      screen === "station"
        ? el.shadowRoot!.querySelector("till-station-queue")
        : el.shadowRoot!.querySelector('[data-item="ticket-1"]'),
    ).not.toBeNull(),
  );
  return { el, api };
}
async function fire(el: Screen, kind: "group" | "course") {
  if (el instanceof TillStationScreen)
    el.shadowRoot!.querySelector("till-station-queue")!.dispatchEvent(
      new CustomEvent(kind === "group" ? "fire-kitchen-group" : "fire-course", {
        detail:
          kind === "group"
            ? { partyId: party.id, groupId: group.id, expectedPartyRevision: 7 }
            : { orderId: "bill-1", courseId: "course-1" },
        bubbles: true,
        composed: true,
      }),
    );
  else {
    expect(el.shadowRoot!.querySelector(".lever")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-fire], [data-group-fire]")).toBeNull();
    el.shadowRoot!.querySelector("[data-item]")!.dispatchEvent(
      new CustomEvent(kind === "group" ? "fire-kitchen-group" : "fire-course", {
        detail:
          kind === "group"
            ? { partyId: party.id, groupId: group.id, expectedPartyRevision: 7 }
            : { orderId: "bill-1", courseId: "course-1" },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
const dialog = (el: Screen) =>
  el.shadowRoot!.querySelector<TillPartyAllergyDialog>("till-party-allergy-dialog");
async function settle(el: Screen) {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await el.updateComplete;
}

describe("A773 waiter authority — station allergy boundary", () => {
  for (const deviceMode of [false, true])
    for (const kind of ["group", "course"] as const)
      it.each([null, "none", "allergies"] as const)(
        `station ${kind} never previews or sends an answer %s (device ${deviceMode})`,
        async (answer) => {
          const api = fixture(kind, deviceMode);
          api.previewPartyAllergy.mockResolvedValue(view(answer));
          const { el } = await mount("station", kind, api);
          const reads = deviceMode ? api.getDeviceStationScreen : api.getStationQueue;
          const count = reads.mock.calls.length;
          for (let press = 0; press < 2; press++) {
            await fire(el, kind);
            await settle(el);
          }
          el.dispatchEvent(
            new CustomEvent("allergy-confirm", {
              detail: {
                scopeKey: "old-scope",
                expectedPartyRevision: 7,
                patch: { party: { answer: "none", guests: [] }, ticks: [] },
              },
              bubbles: true,
              composed: true,
            }),
          );
          await settle(el);
          expect(api.getFindBill).not.toHaveBeenCalled();
          expect(api.previewPartyAllergy).not.toHaveBeenCalled();
          expect(api.fireGroup).not.toHaveBeenCalled();
          expect(api.fireCourse).not.toHaveBeenCalled();
          expect(api.fireDeviceGroup).not.toHaveBeenCalled();
          expect(api.fireDeviceCourse).not.toHaveBeenCalled();
          expect(reads).toHaveBeenCalledTimes(count);
          expect(dialog(el)).toBeNull();
          expect(el.shadowRoot!.querySelector('[role="alert"], [data-table-changed]')).toBeNull();
        },
      );
});

describe("station allergy boundary after changing stations", () => {
  it("changing stations after an obsolete Fire opens no allergy preview", async () => {
    const api = fixture("group");
    const stations = await api.listStations();
    api.listStations.mockResolvedValue([
      ...stations,
      { ...stations[0]!, id: "station-2", name: "Bar", isDefault: false },
    ]);
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await settle(el);
    expect(api.previewPartyAllergy).not.toHaveBeenCalled();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-station="station-2"]')!);
    await settle(el);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-station="station-1"]')!);
    await settle(el);
    expect(api.previewPartyAllergy).not.toHaveBeenCalled();
    expect(api.fireGroup).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });
});

describe("A773 waiter authority — expo allergy boundary", () => {
  for (const deviceMode of [false, true])
    for (const kind of ["group", "course"] as const)
      for (const fireControl of ["waiter", "kitchen", "expo"] as const)
        it.each([null, "none", "allergies"] as const)(
          `expo ${kind} never previews or sends answer %s (device ${deviceMode}, legacy ${fireControl})`,
          async (answer) => {
            const api = fixture(kind, deviceMode);
            const read = view(answer);
            read.snapshot.guests = [
              { id: "guest-1", position: 0, who: "Alex", allergens: { milk: {} }, note: null },
            ];
            read.dishes[0]!.extras = [
              { name: "Cream", quantity: "1.000", allergens: { milk: {} } },
            ];
            api.previewPartyAllergy.mockResolvedValue(read);
            const { el } = await mount("expo", kind, api);
            Object.assign(el, { fireControl });
            await el.updateComplete;
            const reads = deviceMode ? api.getDevicePassScreen : api.getExpoQueue;
            const count = reads.mock.calls.length;
            for (let press = 0; press < 2; press++) {
              await fire(el, kind);
              await settle(el);
            }
            el.dispatchEvent(
              new CustomEvent("allergy-confirm", {
                detail: {
                  scopeKey: "old-scope",
                  expectedPartyRevision: 7,
                  patch: {
                    party: { answer: "none", guests: [] },
                    ticks: [{ line: { kind: "working", id: "line-2" }, guestIndex: 0 }],
                  },
                },
                bubbles: true,
                composed: true,
              }),
            );
            await settle(el);
            expect(api.getFindBill).not.toHaveBeenCalled();
            expect(api.previewPartyAllergy).not.toHaveBeenCalled();
            expect(api.fireGroup).not.toHaveBeenCalled();
            expect(api.fireCourse).not.toHaveBeenCalled();
            expect(api.fireDeviceGroup).not.toHaveBeenCalled();
            expect(api.fireDeviceCourse).not.toHaveBeenCalled();
            expect(reads).toHaveBeenCalledTimes(count);
            expect(dialog(el)).toBeNull();
            expect(el.shadowRoot!.querySelector('[role="alert"], [data-table-changed]')).toBeNull();
            expect(el.shadowRoot!.querySelector('[data-item="ticket-1"]')).not.toBeNull();
          },
        );

  for (const kind of ["group", "course"] as const)
    it.each(["operator", "api", "reopen", "board"] as const)(
      `${kind} cannot reopen allergy consideration after a %s change`,
      async (change) => {
        const { el, api } = await mount("expo", kind);
        await fire(el, kind);
        if (change === "operator") el.operatorSession++;
        else if (change === "api") el.api = fixture(kind) as unknown as TillApi;
        else if (change === "reopen") {
          const parent = el.parentElement!;
          el.remove();
          parent.append(el);
        } else {
          el.embedded = false;
          await el.updateComplete;
          el.embedded = true;
        }
        await settle(el);
        await fire(el, kind);
        await settle(el);
        expect(api.getFindBill).not.toHaveBeenCalled();
        expect(api.previewPartyAllergy).not.toHaveBeenCalled();
        expect(api.fireGroup).not.toHaveBeenCalled();
        expect(api.fireCourse).not.toHaveBeenCalled();
        expect(dialog(el)).toBeNull();
      },
    );

  for (const language of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`renders waiter-only initiation ${language} ${theme} ${width}`, async () => {
          setLocale(language);
          await page.viewport(width, 900);
          try {
            const { el, api } = await mount("expo", "group", fixture("group"), theme);
            el.parentElement!.style.width = `${width}px`;
            el.style.width = "100%";
            await document.fonts.ready;
            await settle(el);
            expect(window.innerWidth).toBe(width);
            expect(Math.round(el.getBoundingClientRect().width)).toBe(width);
            const dish = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ticket-1"]')!;
            expect(dish.classList.contains("held")).toBe(true);
            expect(el.shadowRoot!.querySelector("[data-group-held]")!.textContent).toContain(
              t("station.group_held"),
            );
            expect(dish.getBoundingClientRect().right).toBeLessThanOrEqual(width + 1);
            expect(el.shadowRoot!.querySelector(".lever, till-party-allergy-dialog")).toBeNull();
            expect(api.previewPartyAllergy).not.toHaveBeenCalled();
            await expectNoA11yViolations(el.parentElement!);
            await page.screenshot({
              path: `../../__screenshots__/a773-waiter-authority/expo-${language}-${theme}-${width}.png`,
            });
          } finally {
            await page.viewport(1280, 900);
          }
        });
});
