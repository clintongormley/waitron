import { validateModifierSelections } from "@waitron/catalogue";
import { isDeepStrictEqual } from "node:util";
import type { Modifier, ModifierSelection, ModifierSnapshot } from "@waitron/shared";

export function snapshotSelections(definitions: readonly Modifier[], value: unknown) {
  const selections = validateModifierSelections(definitions, value);
  const snapshots: ModifierSnapshot[] = [];
  const extras: {
    id: string;
    name: Record<string, string>;
    priceDelta: string;
    vatClass: "general" | "reduced" | "super_reduced" | "zero" | null;
    quantity: number;
  }[] = [];
  for (const selection of selections) {
    const definition = definitions.find((modifier) => modifier.id === selection.modifierId)!;
    const common = { modifierId: definition.id, name: definition.name };
    if (selection.type === "text")
      snapshots.push({ ...common, type: "text", text: selection.text });
    if (selection.type === "yes-no" && definition.type === "yes-no")
      snapshots.push({
        ...common,
        type: "yes-no",
        value: selection.value,
      });
    if (selection.type === "options" && definition.type === "options")
      snapshots.push({
        ...common,
        type: "options",
        choiceId: selection.choiceId,
        choiceName: definition.choices.find((choice) => choice.id === selection.choiceId)!.name,
      });
    if (selection.type === "extras" && definition.type === "extras") {
      const choices = selection.choices.map((choice) => {
        const item = definition.choices.find((item) => item.id === choice.choiceId)!;
        extras.push({
          id: item.id,
          name: item.name,
          priceDelta: item.priceDelta,
          vatClass: item.vatClass ?? null,
          quantity: choice.quantity,
        });
        return { choiceId: item.id, name: item.name, quantity: choice.quantity };
      });
      snapshots.push({ ...common, type: "extras", choices });
    }
  }
  return { snapshots, extras };
}

export function selectionsFromSnapshots(
  snapshots: readonly ModifierSnapshot[],
): ModifierSelection[] {
  return snapshots.map((snapshot) => {
    const common = { modifierId: snapshot.modifierId };
    switch (snapshot.type) {
      case "text":
        return { ...common, type: "text", text: snapshot.text };
      case "yes-no":
        return { ...common, type: "yes-no", value: snapshot.value };
      case "options":
        return { ...common, type: "options", choiceId: snapshot.choiceId };
      case "extras":
        return {
          ...common,
          type: "extras",
          choices: snapshot.choices.map(({ choiceId, quantity }) => ({ choiceId, quantity })),
        };
    }
  });
}

function sameEntries(actual: unknown, expected: readonly unknown[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const remaining = [...expected];
  return actual.every((entry: unknown) => {
    const index = remaining.findIndex((candidate) => isDeepStrictEqual(entry, candidate));
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

/** Wire ordering is not an answer change; duplicates and additional fields still differ. */
export function sameModifierSelections(
  value: unknown,
  snapshots: readonly ModifierSnapshot[],
): boolean {
  const expected = selectionsFromSnapshots(snapshots);
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const seen = new Set<string>();
  return value.every((entry: unknown) => {
    if (entry === null || typeof entry !== "object" || !("modifierId" in entry)) return false;
    const selection = expected.find((candidate) => candidate.modifierId === entry.modifierId);
    if (!selection || seen.has(selection.modifierId)) return false;
    seen.add(selection.modifierId);
    if (selection.type !== "extras") return isDeepStrictEqual(entry, selection);
    if (!("choices" in entry)) return false;
    return (
      isDeepStrictEqual({ ...entry, choices: null }, { ...selection, choices: null }) &&
      sameEntries(entry.choices, selection.choices)
    );
  });
}
