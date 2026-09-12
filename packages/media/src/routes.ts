import type { ContentfulStatusCode } from "hono/utils/http-status";
import { bodyLimit } from "hono/body-limit";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRoutes } from "@waitron/module";
import { AppError, FALLBACK_LOCALE } from "@waitron/shared";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  requireUuidParam,
} from "@waitron/server-kit";
import {
  uploadImage,
  readImage,
  readImageBytes,
  listImages,
  listImageLabels,
  listImageUsages,
  updateImage,
  deleteImage,
  type ImageMetadataInput,
  type ListImagesOptions,
} from "./images.js";
import "./errors.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "image.not_found": 404,
  "image.invalid_metadata": 400,
  "image.translation_required": 400,
  "image.too_large": 413,
  "image.invalid_query": 400,
  "content.language_invalid": 400,
  "media.unsupported_type": 415,
};
const run = createErrorBoundary(STATUS, "image.request_failed");
export const MEDIA_FILENAME = /^[0-9a-f]{64}\.(jpg|png|webp)$/;
function parseField(value: unknown): unknown {
  if (typeof value !== "string") throw new AppError("image.invalid_metadata", {});
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError("image.invalid_metadata", {});
  }
}
function metadata(value: unknown): ImageMetadataInput {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new AppError("image.invalid_metadata", {});
  const input = value as Record<string, unknown>;
  if (!input.names || !input.altText || !input.labels)
    throw new AppError("image.invalid_metadata", {});
  return input as unknown as ImageMetadataInput;
}
export const MEDIA_ROUTES: ModuleRoutes = {
  mount(app, ctx, log) {
    const tenantId = ctx.cfg.tenantId;
    const fallbackLanguage = ctx.cfg.contentDefaultLanguage ?? FALLBACK_LOCALE;
    const maxUploadBytes = ctx.maxUploadBytes ?? 5 * 1024 * 1024;
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>) =>
      withTenant(ctx.db, tenantId, async (tx) => {
        await asAppUser(tx);
        const auth = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "image.manage",
        });
        const member = await tx.execute(
          sql`select 1 from persons where tenant_id=${tenantId} and id=${auth.authorizedBy}`,
        );
        if (member.rows.length === 0)
          throw new AppError("authorization.not_permitted", { permission: "image.manage" });
        return fn(tx);
      });
    app.get("/management-api/images", (c) =>
      run(c, log, async () => {
        const query = c.req.query();
        const options: ListImagesOptions = {
          query: query.search,
          label: query.label,
          sort: query.sort as ListImagesOptions["sort"],
          direction: query.direction as ListImagesOptions["direction"],
          language: query.language,
          fallbackLanguage,
        };
        if (query.offset !== undefined) options.offset = Number(query.offset);
        if (query.limit !== undefined) options.limit = Number(query.limit);
        return c.json(
          await gated(requireManagementSession(c), (tx) => listImages(tx, tenantId, options)),
        );
      }),
    );
    app.get("/management-api/image-labels", (c) =>
      run(c, log, async () =>
        c.json({
          labels: await gated(requireManagementSession(c), (tx) => listImageLabels(tx, tenantId)),
        }),
      ),
    );
    app.get("/management-api/images/:id", (c) =>
      run(c, log, async () => {
        const session = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "ImageId");
        return c.json(
          await gated(session, async (tx) => ({
            image: await readImage(tx, tenantId, id),
            uses: await listImageUsages(tx, tenantId, id),
          })),
        );
      }),
    );
    app.post(
      "/management-api/images",
      bodyLimit({
        maxSize: maxUploadBytes + 64 * 1024,
        onError: (c) =>
          c.json({ error: { code: "image.too_large", params: { maxBytes: maxUploadBytes } } }, 413),
      }),
      (c) =>
        run(c, log, async () => {
          const session = requireManagementSession(c);
          const result = await gated(session, async (tx) => {
            let form: Awaited<ReturnType<typeof c.req.parseBody>>;
            try {
              form = await c.req.parseBody();
            } catch {
              throw new AppError("image.invalid_metadata", {});
            }
            const file = form.file;
            if (!(file instanceof File)) throw new AppError("image.invalid_metadata", {});
            const input = metadata({
              names: parseField(form.names),
              altText: parseField(form.altText),
              labels: parseField(form.labels),
            });
            return uploadImage(
              tx,
              tenantId,
              { ...input, bytes: new Uint8Array(await file.arrayBuffer()) },
              { maxUploadBytes, fallbackLanguage },
            );
          });
          return c.json({ image: result.image }, result.created ? 201 : 200);
        }),
    );
    app.patch("/management-api/images/:id", (c) =>
      run(c, log, async () => {
        const session = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "ImageId");
        const input = metadata(await readJsonBody(c));
        return c.json({
          image: await gated(session, (tx) =>
            updateImage(tx, tenantId, id, input, fallbackLanguage),
          ),
        });
      }),
    );
    app.delete("/management-api/images/:id", (c) =>
      run(c, log, async () => {
        const session = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "ImageId");
        return c.json(await gated(session, (tx) => deleteImage(tx, tenantId, id)));
      }),
    );
    app.get("/media/:filename", (c) =>
      run(c, log, async () => {
        const filename = c.req.param("filename");
        if (!MEDIA_FILENAME.test(filename)) return c.body(null, 404);
        const content = await withTenant(ctx.db, tenantId, async (tx) => {
          await asAppUser(tx);
          return readImageBytes(tx, tenantId, filename);
        });
        if (!content) return c.body(null, 404);
        return c.body(new Uint8Array(content.bytes), 200, {
          "Content-Type": content.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
      }),
    );
  },
};
