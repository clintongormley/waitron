import type {
  DocumentMember,
  MenuDocument,
  MenuField,
  MenuOccurrence,
  MenuTarget,
} from "./menu-document-types.js";

export function indexMenuOccurrences(document: MenuDocument): MenuOccurrence[] {
  const occurrences: MenuOccurrence[] = [];
  const walk = (members: readonly DocumentMember[], path: string[]): void => {
    for (const member of members) {
      if (member.kind === "section") {
        if (path.includes(member.sectionId)) continue;
        const sectionIds = [...path, member.sectionId];
        occurrences.push({
          target: { kind: "section", sectionIds, field: { kind: "summary" } },
          ancestorSectionIds: [...path],
        });
        walk(member.members, sectionIds);
      } else {
        occurrences.push({
          target: {
            kind: "product",
            sectionIds: [...path],
            menuItemId: member.menuItemId,
            productId: member.productId,
            field: { kind: "summary" },
          },
          ancestorSectionIds: [...path],
        });
      }
    }
  };
  walk(document.root.members, []);
  return occurrences;
}

function fieldKey(field: MenuField): unknown[] {
  switch (field.kind) {
    case "name":
      return [field.kind, field.audience, field.language ?? null];
    case "description":
      return [field.kind, field.language];
    default:
      return [field.kind];
  }
}

export function menuTargetKey(target: MenuTarget): string {
  switch (target.kind) {
    case "title":
      return JSON.stringify([target.kind, target.menuId]);
    case "list":
      return JSON.stringify([target.kind, target.sectionIds]);
    case "section":
      return JSON.stringify([target.kind, target.sectionIds, fieldKey(target.field)]);
    case "home":
      return JSON.stringify([target.kind, target.device, target.field]);
    case "product":
      return JSON.stringify([
        target.kind,
        target.sectionIds,
        target.menuItemId,
        target.productId,
        target.variantId ?? null,
        target.listId ?? null,
        target.extraProductId ?? null,
        target.optionLabelId ?? null,
        fieldKey(target.field),
      ]);
  }
}
