import { starterName } from "@waitron/country-packs";
import {
  departmentCourses,
  floorZones,
  readTaxpayer,
  readVenue,
  type Transaction,
} from "@waitron/db";
import { STARTER_COURSE_NAMES } from "@waitron/venue-service";
import type { DemoCourseKey } from "@waitron/country";
import { eq } from "drizzle-orm";
import { createCourse, listCourses } from "../../src/kitchen.js";
import { ownsDemoDataSet, type DemoDataSet } from "./data-set.js";

export async function seedCourses(
  tx: Transaction,
  dataSet: DemoDataSet,
): Promise<ReadonlyMap<DemoCourseKey, string> | undefined> {
  const venue = await readVenue(tx);
  const taxpayer = await readTaxpayer(tx);
  if (!ownsDemoDataSet(dataSet, { country: taxpayer?.country, area: venue.province ?? undefined }))
    return undefined;

  const courses = await listCourses(tx);
  const ids = new Map<DemoCourseKey, string>();
  let language: "en" | "es" = "en";
  let displayOrder = (courses.at(-1)?.displayOrder ?? -1) + 1;
  const fireNow: string[] = [];
  for (const course of dataSet.courses) {
    if ("starter" in course) {
      const translated = starterName(STARTER_COURSE_NAMES, course.starter, "es");
      const [match, duplicate] = courses.filter(
        ({ name }) => name === course.starter || name === translated,
      );
      if (match === undefined || duplicate !== undefined)
        throw new Error(`seedCourses: expected one starter course "${course.starter}"`);
      if (match.name !== course.starter) language = "es";
      ids.set(course.key, match.id);
    } else {
      const { id } = await createCourse(tx, { name: course.name[language], displayOrder });
      ids.set(course.key, id);
      displayOrder += 1;
      if (course.fireNow) fireNow.push(id);
    }
  }
  if (fireNow.length > 0) {
    const [zone] = await tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.isCounterDefault, true))
      .limit(1);
    if (zone === undefined) throw new Error("seedCourses: the venue has no default service zone");
    // The deli inherits these department settings when seedFloor creates it.
    await tx.insert(departmentCourses).values(
      fireNow.map((courseId) => ({
        departmentId: zone.departmentId,
        courseId,
        heldUntilFired: false,
      })),
    );
  }
  return ids;
}
