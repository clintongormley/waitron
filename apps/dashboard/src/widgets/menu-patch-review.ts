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
import {
  correctedCopies,
  declarationsFor,
  fixedLanguages,
  patchFieldValue,
} from "@waitron/menu/src/menu-patch.js";
import type {
  DeclaredCopy,
  MenuPatchChange,
  MenuPatchTarget,
  PatchDraftAnswer,
} from "@waitron/menu/src/menu-patch-types.js";
import type { AllergenDeclaration } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { allergenWords } from "../i18n/domain.js";
import { conjunctionList } from "../i18n/list.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import {
  patchTree,
  targetKey,
  type PatchTreeNode,
  type ScheduledCorrection,
} from "./menu-patch-draft.js";
import { localTimeWords } from "./menu-publications.js";

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

/** A dish's or variant's declarations, or an extra's, which holds its diets as `suitableFor`. */
type Declared =
  | Pick<FrozenOffer, "allergens" | "diet" | "dietaryDeclarations">
  | { addAllergens: AllergenDeclaration; suitableFor: DietaryLabel[] };

const allergensOf = (values: Declared): AllergenDeclaration =>
  "addAllergens" in values ? values.addAllergens : values.allergens;

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

function dietWords(values: Declared): string {
  const [declared, profile] =
    "suitableFor" in values
      ? [values.suitableFor, []]
      : [values.dietaryDeclarations, profileWords(values.diet)];
  const labels = expandDietaryDeclarations(declared).map((label) => t(`editor.diet.${label}`));
  return [...labels, ...profile].join(", ") || t("menu_patch.empty");
}

/** Lines still to be filled with their item. */
type Lines = [key: StringKey, values: Record<string, string>][];

/** What writing the product's `current` declarations over its `copies` changes, once per value they
 * hold. Allergens not yet reviewed are named even where they stay so. */
function declarationChange(
  kind: MenuPatchTarget["kind"],
  copies: readonly DeclaredCopy[],
  current: PatchDraftAnswer["declarations"],
): Lines {
  const to = declarationsFor(kind, current[copies[0]!.productId]!) as Declared;
  const changed = (field: StringKey, words: (values: Declared) => string): Lines =>
    [...new Set(copies.map(({ values }) => words(values as Declared)))]
      .filter((from) => from !== words(to))
      .map((from) => ["menu_patch.change_line", { field: t(field), from, to: words(to) }]);
  const same = (field: StringKey): Lines => [["menu_patch.declarations_same", { field: t(field) }]];
  const allergens = changed("product.allergens", (values) => allergenWords(allergensOf(values)));
  const diets = changed("product.dietary_info", dietWords);
  if (allergens.length === 0 && allergensOf(to) === null)
    return [...same("menu_preview.allergens_unreviewed"), ...diets];
  const lines = [...allergens, ...diets];
  return lines.length === 0 ? same("menu_patch.declarations_label") : lines;
}

/** What a declarations change of `item` does to `copies`, its own product's first. A dish's change
 * takes its variants, so one is listed only where its own result differs. */
function declarationLines(
  kind: MenuPatchTarget["kind"],
  item: string,
  copies: readonly DeclaredCopy[],
  current: PatchDraftAnswer["declarations"],
): string[] {
  const [own, ...variants] = [...new Set(copies.map(({ productId }) => productId))].map((id) => {
    const held = copies.filter(({ productId }) => productId === id);
    return { name: held[0]!.name, lines: declarationChange(kind, held, current) };
  });
  const named = (lines: Lines, item: string) =>
    lines.map(([key, values]) => fill(key, { ...values, item }));
  return [
    ...named(
      own!.lines,
      variants.length === 0 ? item : fill("menu_patch.variants_included", { item }),
    ),
    ...variants.flatMap(({ name, lines }) =>
      JSON.stringify(lines) === JSON.stringify(own!.lines) ? [] : named(lines, `${item} › ${name}`),
    ),
  ];
}

/** Each change as "{item}: {field} {old} → {new}"; a translated field once per language whose
 * text it changes, never in a language every copy's folder fixes, which the patch leaves alone. */
export function changeLines(
  document: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
  current: PatchDraftAnswer["declarations"] = {},
  names = itemNames(document),
): string[] {
  return changes.flatMap(({ target, field, value }) => {
    const item = names.get(targetKey(target))!;
    if (field === "declarations")
      return declarationLines(target.kind, item, correctedCopies(document, target), current);
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

export const anyDeclarations = (changes: readonly MenuPatchChange[]): boolean =>
  changes.some(({ field }) => field === "declarations");

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
    ...(onlyDeclarations(changes)
      ? []
      : [
          t(
            anyDeclarations(changes)
              ? "menu_patch.products_note_declared"
              : "menu_patch.products_note",
          ),
        ]),
  ];
}

/** The scheduled versions the patch can correct too, each naming the changed items it differs for,
 * and for one whose copies do not all hold the value being corrected, what its correction replaces. */
export function renderScheduled(
  rows: readonly ScheduledCorrection[],
  names: ReadonlyMap<string, string>,
  current: PatchDraftAnswer["declarations"],
  busy: boolean,
  choose: (row: ScheduledCorrection, ticked: boolean) => void,
): TemplateResult | typeof nothing {
  if (rows.length === 0) return nothing;
  const item = (target: MenuPatchTarget) => names.get(targetKey(target))!;
  return html`<fieldset>
    <legend>${t("menu_patch.scheduled")}</legend>
    ${rows.map(
      (row) =>
        html`<label class="tick">
          <input
            type="checkbox"
            name="scheduled"
            value=${row.versionId}
            .checked=${live(row.ticked)}
            ?disabled=${busy}
            @change=${(event: Event) => choose(row, (event.target as HTMLInputElement).checked)}
          />
          <span>
            <span data-test="scheduled-date">${localTimeWords(row.local)}</span>
            <span class="scheduled-items" data-test="scheduled-items"
              >${conjunctionList(row.targets.map(({ target }) => item(target)))}</span
            >
            ${row.targets.flatMap(({ target, replaces }) =>
              replaces === undefined
                ? []
                : declarationLines(target.kind, item(target), replaces, current).map(
                    (line) =>
                      html`<span class="scheduled-line" data-test="scheduled-line">${line}</span>`,
                  ),
            )}
          </span>
        </label>`,
    )}
  </fieldset>`;
}
