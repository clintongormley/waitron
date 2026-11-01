import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { decimal, formatMoney } from "@waitron/shared";
import type { BillBalance, TabLine } from "../api/client.js";
import { currentLocale } from "../i18n/t.js";
import { paidQuantities } from "../state/bill-payment.js";
import { tabLinePortionKey } from "../state/portion-groups.js";
import { pickRows, type PickRow, type Picks } from "../state/portion-selection.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./portion-picker.js";
import type { TillPortionPicker } from "./portion-picker.js";
import type { WtButton } from "@waitron/ui";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "5.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

function balance(total: string, received: string, paidLines: BillBalance["paidLines"] = []) {
  return {
    workingOrderId: "bill-1",
    status: "open",
    total,
    received,
    reserved: "0.00",
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines,
  } satisfies BillBalance;
}

const CANAS = [line("c1", 1), line("c2", 2), line("c3", 3), line("c4", 4)];
const WEIGHED = line("w1", 9, {
  name: "Pulpo",
  productId: "pulpo",
  menuItemId: "pulpo",
  quantity: "0.350",
  priceQuantity: "0.350",
  unitPrecision: 3,
  unitPriceGross: "40.00",
});
const STEAK = line("s1", 5, {
  name: "Steak",
  productId: "steak",
  menuItemId: "steak",
  unitPriceGross: "32.00",
});

const STATES: [string, readonly TabLine[], BillBalance | null, Picks][] = [
  ["an empty list", [], null, new Set()],
  ["a grouped row, unticked", CANAS, null, new Set()],
  ["a grouped row ticked at 2 of 4", CANAS, null, new Set(["c1", "c2"])],
  ["a weighed row", [WEIGHED], null, new Set(["w1"])],
  [
    "a paid row",
    [line("k1", 1), line("k2", 2)],
    balance("10.00", "5.00", [{ lineId: "k1", lineNo: 1, paidQuantity: "1.000" }]),
    new Set(),
  ],
  ["a floor-blocked row", [...CANAS, STEAK], balance("52.00", "40.00"), new Set(["c1", "c2"])],
];

function rowsOf(lines: readonly TabLine[], paid: BillBalance | null, picks: Picks): PickRow[] {
  const keyOf = (row: TabLine) =>
    tabLinePortionKey(
      row,
      lines,
      paid === null ? null : (paidQuantities(paid).get(row.lineNo) ?? null),
    );
  return pickRows(lines, keyOf, paid, new Set(), picks);
}

const nameOf = (row: PickRow) => row.members[0]!.name ?? "";
const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const rgb = (colour: string) => colour.match(/\d+/g)!.slice(0, 3).map(Number);

function contrast(a: number[], b: number[]): number {
  const luminance = (colour: number[]) => {
    const [r, g, b] = colour.map((value) => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Every pixel painted inside `area`, read from a real screenshot of `within`. */
async function paintedIn(within: HTMLElement, area: DOMRect): Promise<number[][]> {
  // With `save: false` the screenshot comes back as the base64 string itself.
  const shot: unknown = await page.screenshot({ element: within, base64: true, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${shot as string}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const frame = within.getBoundingClientRect();
  const k = image.width / frame.width;
  const { data } = context.getImageData(
    Math.round((area.left - frame.left) * k),
    Math.round((area.top - frame.top) * k),
    Math.max(1, Math.round(area.width * k)),
    Math.max(1, Math.round(area.height * k)),
  );
  const pixels: number[][] = [];
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  return pixels;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("A803 picker a11y (%s theme)", (theme) => {
  it.each(STATES)("%s has no violations", async (_name, lines, paid, picks) => {
    const { host } = await mountWidget<TillPortionPicker>(
      "till-portion-picker",
      {
        rows: rowsOf(lines, paid, picks),
        picks,
        nameOf,
        money,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("A803 picker: −, + and each tick's row are at least --wt-tap-min", async () => {
    const picks = new Set(["c1", "c2"]);
    const { el, host } = await mountWidget<TillPortionPicker>(
      "till-portion-picker",
      { rows: rowsOf([...CANAS, STEAK], balance("52.00", "40.00"), picks), picks, nameOf, money },
      theme,
    );
    const tapMin = parseFloat(getComputedStyle(host).getPropertyValue("--wt-tap-min"));
    expect(tapMin).toBeGreaterThan(0);
    for (const selector of ['[data-pick-dec="c1"]', '[data-pick-inc="c1"]']) {
      const button = el.shadowRoot!.querySelector<WtButton>(selector)!;
      await button.updateComplete;
      const box = button.shadowRoot!.querySelector("button")!.getBoundingClientRect();
      expect(box.height, selector).toBeGreaterThanOrEqual(tapMin);
      expect(box.width, selector).toBeGreaterThanOrEqual(tapMin);
    }
    const labels = el.shadowRoot!.querySelectorAll("label");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(tapMin);
    }
  });

  // axe passed this box when the browser drew it at 1.4:1 in the light theme, so its paint is measured.
  it("A803 picker: a blocked row's tick stands out from the page at 3:1", async () => {
    const { el, host } = await mountWidget<TillPortionPicker>(
      "till-portion-picker",
      {
        rows: rowsOf([...CANAS, STEAK], balance("52.00", "40.00"), new Set()),
        picks: new Set(),
        nameOf,
        money,
      },
      theme,
    );
    const box = el.shadowRoot!.querySelector<HTMLInputElement>('[data-pick="s1"]')!;
    expect(box.disabled).toBe(true);
    const page_ = rgb(getComputedStyle(host).backgroundColor);
    const painted = await paintedIn(host, box.getBoundingClientRect());
    const best = Math.max(...painted.map((pixel) => contrast(pixel, page_)));
    expect(best).toBeGreaterThanOrEqual(3);
  });
});
