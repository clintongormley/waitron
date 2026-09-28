import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { currentLocale, t } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TabLine, VisitBill } from "../api/client.js";
import { mount } from "./till-table-order-screen.test-helpers.js";
import {
  croquetas,
  current,
  currentGroup,
  fired,
  fish,
  flan,
  groups,
  now,
  orderGroup,
  row,
  salad,
  steak,
  tarta,
} from "./till-table-order-screen.current-orders.test-helpers.js";

afterEach(cleanupWidgets);

function bill(workingOrderId: string, status: VisitBill["status"]): VisitBill {
  return {
    workingOrderId,
    visitId: "v1",
    label: null,
    status,
    total: "10.00",
    outstanding: status === "open" ? "10.00" : "0.00",
    receiptAvailable: status === "settled",
  };
}

async function mountCurrent(over: Partial<TillTableOrderScreen> = {}) {
  const mounted = await mount({ groups, currentOrders: current(), now, ...over });
  mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await mounted.el.updateComplete;
  return mounted;
}

const text = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled?: boolean }>(selector);
const all = (el: TillTableOrderScreen, selector: string) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>(selector),
];
const rowOf = (el: TillTableOrderScreen, lineId: string) => q(el, `[data-group-line="${lineId}"]`)!;

function capture(el: TillTableOrderScreen, type: string): CustomEvent[] {
  const events: CustomEvent[] = [];
  el.addEventListener(type, (event) => events.push(event as CustomEvent));
  return events;
}

describe("Current orders in the Tab drawer", () => {
  it("lists the groups in sequence with every bill's rows, held, fired and added-later told apart", async () => {
    const { el } = await mountCurrent();
    expect(text(q(el, "[data-groups] h2")!)).toBe(t("table.groups_title"));
    const shown = all(el, "[data-group]");
    expect(shown.map((group) => group.dataset.group)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(shown.map((group) => group.dataset.groupState)).toEqual([
      "fired",
      "fired",
      "held",
      "held",
    ]);
    expect(
      shown.map((group) =>
        [...group.querySelectorAll<HTMLElement>("[data-group-line]")].map(
          (line) => line.dataset.groupLine,
        ),
      ),
    ).toEqual([
      ["l-croq", "l-salad", "l-beer", "l-bravas"],
      ["l-steak", "l-fish", "l-pulpo"],
      ["l-flan"],
      ["l-tarta"],
    ]);
    expect(shown.map((group) => group.querySelector("[data-group-added-later]") !== null)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(text(q(el, '[data-group="g3"] [data-group-added-later]')!)).toBe(
      t("table.group_added_later"),
    );
    expect(text(q(el, '[data-group="g4"] [data-group-kitchen]')!)).toBe(t("table.group_held"));
    // The rows stand for the server's summary.
    expect(el.shadowRoot!.querySelector("[data-group-summary]")).toBeNull();
  });

  it("says of each row only what was recorded, and how much of a partly served one is served", async () => {
    const { el } = await mountCurrent();
    const state = (lineId: string) => text(rowOf(el, lineId).querySelector("[data-row-state]")!);
    const ago = t("table.group_fired_ago").replace("{n}", "25");
    expect(state("l-croq")).toBe(ago);
    expect(text(rowOf(el, "l-croq").querySelector("[data-row-served]")!)).toBe(
      t("table.row_served_of").replace("{served}", "2").replace("{quantity}", "4"),
    );
    expect(state("l-salad")).toBe(t("table.row_served"));
    expect(state("l-beer")).toBe(t("table.group_ready"));
    expect(state("l-bravas")).toBe(t("table.group_away"));
    expect(state("l-fish")).toBe(t("table.row_preparing"));
    // A station that records nothing: fired, and no claim that it is ready.
    expect(state("l-pulpo")).toBe(ago);
    expect(text(rowOf(el, "l-pulpo"))).not.toContain(t("table.group_ready"));
    // No kitchen item, so no kitchen state at all.
    expect(rowOf(el, "l-steak").querySelector("[data-row-state]")).toBeNull();
    expect(rowOf(el, "l-salad").querySelector("[data-row-served]")).toBeNull();
    expect(rowOf(el, "l-beer").querySelector("[data-row-served]")).toBeNull();
  });

  it("shows a dish's extras and note with it, and a held row offers no Mark served", async () => {
    const { el } = await mountCurrent({
      currentOrders: current({
        groups: [currentGroup("g3", 3, "held", [{ ...flan, note: "no sugar" }])],
      }),
    });
    const flanRow = rowOf(el, "l-flan");
    expect(text(flanRow)).toContain("Flan ×2");
    expect(text(flanRow)).toContain("Cream ×2");
    expect(text(flanRow)).toContain("no sugar");
    expect(flanRow.querySelector("[data-serve-row]")).toBeNull();
    expect(q(el, '[data-serve-row="l-cream"]')).toBeNull();
    // A held row keeps its Move.
    expect(flanRow.querySelector('[data-move-line="l-flan"]')).not.toBeNull();
  });

  it("offers Mark served on a dish and not on its extras, which are served with it", async () => {
    const burger = row("l-burger", "Burger", "1.000", {
      extras: [{ lineId: "l-bacon", name: "Bacon", quantity: "2.000" }],
    });
    const { el } = await mountCurrent({
      currentOrders: current({ groups: [currentGroup("g1", 1, "fired", [burger])], ungrouped: [] }),
    });
    expect(all(el, "[data-serve-row]").map((button) => button.dataset.serveRow)).toEqual([
      "l-burger",
    ]);
    expect(q(el, '[data-group-line="l-bacon"]')).toBeNull();
    expect(text(rowOf(el, "l-burger"))).toContain("Bacon ×2");
  });

  it("marks a row of one served at once, naming the dish on the control", async () => {
    const { el } = await mountCurrent();
    const serves = capture(el, "serve-lines");
    const serve = q(el, '[data-serve-row="l-beer"]')!;
    expect(serve.getAttribute("aria-label")).toBe(`${t("table.serve")} · Beer`);
    serve.click();
    expect(serves.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ items: [{ lineId: "l-beer", quantity: "1" }] }, true, true],
    ]);
    expect(q(el, "[data-serve-dialog]")!.hasAttribute("open")).toBe(false);
  });

  it("asks how many of a row of more than one to mark served, from one to what is left, and sends that many", async () => {
    const whole = row("l-croq", "Croquetas", "4.000");
    const { el } = await mountCurrent({
      currentOrders: current({ groups: [currentGroup("g1", 1, "fired", [whole])] }),
    });
    const serves = capture(el, "serve-lines");
    q(el, '[data-serve-row="l-croq"]')!.click();
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
    const { el } = await mountCurrent();
    const serves = capture(el, "serve-lines");
    q(el, '[data-serve-row="l-croq"]')!.click();
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
    const { el } = await mountCurrent({
      currentOrders: current({ groups: [currentGroup("g1", 1, "fired", [jamon])] }),
    });
    const serves = capture(el, "serve-lines");
    q(el, '[data-serve-row="l-jamon"]')!.click();
    expect(serves.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-jamon", quantity: "0.25" }] },
    ]);
  });

  it("takes back what was marked served: a row of one at once, more than one asking how many", async () => {
    const { el } = await mountCurrent();
    const undos = capture(el, "unserve-lines");
    expect(q(el, '[data-unserve-row="l-beer"]')).toBeNull();
    const undoSalad = q(el, '[data-unserve-row="l-salad"]')!;
    expect(undoSalad.getAttribute("aria-label")).toBe(`${t("table.unserve")} · Salad`);
    undoSalad.click();
    expect(undos.map((event) => event.detail)).toEqual([
      { items: [{ lineId: "l-salad", quantity: "1" }] },
    ]);
    expect(q(el, '[data-serve-row="l-salad"]')).toBeNull();

    q(el, '[data-unserve-row="l-croq"]')!.click();
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

  it("marks a fired group served whole, only where every row is released and some is unserved", async () => {
    const recalled = { ...fish, released: false, kitchen: null };
    const { el } = await mountCurrent({
      currentOrders: current({
        groups: [
          currentGroup("g1", 1, "fired", [croquetas, salad]),
          currentGroup("g2", 2, "fired", [salad]),
          currentGroup("g3", 3, "fired", [steak, recalled]),
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
    const serves = capture(el, "serve-group");
    expect(all(el, "[data-serve-group]").map((button) => button.dataset.serveGroup)).toEqual([
      "g1",
    ]);
    const serve = q(el, '[data-serve-group="g1"]')!;
    expect(serve.getAttribute("aria-label")).toBe(
      `${t("table.serve_group")} · ${t("table.group_n").replace("{n}", "1")}`,
    );
    serve.click();
    expect(serves.map((event) => event.detail)).toEqual([{ groupId: "g1" }]);
    // Every row of group 2 is served: it says so.
    expect(text(q(el, '[data-group="g2"] [data-group-kitchen]')!)).toBe(t("table.row_served"));
    // The recalled Fish is held again.
    expect(text(rowOf(el, "l-fish").querySelector("[data-row-state]")!)).toBe(
      t("table.group_held"),
    );
    expect(rowOf(el, "l-fish").querySelector("[data-serve-row]")).toBeNull();
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
      { lineId: "l-steak", quantity: "2.000", target: { groupId: "g4" } },
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

  it("says Current orders could not be read, where the list would be", async () => {
    const { el } = await mountCurrent({ currentOrders: null, currentOrdersUnread: true });
    expect(text(q(el, "[data-groups] [data-current-orders-unread]")!)).toBe(
      t("table.current_orders_unread"),
    );
    const none = await mountCurrent({
      groups: [],
      currentOrders: null,
      currentOrdersUnread: true,
    });
    expect(q(none.el, "[data-current-orders-unread]")).not.toBeNull();
    el.currentOrdersUnread = false;
    await el.updateComplete;
    expect(q(el, "[data-current-orders-unread]")).toBeNull();
  });

  it("lists rows in no group under their own heading, each with Mark served", async () => {
    const { el } = await mountCurrent({ groups: [], currentOrders: current({ groups: [] }) });
    const loose = q(el, "[data-ungrouped]")!;
    expect(text(loose.querySelector("h3")!)).toBe(t("table.ungrouped_title"));
    expect(loose.querySelector('[data-serve-row="l-coffee"]')).not.toBeNull();
    expect(q(el, "[data-group]")).toBeNull();
  });

  it("is absent when the party has neither groups nor rows in no group", async () => {
    const { el } = await mountCurrent({
      groups: [],
      currentOrders: current({ groups: [], ungrouped: [], reminder: null }),
    });
    expect(q(el, "[data-groups]")).toBeNull();
  });

  it("offers no serving while a group command runs", async () => {
    const { el } = await mountCurrent({ groupCommandBusy: true });
    for (const selector of [
      '[data-serve-row="l-croq"]',
      '[data-unserve-row="l-salad"]',
      '[data-serve-group="g1"]',
      "[data-reminder-snooze]",
      "[data-reminder-fire]",
    ])
      expect(q(el, selector)!.disabled, selector).toBe(true);
  });

  it("without Current orders, shows this bill's rows and offers no serving", async () => {
    const lines: TabLine[] = [
      {
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
    const { el } = await mountCurrent({
      currentOrders: null,
      lines,
      groups: [{ ...orderGroup("g1", 1, "fired"), lineIds: ["l-beer"] }],
    });
    expect(text(rowOf(el, "l-beer"))).toContain("Beer ×1");
    expect(q(el, "[data-serve-row]")).toBeNull();
    expect(q(el, "[data-serve-group]")).toBeNull();
    expect(text(q(el, "[data-group-summary]")!)).toBe("summary of g1");
  });
});

describe("the release reminder in Current orders", () => {
  const reminder = (el: TillTableOrderScreen) => q(el, '[data-group="g3"] [data-group-reminder]');

  it("offers Snooze and Fire on the group once its reminder is due", async () => {
    const { el } = await mountCurrent();
    expect(reminder(el)!.dataset.groupReminder).toBe("due");
    expect(text(reminder(el)!)).toContain(t("table.reminder_due"));
    // Its own Fire replaces the group's.
    expect(q(el, '[data-group-fire="g3"]')).toBeNull();
    expect(q(el, '[data-group-fire="g4"]')).not.toBeNull();
    const snoozes = capture(el, "snooze-group");
    const fires = capture(el, "fire-group");
    const snooze = q(el, "[data-reminder-snooze]")!;
    expect(text(snooze)).toBe(t("table.reminder_snooze").replace("{n}", "5"));
    snooze.click();
    expect(snoozes.map((event) => [event.detail, event.composed])).toEqual([
      [{ groupId: "g3", minutes: 5 }, true],
    ]);
    q(el, "[data-reminder-fire]")!.click();
    await el.updateComplete;
    expect(fires).toEqual([]);
    expect(q(el, "[data-fire-dialog]")!.hasAttribute("open")).toBe(true);
    q(el, "[data-fire-confirm]")!.click();
    expect(fires.map((event) => event.detail)).toEqual([{ groupId: "g3" }]);
  });

  it("offers Snooze but not Fire where the kitchen fires", async () => {
    const { el } = await mountCurrent({ fireControl: "kitchen" });
    expect(q(el, "[data-reminder-snooze]")).not.toBeNull();
    expect(q(el, "[data-reminder-fire]")).toBeNull();
  });

  it("says when a reminder not yet due will be, with nothing to press", async () => {
    const { el } = await mountCurrent({ now: now - 5 * 60_000 });
    const time = new Intl.DateTimeFormat(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(now));
    expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
    expect(text(reminder(el)!)).toBe(t("table.reminder_at").replace("{time}", time));
    expect(q(el, "[data-reminder-snooze]")).toBeNull();
    expect(q(el, '[data-group-fire="g3"]')).not.toBeNull();
  });

  it("shows the held group without a time while the work before it is not all served", async () => {
    const { el } = await mountCurrent({
      currentOrders: current({ reminder: { groupId: "g3", dueAt: null } }),
    });
    expect(reminder(el)).toBeNull();
    expect(q(el, "[data-reminder-snooze]")).toBeNull();
  });

  it("shows no reminder when the venue has them off", async () => {
    const { el } = await mountCurrent({ currentOrders: current({ reminder: null }) });
    expect(q(el, "[data-group-reminder]")).toBeNull();
  });

  describe("on the screen's own clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows Snooze and Fire when the reminder falls due while the screen is open", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now - 60_000);
      const { el } = await mountCurrent({ now: undefined });
      expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(reminder(el)!.dataset.groupReminder).toBe("due");
      expect(q(el, "[data-reminder-snooze]")).not.toBeNull();
    });

    it.each([
      ["cannot be read", "not a time"],
      ["is beyond the longest timer a browser keeps", "2100-01-01T00:00:00.000Z"],
    ])("does not keep redrawing for a reminder time that %s", async (_why, dueAt) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const { el } = await mountCurrent({
        now: undefined,
        currentOrders: current({ reminder: { groupId: "g3", dueAt } }),
      });
      const redraws = vi.spyOn(el, "requestUpdate");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(redraws).not.toHaveBeenCalled();
      expect(q(el, "[data-reminder-snooze]")).toBeNull();
    });

    it("shows Snooze and Fire on coming back to the page after the reminder fell due", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now - 60_000);
      const { el } = await mountCurrent({ now: undefined });
      const parent = el.parentElement!;
      el.remove();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(reminder(el)!.dataset.groupReminder).toBe("waiting");
      parent.append(el);
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(reminder(el)!.dataset.groupReminder).toBe("due");
    });
  });
});
