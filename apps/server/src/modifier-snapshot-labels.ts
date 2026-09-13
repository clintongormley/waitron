import type { ModifierSnapshot } from "@waitron/shared";

/** Extras already have priced child lines; these labels describe the nonprice selections. */
export function modifierSnapshotLabels(
  snapshots: readonly ModifierSnapshot[],
  locale: string,
): string[] {
  const name = (labels: Record<string, string>) => labels[locale] ?? Object.values(labels)[0] ?? "";
  return snapshots.flatMap((snapshot) => {
    switch (snapshot.type) {
      case "text":
        return [`${name(snapshot.name)}: ${snapshot.text}`];
      case "options":
        return [`${name(snapshot.name)}: ${name(snapshot.choiceName)}`];
      case "yes-no":
        return [`${name(snapshot.name)}: ${name(snapshot.label)}`];
      case "extras":
        return [];
    }
  });
}
