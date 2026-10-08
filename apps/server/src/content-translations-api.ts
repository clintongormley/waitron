import type { Context, Hono } from "hono";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import {
  listTranslationTargets,
  saveContentTranslations,
  type TranslationContext,
} from "@waitron/catalogue";
import type {
  TranslationBatch,
  TranslationRef,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { Logger } from "./logger.js";
import "@waitron/catalogue/src/errors.js";

export type GatedWork = <T>(
  c: Context,
  sessionId: string,
  fn: (tx: Transaction, personId: string) => Promise<T>,
) => Promise<T>;

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "content.translation_stale": 409,
    "content.translation_unavailable": 409,
  },
  "catalogue.failed",
);

function invalidQuery(): never {
  throw new AppError("content.translation_invalid", {});
}
function query(c: Context): { after?: string; targets?: TranslationRef[] } {
  const params = new URL(c.req.url).searchParams;
  if (
    [...params.keys()].some((key) => key !== "after" && key !== "target") ||
    params.getAll("after").length > 1
  )
    invalidQuery();
  const after = params.get("after");
  const targets = params.getAll("target");
  if (after !== null && targets.length) invalidQuery();
  if (after !== null) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(after);
    } catch {
      invalidQuery();
    }
    if (
      cursor === null ||
      typeof cursor !== "object" ||
      Array.isArray(cursor) ||
      Object.keys(cursor).length !== 2 ||
      !Object.hasOwn(cursor, "kind") ||
      !Object.hasOwn(cursor, "id")
    )
      invalidQuery();
    return { after };
  }
  if (targets.length)
    return {
      targets: targets.map((value) => {
        const colon = value.indexOf(":");
        if (colon === -1) invalidQuery();
        return {
          kind: value.slice(0, colon) as TranslationRef["kind"],
          id: value.slice(colon + 1),
        };
      }),
    };
  return {};
}
async function body(c: Context): Promise<TranslationBatch> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new AppError("content.translation_batch_invalid", {});
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      // Content-Length is caller-controlled; enforce the bound on every received chunk.
      if (bytes > 262144) {
        await reader.cancel();
        throw new AppError("content.translation_batch_invalid", {});
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as TranslationBatch;
  } catch {
    throw new AppError("content.translation_batch_invalid", {});
  } finally {
    reader.releaseLock();
  }
}

export function mountContentTranslationsApi(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  context: TranslationContext,
): void {
  const path = "/management-api/content-translations/:language";
  app.get(path, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const input = query(c);
      return c.json(
        await gated(c, session, (tx) =>
          listTranslationTargets(tx, c.req.param("language"), input, context),
        ),
      );
    }),
  );
  app.put(path, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const input = await body(c);
      return c.json(
        await gated(c, session, (tx) =>
          saveContentTranslations(tx, c.req.param("language"), input, context),
        ),
      );
    }),
  );
}
