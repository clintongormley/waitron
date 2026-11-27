import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import type { WtButton, WtShareList, WtStepper, WtTopBar } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./split-equally.js";
import type { SplitEquallyStartDetail, TillSplitEqually } from "./split-equally.js";

const originalLocale = currentLocale();

beforeEach(() => setLocale("en"));

afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const mount = (props: Partial<TillSplitEqually>) =>
  mountWidget<TillSplitEqually>("till-split-equally", {
    billName: "Bill 1",
    left: "73.30",
    ...props,
  }).then(({ el }) => el);

const root = (el: TillSplitEqually) => el.shadowRoot!;
const stepper = (el: TillSplitEqually) => root(el).querySelector<WtStepper>("wt-stepper")!;
const topBar = (el: TillSplitEqually) => root(el).querySelector<WtTopBar>("wt-top-bar")!;
const rows = (el: TillSplitEqually) =>
  root(el)
    .querySelector<WtShareList>("wt-share-list")!
    .shares.map(({ name, detail, amount, state }) => [name, detail, amount, state]);
const amounts = (el: TillSplitEqually) => rows(el).map(([, , amount]) => amount);
const note = (el: TillSplitEqually) => root(el).querySelector("[data-split-note]");
const startButton = (el: TillSplitEqually) =>
  root(el).querySelector<WtButton>("wt-button[data-split-start]")!;
const stepButton = (el: TillSplitEqually, step: -1 | 1) =>
  stepper(el).shadowRoot!.querySelector<HTMLButtonElement>(`button[data-step="${step}"]`)!;

function deepActive(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

async function press(el: TillSplitEqually, step: -1 | 1): Promise<void> {
  stepButton(el, step).click();
  await el.updateComplete;
  await stepper(el).updateComplete;
}

describe("till-split-equally", () => {
  it("divides what is left among the guests, the first a cent more", async () => {
    const el = await mount({ startCount: 3 });
    expect(rows(el)).toEqual([
      ["Guest 1", "to pay", "€24.44", "due"],
      ["Guest 2", "to pay", "€24.43", "due"],
      ["Guest 3", "to pay", "€24.43", "due"],
    ]);
    expect(stepper(el).value).toBe(3);
  });

  it("divides among 2 and 7", async () => {
    expect(amounts(await mount({ startCount: 2 }))).toEqual(["€36.65", "€36.65"]);
    expect(amounts(await mount({ startCount: 7 }))).toEqual([
      "€10.48",
      "€10.47",
      "€10.47",
      "€10.47",
      "€10.47",
      "€10.47",
      "€10.47",
    ]);
  });

  it("shares again at once on − and +", async () => {
    const el = await mount({ startCount: 3 });
    await press(el, 1);
    expect(amounts(el)).toEqual(["€18.33", "€18.33", "€18.32", "€18.32"]);
    expect(stepper(el).value).toBe(4);
    await press(el, -1);
    await press(el, -1);
    expect(amounts(el)).toEqual(["€36.65", "€36.65"]);
  });

  it("notes the extra cent only while the shares differ", async () => {
    const el = await mount({ startCount: 3 });
    expect(note(el)?.textContent?.trim()).toBe(
      "Shares differ by a cent where the bill does not divide evenly.",
    );
    await press(el, -1);
    expect(note(el)).toBeNull();
  });

  it("goes no lower than 2 and no higher than the cents left", async () => {
    const el = await mount({ left: "0.03", startCount: 2 });
    expect(stepper(el).min).toBe(2);
    expect(stepButton(el, -1).disabled).toBe(true);
    await press(el, 1);
    expect(stepper(el).value).toBe(3);
    expect(amounts(el)).toEqual(["€0.01", "€0.01", "€0.01"]);
    expect(stepButton(el, 1).disabled).toBe(true);
  });

  it("offers no Start when too few cents are left to divide", async () => {
    const el = await mount({ left: "0.01", startCount: 2 });
    expect(rows(el)).toEqual([]);
    expect(startButton(el).disabled).toBe(true);
    expect(stepButton(el, 1).disabled).toBe(true);
  });

  it("goes no higher than the largest guest count", async () => {
    const el = await mount({ left: "500.00", startCount: 999 });
    expect(stepper(el).max).toBe(999);
    expect(stepButton(el, 1).disabled).toBe(true);
  });

  it("keeps a starting count inside the limits", async () => {
    expect(stepper(await mount({ startCount: 1 })).value).toBe(2);
    expect(stepper(await mount({ startCount: null })).value).toBe(2);
    expect(stepper(await mount({ left: "0.03", startCount: 6 })).value).toBe(3);
  });

  it("with nothing taken, asks how many are paying over the bill's total", async () => {
    const el = await mount({ startCount: 4 });
    expect(topBar(el).heading).toBe("Split equally");
    expect(topBar(el).subtitle).toBe("Bill 1 · €73.30");
    expect(topBar(el).backLabel).toBe("Pay");
    expect(root(el).querySelector("[data-split-question]")!.textContent!.trim()).toBe(
      "How many guests are paying?",
    );
    expect(stepper(el).value).toBe(4);
  });

  it("with money taken and no record, starts at 2 and asks who is still to pay", async () => {
    const el = await mount({ left: "48.86", taken: true, startCount: 4 });
    expect(topBar(el).heading).toBe("Split equally");
    expect(topBar(el).subtitle).toBe("Bill 1 · €48.86 left");
    expect(root(el).querySelector("[data-split-question]")!.textContent!.trim()).toBe(
      "How many guests are still to pay?",
    );
    expect(stepper(el).value).toBe(2);
    expect(rows(el)).toEqual([
      ["Guest 1", "to pay", "€24.43", "due"],
      ["Guest 2", "to pay", "€24.43", "due"],
    ]);
  });

  it("starts at a count kept from before, whatever the bill holds", async () => {
    expect(
      stepper(await mount({ left: "48.86", taken: true, startCount: 4, keptCount: 5 })).value,
    ).toBe(5);
    expect(stepper(await mount({ startCount: 4, keptCount: 3 })).value).toBe(3);
  });

  it("with a record, starts at its count with the paid guests ticked", async () => {
    const el = await mount({
      left: "48.86",
      taken: true,
      startCount: 3,
      paid: [{ amount: "24.44", state: "received" }],
    });
    expect(stepper(el).value).toBe(3);
    expect(stepper(el).min).toBe(2);
    expect(rows(el)).toEqual([
      ["Guest 1", "paid", "€24.44", "paid"],
      ["Guest 2", "to pay", "€24.43", "due"],
      ["Guest 3", "to pay", "€24.43", "due"],
    ]);
    expect(startButton(el).textContent!.trim()).toBe("Start with Guest 2 · €24.43");
  });

  it("keeps one more guest than those paid, and no more than the paid plus the cents left", async () => {
    const el = await mount({
      left: "0.02",
      taken: true,
      startCount: 3,
      paid: [
        { amount: "24.44", state: "received" },
        { amount: "24.43", state: "received" },
      ],
    });
    expect(stepper(el).min).toBe(3);
    expect(stepper(el).max).toBe(4);
    expect(stepButton(el, -1).disabled).toBe(true);
    await press(el, 1);
    expect(amounts(el)).toEqual(["€24.44", "€24.43", "€0.01", "€0.01"]);
    expect(stepButton(el, 1).disabled).toBe(true);
  });

  it("with a record, asks how many guests are paying in all, over what is left", async () => {
    const el = await mount({
      left: "48.86",
      taken: true,
      startCount: 3,
      paid: [{ amount: "24.44", state: "received" }],
    });
    expect(root(el).querySelector("[data-split-question]")!.textContent!.trim()).toBe(
      "How many guests are paying?",
    );
    expect(topBar(el).subtitle).toBe("Bill 1 · €48.86 left");
  });

  it("offers no shares and no Start when the guests paid leave no count inside the limits", async () => {
    const el = await mount({
      left: "0.01",
      taken: true,
      startCount: 1000,
      paid: Array.from({ length: 999 }, () => ({ amount: "0.01", state: "received" as const })),
    });
    expect(rows(el).filter(([, , , state]) => state === "due")).toEqual([]);
    expect(startButton(el).disabled).toBe(true);
  });

  it("keeps the count being chosen when a render brings the same record again", async () => {
    const paid = () => [{ amount: "24.44", state: "received" as const }];
    const el = await mount({ left: "48.86", taken: true, startCount: 3, paid: paid() });
    await press(el, 1);
    el.paid = paid();
    await el.updateComplete;
    expect(stepper(el).value).toBe(4);
  });

  it("shows a card received while open as paid, keeping the count being chosen", async () => {
    const el = await mount({
      left: "48.86",
      taken: true,
      startCount: 3,
      paid: [{ amount: "24.44", state: "card" }],
    });
    await press(el, 1);
    el.paid = [{ amount: "24.44", state: "received" }];
    await el.updateComplete;
    expect(rows(el)[0]).toEqual(["Guest 1", "paid", "€24.44", "paid"]);
    expect(stepper(el).value).toBe(4);
  });

  it("starts again by the starting rule when the record or what is left changes", async () => {
    const el = await mount({ left: "0.00", startCount: 4 });
    el.left = "73.30";
    await el.updateComplete;
    expect(stepper(el).value).toBe(4);

    await press(el, 1);
    el.paid = [];
    el.taken = true;
    el.left = "48.86";
    await el.updateComplete;
    expect(stepper(el).value).toBe(2);
  });

  it("takes keyboard focus to its back control when it opens", async () => {
    const el = await mount({ startCount: 3 });
    const back = topBar(el).shadowRoot!.querySelector("wt-button")!;
    await expect.poll(deepActive).toBe(back.shadowRoot!.querySelector("button"));
  });

  it("shows a card in progress as still due, saying so", async () => {
    const el = await mount({
      left: "24.43",
      taken: true,
      startCount: 3,
      paid: [
        { amount: "24.44", state: "received" },
        { amount: "24.43", state: "card" },
      ],
    });
    expect(rows(el)).toEqual([
      ["Guest 1", "paid", "€24.44", "paid"],
      ["Guest 2", "card in progress", "€24.43", "due"],
      ["Guest 3", "to pay", "€24.43", "due"],
    ]);
  });

  it("starts with the first unpaid guest's share and the count chosen", async () => {
    const el = await mount({ startCount: 3 });
    expect(startButton(el).textContent!.trim()).toBe("Start with Guest 1 · €24.44");
    await press(el, 1);
    expect(startButton(el).textContent!.trim()).toBe("Start with Guest 1 · €18.33");
    const started: SplitEquallyStartDetail[] = [];
    el.addEventListener("split-equally-start", (event) =>
      started.push((event as CustomEvent<SplitEquallyStartDetail>).detail),
    );
    startButton(el).click();
    expect(started).toEqual([{ guests: 4, amount: "18.33" }]);
  });

  it("goes back to Pay's ways", async () => {
    const el = await mount({ startCount: 3 });
    let back = 0;
    el.addEventListener("split-equally-back", () => (back += 1));
    topBar(el).dispatchEvent(new CustomEvent("wt-back", { bubbles: true, composed: true }));
    expect(back).toBe(1);
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount({ startCount: 3 });
    const share = formatMoney(decimal("24.44"), "es");
    expect(rows(el)[0]).toEqual(["Comensal 1", "por pagar", share, "due"]);
    expect(startButton(el).textContent!.trim()).toBe(`Empezar con Comensal 1 · ${share}`);
  });
});
