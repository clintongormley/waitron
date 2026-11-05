import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillPartyNameDialog } from "../widgets/party-name-dialog.js";
import type { TillSplitPicker } from "../widgets/split-picker.js";
import type { SplitSources, TabLine, TableParty, TableState } from "../api/client.js";
import "./till-table-order-screen.js";
import type {
  SplitRefusal,
  SplitRefusalDeclinedDetail,
  TillTableOrderScreen,
} from "./till-table-order-screen.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

function dish(id: string, lineNo: number): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: id,
    productId: id,
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "10.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: `offer-${id}`,
    portion: true,
  };
}

const party: TableParty = { ...switcherParty, guestCount: 5, tableIds: ["t7", "t8"] };
const bills = [partyBill("main", 1, "20.00"), partyBill("other", 2, "10.00")];
const tables = ["t7", "t8"].map(
  (id) =>
    ({
      id,
      label: id.toUpperCase(),
      shortName: id.toUpperCase(),
      party,
      signals: [],
      zoneId: null,
      state: "open-tab",
      hasOpenTab: true,
      condition: "held",
      pendingDeliveries: 0,
      pendingToServe: 0,
      readyToServe: 0,
      timingBand: "fresh",
      nextReservation: null,
      today: null,
    }) as TableState,
);
const balance = (workingOrderId: string, total: string) => ({
  workingOrderId,
  status: "open" as const,
  total,
  received: "0.00",
  reserved: "0.00",
  outstanding: total,
  tips: "0.00",
  payments: [],
  paidLines: [],
});
const splitRead: SplitSources = {
  partyRevision: 3,
  bills: [
    {
      billId: "main",
      lines: [dish("soup", 1), dish("salad", 2)],
      balance: balance("main", "20.00"),
    },
    { billId: "other", lines: [dish("wine", 3)], balance: balance("other", "10.00") },
  ],
};

class SplitTableLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  party = party;
  readonly commands: { type: string; detail: unknown }[] = [];
  readonly protectionAtSubmit: boolean[] = [];
  override render() {
    return html`<till-table-order-screen
        .orderId=${"main"}
        .party=${this.party}
        .bills=${bills}
        .lines=${[]}
        .tables=${tables}
        .splitRead=${splitRead}
        .personId=${"me"}
        @split-table=${this.accept}
        @merge-bills=${this.accept}
        @switch-bill=${this.accept}
        @refund-excess=${this.accept}
        @move-guests=${this.accept}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
  private accept(event: CustomEvent) {
    this.protectionAtSubmit.push(unload());
    this.commands.push({ type: event.type, detail: event.detail });
  }
}
customElements.define("split-table-leave-test-app", SplitTableLeaveApp);

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const q = <T extends HTMLElement = HTMLElement>(screen: TillTableOrderScreen, selector: string) =>
  screen.shadowRoot!.querySelector<T>(selector);
const picker = (screen: TillTableOrderScreen) => q<TillSplitPicker>(screen, "till-split-picker")!;
const panelOpen = (screen: TillTableOrderScreen) => q(screen, "[data-split-pick]") !== null;
const tablesOpen = (screen: TillTableOrderScreen) => q(screen, "[data-split-table]") !== null;
type Side = "staying" | "leaving";
const stepper = (screen: TillTableOrderScreen, side: Side) =>
  q<HTMLElementTagNameMap["wt-number-stepper"]>(screen, `wt-number-stepper[name="${side}Guests"]`)!;
const nativeCount = (screen: TillTableOrderScreen, side: Side) =>
  stepper(screen, side).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const tickBox = (screen: TillTableOrderScreen, billId: string) =>
  picker(screen).shadowRoot!.querySelector<HTMLInputElement>(`[data-split-tick="${billId}"]`)!;
const dishBox = (screen: TillTableOrderScreen, billId: string, row: string) =>
  picker(screen)
    .shadowRoot!.querySelector(`[data-split-bill="${billId}"] till-portion-picker`)!
    .shadowRoot!.querySelector<HTMLInputElement>(`[data-pick="${row}"]`)!;
const whole = (screen: TillTableOrderScreen) => [...picker(screen).split.whole];
/** A click on a box out of the page fires no `change`, so the event is sent to reach the screen. */
const changeOf = (box: HTMLInputElement) =>
  box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
const enterOn = (input: HTMLInputElement) =>
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
const picks = (screen: TillTableOrderScreen, billId: string) => [
  ...(picker(screen).split.picks.get(billId) ?? []),
];

async function settled(screen: TillTableOrderScreen): Promise<void> {
  await screen.updateComplete;
  const drawn = q<TillSplitPicker>(screen, "till-split-picker");
  await drawn?.updateComplete;
  for (const each of drawn?.shadowRoot!.querySelectorAll("till-portion-picker") ?? [])
    await each.updateComplete;
  for (const each of screen.shadowRoot!.querySelectorAll("wt-number-stepper"))
    await each.updateComplete;
}
async function click(screen: TillTableOrderScreen, selector: string): Promise<void> {
  q(screen, selector)!.click();
  await settled(screen);
}
async function tick(screen: TillTableOrderScreen, billId: string): Promise<void> {
  tickBox(screen, billId).click();
  await settled(screen);
}
async function pickDish(screen: TillTableOrderScreen, billId: string, row: string): Promise<void> {
  dishBox(screen, billId, row).click();
  await settled(screen);
}
async function typeCount(screen: TillTableOrderScreen, side: Side, value: string): Promise<void> {
  const input = nativeCount(screen, side);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settled(screen);
}
const pressSplit = (screen: TillTableOrderScreen) => click(screen, "[data-split-confirm]");
const pressBack = (screen: TillTableOrderScreen) => click(screen, "[data-action-back]");
async function pressEscape(screen: TillTableOrderScreen): Promise<void> {
  q(screen, "[data-action-panel]")!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  await settled(screen);
}

async function mountOnTables() {
  const { el: app } = await mountWidget<SplitTableLeaveApp>("split-table-leave-test-app", {});
  const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await screen.updateComplete;
  q(screen, "[data-move-split]")!.shadowRoot!.querySelector<HTMLElement>("button")!.click();
  await click(screen, '[data-action="split-table"]');
  return { app, screen };
}
async function mount() {
  const opened = await mountOnTables();
  await click(opened.screen, '[data-target="t8"]');
  expect(panelOpen(opened.screen)).toBe(true);
  return opened;
}
async function question(app: SplitTableLeaveApp) {
  await app.updateComplete;
  const dialog = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await dialog.updateComplete;
  await dialog.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return dialog;
}
async function answer(app: SplitTableLeaveApp, decision: "keep" | "discard") {
  const dialog = await question(app);
  dialog.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => dialog.open).toBe(false);
}
async function storeCount(app: SplitTableLeaveApp, screen: TillTableOrderScreen, count: number) {
  app.party = { ...party, guestCount: count };
  app.requestUpdate();
  await app.updateComplete;
  await settled(screen);
}
async function takeOut(screen: TillTableOrderScreen) {
  screen.remove();
  await screen.updateComplete;
}
async function putBack(app: SplitTableLeaveApp, screen: TillTableOrderScreen) {
  app.shadowRoot!.prepend(screen);
  await settled(screen);
}
async function storeWhileTakenOut(
  app: SplitTableLeaveApp,
  screen: TillTableOrderScreen,
  count: number,
) {
  await takeOut(screen);
  await storeCount(app, screen, count);
  expect(screen.party?.guestCount).toBe(count);
  await putBack(app, screen);
}

const changes: [
  string,
  (screen: TillTableOrderScreen) => Promise<void>,
  (screen: TillTableOrderScreen) => void,
][] = [
  [
    "a tick",
    (screen) => tick(screen, "other"),
    (screen) => expect(whole(screen)).toEqual(["other"]),
  ],
  [
    "a dish picked off a bill",
    (screen) => pickDish(screen, "main", "soup"),
    (screen) => expect(picks(screen, "main")).toEqual(["soup"]),
  ],
  [
    "a stepped count",
    async (screen) => {
      stepper(screen, "staying").shadowRoot!.querySelector<HTMLElement>('[data-step="1"]')!.click();
      await settled(screen);
    },
    (screen) => expect(stepper(screen, "staying").value).toBe("6"),
  ],
  [
    "a typed guest count",
    (screen) => typeCount(screen, "leaving", "2"),
    (screen) => expect(stepper(screen, "leaving").value).toBe("2"),
  ],
];

function expectUntouched(screen: TillTableOrderScreen) {
  expect(whole(screen)).toEqual([]);
  expect(picks(screen, "main")).toEqual([]);
  expect(stepper(screen, "staying").value).toBe("5");
  expect(stepper(screen, "leaving").value).toBe("");
}

describe("Split a table's panel, untouched", () => {
  it("opening and closing untouched asks nothing", async () => {
    const { app, screen } = await mount();
    expect(unload()).toBe(false);
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
    expect(unload()).toBe(false);
    expect(app.commands).toEqual([]);
  });

  it("Escape from an untouched panel returns to the tables, asking nothing", async () => {
    const { app, screen } = await mount();
    await pressEscape(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
  });

  it("a ⋮ item from an untouched panel goes at once, asking nothing", async () => {
    const { app, screen } = await mount();
    await click(screen, '[data-table-menu] [data-action="merge"]');
    await expect.poll(() => panelOpen(screen)).toBe(false);
    expect((await question(app)).open).toBe(false);
  });

  it("a bill switch from an untouched panel goes at once, asking nothing", async () => {
    const { app, screen } = await mount();
    await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
    await expect
      .poll(() => app.commands)
      .toEqual([{ type: "switch-bill", detail: { workingOrderId: "other" } }]);
    expect((await question(app)).open).toBe(false);
  });

  it("the panel opened a second time after Back is untouched again", async () => {
    const { app, screen } = await mount();
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    await click(screen, '[data-target="t8"]');
    expect(unload()).toBe(false);
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
  });
});

describe.each(changes)("Split a table's panel with %s", (_, change, expectChanged) => {
  it("Back asks, keeps on Keep and discards on Discard", async () => {
    const { app, screen } = await mount();
    await change(screen);
    expect(unload()).toBe(true);
    await pressBack(screen);
    expect((await question(app)).open).toBe(true);
    expect(app.commands).toEqual([]);
    await answer(app, "keep");
    await settled(screen);
    expect(panelOpen(screen)).toBe(true);
    expectChanged(screen);
    await pressBack(screen);
    await answer(app, "discard");
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect(unload()).toBe(false);
    expect(app.commands).toEqual([]);
    await click(screen, '[data-target="t8"]');
    expectUntouched(screen);
  });

  it("Escape asks, keeps on Keep and discards on Discard", async () => {
    const { app, screen } = await mount();
    await change(screen);
    await pressEscape(screen);
    expect((await question(app)).open).toBe(true);
    await answer(app, "keep");
    await settled(screen);
    expectChanged(screen);
    await pressEscape(screen);
    await answer(app, "discard");
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect(unload()).toBe(false);
    expect(app.commands).toEqual([]);
  });

  it("a ⋮ item asks, keeps on Keep and discards on Discard", async () => {
    const { app, screen } = await mount();
    await change(screen);
    await click(screen, '[data-table-menu] [data-action="merge"]');
    expect((await question(app)).open).toBe(true);
    await answer(app, "keep");
    await settled(screen);
    expect(panelOpen(screen)).toBe(true);
    expectChanged(screen);
    await click(screen, '[data-table-menu] [data-action="merge"]');
    await answer(app, "discard");
    await expect.poll(() => panelOpen(screen)).toBe(false);
    expect(q(screen, "[data-action-panel]")).not.toBeNull();
    expect(unload()).toBe(false);
  });

  it("a bill switch asks, keeps on Keep and discards on Discard", async () => {
    const { app, screen } = await mount();
    await change(screen);
    await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
    expect((await question(app)).open).toBe(true);
    expect(app.commands).toEqual([]);
    await answer(app, "keep");
    await settled(screen);
    expect(app.commands).toEqual([]);
    expectChanged(screen);
    await click(screen, '[data-bill-switcher] [data-switch-bill="other"]');
    await answer(app, "discard");
    await expect
      .poll(() => app.commands)
      .toEqual([{ type: "switch-bill", detail: { workingOrderId: "other" } }]);
    expect(app.protectionAtSubmit).toEqual([false]);
    expect(q(screen, "[data-action-panel]")).toBeNull();
  });

  it("navigation asks, keeps on Keep and discards on Discard", async () => {
    const { app, screen } = await mount();
    await change(screen);
    const kept = app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed() {},
    });
    expect((await question(app)).open).toBe(true);
    await answer(app, "keep");
    expect(await kept).not.toBe("proceeded");
    await settled(screen);
    expectChanged(screen);
    const left = app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed() {},
    });
    await answer(app, "discard");
    expect(await left).toBe("proceeded");
    await settled(screen);
    expectUntouched(screen);
    expect(unload()).toBe(false);
    expect(app.commands).toEqual([]);
  });
});

describe("Split a table's panel, what counts as changed", () => {
  it("a bill ticked and unticked again is clean", async () => {
    const { app, screen } = await mount();
    await tick(screen, "other");
    expect(unload()).toBe(true);
    await tick(screen, "other");
    expect(unload()).toBe(false);
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
  });

  it("a dish picked and put back is clean", async () => {
    const { screen } = await mount();
    await pickDish(screen, "main", "soup");
    expect(unload()).toBe(true);
    await pickDish(screen, "main", "soup");
    expect(unload()).toBe(false);
  });

  it("counts typed back to the opening ones, however spelled, close without a warning", async () => {
    const { app, screen } = await mount();
    await typeCount(screen, "staying", "3");
    await typeCount(screen, "leaving", "2");
    expect(unload()).toBe(true);
    await typeCount(screen, "staying", " 05 ");
    expect(unload()).toBe(true);
    await typeCount(screen, "leaving", "  ");
    expect(unload()).toBe(false);
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
    expect(app.commands).toEqual([]);
  });

  it("an invalid count remains protected after validation refuses it", async () => {
    const { app, screen } = await mount();
    await typeCount(screen, "leaving", "0");
    await pressSplit(screen);
    await settled(screen);
    expect(app.commands).toEqual([]);
    expect(stepper(screen, "leaving").error).toBe(t("seat.guest_count_invalid"));
    expect(unload()).toBe(true);
    await pressBack(screen);
    expect((await question(app)).open).toBe(true);
    await answer(app, "keep");
    await settled(screen);
    expect(stepper(screen, "leaving").value).toBe("0");
    expect(app.commands).toEqual([]);
  });

  it("splitting sends the ticks and counts and commits them without a discard question", async () => {
    const { app, screen } = await mount();
    await tick(screen, "other");
    await typeCount(screen, "staying", " 3 ");
    await typeCount(screen, "leaving", "2");
    await pressSplit(screen);
    expect(app.commands).toEqual([
      {
        type: "split-table",
        detail: {
          tableId: "t8",
          selection: { wholeBillIds: ["other"], loose: [] },
          guestCounts: { staying: 3, leaving: 2 },
          prompt: expect.any(Object),
          partyRevision: 3,
        },
      },
    ]);
    expect(app.protectionAtSubmit).toEqual([false]);
    expect((await question(app)).open).toBe(false);
    expect(unload()).toBe(false);
    expect(q(screen, "[data-action-panel]")).toBeNull();
    await takeOut(screen);
    await putBack(app, screen);
    expect(q(screen, "[data-action-panel]")).toBeNull();
    expect(unload()).toBe(false);
  });

  it("a parent rerender does not reset the ticks, typed counts or pending warning", async () => {
    const { app, screen } = await mount();
    await tick(screen, "other");
    await typeCount(screen, "leaving", "2");
    await pressBack(screen);
    const dialog = await question(app);
    expect(dialog.open).toBe(true);
    app.party = { ...party };
    app.requestUpdate();
    await app.updateComplete;
    await settled(screen);
    expect(dialog.open).toBe(true);
    await answer(app, "keep");
    await settled(screen);
    expect(whole(screen)).toEqual(["other"]);
    expect(stepper(screen, "leaving").value).toBe("2");
    expect(unload()).toBe(true);
  });
});

describe("Split a table's panel and a count stored elsewhere", () => {
  it("a stored count changed elsewhere moves an untouched staying side with it, and leaves the panel unsaved only for what was typed", async () => {
    const { app, screen } = await mount();
    await storeCount(app, screen, 6);
    expect(stepper(screen, "staying").value).toBe("6");
    expect(unload()).toBe(false);
    await typeCount(screen, "leaving", "2");
    await storeCount(app, screen, 7);
    expect(stepper(screen, "staying").value).toBe("7");
    expect(unload()).toBe(true);
    await typeCount(screen, "leaving", "");
    expect(unload()).toBe(false);
  });

  it("a press after a stored count moved an untouched staying side splits with the new count", async () => {
    const { app, screen } = await mount();
    await storeCount(app, screen, 6);

    await pressSplit(screen);

    expect(app.commands.at(-1)).toEqual({
      type: "split-table",
      detail: expect.objectContaining({ guestCounts: { staying: 6, leaving: null } }),
    });
  });

  it("a staying count typed before the stored one changes elsewhere stays, unsaved against the new stored count", async () => {
    const { app, screen } = await mount();
    await typeCount(screen, "staying", "3");
    await storeCount(app, screen, 6);
    expect(stepper(screen, "staying").value).toBe("3");
    expect(unload()).toBe(true);
    await typeCount(screen, "staying", "6");
    expect(unload()).toBe(false);
  });

  it("Discard after a stored count moved goes back to the new count, not the opening one", async () => {
    const { app, screen } = await mount();
    await typeCount(screen, "staying", "3");
    await storeCount(app, screen, 6);
    const left = app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed() {},
    });
    await answer(app, "discard");
    expect(await left).toBe("proceeded");
    await settled(screen);
    expect(stepper(screen, "staying").value).toBe("6");
    expect(unload()).toBe(false);
  });
});

describe("Split a table's panel out of the page", () => {
  it("disconnect aborts a leave decision; reconnect retains the opening baseline", async () => {
    const { app, screen } = await mount();
    await tick(screen, "other");
    await typeCount(screen, "leaving", "2");
    await pressBack(screen);
    const dialog = await question(app);
    expect(dialog.open).toBe(true);
    const oldDiscard = dialog.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    await takeOut(screen);
    await expect.poll(() => dialog.open).toBe(false);
    expect(unload()).toBe(false);
    oldDiscard.click();
    expect(app.commands).toEqual([]);
    await putBack(app, screen);
    expect(panelOpen(screen)).toBe(true);
    expect(whole(screen)).toEqual(["other"]);
    expect(stepper(screen, "leaving").value).toBe("2");
    expect(unload()).toBe(true);
    oldDiscard.click();
    await settled(screen);
    expect(panelOpen(screen)).toBe(true);
    expect(whole(screen)).toEqual(["other"]);
    await pressBack(screen);
    expect((await question(app)).open).toBe(true);
    await answer(app, "discard");
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    await click(screen, '[data-target="t8"]');
    expectUntouched(screen);
  });

  it("retained departed controls cannot split, go back or replace the draft", async () => {
    const { app, screen } = await mount();
    await tick(screen, "other");
    await typeCount(screen, "leaving", "2");
    const oldSplit = q(screen, "[data-split-confirm]")!;
    const oldBack = q(screen, "[data-action-back]")!;
    const oldTick = tickBox(screen, "main");
    const oldInput = nativeCount(screen, "leaving");
    const oldStep = stepper(screen, "staying").shadowRoot!.querySelector<HTMLElement>(
      '[data-step="1"]',
    )!;
    await takeOut(screen);
    oldSplit.click();
    oldBack.click();
    changeOf(oldTick);
    oldStep.click();
    oldInput.value = "7";
    oldInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    enterOn(oldInput);
    await screen.updateComplete;
    expect(app.commands).toEqual([]);
    await putBack(app, screen);
    expect(panelOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
    expect(whole(screen)).toEqual(["other"]);
    expect(tickBox(screen, "main").checked).toBe(false);
    expect(stepper(screen, "leaving").value).toBe("2");
    expect(stepper(screen, "staying").value).toBe("5");
    expect(unload()).toBe(true);
  });

  it("a panel's old controls cannot change the panel opened after it", async () => {
    const { app, screen } = await mount();
    const oldSplit = q(screen, "[data-split-confirm]")!;
    const oldBack = q(screen, "[data-action-back]")!;
    const oldTick = tickBox(screen, "main");
    const oldInput = nativeCount(screen, "leaving");
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    await click(screen, '[data-target="t7"]');
    oldSplit.click();
    oldBack.click();
    changeOf(oldTick);
    oldInput.value = "7";
    oldInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    enterOn(oldInput);
    await settled(screen);
    expect(app.commands).toEqual([]);
    expect(panelOpen(screen)).toBe(true);
    expect(whole(screen)).toEqual([]);
    expect(stepper(screen, "leaving").value).toBe("");
    expect(unload()).toBe(false);
  });

  it("a count stored elsewhere while an untouched panel is taken out moves the staying side with it once it is put back", async () => {
    const { app, screen } = await mount();
    await storeWhileTakenOut(app, screen, 6);
    expect(stepper(screen, "staying").value).toBe("6");
    expect(unload()).toBe(false);
    await pressBack(screen);
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect((await question(app)).open).toBe(false);
  });

  it("a typed staying count stored elsewhere while the panel is taken out counts as saved once it is put back", async () => {
    const { app, screen } = await mount();
    await typeCount(screen, "staying", "3");
    await storeWhileTakenOut(app, screen, 3);
    expect(stepper(screen, "staying").value).toBe("3");
    expect(unload()).toBe(false);
    await typeCount(screen, "staying", "5");
    expect(unload()).toBe(true);
  });

  it("a split the panel stays open after keeps its counts when taken out and put back while the stored count is unchanged", async () => {
    const { app, screen } = await mount();
    await tick(screen, "other");
    await typeCount(screen, "staying", "3");
    await typeCount(screen, "leaving", "0");
    await pressSplit(screen);
    await settled(screen);
    expect(app.commands).toEqual([]);
    expect(panelOpen(screen)).toBe(true);
    await takeOut(screen);
    await putBack(app, screen);
    expect(whole(screen)).toEqual(["other"]);
    expect(stepper(screen, "staying").value).toBe("3");
    expect(stepper(screen, "leaving").value).toBe("0");
    expect(stepper(screen, "leaving").error).toBe(t("seat.guest_count_invalid"));
    expect(unload()).toBe(true);
    await tick(screen, "other");
    await typeCount(screen, "staying", "5");
    await typeCount(screen, "leaving", "");
    expect(unload()).toBe(false);
  });
});

describe("Split a table's panel reopened by a refusal", () => {
  type Refused = Partial<Extract<SplitRefusal, { selection: unknown }>>;

  /** Sends what is in the panel, then has the app refuse it, as a split the panel closes on. */
  async function reopen(screen: TillTableOrderScreen, over: Refused = {}) {
    await pressSplit(screen);
    expect(panelOpen(screen)).toBe(false);
    screen.splitRefusal = {
      tableId: "t8",
      selection: { wholeBillIds: [], loose: [] },
      staying: "5",
      leaving: "",
      field: "leaving",
      message: "Refused",
      ...over,
    } as SplitRefusal;
    await settled(screen);
    expect(panelOpen(screen)).toBe(true);
  }

  it("a reopened panel counts as changed: it asks on Back, keeps on Keep and discards on Discard", async () => {
    const { app, screen } = await mount();
    await reopen(screen, { selection: { wholeBillIds: ["other"], loose: [] }, leaving: "2" });
    expect(unload()).toBe(true);

    await pressBack(screen);
    await answer(app, "keep");
    expect(panelOpen(screen)).toBe(true);
    expect(whole(screen)).toEqual(["other"]);
    expect(stepper(screen, "leaving").value).toBe("2");

    await pressBack(screen);
    await answer(app, "discard");
    await expect.poll(() => tablesOpen(screen)).toBe(true);
    expect(unload()).toBe(false);
  });

  it("a reopened panel's picks back to none are clean, measured from a panel opened afresh", async () => {
    const { screen } = await mount();
    await reopen(screen, {
      selection: { wholeBillIds: [], loose: [{ billId: "main", lineIds: ["soup"] }] },
    });
    expect(picks(screen, "main")).toEqual(["soup"]);
    expect(unload()).toBe(true);

    await pickDish(screen, "main", "soup");

    expect(unload()).toBe(false);
  });

  it("a count stored elsewhere while an untouched panel is taken out moves the staying side with it once it is put back", async () => {
    const { app, screen } = await mount();
    await reopen(screen);
    await storeWhileTakenOut(app, screen, 6);
    expect(stepper(screen, "staying").value).toBe("6");
    expect(unload()).toBe(false);
  });

  it("a typed staying count stored elsewhere while the panel is taken out counts as saved once it is put back", async () => {
    const { app, screen } = await mount();
    await reopen(screen, { staying: "3" });
    expect(unload()).toBe(true);
    await storeWhileTakenOut(app, screen, 3);
    expect(stepper(screen, "staying").value).toBe("3");
    expect(unload()).toBe(false);
    await typeCount(screen, "staying", "5");
    expect(unload()).toBe(true);
  });

  it("a split the panel stays open after keeps its counts when taken out and put back while the stored count is unchanged", async () => {
    const { app, screen } = await mount();
    await reopen(screen, {
      selection: { wholeBillIds: ["other"], loose: [] },
      staying: "3",
      leaving: "2",
      message: "Too many",
    });
    await takeOut(screen);
    await putBack(app, screen);
    expect(whole(screen)).toEqual(["other"]);
    expect(stepper(screen, "staying").value).toBe("3");
    expect(stepper(screen, "leaving").value).toBe("2");
    expect(stepper(screen, "leaving").error).toBe("Too many");
    expect(unload()).toBe(true);
  });

  it("a split the panel stays open after keeps its Split, which commits with no question", async () => {
    const { app, screen } = await mount();
    await reopen(screen, { selection: { wholeBillIds: ["other"], loose: [] }, staying: "3" });
    await pressSplit(screen);
    expect(panelOpen(screen)).toBe(false);
    expect(app.commands.at(-1)!.type).toBe("split-table");
    expect(app.commands).toHaveLength(2);
    expect(app.protectionAtSubmit.at(-1)).toBe(false);
    expect(unload()).toBe(false);
  });

  it("a read dropping a reopened panel's only tick while it is taken out is told once it is put back", async () => {
    const observed: { billIds: string[] }[] = [];
    const { app, screen } = await mount();
    screen.addEventListener("split-table-observe", (event) =>
      observed.push((event as CustomEvent<{ billIds: string[] }>).detail),
    );
    await reopen(screen, {
      selection: { wholeBillIds: ["other"], loose: [] },
      prompt: {},
    });
    expect(observed.at(-1)!.billIds).toEqual(["other"]);
    await takeOut(screen);
    screen.bills = bills.filter((bill) => bill.workingOrderId !== "other");
    await screen.updateComplete;
    expect(observed).toHaveLength(1);
    await putBack(app, screen);
    await expect.poll(() => observed.at(-1)!.billIds).toEqual([]);
  });

  it("a read dropping a panel's only pick releases the protection", async () => {
    const { screen } = await mount();
    await pickDish(screen, "main", "soup");
    expect(unload()).toBe(true);

    screen.splitRead = {
      partyRevision: 3,
      bills: splitRead.bills.map((bill) =>
        bill.billId === "main"
          ? {
              ...bill,
              balance: {
                ...bill.balance,
                received: "10.00",
                paidLines: [{ lineId: "soup", lineNo: 1, paidQuantity: "1.000" }],
              },
            }
          : bill,
      ),
    };
    await settled(screen);

    expect(picks(screen, "main")).toEqual([]);
    expect(unload()).toBe(false);
  });

  it("Move guests from the question commits with no question", async () => {
    const { app, screen } = await mount();
    await tick(screen, "main");
    await tick(screen, "other");
    await pressSplit(screen);
    expect(q(screen, "[data-split-question]")).not.toBeNull();

    await click(screen, "[data-split-move-guests]");
    await settled(screen);

    expect(app.commands.map(({ type }) => type)).toEqual(["move-guests"]);
    expect(app.protectionAtSubmit).toEqual([false]);
    expect((await question(app)).open).toBe(false);
  });

  it("a Move guests button left over from the question cannot move anyone", async () => {
    const { app, screen } = await mount();
    await tick(screen, "main");
    await tick(screen, "other");
    await pressSplit(screen);
    const oldMove = q(screen, "[data-split-move-guests]")!;
    await pressBack(screen);
    expect(q(screen, "[data-split-question]")).toBeNull();

    oldMove.click();
    await settled(screen);

    expect(app.commands).toEqual([]);
    expect(panelOpen(screen)).toBe(true);
    expect(whole(screen).sort()).toEqual(["main", "other"]);
  });

  describe("Refund for a bill not on screen", () => {
    const refund = (billId: string) =>
      html`<wt-button
        data-refund-excess
        @click=${(event: Event) =>
          event.currentTarget!.dispatchEvent(
            new CustomEvent("refund-excess", {
              detail: { billId },
              bubbles: true,
              composed: true,
            }),
          )}
        >Refund</wt-button
      >`;
    const pressRefund = async (screen: TillTableOrderScreen) => {
      q(screen, "[data-split-refusal] [data-refund-excess]")!.click();
      await settled(screen);
    };

    async function refused(billId: string) {
      const { app, screen } = await mount();
      await reopen(screen, {
        selection: { wholeBillIds: ["other"], loose: [] },
        field: undefined,
        message: refund(billId),
      });
      const before = app.commands.length;
      return { app, screen, before };
    }

    it("Refund for another bill asks; Keep leaves the ticks and dispatches nothing past the screen", async () => {
      const { app, screen, before } = await refused("other");

      await pressRefund(screen);
      expect((await question(app)).open).toBe(true);
      expect(app.commands).toHaveLength(before);

      await answer(app, "keep");
      expect(app.commands).toHaveLength(before);
      expect(panelOpen(screen)).toBe(true);
      expect(whole(screen)).toEqual(["other"]);
    });

    it("Refund for another bill, Discard closes the panel and lets refund-excess through", async () => {
      const { app, screen, before } = await refused("other");

      await pressRefund(screen);
      await answer(app, "discard");

      await expect.poll(() => app.commands.length).toBe(before + 1);
      expect(app.commands.at(-1)).toEqual({ type: "refund-excess", detail: { billId: "other" } });
      await settled(screen);
      expect(q(screen, "[data-action-panel]")).toBeNull();
    });

    it("a Refund button whose sentence has gone does nothing", async () => {
      const { app, screen, before } = await refused("other");
      const oldRefund = q(screen, "[data-split-refusal] [data-refund-excess]")!;
      await typeCount(screen, "leaving", "abc");
      await pressSplit(screen);
      expect(q(screen, "[data-split-refusal]")).toBeNull();

      oldRefund.click();
      await settled(screen);

      expect((await question(app)).open).toBe(false);
      expect(app.commands).toHaveLength(before);
      expect(panelOpen(screen)).toBe(true);
    });

    it("Refund for the bill on screen asks nothing and lets it through", async () => {
      const { app, screen, before } = await refused("main");

      await pressRefund(screen);

      expect((await question(app)).open).toBe(false);
      expect(app.commands.slice(before)).toEqual([
        { type: "refund-excess", detail: { billId: "main" } },
      ]);
      expect(panelOpen(screen)).toBe(true);
      expect(whole(screen)).toEqual(["other"]);
    });
  });
});

describe("Split a table's panel and a late refusal", () => {
  const refusal = {
    tableId: "t8",
    selection: { wholeBillIds: ["other"], loose: [] },
    staying: "4",
    leaving: "1",
    message: "Refused",
  } satisfies SplitRefusal;

  function declinedOn(screen: TillTableOrderScreen) {
    const told: SplitRefusalDeclinedDetail[] = [];
    screen.addEventListener("split-refusal-declined", (event) =>
      told.push((event as CustomEvent<SplitRefusalDeclinedDetail>).detail),
    );
    return told;
  }

  /** The first panel has sent its split and closed; a second is open on the other table. */
  async function secondPanel() {
    const opened = await mount();
    const told = declinedOn(opened.screen);
    await pressSplit(opened.screen);
    expect(panelOpen(opened.screen)).toBe(false);
    q(opened.screen, "[data-move-split]")!
      .shadowRoot!.querySelector<HTMLElement>("button")!
      .click();
    await click(opened.screen, '[data-action="split-table"]');
    await click(opened.screen, '[data-target="t7"]');
    expect(panelOpen(opened.screen)).toBe(true);
    return { ...opened, told };
  }
  const heading = (screen: TillTableOrderScreen) =>
    q(screen, "[data-split-pick] h2")!.textContent!.trim();
  async function refuse(screen: TillTableOrderScreen) {
    screen.splitRefusal = refusal;
    await settled(screen);
  }

  it.each(changes)("a second panel holding %s stays as it is", async (_name, change, check) => {
    const { app, screen, told } = await secondPanel();
    await change(screen);
    const before = heading(screen);

    await refuse(screen);

    expect(panelOpen(screen)).toBe(true);
    expect(heading(screen)).toBe(before);
    check(screen);
    expect(q(screen, "[data-split-refusal]")).toBeNull();
    expect(stepper(screen, "leaving").error).toBe("");
    expect(unload()).toBe(true);
    expect((await question(app)).open).toBe(false);
    expect(told).toEqual([{ refusal }]);
  });

  it("a second panel's leave question stays open", async () => {
    const { app, screen, told } = await secondPanel();
    await tick(screen, "main");
    await pressBack(screen);
    const asked = await question(app);
    expect(asked.open).toBe(true);

    await refuse(screen);
    await app.updateComplete;

    expect(asked.open).toBe(true);
    expect(whole(screen)).toEqual(["main"]);
    expect(told).toHaveLength(1);
  });

  it("a second panel's everything-ticked question stays", async () => {
    const { screen, told } = await secondPanel();
    await tick(screen, "main");
    await tick(screen, "other");
    await pressSplit(screen);

    await refuse(screen);

    expect(q(screen, "[data-split-question]")).not.toBeNull();
    expect(whole(screen).sort()).toEqual(["main", "other"]);
    expect(told).toHaveLength(1);
  });

  it("an untouched second panel on another table gives way, measured from a panel opened afresh", async () => {
    const { app, screen, told } = await secondPanel();
    const onSecond = heading(screen);

    await refuse(screen);

    expect(heading(screen)).not.toBe(onSecond);
    expect(whole(screen)).toEqual(["other"]);
    expect(stepper(screen, "staying").value).toBe("4");
    expect(q(screen, "[data-split-refusal]")!.textContent!.trim()).toBe("Refused");
    expect(told).toEqual([]);
    expect((await question(app)).open).toBe(false);
    expect(unload()).toBe(true);

    await tick(screen, "other");
    await typeCount(screen, "staying", "5");
    await typeCount(screen, "leaving", "");
    expect(unload()).toBe(false);
  });

  it("a typed name survives a reopen behind its window, which keeps focus and its keys", async () => {
    const { el: app } = await mountWidget<SplitTableLeaveApp>("split-table-leave-test-app", {});
    const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
    await screen.updateComplete;
    const told = declinedOn(screen);
    q(screen, '[data-action="name"]')!.click();
    await settled(screen);
    const dialog = q<TillPartyNameDialog>(screen, "till-party-name-dialog")!;
    await dialog.updateComplete;
    const nameField = dialog.shadowRoot!.querySelector<HTMLElement>("wt-input")!;
    const input = nameField.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    await expect.poll(() => nameField.shadowRoot!.activeElement).toBe(input);
    await userEvent.keyboard("7");
    expect(input.value).toBe("7");

    await refuse(screen);

    expect(panelOpen(screen)).toBe(true);
    expect(q(screen, "[data-split-refusal]")!.textContent!.trim()).toBe("Refused");
    expect(whole(screen)).toEqual(["other"]);
    expect(q(screen, "till-party-name-dialog")).toBe(dialog);
    expect(input.value).toBe("7");
    expect(told).toEqual([]);
    expect(nameField.shadowRoot!.activeElement).toBe(input);

    await userEvent.keyboard("8");
    expect(input.value).toBe("78");
  });

  it("a panel reopening onto a held bill takes focus to its heading, whatever had focus in the panel before", async () => {
    const { screen } = await secondPanel();
    screen.partyDrafts = [
      {
        id: "draft-other",
        partyId: party.id,
        billId: "other",
        ownerId: "luis",
        ownerName: "Luis",
        revision: 0,
        lines: [],
        takenOverFrom: null,
      },
    ];
    await settled(screen);
    q(screen, "[data-split-confirm]")!.focus();

    await refuse(screen);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(q(screen, "[data-split-confirm]")!.hasAttribute("disabled")).toBe(true);
    expect(screen.shadowRoot!.activeElement).toBe(q(screen, "[data-split-pick] h2"));
  });

  it("a panel holding work out of the page stays, and the app is told once it is put back", async () => {
    const { app, screen, told } = await secondPanel();
    await tick(screen, "main");
    await takeOut(screen);

    await refuse(screen);
    expect(told).toEqual([]);

    await putBack(app, screen);
    await expect.poll(() => told.length).toBe(1);
    expect(told[0]!.refusal).toBe(refusal);
    expect(whole(screen)).toEqual(["main"]);
    expect(q(screen, "[data-split-refusal]")).toBeNull();
    expect(unload()).toBe(true);

    screen.requestUpdate();
    await settled(screen);
    expect(told).toHaveLength(1);
  });
});
