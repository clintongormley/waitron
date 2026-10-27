import { AppError, decimal, toScale, type ContentLanguages } from "@waitron/shared";
import "./errors.js";
import type { MenuDocument } from "./menu-document-types.js";
import { PATCH_FIELDS, type MenuPatchChange, type MenuPatchTarget } from "./menu-patch-types.js";
import { isProductPrice } from "./modifier-limits.js";
import {
  mergeOptionalTranslations,
  validateOptionalTranslations,
} from "./optional-translations.js";
import { VAT_CLASSES } from "./vat-rates.js";

type Copy = Record<string, unknown>;

/** Every copy of the target the document holds, and the key that mirrors its price when the menu
 * sets one. */
interface Located {
  copies: Copy[];
  priceMirror: string;
}

const TRANSLATED = new Set(["customerName", "names", "description"]);

function invalid(change: number, field: string, reason?: string): AppError<"menu_patch.invalid"> {
  return new AppError(
    "menu_patch.invalid",
    reason === undefined ? { change, field } : { change, field, reason },
  );
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
      if (value !== null && (typeof value !== "string" || value === ""))
        throw invalid(change, field);
      return value;
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
        throw invalid(change, field, (error as AppError).code);
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

function locate(document: MenuDocument, target: MenuPatchTarget): Located | undefined {
  switch (target.kind) {
    case "offer": {
      const offer = document.offers[target.menuItemId];
      return offer === undefined ? undefined : { copies: [offer], priceMirror: "grossPrice" };
    }
    case "variant": {
      const variant = document.offers[target.menuItemId]?.variants.find(
        (candidate) => candidate.id === target.variantId,
      );
      return variant === undefined ? undefined : { copies: [variant], priceMirror: "menuPrice" };
    }
    default:
      return undefined;
  }
}

const keyOf = (field: string): string => (field === "price" ? "unitPrice" : field);

/** The value a field holds now at the first copy a patch would change; `undefined` when the
 * document does not hold the target. */
export function patchFieldValue(
  document: MenuDocument,
  target: MenuPatchTarget,
  field: string,
): unknown {
  return locate(document, target)?.copies[0]![keyOf(field)];
}

/** A patched copy of `document`, which is never changed and may be deep-frozen. */
export function applyMenuPatch(
  document: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
): MenuDocument {
  const patched = structuredClone(document);
  parseMenuPatch(changes).forEach(({ target, field, value }, index) => {
    const located = locate(patched, target);
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
          throw invalid(index, field, (error as AppError).code);
        }
        copy[field] = merged;
      } else if (field === "price") {
        const price = toScale(decimal(value as string), 2);
        copy.unitPrice = price;
        if (copy[located.priceMirror] !== null) copy[located.priceMirror] = price;
      } else {
        copy[field] = value;
      }
    }
  });
  return patched;
}
