import type { FormFeedback } from "@waitron/ui";

/**
 * Dismissal keys on the restore screens: `refusal` is cleared by a new `errorMessage`, `field` by a
 * new `invalidField`, each leaving the other's dismissal in place.
 */
export type RefusalKey = "refusal" | "field";

export const refusalShown = (feedback: FormFeedback, ...keys: RefusalKey[]): boolean =>
  keys.every((key) => feedback.remaining({ [key]: true })[key] !== undefined);

export function renewRefusal(
  feedback: FormFeedback,
  messageChanged: boolean,
  fieldChanged: boolean,
): void {
  if (!messageChanged && !fieldChanged) return;
  const kept: RefusalKey[] = [];
  if (!messageChanged && !refusalShown(feedback, "refusal")) kept.push("refusal");
  if (!fieldChanged && !refusalShown(feedback, "field")) kept.push("field");
  feedback.newRefusal();
  feedback.dismiss(...kept);
}
