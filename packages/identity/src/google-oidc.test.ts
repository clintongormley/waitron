import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
import { encryptTotpSecret } from "./mfa.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const config = {
  clientId: "client.apps.googleusercontent.com",
  redirectUri: "https://waitron.example/management-api/google/callback",
};

describe("Google OpenID Connect state", () => {
  it("creates a PKCE authorization request and stores only a digest of its one-time state", async () => {
    const begun = await run((tx) => beginGoogleLogin(tx, { ...config }));
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
    const owner = await openManagementSession(suite.db, "staff");
    const begun = await run((tx) =>
      beginGoogleLink(tx, {
        managementSessionId: owner.sessionId,
        currentPassword: "correct horse",
        ...config,
      }),
    );
    const claimed = await run((tx) => claimGoogleState(tx, { state: begun.state }));
    expect(claimed.personId).toBe(owner.personId);
    expect(claimed.mode).toBe("link");
    expect(await codeOf(() => run((tx) => claimGoogleState(tx, { state: begun.state })))).toBe(
      "google.invalid",
    );
  });

  it("requires current credentials before starting a link ceremony", async () => {
    const owner = await openManagementSession(suite.db, "staff");
    expect(
      await codeOf(() =>
        run((tx) =>
          beginGoogleLink(tx, {
            managementSessionId: owner.sessionId,
            currentPassword: "wrong",
            ...config,
          }),
        ),
      ),
    ).toBe("password.invalid");
  });

  it("links by stable subject, prevents duplicates, and signs an active linked person in", async () => {
    const first = await seedPerson(suite.db, "staff");
    const second = await seedPerson(suite.db, "staff");
    await run((tx) => completeGoogleLink(tx, { personId: first, subject: "google-123" }));
    expect(
      await codeOf(() =>
        run((tx) => completeGoogleLink(tx, { personId: second, subject: "google-123" })),
      ),
    ).toBe("google.already_linked");
    const session = await run((tx) => loginWithGoogle(tx, { subject: "google-123" }));
    expect(session.personId).toBe(first);
  });

  it("refuses to link a person who is not active, or who does not exist, and writes no subject", async () => {
    const suspended = await seedPerson(suite.db, "staff", "suspended");
    for (const personId of [suspended, "00000000-0000-4000-8000-000000000000"]) {
      expect(
        await codeOf(() =>
          run((tx) => completeGoogleLink(tx, { personId, subject: "google-refused" })),
        ),
      ).toBe("google.invalid");
    }
    const linked = await suite.db.execute<{ id: string }>(
      sql`select id from persons where google_subject = 'google-refused'`,
    );
    expect(linked.rows).toEqual([]);
  });

  it("does not let Google bypass an enrolled Waitron authenticator", async () => {
    const personId = await seedPerson(suite.db, "staff");
    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP", {
      version: 1,
      key: Buffer.alloc(32, 5),
    });
    await suite.db.execute(
      sql`update persons set google_subject = 'google-mfa', totp_secret = ${encrypted} where id = ${personId}`,
    );
    expect(await codeOf(() => run((tx) => loginWithGoogle(tx, { subject: "google-mfa" })))).toBe(
      "google.second_factor_required",
    );
  });

  it("makes a suspended Google login indistinguishable from an unknown subject", async () => {
    const personId = await seedPerson(suite.db, "staff");
    await suite.db.execute(
      sql`update persons set google_subject = 'google-suspended', status = 'suspended' where id = ${personId}`,
    );
    expect(
      await codeOf(() => run((tx) => loginWithGoogle(tx, { subject: "google-suspended" }))),
    ).toBe("google.invalid");
  });
});
