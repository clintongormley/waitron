import { formatMoney, type ContentLanguages } from "@waitron/shared";
import type { MenuDocument } from "@waitron/catalogue/src/menu-document-types.js";
import { patchFieldValue } from "@waitron/catalogue/src/menu-patch.js";
import type { MenuPatchChange } from "@waitron/catalogue/src/menu-patch-types.js";
import { vatClassName } from "../i18n/domain.js";
import { conjunctionList } from "../i18n/list.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { patchTree, targetKey, type PatchTreeNode } from "./menu-patch-draft.js";

const FIELD_LABELS: Record<string, StringKey> = {
  name: "editor.name",
  internalName: "sections.internal_name",
  customerName: "editor.customer_name",
  names: "sections.customer_name",
  kitchenName: "editor.kitchen_name",
  description: "editor.description",
  image: "image.label",
  price: "editor.price",
  vatClass: "product.vat",
};

const CHILD_KINDS = new Set(["variant", "extra", "option_label"]);

/** Each item's name by `targetKey`; a variant, extras item or options label carries its holder's,
 * since the same name can sit under several. */
function itemNames(
  nodes: readonly PatchTreeNode[],
  holder = "",
  names = new Map<string, string>(),
) {
  for (const node of nodes) {
    if (node.target !== null)
      names.set(
        targetKey(node.target),
        CHILD_KINDS.has(node.target.kind) ? `${holder} › ${node.label}` : node.label,
      );
    itemNames(node.children, node.label, names);
  }
  return names;
}

function words(field: string, value: unknown, isNew: boolean): string {
  if (field === "price") return formatMoney(value as string, currentLocale());
  if (field === "vatClass") return vatClassName(value as string);
  if (field === "image")
    return t(
      value === null
        ? "menu_patch.no_image"
        : isNew
          ? "menu_patch.new_image"
          : "menu_patch.current_image",
    );
  return (value as string | null) || t("menu_patch.empty");
}

/** Each change as "{item}: {field} {old} → {new}"; a translated field once per language whose
 * text it changes. */
export function changeLines(
  document: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
): string[] {
  const names = itemNames(patchTree(document, ""));
  return changes.flatMap(({ target, field, value }) => {
    const item = names.get(targetKey(target))!;
    const label = t(FIELD_LABELS[field]!);
    const old = patchFieldValue(document, target, field, languages);
    if (field === "customerName" || field === "names" || field === "description") {
      const before = (old as Record<string, string> | null) ?? {};
      // The dialog stages every content language's text, a blank one as "".
      const after = value as Record<string, string>;
      return languages.languages
        .filter((language) => (before[language] ?? "") !== after[language])
        .map((language) =>
          fill("menu_patch.change_line", {
            item,
            field: `${label} (${language.toUpperCase()})`,
            from: words(field, before[language] ?? null, false),
            to: words(field, after[language]!, true),
          }),
        );
    }
    return [
      fill("menu_patch.change_line", {
        item,
        field: label,
        from: words(field, old, false),
        to: words(field, value, true),
      }),
    ];
  });
}

/** The notes under the review list. `queuedDates` names each version waiting to go live: the
 * patch renumbers them, so a date is the name that still holds after it. */
export function reviewNotes(queuedDates: readonly string[]): string[] {
  return [
    t("menu_patch.open_orders_note"),
    ...(queuedDates.length === 0
      ? []
      : [
          queuedDates.length === 1
            ? fill("menu_patch.queued_note", { date: queuedDates[0]! })
            : fill("menu_patch.queued_note_many", { dates: conjunctionList(queuedDates) }),
        ]),
    t("menu_patch.products_note"),
  ];
}
