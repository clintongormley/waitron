import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { constraintTarget, isUniqueViolation } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { asEmailTaken, asPersonUniqueViolation } from "./staff.js";

// Real PostgreSQL, not PGlite: the three constants in person-constraints.ts spell the table and the
// key exactly as PostgreSQL writes them into a refusal's DETAIL, so they are read back off the
// server itself rather than off a WASM build of it. The clone comes from the shared container
// globalSetup has already migrated, so the heavier target costs one clone here.
const suite = useTemplateDb({ template: "core_identity" });

/** Run `statement` and hand back the refusal it raised, failing the test if it succeeded. */
async function refusalFrom(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to be refused, but it succeeded");
}

/** Run `translate` and hand back what it threw, failing the test if it returned. */
function thrownBy(translate: () => never): unknown {
  try {
    translate();
  } catch (error) {
    return error;
  }
  throw new Error("expected the translator to throw");
}

describe("the person indexes identity's write paths translate", () => {
  it("persons_tenant_email_uq names persons and lower(email), and asEmailTaken translates it", async () => {
    await suite.admin.execute(
      sql`insert into persons (display_name, email) values ('Ada', 'Owner@x.com')`,
    );
    // Differing case, same address: lower(email) collides while the raw values differ.
    const error = await refusalFrom(() =>
      suite.admin.execute(
        sql`insert into persons (display_name, email) values ('Grace', 'owner@x.com')`,
      ),
    );

    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({ table: "persons", columns: ["lower(email)"] });
    expect(thrownBy(() => asEmailTaken(error, "owner@x.com"))).toMatchObject({
      code: "person.email_taken",
      params: { email: "owner@x.com" },
    });
    expect(
      thrownBy(() =>
        asPersonUniqueViolation(error, { displayName: "Grace", email: "owner@x.com" }),
      ),
    ).toMatchObject({ code: "person.email_taken", params: { email: "owner@x.com" } });
  });

  it("persons_tenant_live_display_name_uq names persons and lower(btrim(display_name))", async () => {
    await suite.admin.execute(sql`insert into persons (display_name) values ('Ada Lovelace')`);
    // Differing case AND surrounding whitespace: lower(btrim(display_name)) collides, and both rows
    // are active, so the index's `status <> 'suspended'` predicate admits them.
    const error = await refusalFrom(() =>
      suite.admin.execute(sql`insert into persons (display_name) values ('  ada lovelace  ')`),
    );

    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({
      table: "persons",
      columns: ["lower(btrim(display_name))"],
    });
    expect(
      thrownBy(() => asPersonUniqueViolation(error, { displayName: "Ada Lovelace" })),
    ).toMatchObject({ code: "person.display_name_taken", params: { displayName: "Ada Lovelace" } });
  });

  it("persons_tenant_pending_email_uq names persons and lower(pending_email)", async () => {
    await suite.admin.execute(
      sql`insert into persons (display_name, pending_email) values ('Ada', 'New@x.com')`,
    );
    const error = await refusalFrom(() =>
      suite.admin.execute(
        sql`insert into persons (display_name, pending_email) values ('Grace', 'new@x.com')`,
      ),
    );

    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({
      table: "persons",
      columns: ["lower(pending_email)"],
    });
    expect(
      thrownBy(() => asPersonUniqueViolation(error, { displayName: "Grace", email: "new@x.com" })),
    ).toMatchObject({ code: "person.email_taken", params: { email: "new@x.com" } });
  });

  it("re-throws a duplicate on the primary key, which neither translator claims", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    await suite.admin.execute(sql`insert into persons (id, display_name) values (${id}, 'Ada')`);
    const error = await refusalFrom(() =>
      suite.admin.execute(sql`insert into persons (id, display_name) values (${id}, 'Grace')`),
    );

    // The negative control for all three constants: a real 23505 on `persons` that names a
    // different key must reach the caller untouched, never wearing a person.* code.
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({ table: "persons", columns: ["id"] });
    expect(thrownBy(() => asEmailTaken(error, "owner@x.com"))).toBe(error);
    expect(
      thrownBy(() => asPersonUniqueViolation(error, { displayName: "Grace", email: "new@x.com" })),
    ).toBe(error);
  });
});
