import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
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

/** A camera filming a plain grey frame, so the scanner shows its video. */
function blankCamera(): () => void {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext("2d")!;
  const draw = () => {
    context.fillStyle = "#888";
    context.fillRect(0, 0, 640, 480);
  };
  draw();
  const redraw = setInterval(draw, 50);
  const spy = vi
    .spyOn(navigator.mediaDevices, "getUserMedia")
    .mockResolvedValue(canvas.captureStream(20));
  return () => {
    clearInterval(redraw);
    spy.mockRestore();
  };
}

async function pressQr(el: HTMLElement & { updateComplete: Promise<unknown> }): Promise<void> {
  const row = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "till-pay-equipment",
  )!;
  await row.updateComplete;
  row.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();
  await el.updateComplete;
}

const scanBackgrounds = new Map<string, string>();
const noticeBackgrounds = new Map<string, string>();

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

  it("has no violations locked on cash sent with no answer", async () => {
    const { host } = await mount({
      confirmation: { tender: { method: "cash", amount: "70.00" }, outstanding: "62.40" },
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations locked on another machine with the guests and a refusal", async () => {
    const { host } = await mount({
      asksGuests: true,
      confirmation: {
        tender: { method: "card", amount: "62.40", externalRef: "operation-17" },
        outstanding: "62.40",
        guests: 4,
      },
      refusal: { code: "order.payment_in_flight" },
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations with a tap's notice above the row, and a refusal on the locked sheet", async () => {
    const picked = await mount({
      notice: { message: t("equipment.picked_up").replace("{item}", "Lector 3"), tone: "info" },
    });
    expect(picked.el.shadowRoot!.querySelector("[data-pay-notice]")).not.toBeNull();
    await expectNoA11yViolations(picked.host);
    cleanupWidgets();
    const locked = await mount({
      notice: { message: codeMessage("device.equipment_held"), tone: "error" },
      confirmation: { tender: { method: "cash", amount: "70.00" }, outstanding: "62.40" },
    });
    expect(locked.el.shadowRoot!.querySelector("[data-pay-notice]")).not.toBeNull();
    await expectNoA11yViolations(locked.host);
  });

  it.each([
    ["form", 390],
    ["form", 1280],
    ["locked", 390],
    ["locked", 1280],
  ] as const)("looks right with a tap's notice, %s, at %i px", async (view, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await mount(
        view === "form"
          ? {
              notice: {
                message: t("equipment.picked_up").replace("{item}", "Lector 3"),
                tone: "info",
              },
            }
          : {
              notice: { message: codeMessage("device.equipment_held"), tone: "error" },
              confirmation: { tender: { method: "cash", amount: "70.00" }, outstanding: "62.40" },
            },
      );
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      noticeBackgrounds.set(`${view}-${theme}-${width}`, background);
      if (theme === "dark") {
        const light = noticeBackgrounds.get(`${view}-light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-notice-presented-${view}-${theme}-${width}`;
      await page.screenshot({ element: panel, path: `${shot}.png` });
      const box = panel.getBoundingClientRect();
      const line = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-notice]")!;
      const shown = line.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          noticeWidth: shown.width,
          noticeRight: box.right - shown.right,
          noticeColor: getComputedStyle(line).color,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it.each([390, 1280])("looks right locked at %i px", async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await mount({
        asksGuests: true,
        confirmation: {
          tender: { method: "cash", amount: "70.00" },
          outstanding: "62.40",
          guests: 4,
        },
      });
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      backgrounds.set(`locked-${theme}-${width}`, background);
      if (theme === "dark") {
        const light = backgrounds.get(`locked-light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-presented-locked-${theme}-${width}`;
      await page.screenshot({ element: panel, path: `${shot}.png` });
      const box = panel.getBoundingClientRect();
      const action = el.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-resend]")!;
      const actionBox = action.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          actionRight: box.right - actionBox.right,
          actionLeft: actionBox.left - box.left,
          actionText: action.textContent!.replace(/\s+/g, " ").trim(),
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it("has no violations scanning a sticker in place of the form", async () => {
    const stop = blankCamera();
    try {
      const { host, el } = await mount({ canScan: true, asksGuests: true, receiptGuests: 4 });
      await pressQr(el);
      await expectNoA11yViolations(host);
    } finally {
      stop();
    }
  });

  it.each([390, 1280])("looks right scanning a sticker at %i px", async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    const stop = blankCamera();
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await mount({ canScan: true, asksGuests: true, receiptGuests: 4 });
      await pressQr(el);
      const scanner = el.shadowRoot!.querySelector<HTMLElement>("till-equipment-scanner")!;
      await expect
        .poll(() => scanner.shadowRoot!.querySelector("video")?.videoWidth ?? 0)
        .toBeGreaterThan(0);
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      scanBackgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") {
        const light = scanBackgrounds.get(`light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-scan-presented-${theme}-${width}`;
      await page.screenshot({ element: panel, path: `${shot}.png` });
      const box = panel.getBoundingClientRect();
      const back = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-scan-back]")!;
      const shown = back.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          backRight: box.right - shown.right,
          backBottom: window.innerHeight - shown.bottom,
          backText: back.textContent!.replace(/\s+/g, " ").trim(),
          background,
        }),
      );
    } finally {
      stop();
      await page.viewport(viewport.width, viewport.height);
    }
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
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-presented-${theme}-${width}.png`,
      });
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
