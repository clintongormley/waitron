import type { AllergyPatch, AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import type { TillApi } from "../api/client.js";

export type AllergySendResult =
  { kind: "ready"; patch?: AllergyPatch } | { kind: "cancelled" } | { kind: "unread" };
export interface AllergyOpening {
  key: string;
  isCurrent: () => boolean;
}

export async function prepareAllergySend(
  api: Pick<TillApi, "previewPartyAllergy">,
  partyId: string,
  target: AllergySendTarget,
  opening: AllergyOpening,
  show: (view: PartyAllergyRead, scopeKey: string) => Promise<AllergySendResult>,
): Promise<AllergySendResult> {
  if (!opening.isCurrent()) return { kind: "cancelled" };
  try {
    const view = await api.previewPartyAllergy(partyId, target);
    if (!opening.isCurrent()) return { kind: "cancelled" };
    if (view.partyId !== partyId) return { kind: "unread" };
    if (
      view.dishes.length === 0 ||
      view.snapshot.answer === "none" ||
      (view.snapshot.answer === "allergies" && view.dishes.every((dish) => dish.offeredBefore))
    )
      return { kind: "ready" };
    const answer = await show(view, opening.key);
    return opening.isCurrent() ? answer : { kind: "cancelled" };
  } catch {
    return { kind: opening.isCurrent() ? "unread" : "cancelled" };
  }
}
