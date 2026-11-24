import "./errors.js";
import { and, count, eq } from "drizzle-orm";
import { AppError, type DeleteImpact } from "@waitron/shared";
import {
  kitchenCourses,
  menus,
  menuItems,
  setMenuLines,
  departmentCourses,
  orderDraftLines,
  products,
  setMenuDishCourses,
  setMenuLineCourses,
  ticketItems,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import {
  clearCourseDeleteSettings,
  courseDeleteSettingsRemoves,
  readCourseDeleteSettings,
  type CourseDeleteSettings,
  serviceSteps,
} from "@waitron/venue-service";
import { idsInUse, type Reference } from "./in-use.js";

/** Retention references; `in-use-references.test.ts` checks declared foreign keys only. */
export const COURSE_REFERENCES: readonly Reference[] = [
  { table: products, column: products.courseId },
  { table: setMenuLineCourses, column: setMenuLineCourses.courseId },
  { table: setMenuDishCourses, column: setMenuDishCourses.courseId },
  { table: departmentCourses, column: departmentCourses.courseId },
  { table: orderDraftLines, column: orderDraftLines.courseId },
  { table: workingOrderLines, column: workingOrderLines.courseId },
  { table: ticketItems, column: ticketItems.courseId },
  { table: serviceSteps, column: serviceSteps.courseId },
];

export function coursesInUse(tx: Transaction, ids: readonly string[]): Promise<Set<string>> {
  return idsInUse(tx, COURSE_REFERENCES, ids);
}

async function courseDeleteRules(
  tx: Transaction,
  id: string,
): Promise<{ impact: DeleteImpact; retained: boolean; settings: CourseDeleteSettings }> {
  const [target] = await tx
    .select({ id: kitchenCourses.id, name: kitchenCourses.name })
    .from(kitchenCourses)
    .where(and(eq(kitchenCourses.id, id), eq(kitchenCourses.active, true)));
  if (!target) throw new AppError("course.not_found", { courseId: id });
  // Count references before clearing them so course IDs already used remain reserved.
  const retained = (await coursesInUse(tx, [id])).has(id);
  const [defaults] = await tx
    .select({ count: count() })
    .from(products)
    .where(eq(products.courseId, id));
  const [lines] = await tx
    .select({ count: count() })
    .from(setMenuLineCourses)
    .innerJoin(setMenuLines, eq(setMenuLines.id, setMenuLineCourses.lineId))
    .innerJoin(menus, eq(menus.id, setMenuLines.menuId))
    .where(and(eq(setMenuLineCourses.courseId, id), eq(menus.active, true)));
  const [dishes] = await tx
    .select({ count: count() })
    .from(setMenuDishCourses)
    .innerJoin(menuItems, eq(menuItems.id, setMenuDishCourses.menuItemId))
    .innerJoin(menus, eq(menus.id, menuItems.menuId))
    .where(and(eq(setMenuDishCourses.courseId, id), eq(menus.active, true)));
  const settings = await readCourseDeleteSettings(tx, id);
  return {
    retained,
    settings,
    impact: {
      target,
      refusals: [],
      ends: [],
      removes: [
        ...(defaults!.count > 0
          ? [{ key: "course_products", count: defaults!.count, targets: [] }]
          : []),
        ...(lines!.count > 0
          ? [{ key: "course_set_menu_lines", count: lines!.count, targets: [] }]
          : []),
        ...(dishes!.count > 0
          ? [{ key: "course_set_menu_dishes", count: dishes!.count, targets: [] }]
          : []),
        ...courseDeleteSettingsRemoves(settings),
      ],
    },
  };
}

export async function readCourseDeleteImpact(tx: Transaction, id: string): Promise<DeleteImpact> {
  return (await courseDeleteRules(tx, id)).impact;
}

export async function deleteCourse(tx: Transaction, id: string): Promise<DeleteImpact> {
  const { impact, retained, settings } = await courseDeleteRules(tx, id);
  await tx.update(products).set({ courseId: null }).where(eq(products.courseId, id));
  await tx.delete(setMenuLineCourses).where(eq(setMenuLineCourses.courseId, id));
  await tx.delete(setMenuDishCourses).where(eq(setMenuDishCourses.courseId, id));
  await clearCourseDeleteSettings(tx, settings);
  await tx.delete(departmentCourses).where(eq(departmentCourses.courseId, id));
  if (retained) {
    await tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, id));
  } else {
    await tx.delete(kitchenCourses).where(eq(kitchenCourses.id, id));
  }
  return impact;
}
