import "./errors.js";
import { type Transaction, nowIso } from "@waitron/db";
import {
  type CardProviderRuntimeDeps,
  type CardProviderContribution,
  cardReaders,
  cardProviderById,
} from "@waitron/payments";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import type { Hono } from "hono";
import {
  readCardReaderDeleteImpact,
  type CardReaderDeleteOptions,
  startCardReaderDelete,
  markCardReaderUnpaired,
  deleteCardReader,
} from "./card-reader-delete.js";
import type { PaymentsApiDeps } from "./payments-api-deps.js";
import { runPathProvider, runBodyProvider, run } from "./payments-api-errors.js";
import { queryFlag } from "./report-api.js";

export function mountPaymentsReaderAdoptionRoutes(
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
  readerWhere: (id: string) => ReturnType<typeof eq>,
  requireReader: (tx: Transaction, id: string) => Promise<typeof cardReaders.$inferSelect>,
  adopting: Set<{ provider: string; providerRef: string; stale: boolean }>,
  refuseWhileUnpairing: (id: string) => void,
  holdingReader: <T>(id: string, fn: (hold: () => void) => Promise<T>) => Promise<T>,
  removeAtProvider: (seat: CardProviderContribution, providerRef: string) => Promise<void>,
): void {
  app.get("/management-api/payments/providers/:id/available-readers", (c) =>
    runPathProvider(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const seat = cardProviderById(deps.providers, c.req.param("id"));
      await gated(sessionId, (tx) => requireConnected(tx, seat));
      const listed = await seat.readers.list(runtimeDeps());
      const rows = await gated(sessionId, (tx) =>
        tx
          .select()
          .from(cardReaders)
          .where(
            and(
              eq(cardReaders.provider, seat.providerId),
              or(isNull(cardReaders.deletedAt), isNull(cardReaders.unpairedAt)),
            ),
          )
          .orderBy(
            desc(isNull(cardReaders.deletedAt)),
            desc(cardReaders.deletedAt),
            desc(cardReaders.createdAt),
            desc(cardReaders.id),
          ),
      );
      const registered = new Map<string, (typeof rows)[number]>();
      for (const row of rows)
        if (!registered.has(row.providerRef)) registered.set(row.providerRef, row);

      return c.json(
        listed.map((reader) => {
          const registration = registered.get(reader.providerRef);
          if (registration === undefined) return { ...reader, status: "available" };
          const status =
            registration.disabledAt === null && registration.deletedAt === null
              ? "added"
              : "disabled";
          return {
            ...reader,
            ...(status === "disabled" ? { name: registration.name } : {}),
            status,
          };
        }),
      );
    }),
  );

  app.post("/management-api/payments/readers/adopt", (c) =>
    runBodyProvider(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const providerId = requireString(body.providerId, "providerId");
      const providerRef = requireString(body.providerRef, "providerRef");
      const name = requireString(body.name, "name").trim();
      if (!name) throw new AppError("management.request_invalid", { field: "name" });
      const seat = cardProviderById(deps.providers, providerId);
      await gated(sessionId, (tx) => requireConnected(tx, seat));
      await gated(sessionId, (tx) => requireEnabled(tx, seat));
      const adopt = { provider: providerId, providerRef, stale: false };
      adopting.add(adopt);
      try {
        const listed = await seat.readers.list(runtimeDeps());
        if (!listed.some((reader) => reader.providerRef === providerRef))
          throw new AppError("reader.not_listed", { providerId });
        const row = await gated(sessionId, async (tx) => {
          await requireConnected(tx, seat);
          await requireEnabled(tx, seat);
          const [existing] = await tx
            .select()
            .from(cardReaders)
            .where(
              and(
                eq(cardReaders.provider, providerId),
                eq(cardReaders.providerRef, providerRef),
                or(isNull(cardReaders.deletedAt), isNull(cardReaders.unpairedAt)),
              ),
            )
            .orderBy(
              desc(isNull(cardReaders.deletedAt)),
              desc(cardReaders.deletedAt),
              desc(cardReaders.createdAt),
              desc(cardReaders.id),
            )
            .limit(1);
          if (existing !== undefined) refuseWhileUnpairing(existing.id);
          if (adopt.stale) throw new AppError("reader.removed_while_adding", { providerId });
          if (existing !== undefined) {
            await tx
              .update(cardReaders)
              .set({ deletedAt: null, disabledAt: null, unpairedAt: null })
              .where(readerWhere(existing.id));
            return {
              id: existing.id,
              outcome: existing.deletedAt === null ? "enabled" : "restored",
            } as const;
          }
          const [saved] = await tx
            .insert(cardReaders)
            .values({ provider: providerId, providerRef, name })
            .returning({ id: cardReaders.id });
          return { id: saved!.id, outcome: "created" } as const;
        });
        return c.json({ ...row, status: "paired" }, 201);
      } finally {
        adopting.delete(adopt);
      }
    }),
  );

  app.patch("/management-api/payments/readers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CardReaderId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = requireString(body.name, "name").trim();
      if (!name) throw new AppError("management.request_invalid", { field: "name" });
      const printsOwnSlipAutomatically = body.printsOwnSlipAutomatically;
      if ("printsOwnSlipAutomatically" in body && typeof printsOwnSlipAutomatically !== "boolean") {
        throw new AppError("management.request_invalid", { field: "printsOwnSlipAutomatically" });
      }
      await gated(sessionId, async (tx) => {
        await requireReader(tx, id);
        await tx
          .update(cardReaders)
          .set({
            name,
            ...(typeof printsOwnSlipAutomatically === "boolean"
              ? { printsOwnSlipAutomatically }
              : {}),
          })
          .where(readerWhere(id));
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/payments/readers/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CardReaderId");
      return c.json(
        await gated(sessionId, (tx) => readCardReaderDeleteImpact(tx, deps.providers, id)),
      );
    }),
  );

  app.delete("/management-api/payments/readers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CardReaderId");
      const options: CardReaderDeleteOptions = {
        acceptRegistrationKept: queryFlag(
          c.req.query("acceptRegistrationKept"),
          "acceptRegistrationKept",
        ),
      };
      // A reader its provider must unpair takes three transactions, not one: a transaction holds the
      // database's only write lock (`packages/store/src/write-queue.ts:5`,
      // `packages/db/src/tenancy.ts:19`), so a provider call inside one would make every other write
      // wait on the network. A refusal after the unpair leaves the reader unpaired and switched off,
      // as Unpair would, and not deleted. Every other delete checks and acts in one transaction.
      return holdingReader(id, async (hold) => {
        const first = await gated(sessionId, (tx) => {
          hold();
          return startCardReaderDelete(tx, deps.providers, id, new Date(), options);
        });
        if (first.deleted !== undefined) return c.json(first.deleted);
        const { plan } = first;
        const seat = cardProviderById(deps.providers, plan.provider);
        await removeAtProvider(seat, plan.providerRef);
        const unpairedAt = nowIso();
        await gated(sessionId, (tx) => markCardReaderUnpaired(tx, id, unpairedAt));
        return c.json(await gated(sessionId, (tx) => deleteCardReader(tx, deps.providers, id)));
      });
    }),
  );
}
