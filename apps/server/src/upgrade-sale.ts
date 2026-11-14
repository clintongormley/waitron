import { randomUUID, randomInt } from "node:crypto";
import { request } from "node:https";
import { eq } from "drizzle-orm";
import {
  openVenueDatabase,
  withTransaction,
  persons,
  staffRoles,
  personStaffRoles,
  sales,
  readVenue,
  readVenueClock,
} from "@waitron/db";
import {
  hashPin,
  importAccessRoleMembership,
  ensureBuiltInRoles,
  foldForUniqueness,
  verifyPersonCredential,
  startManagementSession,
  setProfileAdmission,
} from "@waitron/identity";
import { createDeviceProfile } from "@waitron/layouts";
import {
  createCatalogue,
  createProduct,
  addProductToMenu,
  previewMenu,
  publishMenu,
} from "@waitron/catalogue";
import {
  createDepartment,
  createServiceZone,
  saveMenuPeriod,
  replaceMenuWeek,
  readBusinessDayScheduleRevision,
  setProfileServiceScope,
  departmentReceipts,
} from "@waitron/venue-service";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ServerConfig } from "./config.js";
import { boxHostClient } from "./box-host-client.js";
import { startServer } from "./boot.js";
import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { checkUpgradeData } from "./upgrade-checks.js";

async function prepareSale(config: ServerConfig) {
  const store = await openVenueDatabase(config.venueDir);
  const pin = String(randomInt(100000, 1000000));
  const pinHash = hashPin(pin);
  const name = `Upgrade check ${randomUUID()}`;
  try {
    return await withTransaction(store.venue, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({
          displayName: name,
          displayNameFolded: foldForUniqueness(name),
          pinHash,
          status: "active",
        })
        .returning({ id: persons.id });
      await importAccessRoleMembership(tx, person!.id, (await ensureBuiltInRoles(tx))["admin"]);
      await verifyPersonCredential(tx, person!.id, pin);
      const session = await startManagementSession(tx, { personId: person!.id });
      const profile = await createDeviceProfile(tx, {
        managementSessionId: session.token,
        name,
        formFactor: "till",
        capabilities: ["take-orders", "take-cash"],
      });
      const [staffRole] = await tx
        .insert(staffRoles)
        .values({ name })
        .returning({ id: staffRoles.id });
      await tx
        .insert(personStaffRoles)
        .values({ personId: person!.id, staffRoleId: staffRole!.id });
      await setProfileAdmission(tx, profile.id, { admittedStaffRoleIds: [staffRole!.id] });
      const venue = await readVenue(tx);
      const menu = await createCatalogue(tx, { name });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        unitId: null,
        name: `${name} item`,
        customerName: { [venue.invoiceLocales[0]!]: "Upgrade check item" },
        kitchenName: "Upgrade check kitchen item",
        unitPrice: "1.00",
        vatClass: "general",
      });
      const item = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: product.id,
        grossPrice: "1.00",
      });
      const preview = await previewMenu(tx, menu.id);
      await publishMenu(tx, menu.id, preview.hash, person!.id);
      const department = await createDepartment(tx, { name, orderStart: "counter" });
      const zone = await createServiceZone(tx, {
        name,
        departmentId: department.id,
        orderStart: "counter",
      });
      await tx.insert(departmentReceipts).values({
        departmentId: department.id,
        receipt: { operationDescription: venue.operationDescription },
      });
      const period = await saveMenuPeriod(tx, department.id, {
        name,
        menuId: menu.id,
        staffMenuIds: [],
      });
      const start = (await readVenueClock(tx)).dayCutover.slice(0, 5);
      const middle = `${String((Number(start.slice(0, 2)) + 12) % 24).padStart(2, "0")}:${start.slice(3, 5)}`;
      await replaceMenuWeek(
        tx,
        department.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            { periodId: period.id, startsAt: start, endsAt: middle },
            { periodId: period.id, startsAt: middle, endsAt: start },
          ],
        })),
        new Date(),
        await readBusinessDayScheduleRevision(tx),
      );
      await setProfileServiceScope(tx, profile.id, {
        departmentId: department.id,
        allowedZoneIds: [zone.id],
        startingZoneId: zone.id,
      });
      return {
        personId: person!.id,
        pin,
        profileId: profile.id,
        manager: `${MANAGEMENT_COOKIE}=${session.token}`,
        name,
        zoneId: zone.id,
        menuItemId: item.id,
      };
    });
  } finally {
    await store.close();
  }
}

export async function checkUpgradeSale(
  config: ServerConfig,
  env: NodeJS.ProcessEnv,
  options: { socketPath?: string } = {},
) {
  const before = await checkUpgradeData(config, env);
  const clock = boxHostClient(options);
  const status = await clock.clockStatus();
  if (!status.available || !status.synchronised) throw new Error("Upgrade sale clock.unconfirmed");
  const fixture = await prepareSale(config);
  const server = await startServerOrFirstSetupResolution(env, env, {
    startServer: (effective, base) => startServer(effective, base, { boxHost: clock }),
  });
  const base = new URL(`https://127.0.0.1:${config.httpPort}`).origin;
  const cookies = new Map<string, string>();
  const call = <T = unknown>(path: string, body?: unknown, manager = false): Promise<T> =>
    new Promise((done, reject) => {
      const req = request(
        `${base}${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          rejectUnauthorized: false,
          headers: {
            "content-type": "application/json",
            origin: base,
            "sec-fetch-site": "same-origin",
            cookie: manager ? fixture.manager : [...cookies.values()].join("; "),
            "x-waitron-person": fixture.personId,
          },
        },
        (res) => {
          for (const value of res.headers["set-cookie"] ?? []) {
            const pair = value.split(";")[0]!;
            cookies.set(pair.split("=")[0]!, pair);
          }
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (bytes) => {
            text += bytes;
          });
          res.on("end", () => {
            if (res.statusCode !== 200 && res.statusCode !== 204) {
              reject(new Error(`Upgrade sale ${path}: ${res.statusCode} ${text}`));
              return;
            }
            try {
              done((text === "" ? null : JSON.parse(text)) as T);
            } catch (error) {
              reject(error);
            }
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const orderId = randomUUID();
  let ticket: { total: string; invoiceNumber: string };
  try {
    await call("/health");
    const hold = await call<{ holdId: string }>("/management-api/pairing-mode/holds", {}, true);
    const join = await call<{ joinId: string; verificationNumber: string }>("/api/device/join", {
      name: fixture.name,
    });
    const pending = await call<{ id: string; createdAt: string }[]>(
      "/management-api/join-requests?kind=device",
      undefined,
      true,
    );
    const ask = pending.find((row: { id: string }) => row.id === join.joinId);
    if (!ask) throw new Error("Upgrade device request is missing");
    await call(
      `/management-api/device-join-requests/${join.joinId}/check`,
      { choice: join.verificationNumber, holdId: hold.holdId, createdAt: ask.createdAt },
      true,
    );
    await call(
      `/management-api/device-join-requests/${join.joinId}/accept`,
      { name: fixture.name, profileId: fixture.profileId },
      true,
    );
    await call("/api/session", { personId: fixture.personId, pin: fixture.pin });
    ticket = await call<{ total: string; invoiceNumber: string }>("/api/sales", {
      workingOrderId: orderId,
      zoneId: fixture.zoneId,
      lines: [{ menuItemId: fixture.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "1.00" },
    });
    if (
      ticket.total !== "1.00" ||
      typeof ticket.invoiceNumber !== "string" ||
      ticket.invoiceNumber.length === 0
    )
      throw new Error("Upgrade sale invoice or total is missing");
  } finally {
    await server.close();
  }
  const after = await checkUpgradeData(config, env);
  const store = await openVenueDatabase(config.venueDir);
  try {
    const [sale] = await store.venue.select().from(sales).where(eq(sales.workingOrderId, orderId));
    if (
      !sale ||
      sale.total !== 100 ||
      sale.invoiceNumber < 1 ||
      (sale.fiscalState === "recorded" && after.fiscalRecords !== before.fiscalRecords + 1)
    )
      throw new Error("Upgrade sale was not persisted with its fiscal history");
    return {
      saleId: sale.id,
      total: ticket.total as string,
      fiscalBackend: sale.fiscalBackend,
      fiscalRecords: after.fiscalRecords,
    };
  } finally {
    await store.close();
  }
}
