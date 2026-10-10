import "./errors.js";
import { and, count, eq } from "drizzle-orm";
import { AppError, type DeleteImpact } from "@waitron/shared";
import {
  kitchenCourses,
  orderDraftLines,
  products,
  ticketItems,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { idsInUse, type Reference } from "./in-use.js";
import type { TillConfig } from "./till-config.js";

/** Retention references; `in-use-references.test.ts` checks declared foreign keys only. */
export const COURSE_REFERENCES: readonly Reference[] = [
  { table: products, column: products.courseId },
  { table: orderDraftLines, column: orderDraftLines.courseId },
  { table: workingOrderLines, column: workingOrderLines.courseId },
  { table: ticketItems, column: ticketItems.courseId },
];

export function coursesInUse(tx: Transaction, ids: readonly string[]): Promise<Set<string>> {
  return idsInUse(tx, COURSE_REFERENCES, ids);
}

async function courseDeleteRules(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<{ impact: DeleteImpact; retained: boolean }> {
  const [target] = await tx
    .select({ id: kitchenCourses.id, name: kitchenCourses.name })
    .from(kitchenCourses)
    .where(
      and(
        eq(kitchenCourses.id, id),
        eq(kitchenCourses.locationId, cfg.locationId),
        eq(kitchenCourses.active, true),
      ),
    );
  if (!target) throw new AppError("course.not_found", { courseId: id });
  // Product-only references retain the row too, even though deletion clears those settings.
  const retained = (await coursesInUse(tx, [id])).has(id);
  const [defaults] = await tx
    .select({ count: count() })
    .from(products)
    .where(eq(products.courseId, id));
  return {
    retained,
    impact: {
      target,
      refusals: [],
      ends: [],
      removes:
        defaults!.count > 0
          ? [{ key: "course_products", count: defaults!.count, targets: [] }]
          : [],
    },
  };
}

export async function readCourseDeleteImpact(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<DeleteImpact> {
  return (await courseDeleteRules(tx, cfg, id)).impact;
}

export async function deleteCourse(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<DeleteImpact> {
  const { impact, retained } = await courseDeleteRules(tx, cfg, id);
  await tx.update(products).set({ courseId: null }).where(eq(products.courseId, id));
  if (retained) {
    await tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, id));
  } else {
    await tx.delete(kitchenCourses).where(eq(kitchenCourses.id, id));
  }
  return impact;
}
