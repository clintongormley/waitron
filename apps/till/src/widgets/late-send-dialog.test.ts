import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { TillLateSendDialog } from "./late-send-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const dishes = [
  { quantity: "2.000", name: "Omelette", unitName: null },
  { quantity: "1.000", name: "Steak", unitName: { en: "each" }, soldInEach: true },
];

async function mount(props: Partial<TillLateSendDialog>, locale = "en-GB") {
  setLocale(locale);
  const mounted = await mountWidget<TillLateSendDialog>("till-late-send-dialog", props);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return mounted;
}

const words = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

const dialog = (el: TillLateSendDialog) => el.shadowRoot!.querySelector("wt-dialog")!;

const rows = (el: TillLateSendDialog) =>
  [...el.shadowRoot!.querySelectorAll("li")].map((row) => words(row));

const button = (el: TillLateSendDialog, name: "remove" | "agreed") =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-late-${name}]`)!;

function captured(host: HTMLElement) {
  const seen = { removed: 0, agreed: 0, cancelled: 0 };
  const shapes: { type: string; bubbles: boolean; composed: boolean }[] = [];
  const count = (key: keyof typeof seen) => (event: Event) => {
    seen[key]++;
    shapes.push({ type: event.type, bubbles: event.bubbles, composed: event.composed });
  };
  host.addEventListener("wt-late-send-removed", count("removed"));
  host.addEventListener("wt-late-send-agreed", count("agreed"));
  host.addEventListener("wt-late-send-cancelled", count("cancelled"));
  return { seen, shapes };
}

describe("till-late-send-dialog", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-late-send-dialog")).toBe(TillLateSendDialog);
  });

  it("names the ended period and lists each dish to check, in order", async () => {
    const { el } = await mount({ dishes, periodNames: ["Lunch"], purpose: "send" });
    expect(dialog(el).heading).toBe("Lunch has ended");
    expect(words(el.shadowRoot!.querySelector("p"))).toBe("Check with the kitchen before sending:");
    expect(rows(el)).toEqual(["2× Omelette", "1× Steak"]);
    expect(words(button(el, "remove"))).toBe("Remove them");
    expect(button(el, "remove").getAttribute("variant")).toBe("secondary");
    expect(words(button(el, "agreed"))).toBe("Kitchen agreed — send");
    expect(button(el, "agreed").getAttribute("variant")).toBe("primary");
  });

  it("puts Remove them before Kitchen agreed in the footer", async () => {
    const { el } = await mount({ dishes, periodNames: ["Lunch"], purpose: "send" });
    const footer = [...el.shadowRoot!.querySelectorAll('[slot="footer"]')];
    expect(footer).toEqual([button(el, "remove"), button(el, "agreed")]);
  });

  it("joins two ended periods in one heading", async () => {
    const { el } = await mount({ dishes, periodNames: ["Breakfast", "Lunch"], purpose: "send" });
    expect(dialog(el).heading).toBe("Breakfast and Lunch have ended");
  });

  it("joins two ended periods in Spanish", async () => {
    const { el } = await mount(
      { dishes, periodNames: ["Breakfast", "Lunch"], purpose: "send" },
      "es-ES",
    );
    expect(dialog(el).heading).toBe("Han terminado Breakfast y Lunch");
    expect(words(el.shadowRoot!.querySelector("p"))).toBe(
      "Consulta con la cocina antes de enviar:",
    );
  });

  it("says save on a Park, which stores the order without sending it", async () => {
    const { el } = await mount({ dishes, periodNames: ["Lunch"], purpose: "save" });
    expect(words(button(el, "agreed"))).toBe("Kitchen agreed — save");
  });

  it("shows a dish sold by weight with its unit", async () => {
    const { el } = await mount({
      dishes: [{ quantity: "0.320", name: "Ham", unitName: { en: "kg" }, soldInEach: false }],
      periodNames: ["Lunch"],
      purpose: "send",
    });
    expect(rows(el)).toEqual(["0.32 kg× Ham"]);
  });

  it("sends each button's event once, as a bubbling, composed event", async () => {
    const { el, host } = await mount({ dishes, periodNames: ["Lunch"], purpose: "send" });
    const { seen, shapes } = captured(host);
    button(el, "remove").click();
    expect(seen).toEqual({ removed: 1, agreed: 0, cancelled: 0 });
    button(el, "agreed").click();
    expect(seen).toEqual({ removed: 1, agreed: 1, cancelled: 0 });
    expect(shapes).toEqual([
      { type: "wt-late-send-removed", bubbles: true, composed: true },
      { type: "wt-late-send-agreed", bubbles: true, composed: true },
    ]);
  });

  it("cancels on Escape and keeps the dialog's own close event inside", async () => {
    const { el, host } = await mount({ dishes, periodNames: ["Lunch"], purpose: "send" });
    const { seen, shapes } = captured(host);
    const leaked = vi.fn();
    host.addEventListener("wt-close", leaked);
    const closed = new Promise((resolve) =>
      dialog(el).addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await vi.waitFor(() => expect(seen.cancelled).toBe(1));
    expect(seen).toEqual({ removed: 0, agreed: 0, cancelled: 1 });
    expect(shapes).toEqual([{ type: "wt-late-send-cancelled", bubbles: true, composed: true }]);
    expect(leaked).not.toHaveBeenCalled();
  });
});
