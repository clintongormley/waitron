import type { Context, Hono } from "hono";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import {
  listTranslationItems,
  resolveTranslationCells,
  saveContentTranslations,
  type TranslationContext,
} from "@waitron/catalogue";
import type {
  TranslationCellEdit,
  TranslationCellRef,
  TranslationQuery,
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
function query(c: Context): TranslationQuery {
  const params = new URL(c.req.url).searchParams;
  const repeated = ["language", "target"];
  if (
    [...params.keys()].some(
      (key) =>
        ![
          ...repeated,
          "missing",
          "missingLanguage",
          "kind",
          "search",
          "after",
          "waitingFixes",
        ].includes(key) ||
        (!repeated.includes(key) && params.getAll(key).length > 1),
    )
  )
    invalidQuery();
  const languages = params.getAll("language");
  const targets = params.getAll("target");
  if (targets.length) {
    if ([...params.keys()].some((key) => !repeated.includes(key))) invalidQuery();
    return {
      languages,
      targets: targets.map((value) => {
        const colon = value.indexOf(":");
        if (colon === -1) invalidQuery();
        return {
          kind: value.slice(0, colon) as TranslationRef["kind"],
          id: value.slice(colon + 1),
        };
      }),
    };
  }
  const mode = params.get("missing") ?? "any";
  const missingLanguage = params.get("missingLanguage");
  if (
    (mode !== "any" && mode !== "all" && mode !== "language") ||
    (mode === "language" ? missingLanguage === null : missingLanguage !== null)
  )
    invalidQuery();
  const waiting = params.get("waitingFixes");
  if (waiting !== null && waiting !== "1") invalidQuery();
  return {
    languages,
    missing: mode === "language" ? { mode, language: missingLanguage! } : { mode },
    ...(params.has("kind") ? { kind: params.get("kind") as TranslationRef["kind"] } : {}),
    ...(params.has("search") ? { search: params.get("search")! } : {}),
    ...(params.has("after") ? { after: params.get("after")! } : {}),
    ...(waiting === "1" ? { waitingFixes: true } : {}),
  };
}
function cells(c: Context): TranslationCellRef[] {
  const params = new URL(c.req.url).searchParams;
  if ([...params.keys()].some((key) => key !== "cell")) invalidQuery();
  return params.getAll("cell").map((value) => {
    let tuple: unknown;
    try {
      tuple = JSON.parse(value);
    } catch {
      invalidQuery();
    }
    if (!Array.isArray(tuple) || tuple.length !== 4) invalidQuery();
    return {
      kind: tuple[0],
      id: tuple[1],
      language: tuple[2],
      field: tuple[3],
    } as TranslationCellRef;
  });
}
async function body(c: Context): Promise<{ edits: TranslationCellEdit[] }> {
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
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as {
      edits: TranslationCellEdit[];
    };
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
  managementOrigin?: string,
): void {
  const path = "/management-api/content-translations";
  app.get(`${path}/cells`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const input = cells(c);
      return c.json(await gated(c, session, (tx) => resolveTranslationCells(tx, input, context)));
    }),
  );
  app.get(path, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const input = query(c);
      return c.json(await gated(c, session, (tx) => listTranslationItems(tx, input, context)));
    }),
  );
  app.put(path, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      if (c.req.header("origin") !== (managementOrigin ?? new URL(c.req.url).origin))
        return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
      const input = await body(c);
      return c.json(await gated(c, session, (tx) => saveContentTranslations(tx, input, context)));
    }),
  );
}
