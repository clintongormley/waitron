import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { WtCombobox } from "@waitron/ui/src/components/wt-combobox.js";
import type { Station } from "../api/client.js";
import "./station-choice-dialog.js";
import type { TillStationChoiceDialog } from "./station-choice-dialog.js";

const stations: Station[] = [
  { id: "grill", name: "Grill", displayOrder: 0, isDefault: true, active: true, open: true },
  { id: "bar", name: "Upstairs bar", displayOrder: 1, isDefault: false, active: true, open: false },
];

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount(properties: Partial<TillStationChoiceDialog> = {}) {
  return (
    await mountWidget<TillStationChoiceDialog>("till-station-choice-dialog", {
      stations,
      dishName: "Paella",
      ...properties,
    })
  ).el;
}

const root = (el: TillStationChoiceDialog) => el.shadowRoot!;
const select = (el: TillStationChoiceDialog) =>
  root(el).querySelector<WtCombobox>('wt-combobox[name="station"]')!;
const selectLabel = (el: TillStationChoiceDialog) => select(el).label;
const options = (el: TillStationChoiceDialog) =>
  select(el).options.map((option) => [
    option.value,
    option.label,
    option.value === select(el).value,
  ]);
const displayed = (el: TillStationChoiceDialog) =>
  select(el).shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
async function choose(el: TillStationChoiceDialog, index: number): Promise<void> {
  select(el).shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await select(el).updateComplete;
  select(el).shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[index]!.click();
  await el.updateComplete;
}
const submit = (el: TillStationChoiceDialog) =>
  root(el).querySelector<HTMLButtonElement>("[data-submit]")!;

describe("till-station-choice-dialog", () => {
  it("uses the shared field primitive for station choice", async () => {
    const el = await mount();
    expect(root(el).querySelector('wt-combobox[name="station"]')).not.toBeNull();
    expect(root(el).querySelector('select[name="station"]')).toBeNull();
  });

  it("offers rules and marks a closed station when choosing where to make a dish", async () => {
    const el = await mount({ mode: "make-at" });
    expect(selectLabel(el)).toBe("Make at");
    expect(options(el)[0]).toEqual([expect.any(String), "Where the rules send it", true]);
    expect(options(el)[0]![0]).not.toBe("");
    expect(options(el).slice(1)).toEqual([
      ["grill", "Grill", false],
      ["bar", "Upstairs bar (closed)", false],
    ]);
    expect(displayed(el)).toBe("Where the rules send it");
    expect(submit(el).textContent?.trim()).toBe("Save");
    const chosen: unknown[] = [];
    el.addEventListener("station-chosen", (event) => chosen.push((event as CustomEvent).detail));
    submit(el).click();
    expect(chosen).toEqual([{ stationId: null }]);
  });

  it("marks the current station and holds Move until a different one is chosen", async () => {
    const el = await mount({ mode: "move", currentStationId: "grill" });
    expect(selectLabel(el)).toBe("Move to");
    expect(options(el)).toEqual([
      ["grill", "Grill (now)", true],
      ["bar", "Upstairs bar (closed)", false],
    ]);
    expect(displayed(el)).toBe("Grill (now)");
    expect(submit(el).disabled).toBe(true);
    await choose(el, 1);
    expect(submit(el).disabled).toBe(false);
    expect(displayed(el)).toBe("Upstairs bar (closed)");
    const chosen: unknown[] = [];
    el.addEventListener("station-chosen", (event) => chosen.push((event as CustomEvent).detail));
    submit(el).click();
    expect(chosen).toEqual([{ stationId: "bar" }]);
    el.busy = true;
    await el.updateComplete;
    expect(submit(el).disabled).toBe(true);
  });

  it("asks for a choice when the previous station is no longer listed", async () => {
    const el = await mount({ mode: "move", currentStationId: "removed" });
    expect(options(el)[0]).toEqual([expect.any(String), "Choose a station", true]);
    expect(options(el)[0]![0]).not.toBe("");
    expect(displayed(el)).toBe("Choose a station");
    expect(submit(el).disabled).toBe(true);
    await choose(el, 1);
    expect(submit(el).disabled).toBe(false);
  });

  it("speaks Spanish and emits close on Cancel", async () => {
    setLocale("es");
    const el = await mount({ mode: "move", currentStationId: "grill" });
    expect(selectLabel(el)).toBe("Pasar a");
    expect(options(el)[0]).toEqual(["grill", "Grill (ahora)", true]);
    expect(submit(el).textContent?.trim()).toBe("Pasar");
    let closed = false;
    el.addEventListener("close", () => (closed = true));
    root(el).querySelector<HTMLButtonElement>("[data-cancel]")!.click();
    expect(closed).toBe(true);
  });

  it.each([
    [
      "ticket.already_started",
      "The kitchen has started, finished or sent out this dish, so it stays where it is",
      "La cocina ya ha empezado, terminado o sacado este plato, así que se queda donde está",
    ],
    ["working_order.not_open", "This order has been discarded", "Este pedido se ha descartado"],
    [
      "working_order.already_collected",
      "This order has already been handed over",
      "Este pedido ya se ha entregado",
    ],
    [
      "tab.line_not_found",
      "This dish is no longer on this bill",
      "Este plato ya no está en esta cuenta",
    ],
    [
      "ticket.not_sent",
      "This dish has not gone to the kitchen yet",
      "Este plato aún no ha ido a cocina",
    ],
    [
      "ticket.made_here",
      "This dish is made here at the till, so it has no ticket at a station to move",
      "Este plato se prepara aquí en la caja, así que no tiene comanda en ninguna estación que pasar",
    ],
  ])("shows the move-specific refusal %s at the bottom", async (code, english, spanish) => {
    const el = await mount({ mode: "move", currentStationId: "grill", refusal: code });
    const body = root(el).querySelector("[data-body]")!;
    expect(body.lastElementChild?.textContent?.trim()).toBe(english);
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(body.lastElementChild?.textContent?.trim()).toBe(spanish);
  });

  it("uses the shared sentence for another refusal", async () => {
    const el = await mount({ mode: "move", refusal: "station.not_found" });
    expect(root(el).querySelector("[data-body]")?.lastElementChild?.textContent?.trim()).toBe(
      codeMessage("station.not_found"),
    );
  });
});
