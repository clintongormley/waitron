import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./bill-pay-dialog.js";
import { pendingCard } from "../../test/bill-pay-fixtures.js";
import type { PayLine, PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type {
  AllocationPreview,
  BillBalance,
  BillPaymentView,
  DeviceEquipment,
  EquipmentItem,
  RoleEquipment,
} from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const balance: BillBalance = {
  workingOrderId: "wo-4",
  status: "open",
  total: "120.00",
  received: "50.00",
  reserved: "20.00",
  outstanding: "50.00",
  tips: "0.00",
  payments: [],
  paidLines: [{ lineId: "l-3", lineNo: 3, paidQuantity: "1.000" }],
};

const lines: PayLine[] = [
  { lineNo: 1, name: "Paella", quantity: "1", total: "35.00", unitTotal: null },
  { lineNo: 2, name: "Caña", quantity: "3", total: "9.00", unitTotal: "3.00" },
  { lineNo: 3, name: "Tiramisú", quantity: "1", total: "6.00", unitTotal: null },
];

const pressed = async (el: TillBillPayDialog, selector: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
};

async function typed(el: TillBillPayDialog, name: string, value: string): Promise<void> {
  const input = el
    .shadowRoot!.querySelector(`wt-input[name="${name}"]`)!
    .shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

/** Continue, answered with `preview` as the app answers it. */
async function previewed(el: TillBillPayDialog, preview: AllocationPreview): Promise<void> {
  let asked: PayRequest | undefined;
  el.addEventListener("bill-pay-preview", (event) => {
    asked = (event as CustomEvent<PayRequest>).detail;
  });
  await pressed(el, "[data-pay-continue]");
  el.asked = asked!;
  el.preview = preview;
  await el.updateComplete;
}

const lockBackgrounds = new Map<string, string>();
const askBackgrounds = new Map<string, string>();
const handheldBackgrounds = new Map<string, string>();
const nextBackgrounds = new Map<string, string>();
const uncertainBackgrounds = new Map<string, string>();
const rowBackgrounds = new Map<string, string>();
const noticeBackgrounds = new Map<string, string>();
const tableBackgrounds = new Map<string, string>();

const LECTOR_2: EquipmentItem = {
  id: "r2",
  name: "Lector 2",
  portable: true,
  available: true,
  busy: false,
  heldBy: null,
  provider: "sumup",
};
const BARRA: EquipmentItem = {
  id: "p1",
  name: "Barra",
  portable: false,
  available: true,
  busy: false,
  heldBy: null,
};
const role = (name: RoleEquipment["role"], item: EquipmentItem): RoleEquipment => ({
  role: name,
  selection: "item",
  chosenId: item.id,
  resolved: { id: item.id, name: item.name, available: true, provider: item.provider },
  chosen: item,
  default: null,
  choices: [item],
});
const equipment: DeviceEquipment = {
  roles: [role("receipt", BARRA), role("card_terminal", LECTOR_2)],
};
const shareOf3: AllocationPreview = {
  kind: "allocated",
  choice: null,
  applied: "20.80",
  tip: "0.00",
  change: null,
  charged: "20.80",
};

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

describe.each(["light", "dark"] as const)("till-bill-pay-dialog a11y (%s theme)", (theme) => {
  const mount = (over: Partial<TillBillPayDialog> = {}) =>
    mountWidget<TillBillPayDialog>(
      "till-bill-pay-dialog",
      { balance, lines, way: "items", ...over },
      theme,
    );

  it("has no violations choosing items, with the units of a line", async () => {
    const { el, host } = await mount();
    await pressed(el, 'input[name="line"][value="2"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations on a device that does not take cash", async () => {
    const { host } = await mount({ way: "contribution", takesCash: false });
    await expectNoA11yViolations(host);
  });

  it("has no violations with every field marked after an empty submission", async () => {
    const { el, host } = await mount();
    await pressed(el, "[data-pay-continue]");
    await expectNoA11yViolations(host);
  });

  it("has no violations contributing by card, with a refusal above the action", async () => {
    const { el, host } = await mount({
      way: "contribution",
      refusal: { code: "bill.nothing_outstanding" },
    });
    await pressed(el, 'input[name="method"][value="card"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations splitting equally, while the balance is read", async () => {
    const { host } = await mount({ way: "share", balance: null });
    await expectNoA11yViolations(host);
  });

  it("has no violations when every item is paid and a payment was just taken", async () => {
    const { host } = await mount({
      lines: [lines[2]!],
      taken: { change: "10.00" },
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations confirming cash, leaving part of the change as a tip that is too much", async () => {
    const { el, host } = await mount();
    await pressed(el, 'input[name="line"][value="1"]');
    await typed(el, "tendered", "50");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "35.00",
      tip: "0.00",
      change: "15.00",
      charged: null,
    });
    await pressed(el, 'input[name="leaveTip"][value="part"]');
    await typed(el, "tipAmount", "20");
    await pressed(el, "[data-pay-confirm]");
    await expectNoA11yViolations(host);
  });

  /** A cash contribution of everything left, confirmed, with the receipt's guests field shown. */
  async function payingTheRest(over: Partial<TillBillPayDialog> = {}) {
    const mounted = await mount({
      way: "contribution",
      asksGuests: true,
      receiptGuests: 4,
      ...over,
    });
    await typed(mounted.el, "amount", "50");
    await typed(mounted.el, "tendered", "50");
    await previewed(mounted.el, {
      kind: "allocated",
      choice: null,
      applied: "50.00",
      tip: "0.00",
      change: "0.00",
      charged: null,
    });
    return mounted;
  }

  it("has no violations confirming the rest of the bill with the guests field", async () => {
    const { el, host } = await payingTheRest();
    if (!el.shadowRoot!.querySelector('[name="guests"]')) throw new Error("no guests field");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the guests field empty", async () => {
    const { el, host } = await payingTheRest({ receiptGuests: null });
    if (!el.shadowRoot!.querySelector('[name="guests"]')) throw new Error("no guests field");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the guests field marked invalid", async () => {
    const { el, host } = await payingTheRest();
    const stepper =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>('[name="guests"]')!;
    await stepper.updateComplete;
    const input = stepper.shadowRoot!.querySelector("input")!;
    input.value = "1000";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    await pressed(el, "[data-pay-confirm]");
    await el.updateComplete;
    if (stepper.error === "") throw new Error("the guests field is not marked");
    await expectNoA11yViolations(host);
  });

  it("has no violations confirming a card whose amounts changed", async () => {
    const { el, host } = await mount({ way: "contribution" });
    await typed(el, "amount", "40");
    await pressed(el, 'input[name="method"][value="card"]');
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "10.00",
      change: null,
      charged: "50.00",
    });
    el.refusal = { code: "bill.allocation_changed" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations offering the steak's two choices", async () => {
    const { el, host } = await mount({
      lines: [
        ...lines,
        { lineNo: 4, name: "Chuletón", quantity: "1", total: "25.00", unitTotal: null },
      ],
      balance: { ...balance, received: "105.00", reserved: "0.00", outstanding: "15.00" },
    });
    await pressed(el, 'input[name="line"][value="4"]');
    await typed(el, "tendered", "30");
    await previewed(el, {
      kind: "choose",
      options: [
        { choice: "full_with_tip", applied: "15.00", tip: "10.00" },
        { choice: "use_pool", applied: "15.00", tip: "0.00" },
      ],
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations when a venue without tips refuses a card contribution larger than is left", async () => {
    const { el, host } = await mount({ way: "contribution", tipsEnabled: false });
    await typed(el, "amount", "50");
    await pressed(el, 'input[name="method"][value="card"]');
    el.refusal = { code: "bill.tip_not_allowed", chargeable: "30.00" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations choosing a card reader", async () => {
    const { el, host } = await mount({
      way: "contribution",
      cardReader: "stripe_terminal",
      readers: [
        { id: "r-1", name: "Barra", provider: "stripe_terminal" },
        { id: "r-2", name: "Terraza", provider: "stripe_terminal" },
      ],
      defaultReaderId: "r-1",
    });
    await pressed(el, 'input[name="method"][value="card"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations choosing the practice simulator's result", async () => {
    const { el, host } = await mount({ way: "contribution", cardReader: "simulator" });
    await pressed(el, 'input[name="method"][value="card"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations while the card reader is asked, then when it declines", async () => {
    const { el, host } = await mount({ way: "contribution", cardReader: "stripe_terminal" });
    await typed(el, "amount", "40");
    await pressed(el, 'input[name="method"][value="card"]');
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "0.00",
      change: null,
      charged: "40.00",
    });
    el.busy = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.busy = false;
    el.refusal = { code: "declined" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations when a card is still in progress at the reader", async () => {
    const { host } = await mount({
      taken: { change: null, pending: "40.00" },
      balance: { ...balance, reserved: "40.00" },
    });
    await expectNoA11yViolations(host);
  });

  /** A cash confirmation for the paella that got no answer, locked as A773-1's app locks it. */
  async function lockedConfirmation() {
    const mounted = await mount();
    await pressed(mounted.el, 'input[name="line"][value="1"]');
    await typed(mounted.el, "tendered", "40");
    await previewed(mounted.el, {
      kind: "allocated",
      choice: null,
      applied: "35.00",
      tip: "0.00",
      change: "5.00",
      charged: null,
    });
    mounted.el.confirmationLocked = true;
    mounted.el.refusal = { code: "network" };
    await mounted.el.updateComplete;
    if (!mounted.el.shadowRoot!.querySelector("[data-pay-unanswered]"))
      throw new Error("not locked");
    return mounted;
  }

  it("has no violations on a locked confirmation, and on one still waiting for the server", async () => {
    const { el, host } = await lockedConfirmation();
    await expectNoA11yViolations(host);
    el.refusal = { code: "sending" };
    el.busy = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])("looks right on a locked confirmation at %i px", async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await lockedConfirmation();
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      lockBackgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") {
        const light = lockBackgrounds.get(`light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-locked-confirmation-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-locked-confirmation-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({ innerWidth: window.innerWidth, panelWidth: box.width, background }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  /** A card contribution on a bill whose balance holds a card in progress, asked about. */
  async function askingSecondCard() {
    const mounted = await mount({
      way: "contribution",
      cardReader: "stripe_terminal",
      balance: { ...balance, payments: [pendingCard] },
    });
    await typed(mounted.el, "amount", "40");
    await pressed(mounted.el, 'input[name="method"][value="card"]');
    await pressed(mounted.el, "[data-pay-continue]");
    if (!mounted.el.shadowRoot!.querySelector("[data-pay-card-ask]"))
      throw new Error("no question");
    return mounted;
  }

  it("has no violations asking before a second card while one is in progress", async () => {
    const { host } = await askingSecondCard();
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])("looks right asking before a second card at %i px", async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await askingSecondCard();
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      askBackgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") {
        const light = askBackgrounds.get(`light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const question = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-card-ask]")!;
      question.scrollIntoView({ block: "center" });
      const shot = `__screenshots__/look/a796-second-card-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-second-card-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const asked = question.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          questionLeft: asked.left - box.left,
          questionRight: box.right - asked.right,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  const handheld = () =>
    mount({
      handheld: true,
      way: undefined,
      tableName: "Mesa 4",
      cardReader: "stripe_terminal",
      takesReaderCard: true,
      takesCash: true,
      takesManualCard: true,
    });

  it("has no violations on a handheld, the form", async () => {
    const { host } = await handheld();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a handheld whose profile takes no payments", async () => {
    const { host } = await mount({
      handheld: true,
      way: undefined,
      cardReader: "none",
      takesCash: false,
    });
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])("looks right on a handheld, the form, at %i px", async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await handheld();
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      handheldBackgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") {
        const light = handheldBackgrounds.get(`light-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-handheld-form-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-handheld-form-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const methods = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-method]")!;
      const shown = methods.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          methodsLeft: shown.left - box.left,
          methodsRight: box.right - shown.right,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  /** The first of three shares taken by card on Lector 2, as picture 8 left draws it. */
  async function nextGuest() {
    const mounted = await mount({
      handheld: true,
      way: "share",
      tableName: "Mesa 4",
      cardReader: "stripe_terminal",
      takesReaderCard: true,
      takesCash: true,
      takesManualCard: true,
      equipment,
      balance: {
        ...balance,
        total: "62.40",
        received: "0.00",
        reserved: "0.00",
        outstanding: "62.40",
      },
    });
    const { el } = mounted;
    await typed(el, "people", "3");
    await pressed(el, 'input[name="method"][value="card"]');
    await previewed(el, shareOf3);
    await pressed(el, "[data-pay-confirm]");
    el.busy = true;
    await el.updateComplete;
    el.busy = false;
    el.asked = null;
    el.preview = null;
    el.balance = {
      ...balance,
      total: "62.40",
      received: "20.80",
      reserved: "0.00",
      outstanding: "41.60",
      payments: [
        { ...pendingCard, kind: "share", shareOf: 3, applied: "20.80", state: "received" },
      ],
    };
    el.taken = { change: null, reader: "Lector 2", charged: "20.80" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-pay-next]")).not.toBeNull();
    return mounted;
  }

  it("has no violations on a handheld offering the next guest", async () => {
    const { host } = await nextGuest();
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])(
    "looks right on a handheld offering the next guest at %i px",
    async (width) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 900);
      try {
        expect(window.innerWidth).toBe(width);
        const { el } = await nextGuest();
        const panel = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector<HTMLElement>("dialog")!;
        const background = getComputedStyle(panel).backgroundColor;
        nextBackgrounds.set(`${theme}-${width}`, background);
        if (theme === "dark") {
          const light = nextBackgrounds.get(`light-${width}`);
          expect(light, "run the light case first").toBeDefined();
          expect(background).not.toBe(light);
        }
        const shot = `__screenshots__/look/a796-next-guest-${theme}-${width}`;
        await page.screenshot({
          element: panel,
          path: `__screenshots__/look/a796-next-guest-${theme}-${width}.png`,
        });
        const box = panel.getBoundingClientRect();
        const next = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-next]")!;
        const shown = next.getBoundingClientRect();
        await commands.writeFile(
          `src/widgets/${shot}.json`,
          JSON.stringify({
            innerWidth: window.innerWidth,
            panelWidth: box.width,
            nextLeft: shown.left - box.left,
            nextRight: box.right - shown.right,
            background,
          }),
        );
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  /** The first of three shares sent to Lector 2 and still at the reader, as picture 7 left
   * draws it. */
  async function uncertainCard() {
    const mounted = await nextGuest();
    const { el } = mounted;
    el.balance = {
      ...balance,
      total: "62.40",
      received: "0.00",
      reserved: "20.80",
      outstanding: "41.60",
      payments: [{ ...pendingCard, kind: "share", shareOf: 3, applied: "20.80" }],
    };
    el.taken = { change: null, pending: "20.80" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-pay-uncertain]")).not.toBeNull();
    return mounted;
  }

  it("has no violations on a handheld whose card is still at the reader", async () => {
    const { host } = await uncertainCard();
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])(
    "looks right on a handheld whose card is still at the reader at %i px",
    async (width) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 900);
      try {
        expect(window.innerWidth).toBe(width);
        const { el } = await uncertainCard();
        const panel = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector<HTMLElement>("dialog")!;
        const background = getComputedStyle(panel).backgroundColor;
        uncertainBackgrounds.set(`${theme}-${width}`, background);
        if (theme === "dark") {
          const light = uncertainBackgrounds.get(`light-${width}`);
          expect(light, "run the light case first").toBeDefined();
          expect(background).not.toBe(light);
        }
        const shot = `__screenshots__/look/a796-uncertain-card-${theme}-${width}`;
        await page.screenshot({
          element: panel,
          path: `__screenshots__/look/a796-uncertain-card-${theme}-${width}.png`,
        });
        const box = panel.getBoundingClientRect();
        const warning = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-uncertain]")!;
        const shown = warning.getBoundingClientRect();
        await commands.writeFile(
          `src/widgets/${shot}.json`,
          JSON.stringify({
            innerWidth: window.innerWidth,
            panelWidth: box.width,
            warningLeft: shown.left - box.left,
            warningRight: box.right - shown.right,
            background,
          }),
        );
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  const withRow = () =>
    mount({
      handheld: true,
      way: "share",
      tableName: "Mesa 4",
      cardReader: "stripe_terminal",
      takesReaderCard: true,
      takesCash: true,
      takesManualCard: true,
      tipsEnabled: false,
      canScan: true,
      balance: {
        ...balance,
        total: "62.40",
        received: "0.00",
        reserved: "0.00",
        outstanding: "62.40",
        paidLines: [],
      },
      equipment,
    });

  it("has no violations on a handheld confirming a card on the reader the row names", async () => {
    const { host, el } = await withRow();
    await typed(el, "people", "3");
    await previewed(el, shareOf3);
    await expectNoA11yViolations(host);
  });

  it("has no violations on a handheld with the row opened and no reader", async () => {
    const { host, el } = await mount({
      handheld: true,
      way: undefined,
      cardReader: "stripe_terminal",
      takesReaderCard: true,
      takesCash: true,
      equipment: { roles: [role("receipt", BARRA)] },
    });
    const row = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "till-pay-equipment",
    )!;
    expect(row.open).toBe(true);
    await expectNoA11yViolations(host);
  });

  it.each([
    ["form", 390],
    ["form", 1280],
    ["confirm", 390],
    ["confirm", 1280],
  ] as const)("looks right on a handheld with the row, the %s, at %i px", async (step, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await withRow();
      await typed(el, "people", "3");
      if (step === "confirm") await previewed(el, shareOf3);
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      rowBackgrounds.set(`${theme}-${step}-${width}`, background);
      if (theme === "dark") {
        const light = rowBackgrounds.get(`light-${step}-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-row-${step}-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-row-${step}-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const row = el.shadowRoot!.querySelector<HTMLElement>("till-pay-equipment")!;
      const shown = row.getBoundingClientRect();
      const action = el.shadowRoot!.querySelector<HTMLElement>(
        step === "form" ? "[data-pay-continue]" : "[data-pay-confirm]",
      )!;
      const pressed = action.getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          rowLeft: shown.left - box.left,
          rowRight: box.right - shown.right,
          actionRight: box.right - pressed.right,
          actionText: action.textContent!.replace(/\s+/g, " ").trim(),
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it.each([
    ["info", () => t("equipment.picked_up").replace("{item}", "Lector 3")],
    ["error", () => codeMessage("device.equipment_held")],
  ] as const)(
    "has no violations on a handheld confirmation with a tap's %s notice",
    async (tone, message) => {
      const { host, el } = await withRow();
      await typed(el, "people", "3");
      await previewed(el, shareOf3);
      el.notice = { message: message(), tone };
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-pay-notice]")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );

  it.each([390, 1280])(
    "looks right on a handheld confirmation with a tap's notice at %i px",
    async (width) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 900);
      try {
        expect(window.innerWidth).toBe(width);
        const { el } = await withRow();
        await typed(el, "people", "3");
        await previewed(el, shareOf3);
        el.notice = {
          message: t("equipment.picked_up").replace("{item}", "Lector 3"),
          tone: "info",
        };
        await el.updateComplete;
        const panel = el
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector<HTMLElement>("dialog")!;
        const background = getComputedStyle(panel).backgroundColor;
        noticeBackgrounds.set(`${theme}-${width}`, background);
        if (theme === "dark") {
          const light = noticeBackgrounds.get(`light-${width}`);
          expect(light, "run the light case first").toBeDefined();
          expect(background).not.toBe(light);
        }
        const shot = `__screenshots__/look/a796-notice-confirm-${theme}-${width}`;
        await page.screenshot({ element: panel, path: `${shot}.png` });
        const box = panel.getBoundingClientRect();
        const line = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-notice]")!;
        const shown = line.getBoundingClientRect();
        const row = el.shadowRoot!.querySelector<HTMLElement>("till-pay-equipment")!;
        await commands.writeFile(
          `src/widgets/${shot}.json`,
          JSON.stringify({
            innerWidth: window.innerWidth,
            panelWidth: box.width,
            noticeWidth: shown.width,
            noticeAboveRow: shown.bottom <= row.getBoundingClientRect().top,
            noticeColor: getComputedStyle(line).color,
            background,
          }),
        );
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  /** Cobrar pressed on Lector 2 and the card out at the reader; declined, the reader answered. */
  async function atTheTable(state: "waiting" | "declined") {
    const mounted = await withRow();
    const { el } = mounted;
    await typed(el, "people", "3");
    await previewed(el, shareOf3);
    await pressed(el, "[data-pay-confirm]");
    el.busy = true;
    await el.updateComplete;
    if (state === "declined") {
      el.busy = false;
      el.refusal = { code: "declined" };
      await el.updateComplete;
    }
    return mounted;
  }

  it.each(["waiting", "declined"] as const)(
    "has no violations with the card at the table, %s",
    async (state) => {
      const { host, el } = await atTheTable(state);
      expect(el.shadowRoot!.querySelector("till-card-waiting") !== null).toBe(state === "waiting");
      await expectNoA11yViolations(host);
    },
  );

  it.each([
    ["waiting", 390],
    ["waiting", 1280],
    ["declined", 390],
    ["declined", 1280],
  ] as const)("looks right with the card at the table, %s, at %i px", async (state, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el } = await atTheTable(state);
      const panel = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      tableBackgrounds.set(`${theme}-${state}-${width}`, background);
      if (theme === "dark") {
        const light = tableBackgrounds.get(`light-${state}-${width}`);
        expect(light, "run the light case first").toBeDefined();
        expect(background).not.toBe(light);
      }
      const shot = `__screenshots__/look/a796-card-at-table-${state}-${theme}-${width}`;
      await page.screenshot({ element: panel, path: `${shot}.png` });
      const box = panel.getBoundingClientRect();
      const shown = (
        state === "waiting"
          ? el.shadowRoot!.querySelector<HTMLElement>("till-card-waiting")!
          : el.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!
      ).getBoundingClientRect();
      await commands.writeFile(
        `src/widgets/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          shownLeft: shown.left - box.left,
          shownRight: box.right - shown.right,
          shownWidth: shown.width,
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
      const { host, el } = await withRow();
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
      const { el } = await withRow();
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
      const shot = `__screenshots__/look/a796-scan-bill-${theme}-${width}`;
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

  it("has no violations listing the bill's payments, one refunded, one at the reader, one declined, after a refund", async () => {
    const payment = (over: Partial<BillPaymentView>): BillPaymentView => ({
      id: "pay-1",
      submissionId: "sub-1",
      kind: "contribution",
      shareOf: null,
      method: "cash",
      entry: null,
      applied: "50.00",
      tip: "0.00",
      tendered: "50.00",
      change: "0.00",
      state: "received",
      createdAt: "2026-09-30T20:00:00.000Z",
      receivedAt: "2026-09-30T20:00:00.000Z",
      lines: [],
      refunds: [],
      ...over,
    });
    const { host } = await mount({
      refunded: { state: "pending", amount: "10.00", method: "card", terminal: false },
      balance: {
        ...balance,
        payments: [
          payment({
            refunds: [
              {
                id: "r-1",
                paymentId: "pay-1",
                submissionId: "rs-1",
                appliedAmount: "10.00",
                tipAmount: "0.00",
                reason: "Cobrado de más",
                state: "completed",
                createdAt: "2026-09-30T20:10:00.000Z",
                completedAt: "2026-09-30T20:10:00.000Z",
              },
            ],
          }),
          payment({ id: "pay-2", method: "card", tip: "5.00", tendered: null, change: null }),
          payment({ id: "pay-3", method: "card", state: "pending", tendered: null, change: null }),
          payment({ id: "pay-4", method: "card", state: "declined", tendered: null, change: null }),
        ],
      },
    });
    await expectNoA11yViolations(host);
  });
});
