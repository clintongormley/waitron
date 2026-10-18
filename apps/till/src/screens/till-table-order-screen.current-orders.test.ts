import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { userEvent } from "vitest/browser";
import {
  chooseSentServing,
  openSentDish,
  openSentMore,
  sentPanelFor,
} from "./till-table-order-screen.sent.test-helpers.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { TabLine, PartyBill } from "../api/client.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import {
  croquetas,
  current,
  currentGroup,
  fired,
  fish,
  flan,
  groups,
  heldAt,
  laterHeldAt,
  now,
  orderGroup,
  row,
  salad,
  snoozed,
  steak,
  tarta,
} from "./till-table-order-screen.current-orders.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

function bill(workingOrderId: string, status: PartyBill["status"]): PartyBill {
  return {
    workingOrderId,
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status,
    total: "10.00",
    outstanding: status === "open" ? "10.00" : "0.00",
    hasPayments: false,
    receiptAvailable: status === "settled",
  };
}

async function mountCurrent(over: Partial<TillTableOrderScreen> = {}) {
  const mounted = await mount({ groups, currentOrders: current(), now, ...over });
  mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await mounted.el.updateComplete;
  return mounted;
}

async function mountSent(over: Partial<TillTableOrderScreen> = {}) {
  const mounted = await mount({ groups, currentOrders: current(), now, ...over });
  await sentPanelFor(mounted.el);
  return mounted;
}

const text = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled?: boolean }>(selector);
const all = (el: TillTableOrderScreen, selector: string) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>(selector),
];
const sq = (el: TillTableOrderScreen, selector: string) =>
  el
    .shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!
    .shadowRoot!.querySelector<HTMLElement & { disabled?: boolean }>(selector);
async function unfoldSent(el: TillTableOrderScreen) {
  const panel = await sentPanelFor(el);
  for (const selector of ["[data-sent-toggle]", "[data-served-toggle]", "[data-held-toggle]"]) {
    const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector);
    if (toggle?.getAttribute("aria-expanded") === "false") {
      await userEvent.click(toggle);
      await panel.updateComplete;
    }
  }
  return panel;
}

async function closeSentDish(el: TillTableOrderScreen) {
  const dialog = q(el, "[data-sent-line-dialog]")!;
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(q(el, "[data-sent-line-close]")!);
  await closed;
  await el.updateComplete;
}

const rowOf = (el: TillTableOrderScreen, lineId: string) => q(el, `[data-group-line="${lineId}"]`)!;

function capture(el: TillTableOrderScreen, type: string): CustomEvent[] {
  const events: CustomEvent[] = [];
  el.addEventListener(type, (event) => events.push(event as CustomEvent));
  return events;
}

describe("Current orders and Sent service", () => {
  it("keeps held groups in sequence and separates this bill's fired and served rows", async () => {
    const { el } = await mountSent();
    const panel = await unfoldSent(el);
    expect(text(sq(el, "[data-sent-toggle]")!)).toContain(t("table.sent_title"));
    const shown = [...panel.shadowRoot!.querySelectorAll<HTMLElement>("[data-held-group]")];
    expect(shown.map((group) => group.dataset.heldGroup)).toEqual(["g3", "g4"]);
    expect(
      shown.map((group) =>
        [...group.querySelectorAll<HTMLElement>("[data-held-line]")].map(
          (line) => line.dataset.heldLine,
        ),
      ),
    ).toEqual([["l-flan"], ["l-tarta"]]);
    expect(
      [...panel.shadowRoot!.querySelectorAll<HTMLElement>("[data-fired-line]")].map(
        (line) => line.dataset.firedLine,
      ),
    ).toEqual(["l-beer", "l-bravas", "l-coffee", "l-croq", "l-fish", "l-steak"]);
    expect(
      [...panel.shadowRoot!.querySelectorAll<HTMLElement>("[data-served-line]")].map(
        (line) => line.dataset.servedLine,
      ),
    ).toEqual(["l-croq", "l-salad"]);
    expect(text(sq(el, '[data-held-line="l-tarta"] .status')!)).toBe(t("table.group_held"));
    expect(panel.shadowRoot!.querySelector("[data-group-summary]")).toBeNull();
    expect(panel.shadowRoot!.querySelector('[data-fired-line="l-pulpo"]')).toBeNull();
    el.orderId = "wo-check";
    await el.updateComplete;
    await unfoldSent(el);
    expect(sq(el, '[data-fired-line="l-pulpo"]')).not.toBeNull();
    expect(sq(el, '[data-fired-line="l-croq"]')).toBeNull();
  });

  describe("the sent dish window says when its group was sent and by whom", () => {
    const clock = (iso: string) =>
      new Intl.DateTimeFormat(currentLocale(), { hour: "2-digit", minute: "2-digit" }).format(
        new Date(iso),
      );
    const sentOf = async (el: TillTableOrderScreen) => {
      const facts: (string | null)[] = [];
      for (const [lineId, kind] of [
        ["l-beer", "fired"],
        ["l-fish", "fired"],
        ["l-flan", "held"],
        ["l-tarta", "held"],
      ] as const) {
        await openSentDish(el, lineId, kind);
        const fact = q(el, "[data-sent-line-origin]");
        facts.push(fact === null ? null : text(fact));
        await closeSentDish(el);
      }
      return facts;
    };
    // Group 1's sent time differs from its fired time, so showing the one for the other fails.
    const sentBeforeFired = "2026-09-28T19:45:00.000Z";
    const mountSent = () =>
      mount({
        groups,
        now,
        currentOrders: current({
          groups: current().groups.map((group) =>
            group.id === "g1" ? { ...group, sentAt: sentBeforeFired } : group,
          ),
        }),
      });

    it("in English: fired groups say Sent, held ones Held, and a sender with no name is left out", async () => {
      const { el } = await mountSent();
      expect(await sentOf(el)).toEqual([
        `Sent ${clock(sentBeforeFired)} by Luis`,
        `Sent ${clock(fired)}`,
        `Held ${clock(heldAt)} by Ana`,
        `Held ${clock(laterHeldAt)}`,
      ]);
    });

    it("in Spanish", async () => {
      setLocale("es");
      const { el } = await mountSent();
      expect(await sentOf(el)).toEqual([
        `Enviado a las ${clock(sentBeforeFired)} por Luis`,
        `Enviado a las ${clock(fired)}`,
        `En espera desde las ${clock(heldAt)}, por Ana`,
        `En espera desde las ${clock(laterHeldAt)}`,
      ]);
    });
  });

  it("says of each row only what was recorded, and how much of a partly served one is served", async () => {
    const { el } = await mountSent();
    const state = async (lineId: string, kind: "fired" | "served" = "fired") => {
      await openSentDish(el, lineId, kind);
      return text(q(el, "[data-sent-line-status]")!);
    };
    const ago = t("table.group_fired_ago").replace("{n}", "25");
    expect(await state("l-croq")).toBe(ago);
    expect(q(el, "[data-sent-line-served]")?.textContent?.trim() ?? null).toBe(
      t("table.row_served_of").replace("{served}", "2").replace("{quantity}", "4"),
    );
    await closeSentDish(el);
    for (const [id, kind, wanted] of [
      ["l-salad", "served", t("table.row_served")],
      ["l-beer", "fired", t("table.group_ready")],
      ["l-bravas", "fired", t("table.group_away")],
      ["l-fish", "fired", t("table.row_preparing")],
      ["l-steak", "fired", ""],
    ] as const) {
      expect(await state(id, kind)).toBe(wanted);
      if (id === "l-salad" || id === "l-beer") expect(q(el, "[data-sent-line-served]")).toBeNull();
      await closeSentDish(el);
    }
    el.orderId = "wo-check";
    await el.updateComplete;
    expect(await state("l-pulpo")).toBe(ago);
    expect(text(q(el, "[data-sent-line-dialog]")!)).not.toContain(t("table.group_ready"));
  });

  it("shows a dish's extras and note with it, and a held row offers no Mark served", async () => {
    const { el } = await mountSent({
      currentOrders: current({
        groups: [currentGroup("g3", 3, "held", [{ ...flan, note: "no sugar" }])],
      }),
    });
    await unfoldSent(el);
    const flanRow = sq(el, '[data-held-line="l-flan"]')!;
    expect(text(flanRow)).toContain("Flan ×2");
    expect(text(flanRow)).toContain("Cream ×2");
    expect(text(flanRow)).toContain("no sugar");
    expect(flanRow.querySelector("[data-serve-line]")).toBeNull();
    expect(sq(el, '[data-serve-line="l-cream"]')).toBeNull();
    await openSentDish(el, "l-flan", "held");
    expect(q(el, "[data-sent-line-serve]")).toBeNull();
    await openSentMore(el);
    expect(q(el, "[data-sent-line-fire]")).not.toBeNull();
    expect(q(el, "[data-move-line]")).toBeNull();
    expect(q(el, "[data-split-group-line]")).toBeNull();
  });

  it("offers Mark served on a dish and not on its extras, which are served with it", async () => {
    const burger = row("l-burger", "Burger", "1.000", {
      netAmount: "4.00",
      extras: [
        {
          lineId: "l-bacon",
          name: "Bacon",
          quantity: "2.000",
          netAmount: "2.00",
          unitPriceGross: "1.00",
          priceQuantity: "1.000",
        },
      ],
    });
    const { el } = await mountSent({
      currentOrders: current({ groups: [currentGroup("g1", 1, "fired", [burger])], ungrouped: [] }),
    });
    const panel = await unfoldSent(el);
    expect(
      [...panel.shadowRoot!.querySelectorAll<HTMLElement>("[data-serve-line]")].map(
        (button) => button.dataset.serveLine,
      ),
    ).toEqual(["l-burger"]);
    expect(sq(el, '[data-fired-line="l-bacon"]')).toBeNull();
    expect(text(sq(el, '[data-fired-line="l-burger"]')!)).toContain("Bacon ×2");
    const serves = capture(el, "serve-lines");
    await userEvent.click(sq(el, '[data-serve-line="l-burger"]')!);
    expect(serves.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-burger", quantity: "1" }] },
    ]);
  });

  it("marks a row of one served at once, naming the dish on the control", async () => {
    const { el } = await mountSent();
    const serves = capture(el, "serve-lines");
    await openSentDish(el, "l-beer");
    const serve = q(el, "[data-sent-line-serve]")!;
    expect(serve.getAttribute("aria-label")).toBe(`${t("table.serve")} · Beer`);
    serve.click();
    expect(serves.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ items: [{ lineId: "l-beer", quantity: "1" }] }, true, true],
    ]);
    expect(q(el, "[data-serve-dialog]")!.hasAttribute("open")).toBe(false);
  });

  it("asks how many of a row of more than one to mark served, from one to what is left, and sends that many", async () => {
    const whole = row("l-croq", "Croquetas", "4.000");
    const { el } = await mountSent({
      currentOrders: current({ groups: [currentGroup("g1", 1, "fired", [whole])] }),
    });
    const serves = capture(el, "serve-lines");
    await chooseSentServing(el, "l-croq");
    await el.updateComplete;
    expect(serves).toEqual([]);
    const dialog = q(el, "[data-serve-dialog]")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(text(dialog)).toContain("Croquetas ×4");
    const count = () => text(q(el, "[data-serve-count]")!);
    expect(count()).toBe("4");
    expect(q(el, "[data-serve-inc]")!.disabled).toBe(true);
    q(el, "[data-serve-dec]")!.click();
    await el.updateComplete;
    q(el, "[data-serve-dec]")!.click();
    await el.updateComplete;
    expect(count()).toBe("2");
    q(el, "[data-serve-inc]")!.click();
    await el.updateComplete;
    q(el, "[data-serve-dec]")!.click();
    await el.updateComplete;
    expect(text(q(el, "[data-serve-confirm]")!)).toBe(t("table.serve_n").replace("{n}", "2"));
    q(el, "[data-serve-confirm]")!.click();
    await el.updateComplete;
    expect(serves.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-croq", quantity: "2" }] },
    ]);
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("offers what is left of a partly served row, and never less than one", async () => {
    const { el } = await mountSent();
    const serves = capture(el, "serve-lines");
    await chooseSentServing(el, "l-croq");
    await el.updateComplete;
    expect(text(q(el, "[data-serve-dialog]")!)).toContain(
      t("table.row_served_of").replace("{served}", "2").replace("{quantity}", "4"),
    );
    expect(text(q(el, "[data-serve-count]")!)).toBe("2");
    q(el, "[data-serve-dec]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-serve-dec]")!.disabled).toBe(true);
    expect(text(q(el, "[data-serve-confirm]")!)).toBe(t("table.serve_n_one"));
    q(el, "[data-serve-dismiss]")!.click();
    await el.updateComplete;
    expect(serves).toEqual([]);
    expect(q(el, "[data-serve-dialog]")!.hasAttribute("open")).toBe(false);
  });

  it("serves a weighed row whole, as there are no units to count", async () => {
    const jamon = row("l-jamon", "Jamón", "0.250", { unitPrecision: 3 });
    const { el } = await mountSent({
      currentOrders: current({ groups: [currentGroup("g1", 1, "fired", [jamon])] }),
    });
    const serves = capture(el, "serve-lines");
    await chooseSentServing(el, "l-jamon");
    expect(serves.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-jamon", quantity: "0.25" }] },
    ]);
  });

  it("takes back what was marked served: a row of one at once, more than one asking how many", async () => {
    const { el } = await mountSent();
    const undos = capture(el, "unserve-lines");
    await openSentDish(el, "l-beer");
    expect(q(el, "[data-sent-line-unserve]")).toBeNull();
    await userEvent.click(q(el, "[data-sent-line-close]")!);
    await openSentDish(el, "l-salad", "served");
    await openSentMore(el);
    const undoSalad = q(el, "[data-sent-line-unserve]")!;
    expect(undoSalad.getAttribute("aria-label")).toBe(`${t("table.unserve")} · Salad`);
    undoSalad.click();
    expect(undos.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-salad", quantity: "1" }] },
    ]);
    expect(sq(el, '[data-serve-line="l-salad"]')).toBeNull();

    await chooseSentServing(el, "l-croq", true);
    await el.updateComplete;
    expect(text(q(el, "[data-serve-count]")!)).toBe("2");
    expect(q(el, "[data-serve-inc]")!.disabled).toBe(true);
    q(el, "[data-serve-dec]")!.click();
    await el.updateComplete;
    expect(text(q(el, "[data-serve-confirm]")!)).toBe(t("table.unserve_n").replace("{n}", "1"));
    q(el, "[data-serve-confirm]")!.click();
    expect(undos.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-salad", quantity: "1" }] },
      { items: [{ lineId: "l-croq", quantity: "1" }] },
    ]);
  });

  it("All served marks this bill's released remainders, excluding served and still held food", async () => {
    const withheld = { ...fish, released: false, kitchen: null };
    const { el } = await mountSent({
      currentOrders: current({
        groups: [
          currentGroup("g1", 1, "fired", [croquetas, salad]),
          currentGroup("g2", 2, "fired", [salad]),
          currentGroup("g3", 3, "fired", [steak, withheld]),
          currentGroup("g4", 4, "held", [tarta]),
        ],
      }),
      groups: [
        orderGroup("g1", 1, "fired"),
        orderGroup("g2", 2, "fired"),
        orderGroup("g3", 3, "fired"),
        orderGroup("g4", 4, "held"),
      ],
    });
    await unfoldSent(el);
    const serves = capture(el, "serve-lines");
    const serve = sq(el, "[data-serve-all]")!;
    expect(text(serve)).toBe(t("table.serve_group"));
    await userEvent.click(serve);
    expect(serves.map((event) => event.detail)).toEqual([
      {
        items: [
          { lineId: "l-coffee", quantity: "1" },
          { lineId: "l-croq", quantity: "2" },
          { lineId: "l-steak", quantity: "1" },
        ],
      },
    ]);
    await openSentDish(el, "l-salad", "served");
    expect(text(q(el, "[data-sent-line-status]")!)).toBe(t("table.row_served"));
    await closeSentDish(el);
    expect(sq(el, '[data-serve-line="l-fish"]')!.disabled).toBe(true);
    await openSentDish(el, "l-fish");
    expect(text(q(el, "[data-sent-line-status]")!)).toBe(t("table.group_held"));
    expect(q(el, "[data-sent-line-serve]")).toBeNull();
  });

  it("keeps an open dish window when a retained serve action meets an unreleased component", async () => {
    const { el } = await mountSent();
    await openSentDish(el, "l-beer");
    const serve = q(el, "[data-sent-line-serve]")!;
    const serves = capture(el, "serve-lines");
    el.currentOrders = current({
      groups: [
        currentGroup("g1", 1, "fired", [row("l-beer", "Beer", "1.000", { released: false })]),
      ],
    });
    serve.click();
    await el.updateComplete;
    expect(serves).toEqual([]);
    expect(q(el, "[data-sent-line-dialog]")!.hasAttribute("open")).toBe(true);
    expect(q(el, "[data-sent-line-serve]")).toBeNull();
  });

  it("refreshes an open dish's group facts and removes them when its group no longer contains it", async () => {
    const { el } = await mountSent();
    await openSentDish(el, "l-beer");
    const clock = (value: string) =>
      new Intl.DateTimeFormat(currentLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    const origin = () => text(q(el, "[data-sent-line-origin]")!);
    expect(origin()).toBe(`Sent ${clock(fired)} by Luis`);
    el.currentOrders = current({
      groups: [
        currentGroup("changed", 8, "fired", [row("l-beer", "Beer", "1.000")], {
          sentAt: heldAt,
          sentBy: "Ana $& $'",
        }),
      ],
    });
    await el.updateComplete;
    expect(origin()).toBe(`Sent ${clock(heldAt)} by Ana $& $'`);
    el.currentOrders = current({
      groups: [currentGroup("unrelated", 9, "held", [flan])],
      ungrouped: [row("l-beer", "Beer", "1.000")],
    });
    await el.updateComplete;
    expect(q(el, "[data-sent-line-origin]")).toBeNull();
    expect(q(el, "[data-sent-line-dialog]")!.hasAttribute("open")).toBe(true);
  });

  it("moves a held row on any open bill of the party, and splits one sold by the unit with no extras", async () => {
    const steaks = row("l-steak", "Steak", "2.000", {
      workingOrderId: "wo-check",
      released: false,
      kitchen: null,
    });
    const { el } = await mountCurrent({
      currentOrders: current({ groups: [currentGroup("g3", 3, "held", [steaks, flan])] }),
      bills: [bill("wo-4", "open"), bill("wo-check", "open")],
    });
    const moves = capture(el, "move-group-line");
    const splits = capture(el, "split-group-line");
    expect(all(el, "[data-split-group-line]").map((b) => b.dataset.splitGroupLine)).toEqual([
      "l-steak",
    ]);
    q(el, '[data-split-group-line="l-steak"]')!.click();
    expect(splits.map((event) => event.detail)).toEqual([
      { lineId: "l-steak", groupId: "g3", quantity: "2.000" },
    ]);
    q(el, '[data-move-line="l-steak"]')!.click();
    await el.updateComplete;
    expect(text(q(el, "[data-move-dialog] .move-dish")!)).toBe("Steak ×2");
    q(el, '[data-move-target="g4"]')!.click();
    expect(moves.map((event) => event.detail)).toEqual([
      { lineId: "l-steak", quantity: "2.000", target: { groupId: "g4" }, expectedEdits: null },
    ]);
  });

  it("offers Move and Split only on a held row whose bill is open, as the server moves nothing off a paid bill", async () => {
    const held = { released: false, kitchen: null };
    const onCheck = row("l-check", "Steak", "2.000", { ...held, workingOrderId: "wo-check" });
    const onPaid = row("l-paid", "Steak", "2.000", { ...held, workingOrderId: "wo-paid" });
    const unlisted = row("l-unlisted", "Steak", "2.000", { ...held, workingOrderId: "wo-gone" });
    const onShown = row("l-shown", "Steak", "2.000", { ...held, workingOrderId: "wo-4" });
    const { el } = await mountCurrent({
      currentOrders: current({
        groups: [currentGroup("g3", 3, "held", [onCheck, onPaid, unlisted, onShown])],
      }),
      bills: [bill("wo-check", "open"), bill("wo-paid", "settled")],
    });
    const offered = (selector: string, attribute: string) =>
      all(el, selector).map((button) => button.getAttribute(attribute));
    // The bill on screen is open even when the party's bills have not been read.
    expect(offered("[data-move-line]", "data-move-line")).toEqual(["l-check", "l-shown"]);
    expect(offered("[data-split-group-line]", "data-split-group-line")).toEqual([
      "l-check",
      "l-shown",
    ]);
    expect(text(rowOf(el, "l-paid"))).toBe("Steak ×2");
  });

  it("says the sent orders could not be read, where Sent would be", async () => {
    const { el } = await mountSent({ currentOrders: null, currentOrdersUnread: true });
    expect(text(q(el, "[data-sent-orders] [data-sent-unread]")!)).toBe(
      t("table.current_orders_unread"),
    );
    const none = await mountSent({ groups: [], currentOrders: null, currentOrdersUnread: true });
    expect(q(none.el, "[data-sent-unread]")).not.toBeNull();
    el.currentOrdersUnread = false;
    await el.updateComplete;
    expect(q(el, "[data-sent-unread]")).toBeNull();
  });

  it("includes rows in no group in Fired, with Mark served and no invented group", async () => {
    const { el } = await mountSent({ groups: [], currentOrders: current({ groups: [] }) });
    await unfoldSent(el);
    expect(sq(el, '[data-serve-line="l-coffee"]')).not.toBeNull();
    expect(sq(el, "[data-held-group]")).toBeNull();
    await openSentDish(el, "l-coffee");
    expect(q(el, "[data-sent-line-origin]")).toBeNull();
  });

  it("is absent when the party has neither groups nor rows in no group", async () => {
    const { el } = await mountSent({
      groups: [],
      currentOrders: current({ groups: [], ungrouped: [], reminder: null }),
    });
    expect(sq(el, "[data-sent-panel]")).toBeNull();
  });

  it("offers no serving while a group command runs", async () => {
    const { el } = await mountSent();
    await unfoldSent(el);
    await openSentDish(el, "l-salad", "served");
    await openSentMore(el);
    const serves = capture(el, "serve-lines");
    const undoes = capture(el, "unserve-lines");
    el.groupCommandBusy = true;
    await el.updateComplete;
    await sentPanelFor(el);
    for (const selector of [
      '[data-serve-line="l-croq"]',
      "[data-serve-all]",
      "[data-reminder-snooze]",
      "[data-reminder-fire]",
    ])
      expect(sq(el, selector)!.disabled, selector).toBe(true);
    expect(q(el, "[data-sent-line-unserve]")!.disabled).toBe(true);
    sq(el, '[data-serve-line="l-croq"]')!.click();
    sq(el, "[data-serve-all]")!.click();
    q(el, "[data-sent-line-unserve]")!.click();
    expect(serves).toEqual([]);
    expect(undoes).toEqual([]);
  });

  it("without Current orders, keeps this bill's rows read-only in Sent", async () => {
    const lines: TabLine[] = [
      {
        stationId: null,
        movable: false,
        id: "l-beer",
        groupId: "g1",
        lineNo: 1,
        name: "Beer",
        productId: "beer",
        quantity: "1.000",
        unitPrecision: 0,
        unitPriceGross: "3.00",
        servedAt: null,
        courseId: null,
        sentAt: fired,
        firedAt: fired,
        state: "queued",
        note: null,
        listId: null,
        menuItemId: null,
        parentProductId: null,
      },
    ];
    const { el } = await mountSent({
      currentOrders: null,
      lines,
      groups: [{ ...orderGroup("g1", 1, "fired"), lineIds: ["l-beer"] }],
    });
    expect(text(q(el, '[data-sent-fallback-line="l-beer"]')!)).toContain("Beer ×1");
    expect(q(el, "[data-serve-row]")).toBeNull();
    expect(q(el, "[data-serve-group]")).toBeNull();
    expect(q(el, "[data-group-summary]")).toBeNull();
    expect(q(el, "[data-sent-fallback] wt-button")).toBeNull();
  });
});

describe("the release reminder in Sent", () => {
  const reminder = (el: TillTableOrderScreen) => sq(el, "[data-group-reminder]");

  it("keeps a due reminder only in Sent when the bill drawer is open", async () => {
    const { el } = await mountSent();
    q(el, "[data-open-drawer]")!.click();
    await el.updateComplete;
    expect(sq(el, "[data-reminder-snooze]")).not.toBeNull();
    expect(sq(el, "[data-reminder-fire]")).not.toBeNull();
    expect(q(el, "[data-drawer] [data-reminder-snooze]")).toBeNull();
    expect(q(el, "[data-drawer] [data-reminder-fire]")).toBeNull();
  });

  it("offers Snooze and Fire on the group once its reminder is due", async () => {
    const { el } = await mountSent();
    expect(reminder(el)!.dataset.groupReminder).toBe("due");
    expect(text(reminder(el)!)).toContain(t("table.reminder_due"));
    // The collapsed box keeps the due action available without exposing its held rows.
    expect(sq(el, '[data-group-fire="g3"]')).toBeNull();
    expect(sq(el, '[data-group-fire="g4"]')).toBeNull();
    const snoozes = capture(el, "snooze-group");
    const fires = capture(el, "fire-group");
    const snooze = sq(el, "[data-reminder-snooze]")!;
    expect(text(snooze)).toBe(t("table.reminder_snooze").replace("{n}", "5"));
    snooze.click();
    expect(snoozes.map((event) => [event.detail, event.composed])).toEqual([
      [{ groupId: "g3", minutes: 5 }, true],
    ]);
    sq(el, "[data-reminder-fire]")!.click();
    await el.updateComplete;
    expect(fires).toEqual([]);
    expect(q(el, "[data-fire-dialog]")!.hasAttribute("open")).toBe(true);
    q(el, "[data-fire-confirm]")!.click();
    expect(fires.map((event) => event.detail)).toEqual([{ groupId: "g3" }]);
    await el.updateComplete;
    await userEvent.click(sq(el, "[data-held-toggle]")!);
    await el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!.updateComplete;
    expect(sq(el, '[data-group-fire="g4"]')).not.toBeNull();
  });

  it("offers Snooze and confirmed Fire where the kitchen fires", async () => {
    const { el } = await mountSent({ fireControl: "kitchen" });
    expect(sq(el, "[data-reminder-snooze]")).not.toBeNull();
    expect(sq(el, "[data-reminder-fire]")).not.toBeNull();
  });

  it("says when a reminder not yet due will be, with nothing to press", async () => {
    const { el } = await mountSent({ now: now - 5 * 60_000 });
    const time = new Intl.DateTimeFormat(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(now));
    expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
    expect(text(reminder(el)!.querySelector("span")!)).toBe(
      `${t("table.group_n").replace("{n}", "3")} · ${t("table.reminder_at").replace("{time}", time)}`,
    );
    expect(sq(el, "[data-reminder-snooze]")).toBeNull();
    expect(sq(el, "[data-reminder-fire]")).toBeNull();
    const panel = await sentPanelFor(el);
    await userEvent.click(sq(el, "[data-sent-toggle]")!);
    await panel.updateComplete;
    await userEvent.click(sq(el, "[data-held-toggle]")!);
    await panel.updateComplete;
    expect(sq(el, '[data-group-fire="g3"]')).not.toBeNull();
  });

  it("shows the held group without a time while the work before it is not all served", async () => {
    const { el } = await mountSent({
      currentOrders: current({ reminder: { groupId: "g3", dueAt: null } }),
    });
    expect(reminder(el)).toBeNull();
    expect(sq(el, "[data-reminder-snooze]")).toBeNull();
  });

  it("shows no reminder when the venue has them off", async () => {
    const { el } = await mountSent({ currentOrders: current({ reminder: null }) });
    expect(sq(el, "[data-group-reminder]")).toBeNull();
  });

  it("offers Clear snooze beside Snooze on a due reminder that was snoozed", async () => {
    const { el } = await mountSent({ currentOrders: snoozed() });
    expect(reminder(el)!.dataset.groupReminder).toBe("due");
    const clear = reminder(el)!.querySelector<HTMLElement>("[data-reminder-unsnooze]")!;
    expect(text(clear)).toBe(t("table.reminder_clear_snooze"));
    expect(clear.getAttribute("aria-label")).toBe(
      `${t("table.reminder_clear_snooze")} · ${t("table.group_n").replace("{n}", "3")}`,
    );
    expect(reminder(el)!.querySelector("[data-reminder-snooze]")).not.toBeNull();
    const clears = capture(el, "unsnooze-group");
    clear.click();
    expect(clears.map((event) => [event.detail, event.composed])).toEqual([
      [{ groupId: "g3" }, true],
    ]);
  });

  it("says when a snoozed reminder not yet due will be, with Clear snooze beside it", async () => {
    const { el } = await mountSent({ currentOrders: snoozed(), now: now - 5 * 60_000 });
    const time = new Intl.DateTimeFormat(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(now));
    expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
    expect(text(reminder(el)!.querySelector("span")!)).toBe(
      `${t("table.group_n").replace("{n}", "3")} · ${t("table.reminder_at").replace("{time}", time)}`,
    );
    const clear = reminder(el)!.querySelector<HTMLElement>("[data-reminder-unsnooze]")!;
    expect(text(clear)).toBe(t("table.reminder_clear_snooze"));
    expect(sq(el, "[data-reminder-snooze]")).toBeNull();
  });

  it.each([
    ["due", now],
    ["not yet due", now - 5 * 60_000],
  ])("offers no Clear snooze on a %s reminder nobody snoozed", async (_state, at) => {
    const { el } = await mountSent({ now: at });
    expect(reminder(el)).not.toBeNull();
    expect(sq(el, "[data-reminder-unsnooze]")).toBeNull();
  });

  it("offers no Clear snooze while the snoozed group's reminder has no time", async () => {
    const { el } = await mountSent({ currentOrders: snoozed(null) });
    expect(reminder(el)).toBeNull();
    expect(sq(el, "[data-reminder-unsnooze]")).toBeNull();
  });

  it("disables Clear snooze while a group command is under way", async () => {
    const { el } = await mountSent({ currentOrders: snoozed(), groupCommandBusy: true });
    expect(sq(el, "[data-reminder-unsnooze]")!.disabled).toBe(true);
  });

  describe("on the screen's own clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows Snooze and Fire when the reminder falls due while the screen is open", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now - 60_000);
      const { el } = await mountSent({ now: undefined });
      expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      await el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!.updateComplete;
      expect(reminder(el)!.dataset.groupReminder).toBe("due");
      expect(sq(el, "[data-reminder-snooze]")).not.toBeNull();
    });

    it.each([
      ["cannot be read", "not a time"],
      ["is beyond the longest timer a browser keeps", "2100-01-01T00:00:00.000Z"],
    ])("does not keep redrawing for a reminder time that %s", async (_why, dueAt) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const { el } = await mountSent({
        now: undefined,
        currentOrders: current({ reminder: { groupId: "g3", dueAt } }),
      });
      // The width watch reports on its first frame, setting `wide` even when unchanged.
      await resized(el);
      const panel = await sentPanelFor(el);
      const redraws = vi.spyOn(panel, "requestUpdate");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(redraws).not.toHaveBeenCalled();
      expect(sq(el, "[data-reminder-snooze]")).toBeNull();
    });

    it("shows Snooze and Fire on coming back to the page after the reminder fell due", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now - 60_000);
      const { el } = await mountSent({ now: undefined });
      const parent = el.parentElement!;
      el.remove();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
      parent.append(el);
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      await el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!.updateComplete;
      expect(reminder(el)!.dataset.groupReminder).toBe("due");
    });
  });
});

describe("held-line move editing observation", () => {
  it("retains the source bill observation from opening when another bill is on screen", async () => {
    const own = { billId: "wo-4", editorVersion: 2, draftId: null, draftRevision: null };
    const source = {
      billId: "wo-check",
      editorVersion: 7,
      draftId: "draft-check",
      draftRevision: 3,
    };
    const { el } = await mountCurrent({
      orderId: "wo-4",
      billEdit: own,
      billEdits: [own, source],
      bills: [bill("wo-4", "open"), bill("wo-check", "open")],
      currentOrders: current({
        groups: [
          currentGroup("g3", 3, "held", [
            row("other-line", "Other bill dish", "2.000", {
              workingOrderId: "wo-check",
              released: false,
            }),
          ]),
        ],
      }),
    });
    const events = capture(el, "move-group-line");
    q(el, '[data-move-line="other-line"]')!.click();
    await el.updateComplete;
    el.billEdits = [own, { ...source, editorVersion: 9, draftRevision: 5 }];
    await el.updateComplete;
    q(el, '[data-move-target="g4"]')!.click();
    expect(events[0]!.detail).toEqual({
      lineId: "other-line",
      quantity: "2.000",
      target: { groupId: "g4" },
      expectedEdits: [source],
    });
    expect(events[0]!.bubbles && events[0]!.composed).toBe(true);
  });
});
