import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import {} from "@waitron/menu";
import { startManagementSession } from "@waitron/identity";
import { departments, departmentReceipts, departmentSalePolicies } from "@waitron/venue-service";
import { type DepartmentReceiptWrite } from "@waitron/shared";
import { ALL_MODULES, VENUE_SERVICE } from "./modules.js";
import { checkedDepartmentReceiptWrite } from "./department-receipt-draft.js";
import { departmentReceiptLanguages } from "./department-receipt-languages.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const fiscal = ALL_MODULES.find((module) => module.fiscal?.venueFields !== undefined)!.fiscal!
  .venueFields!;
const policy = { printTradingName: true } as const;

async function fixture(role: "manager" | "staff" = "manager") {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Venue SL" })
    .onConflictDoNothing({ target: tenants.id });
  await seedVenue(suite.db, {
    name: randomUUID(),
    invoiceLocales: ["gl-ES"],
    operationDescription: "Bootstrap",
  });
  await seedVenueSettings(suite.db, {
    defaultContentLanguage: "es",
    contentLanguages: ["es", "ca", "en"],
  });
  const [department] = await suite.db
    .insert(departments)
    .values({ name: randomUUID(), tradingName: "Deli" })
    .returning();
  await suite.db.insert(departmentSalePolicies).values({ departmentId: department!.id, ...policy });
  await suite.db.insert(departmentReceipts).values({
    departmentId: department!.id,
    receipt: {
      operationDescription: "Meals",
      footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Antes" },
    },
  });
  const [person] = await seedPersons(suite.db, { displayName: randomUUID(), role });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return { departmentId: department!.id, personId: person!.id, sessionId: session.token };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function check(f: Fixture, input: unknown) {
  return withTransaction(suite.db, (tx) =>
    checkedDepartmentReceiptWrite(
      tx,
      f.departmentId,
      f.sessionId,
      input,
      fiscal.validateOperationDescription,
    ),
  );
}
async function save(f: Fixture, input: unknown) {
  return withTransaction(suite.db, async (tx) => {
    const checked = await checkedDepartmentReceiptWrite(
      tx,
      f.departmentId,
      f.sessionId,
      input,
      fiscal.validateOperationDescription,
    );
    await VENUE_SERVICE.saveDepartmentReceiptSettings(tx, f.departmentId, checked.input);
  });
}
const body = (extra: Partial<DepartmentReceiptWrite> = {}): DepartmentReceiptWrite => ({
  receipt: { operationDescription: "Deli meals" },
  policy,
  ...extra,
});

describe("checked department receipt write", () => {
  it("reads hidden translation storage separately from the offered list and keeps historical copies", async () => {
    const f = await fixture();
    const input = body({
      receipt: {
        operationDescription: "Deli meals",
        footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Gracias" },
      },
    });
    const checked = await check(f, input);
    expect(checked.scope).toEqual({
      receiptLanguages: ["gl-ES", "es-ES", "ca-ES", "eu-ES"],
    });
    expect(checked.input).toEqual(input);
    await save(f, input);
    expect((await suite.db.select().from(departmentReceipts))[0]!.receipt).toEqual(input.receipt);
    await withTransaction(suite.db, async (tx) => {
      expect((await departmentReceiptLanguages(tx)).languages).toEqual(["gl-ES", "es-ES", "ca-ES"]);
      const printed = await VENUE_SERVICE.readPrintedDepartmentReceipt(
        tx,
        { receiptLanguages: ["eu-ES", "gl-ES"] },
        f.departmentId,
        "80mm",
      );
      expect(printed.receipt.footerMessage).toEqual({ "eu-ES": "Eskerrik asko" });
    });
  });
  it("allows decoration editing with venue permission when both policies are unchanged", async () => {
    const f = await fixture();
    await save(f, body());
    expect((await suite.db.select().from(departmentReceipts))[0]!.receipt).toEqual({
      operationDescription: "Deli meals",
    });
    expect((await suite.db.select().from(departmentSalePolicies))[0]).toMatchObject(policy);
  });
  it.each([{ printTradingName: true }, { printTradingName: false }] as const)(
    "refuses changed policy %j without its permission and leaves both rows unchanged",
    async (changed) => {
      const f = await fixture("staff");
      const before = await suite.db.select().from(departmentReceipts);
      await expect(save(f, body({ policy: changed }))).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "venue.configure" },
      });
      expect(await suite.db.select().from(departmentReceipts)).toEqual(before);
      expect((await suite.db.select().from(departmentSalePolicies))[0]).toMatchObject(policy);
    },
  );
  it("refuses changed hidden text and leaves receipt and policy unchanged", async () => {
    const f = await fixture();
    const before = await suite.db.select().from(departmentReceipts);
    await expect(
      save(
        f,
        body({
          receipt: { operationDescription: "Deli meals", footerMessage: { "eu-ES": "Changed" } },
        }),
      ),
    ).rejects.toMatchObject({
      code: "receipt.invalid",
      params: { reason: "invalid_language", field: "footerMessage", language: "eu-ES" },
    });
    expect(await suite.db.select().from(departmentReceipts)).toEqual(before);
    expect((await suite.db.select().from(departmentSalePolicies))[0]).toMatchObject(policy);
  });
  it("preserves the current policy when venue permission is lost after an earlier read", async () => {
    const f = await fixture();
    await check(f, body());
    await setBuiltInRoleForTest(suite.db, f.personId, "staff");
    await suite.db
      .update(departmentSalePolicies)
      .set({ printTradingName: false })
      .where(eq(departmentSalePolicies.departmentId, f.departmentId));
    await expect(save(f, body())).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "venue.configure" },
    });
    expect((await suite.db.select().from(departmentSalePolicies))[0]!.printTradingName).toBe(false);
  });
  it("rechecks offered translations after content languages change", async () => {
    const f = await fixture();
    const input = body({
      receipt: { operationDescription: "Deli meals", footerMessage: { "ca-ES": "Benvinguts" } },
    });
    await check(f, input);
    await seedVenueSettings(suite.db, { contentLanguages: ["es", "en"] });
    await expect(save(f, input)).rejects.toMatchObject({
      code: "receipt.invalid",
      params: { reason: "invalid_language", field: "footerMessage", language: "ca-ES" },
    });
    expect((await suite.db.select().from(departmentReceipts))[0]!.receipt.footerMessage).toEqual({
      "eu-ES": "Eskerrik asko",
      "es-ES": "Antes",
    });
  });
  it("rechecks the retained hidden value after another receipt edit", async () => {
    const f = await fixture();
    const input = body({
      receipt: { operationDescription: "Deli meals", footerMessage: { "eu-ES": "Eskerrik asko" } },
    });
    await check(f, input);
    await suite.db
      .update(departmentReceipts)
      .set({ receipt: { operationDescription: "Meals", footerMessage: { "eu-ES": "New text" } } })
      .where(eq(departmentReceipts.departmentId, f.departmentId));
    await expect(save(f, input)).rejects.toMatchObject({
      code: "receipt.invalid",
      params: { language: "eu-ES" },
    });
    expect((await suite.db.select().from(departmentReceipts))[0]!.receipt.footerMessage).toEqual({
      "eu-ES": "New text",
    });
  });
  it("rechecks a person's permission after the preparatory read", async () => {
    const f = await fixture();
    await check(f, body());
    await setBuiltInRoleForTest(suite.db, f.personId, "staff");
    await expect(save(f, body())).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "venue.configure" },
    });
  });
  it("refuses a deleted department", async () => {
    const f = await fixture();
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.departmentId));
    await expect(check(f, body())).rejects.toMatchObject({
      code: "department.not_found",
      params: { departmentId: f.departmentId },
    });
  });
  it("requires venue permission before returning a draft", async () => {
    const f = await fixture("staff");
    await expect(check(f, body())).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "venue.configure" },
    });
  });
});
