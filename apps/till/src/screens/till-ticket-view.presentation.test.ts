import { afterEach, describe, expect, it } from "vitest";
import { setMediaServer } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import type { ReceiptPresentation } from "@waitron/shared";
import type { TillSaleResult } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";

const facts: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  invoiceNumber: "A/42",
  issuedAt: "2026-08-05T12:34:56.000Z",
  orderLabel: null,
  orderNumber: 42,
  total: "3.00",
  vatBreakdown: [{ rate: "10.00", base: "2.73", tax: "0.27" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "1", gross: "3.00" }],
  tender: { method: "cash", change: "2.00" },
  qr: "",
  locale: "es-ES",
};
const rich: ReceiptPresentation = {
  receiptTrim: { logo: `${"a".repeat(64)}.png` },
  venueAddress: [],
  receiptSettings: { printAddress: false },
};
const line = (text: string) => ({ kind: "text", text, indent: 0 }) as const;
const answer = (presentation: ReceiptPresentation): TillSaleResult => ({
  ...facts,
  ...presentation,
  receiptPreview: [{ kind: "logo" }, line("Filed Legal SL")],
});

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  setMediaServer("");
});

describe("per-answer receipt presentation", () => {
  it("uses the answer's immutable current logo URL and retains the earlier answer after replacement", async () => {
    const firstUrl = `/media/renditions/v1/${"b".repeat(64)}.webp/display/7500-2500-200.webp`;
    const nextUrl = `/media/renditions/v1/${"c".repeat(64)}.webp/display/5000-5000-100.webp`;
    const first = answer({ ...rich, receiptTrim: { ...rich.receiptTrim, logoUrl: firstUrl } });
    const saved = structuredClone(first);
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", { result: first });
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("img.logo")!.getAttribute("src")).toBe(
      firstUrl,
    );
    el.result = answer({ ...rich, receiptTrim: { ...rich.receiptTrim, logoUrl: nextUrl } });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("img.logo")!.getAttribute("src")).toBe(
      nextUrl,
    );
    expect(first).toEqual(saved);
    expect(el.result.receiptTrim.logo).toBe(rich.receiptTrim.logo);
    expect(el.shadowRoot!.textContent).toContain("Filed Legal SL");
  });
  it.each([
    ["the answer's logo address", `/media/renditions/v1/${"b".repeat(64)}.webp/display/1-1-1.webp`],
    ["the stored logo", undefined],
  ])("loads %s from the media server the till follows", async (_, logoUrl) => {
    const path = logoUrl ?? `/media/${rich.receiptTrim.logo}`;
    const logo = (el: TillTicketView) =>
      el.shadowRoot!.querySelector<HTMLImageElement>("img.logo")!.getAttribute("src");
    setMediaServer("https://spare.deli.test");
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: answer({ ...rich, receiptTrim: { ...rich.receiptTrim, logoUrl } }),
    });
    expect(logo(el)).toBe(`https://spare.deli.test${path}`);
    setMediaServer("https://main.deli.test");
    await el.updateComplete;
    expect(logo(el)).toBe(`https://main.deli.test${path}`);
    const parent = el.parentElement!;
    el.remove();
    setMediaServer("https://third.deli.test");
    parent.append(el);
    await el.updateComplete;
    expect(logo(el)).toBe(`https://third.deli.test${path}`);
  });
  it("replaces the supplied trim and clears it when the next answer omits it", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: {
        ...answer(rich),
        receiptPreview: [{ kind: "logo" }, line("Terraza"), line("Hasta pronto")],
      },
    });
    const article = () => el.shadowRoot!.querySelector("article")!;
    const lines = () => [...article().querySelectorAll("p")].map((row) => row.textContent!.trim());
    expect(article().textContent).toContain("Terraza");
    el.result = { ...facts, receiptPreview: [line("Comedor"), line("Gracias")] };
    await el.updateComplete;
    expect(lines()).toEqual(["Comedor", "Gracias"]);
    el.result = { ...facts, receiptPreview: [line("Filed Legal SL")] };
    await el.updateComplete;
    expect(lines()).toEqual(["Filed Legal SL"]);
    expect(article().querySelector("img")).toBeNull();
  });
});
