import { AppError, decimal, isAppError, toScale, type ContentLanguages } from "@waitron/shared";
import "./errors.js";
import { folderPresentation } from "./include-folder-presentation.js";
import type { DocumentMember, MenuDocument } from "./menu-document-types.js";
import type { IncludeFolderOverrides } from "./section-types.js";
import { PATCH_FIELDS, type MenuPatchChange, type MenuPatchTarget } from "./menu-patch-types.js";
import { isProductPrice } from "./modifier-limits.js";
import {
  mergeOptionalTranslations,
  validateOptionalTranslations,
} from "./optional-translations.js";
import { VAT_CLASSES } from "./vat-rates.js";

type Copy = Record<string, unknown>;

const asCopies = (values: readonly object[]): Copy[] => values as Copy[];

/** Every copy of the target that takes a change to the field, the key holding its price, the key
 * mirroring that price when the menu sets one, and whether its presentation repeats its wording. */
interface Located {
  copies: Copy[];
  priceKey?: "unitPrice" | "price";
  priceMirror?: "grossPrice" | "menuPrice";
  presentation?: true;
}

const WORDING = new Set(["name", "customerName", "kitchenName"]);

const TRANSLATED = new Set(["customerName", "names", "description"]);

function invalid(change: number, field: string, reason?: string): AppError<"menu_patch.invalid"> {
  return new AppError(
    "menu_patch.invalid",
    reason === undefined ? { change, field } : { change, field, reason },
  );
}

function refusalFrom(error: unknown, change: number, field: string): AppError {
  if (!isAppError(error)) throw error;
  return invalid(change, field, error.code);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const id = (value: unknown): value is string => typeof value === "string" && value !== "";

function parseTarget(value: unknown): MenuPatchTarget | null {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    !Object.hasOwn(PATCH_FIELDS, value.kind)
  )
    return null;
  switch (value.kind as MenuPatchTarget["kind"]) {
    case "offer":
      return id(value.menuItemId) ? { kind: "offer", menuItemId: value.menuItemId } : null;
    case "variant":
      return id(value.menuItemId) && id(value.variantId)
        ? { kind: "variant", menuItemId: value.menuItemId, variantId: value.variantId }
        : null;
    case "extra":
      return id(value.listId) && id(value.productId)
        ? { kind: "extra", listId: value.listId, productId: value.productId }
        : null;
    case "option_label":
      return id(value.listId) && id(value.labelId)
        ? { kind: "option_label", listId: value.listId, labelId: value.labelId }
        : null;
    case "list":
      return (value.listKind === "extras" || value.listKind === "options") && id(value.listId)
        ? { kind: "list", listKind: value.listKind, listId: value.listId }
        : null;
    case "section":
      return id(value.sectionId) ? { kind: "section", sectionId: value.sectionId } : null;
  }
}

function checkedValue(change: number, field: string, value: unknown): unknown {
  switch (field) {
    case "name":
    case "internalName":
      if (typeof value !== "string" || value.trim() === "") throw invalid(change, field);
      return value.trim();
    case "kitchenName":
      if (value === null) return null;
      if (typeof value !== "string") throw invalid(change, field);
      return value.trim() === "" ? null : value.trim();
    case "image":
      if (value === null) return null;
      if (typeof value !== "string" || value.trim() === "") throw invalid(change, field);
      return value.trim();
    case "price":
      if (typeof value !== "string" || !isProductPrice(value)) throw invalid(change, field);
      return value;
    case "vatClass":
      if (!(VAT_CLASSES as readonly unknown[]).includes(value)) throw invalid(change, field);
      return value;
    default:
      // customerName, names and description: the field table admits nothing else.
      if (value === null) return null;
      if (!isRecord(value)) throw invalid(change, field);
      try {
        validateOptionalTranslations(value);
      } catch (error) {
        throw refusalFrom(error, change, field);
      }
      return value;
  }
}

/** Refuses anything but a list of changes to the fields `PATCH_FIELDS` allows, each value checked
 * as the product editor checks it. */
export function parseMenuPatch(body: unknown): MenuPatchChange[] {
  if (!Array.isArray(body)) throw invalid(-1, "changes");
  return body.map((change: unknown, index) => {
    const target = isRecord(change) ? parseTarget(change.target) : null;
    if (target === null) throw invalid(index, "target");
    const field = (change as Record<string, unknown>).field;
    if (typeof field !== "string" || !PATCH_FIELDS[target.kind].includes(field))
      throw invalid(index, "field");
    return { target, field, value: checkedValue(index, field, (change as Copy).value) };
  });
}

const fixedOf = (copy: Copy): IncludeFolderOverrides =>
  (copy.fixed as IncludeFolderOverrides | undefined) ?? {};

function sectionCopies(
  members: readonly DocumentMember[],
  sectionId: string,
  takes: (fixed: IncludeFolderOverrides) => boolean,
): Copy[] {
  return members.flatMap((member): Copy[] =>
    member.kind === "section"
      ? [
          ...(member.sectionId === sectionId && takes(member.fixed ?? {}) ? [member as Copy] : []),
          ...sectionCopies(member.members, sectionId, takes),
        ]
      : [],
  );
}

/** A fixed name is per language, so a copy refuses a names change only when it fixes every
 * language the change can write; without `languages`, every copy fixing names may take it. */
function takesChange(field: string, languages?: ContentLanguages) {
  return (fixed: IncludeFolderOverrides): boolean =>
    field === "names"
      ? languages === undefined ||
        !languages.languages.every((language) => Object.hasOwn(fixed.names ?? {}, language))
      : !Object.hasOwn(fixed, field);
}

function locate(
  document: MenuDocument,
  target: MenuPatchTarget,
  field: string,
  languages?: ContentLanguages,
): Located | undefined {
  const modifiers = () => Object.values(document.offers).flatMap((offer) => offer.offeredModifiers);
  let located: Located;
  switch (target.kind) {
    case "offer": {
      const offer = document.offers[target.menuItemId];
      located = {
        copies: offer === undefined ? [] : [offer],
        priceKey: "unitPrice",
        priceMirror: "grossPrice",
      };
      break;
    }
    case "variant": {
      const variant = document.offers[target.menuItemId]?.variants.find(
        (candidate) => candidate.id === target.variantId,
      );
      located = {
        copies: variant === undefined ? [] : [variant],
        priceKey: "unitPrice",
        priceMirror: "menuPrice",
      };
      break;
    }
    case "extra":
      located = {
        copies: asCopies(
          modifiers().flatMap((list) =>
            list.kind === "extras" && list.id === target.listId
              ? list.items.filter((item) => item.productId === target.productId)
              : [],
          ),
        ),
        priceKey: "price",
        presentation: true,
      };
      break;
    case "option_label":
      located = {
        copies: modifiers().flatMap((list) =>
          list.kind === "options" && list.id === target.listId
            ? list.labels.filter((label) => label.id === target.labelId)
            : [],
        ),
      };
      break;
    case "list":
      located = {
        copies: modifiers().filter(
          (list) => list.kind === target.listKind && list.id === target.listId,
        ),
      };
      break;
    case "section":
      located = {
        copies: sectionCopies(
          document.root.members,
          target.sectionId,
          takesChange(field, languages),
        ),
      };
  }
  return located.copies.length === 0 ? undefined : located;
}

/** The value a field holds now at the first copy a patch would change, preferring a copy that fixes
 * none of it; `undefined` when the document does not hold the target. */
export function patchFieldValue(
  document: MenuDocument,
  target: MenuPatchTarget,
  field: string,
): unknown {
  const located = locate(document, target, field);
  if (located === undefined) return undefined;
  const copy =
    located.copies.find((candidate) => !Object.hasOwn(fixedOf(candidate), field)) ??
    located.copies[0]!;
  return copy[field === "price" ? located.priceKey! : field];
}

/** A patched copy of `document`, which is never changed and may be deep-frozen. */
export function applyMenuPatch(
  document: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
): MenuDocument {
  const patched = structuredClone(document);
  parseMenuPatch(changes).forEach(({ target, field, value }, index) => {
    const located = locate(patched, target, field, languages);
    if (located === undefined) throw invalid(index, "target");
    for (const copy of located.copies as Copy[]) {
      if (TRANSLATED.has(field)) {
        let merged: Record<string, string> | null;
        try {
          merged = mergeOptionalTranslations(
            copy[field] as Record<string, string> | null,
            value as Record<string, string> | null,
            languages,
          );
        } catch (error) {
          throw refusalFrom(error, index, field);
        }
        const names = field === "names" ? fixedOf(copy).names : undefined;
        // A section's names are never null.
        copy[field] =
          names !== undefined
            ? folderPresentation(
                { names: merged ?? {}, image: null, color: null },
                { showAsFolder: true, overrides: { names } },
              ).names
            : merged === null && field === "names"
              ? {}
              : merged;
      } else if (field === "price") {
        const price = toScale(decimal(value as string), 2);
        copy[located.priceKey!] = price;
        if (located.priceMirror !== undefined && copy[located.priceMirror] !== null)
          copy[located.priceMirror] = price;
      } else {
        copy[field] = value;
      }
      if (located.presentation && WORDING.has(field))
        copy.presentation = {
          name: copy.name,
          customerName: copy.customerName,
          kitchenName: copy.kitchenName,
          variantName: null,
          variantCustomerName: null,
          variantKitchenName: null,
        };
    }
  });
  return patched;
}
