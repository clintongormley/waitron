import { withTransaction, venueCredentials } from "@waitron/db";
import {
  readReaderRole,
  cardReaders,
  assertReaderStartable,
  cardProviderById,
  type PaymentProvider,
} from "@waitron/payments";
import { AppError, deviceOrigin } from "@waitron/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { TillApiDeps } from "./till-api-deps.js";

/**
 * The reader a card is charged on: the one the request names, else the device's own. It must be
 * switched on, held by this device, and free of another device's payment in progress. The payment's
 * start checks the last two again in the transaction that writes its first row.
 */
async function resolvePayReader(
  deps: TillApiDeps,
  deviceId: string | undefined,
  requestedReaderId: string | undefined,
): Promise<{ id: string; provider: string; providerRef: string }> {
  return withTransaction(deps.db, async (tx) => {
    let readerId = requestedReaderId;
    if (readerId === undefined && deviceId !== undefined) {
      const role = await readReaderRole(tx, deviceId);
      readerId = role?.chosenId ?? role?.defaultId ?? undefined;
    }
    if (readerId === undefined) throw new AppError("reader.not_found", { id: "" });
    const [reader] = await tx
      .select({
        id: cardReaders.id,
        provider: cardReaders.provider,
        providerRef: cardReaders.providerRef,
      })
      .from(cardReaders)
      .where(and(eq(cardReaders.id, readerId), isNull(cardReaders.disabledAt)));
    if (reader === undefined) throw new AppError("reader.not_found", { id: readerId });
    if (deviceId === undefined) throw new AppError("reader.not_held", { readerId: reader.id });
    await assertReaderStartable(tx, deviceOrigin(deviceId), reader.id);
    // Refuse a disconnected provider here with the actionable `reader.provider_disconnected`,
    // before an adapter meets the missing credential mid-charge.
    if (deps.providers !== undefined) {
      const purpose = cardProviderById(deps.providers, reader.provider).credentialPurpose;
      const [cred] = await tx
        .select({ purpose: venueCredentials.purpose })
        .from(venueCredentials)
        .where(eq(venueCredentials.purpose, purpose));
      if (cred === undefined) {
        throw new AppError("reader.provider_disconnected", { providerId: reader.provider });
      }
    }
    return reader;
  });
}
/**
 * The provider a card on a reader is collected through.
 */
export async function resolveCardCollector(
  deps: TillApiDeps,
  deviceId: string | undefined,
  requestedReaderId: string | undefined,
): Promise<{ provider: PaymentProvider; reader?: { id: string; providerRef: string } }> {
  if (deps.paymentsEnabled === false) throw new AppError("module.disabled", { module: "payments" });
  if (deps.cardProvider?.provider === "simulator") {
    if (requestedReaderId !== undefined) {
      throw new AppError("reader.not_found", { id: requestedReaderId });
    }
    return { provider: deps.cardProvider };
  }
  const reader = await resolvePayReader(deps, deviceId, requestedReaderId);
  /* v8 ignore start -- a live boot always supplies the pool */
  if (deps.pool === undefined) throw new Error("card provider pool not configured");
  /* v8 ignore stop */
  // The provider carries no reader: the chosen one travels per collect as `readerRef`, so one
  // cached provider serves every reader on the same vendor.
  return { provider: await deps.pool.get(reader.provider), reader };
}
