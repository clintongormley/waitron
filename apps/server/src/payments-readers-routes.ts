import "./errors.js";
import {
  type Transaction,
  devices,
  deviceProfiles,
  venueCredentials,
  readSettings,
  nowIso,
} from "@waitron/db";
import {
  type CardProviderRuntimeDeps,
  type CardProviderContribution,
  cardReaders,
  cardProviderById,
  PAYMENTS_SETTINGS,
  appendReaderToProfiles,
} from "@waitron/payments";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireString,
  requireUuidParam,
  requireBodyUuid,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { sql, isNull, eq, and } from "drizzle-orm";
import type { Hono } from "hono";
import { markCardReaderUnpaired } from "./card-reader-delete.js";
import type { PaymentsApiDeps } from "./payments-api-deps.js";
import { run, runBodyProvider } from "./payments-api-errors.js";
import { readerProfileChoices } from "./payments-reader-profiles.js";

export function mountPaymentsReaderRoutes(
  app: Hono,
  deps: PaymentsApiDeps,
  log: Logger,
  gated: <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ) => Promise<T>,
  runtimeDeps: () => CardProviderRuntimeDeps,
  requireConnected: (tx: Transaction, seat: CardProviderContribution) => Promise<void>,
  requireEnabled: (tx: Transaction, seat: CardProviderContribution) => Promise<void>,
  requireReader: (tx: Transaction, id: string) => Promise<typeof cardReaders.$inferSelect>,
  holdingReader: <T>(id: string, fn: (hold: () => void) => Promise<T>) => Promise<T>,
  removeAtProvider: (seat: CardProviderContribution, providerRef: string) => Promise<void>,
  requirePaymentsEnabled: (tx: Transaction) => Promise<void>,
  refuseWhileUnpairing: (id: string) => void,
): void {
  app.get("/management-api/payments/readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { readers, assignments } = await gated(sessionId, async (tx) => ({
        readers: await tx
          .select({
            id: cardReaders.id,
            provider: cardReaders.provider,
            name: cardReaders.name,
            active: sql<boolean>`${cardReaders.disabledAt} is null`.mapWith(Boolean),
            printsOwnSlipAutomatically: cardReaders.printsOwnSlipAutomatically,
            unpairedAt: cardReaders.unpairedAt,
          })
          .from(cardReaders)
          .where(isNull(cardReaders.deletedAt))
          .orderBy(cardReaders.name),
        assignments: await tx
          .select({
            name: devices.label,
            chosenReaderId: devices.cardReaderId,
            defaultReaderId: sql<
              string | null
            >`json_extract(${deviceProfiles.cardReaders}, '$.defaultId')`,
          })
          .from(devices)
          .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
          .where(eq(devices.active, true))
          .orderBy(devices.label, devices.id),
      }));
      const namesByReader = new Map<string, string[]>();
      for (const assignment of assignments) {
        // Configured use is separate from the portable reader's current holder.
        const readerId = assignment.chosenReaderId ?? assignment.defaultReaderId;
        if (readerId === null) continue;
        const names = namesByReader.get(readerId) ?? [];
        names.push(assignment.name);
        namesByReader.set(readerId, names);
      }
      return c.json(
        readers.map(({ unpairedAt, ...r }) => ({
          ...r,
          canEnable: unpairedAt === null,
          deviceCount: namesByReader.get(r.id)?.length ?? 0,
          deviceNames: namesByReader.get(r.id) ?? [],
        })),
      );
    }),
  );

  app.post("/management-api/payments/readers", (c) =>
    runBodyProvider(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const providerId = requireString(body.providerId, "providerId");
      const name = requireString(body.name, "name").trim();
      if (!name) throw new AppError("management.request_invalid", { field: "name" });
      const code = body.code === undefined ? undefined : requireString(body.code, "code");
      if (code?.trim() === "") throw new AppError("management.request_invalid", { field: "code" });
      const reference =
        body.reference === undefined ? undefined : requireString(body.reference, "reference");
      if (reference?.trim() === "")
        throw new AppError("management.request_invalid", { field: "reference" });
      const seat = cardProviderById(deps.providers, providerId); // payment.provider_unknown
      if (seat.readerAdd.kind === "reference" && reference === undefined)
        throw new AppError("management.request_invalid", { field: "reference" });
      if (seat.readerAdd.kind === "pairing-poll" && code === undefined)
        throw new AppError("management.request_invalid", { field: "code" });
      await gated(sessionId, (tx) => requireEnabled(tx, seat));
      // The provider must be connected first — else the seat's own credential read would fail with an
      // opaque `credentials.missing`. Pre-check gives the actionable `reader.provider_disconnected`.
      await gated(sessionId, async (tx) => {
        const [cred] = await tx
          .select({ purpose: venueCredentials.purpose })
          .from(venueCredentials)
          .where(eq(venueCredentials.purpose, seat.credentialPurpose));
        if (cred === undefined) throw new AppError("reader.provider_disconnected", { providerId });
      });
      const result = await seat.readers.add(runtimeDeps(), {
        name,
        ...(code !== undefined ? { code } : {}),
        ...(reference !== undefined ? { reference } : {}),
      });
      // Re-check after the provider round-trip. This refuses an already-committed disconnect;
      // without a shared lock, a disconnect between this read and commit remains an accepted window.
      const inserted = await gated(sessionId, async (tx) => {
        const [cred] = await tx
          .select({ purpose: venueCredentials.purpose })
          .from(venueCredentials)
          .where(eq(venueCredentials.purpose, seat.credentialPurpose));
        if (
          cred === undefined ||
          (await readSettings(tx, PAYMENTS_SETTINGS)).doc.providers[providerId] === false
        )
          return undefined;
        const [row] = await tx
          .insert(cardReaders)
          .values({
            provider: providerId,
            providerRef: result.providerRef,
            name,
          })
          .returning({ id: cardReaders.id });
        return row;
      });
      if (inserted === undefined) {
        // Leave the registration available to an Adopt that may already be in flight.
        await gated(sessionId, (tx) => requireEnabled(tx, seat));
        throw new AppError("reader.provider_disconnected", { providerId });
      }
      return c.json({ id: inserted.id, status: result.status }, 201);
    }),
  );

  app.get("/management-api/payments/reader-profile-choices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(sessionId, readerProfileChoices));
    }),
  );

  app.put("/management-api/payments/readers/:id/profiles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const readerId = requireUuidParam(c.req.param("id"), "CardReaderId");
      const { profileIds } = await readJsonBody<{ profileIds?: unknown }>(c);
      if (!Array.isArray(profileIds))
        throw new AppError("management.request_invalid", { field: "profileIds" });
      const ids = profileIds.map((id) => requireBodyUuid(id, "profileIds"));
      await gated(sessionId, async (tx) => {
        await requirePaymentsEnabled(tx);
        refuseWhileUnpairing(readerId);
        const reader = await requireReader(tx, readerId);
        if (reader.disabledAt !== null) throw new AppError("reader.not_found", { id: readerId });
        const profiles = await readerProfileChoices(tx);
        const eligible = new Set(
          profiles.filter((profile) => profile.eligible).map(({ id }) => id),
        );
        if (ids.some((id) => !eligible.has(id)))
          throw new AppError("management.request_invalid", { field: "profileIds" });
        await appendReaderToProfiles(tx, readerId, ids);
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/payments/readers/:id/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const readerId = requireUuidParam(c.req.param("id"), "CardReaderId");
      const reader = await gated(sessionId, async (tx) => {
        const [row] = await tx
          .select({
            provider: cardReaders.provider,
            providerRef: cardReaders.providerRef,
            printsOwnSlipAutomatically: cardReaders.printsOwnSlipAutomatically,
          })
          .from(cardReaders)
          .where(and(eq(cardReaders.id, readerId), isNull(cardReaders.deletedAt)));
        if (row === undefined) throw new AppError("reader.not_found", { id: readerId });
        return row;
      });
      const seat = cardProviderById(deps.providers, reader.provider);
      const status = await seat.readers.status(runtimeDeps(), reader.providerRef);
      return c.json({ ...status, printsOwnSlipAutomatically: reader.printsOwnSlipAutomatically });
    }),
  );

  app.post("/management-api/payments/readers/:id/unpair", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CardReaderId");
      return holdingReader(id, async (hold) => {
        const reader = await gated(sessionId, (tx) => {
          hold();
          return requireReader(tx, id);
        });
        const seat = cardProviderById(deps.providers, reader.provider);
        if (!seat.readers.canUnpair)
          throw new AppError("reader.unpair_unsupported", { providerId: reader.provider });
        await gated(sessionId, (tx) => requireConnected(tx, seat));
        // Vendor failure leaves the local row unchanged. Disabled rows remain addressable for retries.
        await removeAtProvider(seat, reader.providerRef);
        // One clock reading for both stamps, so the unpair lands as one moment.
        const unpairedAt = nowIso();
        await gated(sessionId, (tx) => markCardReaderUnpaired(tx, id, unpairedAt));
        return c.body(null, 204);
      });
    }),
  );
}
