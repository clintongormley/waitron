import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { TableSignal } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday } from "../api/client.js";

const now = Date.parse("2026-10-20T20:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

const zone = (id: string, name: string, displayOrder: number): FloorZone => ({
  id,
  name,
  displayOrder,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
});

const zones = [zone("z1", "Inside", 0), zone("z2", "Terrace", 1)];

function party(id: string, over: Partial<TableParty> = {}): TableParty {
  return {
    id,
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: 1 },
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: id,
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: [],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function today(x: number, placed = true): TableToday {
  return {
    placement: placed ? { x, y: 3, width: 2, height: 2, shape: "round", rotation: 0 } : null,
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
  };
}

function free(id: string, zoneId: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: today(Number(id.slice(1)) * 3),
    signals: [],
    party: null,
    ...over,
  };
}

const seated = (id: string, zoneId: string, over: Partial<TableState> = {}): TableState =>
  free(id, zoneId, {
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    party: party(`p-${id}`),
    ...over,
  });

const held: TableSignal = { kind: "held", count: 2 };

// Inside comes first, so it is the zone on screen.
const mount = (tables: TableState[], { reducedMotion = true } = {}) =>
  mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables,
    now,
    reducedMotion,
  });

const tabOf = (el: TillFloorScreen, zoneId: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`wt-button.tab[data-zone="${zoneId}"]`)!;

const stateOf = (el: TillFloorScreen, zoneId: string) =>
  tabOf(el, zoneId).closest(".zone-tab")?.getAttribute("data-zone-state") ?? null;

const buttonOf = (el: TillFloorScreen, zoneId: string) =>
  tabOf(el, zoneId).shadowRoot!.querySelector<HTMLButtonElement>('[part="button"]')!;

const pulseOf = (el: TillFloorScreen, zoneId: string) =>
  tabOf(el, zoneId).closest(".zone-tab")!.querySelector<HTMLElement>(".pulse");

/** The width `value` resolves to on the page. */
function tapProbe(host: HTMLElement, value: string): number {
  const probe = document.createElement("div");
  probe.style.width = value;
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/** The element's padding box on the page, to the fraction of a pixel (`clientWidth` is whole). */
function paddingBox(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const [top, right, bottom, left] = ["Top", "Right", "Bottom", "Left"].map((side) =>
    parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)),
  ) as [number, number, number, number];
  const barX = Math.max(0, el.offsetWidth - el.clientWidth - el.clientLeft - right);
  const barY = Math.max(0, el.offsetHeight - el.clientHeight - el.clientTop - bottom);
  return {
    left: box.left + left,
    top: box.top + top,
    right: box.right - right - barX,
    bottom: box.bottom - bottom - barY,
  };
}

/** Two frames, so an intersection observer has delivered what the first one saw. */
const nextFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/** Pads a zone's tab out to `width(span)`, `span` being the strip's padding box across while its
 * tabs overflow it, so a case's geometry rests on measurement rather than on how wide the
 * machine's fonts draw the zone's name. */
async function sizeTab(strip: HTMLElement, zoneTab: HTMLElement, width: (span: number) => number) {
  zoneTab.style.paddingRight = "";
  const name = zoneTab.getBoundingClientRect().width;
  zoneTab.style.paddingRight = `${window.innerWidth}px`;
  const box = paddingBox(strip);
  const target = width(box.right - box.left);
  expect(name).toBeLessThan(target);
  zoneTab.style.paddingRight = `${target - name}px`;
  await nextFrames();
  const sized = paddingBox(strip);
  expect(sized.right - sized.left).toBeCloseTo(box.right - box.left, 2);
  expect(zoneTab.getBoundingClientRect().width).toBeCloseTo(target, 1);
}

/** Halfway between too wide to clear an edge at each end and too wide to clear one edge. */
const wideBetweenEdges = (span: number, clear: number, ring: number) =>
  (span - 2 * clear + (span - clear - ring)) / 2;

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});

describe("till-floor-screen: zone tabs", () => {
  it("tints a hidden zone's tab with its most urgent state, a bar and its icon", async () => {
    const { el, host } = await mount(
      [
        seated("t1", "z1"),
        seated("t2", "z2", { signals: [{ kind: "bill_requested", requestedAt: inMinutes(-3) }] }),
        seated("t3", "z2", { timingBand: "forgotten" }),
      ],
      { reducedMotion: false },
    );
    host.style.setProperty("--wt-color-tab-danger-tint", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");

    expect(stateOf(el, "z2")).toBe("forgotten");
    const button = buttonOf(el, "z2");
    const style = getComputedStyle(button);
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.boxShadow).toContain("rgb(4, 5, 6)");
    expect(style.boxShadow).toContain("inset");

    const tab = tabOf(el, "z2");
    const icon = tab.querySelector('wt-icon[name="floor-timer"]');
    expect(icon).not.toBeNull();
    const name = [...tab.childNodes].find((node) => node.textContent?.trim() === "Terrace")!;
    expect(name.compareDocumentPosition(icon!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("Terrace, Forgotten");
  });

  it.each<[string, Partial<TableState>, string, string]>([
    ["overdue", { timingBand: "overdue" }, "tab-danger-tint", "danger"],
    [
      "unavailable",
      { signals: [{ kind: "held_unavailable", groupId: "g", lineNames: ["Steak"] }] },
      "tab-warning-tint",
      "warning",
    ],
    [
      "fire",
      { party: party("p-t2", { reminder: { groupId: "g", dueAt: inMinutes(-1) } }) },
      "tab-warning-tint",
      "warning",
    ],
    ["waiting", { signals: [{ kind: "long_wait", band: "warm" }] }, "tab-warning-tint", "warning"],
    [
      "clearing",
      { party: null, state: "free", condition: "needs_clearing" },
      "tab-warning-tint",
      "warning",
    ],
    [
      "moving",
      { party: null, state: "free", today: { ...today(6), needsMoving: true } },
      "tab-warning-tint",
      "warning",
    ],
    [
      "bill",
      { signals: [{ kind: "bill_requested", requestedAt: inMinutes(-3) }] },
      "tab-bill-tint",
      "table-bill",
    ],
    ["ready", { readyToServe: 2 }, "tab-ready-tint", "success"],
    ["step", { signals: [{ kind: "take_order" }] }, "tab-seated-tint", "table-seated"],
    [
      "delivery",
      { party: null, state: "delivery-pending", pendingDeliveries: 1 },
      "tab-seated-tint",
      "table-seated",
    ],
    [
      "not-sent",
      {
        party: party("p-t2", {
          unsentDrafts: [{ billId: "b", billNumber: 3, ownerName: "Alex", lineCount: 1 }],
        }),
      },
      "tab-seated-tint",
      "table-seated",
    ],
  ])("paints %s with its family's tint and bar", async (kind, over, tint, bar) => {
    const { el, host } = await mount([seated("t1", "z1"), seated("t2", "z2", over)]);
    host.style.setProperty(`--wt-color-${tint}`, "rgb(1, 2, 3)");
    host.style.setProperty(`--wt-color-${bar}`, "rgb(4, 5, 6)");
    expect(stateOf(el, "z2")).toBe(kind);
    const style = getComputedStyle(buttonOf(el, "z2"));
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.boxShadow).toBe("rgb(4, 5, 6) 0px -4px 0px 0px inset");
  });

  it("keeps the tint and bar while the tab is hovered", async () => {
    const { el, host } = await mount([seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })]);
    host.style.setProperty("--wt-color-tab-ready-tint", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-success", "rgb(4, 5, 6)");
    const button = buttonOf(el, "z2");
    await userEvent.hover(button);
    expect(button.matches(":hover")).toBe(true);
    const style = getComputedStyle(button);
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.boxShadow).toBe("rgb(4, 5, 6) 0px -4px 0px 0px inset");
  });

  it.each<[string, Partial<TableState>, string | null]>([
    ["forgotten", { timingBand: "forgotten" }, "wt-pulse-fast"],
    ["overdue", { timingBand: "overdue" }, "wt-pulse-slow"],
    [
      "fire",
      { party: party("p-t2", { reminder: { groupId: "g", dueAt: inMinutes(-1) } }) },
      "wt-pulse-slow",
    ],
    ["step", { signals: [{ kind: "take_order" }] }, null],
  ])("pulses at the state's speed: %s", async (kind, over, speed) => {
    const { el } = await mount([seated("t1", "z1"), seated("t2", "z2", over)], {
      reducedMotion: false,
    });
    expect(stateOf(el, "z2")).toBe(kind);
    const pulse = pulseOf(el, "z2");
    if (speed === null) {
      expect(pulse).toBeNull();
    } else {
      expect(pulse).not.toBeNull();
      expect(pulse!.classList.contains(speed)).toBe(true);
      expect(pulse!.getAttribute("data-pulse")).toBe(kind);
    }
    expect(pulseOf(el, "z1")).toBeNull();
  });

  it("the strip leaves room for the ring", async () => {
    // Vitest's Chromium runs with --hide-scrollbars, so no case here sees a scrollbar.
    const { el, host } = await mount(
      [seated("t1", "z1"), seated("t2", "z2", { timingBand: "forgotten" })],
      { reducedMotion: false },
    );
    const probe = document.createElement("div");
    probe.style.width = "calc(var(--wt-space-1) * 1.5)";
    host.appendChild(probe);
    const reach = probe.getBoundingClientRect().width;
    probe.remove();
    expect(reach).toBeGreaterThan(0);

    const ring = pulseOf(el, "z2")!.getBoundingClientRect();
    const box = paddingBox(el.shadowRoot!.querySelector<HTMLElement>(".tabs")!);
    expect(ring.left - reach).toBeGreaterThanOrEqual(box.left);
    expect(ring.top - reach).toBeGreaterThanOrEqual(box.top);
    expect(ring.right + reach).toBeLessThanOrEqual(box.right);
    expect(ring.bottom + reach).toBeLessThanOrEqual(box.bottom);
  });

  it("the strip leaves room for the first tab's ring", async () => {
    const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones,
      tables: [seated("t1", "z1", { timingBand: "forgotten" }), seated("t2", "z2")],
      now,
      reducedMotion: false,
      selectedZoneId: "z2",
    });
    const reach = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
    expect(reach).toBeGreaterThan(0);
    const ring = pulseOf(el, "z1")!.getBoundingClientRect();
    const box = paddingBox(el.shadowRoot!.querySelector<HTMLElement>(".tabs")!);
    expect(ring.left - reach).toBeGreaterThanOrEqual(box.left);
    expect(ring.top - reach).toBeGreaterThanOrEqual(box.top);
  });

  it("under reduced motion nothing moves and a forgotten tab is filled red", async () => {
    const zonesThree = [...zones, zone("z3", "Bar", 2)];
    const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: zonesThree,
      tables: [
        seated("t1", "z1"),
        seated("t2", "z2", { timingBand: "forgotten" }),
        seated("t3", "z3", { timingBand: "overdue" }),
      ],
      now,
      reducedMotion: true,
    });
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
    host.style.setProperty("--wt-color-on-danger", "rgb(7, 8, 9)");
    host.style.setProperty("--wt-color-tab-danger-tint", "rgb(1, 2, 3)");

    expect(el.shadowRoot!.querySelector(".zone-tab .pulse")).toBeNull();
    expect(
      el.shadowRoot!.querySelector(".zone-tab .wt-pulse-fast, .zone-tab .wt-pulse-slow"),
    ).toBeNull();
    const forgotten = getComputedStyle(buttonOf(el, "z2"));
    expect(forgotten.backgroundColor).toBe("rgb(4, 5, 6)");
    expect(forgotten.color).toBe("rgb(7, 8, 9)");
    // Only Forgotten fills; an overdue tab keeps its tint.
    expect(getComputedStyle(buttonOf(el, "z3")).backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("draws a filled forgotten tab's icon in the filled tab's text colour", async () => {
    const { el, host } = await mount([
      seated("t1", "z1"),
      seated("t2", "z2", { timingBand: "forgotten" }),
    ]);
    host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-on-danger", "rgb(7, 8, 9)");

    const icon = tabOf(el, "z2").querySelector("wt-icon")!;
    expect(getComputedStyle(icon).color).toBe("rgb(7, 8, 9)");
  });

  it("leaves the zone on screen plain", async () => {
    const { el } = await mount([seated("t1", "z1", { timingBand: "forgotten" }), free("t2", "z2")]);
    expect(stateOf(el, "z1")).toBeNull();
    expect(buttonOf(el, "z1").hasAttribute("aria-label")).toBe(false);
    expect(stateOf(el, "z2")).toBeNull();

    await userEvent.click(buttonOf(el, "z2"));
    await el.updateComplete;
    expect(stateOf(el, "z1")).toBe("forgotten");
    expect(stateOf(el, "z2")).toBeNull();
  });

  it("leaves a tab plain for held, calm, reserved and free tables", async () => {
    const { el } = await mount([
      seated("t1", "z1"),
      seated("t2", "z2", {
        signals: [held],
        party: party("p-t2", { reminder: { groupId: "g1", dueAt: inMinutes(10) } }),
      }),
      seated("t3", "z2"),
      free("t4", "z2", { nextReservation: { time: "21:30" } }),
      free("t5", "z2"),
    ]);
    expect(stateOf(el, "z2")).toBeNull();
    expect(tabOf(el, "z2").querySelector("wt-icon")).toBeNull();
    expect(buttonOf(el, "z2").hasAttribute("aria-label")).toBe(false);
  });

  it("counts every table of the zone, not only the drawn ones", async () => {
    const { el } = await mount([
      seated("t1", "z1"),
      free("t2", "z2"),
      seated("t3", "z2", { timingBand: "forgotten", today: today(0, false) }),
    ]);
    expect(stateOf(el, "z2")).toBe("forgotten");
  });

  it("says it in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es");
    try {
      const { el } = await mount([
        seated("t1", "z1"),
        seated("t2", "z2", { timingBand: "forgotten" }),
      ]);
      expect(buttonOf(el, "z2").getAttribute("aria-label")).toBe(
        `Terrace, ${es["floor.forgotten"]}`,
      );
    } finally {
      setLocale(previous);
    }
  });
});

describe("till-floor-screen: the zone strip's edge", () => {
  // Six zones whose names overflow a phone's strip; Inside, the first, is on screen.
  const many = [
    zone("z1", "Inside", 0),
    zone("z2", "Bar", 1),
    zone("z3", "Upstairs lounge", 2),
    zone("z4", "Garden terrace", 3),
    zone("z5", "Patio", 4),
    zone("z6", "Private room", 5),
  ];

  const onPhone = async (
    tables: TableState[],
    check: (el: TillFloorScreen, host: HTMLElement) => Promise<void>,
    reducedMotion = false,
    zoneList = many,
  ) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(390, 844);
    try {
      const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
        zones: zoneList,
        tables,
        now,
        reducedMotion,
      });
      await check(el, host);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  };

  const edgeOf = (el: TillFloorScreen, side: "start" | "end") =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-tabs-edge="${side}"]`);

  const stripOf = (el: TillFloorScreen) => el.shadowRoot!.querySelector<HTMLElement>("nav.tabs")!;

  const urgentRight = () => [
    seated("t1", "z1"),
    seated("t5", "z5", { timingBand: "forgotten" }),
    seated("t6", "z6", { signals: [{ kind: "take_order" }] }),
  ];

  it("shows the most urgent hidden tab's icon at the end it is beyond", async () => {
    await onPhone(urgentRight(), async (el, host) => {
      host.style.setProperty("--wt-color-tab-danger-tint", "rgb(1, 2, 3)");
      host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
      await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
      const edge = edgeOf(el, "end")!;
      expect(edge.getAttribute("data-zone-state")).toBe("forgotten");
      expect(edge.querySelector('wt-icon[name="floor-timer"]')).not.toBeNull();
      expect(edge.textContent).toContain("›");
      const style = getComputedStyle(edge);
      expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
      expect(style.boxShadow).toBe("rgb(4, 5, 6) 0px -4px 0px 0px inset");
      const pulse = edge.querySelector(".pulse");
      expect(pulse?.classList.contains("wt-pulse-fast")).toBe(true);
      expect(edgeOf(el, "start")).toBeNull();
      // The edge is laid over the strip's end, never inside it.
      expect(edge.parentElement).toBe(stripOf(el).parentElement);
      expect(stripOf(el).nextElementSibling).toBe(edge);
    });
  });

  it("tapping it scrolls that tab fully into view, and the edge then shows the next one", async () => {
    await onPhone(urgentRight(), async (el, host) => {
      await expect.poll(() => edgeOf(el, "end")?.getAttribute("data-zone-state")).toBe("forgotten");
      await userEvent.click(edgeOf(el, "end")!);
      await expect.poll(() => edgeOf(el, "end")?.getAttribute("data-zone-state")).toBe("step");
      expect(edgeOf(el, "end")!.querySelector('wt-icon[name="floor-step"]')).not.toBeNull();
      expect(edgeOf(el, "end")!.getAttribute("aria-label")).toBe("Show Private room");

      const reach = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
      expect(reach).toBeGreaterThan(0);
      const tab = tabOf(el, "z5").closest(".zone-tab")!.getBoundingClientRect();
      const box = paddingBox(stripOf(el));
      expect(tab.left - reach).toBeGreaterThanOrEqual(box.left);
      expect(tab.right + reach).toBeLessThanOrEqual(box.right);
    });
  });

  it("a tap's scroll lands at once, even on a strip that scrolls smoothly", async () => {
    await onPhone(urgentRight(), async (el) => {
      await expect.poll(() => edgeOf(el, "end")?.getAttribute("data-zone-state")).toBe("forgotten");
      const strip = stripOf(el);
      strip.style.scrollBehavior = "smooth";
      edgeOf(el, "end")!.click();
      const tab = tabOf(el, "z5").closest(".zone-tab")!.getBoundingClientRect();
      expect(tab.right).toBeLessThanOrEqual(paddingBox(strip).right);
    });
  });

  it("shows nothing when every tab with a state is in view", async () => {
    await onPhone([seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })], async (el) => {
      const strip = stripOf(el);
      // Hide Bar's tab first, so the empty answer below follows the observer's own reading.
      strip.scrollLeft = strip.scrollWidth;
      await expect.poll(() => edgeOf(el, "start")).not.toBeNull();
      strip.scrollLeft = 0;
      await expect.poll(() => edgeOf(el, "start")).toBeNull();
      // Upstairs lounge and the tabs after it are off the end, and plain.
      expect(edgeOf(el, "end")).toBeNull();
    });
  });

  it("shows the start edge after scrolling right", async () => {
    await onPhone([seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })], async (el) => {
      const strip = stripOf(el);
      strip.scrollLeft = strip.scrollWidth;
      await expect.poll(() => edgeOf(el, "start")).not.toBeNull();
      const edge = edgeOf(el, "start")!;
      expect(edge.getAttribute("data-zone-state")).toBe("ready");
      expect(edge.querySelector('wt-icon[name="floor-ready"]')).not.toBeNull();
      expect(edge.textContent).toContain("‹");
      expect(edge.getAttribute("aria-label")).toBe("Show Bar");
      expect(strip.previousElementSibling).toBe(edge);
      expect(edgeOf(el, "end")).toBeNull();
    });
  });

  it("is a tap tall and named Show <zone>", async () => {
    await onPhone(urgentRight(), async (el, host) => {
      await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
      const tap = tapProbe(host, "var(--wt-tap-min)");
      expect(tap).toBeGreaterThan(0);
      const box = edgeOf(el, "end")!.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(tap);
      expect(box.width).toBeGreaterThanOrEqual(tap);
      expect(edgeOf(el, "end")!.getAttribute("aria-label")).toBe("Show Patio");
    });
  });

  it("is named in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es");
    try {
      await onPhone(urgentRight(), async (el) => {
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        expect(edgeOf(el, "end")!.getAttribute("aria-label")).toBe(
          es["floor.show_zone"].replace("{zone}", "Patio"),
        );
      });
    } finally {
      setLocale(previous);
    }
  });

  it("stays still under reduced motion", async () => {
    await onPhone(
      urgentRight(),
      async (el, host) => {
        host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        const edge = edgeOf(el, "end")!;
        expect(edge.querySelector(".pulse")).toBeNull();
        // As its tab is: a forgotten zone fills red when nothing may move.
        expect(getComputedStyle(edge).backgroundColor).toBe("rgb(4, 5, 6)");
      },
      true,
    );
  });

  it("the page does not scroll sideways", async () => {
    await onPhone(urgentRight(), async (el) => {
      await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    });
  });

  it("stops watching when the screen leaves the page, and watches again when it returns", async () => {
    await onPhone(
      [seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })],
      async (el, host) => {
        const strip = stripOf(el);
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(() => edgeOf(el, "start")).not.toBeNull();
        const disconnect = vi.spyOn(IntersectionObserver.prototype, "disconnect");
        try {
          host.removeChild(el);
          expect(disconnect).toHaveBeenCalled();
        } finally {
          disconnect.mockRestore();
        }
        host.appendChild(el);
        stripOf(el).scrollLeft = 0;
        await expect.poll(() => edgeOf(el, "start")).toBeNull();
      },
    );
  });

  it("moves a tab's mark to the start edge when one jump carries it past the strip", async () => {
    await onPhone(
      [
        seated("t1", "z1"),
        seated("t3", "z3", { readyToServe: 2 }),
        seated("t6", "z6", { timingBand: "forgotten" }),
      ],
      async (el) => {
        await expect
          .poll(() => edgeOf(el, "end")?.getAttribute("aria-label"))
          .toBe("Show Private room");
        await userEvent.click(edgeOf(el, "end")!);
        // Upstairs lounge went from beyond the end to beyond the start without ever being shown.
        await expect
          .poll(() => edgeOf(el, "start")?.getAttribute("aria-label"))
          .toBe("Show Upstairs lounge");
        // The tab asked for stays in view.
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        const tab = tabOf(el, "z6").closest(".zone-tab")!.getBoundingClientRect();
        expect(tab.right).toBeLessThanOrEqual(paddingBox(stripOf(el)).right);
        expect(edgeOf(el, "start")?.getAttribute("aria-label")).toBe("Show Upstairs lounge");
      },
    );
  });

  // Eight zones, so the strip overflows at a tablet's width too; only Patio, the last, has a state.
  const eight = [
    "Inside",
    "Upstairs lounge",
    "Garden terrace",
    "Private room",
    "Rooftop bar",
    "Wine cellar",
    "Courtyard",
    "Patio",
  ].map((name, i) => zone(`z${i + 1}`, name, i));

  const mountEight = async () =>
    mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: eight,
      tables: [seated("t1", "z1"), seated("t8", "z8", { readyToServe: 2 })],
      now,
      reducedMotion: false,
    });

  const mod = (x: number) => ((x % 1) + 1) % 1;

  it.each([390, 768])(
    "at %i px, a tab a slow swipe moves out of the strip gets its edge right",
    async (width) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 844);
      try {
        const { el, host } = await mountEight();
        const strip = stripOf(el);
        const patio = tabOf(el, "z8").closest<HTMLElement>(".zone-tab")!;
        // Patio is hidden once the strip cuts it.
        const cut = () => patio.getBoundingClientRect().right - paddingBox(strip).right;
        const label = () => edgeOf(el, "end")?.getAttribute("aria-label");
        await expect.poll(label).toBe("Show Patio");
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        // Jump to a few pixels short of the crossing before the slow steps.
        strip.scrollLeft += Math.ceil(cut()) + 3;
        await nextFrames();

        // The whole-number clientWidth misplaces the strip's end by `gap`. Pick a screen width, to
        // the sixteenth of a pixel, where it says "further out": the side on which a tab crossing
        // the strip's end reads wrongly.
        const want = 0.4;
        const base = Math.floor(host.getBoundingClientRect().width) - 1;
        const gap = () => strip.clientWidth - (paddingBox(strip).right - paddingBox(strip).left);
        let best = 0;
        let bestGap = Infinity;
        for (let k = 0; k < 16; k++) {
          host.style.width = `${base - k / 16}px`;
          const g = gap();
          if (Math.abs(g - want) < Math.abs(bestGap - want)) [best, bestGap] = [k, g];
        }
        host.style.width = `${base - best / 16}px`;
        const miss = gap();
        expect(miss).toBeGreaterThanOrEqual(0.25);

        // Widen Patio's tab by under a pixel so the whole-pixel step that crosses the end lands
        // half-way into that misplaced band.
        patio.style.paddingRight = `${mod(miss / 2 - cut())}px`;
        let crossing = cut();
        for (let i = 0; i < 40 && crossing <= 0; i++) {
          strip.scrollLeft -= 1;
          crossing = cut();
          await nextFrames();
        }
        expect(crossing).toBeGreaterThan(0);
        expect(crossing).toBeLessThan(miss);
        // Read at the crossing itself: the next scroll re-reads the strip.
        await expect.poll(label).toBe("Show Patio");
        strip.scrollLeft -= 10;
        await nextFrames();
        await expect.poll(label).toBe("Show Patio");
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  // Coming in, Patio stays hidden while any of it is under the end edge, and is shown once clear of
  // it. The first case leaves 0.15 px of Patio under the edge, which the edge's inner side read up
  // to a whole pixel, or Patio's end read to the nearest one, would call clear; the second steps
  // Patio a quarter pixel clear, which the edge's inner side read down to a whole pixel still covers.
  it.each([
    [390, 0.15, 0.2],
    [768, 0.75, 0.375],
  ])(
    "at %i px, the end edge stays while a tab swiped in is %s px under it, and goes once it is clear",
    async (width, under, fraction) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 844);
      try {
        const { el, host } = await mountEight();
        const strip = stripOf(el);
        const patio = tabOf(el, "z8").closest<HTMLElement>(".zone-tab")!;
        const label = () => edgeOf(el, "end")?.getAttribute("aria-label");
        await expect.poll(label).toBe("Show Patio");
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        // Back until the strip cuts Patio, so the end edge is drawn over it.
        strip.scrollLeft -=
          Math.ceil(paddingBox(strip).right - patio.getBoundingClientRect().right) + 30;
        await expect.poll(label).toBe("Show Patio");

        const edgeLeft = () => edgeOf(el, "end")!.getBoundingClientRect().left;
        const base = Math.floor(host.getBoundingClientRect().width) - 1;
        let best = 0;
        let bestOff = Infinity;
        for (let k = 0; k < 16; k++) {
          host.style.width = `${base - k / 16}px`;
          const off = Math.abs(mod(edgeLeft()) - fraction);
          if (off < bestOff) [best, bestOff] = [k, off];
        }
        host.style.width = `${base - best / 16}px`;
        expect(Math.abs(mod(edgeLeft()) - fraction)).toBeLessThan(0.04);

        // Widen Patio's tab by under a pixel so a whole-pixel scroll leaves `under` of it under the
        // edge, and one more pixel brings it `1 - under` clear.
        const inner = edgeLeft();
        const cut = () => patio.getBoundingClientRect().right - inner;
        patio.style.paddingRight = `${mod(under - cut())}px`;
        strip.scrollLeft += Math.round(cut() - under);
        await nextFrames();
        await el.updateComplete;
        expect(cut()).toBeCloseTo(under, 1);
        expect(label()).toBe("Show Patio");
        strip.scrollLeft += 1;
        await nextFrames();
        expect(cut()).toBeCloseTo(under - 1, 1);
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        strip.scrollLeft += 10;
        await nextFrames();
        await el.updateComplete;
        expect(edgeOf(el, "end")).toBeNull();
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  // The look's phone scene: Terrace and Bar pass off the start as the strip scrolls; Patio is last.
  const five = [
    zone("z1", "Inside", 0),
    zone("z2", "Terrace", 1),
    zone("z3", "Bar", 2),
    zone("z4", "Garden", 3),
    zone("z5", "Patio", 4),
  ];
  const fiveTables = () => [
    seated("t1", "z1"),
    seated("t2", "z2", { timingBand: "forgotten" }),
    seated("t3", "z3", { readyToServe: 2 }),
    seated("t5", "z5", { signals: [{ kind: "take_order" }] }),
  ];
  const zoneTabs = (el: TillFloorScreen) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("nav.tabs .zone-tab"),
  ];

  it("moves the tabs by exactly the scroll while an edge appears and goes", async () => {
    await onPhone(
      fiveTables(),
      async (el) => {
        const strip = stripOf(el);
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        await nextFrames();
        expect(edgeOf(el, "start")).toBeNull();
        const width = strip.getBoundingClientRect().width;
        const max = strip.scrollWidth - strip.clientWidth;
        const lefts = () => zoneTabs(el).map((tab) => tab.getBoundingClientRect().left);
        let before = lefts();
        let at = strip.scrollLeft;
        for (let to = 20; to < max + 20; to += 20) {
          strip.scrollLeft = to;
          await nextFrames();
          const moved = at - strip.scrollLeft;
          expect(Math.abs(moved + Math.min(20, max - at))).toBeLessThanOrEqual(1);
          const after = lefts();
          after.forEach((left, i) =>
            expect(Math.abs(left - before[i]! - moved)).toBeLessThanOrEqual(1),
          );
          expect(strip.getBoundingClientRect().width).toBe(width);
          [before, at] = [after, strip.scrollLeft];
        }
        // The sweep crossed both: the start edge appeared and the end edge went.
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        expect(edgeOf(el, "start")).not.toBeNull();
      },
      true,
      five,
    );
  });

  it("one scroll to the end shows the last tab whole, clear of every edge", async () => {
    await onPhone(
      fiveTables(),
      async (el) => {
        const strip = stripOf(el);
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        await nextFrames();
        const box = paddingBox(strip);
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(() => edgeOf(el, "start")).not.toBeNull();
        await nextFrames();
        await nextFrames();
        expect(paddingBox(strip)).toEqual(box);
        const patio = tabOf(el, "z5").closest(".zone-tab")!.getBoundingClientRect();
        expect(patio.left).toBeGreaterThanOrEqual(box.left);
        expect(patio.right).toBeLessThanOrEqual(box.right);
        const start = edgeOf(el, "start")!.getBoundingClientRect();
        expect(patio.left).toBeGreaterThanOrEqual(start.right);
        expect(edgeOf(el, "end")).toBeNull();
      },
      true,
      five,
    );
  });

  it("gives the edges' room back when the strip widens until its tabs fit", async () => {
    await onPhone(
      fiveTables(),
      async (el, host) => {
        const strip = stripOf(el);
        await expect.poll(() => strip.hasAttribute("data-overflows")).toBe(true);
        const patio = () => tabOf(el, "z5").closest(".zone-tab")!.getBoundingClientRect();
        const fits = () => {
          const tabs = zoneTabs(el).map((tab) => tab.getBoundingClientRect());
          return (
            tabs[tabs.length - 1]!.right -
            tabs[0]!.left +
            2 * tapProbe(host, "calc(var(--wt-space-1) * 1.5)")
          );
        };
        // Two widenings: the second leaves Patio cut as it was and every other tab whole, so no
        // tab's visibility tells the strip it has room now.
        host.style.width = `${host.getBoundingClientRect().width + patio().left - paddingBox(strip).right + 1}px`;
        await nextFrames();
        await nextFrames();
        expect(patio().left).toBeLessThan(paddingBox(strip).right);
        const room = fits() - (paddingBox(strip).right - paddingBox(strip).left);
        expect(room).toBeGreaterThan(0);
        expect(patio().right - paddingBox(strip).right).toBeGreaterThan(room + 1);
        host.style.width = `${host.getBoundingClientRect().width + room + 1}px`;
        await expect.poll(() => strip.hasAttribute("data-overflows")).toBe(false);
        expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth);
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
      },
      true,
      five,
    );
  });

  it("counts a tab inside the strip but under a shown edge as hidden", async () => {
    // Patio, Forgotten, sits just before Bar, the last tab, whose step alone puts the edge there.
    const order = [
      zone("z1", "Inside", 0),
      zone("z2", "Upstairs lounge", 1),
      zone("z3", "Garden terrace", 2),
      zone("z4", "Patio", 3),
      zone("z5", "Bar", 4),
    ];
    await onPhone(
      [
        seated("t1", "z1"),
        seated("t4", "z4", { timingBand: "forgotten" }),
        seated("t5", "z5", { signals: [{ kind: "take_order" }] }),
      ],
      async (el, host) => {
        const strip = stripOf(el);
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        await nextFrames();
        // One jump that cuts Bar and leaves Patio whole, its end where the edge's middle will be.
        const tap = tapProbe(host, "var(--wt-tap-min)");
        const patio = () => tabOf(el, "z4").closest(".zone-tab")!.getBoundingClientRect();
        strip.scrollLeft -= paddingBox(strip).right - tap / 2 - patio().right;
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        await nextFrames();
        const box = paddingBox(strip);
        expect(patio().left).toBeGreaterThanOrEqual(box.left);
        expect(patio().right).toBeLessThanOrEqual(box.right);
        await expect.poll(() => edgeOf(el, "end")?.getAttribute("aria-label")).toBe("Show Patio");
        expect(edgeOf(el, "end")!.getAttribute("data-zone-state")).toBe("forgotten");
        expect(patio().right).toBeGreaterThan(edgeOf(el, "end")!.getBoundingClientRect().left);
      },
      true,
      order,
    );
  });

  it("counts a tab under an edge that a new state draws as hidden", async () => {
    const order = [
      zone("z1", "Inside", 0),
      zone("z2", "Upstairs lounge", 1),
      zone("z3", "Garden terrace", 2),
      zone("z4", "Patio", 3),
      zone("z5", "Bar", 4),
    ];
    const tables = (bar: Partial<TableState>) => [
      seated("t1", "z1"),
      seated("t4", "z4", { timingBand: "forgotten" }),
      seated("t5", "z5", bar),
    ];
    await onPhone(
      tables({}),
      async (el, host) => {
        const strip = stripOf(el);
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(() => edgeOf(el, "end")).toBeNull();
        await nextFrames();
        const tap = tapProbe(host, "var(--wt-tap-min)");
        const patio = () => tabOf(el, "z4").closest(".zone-tab")!.getBoundingClientRect();
        strip.scrollLeft -= paddingBox(strip).right - tap / 2 - patio().right;
        await nextFrames();
        await nextFrames();
        // Bar is cut but has nothing to show, and Patio is whole: no edge yet.
        expect(edgeOf(el, "end")).toBeNull();
        expect(patio().right).toBeLessThanOrEqual(paddingBox(strip).right);
        el.tables = tables({ signals: [{ kind: "take_order" }] });
        await expect.poll(() => edgeOf(el, "end")?.getAttribute("aria-label")).toBe("Show Patio");
        expect(patio().right).toBeGreaterThan(edgeOf(el, "end")!.getBoundingClientRect().left);
      },
      true,
      order,
    );
  });

  it("brings a tab wider than the strip, cut at both ends, to its start", async () => {
    const wide = [
      zone("z1", "Inside", 0),
      zone("z2", "Upstairs private dining room and terrace", 1),
    ];
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(320, 844);
    try {
      const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
        zones: wide,
        tables: [seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })],
        now,
        reducedMotion: false,
      });
      await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
      const strip = stripOf(el);
      const tab = () => tabOf(el, "z2").closest(".zone-tab")!.getBoundingClientRect();
      const box = () => paddingBox(strip);
      expect(tab().width).toBeGreaterThan(box().right - box().left);
      strip.scrollLeft += Math.ceil(tab().left - box().left) + 10;
      await expect.poll(() => edgeOf(el, "start")).not.toBeNull();
      expect(tab().left).toBeLessThan(box().left);
      expect(tab().right).toBeGreaterThan(box().right);
      await userEvent.click(edgeOf(el, "start")!);
      const reach = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
      await expect.poll(() => tab().left - reach).toBeGreaterThanOrEqual(box().left - 1);
      expect(tab().left - reach).toBeLessThanOrEqual(box().left + 1);
      // Its start is in view now and only its end is cut, so the mark moves to the end edge.
      await expect.poll(() => edgeOf(el, "start")).toBeNull();
      expect(edgeOf(el, "end")?.getAttribute("aria-label")).toBe(
        "Show Upstairs private dining room and terrace",
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it("brings a tab wider than the strip to its start at once, even on a strip that scrolls smoothly", async () => {
    const wide = [
      zone("z1", "Inside", 0),
      zone("z2", "Upstairs private dining room and terrace", 1),
    ];
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(320, 844);
    try {
      const { el, host } = await mountWidget<TillFloorScreen>("till-floor-screen", {
        zones: wide,
        tables: [seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })],
        now,
        reducedMotion: false,
      });
      await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
      const strip = stripOf(el);
      const tab = () => tabOf(el, "z2").closest(".zone-tab")!.getBoundingClientRect();
      const box = () => paddingBox(strip);
      strip.scrollLeft += Math.ceil(tab().left - box().left) + 10;
      await expect.poll(() => edgeOf(el, "start")).not.toBeNull();
      strip.style.scrollBehavior = "smooth";
      edgeOf(el, "start")!.click();
      const reach = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
      expect(tab().left - reach).toBeGreaterThanOrEqual(box().left - 1);
      expect(tab().left - reach).toBeLessThanOrEqual(box().left + 1);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    "shows a tab too wide to clear the edges that can cover it whenever it is whole in the strip (Bar has a state: %s, nearly the strip's width: %s)",
    async (barHasState, nearlyStrip) => {
      const name = "Upstairs";
      const wide = [zone("z1", "Inside", 0), zone("z2", "Bar", 1), zone("z3", name, 2)];
      await onPhone(
        [
          seated("t1", "z1"),
          seated("t2", "z2", barHasState ? { readyToServe: 2 } : {}),
          seated("t3", "z3", { timingBand: "forgotten" }),
        ],
        async (el, host) => {
          const strip = stripOf(el);
          const tab = () => tabOf(el, "z3").closest(".zone-tab")!.getBoundingClientRect();
          const box = () => paddingBox(strip);
          const named = () =>
            (["start", "end"] as const).filter(
              (side) => edgeOf(el, side)?.getAttribute("aria-label") === `Show ${name}`,
            );
          // Narrower than the strip, but too wide to clear even the one edge over it.
          const clear = tapProbe(host, "calc(var(--wt-tap-min) + var(--wt-space-1) * 1.5)");
          const ring = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
          await sizeTab(strip, tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!, (span) =>
            nearlyStrip ? span - 4.5 : (span - clear - ring + span - 4) / 2,
          );
          await expect.poll(named).toEqual(["end"]);
          const span = box().right - box().left;
          expect(tab().width).toBeLessThan(span - 4);
          expect(tab().width).toBeGreaterThan(span - 2 * clear);
          expect(tab().width).toBeGreaterThan(span - clear - ring);

          await userEvent.click(edgeOf(el, "end")!);
          await expect.poll(named).toEqual([]);
          expect(tab().left).toBeGreaterThanOrEqual(box().left);
          expect(tab().right).toBeLessThanOrEqual(box().right);

          // Cut at the start, then whole just inside it, under the start edge's place.
          strip.scrollLeft = strip.scrollWidth;
          await expect.poll(named).toEqual(["start"]);
          strip.scrollLeft -= box().left + 2 - tab().left;
          await expect.poll(named).toEqual([]);
          expect(tab().left).toBeGreaterThanOrEqual(box().left);

          // Cut at the end, then whole just inside it, under the end edge's place.
          strip.scrollLeft = 0;
          await expect.poll(named).toEqual(["end"]);
          strip.scrollLeft += tab().right - (box().right - 2);
          await expect.poll(named).toEqual([]);
          expect(tab().right).toBeLessThanOrEqual(box().right);
        },
        true,
        wide,
      );
    },
  );

  it("counts a whole wide tab under the end edge as hidden when no earlier tab has a state", async () => {
    const name = "Upstairs";
    const order = [
      zone("z1", "Inside", 0),
      zone("z2", "Bar", 1),
      zone("z3", name, 2),
      zone("z4", "Patio", 3),
    ];
    await onPhone(
      [
        seated("t1", "z1"),
        seated("t3", "z3", { timingBand: "forgotten" }),
        seated("t4", "z4", { signals: [{ kind: "take_order" }] }),
      ],
      async (el, host) => {
        const strip = stripOf(el);
        const zoneTab = tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!;
        const tab = () => zoneTab.getBoundingClientRect();
        const box = () => paddingBox(strip);
        const label = () => edgeOf(el, "end")?.getAttribute("aria-label");
        // Too wide to clear both edges, narrow enough to clear the end edge alone.
        const clear = tapProbe(host, "calc(var(--wt-tap-min) + var(--wt-space-1) * 1.5)");
        const ring = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
        await sizeTab(strip, zoneTab, (span) => wideBetweenEdges(span, clear, ring));
        await expect.poll(label).toBe(`Show ${name}`);
        const span = box().right - box().left;
        expect(tab().width).toBeGreaterThan(span - 2 * clear);
        expect(tab().width).toBeLessThan(span - clear - ring);

        strip.scrollLeft += tab().right - (box().right - 2);
        await nextFrames();
        await nextFrames();
        expect(tab().left).toBeGreaterThanOrEqual(box().left);
        expect(tab().right).toBeLessThanOrEqual(box().right);
        await expect.poll(label).toBe(`Show ${name}`);
        expect(tab().right).toBeGreaterThan(edgeOf(el, "end")!.getBoundingClientRect().left);

        await userEvent.click(edgeOf(el, "end")!);
        await expect.poll(label).toBe("Show Patio");
        expect(tab().right).toBeLessThanOrEqual(edgeOf(el, "end")!.getBoundingClientRect().left);
      },
      true,
      order,
    );
  });

  it.each<["end" | "start", Partial<TableState>, Partial<TableState>]>([
    ["end", { readyToServe: 2 }, {}],
    ["start", {}, { signals: [{ kind: "take_order" }] }],
  ])(
    "shows a whole wide tab under its own %s edge when a tab beyond the other end has a state",
    async (side, bar, patio) => {
      const name = "Upstairs";
      const order = [
        zone("z1", "Inside", 0),
        zone("z2", "Bar", 1),
        zone("z3", name, 2),
        zone("z4", "Patio", 3),
      ];
      await onPhone(
        [
          seated("t1", "z1"),
          seated("t2", "z2", bar),
          seated("t3", "z3", { timingBand: "forgotten" }),
          seated("t4", "z4", patio),
        ],
        async (el, host) => {
          const strip = stripOf(el);
          const zoneTab = tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!;
          const tab = () => zoneTab.getBoundingClientRect();
          const box = () => paddingBox(strip);
          const named = () =>
            (["start", "end"] as const).filter(
              (end) => edgeOf(el, end)?.getAttribute("aria-label") === `Show ${name}`,
            );
          const clear = tapProbe(host, "calc(var(--wt-tap-min) + var(--wt-space-1) * 1.5)");
          const ring = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
          await sizeTab(strip, zoneTab, (span) => wideBetweenEdges(span, clear, ring));
          await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
          if (side === "start") strip.scrollLeft = strip.scrollWidth;
          await expect.poll(named).toEqual([side]);
          strip.scrollLeft +=
            side === "start" ? tab().left - (box().left + 2) : tab().right - (box().right - 2);
          await expect.poll(named).toEqual([]);
          expect(tab().left).toBeGreaterThanOrEqual(box().left);
          expect(tab().right).toBeLessThanOrEqual(box().right);
        },
        true,
        order,
      );
    },
  );

  it("brings a whole wide tab clear of its own start edge when that edge is tapped", async () => {
    const name = "Upstairs";
    const order = [
      zone("z1", "Inside", 0),
      zone("z2", "Bar", 1),
      zone("z3", name, 2),
      zone("z4", "Garden", 3),
    ];
    await onPhone(
      [seated("t1", "z1"), seated("t3", "z3", { timingBand: "forgotten" })],
      async (el, host) => {
        const strip = stripOf(el);
        const zoneTab = tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!;
        const tab = () => zoneTab.getBoundingClientRect();
        const box = () => paddingBox(strip);
        const label = () => edgeOf(el, "start")?.getAttribute("aria-label");
        const clear = tapProbe(host, "calc(var(--wt-tap-min) + var(--wt-space-1) * 1.5)");
        const ring = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
        await sizeTab(strip, zoneTab, (span) => wideBetweenEdges(span, clear, ring));
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        strip.scrollLeft = strip.scrollWidth;
        await expect.poll(label).toBe(`Show ${name}`);
        // Whole, but under the start edge it can clear.
        strip.scrollLeft -= box().left + 2 - tab().left;
        await nextFrames();
        await nextFrames();
        expect(tab().left).toBeGreaterThanOrEqual(box().left);
        expect(label()).toBe(`Show ${name}`);
        await userEvent.click(edgeOf(el, "start")!);
        await expect.poll(() => edgeOf(el, "start")).toBeNull();
        expect(edgeOf(el, "end")).toBeNull();
        expect(tab().right).toBeLessThanOrEqual(box().right);
      },
      true,
      order,
    );
  });

  it.each([240, 251, 265])(
    "one start-edge tap shows a %i px tab whole when a later tab has a state",
    async (width) => {
      const order = [
        zone("z1", "Inside", 0),
        zone("z2", "Bar", 1),
        zone("z3", "Up", 2),
        zone("z4", "Garden", 3),
        zone("z5", "Patio", 4),
      ];
      await onPhone(
        [
          seated("t1", "z1"),
          seated("t3", "z3", { timingBand: "forgotten" }),
          seated("t5", "z5", { signals: [{ kind: "take_order" }] }),
        ],
        async (el) => {
          const strip = stripOf(el);
          const zoneTab = tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!;
          const tab = () => zoneTab.getBoundingClientRect();
          const box = () => paddingBox(strip);
          const named = () =>
            (["start", "end"] as const).filter(
              (side) => edgeOf(el, side)?.getAttribute("aria-label") === "Show Up",
            );
          await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
          zoneTab.style.paddingRight = `${width - tab().width}px`;
          await nextFrames();
          strip.scrollLeft += tab().left - (box().left - 10);
          await expect.poll(named).toEqual(["start"]);
          expect(edgeOf(el, "end")?.getAttribute("aria-label")).toBe("Show Patio");
          await userEvent.click(edgeOf(el, "start")!);
          await expect.poll(named).toEqual([]);
          expect(tab().left).toBeGreaterThanOrEqual(box().left);
          expect(tab().right).toBeLessThanOrEqual(box().right);
        },
        true,
        order,
      );
    },
  );

  it("brings a tab within a pixel of the strip's width to its start, as one wider than the strip", async () => {
    const name = "Upstairs";
    await onPhone(
      [seated("t1", "z1"), seated("t3", "z3", { timingBand: "forgotten" })],
      async (el, host) => {
        const strip = stripOf(el);
        const zoneTab = tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!;
        const tab = () => zoneTab.getBoundingClientRect();
        const box = () => paddingBox(strip);
        const label = () => edgeOf(el, "end")?.getAttribute("aria-label");
        await sizeTab(strip, zoneTab, (span) => span - 0.5);
        await expect.poll(label).toBe(`Show ${name}`);
        expect(tab().width).toBeLessThan(box().right - box().left);
        expect(tab().width).toBeGreaterThan(box().right - box().left - 1);
        await userEvent.click(edgeOf(el, "end")!);
        const reach = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
        await expect.poll(() => tab().left - reach).toBeGreaterThanOrEqual(box().left - 1);
        expect(tab().left - reach).toBeLessThanOrEqual(box().left + 1);
        await expect.poll(label).toBe(`Show ${name}`);
      },
      true,
      [zone("z1", "Inside", 0), zone("z2", "Bar", 1), zone("z3", name, 2)],
    );
  });

  it("brings a tab wider than the strip clear of the start edge an earlier tab's state draws", async () => {
    const name = "Upstairs";
    await onPhone(
      [
        seated("t1", "z1"),
        seated("t2", "z2", { readyToServe: 2 }),
        seated("t3", "z3", { readyToServe: 2 }),
      ],
      async (el, host) => {
        const strip = stripOf(el);
        const zoneTab = tabOf(el, "z3").closest<HTMLElement>(".zone-tab")!;
        const tab = () => zoneTab.getBoundingClientRect();
        const clear = tapProbe(host, "calc(var(--wt-tap-min) + var(--wt-space-1) * 1.5)");
        await sizeTab(strip, zoneTab, (span) => span + clear);
        await expect.poll(() => edgeOf(el, "end")?.getAttribute("aria-label")).toBe(`Show ${name}`);
        expect(tab().width).toBeGreaterThan(paddingBox(strip).right - paddingBox(strip).left);
        await userEvent.click(edgeOf(el, "end")!);
        await expect.poll(() => edgeOf(el, "start")?.getAttribute("aria-label")).toBe("Show Bar");
        const reach = tapProbe(host, "calc(var(--wt-space-1) * 1.5)");
        const start = edgeOf(el, "start")!.getBoundingClientRect();
        expect(tab().left - reach).toBeGreaterThanOrEqual(start.right - 1);
        expect(tab().left - reach).toBeLessThanOrEqual(start.right + 1);
      },
      true,
      [zone("z1", "Inside", 0), zone("z2", "Bar", 1), zone("z3", name, 2)],
    );
  });

  it("stops listening to the strip's scroll and size when the screen leaves the page", async () => {
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
    try {
      await onPhone(urgentRight(), async (el, host) => {
        await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
        const strip = stripOf(el);
        const watcher = observe.mock.contexts[observe.mock.calls.findIndex(([on]) => on === strip)];
        expect(watcher).toBeDefined();
        const unlisten = vi.spyOn(strip, "removeEventListener");
        disconnect.mockClear();
        host.removeChild(el);
        expect(unlisten).toHaveBeenCalledWith("scroll", expect.any(Function));
        expect(disconnect.mock.contexts).toContain(watcher);
      });
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });

  it("watches the new tabs when the zones grow", async () => {
    await onPhone(
      [...urgentRight(), seated("t4", "z4", { readyToServe: 2 })],
      async (el) => {
        // The observer has read the four tabs before the zones grow.
        await expect
          .poll(() => edgeOf(el, "end")?.getAttribute("aria-label"))
          .toBe("Show Garden terrace");
        const observe = vi.spyOn(IntersectionObserver.prototype, "observe");
        try {
          el.zones = many;
          await el.updateComplete;
          expect(observe).toHaveBeenCalledWith(tabOf(el, "z5").closest(".zone-tab"));
          expect(observe).toHaveBeenCalledWith(tabOf(el, "z6").closest(".zone-tab"));
        } finally {
          observe.mockRestore();
        }
        await expect.poll(() => edgeOf(el, "end")?.getAttribute("aria-label")).toBe("Show Patio");
      },
      false,
      many.slice(0, 4),
    );
  });

  it("follows a change of zones", async () => {
    await onPhone(urgentRight(), async (el) => {
      await expect.poll(() => edgeOf(el, "end")).not.toBeNull();
      el.zones = many.slice(0, 2);
      await expect.poll(() => edgeOf(el, "end")).toBeNull();
      expect(el.shadowRoot!.querySelector("nav.tabs")).not.toBeNull();
      el.zones = many.slice(0, 1);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("nav.tabs")).toBeNull();
      expect(edgeOf(el, "start")).toBeNull();
      expect(edgeOf(el, "end")).toBeNull();
    });
  });
});
