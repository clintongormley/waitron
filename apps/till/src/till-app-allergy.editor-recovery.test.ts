import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtInput } from "@waitron/ui";
import type { AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import {
  api,
  mountApp,
  flush,
  emit,
  shell,
  floor,
  tableOrder,
  openTable,
  addDish,
  draft,
  dialog,
  allergyView,
  party,
  table,
  resetAllergyFixture,
} from "../test/allergy-app-fixture.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

async function editor(el: Parameters<typeof dialog>[0]) {
  const screen = tableOrder(el)!;
  await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
  await flush(el);
  emit(screen, "edit-party-allergy");
  await vi.waitFor(() => expect(dialog(el)?.mode).toBe("edit"));
  return dialog(el)!;
}
async function changedEditor(el: Parameters<typeof dialog>[0]) {
  const form = await editor(el);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
  const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
  await who.updateComplete;
  await userEvent.fill(who.shadowRoot!.querySelector("input")!, "My pending guest");
  await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
  return { form, who };
}
function metadata(revision: number) {
  api.getTablesState!.mockResolvedValue([table("t4", "4", party({ revision }))]);
  api.listGroups!.mockResolvedValue({ revision, groups: [] });
  api.readCurrentOrders!.mockResolvedValue({
    revision,
    hasGroups: false,
    nextDisplayNumber: 1,
    retainedCourses: [],
    groups: [],
    ungrouped: [],
    reminder: null,
  });
}

it("reports an editor opening failure without saving or replacing the last known answer", async () => {
  const { el } = await mountApp();
  const screen = await openTable(el);
  await vi.waitFor(() => expect(screen.allergyView?.snapshot.answer).toBe("none"));
  await flush(el);
  api.readPartyAllergy!.mockRejectedValueOnce({ code: "server.unreachable" });
  emit(screen, "edit-party-allergy");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("table.error")));
  expect(dialog(el)).toBeNull();
  expect(screen.allergyView?.snapshot.answer).toBe("none");
  expect(api.savePartyAllergy).not.toHaveBeenCalled();
});

it("ignores an editor reply naming another party", async () => {
  const { el } = await mountApp();
  const screen = await openTable(el);
  await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
  await flush(el);
  api.readPartyAllergy!.mockResolvedValueOnce({ ...allergyView("allergies"), partyId: "v7" });
  const before = api.readPartyAllergy!.mock.calls.length;
  emit(screen, "edit-party-allergy");
  await vi.waitFor(() => expect(api.readPartyAllergy).toHaveBeenCalledTimes(before + 1));
  await flush(el);
  expect(dialog(el)).toBeNull();
  expect(screen.allergyView?.partyId).toBe("v1");
  expect(api.savePartyAllergy).not.toHaveBeenCalled();
});

it("keeps one editor and refuses competing Fire requests while it holds input", async () => {
  const { el } = await mountApp();
  const screen = await openTable(el);
  const { form, who } = await changedEditor(el);
  const reads = api.readPartyAllergy!.mock.calls.length;
  emit(screen, "edit-party-allergy");
  emit(screen, "fire-group", { groupId: "group-a" });
  await flush(el, 6);
  emit(screen, "fire-held-line", { lineId: "line-a" });
  await flush(el, 6);
  expect(dialog(el)).toBe(form);
  expect(who.value).toBe("My pending guest");
  expect(api.readPartyAllergy).toHaveBeenCalledTimes(reads);
  expect(api.fireGroup).not.toHaveBeenCalled();
  expect(api.fireHeldLine).not.toHaveBeenCalled();
});

it("does not close a new party's editor when the old party's save answers late", async () => {
  let finish!: (view: PartyAllergyRead) => void;
  const save = vi.fn(
    () =>
      new Promise<PartyAllergyRead>((resolve) => {
        finish = resolve;
      }),
  );
  const read = vi.fn(async (id: string) => ({ ...allergyView("none"), partyId: id }));
  const { el } = await mountApp({ savePartyAllergy: save, readPartyAllergy: read });
  await openTable(el);
  const { form } = await changedEditor(el);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
  await flush(el);
  const next = await changedEditor(el);
  finish({
    ...allergyView("allergies"),
    snapshot: { ...allergyView("allergies").snapshot, revision: 4 },
  });
  await flush(el, 6);
  expect(dialog(el)).toBe(next.form);
  expect(next.who.value).toBe("My pending guest");
  expect(tableOrder(el)!.party?.id).toBe("v7");
  expect(tableOrder(el)!.party?.revision).toBe(9);
  expect(save).toHaveBeenCalledOnce();
});

it("keeps edits and requires review when the refreshed metadata disagrees", async () => {
  const save = vi.fn().mockRejectedValue({ code: "party.out_of_date" });
  const { el } = await mountApp({ savePartyAllergy: save });
  await openTable(el);
  const { form, who } = await changedEditor(el);
  api.readPartyAllergy!.mockResolvedValue({
    ...allergyView("none"),
    snapshot: { ...allergyView("none").snapshot, revision: 4 },
  });
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(form.busy).toBe(false));
  await vi.waitFor(() => expect(form.refusal).toBe(t("allergy.stale")));
  expect(who.value).toBe("My pending guest");
  expect(save).toHaveBeenCalledOnce();
  api.readPartyAllergy!.mockResolvedValue({ ...allergyView("none"), partyId: "v7" });
  const reads = api.readPartyAllergy!.mock.calls.length;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(api.readPartyAllergy).toHaveBeenCalledTimes(reads + 1));
  await vi.waitFor(() => expect(form.busy).toBe(false));
  await vi.waitFor(() => expect(form.refusal).toBe(t("allergy.stale")));
  expect(save).toHaveBeenCalledOnce();
  expect(who.value).toBe("My pending guest");
});

it("does not replace a polled newer editor view with an older review reply", async () => {
  const { el } = await mountApp();
  await openTable(el);
  const { form, who } = await changedEditor(el);
  const latest = {
    ...allergyView("none"),
    snapshot: { ...allergyView("none").snapshot, revision: 4 },
  };
  api.readPartyAllergy!.mockResolvedValue(latest);
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(form.view.snapshot?.revision).toBe(4));
  api.readPartyAllergy!.mockResolvedValue(allergyView("none"));
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(form.busy).toBe(false));
  await vi.waitFor(() => expect(form.refusal).toBe(t("allergy.stale")));
  expect(form.view.snapshot?.revision).toBe(4);
  expect(who.value).toBe("My pending guest");
  expect(api.savePartyAllergy).not.toHaveBeenCalled();
});

it("rejects a preview that advances again while refreshing its metadata", async () => {
  let previews = 0;
  const preview = vi.fn().mockImplementation(async (_id: string, target: AllergySendTarget) => {
    previews += 1;
    const view = allergyView(null, target);
    return { ...view, snapshot: { ...view.snapshot, revision: previews === 1 ? 4 : 5 } };
  });
  const { el } = await mountApp({ previewPartyAllergy: preview });
  await openTable(el);
  await addDish(el);
  const store = draft(el);
  metadata(4);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("table.error")));
  expect(preview).toHaveBeenCalledTimes(2);
  expect(api.submitDraft).not.toHaveBeenCalled();
  expect(dialog(el)).toBeNull();
  expect(draft(el)).toBe(store);
  expect(store.lines).toHaveLength(1);
  expect(store.sending).toBe(false);
});

it.each(["group", "held-line"] as const)(
  "ignores a late %s Fire answer after changing parties",
  async (kind) => {
    let finish!: (value: { revision: number }) => void;
    const write = vi.fn(
      (..._args: unknown[]) =>
        new Promise<{ revision: number }>((resolve) => {
          finish = resolve;
        }),
    );
    const { el } = await mountApp({
      [kind === "group" ? "fireGroup" : "fireHeldLine"]: write,
      previewPartyAllergy: vi.fn(async (_id: string, target: AllergySendTarget) =>
        allergyView("none", target),
      ),
    });
    const screen = await openTable(el);
    emit(
      screen,
      kind === "group" ? "fire-group" : "fire-held-line",
      kind === "group" ? { groupId: "group-a" } : { lineId: "line-a" },
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const signal = (write.mock.calls[0]!.at(-1) as { signal: AbortSignal }).signal;
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(signal.aborted).toBe(true);
    finish({ revision: 99 });
    await flush(el, 6);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(tableOrder(el)!.party?.revision).toBe(9);
    expect(dialog(el)).toBeNull();
    expect(write).toHaveBeenCalledOnce();
  },
);
