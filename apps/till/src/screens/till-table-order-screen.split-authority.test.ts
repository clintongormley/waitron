import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { BillEditExpected } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, mount, showView } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const observation: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 2,
  draftId: "draft",
  draftRevision: 3,
};

async function beginTakeover(el: TillTableOrderScreen) {
  el.otherDrafts = [
    { id: "other-draft", revision: 4, ownerName: "Luis", takenFromYou: false, lines: [] },
  ];
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-take-over]")!);
  await el.updateComplete;
  const request = vi.fn();
  el.addEventListener("take-over-draft", request);
  el.shadowRoot!.querySelector<HTMLElement>("[data-take-over-confirm]")!.click();
  expect(request).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail: { draftId: "other-draft", revision: 4 } }),
  );
}

async function opening(kind: "split" | "fold") {
  const draft = new DraftStore();
  draft.loadFrom("draft", [{ product: beer, quantity: "3", place: { kind: "fire" } }]);
  const { el } = await mount({ draftStore: draft, billEdit: { ...observation } });
  await showView(el, "order", { ifShown: true });
  if (kind === "fold") {
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-split-draft-line]")!);
    await el.updateComplete;
  }
  const control = el.shadowRoot!.querySelector<HTMLElement>(
    kind === "fold" ? "[data-fold-draft-family]" : "[data-split-draft-line]",
  )!;
  expect(control).not.toBeNull();
  return { el, draft, control };
}

for (const kind of ["split", "fold"] as const) {
  it.each([
    "billId",
    "editorVersion",
    "draftId",
    "draftRevision",
    "missing",
    "api",
    "party",
    "bill",
    "visit",
    "busy",
    "ordering",
    "takeover",
  ] as const)(
    `a retained ${kind} control preserves the candidate after %s changes`,
    async (change) => {
      const { el, draft, control } = await opening(kind);
      if (change === "billId") el.billEdit = { ...observation, billId: "other" };
      if (change === "editorVersion") el.billEdit = { ...observation, editorVersion: 4 };
      if (change === "draftId") el.billEdit = { ...observation, draftId: "replacement" };
      if (change === "draftRevision") el.billEdit = { ...observation, draftRevision: 5 };
      if (change === "missing") el.billEdit = null;
      if (change === "api") el.api = {} as typeof el.api;
      if (change === "party") el.party = { ...switcherParty, id: "other" };
      if (change === "bill") el.orderId = "other";
      if (change === "visit") el.serviceVisit++;
      if (change === "busy") el.busy = true;
      if (change === "ordering") el.orderingAllowed = false;
      if (change === "takeover") await beginTakeover(el);
      const before = structuredClone(draft.lines);
      const identities = [...draft.lines];
      control.click();
      expect(draft.lines).toEqual(before);
      expect(draft.lines.every((line, index) => line === identities[index])).toBe(true);
    },
  );

  it(`an equivalent ownership observation keeps ${kind} usable`, async () => {
    const { el, draft, control } = await opening(kind);
    el.billEdit = { draftRevision: 3, draftId: "draft", editorVersion: 2, billId: "wo-4" };
    control.click();

    expect(draft.lines.map((row) => row.quantity)).toEqual(
      kind === "split" ? ["1", "1", "1"] : ["3"],
    );
    expect(draft.total).toBe("9.00");
  });

  it.each(["busy", "ordering", "takeover"] as const)(
    `the ${kind} control is disabled while %s prevents editing`,
    async (change) => {
      const { el, draft, control } = await opening(kind);
      if (change === "busy") el.busy = true;
      if (change === "ordering") el.orderingAllowed = false;
      if (change === "takeover") await beginTakeover(el);
      await el.updateComplete;
      expect((control as HTMLButtonElement).disabled).toBe(true);
      const before = structuredClone(draft.lines);
      control.click();
      expect(draft.lines).toEqual(before);
    },
  );
}
