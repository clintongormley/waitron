import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillPrepQueue } from "./prep-queue.js";
import type { PrepQueueEntry } from "../api/client.js";

const queued: PrepQueueEntry = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  state: "queued",
  queuedAt: "2026-08-06T10:00:00.000Z",
};

const preparing: PrepQueueEntry = {
  id: "wo-2",
  orderNumber: 6,
  label: null,
  state: "preparing",
  queuedAt: "2026-08-06T10:05:00.000Z",
};

const ready: PrepQueueEntry = {
  id: "wo-3",
  orderNumber: 7,
  label: "Barra",
  state: "ready",
  queuedAt: "2026-08-06T10:10:00.000Z",
};

afterEach(cleanupWidgets);

describe("till-prep-queue", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-prep-queue")).toBe(TillPrepQueue);
  });

  it("shows the section title", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [] });
    expect(el.shadowRoot!.textContent).toContain(t("prep.title"));
  });

  it("shows the empty placeholder when nothing is in prep", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [] });
    expect(el.shadowRoot!.querySelectorAll(".row")).toHaveLength(0);
    expect(el.shadowRoot!.textContent).toContain(t("prep.empty"));
  });

  it("renders one row per active entry with its number, label and localised state", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", {
      entries: [queued, preparing],
    });
    const rows = el.shadowRoot!.querySelectorAll(".row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("5");
    expect(rows[0]!.textContent).toContain("Mesa 4");
    expect(rows[0]!.textContent).toContain(t("prep.state.queued"));
    expect(rows[1]!.textContent).toContain("6");
    expect(rows[1]!.textContent).toContain(t("prep.state.preparing"));
  });

  it("renders an unlabelled entry (label null) without crashing", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [preparing] });
    const rows = el.shadowRoot!.querySelectorAll(".row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("6");
  });

  it("renders no Advance control for a collected entry (defensive — the server never sends one)", async () => {
    // `GET /api/prep-queue` excludes `collected` entries server-side, so this row never legitimately
    // arrives; the widget still renders it inertly (no successor state, no control) rather than
    // crashing on an unexpected `NEXT[state] === undefined`.
    const collected = { ...ready, id: "wo-9", state: "collected" as const };
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [collected] });
    const rows = el.shadowRoot!.querySelectorAll(".row");
    expect(rows).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("wt-button.advance")).toBeNull();
  });

  it("shows an Advance control labelled with the localised action for queued/preparing/ready", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", {
      entries: [queued, preparing, ready],
    });
    const advances = el.shadowRoot!.querySelectorAll("wt-button.advance");
    expect(advances).toHaveLength(3);
    for (const button of advances) expect(button.textContent).toContain(t("prep.advance"));
  });

  it("gives each Advance control an order-specific accessible name", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [queued] });
    const advance = el.shadowRoot!.querySelector("wt-button.advance")!;
    expect(advance.getAttribute("aria-label")).toBe(`${t("prep.advance")} #5`);
  });

  it("an Advance tap on a queued entry emits advance-prep with { id, to: 'preparing' }", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [queued] });
    const spy = vi.fn();
    el.addEventListener("advance-prep", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.advance")!.click();
    expect(spy).toHaveBeenCalledWith({ id: "wo-1", to: "preparing" });
  });

  it("an Advance tap on a preparing entry emits advance-prep with { id, to: 'ready' }", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [preparing] });
    const spy = vi.fn();
    el.addEventListener("advance-prep", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.advance")!.click();
    expect(spy).toHaveBeenCalledWith({ id: "wo-2", to: "ready" });
  });

  it("an Advance tap on a ready entry emits advance-prep with { id, to: 'collected' } — the last advance shown", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [ready] });
    const spy = vi.fn();
    el.addEventListener("advance-prep", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.advance")!.click();
    expect(spy).toHaveBeenCalledWith({ id: "wo-3", to: "collected" });
  });

  it("the advance-prep event is composed and bubbles", async () => {
    const { el } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [queued] });
    let captured: CustomEvent | undefined;
    el.addEventListener("advance-prep", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.advance")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });
});
