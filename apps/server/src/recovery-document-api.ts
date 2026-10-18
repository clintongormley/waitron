import { randomUUID } from "node:crypto";
import { TLSSocket } from "node:tls";
import type { Context, Hono } from "hono";
import { readBreakGlassVerifier, setBreakGlassVerifierTx, withTransaction } from "@waitron/db";
import { authorizeManager, hashSecret } from "@waitron/identity";
import { generatePassword } from "@waitron/provisioning";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { WaitronModule } from "@waitron/module";
import type { createRecoveryPack } from "./recovery-pack.js";
import { inTurn } from "./attempt-turns.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export type RecoveryDocumentEvidence = (
  module: WaitronModule,
) => Promise<Readonly<Record<string, unknown>>>;
function invalid(reason: string): never {
  throw new AppError("recovery.pack_invalid", { reason });
}
function exact(value: unknown, key: string): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, key)
  );
}
function secure(c: Context) {
  const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
  const origin = c.req.header("Origin"),
    site = c.req.header("Sec-Fetch-Site");
  if (
    !(socket instanceof TLSSocket) ||
    !socket.encrypted ||
    (origin !== undefined && origin !== new URL(c.req.url).origin) ||
    (site !== undefined && !["same-origin", "none"].includes(site))
  )
    throw new AppError("authorization.not_permitted", { permission: "system.manage" });
  if (c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    invalid("shape");
}

export function mountRecoveryDocumentApi(
  app: Hono,
  deps: Omit<Parameters<typeof createRecoveryPack>[0], "now" | "authorize"> & {
    now: () => Date;
    documentEvidence: RecoveryDocumentEvidence;
  },
  log: Logger,
) {
  let retained:
    { id: string; verifier: string; bytes: Uint8Array<ArrayBuffer>; createdAt: string } | undefined;
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "recovery.pack_invalid": 400,
    },
    "recovery.pack_download_failed",
  );
  for (const action of ["reissue", "download"] as const)
    app.post(`/api/box/recovery-document/${action}`, (c) =>
      run(c, log, async () => {
        secure(c);
        const token = requireManagementSession(c);
        return inTurn(deps.db, `recovery-document:${deps.node.nodeId}`, async () => {
          await authorizeManager(deps.db, {
            managementSessionId: token,
            permission: "system.manage",
            touch: false,
          });
          const request = await readJsonBody<unknown>(c);
          let personId: string;
          if (action === "reissue") {
            if (!exact(request, "locale") || !["en", "es"].includes(request.locale as string))
              invalid("shape");
            const owners = deps.modules.filter((m) => m.backup?.recoveryDocument !== undefined);
            if (owners.length !== 1) invalid("module_unsupported");
            const module = owners[0]!;
            const evidence = await deps.documentEvidence(module);
            const secret = generatePassword();
            const verifier = hashSecret(secret);
            const id = randomUUID(),
              createdAt = deps.now().toISOString();
            const bytes = await withTransaction(deps.db, async (tx) => {
              personId = (
                await authorizeManager(tx, {
                  managementSessionId: token,
                  permission: "system.manage",
                })
              ).authorizedBy;
              if ((await readBreakGlassVerifier(tx, deps.node.nodeId)) === null)
                invalid("key_missing");
              const pdf = await module.backup!.recoveryDocument!(tx, deps.node, {
                nodeKey: {
                  nodeId: deps.node.nodeId,
                  name: `${createdAt.slice(0, 10)} · ${id}`,
                  secret,
                },
                createdAt,
                locale: request.locale as "en" | "es",
                evidence,
              });
              if (!(pdf instanceof Uint8Array) || pdf.length === 0 || pdf.length > 8 * 1024 * 1024)
                invalid("document_invalid");
              await setBreakGlassVerifierTx(
                tx,
                deps.node.nodeId,
                verifier,
                `${createdAt.slice(0, 10)} · ${id}`,
              );
              return pdf.slice();
            });
            retained = { id, verifier, bytes, createdAt };
            log("info", "recovery.document_reissued", { personId: personId! });
          } else {
            if (
              !exact(request, "documentId") ||
              retained === undefined ||
              request.documentId !== retained.id
            )
              invalid("document_unavailable");
            await withTransaction(deps.db, async (tx) => {
              await authorizeManager(tx, {
                managementSessionId: token,
                permission: "system.manage",
              });
              if ((await readBreakGlassVerifier(tx, deps.node.nodeId)) !== retained!.verifier) {
                retained = undefined;
                invalid("document_unavailable");
              }
            });
          }
          return c.body(retained!.bytes, 200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="waitron-recovery-${retained!.createdAt.slice(0, 10)}.pdf"`,
            "Cache-Control": "no-store",
            "X-Waitron-Recovery-Document": retained!.id,
          });
        });
      }),
    );
}
