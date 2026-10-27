import { expect, it } from "vitest";
import { hashPin, hashPassword } from "@waitron/identity";
import { createHash } from "node:crypto";
import * as reader from "./madrid-semantics.js";
import type { MadridSemantics, MadridTable } from "./madrid-semantics.js";

function table(rows: MadridTable["rows"]): MadridTable {
  return { columns: [], foreignKeys: [], rows };
}
const id = "123e4567-e89b-42d3-a456-426614174000";
const otherId = "123e4567-e89b-42d3-a456-426614174001";
function canonical(snapshot: MadridSemantics) {
  expect(reader).toHaveProperty("canonicalMadridSemantics", expect.any(Function));
  if (!("canonicalMadridSemantics" in reader)) throw new Error("missing canonical reader");
  return reader.canonicalMadridSemantics(snapshot);
}
it("preserves a changed value while mapping generated ids and JSON relationships", async () => {
  const snapshot = {
    tables: {
      categories: table([{ id, name: "Mains", nested: JSON.stringify({ [id]: [id] }) }]),
      category_details: table([{ category_id: id, parent_id: null, color: "red" }]),
    },
  };
  const original = await canonical(snapshot);
  const regenerated = await canonical({
    tables: {
      categories: table([
        { id: otherId, name: "Mains", nested: JSON.stringify({ [otherId]: [otherId] }) },
      ]),
      category_details: table([{ category_id: otherId, parent_id: null, color: "red" }]),
    },
  });
  expect(regenerated).toEqual(original);
  expect(
    await canonical({
      tables: {
        ...snapshot.tables,
        category_details: table([{ category_id: id, parent_id: null, color: "blue" }]),
      },
    }),
  ).not.toEqual(original);
});
it("refuses a duplicate semantic identity rather than collapsing two rows", async () => {
  await expect(
    canonical({
      tables: {
        categories: table([
          { id, name: "Mains" },
          { id: otherId, name: "Mains" },
        ]),
      },
    }),
  ).rejects.toThrow("duplicate semantic identity");
});
it("refuses unknown row identities and unresolved generated references", async () => {
  await expect(canonical({ tables: { new_table: table([{ id }]) } })).rejects.toThrow(
    "unclassified identity",
  );
  await expect(
    canonical({ tables: { categories: table([{ id, name: "Mains", parent_id: otherId }]) } }),
  ).rejects.toThrow("unresolved reference");
});
it("checks each published hash before replacing generated references", async () => {
  const document = {
    format: 3,
    includedMenuHashes: {},
    menuId: id,
    members: [],
    Z: "uppercase",
    a: "lowercase",
  };
  const hash = createHash("sha256")
    .update(
      `{"Z":"uppercase","a":"lowercase","format":3,"includedMenuHashes":{},"members":[],"menuId":"${id}"}`,
    )
    .digest("hex");
  const accepted = await canonical({
    tables: {
      catalogues: table([{ id, name: "Restaurant" }]),
      menu_versions: table([
        {
          id: otherId,
          menu_id: id,
          number: 1,
          document: JSON.stringify(document),
          content_hash: hash,
        },
      ]),
    },
  });
  expect(Object.values(accepted.tables.menu_versions!.rows)[0]!.document).toMatchObject({
    menuId: '@catalogues:["Restaurant"]',
  });
  await expect(
    canonical({
      tables: {
        catalogues: table([{ id, name: "Restaurant" }]),
        menu_versions: table([
          {
            id: otherId,
            menu_id: id,
            number: 1,
            document: JSON.stringify(document),
            content_hash: "0".repeat(64),
          },
        ]),
      },
    }),
  ).rejects.toThrow("published document hash mismatch");
});

it("retains the virtual Each unit id without inventing a stored relationship", async () => {
  const fixedUnit = "00000000-0000-0000-0000-000000000001";
  const actual = await canonical({
    tables: { categories: table([{ id, name: "Mains", unit: JSON.stringify({ id: fixedUnit }) }]) },
  });
  expect(Object.values(actual.tables.categories!.rows)[0]!.unit).toEqual({ id: fixedUnit });
});

it("checks compound foreign keys against the complete target tuple", async () => {
  const foreignKeys = [
    {
      id: 0,
      seq: 0,
      table: "categories",
      from: "category_id",
      to: "id",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
      match: "NONE",
    },
    {
      id: 0,
      seq: 1,
      table: "categories",
      from: "parent_name",
      to: "name",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
      match: "NONE",
    },
  ];
  const target = table([{ id, name: "Mains" }]);
  await expect(
    canonical({
      tables: {
        categories: target,
        category_details: {
          ...table([{ category_id: id, parent_name: "Different" }]),
          foreignKeys,
        },
      },
    }),
  ).rejects.toThrow("unresolved foreign relationship");
  const accepted = await canonical({
    tables: {
      categories: target,
      category_details: { ...table([{ category_id: id, parent_name: "Mains" }]), foreignKeys },
    },
  });
  expect(Object.values(accepted.tables.category_details!.rows)[0]!.parent_name).toBe("Mains");
});
it("verifies valid and wrong credentials before replacing salts, and retains password absence", async () => {
  const person = {
    id,
    email: "staff@example.test",
    pin_hash: hashPin("5555"),
    password_hash: hashPassword("dashPass123"),
    role: "manager",
  };
  const accepted = await canonical({ tables: { persons: table([person]) } });
  expect(Object.values(accepted.tables.persons!.rows)[0]).toMatchObject({
    pin_hash: "verified:5555;refused:9998",
    password_hash: "verified:demo-password;refused:wrong-password",
    role: "manager",
  });
  const noPassword = await canonical({
    tables: { persons: table([{ ...person, password_hash: null }]) },
  });
  expect(Object.values(noPassword.tables.persons!.rows)[0]!.password_hash).toBeNull();
  await expect(
    canonical({ tables: { persons: table([{ ...person, pin_hash: hashPin("1234") }]) } }),
  ).rejects.toThrow("PIN verification mismatch");
  await expect(
    canonical({
      tables: {
        persons: table([{ ...person, password_hash: hashPassword("different-password") }]),
      },
    }),
  ).rejects.toThrow("password verification mismatch");
});
