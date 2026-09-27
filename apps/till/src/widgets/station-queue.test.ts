import { afterEach, describe, expect, it, vi } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { allergenName } from "../i18n/allergen-names.js";
import { TillStationQueue } from "./station-queue.js";
import type { KitchenNotice, StationQueueGroup } from "../api/client.js";

// The shipped DB defaults.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

// One item in each of the three kitchen states, so the kanban columns and the rail cards can be
// asserted from a single mount.
const groupA: StationQueueGroup = {
  orderId: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: DEFAULT_THRESHOLDS,
  items: [
    {
      id: "ti-1",
      workingOrderLineId: "wol-1",
      state: "queued",
      name: "Paella",
      quantity: "2.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      id: "ti-2",
      workingOrderLineId: "wol-2",
      state: "preparing",
      name: "Agua",
      quantity: "1.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

const groupB: StationQueueGroup = {
  orderId: "wo-2",
  orderNumber: 6,
  label: null,
  queuedAt: "2026-08-17T10:05:00.000Z",
  status: "settled",
  thresholds: DEFAULT_THRESHOLDS,
  items: [
    {
      id: "ti-3",
      workingOrderLineId: "wol-3",
      state: "ready",
      name: "Café",
      quantity: "3.000",
      course: null,
      firedAt: "2026-08-17T10:05:00.000Z",
    },
  ],
};

const groups = [groupA, groupB];

afterEach(cleanupWidgets);

describe("till-station-queue", () => {
  it("keeps dish and modifier receipt snapshots visible with an unrelated content default", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
    try {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          {
            ...groupA,
            items: [
              { ...groupA.items[0]!, modifiers: [{ descriptions: { "es-ES": "Mantequilla" } }] },
            ],
          },
        ],
        stationId: "st-1",
      });
      expect(el.shadowRoot!.textContent).toContain("2× Paella");
      expect(el.shadowRoot!.textContent).toContain("Mantequilla");
    } finally {
      setLocale(previousLocale);
    }
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-station-queue")).toBe(TillStationQueue);
  });

  it("shows the empty placeholder and no tickets when the station queue is empty", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", { groups: [] });
    expect(el.shadowRoot!.textContent).toContain(t("station.empty"));
    expect(el.shadowRoot!.querySelectorAll("[data-item]")).toHaveLength(0);
  });

  it("kanban is the default view: three state columns, each holding its state's lines", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(
      el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-1"]'),
    ).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector('[data-column="preparing"] [data-item="ti-2"]'),
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-column="ready"] [data-item="ti-3"]')).not.toBeNull();
    const queuedCol = el.shadowRoot!.querySelector('[data-column="queued"]')!;
    expect(queuedCol.textContent).toContain(t("station.state.queued"));
  });

  it("rail view renders one ticket card per order with its number and label", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets).toHaveLength(2);
    expect(tickets[0]!.textContent).toContain("5");
    expect(tickets[0]!.textContent).toContain("Mesa 4");
    expect(tickets[0]!.querySelector('[data-item="ti-1"]')).not.toBeNull();
    expect(tickets[0]!.querySelector('[data-item="ti-2"]')).not.toBeNull();
  });

  it("rail: each line shows its quantity × dish name (the cook's line), not a bare line number", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-1"]')!.textContent).toContain("2× Paella");
    expect(el.shadowRoot!.querySelector('[data-item="ti-2"]')!.textContent).toContain("1× Agua");
  });

  it("renders a fractional line with its snapshotted unit", async () => {
    const fractional: StationQueueGroup = {
      ...groupA,
      items: [
        {
          ...groupA.items[0]!,
          quantity: "0.375",
          unitName: { "es-ES": "kg" },
          unitPrecision: 3,
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [fractional],
      view: "rail",
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-1"]')!.textContent).toContain(
      "0.375 kg× Paella",
    );
  });

  it("kanban: each cell shows its quantity × dish name alongside the order number", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-1"]')!;
    expect(cell.textContent).toContain("2× Paella");
    expect(cell.textContent).toContain("5");
  });

  it("renders the dish name verbatim, with no locale resolution left to fall back from", async () => {
    const group: StationQueueGroup = {
      orderId: "wo-9",
      orderNumber: 9,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      status: "settled",
      thresholds: DEFAULT_THRESHOLDS,
      items: [
        {
          id: "ti-x",
          workingOrderLineId: "wol-x",
          state: "queued",
          // `name` is the server-resolved kitchen label (a plain string, not a locale map) — the
          // widget renders it as sent.
          name: "Fish",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [group],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-x"]')!.textContent).toContain("1× Fish");
  });

  describe("ordering modifiers (Task 14): selected options as indented sub-text under the dish", () => {
    const withModifiers: StationQueueGroup = {
      orderId: "wo-9",
      orderNumber: 9,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-9",
          workingOrderLineId: "wol-9",
          state: "queued",
          name: "Cortado",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          modifiers: [
            { descriptions: { "es-ES": "Grande" } },
            { descriptions: { "es-ES": "Leche avena" } },
          ],
        },
      ],
    };

    it("rail: renders the dish then its two options as indented '+ name' sub-text", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withModifiers],
        view: "rail",
        stationId: "st-9",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-9"]')!;
      expect(item.textContent).toContain("1× Cortado");
      expect(item.textContent).toContain("+ Grande");
      expect(item.textContent).toContain("+ Leche avena");
      const html = item.innerHTML;
      expect(html.indexOf("Cortado")).toBeLessThan(html.indexOf("Grande"));
      expect(html.indexOf("Grande")).toBeLessThan(html.indexOf("Leche avena"));
    });

    it("kanban: renders the same indented options beneath the cell's dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withModifiers],
        stationId: "st-9",
      });
      const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-9"]')!;
      expect(cell.textContent).toContain("1× Cortado");
      expect(cell.textContent).toContain("+ Grande");
      expect(cell.textContent).toContain("+ Leche avena");
    });

    it("a modifier-free item renders flat, with no modifiers sub-text at all (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item here carries `modifiers`
        view: "rail",
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-modifiers")).toHaveLength(0);
    });

    it("shows each extra's own allergens and diet on the line, distinct from the dish's own", async () => {
      const withExtraNutrition: StationQueueGroup = {
        ...withModifiers,
        items: [
          {
            ...withModifiers.items[0]!,
            // The DISH declares its own gluten; the EXTRA declares its own milk + halal.
            asServed: { allergens: { gluten: { presence: "contains" } }, pending: false },
            modifiers: [
              {
                descriptions: { "es-ES": "Bacon" },
                addAllergens: { milk: { presence: "contains" } },
                suitableFor: ["halal"],
              },
            ],
          },
        ],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withExtraNutrition],
        view: "rail",
        stationId: "st-9",
      });
      const milkName = allergenName("milk", currentLocale());
      const optAllergens = el.shadowRoot!.querySelector(
        '[data-test="item-modifier-allergens-ti-9-0"]',
      );
      expect(optAllergens).not.toBeNull();
      expect(optAllergens!.textContent).toContain(milkName);
      const optDiet = el.shadowRoot!.querySelector('[data-test="item-modifier-diet-ti-9-0"]');
      expect(optDiet).not.toBeNull();
      expect(optDiet!.querySelector("[data-diet='halal']")).not.toBeNull();
      // The dish's OWN allergen row shows its gluten, a node distinct from the extra's milk (no fold).
      const dishAllergens = el.shadowRoot!.querySelector('[data-item-allergens="ti-9"]');
      expect(dishAllergens!.textContent).toMatch(/gluten/i);
      expect(dishAllergens!.textContent).not.toContain(milkName);
    });
  });

  describe("per-line customisation (Task 5): the snapshotted note as sub-text under the dish", () => {
    const withCustomisation: StationQueueGroup = {
      orderId: "wo-c",
      orderNumber: 12,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-c",
          workingOrderLineId: "wol-c",
          state: "queued",
          name: "Chuletón",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          note: "sin sal",
        },
      ],
    };

    it("rail: renders the note as sub-text beneath the dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withCustomisation],
        view: "rail",
        stationId: "st-c",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-c"]')!;
      expect(item.textContent).toContain("1× Chuletón");
      expect(item.querySelector("[data-note]")!.textContent).toContain("sin sal");
    });

    it("kanban: renders the same note beneath the cell's dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withCustomisation],
        stationId: "st-c",
      });
      const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-c"]')!;
      expect(cell.querySelector("[data-note]")!.textContent).toContain("sin sal");
    });

    it("an EMPTY note renders no customisation row (an empty string is not a note)", async () => {
      const emptyNote: StationQueueGroup = {
        ...withCustomisation,
        items: [{ ...withCustomisation.items[0]!, note: "" }],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [emptyNote],
        view: "rail",
        stationId: "st-c",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-c"]')!;
      expect(item.querySelector("[data-note]")).toBeNull();
      expect(item.querySelector(".line-customisation")).toBeNull();
    });

    it("a null note renders no customisation row", async () => {
      const noNote: StationQueueGroup = {
        ...withCustomisation,
        items: [{ ...withCustomisation.items[0]!, note: null }],
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [noNote],
        view: "rail",
        stationId: "st-c",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-c"]')!;
      expect(item.querySelector(".line-customisation")).toBeNull();
    });

    it("a plain item (no note) renders no customisation row at all (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item carries a note
        view: "rail",
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-customisation")).toHaveLength(0);
    });
  });

  describe("as-served allergens: the dish's own contains chips + not-reviewed note", () => {
    const withAllergens: StationQueueGroup = {
      orderId: "wo-a",
      orderNumber: 11,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-a",
          workingOrderLineId: "wol-a",
          state: "queued",
          name: "Hamburguesa",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
        },
      ],
    };

    const pendingItem: StationQueueGroup = {
      orderId: "wo-p",
      orderNumber: 12,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-p",
          workingOrderLineId: "wol-p",
          state: "queued",
          name: "Especial",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          asServed: { allergens: {}, pending: true },
        },
      ],
    };

    it("rail: shows the dish's own localised 'Milk' contains chip", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withAllergens],
        view: "rail",
        stationId: "st-a",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-a"]')!;
      expect(item.textContent).toMatch(/milk/i);
    });

    it("kanban: shows the dish's own contains chip beneath the cell's dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withAllergens],
        stationId: "st-a",
      });
      const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-a"]')!;
      expect(cell.textContent).toMatch(/milk/i);
    });

    it("shows a not-reviewed warning when the dish's own allergens are pending", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [pendingItem],
        view: "rail",
        stationId: "st-p",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-p"]')!;
      expect(item.textContent).toContain(t("allergens.not_reviewed"));
    });

    it("a plain item with no as-served profile renders no allergen row (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item carries asServed
        view: "rail",
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-allergens")).toHaveLength(0);
    });
  });

  describe("as-served diet badges", () => {
    const veganItem: StationQueueGroup = {
      orderId: "wo-v",
      orderNumber: 21,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-v",
          workingOrderLineId: "wol-v",
          state: "queued",
          name: "Ensalada",
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [] },
        },
      ],
    };

    const meatItem: StationQueueGroup = {
      ...veganItem,
      items: [
        {
          ...veganItem.items[0]!,
          id: "ti-m",
          asServedDiet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
        },
      ],
    };

    const pendingDiet: StationQueueGroup = {
      ...veganItem,
      items: [
        {
          ...veganItem.items[0]!,
          id: "ti-pd",
          asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
        },
      ],
    };

    it("shows vegan + vegetarian badges for a plant-only plate", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [veganItem],
        view: "rail",
        stationId: "st-v",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-v"]')!;
      expect(item.querySelector("[data-diet='vegan']")).not.toBeNull();
      expect(item.querySelector("[data-diet='vegetarian']")).not.toBeNull();
      expect(item.textContent).not.toMatch(/review|revisi/i);
    });

    it("shows a contains-meat chip and no positive badge for a meat plate", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [meatItem],
        view: "rail",
        stationId: "st-m",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-m"]')!;
      expect(item.querySelector("[data-diet-contains='meat']")).not.toBeNull();
      expect(item.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("shows the NEUTRAL 'not reviewed' state for a pending diet, never a positive claim", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [pendingDiet],
        view: "rail",
        stationId: "st-pd",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-pd"]')!;
      expect(item.querySelector("[data-diet-pending]")).not.toBeNull();
      expect(item.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("renders no diet row for an item carrying no asServedDiet (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // no item carries asServedDiet
        view: "rail",
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-diet")).toHaveLength(0);
    });
  });

  it("line mode: tapping a queued line emits advance-ticket-item { itemId, to: 'preparing' }", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "ti-1", to: "preparing" });
  });

  it("line mode: tapping a preparing line emits advance-ticket-item { itemId, to: 'ready' }", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "ti-2", to: "ready" });
  });

  it("a ready line renders no bump control (its kitchen state is terminal)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-3"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('button[data-item="ti-3"]')).toBeNull();
  });

  it("ticket mode: tapping a line emits advance-ticket { orderId, stationId, to } (whole-ticket)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      bumpMode: "ticket",
    });
    const item = vi.fn();
    const ticket = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
    el.addEventListener("advance-ticket", (e) => ticket((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(item).not.toHaveBeenCalled();
    expect(ticket).toHaveBeenCalledWith({ orderId: "wo-1", stationId: "st-1", to: "preparing" });
  });

  it("ticket mode without a stationId cannot fire a whole-ticket bump (the route is station-keyed)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      bumpMode: "ticket", // no stationId
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("the advance events are composed and bubble", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("advance-ticket-item", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("rail: a SETTLED (collectable) order shows a per-order collect button; a placed one does not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    // groupB (wo-2) is settled → the Mode-P handover is offered; groupA (wo-1) is placed → not.
    const collectB = el.shadowRoot!.querySelector<HTMLElement>('[data-collect="wo-2"]');
    expect(collectB).not.toBeNull();
    expect(collectB!.textContent).toContain(t("station.collect"));
    expect(el.shadowRoot!.querySelector('[data-collect="wo-1"]')).toBeNull();
  });

  it("rail: tapping the collect button emits mark-collected { orderId }, composed and bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("mark-collected", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-collect="wo-2"]')!.click();
    expect(captured!.detail).toEqual({ orderId: "wo-2" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("kanban: no per-order collect button (the handover is a rail-card, counter-side action)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // groupB is settled, but kanban cells cut across orders — no per-order card to host it
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("advanceOnly: suppresses the collect button on a settled order (device mode has no collect route, §3d)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // groupB (wo-2) is settled → normally collectable
      view: "rail",
      stationId: "st-1",
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("rail: showReprint renders a per-order reprint button on every card; off by default", async () => {
    const off = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    expect(off.el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();

    // Both a placed and a settled order get it: reprint is status-independent, unlike collect.
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
      showReprint: true,
    });
    const one = el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]');
    expect(one).not.toBeNull();
    expect(one!.textContent).toContain(t("station.reprint"));
    expect(el.shadowRoot!.querySelector('[data-reprint="wo-2"]')).not.toBeNull();
  });

  it("kanban: no per-order reprint button even with showReprint (it is a rail-card action)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // kanban cells cut across orders — no per-order card to host a reprint
      stationId: "st-1",
      showReprint: true,
    });
    expect(el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });

  it("rail: tapping the reprint button emits reprint-order { orderId }, composed and bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
      showReprint: true,
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("reprint-order", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    expect(captured!.detail).toEqual({ orderId: "wo-1" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("age-colours each ticket by how long its oldest line has waited (fresh / warm / overdue)", async () => {
    // `now` is injected so the bands are deterministic. groupA queued at 10:00Z, groupB at 10:05Z.
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue, B: 7 min → warm
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets[0]!.classList.contains("age-overdue")).toBe(true);
    expect(tickets[1]!.classList.contains("age-warm")).toBe(true);
  });

  it("age-colours a just-queued ticket as fresh", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // A: 1 min → fresh
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".ticket")!.classList.contains("age-fresh")).toBe(true);
  });

  it("a line 16 minutes old escalates to forgotten (past the default 15-minute threshold)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".ticket")!.classList.contains("age-forgotten")).toBe(true);
  });

  it("kanban: the age accent is also applied to each cell (today only the rail ticket carried it)", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now, // default view: kanban
    });
    const cell = el.shadowRoot!.querySelector('[data-item="ti-1"]')!.closest(".cell")!;
    expect(cell.classList.contains("age-overdue")).toBe(true);
  });

  it("the header shows a legible overdue+forgotten count badge — a non-colour tell, not just borders", async () => {
    // groupA is 12 min old (overdue), groupB is 7 min old (warm) — one group has escalated.
    const now = Date.parse("2026-08-17T10:12:00.000Z");
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    const badge = el.shadowRoot!.querySelector(".overdue-count")!;
    expect(badge.textContent).toContain("1");
    expect(badge.textContent).toContain(t("station.overdue_count"));
  });

  it("the header shows no badge at all when nothing has escalated to overdue", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // both groups fresh/near-fresh
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".overdue-count")).toBeNull();
  });

  it("the header counts BOTH overdue and forgotten groups (band rank ≥ overdue)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten, B: 11 min → overdue
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".overdue-count")!.textContent).toContain("2");
  });

  it("forgotten flashes by default (motion allowed) — the flash class rides alongside the steady accent", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
      reducedMotion: false,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    expect(ticket.classList.contains("age-forgotten")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(true);
  });

  it("reduced motion: a forgotten ticket renders the steady-red class with NO flash/animation class", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
      reducedMotion: true,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    // Still the steady red accent — just never the class the flashing @keyframes is scoped to.
    expect(ticket.classList.contains("age-forgotten")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(false);
  });

  it("reduced motion never applies flash to a merely-overdue (non-forgotten) ticket either", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue, not forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
      reducedMotion: false,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    expect(ticket.classList.contains("age-overdue")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(false);
  });
});

// The fixture is one order with three courses listed OUT of display order — a held later course first,
// then a fired middle course, then the fired null (bread) course — so a passing grouping test proves the
// widget re-orders (null, then by display_order) rather than echoing the item order.
const coursedOrder: StationQueueGroup = {
  orderId: "wo-c",
  orderNumber: 7,
  label: "Mesa 2",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: DEFAULT_THRESHOLDS,
  items: [
    {
      id: "it-main",
      workingOrderLineId: "wl-main",
      state: "queued",
      name: "Solomillo",
      quantity: "1.000",
      // Principales — HELD (fired_at null), display_order 2: must render LAST despite being listed first.
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      firedAt: null,
    },
    {
      id: "it-start",
      workingOrderLineId: "wl-start",
      state: "preparing",
      name: "Ensalada",
      quantity: "1.000",
      // Entrantes — FIRED, display_order 1: renders after the null course, before Principales.
      course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
      firedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      id: "it-bread",
      workingOrderLineId: "wl-bread",
      state: "queued",
      name: "Pan",
      quantity: "1.000",
      // The null course must render FIRST, and carries no header.
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

describe("till-station-queue — KDS-2 courses & fire", () => {
  it("rail: groups a card's lines by course, header per named course, ordered null-course-first then by displayOrder", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const sections = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-course]")];
    expect(sections.map((s) => s.dataset.course)).toEqual(["none", "co-start", "co-main"]);
    expect(sections[0]!.querySelector(".course-head")).toBeNull();
    expect(sections[0]!.querySelector('[data-item="it-bread"]')).not.toBeNull();
    expect(sections[1]!.querySelector(".course-head")!.textContent).toContain("Entrantes");
    expect(sections[2]!.querySelector(".course-head")!.textContent).toContain("Principales");
  });

  it("rail: a HELD course's line renders greyed (held) and non-advanceable — a span, never a bump button", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const held = el.shadowRoot!.querySelector('[data-item="it-main"]')!;
    expect(held.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-main"]')).toBeNull();
    expect(held.tagName).toBe("SPAN");
  });

  it("rail: a held line does not emit an advance when clicked (it is not a bump target)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", spy);
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="it-main"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rail: a FIRED course's line stays advanceable (KDS-1 behaviour is unchanged for fired items)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('button[data-item="it-start"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "it-start", to: "ready" });
  });

  it("kitchen fire: a held course shows the Empezar curso button; clicking it emits fire-course, composed + bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
    });
    const fire = el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-main"]')!;
    expect(fire).not.toBeNull();
    expect(fire.textContent).toContain(t("station.fire_course"));
    let captured: CustomEvent | undefined;
    el.addEventListener("fire-course", (e) => (captured = e as CustomEvent));
    fire.click();
    expect(captured!.detail).toEqual({ orderId: "wo-c", courseId: "co-main" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("kitchen fire: a FIRED course and the null course show no fire button (nothing to release)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
    });
    expect(el.shadowRoot!.querySelectorAll("[data-fire]")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector('[data-fire="co-start"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-fire="none"]')).toBeNull();
  });

  it("waiter fire: the display shows no fire button even for a held course (the tab screen fires — Task 7)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "waiter", // the default; the held course is still greyed, just not fireable here
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-item="it-main"]')!.classList.contains("held")).toBe(
      true,
    );
  });

  it("kanban: a held line renders greyed and non-advanceable in its state column too", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1", // default kanban view
    });
    const held = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="it-main"]')!;
    expect(held.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-main"]')).toBeNull();
  });

  it("kanban: no fire button (the fire is a per-order rail-card action, like the collect handover)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      fireControl: "kitchen", // even in kitchen mode, kanban has no per-order card to host the action
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
  });

  it("advanceOnly: suppresses the kitchen-fire button on a held course (device mode has no fire route, §3d)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder], // Principales (co-main) is held → normally fireable under kitchen
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    // The held line is still greyed + non-advanceable — advanceOnly hides the FIRE button, not the greying.
    expect(el.shadowRoot!.querySelector('[data-item="it-main"]')!.classList.contains("held")).toBe(
      true,
    );
  });
});

it("shows saved nonprice modifier answers in the kitchen without HTML interpretation", async () => {
  const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
    groups: [
      {
        ...groupA,
        items: [
          {
            ...groupA.items[0]!,
            optionSnapshots: [
              {
                listName: { es: "Dedicatoria" },
                listCustomerName: null,
                listKitchenName: null,
                labelName: { es: "<b>Happy day</b>" },
                labelCustomerName: null,
                labelKitchenName: null,
              },
            ],
          },
        ],
      },
    ],
    stationId: "st-1",
  });
  expect(el.shadowRoot!.querySelector(".modifier-answer")!.textContent).toBe(
    "Dedicatoria: <b>Happy day</b>",
  );
  expect(el.shadowRoot!.querySelector(".modifier-answer b")).toBeNull();
});

it("shows a dish's frozen options answers in the KITCHEN's wording", async () => {
  // Three different texts per name, so the assertion fails if the rail reads the staff or the
  // customer side by mistake (CLAUDE.md §3).
  const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
    groups: [
      {
        ...groupA,
        items: [
          {
            ...groupA.items[0]!,
            optionSnapshots: [
              {
                listName: { es: "Punto personal" },
                listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
                listKitchenName: "PTO",
                labelName: { es: "Poco personal" },
                labelCustomerName: { "es-ES": "Poco hecho" },
                labelKitchenName: "PH",
              },
            ],
          },
        ],
      },
    ],
    stationId: "st-1",
  });
  expect(el.shadowRoot!.querySelector(".modifier-answer")!.textContent).toBe("PTO: PH");
});

describe("till-station-queue — kitchen notices strip", () => {
  const notice = (overrides: Partial<KitchenNotice>): KitchenNotice => ({
    id: "kn-1",
    stationId: "st-1",
    workingOrderId: "wo-1",
    orderLabel: "#5 · Mesa 4",
    kind: "void",
    lineName: "Burger",
    unitName: null,
    quantity: "1.000",
    note: null,
    wasStarted: false,
    movedTo: null,
    createdAt: "2026-08-17T10:10:00.000Z",
    ...overrides,
  });

  const fourKinds: KitchenNotice[] = [
    notice({ id: "kn-void", kind: "void", wasStarted: true }),
    notice({ id: "kn-recalled", kind: "recalled", lineName: "Paella", quantity: "2.000" }),
    notice({ id: "kn-changed", kind: "changed", note: "no onions" }),
    notice({ id: "kn-moved", kind: "moved", movedTo: "Mesa 9", orderLabel: "#7" }),
  ];

  const rows = (el: TillStationQueue) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-notice]"),
  ];

  it("renders the notices ABOVE the queue items, in the order the server sent them", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    expect(rows(el).map((row) => row.dataset.notice)).toEqual([
      "kn-void",
      "kn-recalled",
      "kn-changed",
      "kn-moved",
    ]);
    const strip = el.shadowRoot!.querySelector(".notices")!;
    const firstItem = el.shadowRoot!.querySelector("[data-item]")!;
    expect(
      strip.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names each kind in TEXT and with its own icon, never by colour alone", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const kinds = rows(el).map((row) => row.querySelector(".notice-kind")!.textContent!.trim());
    expect(kinds).toEqual([
      t("station.notice.void"),
      t("station.notice.recalled"),
      t("station.notice.changed"),
      t("station.notice.moved"),
    ]);
    const icons = rows(el).map((row) => row.querySelector("wt-icon")!);
    expect(icons.map((icon) => icon.getAttribute("name"))).toEqual([
      "notice-void",
      "notice-recalled",
      "notice-changed",
      "notice-moved",
    ]);
    // An unregistered icon name renders nothing, so each must actually draw a path, and a distinct one.
    await Promise.all(
      icons.map(
        (icon) => (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete,
      ),
    );
    const paths = icons.map((icon) => icon.shadowRoot!.querySelector("path")?.getAttribute("d"));
    expect(paths.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
    expect(new Set(paths).size).toBe(4);
  });

  it("shows the line, its quantity formatted like the queue's, and the order label", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [
        notice({ quantity: "1.000" }),
        notice({ id: "kn-2", quantity: "0.250", lineName: "Jamón" }),
      ],
    });
    const [first, second] = rows(el);
    expect(first!.querySelector(".notice-line")!.textContent!.trim()).toBe("1× Burger");
    expect(first!.querySelector(".notice-order")!.textContent!.trim()).toBe("#5 · Mesa 4");
    expect(second!.querySelector(".notice-line")!.textContent!.trim()).toBe("0.25× Jamón");
  });

  it("shows the line's unit as the queue row does, and none when the line recorded none", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [
        notice({ quantity: "0.500", lineName: "Pulpo", unitName: { "es-ES": "kg" } }),
        notice({
          id: "kn-2",
          quantity: "2.000",
          lineName: "Croqueta",
          unitName: { "es-ES": "ud" },
        }),
        notice({ id: "kn-3", quantity: "2.000", lineName: "Gilda", unitName: null }),
      ],
    });
    const [weighed, counted, noUnit] = rows(el);
    expect(weighed!.querySelector(".notice-line")!.textContent!.trim()).toBe("0.5 kg× Pulpo");
    expect(counted!.querySelector(".notice-line")!.textContent!.trim()).toBe("2 ud× Croqueta");
    expect(noUnit!.querySelector(".notice-line")!.textContent!.trim()).toBe("2× Gilda");
  });

  it("marks a started void as started, and says nothing of it on one that was not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [notice({ wasStarted: true }), notice({ id: "kn-2", wasStarted: false })],
    });
    const [started, notStarted] = rows(el);
    expect(started!.querySelector(".notice-started")!.textContent!.trim()).toBe(
      t("station.notice.started"),
    );
    expect(notStarted!.querySelector(".notice-started")).toBeNull();
  });

  it("shows a changed notice's new note, and the table a moved notice now belongs to", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const [voided, , changed, moved] = rows(el);
    expect(changed!.querySelector(".notice-note")!.textContent!.trim()).toBe("no onions");
    expect(moved!.querySelector(".notice-moved")!.textContent!.trim()).toBe(
      t("station.notice.moved_to").replace("{table}", "Mesa 9"),
    );
    expect(voided!.querySelector(".notice-note")).toBeNull();
    expect(voided!.querySelector(".notice-moved")).toBeNull();
  });

  it("shows a moved-to table label exactly as typed, `$` sequences included", async () => {
    const label = "Terraza $& $` $'";
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: [notice({ kind: "moved", movedTo: label })],
    });
    expect(rows(el)[0]!.querySelector(".notice-moved")!.textContent!.trim()).toBe(
      t("station.notice.moved_to").split("{table}").join(label),
    );
  });

  it("Acknowledge emits acknowledge-notice with the notice's id, bubbling and composed", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const handler = vi.fn();
    document.addEventListener("acknowledge-notice", handler);
    try {
      rows(el)[2]!.querySelector<HTMLElement>("[data-acknowledge]")!.click();
    } finally {
      document.removeEventListener("acknowledge-notice", handler);
    }
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]![0] as CustomEvent).detail).toEqual({ noticeId: "kn-changed" });
  });

  it("each Acknowledge button's name starts with its visible text and says which notice it clears", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      notices: fourKinds,
    });
    const label = rows(el)[0]!.querySelector("[data-acknowledge]")!.getAttribute("aria-label")!;
    expect(label.startsWith(t("station.notice.acknowledge"))).toBe(true);
    expect(label).toContain(t("station.notice.void"));
    expect(label).toContain("1× Burger");
    expect(label).toContain("#5 · Mesa 4");
  });

  it("keeps the notices on screen when the queue itself is empty (a void can take the last item)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [],
      notices: [notice({})],
    });
    expect(rows(el)).toHaveLength(1);
    expect(el.shadowRoot!.textContent).toContain(t("station.empty"));
  });

  it("renders no strip at all when there are no notices", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector(".notices")).toBeNull();
  });
});

// A seated party's bill: listed out of position order, with a line moved in from another bill (no
// group) and each item still carrying a course, so a passing test proves the card sections by GROUP.
const partyOrder: StationQueueGroup = {
  orderId: "wo-p",
  orderNumber: 9,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "open",
  thresholds: DEFAULT_THRESHOLDS,
  visit: { id: "v-4", revision: 12 },
  items: [
    {
      id: "it-steak",
      workingOrderLineId: "wl-steak",
      state: "queued",
      name: "Solomillo",
      quantity: "2.000",
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      group: { id: "g-3", position: 3, state: "held" },
      firedAt: null,
    },
    {
      id: "it-salad",
      workingOrderLineId: "wl-salad",
      state: "preparing",
      name: "Ensalada",
      quantity: "1.000",
      course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
      group: { id: "g-2", position: 2, state: "fired" },
      firedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      id: "it-moved",
      workingOrderLineId: "wl-moved",
      state: "queued",
      name: "Pan",
      quantity: "1.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      id: "it-flan",
      workingOrderLineId: "wl-flan",
      state: "queued",
      name: "Flan",
      quantity: "1.000",
      course: { id: "co-dessert", name: "Postres", displayOrder: 3 },
      group: { id: "g-4", position: 4, state: "held" },
      firedAt: null,
    },
    {
      id: "it-fish",
      workingOrderLineId: "wl-fish",
      state: "queued",
      name: "Merluza",
      quantity: "1.000",
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      group: { id: "g-3", position: 3, state: "held" },
      firedAt: null,
    },
  ],
};

describe("till-station-queue — a seated party's groups", () => {
  const sections = (el: TillStationQueue) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-group-section]"),
  ];

  it("rail: sections a party's card by group position, the lines with no group first, and no course headers", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      view: "rail",
      stationId: "st-1",
    });
    expect(sections(el).map((s) => s.dataset.groupSection)).toEqual(["none", "g-2", "g-3", "g-4"]);
    expect(sections(el)[0]!.querySelector(".course-head")).toBeNull();
    expect(sections(el)[0]!.querySelector('[data-item="it-moved"]')).not.toBeNull();
    expect(sections(el)[1]!.querySelector(".course-head")!.textContent).toContain(
      t("table.group_n").replace("{n}", "2"),
    );
    expect(
      [...sections(el)[2]!.querySelectorAll<HTMLElement>("[data-item]")].map((i) => i.dataset.item),
    ).toEqual(["it-steak", "it-fish"]);
    expect(el.shadowRoot!.querySelector("[data-course]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("Principales");
  });

  it("rail: a held group says it is held, not released, and its lines are greyed and not bump targets", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      view: "rail",
      stationId: "st-1",
    });
    const [, fired, held] = sections(el);
    expect(held!.querySelector("[data-group-held]")!.textContent).toContain(
      t("station.group_held"),
    );
    expect(fired!.querySelector("[data-group-held]")).toBeNull();
    expect(held!.querySelector('[data-item="it-steak"]')!.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-steak"]')).toBeNull();
  });

  it("kitchen fire: Fire on each held group emits fire-kitchen-group with the card's party and revision", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
    });
    const fires = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-fire-group]")];
    expect(fires.map((b) => b.dataset.fireGroup)).toEqual(["g-3", "g-4"]);
    expect(fires[0]!.textContent).toContain(t("station.fire_group"));
    expect(fires[0]!.getAttribute("aria-label")).toBe(
      `${t("station.fire_group")} ${t("table.group_n").replace("{n}", "3")}`,
    );
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    let captured: CustomEvent | undefined;
    el.addEventListener("fire-kitchen-group", (e) => (captured = e as CustomEvent));
    fires[0]!.click();
    expect(captured!.detail).toEqual({ visitId: "v-4", groupId: "g-3", expectedVisitRevision: 12 });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it.each(["waiter", "expo"] as const)(
    "fire control %s: no Fire on a held group",
    async (fireControl) => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [partyOrder],
        view: "rail",
        stationId: "st-1",
        fireControl,
      });
      expect(el.shadowRoot!.querySelector("[data-fire-group]")).toBeNull();
    },
  );

  it("advanceOnly: a device display never offers Fire on a held group", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-fire-group]")).toBeNull();
  });

  it("kanban: no Fire on a held group", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [partyOrder],
      stationId: "st-1",
      fireControl: "kitchen",
    });
    expect(el.shadowRoot!.querySelector("[data-fire-group]")).toBeNull();
  });

  it("a card with no party keeps its course sections beside a party's card", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder, partyOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
    });
    const counter = el.shadowRoot!.querySelector('[data-order="7"]')!;
    expect(
      [...counter.querySelectorAll<HTMLElement>("[data-course]")].map((s) => s.dataset.course),
    ).toEqual(["none", "co-start", "co-main"]);
    expect(counter.querySelector("[data-group-section]")).toBeNull();
    expect(counter.querySelector('[data-fire="co-main"]')).not.toBeNull();
  });
});

describe("till-station-queue — printing problems", () => {
  const troubled: StationQueueGroup = { ...groupA, printProblem: true };

  it("rail: a card whose ticket has not printed says so; another card does not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled, groupB],
      view: "rail",
      stationId: "st-1",
    });
    const card = el.shadowRoot!.querySelector('[data-order="5"]')!;
    expect(card.querySelector("[data-print-problem]")!.textContent).toContain(
      t("station.print_problem"),
    );
    expect(el.shadowRoot!.querySelector('[data-order="6"] [data-print-problem]')).toBeNull();
  });

  it("rail: Reprint is on the troubled card only where the widget shows Reprint", async () => {
    const operator = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled],
      view: "rail",
      stationId: "st-1",
      showReprint: true,
    });
    expect(
      operator.el.shadowRoot!.querySelector('[data-order="5"] [data-reprint="wo-1"]'),
    ).not.toBeNull();
    const device = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled],
      view: "rail",
      stationId: "st-1",
      advanceOnly: true,
    });
    expect(device.el.shadowRoot!.querySelector("[data-print-problem]")).not.toBeNull();
    expect(device.el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });

  it("kanban: names each order whose ticket has not printed above the columns", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [troubled, groupB],
      stationId: "st-1",
    });
    const strip = el.shadowRoot!.querySelector("[data-print-problems]")!;
    expect(strip.textContent).toContain(t("station.print_problem"));
    expect(strip.textContent).toContain("#5 · Mesa 4");
    expect(strip.textContent).not.toContain("#6");
  });

  it("kanban: an order with no label is named by its number alone", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [{ ...groupB, printProblem: true }],
      stationId: "st-1",
    });
    const strip = el.shadowRoot!.querySelector("[data-print-problems]")!;
    expect(strip.textContent!.replace(/\s+/g, " ").trim()).toBe(
      `${t("station.print_problem")}: #6`,
    );
  });

  it("kanban: no strip while every ticket printed", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector("[data-print-problems]")).toBeNull();
  });
});
