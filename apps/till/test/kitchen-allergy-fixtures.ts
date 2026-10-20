import type { KitchenAllergyBlock } from "@waitron/module";
import type { ExpoOrder, KitchenNotice, StationQueueGroup } from "../src/api/client.js";
import { ALLERGEN_NAMES } from "../src/i18n/allergen-names.js";

export const allergyBlock: KitchenAllergyBlock = {
  who: "Window <guest> {allergens}",
  allergens: { milk: {} },
  note: "Separate pan <script>keep</script> \u001b@",
  clashes: { milk: {} },
  labels: {
    en: { avoids: ["Captured milk"], clashes: ["Captured dish milk"] },
    es: {
      avoids: [`${ALLERGEN_NAMES.milk.es} (snapshot)`],
      clashes: [`${ALLERGEN_NAMES.milk.es} (dish snapshot)`],
    },
  },
};
export const correctedBlock: KitchenAllergyBlock = {
  ...allergyBlock,
  who: "Other guest",
  note: "New separate tools",
  allergens: { eggs: {} },
  clashes: {},
  labels: {
    en: { avoids: ["Captured eggs"], clashes: [] },
    es: { avoids: [ALLERGEN_NAMES.eggs.es], clashes: [] },
  },
};
export const allergyTime = "2026-10-20T12:00:00.000Z";
export const allergyThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
export function allergyQueue(): StationQueueGroup {
  return {
    kitchenNote: "For the whole order",
    orderId: "bill-1",
    orderNumber: 12,
    label: "Table 4",
    status: "placed",
    queuedAt: allergyTime,
    thresholds: allergyThresholds,
    items: [
      {
        id: "ticked",
        workingOrderLineId: "line-1",
        allergy: allergyBlock,
        state: "queued",
        name: "Soup cook",
        quantity: "1.000",
        course: null,
        firedAt: allergyTime,
        note: "Dish's own note",
      },
      {
        id: "unticked",
        workingOrderLineId: "line-2",
        allergy: null,
        state: "ready",
        name: "Bread cook",
        quantity: "2.000",
        course: null,
        firedAt: allergyTime,
      },
    ],
  };
}
export function allergyOrder(): ExpoOrder {
  const group = allergyQueue();
  return {
    kitchenNote: group.kitchenNote,
    orderId: group.orderId,
    orderNumber: group.orderNumber,
    tableLabel: group.label ?? undefined,
    openedMinutes: 2,
    worstBand: "fresh",
    groups: [],
    courses: [
      {
        courseId: null,
        courseName: null,
        displayOrder: null,
        fired: true,
        away: false,
        items: group.items.map((item) => ({
          id: item.id,
          allergy: item.allergy,
          name: item.name,
          qty: item.quantity,
          stationName: "Grill",
          state: item.state,
          firedAt: item.firedAt,
          awayAt: null,
          note: item.note,
          queuedAt: allergyTime,
          thresholds: allergyThresholds,
          band: "fresh",
        })),
      },
    ],
  };
}
export function allergyNotice(kind: "changed" | "removed"): KitchenNotice {
  return {
    id: `allergy-${kind}`,
    stationId: "station-1",
    workingOrderId: "bill-1",
    orderLabel: "#12 Table 4",
    kind: `allergy_${kind}`,
    allergyBlock: kind === "changed" ? correctedBlock : null,
    lineName: "Soup cook",
    unitName: null,
    soldInEach: true,
    quantity: "1.000",
    note: "Dish's own note",
    wasStarted: false,
    movedTo: null,
    reroutedTo: null,
    direction: null,
    cancelledExtra: null,
    createdAt: allergyTime,
  };
}
