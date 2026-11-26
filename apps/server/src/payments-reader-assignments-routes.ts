import "./errors.js";
import "@waitron/layouts";
import "@waitron/venue-service";
import { type Transaction, devices, deviceNotDeleted, deviceProfiles } from "@waitron/db";
import {
  isKnownReader,
  payments,
  IN_PROGRESS_PAYMENT_STATES,
  readProfileReaderList,
  setProfileReaderList,
} from "@waitron/payments";
import {
  type Logger,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
  requireBodyUuid,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { and, eq, isNotNull, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { readReaderHolders, selectDeviceEquipment } from "./device-equipment.js";
import { run, runBodyReaders } from "./payments-api-errors.js";

async function requireKnownReader(tx: Transaction, readerId: string): Promise<void> {
  if (!(await isKnownReader(tx, readerId))) {
    throw new AppError("reader.not_found", { id: readerId });
  }
}
/** Refuses an id naming no device, or a deleted one. */
async function requireKnownDevice(tx: Transaction, deviceId: string): Promise<void> {
  const [device] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.active, true), deviceNotDeleted()));
  if (device === undefined) throw new AppError("device.not_found", { deviceId });
}

async function requireDeviceProfile(tx: Transaction, profileId: string): Promise<void> {
  const [profile] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  if (profile === undefined) throw new AppError("device_profile.not_found", {});
}

export function mountPaymentsReaderAssignmentRoutes(
  app: Hono,
  log: Logger,
  gated: <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ) => Promise<T>,
): void {
  // Who holds each reader and which devices have a payment in progress on it: the readers that are
  // held or busy, and no others.
  app.get("/management-api/payments/reader-holders", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { holders, busy } = await gated(sessionId, async (tx) => ({
        holders: await readReaderHolders(tx),
        busy: await tx
          .selectDistinct({ readerId: payments.readerId, deviceId: payments.deviceId })
          .from(payments)
          .where(
            and(
              isNotNull(payments.readerId),
              isNotNull(payments.deviceId),
              inArray(payments.state, IN_PROGRESS_PAYMENT_STATES),
            ),
          ),
      }));
      const readerIds = new Set([...holders.keys(), ...busy.map((row) => row.readerId!)]);
      return c.json(
        [...readerIds].map((readerId) => ({
          readerId,
          holder: holders.get(readerId) ?? null,
          paymentInProgressDeviceIds: busy
            .filter((row) => row.readerId === readerId)
            .map((row) => row.deviceId!),
        })),
      );
    }),
  );

  app.get("/management-api/payments/devices/:id/reader", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceId = requireUuidParam(c.req.param("id"), "DeviceId");
      const rows = await gated(sessionId, async (tx) => {
        await requireKnownDevice(tx, deviceId);
        return tx
          .select({ readerId: devices.cardReaderId })
          .from(devices)
          .where(eq(devices.id, deviceId));
      });
      return c.json({ readerId: rows[0]?.readerId ?? null });
    }),
  );

  // A reader id is the device's explicit choice, never taking one another device holds; `null`
  // puts the device on its profile's default.
  app.put("/management-api/payments/devices/:id/reader", (c) =>
    runBodyReaders(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceId = requireUuidParam(c.req.param("id"), "DeviceId");
      const body = await readJsonBody<{ readerId?: unknown }>(c);
      if (!("readerId" in body)) {
        throw new AppError("management.request_invalid", { field: "readerId" });
      }
      const readerId = body.readerId === null ? null : requireBodyUuid(body.readerId, "readerId");
      await gated(sessionId, async (tx) => {
        await requireKnownDevice(tx, deviceId);
        if (readerId !== null) await requireKnownReader(tx, readerId);
        await selectDeviceEquipment(tx, {
          deviceId,
          role: "card_terminal",
          selection: readerId === null ? "default" : { id: readerId },
          via: "manage",
        });
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/payments/device-profiles/:id/readers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const profileId = requireUuidParam(c.req.param("id"), "DeviceProfileId");
      const list = await gated(sessionId, async (tx) => {
        await requireDeviceProfile(tx, profileId);
        return readProfileReaderList(tx, profileId);
      });
      return c.json(list);
    }),
  );

  // Replaces the profile's reader list and default; its devices' choices it no longer lists go
  // back to Use default.
  app.put("/management-api/payments/device-profiles/:id/readers", (c) =>
    runBodyReaders(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const profileId = requireUuidParam(c.req.param("id"), "DeviceProfileId");
      const body = await readJsonBody<{ readerIds?: unknown; defaultReaderId?: unknown }>(c);
      const readerIds = body.readerIds;
      if (!Array.isArray(readerIds)) {
        throw new AppError("management.request_invalid", { field: "readerIds" });
      }
      const ids = readerIds.map((id) => requireBodyUuid(id, "readerIds"));
      if (!("defaultReaderId" in body)) {
        throw new AppError("management.request_invalid", { field: "defaultReaderId" });
      }
      const defaultReaderId =
        body.defaultReaderId === null
          ? null
          : requireBodyUuid(body.defaultReaderId, "defaultReaderId");
      const list = await gated(sessionId, async (tx) => {
        await requireDeviceProfile(tx, profileId);
        const saved = await setProfileReaderList(tx, profileId, {
          readerIds: ids,
          defaultReaderId,
        });
        if (!saved.ok) {
          if (saved.refusal === "duplicate")
            throw new AppError("management.request_invalid", { field: "readerIds" });
          if (saved.refusal === "unknown_reader")
            throw new AppError("reader.not_found", { id: saved.readerId });
          throw new AppError("device_profile.invalid", {
            reason: "default_not_listed",
            field: "defaultReaderId",
          });
        }
        return readProfileReaderList(tx, profileId);
      });
      return c.json(list);
    }),
  );
}
