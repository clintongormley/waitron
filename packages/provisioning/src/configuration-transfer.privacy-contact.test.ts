import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { appliedSchemaVersion, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { applyHistoricalTestVenue } from "../test/allocated-venue.js";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request, PASSWORD } from "../test/first-setup-request.js";
import {
  buildConfigurationBundle,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { savePrivacyContact } from "./privacy-contact.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const passphrase = "SYNTHETIC transfer passphrase";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function exported(prepare?: () => Promise<void>): Promise<ConfigurationBundle> {
  const modules = enabledModules(
    ALL_MODULES,
    venueFiscalSelection(ALL_MODULES, "ES-common").config,
  );
  const versions: Record<string, number> = {};
  for (const module of modules)
    versions[module.name] = await appliedSchemaVersion(suite.db, module.migrations);
  const seeded = await applyHistoricalTestVenue(
    planVenue(
      {
        ...request,
        admin: {
          displayName: request.admin.displayName,
          email: request.admin.email,
          pinHash: hashPin(request.admin.pin),
          passwordHash: hashPassword(PASSWORD),
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
  await prepare?.();
  return buildConfigurationBundle(suite.db, seeded, modules, new Date(), versions);
}

function withContact(privacyContact: ConfigurationBundle["privacyContact"]): ConfigurationBundle {
  return { ...configurationBundle(), privacyContact };
}

it("exports the stored privacy contact at the top level, never inside the venue", async () => {
  const bundle = await exported(async () => {
    await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, {
        privacyNoticeUrl: "https://example.com/privacy",
        privacyEmail: "privacy@example.com",
      }),
    );
  });
  expect(bundle.version).toBe(9);
  expect(bundle.privacyContact).toEqual({
    privacyNoticeUrl: "https://example.com/privacy",
    privacyEmail: "privacy@example.com",
  });
  for (const holder of [bundle.venue, bundle.venue.location]) {
    expect(holder).not.toHaveProperty("privacyNoticeUrl");
    expect(holder).not.toHaveProperty("privacyEmail");
  }
});

it("exports an unset privacy contact as two nulls", async () => {
  expect((await exported()).privacyContact).toEqual({ privacyNoticeUrl: null, privacyEmail: null });
});

it("keeps the privacy contact through encoding and decoding", () => {
  const bundle = configurationBundle();
  expect(
    decodeConfigurationBundle(encodeConfigurationBundle(bundle, passphrase), passphrase),
  ).toEqual(bundle);
});

it.each([
  { privacyNoticeUrl: "", privacyEmail: null },
  { privacyNoticeUrl: "   ", privacyEmail: "privacy@example.com" },
])("accepts a privacy contact the Privacy card accepts: %j", (privacyContact) => {
  expect(() => validateConfigurationBundle(withContact(privacyContact), [], {})).not.toThrow();
});

it.each([
  {
    privacyContact: { privacyNoticeUrl: "example.com/privacy", privacyEmail: null },
    params: { field: "privacyNoticeUrl", reason: "web_address" },
  },
  {
    privacyContact: { privacyNoticeUrl: null, privacyEmail: "privacy@example" },
    params: { field: "privacyEmail", reason: "email" },
  },
  {
    privacyContact: { privacyNoticeUrl: "example.com/privacy", privacyEmail: "privacy@example" },
    params: { field: "privacyNoticeUrl", reason: "web_address" },
  },
])("refuses a privacy contact the Privacy card refuses: $params", ({ privacyContact, params }) => {
  let thrown: unknown;
  try {
    validateConfigurationBundle(withContact(privacyContact), [], {});
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code: "venue.detail_invalid" });
  expect((thrown as { params: unknown }).params).toEqual(params);
});
