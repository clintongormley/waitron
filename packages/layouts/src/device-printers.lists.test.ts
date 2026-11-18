import { CORE_MIGRATIONS, printers, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  emptyPrinterLists,
  readProfilePrinterLists,
  setProfilePrinterLists,
} from "./device-printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let profileId: string;

beforeEach(async () => {
  const [profile] = await seedDeviceProfiles(suite.db, { name: "Counter", formFactor: "till" });
  profileId = profile!.id;
});

async function storedLists() {
  const result = await suite.db.execute<{ printer_lists: string }>(
    sql`select printer_lists from device_profiles where id = ${profileId}`,
  );
  return JSON.parse(result.rows[0]!.printer_lists) as unknown;
}

it("refuses a repeated printer within a role while accepting that printer on two roles", async () => {
  const [first, second] = await suite.db
    .insert(printers)
    .values([
      { name: "Bar", transport: "network_tcp", host: "10.0.0.1" },
      { name: "Counter", transport: "network_tcp", host: "10.0.0.2" },
    ])
    .returning({ id: printers.id });
  const bar = first!.id;
  const counter = second!.id;
  const lists = {
    ...emptyPrinterLists(),
    receiptPrinterIds: [counter, bar],
    receiptPrinterDefaultId: bar,
    paymentSlipPrinterIds: [bar],
  };
  await withTransaction(suite.db, (tx) => setProfilePrinterLists(tx, profileId, lists));
  await expect(
    withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        ...lists,
        receiptPrinterIds: [bar, bar],
      }),
    ),
  ).rejects.toMatchObject({
    code: "device_profile.invalid",
    params: { reason: "duplicate_printer", field: "receiptPrinterIds" },
  });
  expect(await withTransaction(suite.db, (tx) => readProfilePrinterLists(tx, profileId))).toEqual(
    lists,
  );
  expect(await storedLists()).toEqual({
    receipt: { ids: [counter, bar], defaultId: bar },
    payment_slip: { ids: [bar], defaultId: null },
  });
  await withTransaction(suite.db, (tx) =>
    setProfilePrinterLists(tx, profileId, emptyPrinterLists()),
  );
  expect(await storedLists()).toEqual({});
});

it("refuses a stored printer list whose top level is an array", async () => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.execute(sql`update device_profiles set printer_lists = '[]' where id = ${profileId}`),
    ),
  ).rejects.toThrow(/device_profiles_printer_lists_ck/);
  expect(await storedLists()).toEqual({});
});
