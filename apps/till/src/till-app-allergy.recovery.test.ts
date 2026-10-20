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
  mountApp,
  openTable,
  resetAllergyFixture,
  server,
  tableOrder,
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
