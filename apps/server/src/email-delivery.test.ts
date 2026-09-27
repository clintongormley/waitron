import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import { resolveEmailDelivery } from "./email-delivery.js";

// `putCredential` refuses a payload missing a field, so a row sealed under an older field list
// cannot be written through the vault; the read is replaced instead, for the cases that set this.
let decryptedOverride: Record<string, string> | null = null;
vi.mock("@waitron/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/credentials")>();
  return {
    ...actual,
    tryGetCredential: (...args: Parameters<typeof actual.tryGetCredential>) =>
      decryptedOverride === null
        ? actual.tryGetCredential(...args)
        : Promise.resolve(decryptedOverride),
  };
});
afterEach(() => {
  decryptedOverride = null;
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("resolveEmailDelivery", () => {
  it("uses Mailpit for a practice installation without configured SMTP", async () => {
    await seedTenant(suite.db);

    await expect(resolveEmailDelivery(suite.db, ring, true)).resolves.toEqual({
      mode: "local_capture",
      smtp: {
        url: "smtp://127.0.0.1:1025",
        from: "Waitron <no-reply@waitron.test>",
      },
    });
  });

  it("prefers the tenant's SMTP gateway over Mailpit", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "email.smtp",
        value: { url: "smtps://smtp.example.test:465", from: "Venue <venue@example.test>" },
      }),
    );

    await expect(resolveEmailDelivery(suite.db, ring, true)).resolves.toEqual({
      mode: "smtp",
      smtp: {
        url: "smtps://smtp.example.test:465",
        from: "Venue <venue@example.test>",
      },
    });
  });

  it("reports a live installation without SMTP as unconfigured", async () => {
    await seedTenant(suite.db);

    await expect(resolveEmailDelivery(suite.db, ring, false)).resolves.toEqual({
      mode: "unconfigured",
    });
  });

  it.each(["url", "from"])(
    "refuses an SMTP credential sealed without %s, naming the field",
    async (field) => {
      await seedTenant(suite.db);
      const payload: Record<string, string> = {
        url: "smtps://smtp.example.test:465",
        from: "Venue <venue@example.test>",
      };
      delete payload[field];
      decryptedOverride = payload;

      const error = await captureError(() => resolveEmailDelivery(suite.db, ring, false));
      expect(isAppError(error) && error.code).toBe("server.credential_unusable");
      expect(isAppError(error) && error.params).toEqual({ purpose: "email.smtp", field });
    },
  );
});
