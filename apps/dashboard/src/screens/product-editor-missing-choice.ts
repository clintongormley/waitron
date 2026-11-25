import type { ProductEditorInput } from "../api/client.js";

/** The editor field that chose the id a not-found refusal names, or null when the save sent no such
 * id there. */
export function missingChoiceField(
  code: string,
  error: unknown,
  submitted: ProductEditorInput,
): string | null {
  const params = (error as { params?: Record<string, unknown> }).params ?? {};
  const named = (key: string, sent: string | null | undefined) =>
    typeof params[key] === "string" && params[key] === sent;
  if (code === "category.not_found" && named("categoryId", submitted.primaryCategoryId))
    return "primary";
  if (code === "unit.not_found" && named("unitId", submitted.unitId)) return "unit";
  if (code === "course.not_found" && named("courseId", submitted.courseId)) return "product-course";
  if (code === "product.variant_not_found") {
    const index = submitted.variants.findIndex((variant) => named("variantId", variant.id));
    if (index !== -1) return `variant-${index}-name`;
  }
  return null;
}
