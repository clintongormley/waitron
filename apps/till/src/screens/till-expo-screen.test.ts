import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoOrder, TillApi } from "../api/client.js";

const FIRED = "2026-08-17T10:00:00.000Z";

/** An order with THREE courses — the null (auto-fired) course first, a FIRED all-ready course
 *  (Entrantes → the "En camino" away lever), and a HELD later course (Principales → the "Marchar"
 *  fire lever, shown only under `fire_control = 'expo'`). Each item carries a distinct station so the
 *  cross-station labelling is visible. */
const threeCourseOrder: ExpoOrder = {
  orderId: "wo-1",
  orderNumber: 5,
  tableLabel: "Mesa 4",
  openedMinutes: 3,
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

  // --- Age colouring --------------------------------------------------------------------------

  it("colours each card by its open-minutes bucket (fresh <5, warm <10, hot >=10)", async () => {
    const el = await mount({
      api: stubApi([threeCourseOrder, firedNotReadyOrder, withAwayCourse]),
      fireControl: "expo",
    });
    expect(orderCard(el, 5)!.classList).toContain("age-fresh"); // 3 min
    expect(orderCard(el, 6)!.classList).toContain("age-warm"); // 7 min
    expect(orderCard(el, 8)!.classList).toContain("age-hot"); // 12 min
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
