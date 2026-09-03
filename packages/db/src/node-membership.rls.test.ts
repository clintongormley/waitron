import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { readNodeMembership, writeNodeMembership } from "./node-membership.js";
import { useTemplateDb } from "./testing/lifecycle.js";

// Real Postgres, not PGlite: this asserts the object-privilege GRANT on `node_membership` (CLAUDE.md
// §3 — the command tag lies, so the ACL is read back BOTH directions). PGlite runs every connection
// as a superuser and would answer these probes the same regardless of the real grant, so a PGlite
// pass would be a false pass. `node_membership` carries no tenant_id and no RLS, so there is no
// policy to exercise; the grant is the one thing real Postgres is needed for here.
//
// The document round-trip also runs here on real Postgres, not only on PGlite: the `document` column
// is `jsonb`, and CLAUDE.md §4 records that jsonb/type parsing can diverge between PGlite and a real
// pg driver (the `name[]` OID 1003 case) — so a real-pg write→read `toEqual` is the receipt that the
// driver hands `readNodeMembership` a parsed object, not a wire literal, exactly as PGlite does.
describe("node_membership grants", () => {
  const suite = useTemplateDb({ template: "core" });

  it("app_user holds SELECT on node_membership and NOT INSERT/UPDATE/DELETE (owner-only write)", async () => {
    // app_user MUST hold SELECT (a node reads the held document on the app pool at boot) and MUST NOT
    // hold any write — the document is written owner-role only until Slice 3 adds runtime adoption.
    const rows = await suite.admin.execute<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(sql`
      select
        has_table_privilege('app_user', 'node_membership', 'SELECT') as sel,
        has_table_privilege('app_user', 'node_membership', 'INSERT') as ins,
        has_table_privilege('app_user', 'node_membership', 'UPDATE') as upd,
        has_table_privilege('app_user', 'node_membership', 'DELETE') as del
    `);
    expect(rows.rows[0]).toEqual({ sel: true, ins: false, upd: false, del: false });
  });

  it("round-trips the whole document through the jsonb column on real Postgres", async () => {
    // Owner connection (suite.admin) — app_user holds no INSERT (asserted above). Proves the jsonb
    // read returns a parsed object equal to what was written, on the real pg driver as well as PGlite.
    const document: SignedMembershipDocument = {
      body: {
        term: 4,
        nodes: [
          { nodeId: "server-1", contactUrl: "https://s1", standing: "sell-only" },
          { nodeId: "server-2", contactUrl: "https://s2", standing: "serving-primary" },
        ],
      },
      signerNodeId: "server-2",
      signature: "sig-4",
      endorsements: [
        { nodeId: "server-2", publicKey: "pk-2", endorsedBy: "server-1", signature: "esig" },
      ],
    };
    await writeNodeMembership(suite.admin, document);
    expect(await readNodeMembership(suite.admin)).toEqual(document);

    const term = await suite.admin.execute<{ term: string }>(
      sql`select term from node_membership where id = 1`,
    );
    expect(Number(term.rows[0]?.term)).toBe(4);
  });
});
