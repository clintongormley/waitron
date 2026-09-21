import type { OfferedModifier, OfferedOptionsList } from "../api/client.js";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";

/**
 * The one plain staff name a frozen side carries. An answer's staff names arrive as locale → text
 * maps holding a single entry, keyed by whatever content language the order path widened them under
 * (`buildLineExtras`, `apps/server/src/modifier-selection.ts`). This code does not know that
 * language, so it reads the VALUE positionally rather than by key — as
 * `staffOptionSnapshotLabels` (`packages/catalogue/src/option-snapshot-labels.ts`) does for the
 * basket.
 */
function staffName(names: Record<string, string>): string {
  return Object.values(names)[0] ?? "";
}

/**
 * Give as many lists as possible one of the answers they can take, and say which.
 *
 * `candidates[i]` maps the index of each answer list `i` could take onto the label id that answer
 * would name. The walk is the textbook augmenting-path one: each list claims a free answer, and when
 * every answer it can take is held it asks a holder to move to one of ITS other candidates, no
 * answer being revisited twice within one list's walk. That bound — one pass per list, and within
 * it each answer considered at most once — is what makes the search complete without being able to
 * loop; a dish carries a handful of lists, so its cost is not worth a cleverer shape.
 *
 * Returns, per list index, the index of the answer it was given, or `undefined` for a list no
 * assignment could reach. It maximises how many lists are answered; among assignments of the same
 * size it promises nothing about WHICH list gets which of two interchangeable answers.
 */
function assignAnswers(candidates: readonly ReadonlyMap<number, string>[]): (number | undefined)[] {
  const holderOf: (number | undefined)[] = [];
  const claim = (listIndex: number, visited: Set<number>): boolean => {
    for (const answerIndex of candidates[listIndex]!.keys()) {
      if (visited.has(answerIndex)) continue;
      visited.add(answerIndex);
      const holder = holderOf[answerIndex];
      if (holder === undefined || claim(holder, visited)) {
        holderOf[answerIndex] = listIndex;
        return true;
      }
    }
    return false;
  };
  for (let listIndex = 0; listIndex < candidates.length; listIndex += 1) {
    claim(listIndex, new Set());
  }
  const answerOf: (number | undefined)[] = candidates.map(() => undefined);
  // Indexed rather than `forEach`, which skips the gaps an unclaimed answer leaves in `holderOf`.
  for (let answerIndex = 0; answerIndex < holderOf.length; answerIndex += 1) {
    const listIndex = holderOf[answerIndex];
    if (listIndex !== undefined) answerOf[listIndex] = answerIndex;
  }
  return answerOf;
}

/**
 * Put a retrieved order's options answers back into re-sendable ones.
 *
 * A held order hands an answer back as six frozen NAMES and no ids, while the wire names a list and
 * one of its labels by ID (`validateOptionSelections`, `packages/catalogue/src/option-contract.ts`).
 * The ids are re-derived here by matching the STAFF name of the list and of the chosen label — the
 * pair the basket itself shows. The other four names are left to the server's own comparison
 * (`sameOptionSelections`, `apps/server/src/modifier-selection.ts`), which re-prices the line when
 * any of the six has moved.
 *
 * Re-sending nothing is not a smaller failure than re-sending something: every ACTIVE list the dish
 * carries must be answered, and one left out refuses the WHOLE edit with `options.label_required`
 * (`apps/server/src/working-order.test.ts`, "refuses a quantity-only edit that names no answer for
 * an active options list").
 *
 * The walk is over the OFFERED lists, because that is the set the server requires an answer for, and
 * they arrive already narrowed to ACTIVE lists and AVAILABLE labels (`readOfferedModifiers`,
 * `packages/catalogue/src/offered-modifiers.ts`) — so a match here can only name a list and a label
 * the contract will accept, and nothing re-checks either flag.
 *
 * TWO LISTS CAN SHARE A STAFF NAME: `option_lists.name` carries no unique index
 * (`packages/catalogue/src/schema/options.ts`), so which of them takes which answer is a choice.
 * Taking each answer as it is first matched strands a list that an answer already given away would
 * have satisfied, so {@link assignAnswers} searches instead.
 *
 * Two ways something can stay unmatched, and they are not the same failure:
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
  const lists = offered.filter((entry): entry is OfferedOptionsList => entry.kind === "options");
  const frozen = snapshots ?? [];
  const candidates = lists.map((list) => {
    const byAnswer = new Map<number, string>();
    frozen.forEach((snapshot, answerIndex) => {
      // A blank name matches nothing: a list and a label each hold a non-blank staff name
      // (`staffName` in `packages/catalogue/src/option-contract.ts` refuses a blank one), so a blank
      // here means an answer arrived without the map its type declares.
      const wantedList = staffName(snapshot.listName);
      const wantedLabel = staffName(snapshot.labelName);
      if (wantedList === "" || wantedList !== list.name || wantedLabel === "") return;
      const label = list.labels.find((candidate) => candidate.name === wantedLabel);
      if (label !== undefined) byAnswer.set(answerIndex, label.id);
    });
    return byAnswer;
  });

  const answerOf = assignAnswers(candidates);
  const options: OptionSelection[] = [];
  const unanswered: string[] = [];
  lists.forEach((list, listIndex) => {
    const answerIndex = answerOf[listIndex];
    if (answerIndex === undefined) {
      unanswered.push(list.id);
      return;
    }
    options.push({ listId: list.id, labelId: candidates[listIndex]!.get(answerIndex)! });
  });
  return { options, unanswered };
}
