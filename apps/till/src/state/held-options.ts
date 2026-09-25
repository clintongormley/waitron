import type { OfferedModifier, OfferedOptionsList } from "../api/client.js";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";

/**
 * A frozen staff name arrives as a single-entry locale → text map, keyed by a content language this
 * code does not know, so the value is read positionally.
 */
function staffName(names: Record<string, string>): string {
  return Object.values(names)[0] ?? "";
}

/**
 * Answer as many lists as possible (an augmenting-path matching). `candidates[i]` maps the index of
 * each answer list `i` could take onto the label id it would name. Returns, per list, the answer index
 * it was given, or `undefined` for a list THIS assignment left out, which is not the same as a list no
 * assignment could answer. Among assignments of the same size it promises nothing about which list
 * gets which of two interchangeable answers.
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
 * Re-derive a retrieved order's options answers, which come back as frozen NAMES with no ids, by
 * matching the STAFF name of the list and of the chosen label; the server compares the other four.
 * The walk is over the OFFERED lists, which are already narrowed to active lists and available labels.
 *
 * Two lists can share a staff name (`option_lists.name` has no unique index), so taking each answer as
 * first matched could strand a list; {@link assignAnswers} searches instead.
 *
 * An offered list nothing matched comes back in `unanswered`, and the caller must tell the operator.
 * Its `defaultLabelId` is deliberately NOT substituted: that would change what the diner asked for on
 * a line about to be billed. A frozen answer matching no offered list is left out, because sending it
 * would be refused.
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
      // A list and a label each hold a non-blank staff name, so a blank one here matches nothing.
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
