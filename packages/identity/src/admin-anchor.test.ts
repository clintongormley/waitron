import {
  CORE_MIGRATIONS,
  persons,
  webauthnCredentials,
  managementSessions,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "../test/person-rows.js";
import { TOTP_KEY_RING } from "../test/fixtures.js";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { assertUsableAdminRemains } from "./admin-anchor.js";
import { readPersonAuthority } from "./authority.js";
import { startManagementSession } from "./management-session.js";
import { updatePersonDetails, deactivatePerson, resetPersonLogin } from "./staff.js";
import { unlinkOwnGoogle, removeOwnPasskey } from "./profile.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const operations = ["demote", "suspend", "reset", "passkey", "google"] as const;

it.each(operations)(
  "refuses %s with only a PIN-only Admin left; permits it with a usable Admin",
  async (operation) => {
    const [target, other] = await seedPersons(suite.db, [
      {
        displayName: "Target",
        firstNames: "Target",
        lastNames: "Person",
        email: "target@example.test",
        role: "admin",
        passwordHash: operation === "passkey" || operation === "google" ? null : "password-hash",
        googleSubject: operation === "google" ? "google-subject" : null,
      },
      { displayName: "Other", role: "admin", pinHash: "pin-only" },
    ]);
    const [key] = await suite.db
      .insert(webauthnCredentials)
      .values({
        personId: target!.id,
        name: "Key",
        credentialId: "credential",
        publicKey: "public-key",
        counter: 0,
        transports: "[]",
        aaguid: "aaguid",
      })
      .returning();
    if (operation !== "passkey") await suite.db.delete(webauthnCredentials);
    const actorId = operation === "passkey" || operation === "google" ? target!.id : other!.id;
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: actorId }),
    );
    await suite.db.update(managementSessions).set({ provedAt: new Date().toISOString() });
    const invoke = () =>
      withTransaction(suite.db, async (tx) => {
        const input = { personId: target!.id, managementSessionId: session.token };
        if (operation === "demote")
          await updatePersonDetails(tx, {
            ...input,
            displayName: "Target",
            firstNames: "Target",
            lastNames: "Person",
            telephone: null,
            email: "target@example.test",
            role: "manager",
            status: "active",
          });
        else if (operation === "suspend") await deactivatePerson(tx, input);
        else if (operation === "reset") await resetPersonLogin(tx, input);
        else if (operation === "passkey")
          await removeOwnPasskey(tx, { ...input, id: key!.id, keyRing: TOTP_KEY_RING });
        else await unlinkOwnGoogle(tx, { ...input, keyRing: TOTP_KEY_RING });
      });
    await expect(invoke()).rejects.toMatchObject({ code: "person.last_admin" });
    const [unchanged] = await suite.db.select().from(persons).where(eq(persons.id, target!.id));
    expect(unchanged).toMatchObject({
      status: "active",
      passwordHash: operation === "passkey" || operation === "google" ? null : "password-hash",
      googleSubject: operation === "google" ? "google-subject" : null,
    });
    if (operation === "passkey")
      expect(await suite.db.select().from(webauthnCredentials)).toHaveLength(1);
    await suite.db
      .update(persons)
      .set({ passwordHash: "other-password" })
      .where(eq(persons.id, other!.id));
    await invoke();
    const [changed] = await suite.db.select().from(persons).where(eq(persons.id, target!.id));
    if (operation === "suspend") expect(changed!.status).toBe("suspended");
    else if (operation === "reset") expect(changed!.status).toBe("pending");
    else if (operation === "google") expect(changed!.googleSubject).toBeNull();
    else if (operation === "passkey")
      expect(await suite.db.select().from(webauthnCredentials)).toEqual([]);
    else {
      expect((await readPersonAuthority(suite.db, target!.id)).admin).toBe(false);
    }
  },
);

it.each(["password", "google", "passkey"])(
  "counts an active Admin with %s and no email",
  async (method) => {
    const [admin] = await seedPersons(suite.db, {
      displayName: "Admin",
      role: "admin",
      passwordHash: method === "password" ? "hash" : null,
      googleSubject: method === "google" ? "google" : null,
    });
    if (method === "passkey")
      await suite.db
        .insert(webauthnCredentials)
        .values({ personId: admin!.id, credentialId: "key", publicKey: "key" });
    await withTransaction(suite.db, (tx) => assertUsableAdminRemains(tx));
  },
);
it.each(["pending", "suspended", "staff", "pin-only"])(
  "does not count a %s person",
  async (kind) => {
    await seedPersons(suite.db, {
      displayName: "Not usable",
      role: kind === "staff" ? "staff" : "admin",
      status: kind === "pending" || kind === "suspended" ? kind : "active",
      passwordHash: kind === "pin-only" ? null : "password",
      pinHash: "pin",
    });
    await expect(
      withTransaction(suite.db, (tx) => assertUsableAdminRemains(tx)),
    ).rejects.toMatchObject({ code: "person.last_admin" });
  },
);
