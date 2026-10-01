import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillUnpaidDepartures } from "./unpaid-departures.js";
import type { UnpaidDeparture } from "../api/client.js";

const approved: UnpaidDeparture = {
  id: "ud-1",
  workingOrderId: "wo-1",
  billLabel: "Ana",
  tableLabels: ["Terraza 3", "Terraza 4"],
  saleId: "s-1",
  invoiceNumber: "F-0007",
  amount: "30.00",
  reason: "Left while we cleared the terrace",
  recordedByName: "Marta",
  authorizedByName: "Luis",
  recordedAt: "2026-10-01T21:30:00.000Z",
};

const ownRecord: UnpaidDeparture = {
  ...approved,
  id: "ud-2",
  workingOrderId: "wo-2",
  billLabel: null,
  tableLabels: ["Mesa 9"],
  invoiceNumber: "F-0008",
  amount: "12.50",
  reason: "Ran off",
  recordedByName: "Luis",
  authorizedByName: "Luis",
};

const at = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

const rowOf = (el: TillUnpaidDepartures, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-departure="${id}"]`)!;
const text = (row: HTMLElement, field: string) =>
  row
    .querySelector(`[data-departure-${field}]`)
    ?.textContent?.replace(/[ \n\t]+/g, " ")
    .trim();

describe("till-unpaid-departures", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-unpaid-departures")).toBe(TillUnpaidDepartures);
  });

  it("renders nothing at all when nobody has left without paying", async () => {
    const { el } = await mountWidget<TillUnpaidDepartures>("till-unpaid-departures", {
      departures: [],
    });
    expect(el.shadowRoot!.textContent!.trim()).toBe("");
    expect(el.shadowRoot!.querySelector("h2")).toBeNull();
  });

  it("titles the list and shows each departure's table, bill, invoice, amount, reason, who and when", async () => {
    setLocale("en");
    const { el } = await mountWidget<TillUnpaidDepartures>("till-unpaid-departures", {
      departures: [approved, ownRecord],
    });

    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("departures.title"));
    const row = rowOf(el, "ud-1");
    expect(text(row, "tables")).toBe("Terraza 3, 4");
    expect(text(row, "bill")).toBe("Ana");
    expect(text(row, "invoice")).toBe("Invoice F-0007");
    expect(text(row, "amount")).toBe(formatMoney("30.00", "en"));
    expect(text(row, "reason")).toBe("Left while we cleared the terrace");
    expect(text(row, "who")).toBe("Recorded by Marta, approved by Luis");
    expect(text(row, "when")).toBe(at(approved.recordedAt, "en"));
  });

  it("names a single table by its label, leaves out a bill with no label, and says nothing of approval when the recorder approved it", async () => {
    const { el } = await mountWidget<TillUnpaidDepartures>("till-unpaid-departures", {
      departures: [ownRecord],
    });
    const row = rowOf(el, "ud-2");
    expect(text(row, "tables")).toBe("Mesa 9");
    expect(row.querySelector("[data-departure-bill]")).toBeNull();
    expect(text(row, "who")).toBe("Recorded by Luis");
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const { el } = await mountWidget<TillUnpaidDepartures>("till-unpaid-departures", {
      departures: [approved],
    });
    const row = rowOf(el, "ud-1");
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Se fueron sin pagar");
    expect(text(row, "tables")).toBe("Terraza 3, 4");
    expect(text(row, "invoice")).toBe("Factura F-0007");
    expect(text(row, "amount")).toBe(formatMoney("30.00", "es"));
    expect(text(row, "who")).toBe("Registrado por Marta, autorizado por Luis");
    expect(text(row, "when")).toBe(at(approved.recordedAt, "es"));
  });

  it("offers no action: collecting the debt is not done from here", async () => {
    const { el } = await mountWidget<TillUnpaidDepartures>("till-unpaid-departures", {
      departures: [approved],
    });
    expect(el.shadowRoot!.querySelector("wt-button, button")).toBeNull();
  });
});
