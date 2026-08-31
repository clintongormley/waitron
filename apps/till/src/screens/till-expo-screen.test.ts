import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { allergenName } from "../i18n/allergen-names.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoItem, ExpoOrder, TillApi } from "../api/client.js";

const FIRED = "2026-08-17T10:00:00.000Z";

// The station's KDS order-timing thresholds (KDS order-timing alerts, design §4/§6) — the shipped DB
// defaults. The lever/course fixtures below (threeCourseOrder, firedNotReadyOrder, withAwayCourse)
// don't test bands, so every item just carries this + a fixed `queuedAt`/`band`; the DEDICATED
// age-band fixtures further down (bandOrder) vary `queuedAt` against an injected `now` instead.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

/** An order with THREE courses — the null (auto-fired) course first, a FIRED all-ready course
 *  (Entrantes → the "En camino" away lever), and a HELD later course (Principales → the "Marchar"
 *  fire lever, shown only under `fire_control = 'expo'`). Each item carries a distinct station so the
 *  cross-station labelling is visible. */
const threeCourseOrder: ExpoOrder = {
  orderId: "wo-1",
  orderNumber: 5,
  tableLabel: "Mesa 4",
  openedMinutes: 3,
  worstBand: "fresh",
  courses: [
    {
      courseId: null,
      courseName: null,
      displayOrder: null,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-0",
          name: { "es-ES": "Pan" },
          qty: "1.000",
          stationName: "Barra",
          state: "ready",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
    {
      courseId: "co-1",
      courseName: "Entrantes",
      displayOrder: 0,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-1",
          name: { "es-ES": "Croquetas" },
          qty: "2.000",
          stationName: "Cocina",
          state: "ready",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
    {
      courseId: "co-2",
      courseName: "Principales",
      displayOrder: 1,
      fired: false,
      away: false,
      items: [
        {
          id: "ti-2",
          name: { "es-ES": "Solomillo" },
          qty: "1.000",
          stationName: "Parrilla",
          state: "queued",
          firedAt: null,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
  ],
};

/** A single FIRED-but-not-all-ready course — one item still `preparing` — so the pass offers the
 *  "Curso listo" (bumpCourseReady) lever, never the away lever. */
const firedNotReadyOrder: ExpoOrder = {
  orderId: "wo-2",
  orderNumber: 6,
  openedMinutes: 7,
  worstBand: "fresh",
  courses: [
    {
      courseId: "co-3",
      courseName: "Postres",
      displayOrder: 2,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-3",
          name: { "es-ES": "Flan" },
          qty: "1.000",
          stationName: "Cocina",
          state: "preparing",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
  ],
};

/** An order whose FIRST course is fully AWAY (dispatched) beside a still-live course — the away one
 *  must drop off the board, the live one stay. */
const withAwayCourse: ExpoOrder = {
  orderId: "wo-3",
  orderNumber: 8,
  openedMinutes: 12,
  worstBand: "fresh",
  courses: [
    {
      courseId: "co-4",
      courseName: "Entrantes",
      displayOrder: 0,
      fired: true,
      away: true,
      items: [
        {
          id: "ti-4",
          name: { "es-ES": "Gazpacho" },
          qty: "1.000",
          stationName: "Cocina",
          state: "ready",
          firedAt: FIRED,
          awayAt: FIRED,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
    {
      courseId: "co-5",
      courseName: "Principales",
      displayOrder: 1,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-5",
          name: { "es-ES": "Merluza" },
          qty: "1.000",
          stationName: "Cocina",
          state: "ready",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
  ],
};

/**
 * A fake `TillApi` exposing only the expo methods the screen calls. `getExpoQueue` defaults to the
 * three-course order; a test overrides it. Cast through `unknown` because the screen touches only
 * this surface.
 */
function stubApi(queue: ExpoOrder[] = [threeCourseOrder], overrides: Record<string, unknown> = {}) {
  return {
    getExpoQueue: vi.fn().mockResolvedValue(queue),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    markCourseAway: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

/** Settles the in-flight getExpoQueue promise and re-renders. */
async function flush(el: TillExpoScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(props: {
  api: TillApi;
  fireControl?: "waiter" | "kitchen" | "expo";
  now?: number;
  reducedMotion?: boolean;
}): Promise<TillExpoScreen> {
  const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", props);
  await flush(el);
  return el;
}

const orderCard = (el: TillExpoScreen, orderNumber: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-order="${orderNumber}"]`);

afterEach(cleanupWidgets);

describe("till-expo-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-expo-screen")).toBe(TillExpoScreen);
  });

  it("on connect fetches the expo queue and renders a card per open order", async () => {
    const api = stubApi([threeCourseOrder, firedNotReadyOrder]);
    const el = await mount({ api });
    expect(api.getExpoQueue).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelectorAll("[data-order]")).toHaveLength(2);
    expect(orderCard(el, 5)).not.toBeNull();
    expect(orderCard(el, 6)).not.toBeNull();
  });

  it("renders each order's table label and open-minutes age", async () => {
    const el = await mount({ api: stubApi() });
    const card = orderCard(el, 5)!;
    expect(card.textContent).toContain("#5");
    expect(card.textContent).toContain("Mesa 4");
    expect(card.textContent).toContain(`3 ${t("station.min")}`);
  });

  it("groups by course in display_order, null-course first", async () => {
    const el = await mount({ api: stubApi() });
    const courses = [...orderCard(el, 5)!.querySelectorAll("[data-course]")].map((c) =>
      c.getAttribute("data-course"),
    );
    // Null course sorts earliest (NEGATIVE_INFINITY), then Entrantes (0), then Principales (1).
    expect(courses).toEqual(["none", "co-1", "co-2"]);
  });

  it("renders per item its name, quantity, station and state", async () => {
    const el = await mount({ api: stubApi() });
    const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!;
    expect(item.textContent).toContain("1× Solomillo"); // qty trimmed + name
    expect(item.textContent).toContain("Parrilla"); // the cross-station station name
    expect(item.textContent).toContain(t("station.state.queued")); // the kitchen state
  });

  describe("ordering modifiers (Task 14): selected options as indented sub-text under the item", () => {
    // The wire shape `listExpoQueue` already returns (Task 7) — a fired dish with TWO selected options.
    const orderWithModifiers: ExpoOrder = {
      orderId: "wo-9",
      orderNumber: 9,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [
            {
              id: "ti-9",
              name: { "es-ES": "Cortado" },
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              modifiers: [
                { descriptions: { "es-ES": "Grande" } },
                { descriptions: { "es-ES": "Leche avena" } },
              ],
            },
          ],
        },
      ],
    };

    it("renders the dish then its two options as indented '+ name' sub-text", async () => {
      const el = await mount({ api: stubApi([orderWithModifiers]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-9"]')!;
      expect(item.textContent).toContain("1× Cortado");
      expect(item.textContent).toContain("+ Grande");
      expect(item.textContent).toContain("+ Leche avena");
      // The dish precedes its modifiers in DOM order.
      const html = item.innerHTML;
      expect(html.indexOf("Cortado")).toBeLessThan(html.indexOf("Grande"));
    });

    it("an item with no modifiers renders flat, with no modifiers sub-text at all (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries `modifiers`
      expect(el.shadowRoot!.querySelectorAll(".item-modifiers")).toHaveLength(0);
    });
  });

  describe("as-served allergens (Task 9): contains chips, localised NO <allergen> removals, not-reviewed note", () => {
    // A fired pass item carrying the server-attached as-served profile: CONTAINS milk and REMOVED
    // gluten — the exact shape `listExpoQueue` returns (Task 8), which the pass renders as the chips +
    // removal callout this suite asserts below.
    const orderWithAllergens: ExpoOrder = {
      orderId: "wo-a",
      orderNumber: 11,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [
            {
              id: "ti-a",
              name: { "es-ES": "Hamburguesa" },
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
              removed: ["gluten"],
            },
            {
              id: "ti-p",
              name: { "es-ES": "Especial" },
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              // Own allergens unreviewed (null base) ⇒ the Cautious fold is pending.
              asServed: { allergens: {}, pending: true },
              removed: [],
            },
          ],
        },
      ],
    };

    it("shows a struck 'NO <allergen>' removal callout and a localised 'Milk' contains chip", async () => {
      const el = await mount({ api: stubApi([orderWithAllergens]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-a"]')!;
      // The removal callout localises the code (default locale en-GB) — never the raw English code.
      const removed = item.querySelector('[data-removed="gluten"]')!;
      expect(removed).not.toBeNull();
      expect(removed.textContent).toContain(
        `${t("allergens.without")} ${allergenName("gluten", currentLocale())}`,
      );
      expect(item.textContent).toMatch(/milk/i);
    });

    it("localises the removal callout for the operator locale (es-ES shows 'SIN Leche', not 'MILK')", async () => {
      const esOrder: ExpoOrder = {
        ...orderWithAllergens,
        courses: [
          {
            ...orderWithAllergens.courses[0]!,
            items: [
              {
                ...orderWithAllergens.courses[0]!.items[0]!,
                id: "ti-es",
                asServed: undefined,
                removed: ["milk"],
              },
            ],
          },
        ],
      };
      setLocale("es-ES");
      try {
        const el = await mount({ api: stubApi([esOrder]) });
        const removed = el.shadowRoot!.querySelector<HTMLElement>(
          '[data-item="ti-es"] [data-removed="milk"]',
        )!;
        expect(removed.textContent).toContain("SIN Leche");
        expect(removed.textContent).not.toMatch(/milk/i);
      } finally {
        setLocale("en-GB");
      }
    });

    it("shows a not-reviewed warning when the as-served fold is pending", async () => {
      const el = await mount({ api: stubApi([orderWithAllergens]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-p"]')!;
      expect(item.textContent).toContain(t("allergens.not_reviewed"));
    });

    it("a plain item with no as-served profile and nothing removed renders no allergen row (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries asServed/removed
      expect(el.shadowRoot!.querySelectorAll(".item-allergens")).toHaveLength(0);
    });
  });

  describe("as-served diet badges (Task 7): vegan/vegetarian/contains chips, neutral not-reviewed note", () => {
    const dietItem = (id: string, asServedDiet: ExpoItem["asServedDiet"]): ExpoItem => ({
      id,
      name: { "es-ES": "Ensalada" },
      qty: "1.000",
      stationName: "Cocina",
      state: "queued",
      firedAt: FIRED,
      awayAt: null,
      queuedAt: FIRED,
      thresholds: DEFAULT_THRESHOLDS,
      band: "fresh",
      asServedDiet,
    });
    const orderWithDiet = (item: ExpoItem): ExpoOrder => ({
      orderId: "wo-d",
      orderNumber: 31,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [item],
        },
      ],
    });

    it("shows vegan + vegetarian badges for a plant-only plate", async () => {
      const item = dietItem("ti-v", { vegan: "yes", vegetarian: "yes", contains: [] });
      const el = await mount({ api: stubApi([orderWithDiet(item)]) });
      const node = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-v"]')!;
      expect(node.querySelector("[data-diet='vegan']")).not.toBeNull();
      expect(node.querySelector("[data-diet='vegetarian']")).not.toBeNull();
      expect(node.textContent).not.toMatch(/review|revisi/i);
    });

    it("shows a contains-meat chip and no positive badge for a meat plate", async () => {
      const item = dietItem("ti-m", { vegan: "no", vegetarian: "no", contains: ["meat"] });
      const el = await mount({ api: stubApi([orderWithDiet(item)]) });
      const node = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-m"]')!;
      expect(node.querySelector("[data-diet-contains='meat']")).not.toBeNull();
      expect(node.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("shows the NEUTRAL 'not reviewed' state for a pending diet, never a positive claim", async () => {
      const item = dietItem("ti-pd", { vegan: "unknown", vegetarian: "unknown", contains: [] });
      const el = await mount({ api: stubApi([orderWithDiet(item)]) });
      const node = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-pd"]')!;
      expect(node.querySelector("[data-diet-pending]")).not.toBeNull();
      expect(node.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("a plain item with no asServedDiet renders no diet row (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries asServedDiet
      expect(el.shadowRoot!.querySelectorAll(".line-diet")).toHaveLength(0);
    });
  });

  // --- Per-course lever by state -------------------------------------------------------------

  it("a HELD course under fire_control='expo' shows the Fire lever", async () => {
    const el = await mount({ api: stubApi(), fireControl: "expo" });
    const fire = el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-2"]');
    expect(fire).not.toBeNull();
    expect(fire!.textContent).toContain(t("expo.fire"));
    // The fired course offers no fire lever.
    expect(el.shadowRoot!.querySelector('[data-fire="co-1"]')).toBeNull();
  });

  it("a HELD course under fire_control='waiter' shows NO Fire lever (the expo does not own the fire)", async () => {
    const el = await mount({ api: stubApi(), fireControl: "waiter" });
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).toBeNull();
  });

  it("a FIRED, not-all-ready course shows the Curso-listo lever", async () => {
    const el = await mount({ api: stubApi([firedNotReadyOrder]), fireControl: "expo" });
    const ready = el.shadowRoot!.querySelector<HTMLElement>('[data-ready="co-3"]');
    expect(ready).not.toBeNull();
    expect(ready!.textContent).toContain(t("expo.ready"));
    // It is neither a fire nor an away lever.
    expect(el.shadowRoot!.querySelector('[data-fire="co-3"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-3"]')).toBeNull();
  });

  it("a FIRED, all-ready course shows the En-camino (away) lever", async () => {
    const el = await mount({ api: stubApi(), fireControl: "expo" });
    const away = el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]');
    expect(away).not.toBeNull();
    expect(away!.textContent).toContain(t("expo.away"));
    expect(el.shadowRoot!.querySelector('[data-ready="co-1"]')).toBeNull();
  });

  it("the null (courseless) course shows no per-course lever (it has no course route)", async () => {
    const el = await mount({ api: stubApi(), fireControl: "expo" });
    const nullCourse = orderCard(el, 5)!.querySelector('[data-course="none"]')!;
    expect(nullCourse.querySelector(".lever")).toBeNull();
  });

  it("a fully-away course drops off the board; its live sibling stays", async () => {
    const el = await mount({ api: stubApi([withAwayCourse]), fireControl: "expo" });
    const card = orderCard(el, 8)!;
    expect(card.querySelector('[data-course="co-4"]')).toBeNull(); // away → hidden
    expect(card.querySelector('[data-course="co-5"]')).not.toBeNull(); // live → shown
  });

  // --- Actions call the routes, then reload --------------------------------------------------

  it("clicking Fire calls fireCourse(orderId, courseId) then reloads the queue", async () => {
    const api = stubApi();
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-2"]')!.click();
    await flush(el);
    expect(api.fireCourse).toHaveBeenCalledWith("wo-1", "co-2");
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2); // connect + after fire
  });

  it("clicking Curso listo calls bumpCourseReady(orderId, courseId) then reloads", async () => {
    const api = stubApi([firedNotReadyOrder]);
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-ready="co-3"]')!.click();
    await flush(el);
    expect(api.bumpCourseReady).toHaveBeenCalledWith("wo-2", "co-3");
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
  });

  it("clicking En camino calls markCourseAway(orderId, courseId) then reloads", async () => {
    const api = stubApi();
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.markCourseAway).toHaveBeenCalledWith("wo-1", "co-1");
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
  });

  it("a failed action still reloads the queue (reconciling to server truth)", async () => {
    const api = stubApi(undefined, {
      markCourseAway: vi.fn().mockRejectedValue({ code: "course.not_found" }),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
  });

  // --- Reprint (KDS-4 §3d) — always shown, since the pass always has a session ----------------

  it("shows a per-order Reprint button on every card (the pass always has a session)", async () => {
    const el = await mount({ api: stubApi([threeCourseOrder, firedNotReadyOrder]) });
    // One reprint control per order, keyed by orderId (not the display number).
    const one = orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]');
    expect(one).not.toBeNull();
    expect(one!.textContent).toContain(t("expo.reprint"));
    expect(orderCard(el, 6)!.querySelector('[data-reprint="wo-2"]')).not.toBeNull();
  });

  it("clicking Reprint calls reprintOrder(orderId) with that order's id", async () => {
    const api = stubApi();
    const el = await mount({ api });
    orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    // The actual call + arg, not merely "a handler fired".
    expect(api.reprintOrder).toHaveBeenCalledWith("wo-1");
    // Reprint changes no state, so it never re-reads the queue (only the connect read ran).
    expect(api.getExpoQueue).toHaveBeenCalledOnce();
  });

  it("a rejected Reprint surfaces the localised banner, never the raw code (negative control)", async () => {
    // A mapped code → its SPECIFIC localised sentence, proving the banner never shows the wire code.
    const api = stubApi(undefined, {
      reprintOrder: vi.fn().mockRejectedValue({ code: "session.required" }),
    });
    const el = await mount({ api });
    orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // The banner shows the localised sentence (in the active default locale), never the wire code.
    expect(alert!.textContent).toContain(codeMessage("session.required"));
    expect(alert!.textContent).not.toContain("session.required");
  });

  it("a codeless Reprint rejection (a fetch network throw) falls back to the generic banner", async () => {
    // A rejection with no `code` (e.g. fetch itself throwing before the client wraps it) degrades to
    // `server.internal` — the generic sentence — never an empty banner or a raw throw.
    const api = stubApi(undefined, {
      reprintOrder: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const el = await mount({ api });
    orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("server.internal"));
  });

  // --- Age / timing bands (KDS order-timing alerts, design §7.2) ------------------------------
  //
  // The old two-band 5/10-minute `#ageBucket` (fresh/warm/hot, driven by the server's static
  // `openedMinutes`) is gone. The card's accent is now `classifyBand` (`@waitron/shared`) applied
  // to EACH item's own `queuedAt`/`thresholds` (an expo order's items can span several stations,
  // each with its own thresholds), reduced to the worst band across the card's visible items —
  // deterministic here via the injected `now`, never the real wall clock.

  /** A single-item, single-course order whose card's worst band is driven entirely by that one
   *  item's `classifyBand(queuedAt, now, thresholds)` — never `openedMinutes`, which is set to an
   *  unrelated value here to prove it is no longer consulted for the accent. */
  function bandOrder(
    orderId: string,
    orderNumber: number,
    itemId: string,
    queuedAt: string,
  ): ExpoOrder {
    return {
      orderId,
      orderNumber,
      openedMinutes: 999, // deliberately absurd — proves the accent ignores it
      worstBand: "fresh", // the server's fetch-time value — the live accent re-derives, not this
      courses: [
        {
          courseId: "co-x",
          courseName: "Postres",
          displayOrder: 0,
          fired: true,
          away: false,
          items: [
            {
              id: itemId,
              name: { "es-ES": "Flan" },
              qty: "1.000",
              stationName: "Cocina",
              state: "preparing",
              firedAt: FIRED,
              awayAt: null,
              queuedAt,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh", // the server's fetch-time value — likewise re-derived, not read
            },
          ],
        },
      ],
    };
  }

  it("colours a card by classifyBand on its item's queuedAt/thresholds, ignoring openedMinutes", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // 12 min → overdue
    const el = await mount({
      api: stubApi([bandOrder("wo-a", 21, "ti-a", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(orderCard(el, 21)!.classList).toContain("age-overdue");
  });

  it("a fresh item's card carries no escalation accent", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // 1 min → fresh
    const el = await mount({
      api: stubApi([bandOrder("wo-fresh", 20, "ti-fresh", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(orderCard(el, 20)!.classList).toContain("age-fresh");
  });

  it("a forgotten item flags BOTH the card's accent and the item itself (a non-colour tell)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // 16 min → forgotten (past the 15-min default)
    const el = await mount({
      api: stubApi([bandOrder("wo-b", 22, "ti-b", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    const card = orderCard(el, 22)!;
    expect(card.classList).toContain("age-forgotten");
    const flag = card.querySelector<HTMLElement>('[data-item="ti-b"] [data-forgotten]');
    expect(flag).not.toBeNull();
    expect(flag!.textContent).toContain(t("expo.item_forgotten"));
  });

  it("a merely-overdue item is NOT flagged forgotten (negative control)", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // 12 min → overdue, not forgotten
    const el = await mount({
      api: stubApi([bandOrder("wo-c", 23, "ti-c", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(orderCard(el, 23)!.querySelector('[data-item="ti-c"] [data-forgotten]')).toBeNull();
  });

  it("the pass-wide count reads the number of orders at overdue-or-worse (BAND_RANK)", async () => {
    // wo-d is 16 min old (forgotten); wo-e is 15 min old (still just overdue, not forgotten) —
    // both count; a third, fresh order (from bandOrder's own fresh-item test) is not mixed in here.
    const now = Date.parse("2026-08-17T10:16:00.000Z");
    const el = await mount({
      api: stubApi([
        bandOrder("wo-d", 24, "ti-d", "2026-08-17T10:00:00.000Z"),
        bandOrder("wo-e", 25, "ti-e", "2026-08-17T10:01:00.000Z"),
      ]),
      now,
    });
    const badge = el.shadowRoot!.querySelector(".overdue-count")!;
    expect(badge.textContent).toContain("2");
    expect(badge.textContent).toContain(t("station.overdue_count"));
  });

  it("shows no pass-wide count badge when nothing has escalated to overdue", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // 1 min → fresh
    const el = await mount({
      api: stubApi([bandOrder("wo-f", 26, "ti-f", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(el.shadowRoot!.querySelector(".overdue-count")).toBeNull();
  });

  it("forgotten flashes by default (motion allowed) — the flash class rides the steady accent", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z");
    const el = await mount({
      api: stubApi([bandOrder("wo-g", 27, "ti-g", "2026-08-17T10:00:00.000Z")]),
      now,
      reducedMotion: false,
    });
    const card = orderCard(el, 27)!;
    expect(card.classList).toContain("age-forgotten");
    expect(card.classList).toContain("flash");
  });

  it("reduced motion: a forgotten card renders the steady accent with NO flash class", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z");
    const el = await mount({
      api: stubApi([bandOrder("wo-h", 28, "ti-h", "2026-08-17T10:00:00.000Z")]),
      now,
      reducedMotion: true,
    });
    const card = orderCard(el, 28)!;
    expect(card.classList).toContain("age-forgotten");
    expect(card.classList).not.toContain("flash");
  });

  it("reduced motion never applies flash to a merely-overdue (non-forgotten) card either", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // 12 min → overdue, not forgotten
    const el = await mount({
      api: stubApi([bandOrder("wo-i", 29, "ti-i", "2026-08-17T10:00:00.000Z")]),
      now,
      reducedMotion: false,
    });
    const card = orderCard(el, 29)!;
    expect(card.classList).toContain("age-overdue");
    expect(card.classList).not.toContain("flash");
  });

  it("injected now advances the band without a new fetch (the ticking-clock contract)", async () => {
    const api = stubApi([bandOrder("wo-j", 30, "ti-j", "2026-08-17T10:00:00.000Z")]);
    const el = await mount({ api, now: Date.parse("2026-08-17T10:01:00.000Z") }); // 1 min → fresh
    expect(orderCard(el, 30)!.classList).toContain("age-fresh");

    // Move the injected clock forward past the forgotten threshold and re-render — no re-fetch.
    el.now = Date.parse("2026-08-17T10:16:00.000Z"); // 16 min → forgotten
    await el.updateComplete;
    expect(orderCard(el, 30)!.classList).toContain("age-forgotten");
    expect(api.getExpoQueue).toHaveBeenCalledOnce(); // still just the initial connect fetch
  });

  // --- Empty / degrade / back -----------------------------------------------------------------

  it("shows the empty message when the pass has no open orders", async () => {
    const el = await mount({ api: stubApi([]) });
    expect(el.shadowRoot!.textContent).toContain(t("expo.empty"));
    expect(el.shadowRoot!.querySelector("[data-order]")).toBeNull();
  });

  it("a failed queue read leaves the board empty (degrade gracefully)", async () => {
    const api = stubApi(undefined, {
      getExpoQueue: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount({ api });
    expect(el.shadowRoot!.textContent).toContain(t("expo.empty"));
  });

  it("the Back control emits back-to-counter", async () => {
    const el = await mount({ api: stubApi() });
    const spy = vi.fn();
    el.addEventListener("back-to-counter", spy);
    el.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
    expect(spy).toHaveBeenCalledOnce();
  });
});
