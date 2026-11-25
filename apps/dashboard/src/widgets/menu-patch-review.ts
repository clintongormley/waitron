import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import {
  DIETARY_SUITABILITY,
  expandDietaryDeclarations,
  formatMoney,
  type ContentLanguages,
  type DietProfile,
  type DietaryLabel,
  type FrozenOffer,
  type MenuDocument,
} from "@waitron/shared";
import type { DeclarationValues } from "@waitron/menu/src/declaration-values.js";
import { declarationsFor, fixedLanguages, patchFieldValue } from "@waitron/menu/src/menu-patch.js";
import type { MenuPatchChange, MenuPatchTarget } from "@waitron/menu/src/menu-patch-types.js";
import type { AllergenDeclaration } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { allergenLabel } from "../i18n/domain.js";
import { conjunctionList } from "../i18n/list.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import {
  patchTree,
  targetKey,
  type PatchTreeNode,
  type ScheduledCorrection,
} from "./menu-patch-draft.js";

const FIELD_LABELS: Record<string, StringKey> = {
  name: "editor.name",
  internalName: "sections.internal_name",
  customerName: "editor.customer_name",
  names: "sections.customer_name",
  kitchenName: "editor.kitchen_name",
  description: "editor.description",
  image: "image.label",
  price: "editor.price",
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
  if (params.reason === "image.not_found")
    return { change, message: t("menu_patch.image_not_found") };
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

/** A dish's or variant's copy, or an extra's, which holds its diets as `suitableFor`. */
type DeclaredCopy =
  | Pick<FrozenOffer, "allergens" | "diet" | "dietaryDeclarations">
  | { addAllergens: AllergenDeclaration; suitableFor: DietaryLabel[] };

const allergensOf = (copy: DeclaredCopy): AllergenDeclaration =>
  "addAllergens" in copy ? copy.addAllergens : copy.allergens;

function allergenWords(allergens: AllergenDeclaration): string {
  if (allergens === null) return t("editor.allergens_unreviewed");
  return (
    Object.entries(allergens)
      .map(([code, entry]) => allergenLabel(code, entry))
      .join(", ") || t("editor.nutrition.allergens_none")
  );
}

function profileWords(profile: DietProfile | null): string[] {
  if (profile === null) return [];
  return [
    ...DIETARY_SUITABILITY.flatMap((diet) => {
      const answer = profile[diet] ?? "unknown";
      return answer === "unknown" ? [] : [`${t(`diet.${diet}`)}: ${t(`diet.${answer}`)}`];
    }),
    ...profile.contains.map((tag) => t(`diet.contains_${tag}`)),
  ];
}

function dietWords(copy: DeclaredCopy): string {
  const [declared, profile] =
    "suitableFor" in copy
      ? [copy.suitableFor, []]
      : [copy.dietaryDeclarations, profileWords(copy.diet)];
  const labels = expandDietaryDeclarations(declared).map((label) => t(`editor.diet.${label}`));
  return [...labels, ...profile].join(", ") || t("menu_patch.empty");
}

/** Lines still to be filled with their item. */
type Lines = [key: StringKey, values: Record<string, string>][];

/** What copying the product's `current` declarations onto `target` changes. Allergens not yet
 * reviewed are named even where they stay so. */
function declarationChange(
  document: MenuDocument,
  target: MenuPatchTarget,
  productId: string,
  current: Readonly<Record<string, DeclarationValues>>,
): Lines {
  const from = patchFieldValue(document, target, "declarations") as DeclaredCopy;
  const to = declarationsFor(target.kind, current[productId]!) as DeclaredCopy;
  const changed = (field: StringKey, words: (copy: DeclaredCopy) => string): Lines =>
    words(from) === words(to)
      ? []
      : [["menu_patch.change_line", { field: t(field), from: words(from), to: words(to) }]];
  const same = (field: StringKey): Lines => [["menu_patch.declarations_same", { field: t(field) }]];
  const allergens = changed("product.allergens", (copy) => allergenWords(allergensOf(copy)));
  const diets = changed("product.dietary_info", dietWords);
  if (allergens.length === 0 && allergensOf(to) === null)
    return [...same("menu_preview.allergens_unreviewed"), ...diets];
  const lines = [...allergens, ...diets];
  return lines.length === 0 ? same("menu_patch.declarations_label") : lines;
}

/** A dish's change takes its variants, so one is listed only where its own result differs. */
function declarationLines(
  document: MenuDocument,
  target: MenuPatchTarget,
  current: Readonly<Record<string, DeclarationValues>>,
  names: ReadonlyMap<string, string>,
): string[] {
  const named = (lines: Lines, item: string) =>
    lines.map(([key, values]) => fill(key, { ...values, item }));
  const item = names.get(targetKey(target))!;
  if (target.kind !== "offer") {
    const productId =
      target.kind === "variant" ? target.variantId : (target as { productId: string }).productId;
    return named(declarationChange(document, target, productId, current), item);
  }
  const { productId, variants } = document.offers[target.menuItemId]!;
  const dish = declarationChange(document, target, productId, current);
  return [
    ...named(dish, variants.length === 0 ? item : fill("menu_patch.variants_included", { item })),
    ...variants.flatMap(({ id }) => {
      const variant: MenuPatchTarget = { ...target, kind: "variant", variantId: id };
      const own = declarationChange(document, variant, id, current);
      return JSON.stringify(own) === JSON.stringify(dish)
        ? []
        : named(own, names.get(targetKey(variant))!);
    }),
  ];
}

/** Each change as "{item}: {field} {old} → {new}"; a translated field once per language whose
 * text it changes, never in a language every copy's folder fixes, which the patch leaves alone. */
export function changeLines(
  document: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
  current: Readonly<Record<string, DeclarationValues>> = {},
): string[] {
  const names = itemNames(document);
  return changes.flatMap(({ target, field, value }) => {
    if (field === "declarations") return declarationLines(document, target, current, names);
    const item = names.get(targetKey(target))!;
    const label = t(FIELD_LABELS[field]!);
    const old = patchFieldValue(document, target, field, languages);
    if (field === "customerName" || field === "names" || field === "description") {
      const before = (old as Record<string, string> | null) ?? {};
      const after = value as Record<string, string>;
      const fixed = fixedLanguages(document, target, field, languages);
      return languages.languages
        .filter(
          (language) =>
            !fixed.includes(language) && (before[language] ?? "") !== (after[language] ?? ""),
        )
        .map((language) =>
          fill("menu_patch.change_line", {
            item,
            field: `${label} (${language.toUpperCase()})`,
            from: words(field, before[language] ?? null, false),
            to: words(field, after[language] ?? "", true),
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

export const onlyDeclarations = (changes: readonly MenuPatchChange[]): boolean =>
  changes.every(({ field }) => field === "declarations");

/** The notes under the review list. `queuedDates` names each version waiting to go live that gets
 * nothing, `correctedDates` each that gets the declarations: the patch renumbers them, so a date is
 * the name that still holds after it. */
export function reviewNotes(
  changes: readonly MenuPatchChange[],
  queuedDates: readonly string[],
  correctedDates: readonly string[] = [],
): string[] {
  return [
    ...(changes.some(({ field }) => field === "price") ? [t("menu_patch.open_orders_note")] : []),
    ...(correctedDates.length === 0
      ? []
      : [
          correctedDates.length === 1
            ? fill("menu_patch.corrected_note", { date: correctedDates[0]! })
            : fill("menu_patch.corrected_note_many", { dates: conjunctionList(correctedDates) }),
        ]),
    ...(queuedDates.length === 0
      ? []
      : [
          queuedDates.length === 1
            ? fill("menu_patch.queued_note", { date: queuedDates[0]! })
            : fill("menu_patch.queued_note_many", { dates: conjunctionList(queuedDates) }),
        ]),
    ...(onlyDeclarations(changes) ? [] : [t("menu_patch.products_note")]),
  ];
}

export type ScheduledRow = ScheduledCorrection & { date: string };

/** The scheduled versions the patch can correct too, each naming the changed items it differs for. */
export function renderScheduled(
  rows: readonly ScheduledRow[],
  document: MenuDocument,
  busy: boolean,
  choose: (row: ScheduledRow, ticked: boolean) => void,
): TemplateResult | typeof nothing {
  if (rows.length === 0) return nothing;
  const names = itemNames(document);
  return html`<fieldset>
    <legend>${t("menu_patch.scheduled")}</legend>
    ${rows.map(
      (row) =>
        html`<label class="tick">
          <input
            type="checkbox"
            name="scheduled"
            value=${row.activatesAt}
            .checked=${live(row.ticked)}
            ?disabled=${busy}
            @change=${(event: Event) => choose(row, (event.target as HTMLInputElement).checked)}
          />
          <span>
            <span data-test="scheduled-date">${row.date}</span>
            <span class="scheduled-items" data-test="scheduled-items"
              >${conjunctionList(row.targets.map((target) => names.get(targetKey(target))!))}</span
            >
          </span>
        </label>`,
    )}
  </fieldset>`;
}
