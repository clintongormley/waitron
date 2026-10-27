import { formatMoney, type ContentLanguages } from "@waitron/shared";
import type { MenuDocument } from "@waitron/catalogue/src/menu-document-types.js";
import { fixedLanguages, patchFieldValue } from "@waitron/catalogue/src/menu-patch.js";
import type { MenuPatchChange } from "@waitron/catalogue/src/menu-patch-types.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
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
function namesIn(nodes: readonly PatchTreeNode[], holder = "", names = new Map<string, string>()) {
  for (const node of nodes) {
    if (node.target !== null)
      names.set(
        targetKey(node.target),
        CHILD_KINDS.has(node.target.kind) ? `${holder} › ${node.label}` : node.label,
      );
    namesIn(node.children, node.label, names);
  }
  return names;
}

/** Each item of `document` by `targetKey`, named as the review list names it. */
export function itemNames(document: MenuDocument): Map<string, string> {
  return namesIn(patchTree(document, ""));
}

export interface Refusal {
  code: string;
  params: Record<string, unknown>;
}

/** Where a refused save's message goes: under the field of the change it names, else the bottom
 * message. */
export function placeRefusal(
  error: unknown,
  sent: readonly MenuPatchChange[],
): { change: MenuPatchChange; message: string } | { refusal: Refusal } {
  const code = codeOf(error);
  const params = (error as { params?: Record<string, unknown> }).params ?? {};
  const change = code === "menu_patch.invalid" ? sent[params.change as number] : undefined;
  if (change === undefined || change.field !== params.field) return { refusal: { code, params } };
  return {
    change,
    message: codeMessage((params.reason as string | undefined) ?? "menu_patch.invalid"),
  };
}

/** A bottom refusal's sentence. */
export function refusalWords({ code, params }: Refusal): string {
  if (code === "menu_patch.invalid") return t("menu_patch.no_longer_fits");
  if (code === "menu_patch.base_changed" && typeof params.liveNumber === "number")
    return fill("menu_patch.base_changed_live", { liveNumber: String(params.liveNumber) });
  return codeMessage(code);
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
 * text it changes, never in a language every copy's folder fixes, which the patch leaves alone. */
export function changeLines(
  document: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
): string[] {
  const names = itemNames(document);
  return changes.flatMap(({ target, field, value }) => {
    const item = names.get(targetKey(target))!;
    const label = t(FIELD_LABELS[field]!);
    const old = patchFieldValue(document, target, field, languages);
    if (field === "customerName" || field === "names" || field === "description") {
      const before = (old as Record<string, string> | null) ?? {};
      // The dialog stages every content language's text, a blank one as "".
      const after = value as Record<string, string>;
      const fixed = fixedLanguages(document, target, field, languages);
      return languages.languages
        .filter(
          (language) => !fixed.includes(language) && (before[language] ?? "") !== after[language],
        )
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
