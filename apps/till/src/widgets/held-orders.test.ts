import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillHeldOrders } from "./held-orders.js";
import type { HeldOrderSummary } from "../api/client.js";

const mesa: HeldOrderSummary = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  itemCount: 2,
  total: "3.00",
  openedAt: "2026-08-05T10:00:00.000Z",
};

const barra: HeldOrderSummary = {
  id: "wo-2",
  orderNumber: 6,
  label: null,
  itemCount: 1,
  total: "1.50",
  openedAt: "2026-08-05T10:05:00.000Z",
};

afterEach(cleanupWidgets);

describe("till-held-orders", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-held-orders")).toBe(TillHeldOrders);
  });

  it("shows the empty placeholder when there are no parked orders", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [] });
    expect(el.shadowRoot!.querySelectorAll(".order")).toHaveLength(0);
    expect(el.shadowRoot!.textContent).toContain(t("held.empty"));
  });

  it("shows the section title", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [] });
    expect(el.shadowRoot!.textContent).toContain(t("held.title"));
  });

  it("renders one row per parked order with its number, label, item count and total", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    const rows = el.shadowRoot!.querySelectorAll(".order");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("5");
    expect(rows[0]!.textContent).toContain("Mesa 4");
    expect(rows[0]!.textContent).toContain("2");
    expect(rows[0]!.textContent).toContain(formatMoney("3.00"));
  });

  it("renders an unlabelled order (label null) without crashing", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [barra] });
    const rows = el.shadowRoot!.querySelectorAll(".order");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("6");
    expect(rows[0]!.textContent).toContain(formatMoney("1.50"));
  });

  it("a Retrieve control emits a composed retrieve-order carrying its own id", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    let captured: CustomEvent<{ id: string }> | undefined;
    el.addEventListener("retrieve-order", (event) => {
      captured = event as CustomEvent<{ id: string }>;
    });
    el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.retrieve")[1]!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.detail).toEqual({ id: "wo-2" });
  });

  it("a Discard control emits a composed discard-order carrying its own id", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    let captured: CustomEvent<{ id: string }> | undefined;
    el.addEventListener("discard-order", (event) => {
      captured = event as CustomEvent<{ id: string }>;
    });
    el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.discard")[0]!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.detail).toEqual({ id: "wo-1" });
  });

  it("labels its Retrieve/Discard controls with the localised actions", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa] });
    expect(el.shadowRoot!.querySelector("wt-button.retrieve")!.textContent).toContain(
      t("held.retrieve"),
    );
    expect(el.shadowRoot!.querySelector("wt-button.discard")!.textContent).toContain(
      t("held.discard"),
    );
  });

  it("gives each Retrieve/Discard control an order-specific accessible name", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    const retrieves = el.shadowRoot!.querySelectorAll("wt-button.retrieve");
    const discards = el.shadowRoot!.querySelectorAll("wt-button.discard");
    // a labelled order names both its number and its label, so a screen reader can tell rows apart
    expect(retrieves[0]!.getAttribute("aria-label")).toBe(`${t("held.retrieve")} #5 Mesa 4`);
    expect(discards[0]!.getAttribute("aria-label")).toBe(`${t("held.discard")} #5 Mesa 4`);
    // an unlabelled order names only its number
    expect(retrieves[1]!.getAttribute("aria-label")).toBe(`${t("held.retrieve")} #6`);
    expect(discards[1]!.getAttribute("aria-label")).toBe(`${t("held.discard")} #6`);
  });
});
