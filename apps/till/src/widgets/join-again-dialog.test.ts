import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TableState, TableToday } from "../api/client.js";
import type { ApartReason } from "../state/floor-today.js";
import "./join-again-dialog.js";
import type { JoinAgainDetail, TillJoinAgainDialog } from "./join-again-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function today(seats: number | null, over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 0, y: 0, width: 2, height: 2, shape: "rect", rotation: 0 },
    seats,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}

function table(id: string, label: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    today: today(4),
    signals: [],
    party: null,
    ...over,
  };
}

const longTable = () =>
  table("long", "Long table", {
    today: today(2, { joined: { parts: ["c3"], splitOff: ["c4", "c5"], apart: true } }),
  });
const away = (id: string, label: string, reason: ApartReason) => ({
  table: table(id, label, { today: today(4, { splitOffFrom: "long" }) }),
  reason,
});
const apart = () => [away("c5", "Counter 5", "guests"), away("c4", "Counter 4", "food")];

async function mount(props: Partial<TillJoinAgainDialog> = {}): Promise<TillJoinAgainDialog> {
  const { el } = await mountWidget<TillJoinAgainDialog>("till-join-again-dialog", {
    joined: longTable(),
    apart: apart(),
    ...props,
  });
  return el;
}

const seatsField = (el: TillJoinAgainDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!;
const action = (el: TillJoinAgainDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-join-again-action]")!;
const cancelButton = (el: TillJoinAgainDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-join-again-cancel]")!;
const foot = (el: TillJoinAgainDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;
const lines = (el: TillJoinAgainDialog) =>
  [...el.shadowRoot!.querySelectorAll("[data-stays-apart]")].map((line) =>
    line.textContent!.replace(/\s+/g, " ").trim(),
  );

async function typeSeats(el: TillJoinAgainDialog, value: string): Promise<void> {
  const input = seatsField(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
async function press(el: TillJoinAgainDialog): Promise<void> {
  action(el).click();
  await el.updateComplete;
}
function captured(el: TillJoinAgainDialog) {
  const seen: { confirmed: JoinAgainDetail[]; cancelled: number } = { confirmed: [], cancelled: 0 };
  el.addEventListener("join-again-confirm", (event) =>
    seen.confirmed.push((event as CustomEvent<JoinAgainDetail>).detail),
  );
  el.addEventListener("join-again-cancel", () => (seen.cancelled += 1));
  return seen;
}

it("heads itself Join Long table again and says which tables stay apart and why", async () => {
  const el = await mount();
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Join Long table again");
  expect(lines(el)).toEqual([
    "Counter 5 stays apart: guests seated",
    "Counter 4 stays apart: food on its way",
  ]);
  const other = await mount({
    apart: [away("c4", "Counter 4", "clearing"), away("c5", "Counter 5", "merged")],
  });
  expect(lines(other)).toEqual([
    "Counter 4 stays apart: needs clearing",
    "Counter 5 stays apart: pushed together",
  ]);
});

it("puts a label holding a placeholder's text into its line as written", async () => {
  const el = await mount({ apart: [away("c4", "{reason} $&", "guests")] });
  expect(lines(el)).toEqual(["{reason} $& stays apart: guests seated"]);
});

it("asks Long table's seats, empty and required", async () => {
  const el = await mount();
  const seats = seatsField(el);
  expect(seats.required).toBe(true);
  expect(seats.value).toBe("");
  expect([seats.min, seats.max]).toEqual([1, 999]);
  expect(seats.label).toBe("Seats for Long table");
});

it("opens with Join again quiet and disabled", async () => {
  const el = await mount();
  expect(action(el).textContent!.trim()).toBe("Join again");
  expect([action(el).variant, action(el).disabled]).toEqual(["secondary", true]);
  expect(cancelButton(el).textContent!.trim()).toBe("Cancel");
  await typeSeats(el, "8");
  expect([action(el).variant, action(el).disabled]).toEqual(["primary", false]);
});

it("explains seats out of range beside Seats and at the foot, and keeps Join again disabled until fixed", async () => {
  const el = await mount();
  const seen = captured(el);
  await typeSeats(el, "1000");
  await press(el);
  expect(seen.confirmed).toEqual([]);
  expect(seatsField(el).error).toBe("Enter 1 to 999");
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
  expect(action(el).disabled).toBe(true);
  await typeSeats(el, "8");
  expect(seatsField(el).error).toBe("");
  expect(foot(el).error).toBe("");
  expect(action(el).disabled).toBe(false);
});

it("sends the seats", async () => {
  const el = await mount();
  const seen = captured(el);
  await typeSeats(el, "8");
  await press(el);
  expect(seen.confirmed).toEqual([{ seats: 8 }]);
});

it("shows a refusal naming Seats under Seats until the number changes", async () => {
  const el = await mount();
  await typeSeats(el, "8");
  el.refusal = { code: "joined_table.seats_required", field: "seats" };
  await el.updateComplete;
  expect(seatsField(el).error).toBe(codeMessage("joined_table.seats_required"));
  expect(foot(el).error).toBe("Correct the highlighted fields to continue.");
  expect(action(el).disabled).toBe(false);
  await typeSeats(el, "9");
  expect(seatsField(el).error).toBe("");
  expect(foot(el).error).toBe("");
});

it("shows a refusal naming no field at the foot until Join again is pressed again", async () => {
  const el = await mount();
  const seen = captured(el);
  await typeSeats(el, "8");
  el.refusal = { code: "joined_table.out_of_date" };
  await el.updateComplete;
  expect(foot(el).error).toBe(codeMessage("joined_table.out_of_date"));
  expect(seatsField(el).error).toBe("");
  expect(action(el).disabled).toBe(false);
  await typeSeats(el, "9");
  expect(foot(el).error).toBe(codeMessage("joined_table.out_of_date"));
  expect(seatsField(el).error).toBe("");
  await press(el);
  expect(seen.confirmed).toEqual([{ seats: 9 }]);
  expect(foot(el).error).toBe("");
});

it("disables Seats and both buttons, and refuses to close, while busy", async () => {
  const el = await mount();
  const seen = captured(el);
  await typeSeats(el, "8");
  el.busy = true;
  await el.updateComplete;
  expect(seatsField(el).disabled).toBe(true);
  expect(cancelButton(el).disabled).toBe(true);
  expect([action(el).variant, action(el).disabled]).toEqual(["primary", true]);
  await press(el);
  expect(seen.confirmed).toEqual([]);
  cancelButton(el).click();
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.requestClose("cancel");
  await el.updateComplete;
  expect(dialog.open).toBe(true);
  expect(seen.cancelled).toBe(0);
});

it("names its field", async () => {
  const el = await mount();
  expect(seatsField(el).name).toBe("seats");
});

it("speaks Spanish", async () => {
  setLocale("es-ES");
  const el = await mount();
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Volver a unir Long table");
  expect(lines(el)).toEqual([
    "Counter 5 sigue aparte: hay clientes",
    "Counter 4 sigue aparte: comida en camino",
  ]);
  const other = await mount({
    apart: [away("c4", "Counter 4", "clearing"), away("c5", "Counter 5", "merged")],
  });
  expect(lines(other)).toEqual([
    "Counter 4 sigue aparte: por recoger",
    "Counter 5 sigue aparte: unida a otra",
  ]);
  expect(seatsField(el).label).toBe("Plazas para Long table");
  expect(action(el).textContent!.trim()).toBe("Volver a unir");
  await typeSeats(el, "0");
  await press(el);
  expect(seatsField(el).error).toBe("Escribe de 1 a 999");
});

for (const [width, height] of [
  [1280, 720],
  [390, 844],
] as const) {
  it(`keeps one width at ${width}px, with its stays-apart lines inside the field's edge and its label whole`, async () => {
    await page.viewport(width, height);
    try {
      for (const locale of ["en", "es"] as const) {
        setLocale(locale);
        const el = await mount({
          apart: [
            away("t1", "Terrace corner table by the fountain", "guests"),
            away("t2", "Counter 4", "food"),
            away("t3", "Window table beside the old bar", "clearing"),
          ],
        });
        const window = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!;
        const label = seatsField(el).shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
        const empty = window.getBoundingClientRect().width;
        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
        const fieldRight = seatsField(el)
          .shadowRoot!.querySelector(".field")!
          .getBoundingClientRect().right;
        const shown = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-stays-apart]")];
        expect(shown).toHaveLength(3);
        for (const line of shown) {
          expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
          expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(fieldRight + 0.5);
        }
        expect(window.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await typeSeats(el, "0");
        await press(el);
        expect(seatsField(el).error).not.toBe("");
        expect(window.getBoundingClientRect().width).toBeCloseTo(empty, 0);
        cleanupWidgets();
      }
    } finally {
      await page.viewport(1280, 720);
    }
  });
}
