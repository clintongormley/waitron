import type { ModifierSnapshot } from "../api/client.js";
import { snapshotDescriptionFor } from "./dish-format.js";

/** Saved nonprice answers belong to their parent; extras already have priced child rows. */
export function modifierSnapshotLabels(
  snapshots: readonly ModifierSnapshot[] = [],
  resolve = snapshotDescriptionFor,
): string[] {
  return snapshots.flatMap((snapshot) => {
    if (snapshot.type === "extras") return [];
    // A yes/no is a checkbox labelled with the modifier name: an affirmative answer shows the
    // name alone, a negative answer shows nothing (consistent with the receipt/kitchen ticket).
    if (snapshot.type === "yes-no") return snapshot.value ? [resolve(snapshot.name, "")] : [];
    const value = snapshot.type === "text" ? snapshot.text : resolve(snapshot.choiceName, "");
    return [`${resolve(snapshot.name, "")}: ${value}`];
  });
}
