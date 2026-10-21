import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { DraftStore } from "../state/draft-sync.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function open(over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mount({ currentOrders: current(), groups, now, ...over });
  el.style.width = "1280px";
  await resized(el);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!);
  await panel.updateComplete;
  const more = panel.shadowRoot!.querySelector<WtRowActions>('[data-group-more="g3"]')!;
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  const button = more.querySelector<HTMLElement>("[data-group-later]")!;
  expect(button).not.toBeNull();
  return { el, panel, button };
}
function collect(el: TillTableOrderScreen, name: string) {
  const events: CustomEvent[] = [];
  el.addEventListener(name, (event) => events.push(event as CustomEvent));
  return events;
}
it("the native Sent heading menu dispatches exactly one existing reorder command", async () => {
  const { el, button } = await open();
  const commands = collect(el, "reorder-groups");
  const childEvents = collect(el, "reorder-held");
  await userEvent.click(button);
  expect(commands.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
    [{ heldGroupIds: ["g4", "g3"] }, true, true],
  ]);
  expect(childEvents).toEqual([]);
});

it.each([
  "busy",
  "groupCommandBusy",
  "api",
  "party",
  "bill",
  "serviceVisit",
  "unread",
  "revision",
  "summary-fired",
  "disconnected",
] as const)(
  "an existing Sent reorder cannot escape after the table screen's %s changes",
  async (change) => {
    const { el, button } = await open();
    const events = collect(el, "reorder-groups");
    if (change === "busy" || change === "groupCommandBusy") el[change] = true;
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
    if (change === "bill") el.orderId = "other";
    if (change === "serviceVisit") el.serviceVisit++;
    if (change === "unread") el.currentOrdersUnread = true;
    if (change === "revision") el.currentOrders = { ...current(), revision: 8 };
    if (change === "summary-fired")
      el.groups = groups.map((group) => (group.id === "g4" ? { ...group, state: "fired" } : group));
    if (change === "disconnected") el.remove();
    button.click();
    expect(events).toEqual([]);
  },
);

it.each(["waiter", "kitchen", "expo"] as const)(
  "held reorder stays shared with a locked outbox, paid food and %s fire control",
  async (fireControl) => {
    const draft = new DraftStore();
    draft.lockEdits();
    const orders = structuredClone(current());
    for (const group of orders.groups) for (const row of group.rows) row.billStatus = "settled";
    const { el, button } = await open({
      draftStore: draft,
      ...{ fireControl },
      editSentLines: false,
      currentOrders: orders,
    });
    const events = collect(el, "reorder-groups");
    await userEvent.click(button);
    expect(events.map((event) => event.detail)).toEqual([{ heldGroupIds: ["g4", "g3"] }]);
  },
);
