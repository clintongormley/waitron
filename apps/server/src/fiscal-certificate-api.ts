import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import type { Database, DeploymentEnvironment, Transaction } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import { authorizeManager, persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface FiscalCertificateApiDeps {
  db: Database;
  ring: KeyRing;
  seat: Pick<FiscalCertificateSeat, "read" | "install">;
  nodeId: string;
  locationId: string;
  environment: DeploymentEnvironment;
  filing(): boolean;
  now(): Date;
}

const path = "/management-api/fiscal-certificate";

/** Opens no transaction of its own: the seat opens each one and calls `authorize` first inside it. */
export function mountFiscalCertificateApi(
  app: Hono,
  deps: FiscalCertificateApiDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "fiscal.certificate_not_used": 409,
      "fiscal.certificate_changed": 409,
      "fiscal.certificate_request_invalid": 400,
    },
    "fiscal_certificate.failed",
  );
  const nameOf = async (tx: Transaction, personId: string): Promise<string | null> => {
    const [person] = await tx
      .select({ name: persons.displayName })
      .from(persons)
      .where(eq(persons.id, personId));
    return person?.name ?? null;
  };
  app.get(path, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const card = await deps.seat.read(
        {
          db: deps.db,
          nodeId: deps.nodeId,
          locationId: deps.locationId,
          authorize: async (tx) => {
            await authorizeManager(tx, { managementSessionId, permission: "fiscal.view" });
          },
          nameOf,
        },
        deps.now(),
      );
      return c.json({ filing: deps.filing(), ...card });
    }),
  );
  app.post(
    path,
    bodyLimit({
      maxSize: 200_000,
      onError: (c) => c.json({ error: { code: "fiscal.certificate_too_large", params: {} } }, 413),
    }),
    (c) =>
      run(c, log, async () => {
        const managementSessionId = requireManagementSession(c);
        const body = await readJsonBody<unknown>(c);
        const answer = await deps.seat.install(
          {
            db: deps.db,
            ring: deps.ring,
            nodeId: deps.nodeId,
            locationId: deps.locationId,
            environment: deps.environment,
            authorize: async (tx) => {
              const session = await authorizeManager(tx, {
                managementSessionId,
                permission: "system.manage",
              });
              if (!deps.filing()) throw new AppError("fiscal.certificate_not_used", {});
              return { personId: session.authorizedBy };
            },
            log,
            clock: deps.now,
          },
          body,
          deps.now(),
        );
        return c.json(answer);
      }),
  );
}
