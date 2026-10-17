import { createHash } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { bodyLimit } from "hono/body-limit";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRoutes } from "@waitron/module";
import {
  AppError,
  FALLBACK_LOCALE,
  MEDIA_FILENAME,
  type ReceiptLogoRasters,
} from "@waitron/shared";
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
  listImageUsages,
  validateImageMetadata,
  deleteImage,
  type ImageMetadataInput,
  type ListImagesOptions,
} from "./images.js";
import { saveImage } from "./image-edits.js";
import { validateFraming, type ImageEditInput } from "./framing.js";
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage } from "./prepare.js";
import {
  parsePresentationQuery,
  parseRendition,
  readPresentations,
  renditionUrl,
} from "./presentation.js";
import { RenditionCache } from "./rendition-cache.js";
import { renderRendition } from "./renditions.js";
import "./errors.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "image.busy": 503,
  "image.changed": 409,
  "image.reference_conflict": 409,
  "image.hash_conflict": 409,
  "image.invalid_framing": 400,
  "image.not_found": 404,
  "image.invalid_metadata": 400,
  "image.translation_required": 400,
  "image.too_large": 413,
  "image.invalid_query": 400,
  "image.invalid_file": 422,
  "image.too_many_pixels": 413,
  "content.language_invalid": 400,
  "media.unsupported_type": 415,
};
const run = createErrorBoundary(STATUS, "image.request_failed");
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
  if (!input.names) throw new AppError("image.invalid_metadata", {});
  return input as unknown as ImageMetadataInput;
}
export const MEDIA_ROUTES: ModuleRoutes = {
  mount(app, ctx, log) {
    const fallbackLanguage = ctx.cfg.contentDefaultLanguage ?? FALLBACK_LOCALE;
    const maxUploadBytes = ctx.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>) =>
      withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "image.manage",
        });
        return fn(tx);
      });
    app.get("/management-api/images", (c) =>
      run(c, log, async () => {
        const query = c.req.query();
        const options: ListImagesOptions = {
          query: query.search,
          sort: query.sort as ListImagesOptions["sort"],
          direction: query.direction as ListImagesOptions["direction"],
          language: query.language,
          fallbackLanguage,
        };
        if (query.offset !== undefined) options.offset = Number(query.offset);
        if (query.limit !== undefined) options.limit = Number(query.limit);
        return c.json(await gated(requireManagementSession(c), (tx) => listImages(tx, options)));
      }),
    );
    app.get("/management-api/images/:id", (c) =>
      run(c, log, async () => {
        const session = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "ImageId");
        return c.json(
          await gated(session, async (tx) => ({
            image: await readImage(tx, id),
            uses: await listImageUsages(tx, id),
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
          // Checked before the body is parsed, so a caller without `image.manage` costs no image
          // work. A read outside any transaction, so it must write nothing: `touch: false`.
          // The decode runs outside the write lock, so permission is checked again inside the
          // transaction that stores the photo, and that check is the one that admits the write.
          await authorizeManager(ctx.db, {
            managementSessionId: session,
            permission: "image.manage",
            touch: false,
          });
          let form: Awaited<ReturnType<typeof c.req.parseBody>>;
          try {
            form = await c.req.parseBody();
          } catch {
            throw new AppError("image.invalid_metadata", {});
          }
          const file = form.file;
          if (!(file instanceof File)) throw new AppError("image.invalid_metadata", {});
          const input = metadata({ names: parseField(form.names) });
          // Outside any transaction: see prepareImage.
          const image = await prepareImage(new Uint8Array(await file.arrayBuffer()), {
            maxUploadBytes,
          });
          const result = await gated(session, (tx) =>
            uploadImage(tx, { ...input, image, originalFilename: file.name }, { fallbackLanguage }),
          );
          return c.json(
            { image: result.image, created: result.created },
            result.created ? 201 : 200,
          );
        }),
    );
    app.patch(
      "/management-api/images/:id",
      bodyLimit({
        maxSize: maxUploadBytes + 64 * 1024,
        onError: (c) =>
          c.json({ error: { code: "image.too_large", params: { maxBytes: maxUploadBytes } } }, 413),
      }),
      (c) =>
        run(c, log, async () => {
          const session = requireManagementSession(c);
          await authorizeManager(ctx.db, {
            managementSessionId: session,
            permission: "image.manage",
            touch: false,
          });
          const id = requireUuidParam(c.req.param("id"), "ImageId");
          let input: Record<string, unknown>;
          let file: File | undefined;
          if (c.req.header("Content-Type")?.startsWith("multipart/form-data")) {
            let form: Awaited<ReturnType<typeof c.req.parseBody>>;
            try {
              form = await c.req.parseBody({ all: true });
            } catch {
              throw new AppError("image.invalid_metadata", {});
            }
            if (!(form.file instanceof File)) throw new AppError("image.invalid_metadata", {});
            file = form.file;
            input = {
              names: parseField(form.names),
              framing: parseField(form.framing),
              expectedRevision: parseField(form.expectedRevision),
            };
          } else {
            input = metadata(await readJsonBody(c)) as unknown as Record<string, unknown>;
          }
          if (
            !Number.isSafeInteger(input.expectedRevision) ||
            (input.expectedRevision as number) < 0 ||
            (input.expectedRevision as number) >= Number.MAX_SAFE_INTEGER
          )
            throw new AppError("image.invalid_metadata", {});
          const framing = validateFraming(input.framing);
          const names = await validateImageMetadata(ctx.db, metadata(input), fallbackLanguage);
          const current = await readImage(ctx.db, id);
          if (input.expectedRevision !== current.revision)
            throw new AppError("image.changed", { imageId: id });
          const edit: ImageEditInput = {
            ...names,
            framing,
            expectedRevision: input.expectedRevision as number,
            ...(file ? { originalFilename: file.name } : {}),
          };
          const pixelsChanged =
            !!file ||
            framing.x !== current.framing.x ||
            framing.y !== current.framing.y ||
            framing.zoom !== current.framing.zoom;
          if (pixelsChanged && !ctx.renderReceiptLogo) throw new AppError("image.busy", {});
          const prepared = file
            ? await prepareImage(new Uint8Array(await file.arrayBuffer()), { maxUploadBytes })
            : null;
          let rasters: ReceiptLogoRasters | undefined;
          if (pixelsChanged) {
            const source = prepared ?? (await readImageBytes(ctx.db, current.sourceFilename));
            if (!source) throw new AppError("image.not_found", { imageId: id });
            const display = await renditions.get(
              renditionUrl(prepared?.filename ?? current.sourceFilename, "display", framing),
              () => renderRendition(source.bytes, "display", framing),
            );
            rasters = await ctx.renderReceiptLogo!(display);
          }
          return c.json({
            image: await gated(session, (tx) =>
              saveImage(tx, id, edit, prepared, rasters, fallbackLanguage),
            ),
          });
        }),
    );
    app.delete("/management-api/images/:id", (c) =>
      run(c, log, async () => {
        const session = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "ImageId");
        return c.json(await gated(session, (tx) => deleteImage(tx, id)));
      }),
    );
    const renditions = new RenditionCache();
    app.get("/media/presentations", (c) =>
      run(c, log, async () => {
        const references = parsePresentationQuery(c.req.queries());
        const images = await readPresentations(ctx.db, references);
        c.header("Cache-Control", "no-store");
        return c.json({ images });
      }),
    );
    app.get("/media/renditions/:version/:source/:shape/:frame", (c) =>
      run(c, log, async () => {
        const recipe = parseRendition(
          c.req.param("version"),
          c.req.param("source"),
          c.req.param("shape"),
          c.req.param("frame"),
        );
        if (!recipe) return c.body(null, 404);
        const source = await readImageBytes(ctx.db, recipe.source);
        if (!source) return c.body(null, 404);
        const bytes = await renditions.get(
          renditionUrl(recipe.source, recipe.shape, recipe.framing),
          () => renderRendition(source.bytes, recipe.shape, recipe.framing),
        );
        const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
        const headers = {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          ETag: etag,
        };
        if (c.req.header("If-None-Match") === etag) return c.body(null, 304, headers);
        return c.body(new Uint8Array(bytes), 200, headers);
      }),
    );
    app.get("/media/:filename", (c) =>
      run(c, log, async () => {
        const filename = c.req.param("filename");
        if (!MEDIA_FILENAME.test(filename)) return c.body(null, 404);
        const content = await withTransaction(ctx.db, async (tx) => {
          return readImageBytes(tx, filename);
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
