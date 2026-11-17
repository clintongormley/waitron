import { withFoldedPersonKeys } from "@waitron/db";
import { expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  insertInChunks,
  persons,
  personRoles,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "../test/person-rows.js";
import { openManagementSession } from "../test/fixtures.js";
import { ensureBuiltInRoles } from "./roles.js";
import { listPersonsPage } from "./staff.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const query = {
  page: 0,
  search: "",
  roleIds: [] as string[],
  status: "all" as const,
  sortKey: "displayName" as const,
  sortDirection: "ascending" as const,
  locale: "en-GB",
};
const read = (
  token: string,
  changes: Partial<Omit<Parameters<typeof listPersonsPage>[1], "managementSessionId">> = {},
) =>
  withTransaction(suite.db, (tx) =>
    listPersonsPage(tx, { managementSessionId: token, ...query, ...changes }),
  );

it("pages the complete ordered roster, clamps a shrinking page, and searches beyond the first page", async () => {
  const { token } = await openManagementSession(suite.db, "admin");
  const { staff, manager } = await withTransaction(suite.db, ensureBuiltInRoles);
  const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
  await withTransaction(suite.db, async (tx) => {
    await insertInChunks(
      tx,
      persons,
      withFoldedPersonKeys(
        ids.map((id, i) => ({
          id,
          displayName: `Page ${i + 1}`,
          firstNames: i === 100 ? "Needle" : "Cohort",
          email: i === 100 ? "beyond-page@example.test" : `page-${i}@example.test`,
          telephone: i === 100 ? "555 999" : null,
          status:
            i === 99
              ? ("pending" as const)
              : i === 100
                ? ("suspended" as const)
                : ("active" as const),
        })),
      ),
    );
    await insertInChunks(
      tx,
      personRoles,
      ids.map((personId) => ({ personId, roleId: staff })),
    );
    await tx.insert(personRoles).values({ personId: ids[0]!, roleId: manager });
  });
  const filter = { roleIds: [staff, manager] };
  const first = await read(token, filter);
  expect(first).toMatchObject({ total: 101, page: 0, pageSize: 50, anyPeople: true });
  expect(first.rows.map((p) => p.displayName)).toEqual(
    Array.from({ length: 50 }, (_, i) => `Page ${i + 1}`),
  );
  expect(first.rows[0]!.roleIds).toEqual([staff, manager].sort());
  expect(first.rows[0]).not.toHaveProperty("passwordHash");
  expect(first.rows[0]).not.toHaveProperty("totpSecret");
  expect(first.rows[0]).toMatchObject({
    hasPassword: false,
    hasTotp: false,
    email: "page-0@example.test",
  });
  const last = await read(token, { ...filter, page: 99 });
  expect(last).toMatchObject({ page: 2, total: 101 });
  expect(last.rows.map((p) => p.personId)).toEqual([ids[100]]);
  const found = await read(token, { ...filter, page: 2, search: "Need" });
  expect(found).toMatchObject({ total: 1, page: 0 });
  expect(found.rows.map((p) => p.personId)).toEqual([ids[100]]);
  expect((await read(token, { ...filter, search: "Need " })).rows).toEqual([]);
  expect((await read(token, { ...filter, search: "!!!" })).total).toBe(0);
  expect((await read(token, { ...filter, search: "  " })).total).toBe(101);
  expect(
    (await read(token, { ...filter, search: "beyond@example.test 999" })).rows.map(
      (p) => p.personId,
    ),
  ).toEqual([ids[100]]);
  expect((await read(token, { ...filter, status: "current" })).total).toBe(100);
  expect((await read(token, { ...filter, status: "active" })).total).toBe(99);
  expect(
    (await read(token, { ...filter, status: "suspended" })).rows.map((p) => p.personId),
  ).toEqual([ids[100]]);
  expect((await read(token, { roleIds: [manager] })).rows.map((p) => p.personId)).toEqual([ids[0]]);
  expect((await read(token, { ...filter, status: "pending" })).rows.map((p) => p.personId)).toEqual(
    [ids[99]],
  );
  expect((await read(token, { roleIds: [crypto.randomUUID()] })).total).toBe(0);
});

it("sorts every column by the displayed text with empty values, stable ties and localized roles/status", async () => {
  const { token } = await openManagementSession(suite.db, "admin");
  const seeded = await withTransaction(suite.db, (tx) =>
    seedPersons(tx, [
      {
        displayName: "Carl",
        firstNames: "B",
        lastNames: "B",
        email: "b@example.test",
        telephone: "2",
        role: "staff",
        status: "active",
      },
      {
        displayName: "Dora",
        firstNames: "C",
        lastNames: "C",
        email: "c@example.test",
        telephone: "10",
        role: "manager",
        status: "pending",
      },
      {
        displayName: "Eva",
        firstNames: "A",
        lastNames: null,
        email: null,
        telephone: null,
        role: "admin",
        status: "suspended",
      },
    ]),
  );
  // Their ids exclude the signed-in admin without depending on its randomly generated name.
  const selected = { search: "", roleIds: [] as string[] };
  const mine = new Set(seeded.map((p) => p.id));
  for (const [sortKey, expected] of [
    ["displayName", ["Carl", "Dora", "Eva"]],
    ["legalName", ["Eva", "Carl", "Dora"]],
    ["email", ["Eva", "Carl", "Dora"]],
    ["telephone", ["Eva", "Carl", "Dora"]],
    ["role", ["Eva", "Carl", "Dora"]],
    ["status", ["Carl", "Eva", "Dora"]],
  ] as const) {
    const result = await read(token, { ...selected, sortKey, locale: "es-ES" });
    expect(result.rows.filter((p) => mine.has(p.personId)).map((p) => p.displayName)).toEqual(
      expected,
    );
  }
  const descending = await read(token, { sortKey: "status", sortDirection: "descending" });
  expect(descending.rows.filter((p) => mine.has(p.personId)).map((p) => p.displayName)).toEqual([
    "Dora",
    "Eva",
    "Carl",
  ]);
});

it("keeps decimal and Spanish letter ordering, and refuses a caller without people access", async () => {
  const { token } = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) =>
    seedPersons(
      tx,
      ["Label 0.5", "Label 0.25", "Label n", "Label \u00f1"].map((displayName) => ({
        displayName,
        role: "staff" as const,
      })),
    ),
  );
  const { staff } = await withTransaction(suite.db, ensureBuiltInRoles);
  expect(
    (await read(token, { roleIds: [staff], locale: "es-ES" })).rows.map((p) => p.displayName),
  ).toEqual(["Label 0.25", "Label 0.5", "Label n", "Label \u00f1"]);
  expect(
    (
      await read(token, {
        roleIds: [staff],
        sortKey: "",
        sortDirection: "descending",
        locale: "es-ES",
      })
    ).rows.map((p) => p.displayName),
  ).toEqual(["Label 0.25", "Label 0.5", "Label n", "Label \u00f1"]);
  const denied = await openManagementSession(suite.db, "staff");
  await expect(read(denied.token)).rejects.toMatchObject({ code: "authorization.not_permitted" });
});

it("matches every search word across names, email and telephone, closest first", async () => {
  const { token } = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) =>
    seedPersons(tx, [
      {
        displayName: "Ed",
        firstNames: null,
        lastNames: null,
        email: "edgar@x.com",
        telephone: null,
        role: "staff",
      },
      {
        displayName: "Pepe",
        firstNames: "Jos\u00e9",
        lastNames: "Garc\u00eda",
        email: "jose@example.com",
        telephone: null,
        role: "staff",
      },
      {
        displayName: "Lu",
        firstNames: null,
        lastNames: null,
        email: null,
        telephone: "+34 600 111 222",
        role: "staff",
      },
      {
        displayName: "Max",
        firstNames: null,
        lastNames: "Garcia",
        email: null,
        telephone: null,
        role: "staff",
      },
    ]),
  );
  const { staff } = await withTransaction(suite.db, ensureBuiltInRoles);
  for (const [search, expected] of [
    ["garcia jose", ["Pepe"]],
    ["GARC\u00cdA pepe", ["Pepe"]],
    ["jose example", ["Pepe"]],
    ["600 111", ["Lu"]],
    ["&", []],
    ["pepe ", ["Pepe"]],
    ["pep ", []],
    ["gar", ["Max", "Pepe", "Ed"]],
    ["staff", []],
    ["active", []],
  ] as const) {
    const result = await read(token, { roleIds: [staff], search });
    expect(
      result.rows.map((p) => p.displayName),
      search,
    ).toEqual(expected);
  }
});
