import "@waitron/menu/src/errors.js";
import { type SectionPatch, isProductPrice } from "@waitron/menu";
import {
  isUuid,
  normaliseUuid,
  AppError,
  type SectionInput,
  type MemberRef,
} from "@waitron/shared";
import { requireBodyUuid } from "@waitron/server-kit";

export function nullOrUuid(value: unknown, field: string): string | null {
  if (value !== null && (typeof value !== "string" || !isUuid(value)))
    throw new AppError("management.request_invalid", { field });
  return value;
}
/** A section's, a menu's or an include folder's presentation body, shape only: the menu
 * function each route hands it to checks the values. */
export function sectionInput(body: Record<string, unknown>, creating: true): SectionInput;
export function sectionInput(body: Record<string, unknown>, creating: false): SectionPatch;
export function sectionInput(body: Record<string, unknown>, creating: boolean): SectionPatch {
  const result: SectionPatch = {};
  if (creating || body.internalName !== undefined) {
    if (typeof body.internalName !== "string")
      throw new AppError("management.request_invalid", { field: "internalName" });
    result.internalName = body.internalName;
  }
  if (body.names !== undefined) {
    if (
      !isPlainObject(body.names) ||
      Object.values(body.names).some((value) => typeof value !== "string")
    )
      throw new AppError("management.request_invalid", { field: "names" });
    result.names = body.names as Record<string, string>;
  }
  for (const field of ["image", "color"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string")
      throw new AppError("management.request_invalid", { field });
    result[field] = value;
  }
  return result;
}
export function memberRef(value: unknown): MemberRef {
  if (isPlainObject(value)) {
    if (value.kind === "product" && typeof value.productId === "string")
      return { kind: "product", productId: requireUuidParam(value.productId, "ProductId") };
    if (value.kind === "section" && typeof value.sectionId === "string")
      return { kind: "section", sectionId: requireUuidParam(value.sectionId, "SectionId") };
    if (value.kind === "set_menu" && typeof value.menuId === "string")
      return { kind: "set_menu", menuId: requireUuidParam(value.menuId, "MenuId") };
  }
  throw new AppError("management.request_invalid", { field: "ref" });
}
/** An array of strings, each a well-formed id of `kind`. */
export function idList(value: unknown, field: string, kind: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new AppError("management.request_invalid", { field });
  return value.map((entry: string) => requireUuidParam(entry, kind));
}
/** A position or index, shape only: the section writes refuse a negative or fractional one. */
export function numberField(value: unknown, field: string): number {
  if (typeof value !== "number") throw new AppError("management.request_invalid", { field });
  return value;
}
/**
 * Nothing below this screen objects to a malformed id — every id column is plain `text`, so the
 * value would simply match no row. Shape only: a well-formed id that names no row passes.
 */
export function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}
/** A menu price the product editor would accept: the shape `isProductPrice` allows, never rounded. */
export function refuseInvalidPrice(value: string, field: string): void {
  if (!isProductPrice(value)) throw new AppError("product.invalid", { field });
}
// Ignoring a retired field would answer success without saving what the caller asked for.
export function refuseRetiredFields(
  body: Record<string, unknown>,
  fields: readonly string[],
): void {
  for (const retired of fields)
    if (body[retired] !== undefined)
      throw new AppError("management.request_invalid", { field: retired });
}
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) invalid(field);
  return value;
}

export function rows<T>(
  value: unknown,
  field: string,
  read: (row: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) invalid(field);
  return value.map((row, index) => read(row, field + "." + index));
}

export function bodyId(value: unknown, field: string): string {
  return normaliseUuid(requireBodyUuid(value, field), field);
}

export function refOf(value: unknown, path: string): MemberRef {
  const ref = object(value, path);
  switch (ref.kind) {
    case "product":
      return { kind: ref.kind, productId: bodyId(ref.productId, path + ".productId") };
    case "section":
      return { kind: ref.kind, sectionId: bodyId(ref.sectionId, path + ".sectionId") };
    case "set_menu":
      return { kind: ref.kind, menuId: bodyId(ref.menuId, path + ".menuId") };
    default:
      return invalid(path + ".kind");
  }
}

export function homeRefOf(value: unknown, path: string) {
  const ref = object(value, path);
  if (ref.kind === "missing") return { kind: "missing" } as const;
  const member = refOf(ref, path);
  if (member.kind === "set_menu")
    throw new AppError("set_menu.wrong_place", { menuId: member.menuId, field: path });
  return member;
}
