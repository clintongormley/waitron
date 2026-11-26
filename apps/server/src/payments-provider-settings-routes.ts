import "./errors.js";
import { validatePayload, putCredential, deleteCredential } from "@waitron/credentials";
import { type Transaction, saveSettings, venueCredentials, readSettings } from "@waitron/db";
import { requireFreshManagementSignIn, authorizeManager } from "@waitron/identity";
import {
  readPaymentsSettings,
  PAYMENTS_SETTINGS,
  cardProviderById,
  cardReaders,
  otherCardMachineFault,
  otherCardMachineNameKey,
  type OtherCardMachine,
} from "@waitron/payments";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { PaymentsApiDeps } from "./payments-api-deps.js";
import { run, runConnect, runPathProvider } from "./payments-api-errors.js";

function screenStringMap(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(body)) {
    if (typeof value !== "string") throw new AppError("management.request_invalid", { field });
    out[field] = value;
  }
  return out;
}

function requireRevision(revision: unknown): number {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    throw new AppError("management.request_invalid", { field: "revision" });
  return revision;
}

function otherCardMachinesFrom(value: unknown, storedIds: ReadonlySet<string>): OtherCardMachine[] {
  if (!Array.isArray(value))
    throw new AppError("management.request_invalid", { field: "otherCardMachines" });
  const names = new Set<string>();
  return value.map((entry: unknown, index) => {
    const refuse = (key?: string) =>
      new AppError("management.request_invalid", {
        field: `otherCardMachines.${index}${key === undefined ? "" : `.${key}`}`,
      });
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw refuse();
    const row = entry as Record<string, unknown>;
    const id = row.id ?? randomUUID();
    if (typeof id !== "string" || (row.id !== undefined && !storedIds.has(id))) throw refuse("id");
    const fault = otherCardMachineFault({ ...row, id });
    if (fault !== null) throw refuse(fault);
    const name = (row.name as string).trim();
    if (names.has(otherCardMachineNameKey(name))) throw refuse("name");
    names.add(otherCardMachineNameKey(name));
    return { id, name, paysInto: row.paysInto as OtherCardMachine["paysInto"] };
  });
}

export function mountPaymentsProviderSettingsRoutes(
  app: Hono,
  deps: PaymentsApiDeps,
  log: Logger,
  gated: <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ) => Promise<T>,
  requirePaymentsEnabled: (tx: Transaction) => Promise<void>,
): void {
  const testProvidersAvailable = deps.onboardingIntent === "prepare";
  function paymentSettingsAnswer({
    doc,
    revision,
  }: Awaited<ReturnType<typeof readPaymentsSettings>>) {
    return {
      tipsEnabled: doc.tipsEnabled,
      testProviders: doc.testProviders,
      testProvidersAvailable,
      revision,
    };
  }

  app.get("/management-api/payments/settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(paymentSettingsAnswer(await gated(sessionId, readPaymentsSettings)));
    }),
  );

  app.put("/management-api/payments/settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const { tipsEnabled, testProviders } = body;
      if (typeof tipsEnabled !== "boolean")
        throw new AppError("management.request_invalid", { field: "tipsEnabled" });
      if (typeof testProviders !== "boolean")
        throw new AppError("management.request_invalid", { field: "testProviders" });
      const revision = requireRevision(body.revision);
      const { saved, practiceChanged } = await gated(sessionId, async (tx, personId) => {
        if (testProviders && !testProvidersAvailable)
          throw new AppError("payment.test_providers_prepare_only", {});
        const { doc } = await readPaymentsSettings(tx);
        const saved = await saveSettings(tx, PAYMENTS_SETTINGS, {
          doc: { ...doc, tipsEnabled, testProviders },
          expectedRevision: revision,
          personId,
        });
        return { saved, practiceChanged: doc.testProviders !== testProviders };
      });
      if (practiceChanged && testProvidersAvailable) await deps.cardSimulator?.reapply();
      return c.json(paymentSettingsAnswer(saved));
    }),
  );

  const otherCardMachinesPath = "/management-api/payments/other-card-machines";
  const machinesAnswer = ({ doc, revision }: Awaited<ReturnType<typeof readPaymentsSettings>>) => ({
    machines: doc.otherCardMachines,
    revision,
  });

  app.get(otherCardMachinesPath, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(machinesAnswer(await gated(sessionId, readPaymentsSettings)));
    }),
  );

  app.put(otherCardMachinesPath, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const revision = requireRevision(body.revision);
      const saved = await gated(sessionId, async (tx, personId) => {
        const { doc } = await readPaymentsSettings(tx);
        const otherCardMachines = otherCardMachinesFrom(
          body.machines,
          new Set(doc.otherCardMachines.map((machine) => machine.id)),
        );
        return saveSettings(tx, PAYMENTS_SETTINGS, {
          doc: { ...doc, otherCardMachines },
          expectedRevision: revision,
          personId,
        });
      });
      return c.json(machinesAnswer(saved));
    }),
  );

  app.get("/management-api/payments/providers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // "Connected" = a sealed credential exists for the seat's purpose; only purposes are read,
      // never a secret.
      const rows = await gated(sessionId, (tx) =>
        tx.select({ purpose: venueCredentials.purpose }).from(venueCredentials),
      );
      const connected = new Set(rows.map((r) => r.purpose));
      // `merchantName` is omitted: it is not stored, and recovering it would need decrypting the
      // credential and calling the provider. The connect response is where the dashboard learns it.
      return c.json(
        deps.providers.map((p) => ({
          providerId: p.providerId,
          state: connected.has(p.credentialPurpose) ? "connected" : "not_connected",
          credentialFields: p.credentialFields,
          readerAdd: p.readerAdd,
          canUnpair: p.readers.canUnpair,
        })),
      );
    }),
  );

  app.post("/management-api/payments/providers/:id/connect", (c) =>
    runConnect(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const payload = screenStringMap(body);
      // Authorise BEFORE the provider round-trip so an unauthorised caller never reaches the network.
      const seat = await gated(sessionId, async (tx) => {
        const provider = cardProviderById(deps.providers, id);
        await requireFreshManagementSignIn(tx, sessionId);
        return provider;
      });
      // `environment` must be passed: the Stripe seat refuses a wrong-environment key only when it
      // knows the host's environment.
      const { merchantName, sealedPayload } = await seat.connect(
        {
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          environment: deps.environment,
        },
        payload,
      );
      await gated(sessionId, async (tx, personId) => {
        await requireFreshManagementSignIn(tx, sessionId);
        // Validate the seat-assembled payload against the purpose's declared fields before sealing, so
        // a provider that returns a wrong-shaped payload fails loudly rather than sealing junk.
        validatePayload(seat.credentialPurpose, sealedPayload);
        await putCredential(tx, deps.ring, {
          personId,
          purpose: seat.credentialPurpose,
          value: sealedPayload,
        });
      });
      deps.pool.evict(id);
      // NEVER a secret — only the merchant name the operator confirms.
      return c.json({ merchantName });
    }),
  );

  app.put("/management-api/payments/providers/:id/state", (c) =>
    runPathProvider(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (
        typeof body.enabled !== "boolean" ||
        !Number.isInteger(body.revision) ||
        (body.revision as number) < 0
      )
        throw new AppError("management.request_invalid", {
          field: typeof body.enabled === "boolean" ? "revision" : "enabled",
        });
      const seat = cardProviderById(deps.providers, c.req.param("id"));
      const result = await gated(sessionId, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "payments.providers.manage",
        });
        if (body.enabled) await requirePaymentsEnabled(tx);
        if (!body.enabled) {
          const readers = await tx
            .select({ name: cardReaders.name })
            .from(cardReaders)
            .where(and(eq(cardReaders.provider, seat.providerId), isNull(cardReaders.disabledAt)))
            .orderBy(cardReaders.name);
          if (readers.length)
            throw new AppError("payment.provider_in_use", {
              activeReaders: readers.length,
              readerNames: readers.map((reader) => reader.name),
            });
        }
        const { doc } = await readSettings(tx, PAYMENTS_SETTINGS);
        return saveSettings(tx, PAYMENTS_SETTINGS, {
          doc: {
            ...doc,
            providers: { ...doc.providers, [seat.providerId]: body.enabled as boolean },
          },
          expectedRevision: body.revision as number,
          personId: authorizedBy,
        });
      });
      return c.json({ enabled: result.doc.providers[seat.providerId], revision: result.revision });
    }),
  );

  app.post("/management-api/payments/providers/:id/disconnect", (c) =>
    runPathProvider(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      await gated(sessionId, async (tx, personId) => {
        const seat = cardProviderById(deps.providers, id); // payment.provider_unknown on a bad id
        // Refused while an active reader uses this provider; delete those readers first.
        const active = await tx
          .select({ id: cardReaders.id })
          .from(cardReaders)
          .where(and(eq(cardReaders.provider, id), isNull(cardReaders.disabledAt)));
        if (active.length > 0) {
          throw new AppError("payment.provider_in_use", { activeReaders: active.length });
        }
        await requireFreshManagementSignIn(tx, sessionId);
        await deleteCredential(tx, { personId, purpose: seat.credentialPurpose });
      });
      deps.pool.evict(id);
      return c.body(null, 204);
    }),
  );
}
