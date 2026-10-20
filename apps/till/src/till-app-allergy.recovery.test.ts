import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { AllergySendTarget } from "@waitron/module";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import {
  addDish,
  allergyView,
  api,
  catalogue,
  dialog,
  draft,
  emit,
  mountApp,
  openTable,
  party,
  resetAllergyFixture,
  server,
  table,
  tableOrder,
} from "../test/allergy-app-fixture.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});

it("uses reminted ids from the final save for both allergy ticks and draft groups", async () => {
  let resolveSave!: () => void;
  const saved = new Promise<void>((resolve) => {
    resolveSave = resolve;
  });
  const save = vi.fn(async (...args: Parameters<typeof server.saveDraft>) => {
    const answer = await server.saveDraft(...args);
    answer.draft!.lines[0]!.id = "authoritative-steak";
    server.drafts[0]!.lines[0]!.id = "authoritative-steak";
    server.linesById.set("authoritative-steak", answer.draft!.lines[0]!);
    await saved;
    return answer;
  });
  const preview = vi.fn(async (_id: string, target: AllergySendTarget) => {
    const view = allergyView("allergies", target);
    view.snapshot.guests = [
      { id: "guest-1", position: 0, who: "Blue shirt", allergens: { milk: {} }, note: null },
    ];
    return view;
  });
  const { el } = await mountApp({ saveDraft: save, previewPartyAllergy: preview });
  await openTable(el);
  await addDish(el);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(preview).not.toHaveBeenCalled();
  expect(api.submitDraft).not.toHaveBeenCalled();
  expect(draft(el).sending).toBe(true);
  const draftId = server.drafts[0]!.id;
  resolveSave();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(preview.mock.calls[0]![1]).toEqual({
    kind: "draft",
    draftId,
    lineIds: ["authoritative-steak"],
  });
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>('[data-tick="0:0"]')!);
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
  expect(api.submitDraft!.mock.calls[0]![2]).toMatchObject({
    draftRevision: 1,
    expectedEdit: { draftRevision: 1, draftId },
    groups: [{ release: "hold", lineIds: ["authoritative-steak"] }],
    allergy: { ticks: [{ line: { kind: "draft", id: "authoritative-steak" }, guestIndex: 0 }] },
  });
});

it("reconsiders a changed group after a stale fire without carrying a removed dish tick", async () => {
  let revision = 3;
  const preview = vi.fn(async (_id: string, target: AllergySendTarget) => {
    const view = allergyView("allergies", target);
    view.snapshot.revision = revision;
    view.snapshot.guests = [
      { id: "guest-1", position: 0, who: "Blue shirt", allergens: { milk: {} }, note: null },
    ];
    view.dishes[0] = {
      ...view.dishes[0]!,
      line: { kind: "working", id: revision === 3 ? "old-dish" : "arriving-dish" },
      name: revision === 3 ? "Steak" : "Soup",
      billId: revision === 3 ? "wo-4" : "other-bill",
      offeredBefore: false,
    };
    return view;
  });
  const release = vi
    .fn()
    .mockImplementationOnce(async () => {
      revision = 4;
      throw { code: "party.out_of_date" };
    })
    .mockResolvedValue({ revision: 5 });
  const { el } = await mountApp({ previewPartyAllergy: preview, fireGroup: release });
  const screen = await openTable(el);
  api.getTablesState!.mockResolvedValue([table("t4", "4", party({ revision: 4 }))]);
  api.listGroups!.mockResolvedValue({ revision: 4, groups: [] });
  api.readCurrentOrders!.mockResolvedValue({
    revision: 4,
    hasGroups: true,
    nextDisplayNumber: 2,
    retainedCourses: [],
    groups: [],
    ungrouped: [],
    reminder: null,
  });
  emit(screen, "fire-group", { groupId: "held-group" });
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const form = dialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>('[data-tick="0:0"]')!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(form.view.snapshot?.revision).toBe(4));
  await vi.waitFor(() => expect(form.busy).toBe(false));
  expect(release).toHaveBeenCalledOnce();
  expect(form.shadowRoot!.textContent).toContain("Soup");
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:0"]')!.checked).toBe(
    false,
  );
  expect(release.mock.calls[0]![2]).toMatchObject({
    expectedPartyRevision: 3,
    allergy: { ticks: [{ line: { kind: "working", id: "old-dish" }, guestIndex: 0 }] },
  });
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>('[data-tick="0:0"]')!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(2));
  expect(release.mock.calls[1]![2]).toMatchObject({
    expectedPartyRevision: 4,
    allergy: { ticks: [{ line: { kind: "working", id: "arriving-dish" }, guestIndex: 0 }] },
  });
  expect(release.mock.calls[1]![2].submissionId).not.toBe(release.mock.calls[0]![2].submissionId);
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

it("refreshes station routing after a confirmed send loses its preparation destination", async () => {
  const routing = vi
    .fn()
    .mockResolvedValueOnce({ sends: true, deadEnds: [], stations: [] })
    .mockImplementation(async (_partyId: string, _draftId: string, ids: string[]) => ({
      sends: true,
      deadEnds: [
        {
          key: ids[0],
          name: "Steak",
          quantity: "1",
          stationId: "grill",
          stationName: "Grill",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    }));
  const submit = vi.fn().mockRejectedValueOnce({ code: "station.no_replacement" });
  const { el } = await mountApp({ askDraftDeadEnds: routing, submitDraft: submit });
  await openTable(el);
  await addDish(el);
  await vi.waitFor(() => expect(routing).toHaveBeenCalledOnce());
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(routing).toHaveBeenCalledTimes(2));
  expect(dialog(el)).toBeNull();
  expect(draft(el).sending).toBe(false);
  expect(draft(el).lines).toHaveLength(1);
  expect(submit).toHaveBeenCalledOnce();
  expect(tableOrder(el)!.shadowRoot!.querySelector("till-dead-ends-section")).not.toBeNull();
});

it("returns a sold-out refusal to dish recovery after allergy confirmation", async () => {
  const submit = vi.fn().mockRejectedValueOnce({
    code: "product.unavailable",
    status: 409,
    productId: "product-offer-steak",
  });
  const { el } = await mountApp({ submitDraft: submit });
  await openTable(el);
  await addDish(el);
  const offers = catalogue("v1");
  api.listZoneOffers!.mockResolvedValue({
    ...offers,
    offers: offers.offers.map((offer) =>
      offer.id === "offer-steak" ? { ...offer, available: false } : offer,
    ),
  });
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(draft(el).sending).toBe(false));
  expect(dialog(el)).toBeNull();
  expect(submit).toHaveBeenCalledOnce();
  expect(draft(el).lines).toHaveLength(1);
  await vi.waitFor(() => expect(draft(el).lines[0]!.blocked).toBe("unavailable"));
  const markers = [...tableOrder(el)!.shadowRoot!.querySelectorAll("till-basket")].flatMap(
    (basket) => [...basket.shadowRoot!.querySelectorAll(".line .not-offered")],
  );
  expect(markers.map((marker) => marker.textContent!.trim())).toEqual([
    t("basket.blocked.unavailable"),
  ]);
  expect(tableOrder(el)!.shadowRoot!.querySelector('[data-flag-remove="0"]')).not.toBeNull();
});

it("reloads a replaced draft instead of trapping its old allergy answer in a retry form", async () => {
  const submit = vi.fn().mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
  const { el } = await mountApp({ submitDraft: submit });
  await openTable(el);
  await addDish(el);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const reads = api.listDrafts!.mock.calls.length;
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(draft(el).sending).toBe(false));
  expect(dialog(el)).toBeNull();
  expect(api.listDrafts).toHaveBeenCalledTimes(reads + 1);
  expect(submit).toHaveBeenCalledOnce();
  expect(draft(el).lines).toHaveLength(1);
  expect(el.shadowRoot!.querySelector(".error")?.textContent).toContain(
    t("table.draft_changed_elsewhere"),
  );
});

it("reconsiders dishes after a menu refusal instead of replaying their old ticks", async () => {
  const preview = vi.fn(async (_id: string, target: AllergySendTarget) => {
    const view = allergyView("allergies", target);
    view.snapshot.guests = [
      { id: "guest-1", position: 0, who: "Blue shirt", allergens: { milk: {} }, note: null },
    ];
    return view;
  });
  const submit = vi.fn(server.submitDraft).mockRejectedValueOnce({
    code: "menu.version_changed",
    status: 409,
    menus: [{ menuId: "lunch", liveVersionId: "v2" }],
  });
  const { el } = await mountApp({ previewPartyAllergy: preview, submitDraft: submit });
  await openTable(el);
  await addDish(el);
  api.listZoneOffers!.mockResolvedValue(catalogue("v2"));
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>('[data-tick="0:0"]')!);
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(dialog(el)?.busy).toBe(false));
  expect(submit).toHaveBeenCalledOnce();
  const first = submit.mock.calls[0]![2];
  const newTarget = preview.mock.calls[1]![1];
  expect(first.allergy!.ticks).toEqual([
    { line: { kind: "draft", id: first.groups[0]!.lineIds[0] }, guestIndex: 0 },
  ]);
  expect(newTarget.kind).toBe("draft");
  if (newTarget.kind !== "draft") throw new Error("Expected a draft target");
  expect(api.saveDraft!.mock.calls[1]![1].lines[0]!.menuVersionId).toBe("v2");
  expect(
    dialog(el)!.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:0"]')!.checked,
  ).toBe(false);
  expect(draft(el).sending).toBe(true);
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  const second = submit.mock.calls[1]![2];
  expect(second.submissionId).not.toBe(first.submissionId);
  expect(second.draftRevision).toBeGreaterThan(first.draftRevision);
  expect(second.groups[0]!.lineIds).toEqual(newTarget.lineIds);
  expect(second.allergy!.ticks).toEqual([]);
});
