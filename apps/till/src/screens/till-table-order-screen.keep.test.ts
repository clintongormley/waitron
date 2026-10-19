import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "../i18n/t.js";
import type { BillEditExpected } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import {
  beer,
  mount,
  openDraftLine,
  resized,
  store,
} from "./till-table-order-screen.test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

const edit: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 1,
  draftId: "draft-1",
  draftRevision: 1,
};
const line = (): OrderLine => ({
  draftLineId: "line-1",
  product: beer,
  quantity: "2",
  unavailableOnServer: true,
});
const kept = (el: TillTableOrderScreen) => el.shadowRoot!.querySelector("[data-flag-kept]");
const keep = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-flag-keep]");

async function holding(width = 390) {
  await page.viewport(width, 900);
  const draft = new DraftStore();
  const mounted = await mount({ billEdit: { ...edit }, draftStore: draft });
  mounted.host.style.width = "100%";
  store(mounted.el).loadFrom(store(mounted.el).id, [line()]);
  await resized(mounted.el);
  return { ...mounted, draft };
}

async function chooseKeep(el: TillTableOrderScreen) {
  const picker = await openDraftLine(el, 0);
  await userEvent.click(keep(el)!);
  await el.updateComplete;
  expect(kept(el)?.textContent?.trim()).toBe(t("table.flag_kept"));
  const closed = new Promise<void>((resolve) =>
    picker.addEventListener("wt-modifier-cancel", () => resolve(), { once: true }),
  );
  await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
  await closed;
  await el.updateComplete;
}

describe("till-table-order-screen: Keep after a saved draft is refreshed", () => {
  for (const locale of ["en", "es"] as const)
    for (const width of [390, 1280]) {
      it(`keeps the same saved line acknowledged in ${locale} at ${width}px`, async () => {
        setLocale(locale);
        const { el } = await holding(width);
        await chooseKeep(el);
        const draft = store(el);
        const old = draft.lines[0]!;
        const refreshed = structuredClone(old);
        const expected = structuredClone(refreshed);

        draft.loadFrom(draft.id, [refreshed], undefined, 2);
        el.billEdit = { ...edit, draftRevision: 2 };
        await el.updateComplete;
        await openDraftLine(el, 0);

        expect(draft.lines[0]).not.toBe(old);
        expect(kept(el)?.textContent?.trim()).toBe(t("table.flag_kept"));
        expect(kept(el)?.checkVisibility()).toBe(true);
        expect(keep(el)).toBeNull();
        expect(el.shadowRoot!.querySelector("[data-flag-remove]")).toBeNull();
        expect(draft.lines[0]).toEqual(expected);
        expect(draft.lines[0]!.unavailableOnServer).toBe(true);
        expect(draft.dirty).toBe(false);
      });
    }

  it("retains Keep when a locally acknowledged line gains its saved id", async () => {
    const { el } = await holding();
    delete store(el).lines[0]!.draftLineId;
    await chooseKeep(el);
    store(el).lines[0]!.draftLineId = "line-1";
    store(el).emit("changed");
    await el.updateComplete;
    store(el).loadFrom(store(el).id, [line()]);
    await el.updateComplete;
    await openDraftLine(el, 0);
    expect(kept(el)?.checkVisibility()).toBe(true);
    expect(keep(el)).toBeNull();
  });

  it.each(["line", "draft", "bill", "editor", "warning"] as const)(
    "asks again when the %s changes despite the other saved identities matching",
    async (change) => {
      const { el } = await holding();
      await chooseKeep(el);
      const draft = store(el);
      const next = line();
      if (change === "line") next.draftLineId = "line-2";
      if (change === "warning") next.blocked = "removed";
      if (change === "bill") el.orderId = "wo-5";
      if (change === "editor") el.billEdit = { ...edit, editorVersion: 2 };
      const expected = structuredClone(next);
      draft.loadFrom(change === "draft" ? "draft-other" : draft.id, [next]);
      await el.updateComplete;
      await openDraftLine(el, 0);

      expect(kept(el)).toBeNull();
      expect(keep(el)?.checkVisibility()).toBe(true);
      expect(draft.lines[0]).toEqual(expected);
    },
  );

  it("forgets Keep when the saved line disappears before returning", async () => {
    const { el } = await holding();
    await chooseKeep(el);
    store(el).loadFrom(store(el).id, []);
    await el.updateComplete;
    store(el).loadFrom(store(el).id, [line()]);
    await el.updateComplete;
    await openDraftLine(el, 0);
    expect(kept(el)).toBeNull();
    expect(keep(el)?.checkVisibility()).toBe(true);
  });

  it("asks again after the warning clears and later returns on the same object", async () => {
    const { el, draft } = await holding();
    await chooseKeep(el);
    draft.setUnavailableOnServer([false]);
    await el.updateComplete;
    draft.setUnavailableOnServer([true]);
    await el.updateComplete;
    await openDraftLine(el, 0);
    expect(kept(el)).toBeNull();
    expect(keep(el)?.checkVisibility()).toBe(true);
  });

  it("asks again on a different store even if its draft and line ids are reused", async () => {
    const { el, draft } = await holding();
    await chooseKeep(el);
    const replacement = new DraftStore();
    replacement.loadFrom(draft.id, [line()]);
    el.draftStore = replacement;
    await el.updateComplete;
    await openDraftLine(el, 0);
    expect(kept(el)).toBeNull();
    expect(keep(el)?.checkVisibility()).toBe(true);
  });
});
