import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import type { Database, DeploymentEnvironment, Transaction } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import { authorizeManager, persons, resolveManagementSession } from "@waitron/identity";
import { AppError, isAppError, type ErrorCode } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { CertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import "./errors.js";

export interface FiscalCertificateApiDeps {
  db: Database;
  ring: KeyRing;
  seat: Pick<FiscalCertificateSeat, "read" | "install" | "diagnose" | "diagnoseInChild">;
  diagnosisRunner?: CertificateDiagnosisRunner;
  nodeId: string;
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

  const diagnose = deps.seat.diagnose;
  const runner = deps.diagnosisRunner;
  if (diagnose === undefined || deps.seat.diagnoseInChild === undefined || runner === undefined)
    return;
  const diagnosisStatus = {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "fiscal.certificate_not_used": 409,
    "fiscal.certificate_changed": 409,
    "fiscal.certificate_request_invalid": 400,
    "fiscal.certificate_diagnosis_busy": 409,
    "fiscal.certificate_diagnosis_unavailable": 503,
  } as const;
  const runDiagnosis = createErrorBoundary(diagnosisStatus, "fiscal_certificate.diagnosis_failed");
  const fields = new Set([
    "body",
    "schemaVersion",
    "operation",
    "source",
    "sourceGeneration",
    "expectedRevision",
    "pfxBase64",
    "passphrase",
    "certKind",
  ]);
  app.post(
    `${path}/diagnose`,
    bodyLimit({
      maxSize: 200_000,
      onError: (c) => c.json({ error: { code: "fiscal.certificate_too_large", params: {} } }, 413),
    }),
    (c) =>
      runDiagnosis(c, log, async () => {
        try {
          const managementSessionId = requireManagementSession(c);
          const body = await readJsonBody<unknown>(c);
          const authorize = async (tx: Transaction) => {
            const session = await authorizeManager(tx, {
              managementSessionId,
              permission: "system.manage",
              touch: false,
            });
            const { expiresAt } = await resolveManagementSession(tx, managementSessionId, {
              touch: false,
            });
            if (!deps.filing()) throw new AppError("fiscal.certificate_not_used", {});
            return { personId: session.authorizedBy, expiresAt };
          };
          // Admission can refuse without calling the seat, so it needs its own no-drain
          // authorization turn; the seat still rechecks both material snapshots.
          await deps.db.withWriteLock(() => authorize(deps.db));
          const answer = await runner.attempt(
            (runChild, signal) =>
              diagnose(
                {
                  db: deps.db,
                  ring: deps.ring,
                  nodeId: deps.nodeId,
                  environment: deps.environment,
                  signal,
                  clock: deps.now,
                  runChild,
                  authorize,
                },
                body,
                deps.now(),
              ),
            c.req.raw.signal,
          );
          if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
          return c.json<unknown>(answer);
        } catch (error) {
          if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
          // Only this projection reaches the shared boundary: native causes, identifiers and
          // log-only reasons must never reach either the diagnostic envelope or its logger.
          if (isAppError(error) && Object.hasOwn(diagnosisStatus, error.code)) {
            if (error.code === "fiscal.certificate_request_invalid") {
              const field = "field" in error.params ? error.params.field : undefined;
              if (typeof field === "string" && fields.has(field))
                throw new AppError(error.code, { field });
              throw new AppError<ErrorCode>(error.code, {});
            }
            throw new AppError(error.code, {});
          }
          throw new AppError("fiscal.certificate_diagnosis_unavailable", {});
        }
      }),
  );
}
