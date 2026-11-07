import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";
import type { FloorView } from "../state/floor-view-memory.js";

function zone(id: string, name: string): FloorZone {
  return {
    id,
    name,
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: true,
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
  };
}

function table(id: string, zoneId: string, takenOff = false): TableState {
  return {
    id,
    label: id.slice(1),
    shortName: id.slice(1),
    zoneId,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: {
      placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 0,
    },
    signals: [],
    party: null,
  };
}

// The Terrace has a table; the Bar has none.
const zones = [zone("z1", "Terrace"), zone("z2", "Bar")];
const terraceTable = table("t1", "z1");

const remembered = (view: FloorView) => ({ read: () => view, remember: () => {} });

async function mount(props: Record<string, unknown>): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables: [terraceTable],
    ...props,
  });
  return el;
}

const find = (el: TillFloorScreen, selector: string) => el.shadowRoot!.querySelector(selector);
const text = (el: TillFloorScreen, selector: string) => find(el, selector)?.textContent?.trim();

async function inLocale(locale: string, run: () => Promise<void>): Promise<void> {
  const previous = currentLocale();
  setLocale(locale);
  try {
    await run();
  } finally {
    setLocale(previous);
  }
}

afterEach(cleanupWidgets);

describe("till-floor-screen: an empty floor says why", () => {
  for (const [locale, strings] of [
    ["en", en],
    ["es", es],
  ] as const) {
    for (const view of ["list", "map"] as const) {
      it(`a read zone with no tables says so, in ${locale}, remembered ${view}`, async () => {
        await inLocale(locale, async () => {
          const el = await mount({
            selectedZoneId: "z2",
            tablesAnswered: true,
            viewMemory: remembered(view),
          });
          expect(text(el, "[data-floor-no-tables]")).toBe(strings["floor.no_tables"]);
          expect(find(el, "[data-floor-no-tables]")!.getAttribute("role")).toBe("status");
          expect(find(el, "wt-floor-map")).toBeNull();
          expect(find(el, ".grid")).toBeNull();
          expect(find(el, "[data-floor-read-failed]")).toBeNull();
        });
      });

      it(`a zone whose tables are all off today's plan says so, in ${locale}, remembered ${view}`, async () => {
        await inLocale(locale, async () => {
          const el = await mount({
            tables: [terraceTable, table("t2", "z2", true), table("t3", "z2", true)],
            selectedZoneId: "z2",
            tablesAnswered: true,
            viewMemory: remembered(view),
          });
          expect(text(el, "[data-floor-no-tables]")).toBe(strings["floor.no_tables_today"]);
          expect(find(el, "wt-floor-map")).toBeNull();
          expect(find(el, ".grid")).toBeNull();
        });
      });

      it(`a failed read says so with a Retry, in ${locale}, remembered ${view}`, async () => {
        await inLocale(locale, async () => {
          const el = await mount({
            tables: [],
            floorReadFailed: true,
            viewMemory: remembered(view),
          });
          expect(text(el, "[data-floor-read-failed]")).toBe(strings["floor.read_failed"]);
          expect(find(el, "[data-floor-read-failed]")!.getAttribute("role")).toBe("status");
          const retry = find(el, "wt-button[data-floor-retry]")!;
          expect(retry.textContent!.trim()).toBe(strings["find_page.retry"]);
          expect(retry.getAttribute("variant")).toBe("secondary");
          expect(find(el, "wt-floor-map")).toBeNull();
          expect(find(el, ".grid")).toBeNull();
          expect(find(el, "[data-floor-no-tables]")).toBeNull();
        });
      });
    }
  }

  it("Retry asks for the tables and the zones again", async () => {
    const el = await mount({ tables: [], floorReadFailed: true });
    const asked: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => asked.push((event as CustomEvent).detail));
    (find(el, "[data-floor-retry]") as HTMLElement).click();
    expect(asked).toEqual([{ zones: true }]);
  });

  it("with no zone to show, a failed read is said even though tables were answered", async () => {
    const el = await mount({ zones: [], tables: [], tablesAnswered: true, floorReadFailed: true });
    expect(text(el, "[data-floor-read-failed]")).toBe(en["floor.read_failed"]);
    expect(find(el, "[data-floor-no-tables]")).toBeNull();
  });

  it("says nothing while a read is still out, and draws the floor as before", async () => {
    const el = await mount({ selectedZoneId: "z2", viewMemory: remembered("map") });
    expect(find(el, "wt-floor-map")).not.toBeNull();
    expect(find(el, "[data-floor-no-tables]")).toBeNull();
    expect(find(el, "[data-floor-read-failed]")).toBeNull();
  });

  it("a zone with tables to draw draws them, whatever the flags say", async () => {
    const el = await mount({
      selectedZoneId: "z1",
      tablesAnswered: true,
      floorReadFailed: true,
      viewMemory: remembered("map"),
    });
    expect(find(el, "wt-floor-map")).not.toBeNull();
    expect(find(el, "[data-floor-no-tables]")).toBeNull();
    expect(find(el, "[data-floor-read-failed]")).toBeNull();
  });
});
