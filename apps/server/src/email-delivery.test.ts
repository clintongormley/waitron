import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { resolveEmailDelivery } from "./email-delivery.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("resolveEmailDelivery", () => {
  it("uses Mailpit for a practice installation without configured SMTP", async () => {
    const tenantId = await seedTenant(suite.db);

    await expect(resolveEmailDelivery(suite.db, ring, tenantId, true)).resolves.toEqual({
      mode: "local_capture",
      smtp: {
        url: "smtp://127.0.0.1:1025",
        from: "Waitron <no-reply@waitron.test>",
      },
    });
  });

  it("prefers the tenant's SMTP gateway over Mailpit", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, ring, {
        tenantId,
        purpose: "email.smtp",
        value: { url: "smtps://smtp.example.test:465", from: "Venue <venue@example.test>" },
      }),
    );

    await expect(resolveEmailDelivery(suite.db, ring, tenantId, true)).resolves.toEqual({
      mode: "smtp",
      smtp: {
        url: "smtps://smtp.example.test:465",
        from: "Venue <venue@example.test>",
      },
    });
  });

  it("reports a live installation without SMTP as unconfigured", async () => {
    const tenantId = await seedTenant(suite.db);

    await expect(resolveEmailDelivery(suite.db, ring, tenantId, false)).resolves.toEqual({
      mode: "unconfigured",
    });
  });
});
