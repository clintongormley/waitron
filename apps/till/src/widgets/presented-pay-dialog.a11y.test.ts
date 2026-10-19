import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./presented-pay-dialog.js";
import type { TillPresentedPayDialog } from "./presented-pay-dialog.js";
import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const item = (id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem => ({
  id,
  name,
  portable: false,
  available: true,
  busy: false,
  heldBy: null,
  ...extra,
});
const LECTOR_2 = item("r2", "Lector 2", { portable: true, provider: "sumup" });
const BARRA = item("p1", "Barra");
const role = (name: RoleEquipment["role"], chosen: EquipmentItem): RoleEquipment => ({
  role: name,
  selection: "item",
  chosenId: chosen.id,
  resolved: { id: chosen.id, name: chosen.name, available: true, provider: chosen.provider },
  chosen,
  default: null,
  choices: [chosen],
});
const equipment: DeviceEquipment = {
  roles: [role("receipt", BARRA), role("card_terminal", LECTOR_2)],
};

const pressed = async (el: TillPresentedPayDialog, selector: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
};

const backgrounds = new Map<string, string>();

describe.each(["light", "dark"] as const)("till-presented-pay-dialog a11y (%s theme)", (theme) => {
  const mount = (over: Partial<TillPresentedPayDialog> = {}) =>
    mountWidget<TillPresentedPayDialog>(
      "till-presented-pay-dialog",
      {
        open: true,
        amount: "62.40",
        tableName: "Mesa 4",
        takesReaderCard: true,
        takesCash: true,
        takesManualCard: true,
        canScan: true,
        equipment,
        ...over,
      },
      theme,
    );

  it("has no violations by card on the reader the row names", async () => {
    const { host } = await mount();
    await expectNoA11yViolations(host);
  });

  it("has no violations in cash with the field marked after an empty submission", async () => {
    const { el, host } = await mount();
    await pressed(el, 'input[name="method"][value="cash"]');
    await pressed(el, "[data-presented-pay-take]");
    await expectNoA11yViolations(host);
  });

  it("has no violations with no reader and the row opened", async () => {
    const { el, host } = await mount({ equipment: { roles: [role("receipt", BARRA)] } });
    const row = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "till-pay-equipment",
    )!;
    expect(row.open).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations on Otro datáfono with the guests field and a refusal above the action", async () => {
    const { el, host } = await mount({
      asksGuests: true,
      receiptGuests: 4,
      refusal: { code: "order.payment_in_flight" },
    });
    await pressed(el, 'input[name="method"][value="manual"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations with no method offered", async () => {
    const { host } = await mount({
      takesReaderCard: false,
      takesCash: false,
      takesManualCard: false,
    });
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])("looks right at %i px", async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await mount();
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      backgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") {
        const light = backgrounds.get(`light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-presented-${theme}-${width}`;
      await page.screenshot({ element: panel, path: `${shot}.png` });
      const box = panel.getBoundingClientRect();
      const action = el.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]")!;
      const pressedBox = action.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          actionRight: box.right - pressedBox.right,
          actionText: action.textContent!.replace(/\s+/g, " ").trim(),
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});
