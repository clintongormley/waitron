import { currentContentLanguages } from "@waitron/ui";
import { newCustomerText } from "@waitron/shared";
import type { OfferedModifier, OfferedOptionsList } from "../api/client.js";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";

type Names = Pick<OfferedOptionsList, "name" | "customerName" | "kitchenName">;

export function optionSnapshotOf(list: Names & { id: string }, label: Names): OptionSnapshot {
  const config = currentContentLanguages();
  const language = config.defaultLanguage;
  return {
    listId: list.id,
    listName: { [language]: list.name },
    listCustomerName:
      list.customerName === null
        ? null
        : { [language]: newCustomerText(list.customerName, list.name, language, config) },
    listKitchenName: list.kitchenName,
    labelName: { [language]: label.name },
    labelCustomerName:
      label.customerName === null
        ? null
        : { [language]: newCustomerText(label.customerName, label.name, language, config) },
    labelKitchenName: label.kitchenName,
  };
}

/**
 * Rebuild wire selections only for the same list and an available label with the recorded staff
 * wording. Only a list with no answer of its own needs a new choice.
 */
export function deriveOptionSelections(
  offered: readonly OfferedModifier[],
  snapshots: readonly OptionSnapshot[] | undefined,
): { options: OptionSelection[]; unanswered: string[] } {
  const heldByList = new Map((snapshots ?? []).map((answer) => [answer.listId, answer]));
  const options: OptionSelection[] = [];
  const unanswered: string[] = [];
  for (const list of offered) {
    if (list.kind !== "options") continue;
    const answer = heldByList.get(list.id);
    if (answer === undefined) {
      unanswered.push(list.id);
      continue;
    }
    if (list.name !== Object.values(answer.listName)[0]) continue;
    const labelName = Object.values(answer.labelName)[0];
    const label = list.labels.find(
      (candidate) => candidate.available && candidate.name === labelName,
    );
    if (label !== undefined) options.push({ listId: list.id, labelId: label.id });
  }
  return { options, unanswered };
}

/** Whether two sets of answers name the same list-and-label pairs, in any order. */
export function sameOptionSelections(
  left: readonly OptionSelection[],
  right: readonly OptionSelection[],
): boolean {
  const key = (answers: readonly OptionSelection[]) =>
    JSON.stringify(answers.map(({ listId, labelId }) => JSON.stringify([listId, labelId])).sort());
  return key(left) === key(right);
}
