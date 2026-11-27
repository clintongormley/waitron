import { css, html, nothing, type TemplateResult } from "lit";
import type { PartyAllergySnapshot } from "@waitron/module";

export const allergyMarkStyles = css`
  .allergy-tag {
    display: inline-block;
    margin-inline-start: var(--wt-space-1);
    color: var(--wt-color-danger);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    overflow-wrap: anywhere;
  }
`;

/** The guest whose allergy is ticked on a line, or null; nothing is ticked unless the party
 * answered that it has allergies. */
export function allergyGuestId(
  snapshot: PartyAllergySnapshot | null,
  ref: { kind: "draft" | "working"; id: string },
): string | null {
  if (snapshot?.answer !== "allergies") return null;
  const tick = snapshot.ticks.find((tick) =>
    ref.kind === "draft" ? tick.draftLineId === ref.id : tick.workingLineId === ref.id,
  );
  return tick?.guestId ?? null;
}

/** What {@link allergyMark} shows: who the line's allergy tick is for. */
export function allergyGuestWho(
  snapshot: PartyAllergySnapshot | null,
  ref: { kind: "draft" | "working"; id: string },
): string | undefined {
  const id = allergyGuestId(snapshot, ref);
  return snapshot?.guests.find((guest) => guest.id === id)?.who;
}

export function allergyMark(
  snapshot: PartyAllergySnapshot | null,
  ref: { kind: "draft" | "working"; id: string },
): TemplateResult | typeof nothing {
  const who = allergyGuestWho(snapshot, ref);
  return who === undefined
    ? nothing
    : html`<span class="allergy-tag" data-allergy-tag>${who}</span>`;
}
