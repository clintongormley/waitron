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

export function allergyMark(
  snapshot: PartyAllergySnapshot | null,
  ref: { kind: "draft" | "working"; id: string },
): TemplateResult | typeof nothing {
  if (snapshot?.answer !== "allergies") return nothing;
  const tick = snapshot.ticks.find((tick) =>
    ref.kind === "draft" ? tick.draftLineId === ref.id : tick.workingLineId === ref.id,
  );
  const guest = snapshot.guests.find((guest) => guest.id === tick?.guestId);
  return guest === undefined
    ? nothing
    : html`<span class="allergy-tag" data-allergy-tag>${guest.who}</span>`;
}
