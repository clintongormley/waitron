import type { ModifierSnapshot } from "../api/client.js";
import { snapshotDescriptionFor } from "./dish-format.js";

/** Saved nonprice answers belong to their parent; extras already have priced child rows. */
export function modifierSnapshotLabels(
  snapshots: readonly ModifierSnapshot[] = [],
  resolve = snapshotDescriptionFor,
): string[] {
  return snapshots.flatMap((snapshot) => {
    if (snapshot.type === "extras") return [];
    const value =
      snapshot.type === "text"
        ? snapshot.text
        : resolve(snapshot.type === "options" ? snapshot.choiceName : snapshot.label, "");
    return [`${resolve(snapshot.name, "")}: ${value}`];
  });
}
