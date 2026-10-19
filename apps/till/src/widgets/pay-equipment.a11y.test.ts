import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, type Theme } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./pay-equipment.js";
import type { TillPayEquipment } from "./pay-equipment.js";
import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es"));

function item(id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name, portable: true, available: true, busy: false, heldBy: null, ...extra };
}

const L1 = item("r1", "Lector 1", { provider: "sumup" });
const L2 = item("r2", "Lector 2", { provider: "sumup" });
const L3 = item("r3", "Lector 3", { provider: "sumup", busy: true });
const HELD = item("r4", "Lector 4", {
  provider: "sumup",
  heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: "Marc" },
});
const BARRA = item("p1", "Barra", { portable: false });

function role(name: RoleEquipment["role"], overrides: Partial<RoleEquipment> = {}): RoleEquipment {
  return {
    role: name,
    selection: "default",
    chosenId: null,
    resolved: null,
    chosen: null,
    default: null,
    choices: [],
    ...overrides,
  };
}

const equipment: DeviceEquipment = {
  roles: [
    role("receipt", {
      default: BARRA,
      resolved: { id: "p1", name: "Barra", available: true },
      choices: [BARRA],
    }),
    role("payment_slip"),
    role("cash_drawer"),
    role("invoice"),
    role("card_terminal", {
      selection: "item",
      chosenId: "r2",
      chosen: L2,
      resolved: { id: "r2", name: "Lector 2", available: true, provider: "sumup" },
      choices: [L2, L1, L3, HELD],
    }),
  ],
};

async function mount(theme: Theme, props: Partial<TillPayEquipment> = {}) {
  return mountWidget<TillPayEquipment>(
    "till-pay-equipment",
    { equipment, canScan: true, askNfc: true, cardRequired: true, ...props },
    theme,
  );
}

async function ask(el: TillPayEquipment): Promise<void> {
  const box = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="cardReaderId"]')!;
  await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  const option = [...box.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find((each) =>
    each.textContent!.trim().startsWith("Lector 4"),
  )!;
  await userEvent.click(option);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-pay-take-title]")).not.toBeNull();
}

describe.each(["light", "dark"] as const)("till-pay-equipment a11y (%s theme)", (theme) => {
  it("closed has no violations", async () => {
    const { host } = await mount(theme);
    await expectNoA11yViolations(host);
  });

  it("opened has no violations", async () => {
    const { host } = await mount(theme, { open: true });
    await expectNoA11yViolations(host);
  });

  it("the takeover question has no violations", async () => {
    const { el, host } = await mount(theme, { open: true });
    await ask(el);
    await expectNoA11yViolations(host);
  });

  it("saving has no violations", async () => {
    const { host } = await mount(theme, {
      open: true,
      saving: { role: "card_terminal", id: "r1" },
    });
    await expectNoA11yViolations(host);
  });

  it("a refusal and a reason have no violations", async () => {
    const { host } = await mount(theme, {
      open: true,
      fieldErrors: { card_terminal: "Ese lector está ocupado" },
      readerReason: "Móvil 2 (Marc) se ha llevado Lector 2",
    });
    await expectNoA11yViolations(host);
  });

  it.each([
    [false, 390],
    [false, 1280],
    [true, 390],
    [true, 1280],
  ] as const)("LOOK: opened %s at %i px", async (open, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el, host } = await mount(theme, {
        open,
        equipment: open
          ? equipment
          : {
              roles: equipment.roles.map((each) =>
                each.role === "card_terminal"
                  ? {
                      ...each,
                      resolved: {
                        id: "r9",
                        name: "Lector de tarjetas de la terraza oeste 2",
                        available: true,
                        provider: "sumup",
                      },
                    }
                  : each,
              ),
            },
      });
      if (open) await ask(el);
      const row = el.shadowRoot!.querySelector("[data-pay-equipment]")!;
      console.info(
        `look ${theme} ${open ? "opened" : "closed"}: innerWidth ${window.innerWidth}, row ${row.getBoundingClientRect().width}px, background ${getComputedStyle(row).backgroundColor}`,
      );
      await page.screenshot({
        element: host,
        path: `__screenshots__/look/a796-pay-equipment-${open ? "opened" : "closed"}-${theme}-${width}.png`,
      });
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});

it("the row's background differs between the themes", async () => {
  const backgrounds: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    const { el } = await mount(theme);
    backgrounds.push(
      getComputedStyle(el.shadowRoot!.querySelector("[data-pay-equipment]")!).backgroundColor,
    );
  }
  console.info(`row backgrounds: ${backgrounds.join(" / ")}`);
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});
