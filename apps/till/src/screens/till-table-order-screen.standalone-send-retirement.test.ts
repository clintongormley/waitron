import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { TabLine } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { SubmitDraftDetail } from "./till-table-order-screen.js";
import { orderGroup } from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish, storedExtra } from "./till-table-order-screen.sent-fallback.test-helpers.js";
import { beer, mount, resized } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

it.each(["ungrouped", "old-fired-group", "absent-parent"] as const)(
  "resends a recalled %s dish through New order with its recorded identity and charge",
  async (where) => {
    const source: TabLine = {
      ...storedDish,
      groupId: where === "old-fired-group" ? "old-fired-group" : null,
      ...(where === "absent-parent" ? {} : { parentLineNo: null }),
    };
    const { el } = await mount({
      lines: [source],
      groups: [orderGroup("old-fired-group", 1, "fired")],
    });
    el.style.width = "1280px";
    await resized(el);
    el.draftStore!.appendLines([
      {
        product: beer,
        quantity: "2.000",
        draftLineId: "recalled-dish",
        source: { line: source, extras: [], netAmount: "6.50" },
        place: { kind: "fire" },
      },
    ]);
    await el.updateComplete;
    const submitted: CustomEvent<SubmitDraftDetail>[] = [];
    const direct: CustomEvent[] = [];
    el.addEventListener("submit-draft", (event) =>
      submitted.push(event as CustomEvent<SubmitDraftDetail>),
    );
    el.addEventListener("send-lines", (event) => direct.push(event as CustomEvent));
    const send = el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!;
    expect(send.checkVisibility()).toBe(true);
    await userEvent.click(send);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.bubbles && submitted[0]!.composed).toBe(true);
    expect(submitted[0]!.detail.lines).toEqual([]);
    expect(submitted[0]!.detail.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
    expect(
      submitted[0]!.detail.sent.map((line) => ({
        draftLineId: line.draftLineId,
        sourceLineId: line.source?.line.id,
        groupId: line.source?.line.groupId,
        quantity: line.quantity,
        netAmount: line.source?.netAmount,
      })),
    ).toEqual([
      {
        draftLineId: "recalled-dish",
        sourceLineId: "stored-dish",
        groupId: where === "old-fired-group" ? "old-fired-group" : null,
        quantity: "2.000",
        netAmount: "6.50",
      },
    ]);
    expect(el.shadowRoot!.querySelector("[data-send-line]")).toBeNull();
    expect(direct).toEqual([]);
  },
);

it.each([
  {
    state: "already fired",
    line: { ...storedDish, groupId: null, firedAt: "2026-08-20T09:59:00.000Z" },
  },
  { state: "without a ticket item", line: { ...storedDish, groupId: null, state: null } },
  { state: "a following extra", line: { ...storedExtra, groupId: null } },
  {
    state: "a split-off extra",
    line: { ...storedExtra, groupId: null, state: "queued" as const },
  },
  { state: "in a held group", line: storedDish },
])("offers no standalone Send for $state", async ({ line }) => {
  const { el } = await mount({
    lines: line.parentLineNo == null ? [line] : [{ ...storedDish, groupId: null }, line],
    groups: [orderGroup("held", 1, "held")],
  });
  const sent: CustomEvent[] = [];
  el.addEventListener("send-lines", (event) => sent.push(event as CustomEvent));
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-send-line]")).toBeNull();
  expect(sent).toEqual([]);
});
