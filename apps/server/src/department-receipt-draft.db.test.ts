import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS, contentLanguages } from "@waitron/catalogue";
import {
  IDENTITY_MIGRATIONS,
  persons,
  startManagementSession,
  registerModulePermissions,
} from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  departmentReceipts,
  departmentSalePolicies,
} from "@waitron/venue-service";
import { locationId, type DepartmentReceiptWrite } from "@waitron/shared";
import { ALL_MODULES, VENUE_SERVICE } from "./modules.js";
import { checkedDepartmentReceiptWrite } from "./department-receipt-draft.js";
import { departmentReceiptLanguages } from "./department-receipt-languages.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
  ],
});
const fiscal = ALL_MODULES.find((module) => module.fiscal?.venueFields !== undefined)!.fiscal!
  .venueFields!;
const policy = { receiptPrintMode: "auto", printTradingName: true } as const;
afterEach(() => {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]);
});

async function fixture(
  role: "manager" | "staff" = "manager",
  managementFloor: "manager" | "admin" = "manager",
) {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: managementFloor }]);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: randomUUID(), invoiceLocales: ["gl-ES"], operationDescription: "Bootstrap" })
    .returning();
  const cfg = { locationId: locationId(location!.id) };
  await suite.db
    .insert(contentLanguages)
    .values({ defaultLanguage: "es", languages: ["es", "ca", "en"] })
    .onConflictDoNothing({ target: contentLanguages.id });
  const [department] = await suite.db
    .insert(departments)
    .values({ locationId: cfg.locationId, name: randomUUID(), tradingName: "Deli" })
    .returning();
  await suite.db.insert(departmentSalePolicies).values({ departmentId: department!.id, ...policy });
  await suite.db.insert(departmentReceipts).values({
    departmentId: department!.id,
    receipt: {
      operationDescription: "Meals",
      footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Antes" },
    },
  });
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: randomUUID(), role })
    .returning();
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return { cfg, departmentId: department!.id, personId: person!.id, sessionId: session.token };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function check(f: Fixture, input: unknown) {
  return withTransaction(suite.db, (tx) =>
    checkedDepartmentReceiptWrite(
      tx,
      f.cfg,
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
      f.cfg,
      f.departmentId,
      f.sessionId,
      input,
      fiscal.validateOperationDescription,
    );
    await VENUE_SERVICE.saveDepartmentReceiptSettings(
      tx,
      checked.scope,
      f.departmentId,
      checked.input,
    );
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
      ...f.cfg,
      receiptLanguages: ["gl-ES", "es-ES", "ca-ES", "eu-ES"],
    });
    expect(checked.input).toEqual(input);
    await save(f, input);
    expect((await suite.db.select().from(departmentReceipts))[0]!.receipt).toEqual(input.receipt);
    await withTransaction(suite.db, async (tx) => {
      expect((await departmentReceiptLanguages(tx, f.cfg)).languages).toEqual([
        "gl-ES",
        "es-ES",
        "ca-ES",
      ]);
      const printed = await VENUE_SERVICE.readPrintedDepartmentReceipt(
        tx,
        { ...f.cfg, receiptLanguages: ["eu-ES", "gl-ES"] },
        f.departmentId,
        "80mm",
      );
      expect(printed.receipt.footerMessage).toEqual({ "eu-ES": "Eskerrik asko" });
    });
  });
  it("allows decoration editing without the service-policy permission when both policies are unchanged", async () => {
    const f = await fixture("manager", "admin");
    await save(f, body());
    expect((await suite.db.select().from(departmentReceipts))[0]!.receipt).toEqual({
      operationDescription: "Deli meals",
    });
    expect((await suite.db.select().from(departmentSalePolicies))[0]).toMatchObject(policy);
  });
  it.each([
    { receiptPrintMode: "on_request", printTradingName: true },
    { receiptPrintMode: "auto", printTradingName: false },
  ] as const)(
    "refuses changed policy %j without its permission and leaves both rows unchanged",
    async (changed) => {
      const f = await fixture("manager", "admin");
      const before = await suite.db.select().from(departmentReceipts);
      await expect(save(f, body({ policy: changed }))).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "venue_service.manage" },
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
  it("checks the policy currently stored rather than the earlier read's policy", async () => {
    const f = await fixture("manager", "admin");
    await check(f, body());
    await suite.db
      .update(departmentSalePolicies)
      .set({ printTradingName: false })
      .where(eq(departmentSalePolicies.departmentId, f.departmentId));
    await expect(save(f, body())).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "venue_service.manage" },
    });
    expect((await suite.db.select().from(departmentSalePolicies))[0]!.printTradingName).toBe(false);
  });
  it("rechecks offered translations after content languages change", async () => {
    const f = await fixture();
    const input = body({
      receipt: { operationDescription: "Deli meals", footerMessage: { "ca-ES": "Benvinguts" } },
    });
    await check(f, input);
    await suite.db.update(contentLanguages).set({ languages: ["es", "en"] });
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
    await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, f.personId));
    await expect(save(f, body())).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "layout.configure" },
    });
  });
  it.each(["deleted", "other-location"])("refuses a %s department", async (kind) => {
    const f = await fixture();
    if (kind === "deleted")
      await suite.db
        .update(departments)
        .set({ active: false })
        .where(eq(departments.id, f.departmentId));
    else {
      const other = await fixture();
      f.cfg = other.cfg;
    }
    await expect(check(f, body())).rejects.toMatchObject({
      code: "department.not_found",
      params: { departmentId: f.departmentId },
    });
  });
  it("requires layout permission before returning a draft", async () => {
    const f = await fixture("staff");
    await expect(check(f, body())).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "layout.configure" },
    });
  });
});
