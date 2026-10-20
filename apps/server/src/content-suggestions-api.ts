import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import {
  discardContentSuggestion,
  listContentSuggestions,
  markSuggestionRunOpened,
  startSuggestionRun,
  type ContentSuggestionRead,
  type ContentSuggestionQuery,
  type TranslationContext,
} from "@waitron/catalogue";
import type { CloudConnection } from "./cloud-client.js";
import type { Logger } from "./logger.js";
import "@waitron/catalogue/src/errors.js";
import "./errors.js";

export interface ContentSuggestionsApiDeps {
  db: Database;
  connection?: Pick<CloudConnection, "translationService">;
  cloudOrigin?: string;
  context: TranslationContext;
  managementOrigin: string;
  isPrimary: () => boolean;
  wake: () => void;
}

const PATH = "/management-api/content-suggestions";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "cloud.not_configured": 409,
    "cloud.state_invalid": 409,
    "cloud.not_primary": 409,
    "content.suggestion_job_running": 409,
    "content.suggestion_not_found": 404,
    "content.translation_stale": 409,
  },
  "catalogue.failed",
);

function invalid(): never {
  throw new AppError("content.translation_invalid", {});
}

function pageQuery(c: Context): ContentSuggestionQuery {
  const params = new URL(c.req.url).searchParams;
  if (
    [...params.keys()].some(
      (key) =>
        !["after", "configuration", "fixesOnly"].includes(key) || params.getAll(key).length !== 1,
    )
  )
    invalid();
  const after = params.get("after");
  const configuration = params.get("configuration");
  const fixesOnly = params.get("fixesOnly");
  if (fixesOnly !== null && fixesOnly !== "1") invalid();
  return {
    ...(after === null ? {} : { after }),
    ...(configuration === null ? {} : { configuration }),
    ...(fixesOnly === null ? {} : { fixesOnly: true }),
  };
}

const authorize = (tx: Transaction, managementSessionId: string) =>
  authorizeManager(tx, { managementSessionId, permission: "catalogue.manage" });

export function mountContentSuggestionsApi(
  app: Hono,
  deps: ContentSuggestionsApiDeps,
  log: Logger,
): void {
  // Reads the saved connection file, never the network, so it may run before a transaction opens.
  const service = async () =>
    deps.connection ? deps.connection.translationService() : ("not_connected" as const);

  app.post(
    `${PATH}/jobs`,
    bodyLimit({
      maxSize: 1024,
      onError: (c) => c.json({ error: { code: "content.translation_invalid", params: {} } }, 400),
    }),
    (c) =>
      run(c, log, async () => {
        if (c.req.header("origin") !== deps.managementOrigin)
          return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
        const sessionId = requireManagementSession(c);
        const body = await readRawJsonBody<unknown>(c);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
          invalid();
        const available = await service();
        const started = await withTransaction(deps.db, async (tx) => {
          await authorize(tx, sessionId);
          if (available !== "on") throw new AppError("cloud.not_configured", {});
          if (!deps.isPrimary()) throw new AppError("cloud.not_primary", {});
          return startSuggestionRun(tx, deps.context);
        });
        if (started) deps.wake();
        return c.json({ run: started });
      }),
  );

  app.get(PATH, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const query = pageQuery(c);
      const available = await service();
      const page = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        // The runner writes the run's records on the primary; a standby leaves them alone.
        if (deps.isPrimary()) await markSuggestionRunOpened(tx);
        return listContentSuggestions(tx, query, deps.context);
      });
      const reply: ContentSuggestionRead = {
        ...page,
        service: available,
        cloudOrigin: deps.cloudOrigin ?? null,
      };
      return c.json(reply);
    }),
  );

  app.delete(`${PATH}/:id`, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        await discardContentSuggestion(tx, id);
      });
      return c.json({ deleted: id });
    }),
  );
}
