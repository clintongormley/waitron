import type { OfferedModifier } from "../api/client.js";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";

/**
 * The one plain staff name a frozen side carries. An answer's staff names arrive as locale → text
 * maps holding a single entry, keyed by whatever content language the order path widened them under
 * (`buildLineExtras`, `apps/server/src/modifier-selection.ts`, writes
 * `listName: { [defaultLanguage]: list.name }`). This code does not know that language, so it reads
 * the VALUE positionally rather than by key — the same way `staffOptionSnapshotLabels`
 * (`packages/catalogue/src/option-snapshot-labels.ts`) reads it for the basket.
 */
function staffName(names: Record<string, string>): string {
  return Object.values(names)[0] ?? "";
}

/**
 * Put a retrieved order's options answers back into re-sendable ones.
 *
 * A held order hands an answer back as six frozen NAMES and no ids — the list's three and the chosen
 * label's three (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.3) — while
 * the wire names a list and one of its labels by ID (`validateOptionSelections`,
 * `packages/catalogue/src/option-contract.ts`). So a retrieved line has an answer to SHOW and, until
 * this function runs, none to re-send. Sending none is not a smaller failure: every ACTIVE list the
 * dish carries must be answered, and one left out refuses the WHOLE edit with
 * `options.label_required` — run against the real order path by "refuses a quantity-only edit that
 * names no answer for an active options list" (`apps/server/src/working-order.test.ts`).
 *
 * The names are what an answer IS, which is what makes re-deriving from them sound rather than a
 * guess: `sameOptionSelections` (`apps/server/src/modifier-selection.ts`) already decides whether an
 * edit keeps the stored line by comparing those same six names BY VALUE, and
 * `docs/developers/modifiers.md` explains why a rename is therefore indistinguishable from a
 * different answer and re-prices the line. This matches on the STAFF name of each side, the one the
 * basket itself shows, and leaves the other four to the server's own comparison: a list whose
 * customer or kitchen wording moved still re-sends, and the server then re-prices the line exactly
 * as it does for any other changed wording.
 *
 * The walk is over the OFFERED lists rather than over the frozen answers, because that is the set
 * the server requires an answer for. `readOfferedModifiers`
 * (`packages/catalogue/src/offered-modifiers.ts`) hands back ACTIVE lists alone and an options list
 * offers only its AVAILABLE labels (`OfferedOptionsList`, `packages/catalogue/src/menu-types.ts`),
 * so a match here can only name a list and a label the contract will accept — nothing re-checks
 * either flag. Each answer is consumed as it is matched, so two lists sharing a staff name take one
 * frozen answer each instead of both taking the first.
 *
 * Two ways a match can fail, and they are not the same failure:
 *
 *  - An OFFERED list nothing matched comes back in `unanswered`, and the caller must tell the
 *    operator: the line cannot be re-sent until that list is answered again. Its `defaultLabelId` is
 *    deliberately NOT substituted — that would change what the diner asked for on a line about to be
 *    billed.
 *  - A frozen answer matching no offered list is simply left out. Nothing requires it (the list is
 *    no longer active or no longer attached) and sending it would be refused as `options.invalid`,
 *    so leaving it out is the only sendable shape — the same posture `deriveExtraSelections`
 *    (`./held-extras.ts`) takes for a pick no list offers any more.
 *
 * The frozen wording itself is carried through untouched by the caller: it is what the order holds
 * and what the basket must keep showing until the server re-prices the line.
 */
export function deriveOptionSelections(
  offered: readonly OfferedModifier[],
  snapshots: readonly OptionSnapshot[] | undefined,
): { options: OptionSelection[]; unanswered: string[] } {
  const remaining = [...(snapshots ?? [])];
  const options: OptionSelection[] = [];
  const unanswered: string[] = [];
  for (const entry of offered) {
    if (entry.kind !== "options") continue;
    let matchedAt = -1;
    let labelId: string | undefined;
    for (const [index, snapshot] of remaining.entries()) {
      // A blank name matches nothing: a list and a label each hold a non-blank staff name
      // (`staffName` in `packages/catalogue/src/option-contract.ts` refuses a blank one), so a blank
      // here means an answer arrived without the map its type declares.
      const wantedList = staffName(snapshot.listName);
      const wantedLabel = staffName(snapshot.labelName);
      if (wantedList === "" || wantedList !== entry.name || wantedLabel === "") continue;
      const label = entry.labels.find((candidate) => candidate.name === wantedLabel);
      if (label === undefined) continue;
      matchedAt = index;
      labelId = label.id;
      break;
    }
    if (labelId === undefined) {
      unanswered.push(entry.id);
      continue;
    }
    remaining.splice(matchedAt, 1);
    options.push({ listId: entry.id, labelId });
  }
  return { options, unanswered };
}
