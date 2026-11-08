import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import {
  resolveEmailDelivery,
  resolveEmailDeliveryIn,
  resolveInvoiceEmailDelivery,
} from "./email-delivery.js";

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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("resolveEmailDelivery", () => {
  it("reads the settings inside a caller's transaction", async () => {
    await seedVenue(suite.db, { name: "Bar & Kitchen" });

    await expect(
      withTransaction(suite.db, (tx) => resolveEmailDeliveryIn(tx, ring, false)),
    ).resolves.toEqual({ mode: "unconfigured" });
    await expect(
      withTransaction(suite.db, (tx) => resolveEmailDeliveryIn(tx, ring, true)),
    ).resolves.toEqual(await resolveEmailDelivery(suite.db, ring, true));
  });

  it("uses Mailpit for a practice installation without configured SMTP", async () => {
    await seedVenue(suite.db, { name: "Bar & Kitchen" });

    await expect(resolveEmailDelivery(suite.db, ring, true)).resolves.toEqual({
      mode: "local_capture",
      smtp: {
        url: "smtp://127.0.0.1:1025",
        from: "Waitron <no-reply@waitron.test>",
      },
    });
  });

  it("prefers the tenant's SMTP gateway over Mailpit", async () => {
    await seedVenue(suite.db, { name: "Bar & Kitchen" });
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
        from: { name: "Bar & Kitchen", address: "venue@example.test" },
      },
    });
  });

  it.each([false, true])(
    "does not use an invalid saved sender or capture fallback (practice=%s)",
    async (practice) => {
      await seedVenue(suite.db);
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, ring, {
          purpose: "email.smtp",
          value: {
            url: "smtps://smtp.example.test:465",
            from: "one@example.test, two@example.test",
          },
        }),
      );
      expect(await resolveEmailDelivery(suite.db, ring, practice)).toEqual({
        mode: "unconfigured",
      });
    },
  );

  it("reports a live installation without SMTP as unconfigured", async () => {
    await seedVenue(suite.db, { name: "Bar & Kitchen" });

    await expect(resolveEmailDelivery(suite.db, ring, false)).resolves.toEqual({
      mode: "unconfigured",
    });
  });

  it("propagates a missing venue instead of treating it as an unusable sender", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "email.smtp",
        value: { url: "smtps://smtp.example.test:465", from: "venue@example.test" },
      }),
    );
    await expect(resolveEmailDelivery(suite.db, ring, false)).rejects.toMatchObject({
      code: "venue.not_found",
    });
  });

  it.each(["url", "from"])(
    "refuses an SMTP credential sealed without %s, naming the field",
    async (field) => {
      await seedVenue(suite.db, { name: "Bar & Kitchen" });
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

describe("invoice email routing", () => {
  it.each([
    ["demo", false, false, "local_capture"],
    ["demo", false, true, "local_capture"],
    ["prepare", false, false, "unconfigured"],
    ["prepare", false, true, "smtp"],
    ["live", false, false, "unconfigured"],
    ["live", false, true, "smtp"],
    [undefined, false, false, "unconfigured"],
    [undefined, false, true, "smtp"],
    ["demo", true, false, "local_capture"],
    ["demo", true, true, "local_capture"],
    ["prepare", true, false, "local_capture"],
    ["prepare", true, true, "local_capture"],
    ["live", true, false, "local_capture"],
    ["live", true, true, "local_capture"],
    [undefined, true, false, "local_capture"],
    [undefined, true, true, "local_capture"],
  ] as const)(
    "routes intent=%s development=%s configured=%s to %s",
    async (intent, devMode, configured, mode) => {
      await seedVenue(suite.db, { name: "Bar & Kitchen" });
      if (configured) {
        await withTransaction(suite.db, (tx) =>
          putCredential(tx, ring, {
            purpose: "email.smtp",
            value: { url: "smtps://smtp.example.test:465", from: "Venue <venue@example.test>" },
          }),
        );
      }
      await expect(
        resolveInvoiceEmailDelivery(suite.db, ring, { onboardingIntent: intent, devMode }),
      ).resolves.toEqual(
        mode === "unconfigured"
          ? { mode }
          : {
              mode,
              smtp:
                mode === "smtp"
                  ? {
                      url: "smtps://smtp.example.test:465",
                      from: { name: "Bar & Kitchen", address: "venue@example.test" },
                    }
                  : { url: "smtp://127.0.0.1:1025", from: "Waitron <no-reply@waitron.test>" },
            },
      );
    },
  );

  it("captures demo invoice mail without changing the account-mail gateway", async () => {
    await seedVenue(suite.db, { name: "Bar & Kitchen" });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "email.smtp",
        value: { url: "smtps://smtp.example.test:465", from: "Venue <venue@example.test>" },
      }),
    );
    expect(
      (
        await resolveInvoiceEmailDelivery(suite.db, ring, {
          onboardingIntent: "demo",
          devMode: false,
        })
      ).mode,
    ).toBe("local_capture");
    expect((await resolveEmailDelivery(suite.db, ring, true)).mode).toBe("smtp");
  });

  it("uses new SMTP settings on the next invoice resolution", async () => {
    await seedVenue(suite.db, { name: "Bar & Kitchen" });
    const mode = { onboardingIntent: "live" as const, devMode: false };
    expect(await resolveInvoiceEmailDelivery(suite.db, ring, mode)).toEqual({
      mode: "unconfigured",
    });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "email.smtp",
        value: { url: "smtps://new.example.test:465", from: "New <new@example.test>" },
      }),
    );
    expect(await resolveInvoiceEmailDelivery(suite.db, ring, mode)).toEqual({
      mode: "smtp",
      smtp: {
        url: "smtps://new.example.test:465",
        from: { name: "Bar & Kitchen", address: "new@example.test" },
      },
    });
  });
});
