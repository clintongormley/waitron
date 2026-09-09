import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  beginGoogleLink,
  beginGoogleLogin,
  claimGoogleState,
  completeGoogleLink,
  loginWithGoogle,
} from "./google-oidc.js";
import { codeOf, openManagementSession, seedPerson } from "../test/fixtures.js";

let tenantId: string;
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTenant(suite.db, tenantId, fn);
const config = {
  clientId: "client.apps.googleusercontent.com",
  redirectUri: "https://waitron.example/management-api/google/callback",
};

describe("Google OpenID Connect state", () => {
  it("creates a PKCE authorization request and stores only a digest of its one-time state", async () => {
    const begun = await run((tx) => beginGoogleLogin(tx, { tenantId, ...config }));
    const url = new URL(begun.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(begun.state);
    const rows = await suite.db.execute<{ state_hash: string }>(
      sql`select state_hash from google_oidc_states`,
    );
    expect(rows.rows.at(-1)!.state_hash).toHaveLength(64);
    expect(rows.rows.at(-1)!.state_hash).not.toBe(begun.state);
  });

  it("binds a link ceremony to the signed-in person and consumes state once", async () => {
    const owner = await openManagementSession(suite.db, tenantId, "staff");
    const begun = await run((tx) =>
      beginGoogleLink(tx, { tenantId, managementSessionId: owner.sessionId, ...config }),
    );
    const claimed = await run((tx) => claimGoogleState(tx, { tenantId, state: begun.state }));
    expect(claimed.personId).toBe(owner.personId);
    expect(claimed.mode).toBe("link");
    expect(
      await codeOf(() => run((tx) => claimGoogleState(tx, { tenantId, state: begun.state }))),
    ).toBe("google.invalid");
  });

  it("links by stable subject, prevents duplicates, and signs an active linked person in", async () => {
    const first = await seedPerson(suite.db, tenantId, "staff");
    const second = await seedPerson(suite.db, tenantId, "staff");
    await run((tx) => completeGoogleLink(tx, { tenantId, personId: first, subject: "google-123" }));
    expect(
      await codeOf(() =>
        run((tx) => completeGoogleLink(tx, { tenantId, personId: second, subject: "google-123" })),
      ),
    ).toBe("google.already_linked");
    const session = await run((tx) => loginWithGoogle(tx, { tenantId, subject: "google-123" }));
    expect(session.personId).toBe(first);
  });

  it("does not let Google bypass an enrolled Waitron authenticator", async () => {
    const personId = await seedPerson(suite.db, tenantId, "staff");
    await suite.db.execute(
      sql`update persons set google_subject = 'google-mfa', totp_secret = 'encrypted' where id = ${personId}`,
    );
    expect(
      await codeOf(() => run((tx) => loginWithGoogle(tx, { tenantId, subject: "google-mfa" }))),
    ).toBe("google.second_factor_required");
  });
});
