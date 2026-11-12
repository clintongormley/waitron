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
it("keeps the location's semantic name after it moves into the venue document", async () => {
  const result = await canonical({
    tables: {
      locations: table([{ id, time_zone: "Europe/Madrid" }]),
      settings: table([{ module: "venue", doc: JSON.stringify({ name: "Deli" }) }]),
    },
  });
  expect(result.tables.locations!.rows).toEqual({
    '@locations:["Deli"]': { id: '@locations:["Deli"]', time_zone: "Europe/Madrid" },
  });
});
it("maps only the generated activity id and retains the setup save facts", async () => {
  const event = {
    at: "2026-10-08T10:00:00.000Z",
    kind: "settings.saved",
    subject_kind: "settings",
    subject_id: "venue",
    person_id: null,
    device_id: null,
    data: '{"revision":1}',
  };
  const first = await canonical({ tables: { activity_log: table([{ id, ...event }]) } });
  const second = await canonical({ tables: { activity_log: table([{ id: otherId, ...event }]) } });
  expect(second).toEqual(first);
  expect(Object.values(first.tables.activity_log!.rows)).toEqual([
    { id: expect.stringContaining("@activity_log:"), ...event, data: { revision: 1 } },
  ]);
  expect(
    await canonical({
      tables: { activity_log: table([{ id, ...event, at: "2026-10-08T10:00:01.000Z" }]) },
    }),
  ).not.toEqual(first);
});

it("keeps floor-set identity when department ownership moves into its row", async () => {
  const department = "123e4567-e89b-42d3-a456-426614174002";
  const original = await canonical({
    tables: {
      departments: table([{ id: department, name: "Restaurant" }]),
      floor_plan_sets: table([{ id }]),
      department_floor_plan_sets: table([
        { set_id: id, department_id: department, name: "Standard", is_default: 1 },
      ]),
    },
  });
  const folded = await canonical({
    tables: {
      departments: table([{ id: department, name: "Restaurant" }]),
      floor_plan_sets: table([{ id, department_id: department, name: "Standard", is_default: 1 }]),
    },
  });
  expect(Object.keys(folded.tables.floor_plan_sets!.rows)).toEqual(
    Object.keys(original.tables.floor_plan_sets!.rows),
  );
});

it("maps a job-role baseline event and its generated role id together", async () => {
  const snapshot = (role: string) => ({
    tables: {
      staff_roles: table([
        { id: role, name: "Team", colour: "grey", position: 0, hidden_at: null },
      ]),
      activity_log: table([
        {
          id: "123e4567-e89b-42d3-a456-426614174002",
          kind: "job_role.member_added",
          subject_id: "admin",
          at: "2026-10-08T10:00:00.000Z",
          data: JSON.stringify({ staffRoleId: role, name: "Team" }),
        },
      ]),
    },
  });
  const first = await canonical(snapshot(id));
  expect(await canonical(snapshot(otherId))).toEqual(first);
  expect(Object.values(first.tables.staff_roles!.rows)).toEqual([
    {
      id: '@staff_roles:["Team"]',
      name: "Team",
      colour: "grey",
      position: 0,
      hidden_at: null,
    },
  ]);
  expect(Object.values(first.tables.activity_log!.rows)[0]!.data).toEqual({
    staffRoleId: '@staff_roles:["Team"]',
    name: "Team",
  });
});
