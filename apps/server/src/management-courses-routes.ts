import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { isUuid, AppError, FALLBACK_LOCALE, normalizeOptionalTranslations } from "@waitron/shared";
import type { Hono } from "hono";
// Error declaration for `course.not_found` in the route and path id check.
import "@waitron/venue-service";
import { readCourseDeleteImpact, deleteCourse } from "./course-delete.js";
import {
  createCourse,
  listCourses,
  updateCourse,
  moveCourse,
  setProductCourse,
} from "./kitchen.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run, runProductCourse } from "./management-api-errors.js";
import {
  parseDisplayOrder,
  withVenueAuth,
  withVenueReadAuth,
  requireProductId,
} from "./management-request-fields.js";

function requireCourseId(id: string): string {
  if (!isUuid(id)) throw new AppError("course.not_found", { courseId: id });
  return id;
}

export function mountManagementCourseRoutes(app: Hono, deps: ManagementApiDeps, log: Logger): void {
  // ── Kitchen courses and fire control ──
  app.post("/management-api/courses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      const { name } = body;
      const result = await withVenueAuth(deps, sessionId, (tx) =>
        createCourse(tx, { name, displayOrder }),
      );
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/courses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const courses = await withVenueReadAuth(deps, sessionId, (tx) => listCourses(tx));
      return c.json(courses);
    }),
  );

  app.patch("/management-api/courses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
        active?: unknown;
        customerNames?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (Object.hasOwn(body, "active"))
        throw new AppError("management.request_invalid", { field: "active" });
      const patch: Parameters<typeof updateCourse>[2] = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.customerNames !== undefined) {
        if (normalizeOptionalTranslations(body.customerNames) === null)
          throw new AppError("management.request_invalid", { field: "customerNames" });
        patch.customerNames = body.customerNames as Record<string, string>;
      }
      await withVenueAuth(deps, sessionId, (tx) =>
        updateCourse(tx, id, patch, deps.venueLocale ?? FALLBACK_LOCALE),
      );
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/courses/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      return c.json(await withVenueAuth(deps, sessionId, (tx) => readCourseDeleteImpact(tx, id)));
    }),
  );

  app.delete("/management-api/courses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      if (c.req.query("disable") !== undefined)
        throw new AppError("management.request_invalid", { field: "disable" });
      return c.json(await withVenueAuth(deps, sessionId, (tx) => deleteCourse(tx, id)));
    }),
  );

  app.put("/management-api/courses/:id/position", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      const body = await readJsonBody<{ to?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const { to } = body;
      if (typeof to !== "number" || !Number.isInteger(to) || to < 0) {
        throw new AppError("management.request_invalid", { field: "to" });
      }
      return c.json(await withVenueAuth(deps, sessionId, (tx) => moveCourse(tx, id, to)));
    }),
  );

  // `null` clears the product's course.
  app.put("/management-api/products/:id/course", (c) =>
    runProductCourse(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireProductId(c.req.param("id"));
      const body = await readJsonBody<{ courseId?: unknown }>(c);
      if (typeof body.courseId !== "string" && body.courseId !== null) {
        throw new AppError("management.request_invalid", { field: "courseId" });
      }
      const courseId = body.courseId;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withVenueAuth(deps, sessionId, (tx) => setProductCourse(tx, id, courseId));
      return c.body(null, 204);
    }),
  );
}
