import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { checkPin, verifyPersonCredential, verifyThrottledCredential } from "./credential.js";
import { loginWithPin } from "./login.js";
import { authorize } from "./authorize.js";
import { createPinThrottle } from "./pin-throttle.js";
import type { SecretCheck } from "./secret-check.js";
import { hashPin, verifyPin } from "./verify-pin.js";
import { hashPassword, verifyPassword } from "./verify-password.js";
import { checkManagerPassword, loginManager, loginManagerById } from "./manager-login.js";
import { changeOwnPassword, checkOwnPassword, verifyOwnCredentials } from "./profile.js";
import { beginGoogleLink } from "./google-oidc.js";
import { startManagementSession } from "./management-session.js";
import { encryptTotpSecret } from "./mfa.js";
import {
  codeOf,
  openSession,
  refusalOf,
  seedManager,
  seedPerson,
  seedTill,
  TOTP_KEY_RING,
} from "../test/fixtures.js";

// Spy on both verifiers while delegating to the real KDF, so every key derivation is counted.
vi.mock("./verify-pin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify-pin.js")>();
  return { ...actual, verifyPin: vi.fn(actual.verifyPin) };
});
vi.mock("./verify-password.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify-password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`: `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter
// refuses it.
function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** On the next turn of the event loop, commit a write transaction and record "writer" once it has. */
function writeOnNextTurn(order: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      withTransaction(suite.db, (tx) => tx.execute(sql`select 1`))
        .then(() => {
          order.push("writer");
          resolve();
        })
        .catch(reject);
    });
  });
}

async function setPin(personId: string, pin: string): Promise<void> {
  await run((tx) =>
    tx.execute(sql`update persons set pin_hash = ${hashPin(pin)} where id = ${personId}`),
  );
}

async function setStatus(personId: string, status: "active" | "suspended"): Promise<void> {
  await run((tx) => tx.execute(sql`update persons set status = ${status} where id = ${personId}`));
}

async function setPassword(personId: string, password: string | null): Promise<void> {
  const hash = password === null ? null : hashPassword(password);
  await run((tx) =>
    tx.execute(sql`update persons set password_hash = ${hash} where id = ${personId}`),
  );
}

/** A copy of an issued check with its verdict flipped to a match. */
function forge(check: SecretCheck): SecretCheck {
  return Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(check),
      matches: { value: true, enumerable: true },
    },
  ) as SecretCheck;
}

const pinSpy = vi.mocked(verifyPin);
const passwordSpy = vi.mocked(verifyPassword);

beforeEach(() => {
  pinSpy.mockClear();
  passwordSpy.mockClear();
});

describe("checkPin", () => {
  it("reports a match for the right PIN and none for a wrong one", async () => {
    const personId = await seedPerson(suite.db);

    expect((await checkPin(suite.db, personId, "1234")).matches).toBe(true);
    expect((await checkPin(suite.db, personId, "9999")).matches).toBe(false);
  });

  it("derives one key for an unknown or suspended person, and never reports a match", async () => {
    const suspended = await seedPerson(suite.db, "staff", "suspended");

    for (const personId of [crypto.randomUUID(), suspended]) {
      pinSpy.mockClear();
      const check = await checkPin(suite.db, personId, "timing-equalization-dummy");
      expect(check.matches).toBe(false);
      expect(pinSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("lets another writer commit while it derives the key", async () => {
    const personId = await seedPerson(suite.db);
    const order: string[] = [];
    const checked = checkPin(suite.db, personId, "1234").then(() => order.push("checked"));

    await Promise.all([checked, writeOnNextTurn(order)]);

    expect(order).toEqual(["writer", "checked"]);
  });

  it("cannot be altered once issued, and does not show its PIN when serialised", async () => {
    const personId = await seedPerson(suite.db);
    const check = await checkPin(suite.db, personId, "9999");

    expect(() => {
      (check as { matches: boolean }).matches = true;
    }).toThrow(TypeError);
    expect(JSON.stringify(check)).toBe(JSON.stringify({ personId, matches: false }));
  });
});

describe("verifyPersonCredential with a check", () => {
  it("derives no key inside the transaction when the check matches", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const checked = await checkPin(suite.db, personId, "1234");
    pinSpy.mockClear();

    const cred = await run((tx) => verifyPersonCredential(tx, personId, "1234", checked));

    expect(cred).toEqual({ role: "supervisor", locale: null });
    expect(pinSpy).not.toHaveBeenCalled();
  });

  it("refuses a wrong PIN on its check's word, deriving no key inside the transaction", async () => {
    const personId = await seedPerson(suite.db);
    const checked = await checkPin(suite.db, personId, "9999");
    pinSpy.mockClear();

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "9999", checked)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "wrong_pin" });
    expect(pinSpy).not.toHaveBeenCalled();
  });

  it("refuses a person still suspended without deriving a second key", async () => {
    const personId = await seedPerson(suite.db, "staff", "suspended");
    const checked = await checkPin(suite.db, personId, "1234");
    pinSpy.mockClear();

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "1234", checked)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "suspended" });
    expect(pinSpy).not.toHaveBeenCalled();
  });

  it("does not trust a copy of an issued check, even with its verdict flipped", async () => {
    const personId = await seedPerson(suite.db);
    const genuine = await checkPin(suite.db, personId, "9999");
    const forged = forge(genuine);

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "9999", forged)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "wrong_pin" });
  });

  it("does not trust a check made with a different PIN", async () => {
    const personId = await seedPerson(suite.db);
    const checked = await checkPin(suite.db, personId, "1234");
    pinSpy.mockClear();

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "9999", checked)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "wrong_pin" });
    expect(pinSpy).toHaveBeenCalledTimes(1);
  });

  it("does not stand in for a different person's check", async () => {
    const checkedPerson = await seedPerson(suite.db, "staff", "suspended");
    const otherPerson = crypto.randomUUID();
    const checked = await checkPin(suite.db, checkedPerson, "1234");
    pinSpy.mockClear();

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, otherPerson, "1234", checked)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "unknown_person" });
    expect(pinSpy).toHaveBeenCalledTimes(1);
  });

  it("judges a PIN changed after the check against the new PIN", async () => {
    const personId = await seedPerson(suite.db);
    const oldPin = await checkPin(suite.db, personId, "1234");
    const newPin = await checkPin(suite.db, personId, "5678");
    await setPin(personId, "5678");
    pinSpy.mockClear();

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "1234", oldPin)),
    );
    const cred = await run((tx) => verifyPersonCredential(tx, personId, "5678", newPin));

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "wrong_pin" });
    expect(cred.role).toBe("staff");
    expect(pinSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses the dummy phrase for a person suspended at the check and reactivated before it is used", async () => {
    const personId = await seedPerson(suite.db, "staff", "suspended");
    const checked = await checkPin(suite.db, personId, "timing-equalization-dummy");
    await setStatus(personId, "active");

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "timing-equalization-dummy", checked)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "wrong_pin" });
  });

  it("refuses a person suspended after a matching check, with today's reason", async () => {
    const personId = await seedPerson(suite.db);
    const checked = await checkPin(suite.db, personId, "1234");
    await setStatus(personId, "suspended");

    const refusal = await refusalOf(() =>
      run((tx) => verifyPersonCredential(tx, personId, "1234", checked)),
    );

    expect(refusal).toEqual({ code: "pin.invalid", params: {}, reason: "suspended" });
  });
});

describe("verifyThrottledCredential with a check", () => {
  it("refuses a throttled person even with a matching check", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const attempts = { throttle: createPinThrottle({ now: () => 1_000_000 }), slot: "s" };
    for (let i = 0; i < 4; i += 1) {
      expect(
        await codeOf(() => run((tx) => verifyThrottledCredential(tx, personId, "9999", attempts))),
      ).toBe("pin.invalid");
    }
    const checked = await checkPin(suite.db, personId, "1234");

    const code = await codeOf(() =>
      run((tx) => verifyThrottledCredential(tx, personId, "1234", attempts, checked)),
    );

    expect(code).toBe("pin.throttled");
  });

  it("escalates concurrent wrong PINs checked beforehand exactly as it does those checked inside", async () => {
    const codesFor = async (precheck: boolean): Promise<string[]> => {
      const personId = await seedPerson(suite.db, "supervisor");
      const attempts = { throttle: createPinThrottle({ now: () => 1_000_000 }), slot: "s" };
      const checks = await Promise.all(
        Array.from({ length: 5 }, () =>
          precheck ? checkPin(suite.db, personId, "9999") : undefined,
        ),
      );
      const codes = await Promise.all(
        checks.map((checked) =>
          codeOf(() =>
            run((tx) => verifyThrottledCredential(tx, personId, "9999", attempts, checked)),
          ),
        ),
      );
      return codes.sort();
    };

    const inside = await codesFor(false);
    const beforehand = await codesFor(true);

    expect(inside).toEqual([
      "pin.invalid",
      "pin.invalid",
      "pin.invalid",
      "pin.invalid",
      "pin.throttled",
    ]);
    expect(beforehand).toEqual(inside);
  });
});

describe("loginWithPin and authorize with a check", () => {
  it("opens a session on a matching check, deriving no key inside the transaction", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);
    const checked = await checkPin(suite.db, personId, "1234");
    pinSpy.mockClear();

    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234", checked }));

    expect(session.personId).toBe(personId);
    expect(pinSpy).not.toHaveBeenCalled();
  });

  it("authorizes an override on its matching check, with or without a wrong-PIN limit", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const supervisorId = await seedPerson(suite.db, "supervisor");
    const sessionId = await openSession(suite.db, tillId, staffId);
    const checked = await checkPin(suite.db, supervisorId, "1234");
    const override = { personId: supervisorId, pin: "1234", checked };
    const attempts = { throttle: createPinThrottle({ now: () => 1_000_000 }), slot: "s" };
    pinSpy.mockClear();

    const plain = await run((tx) =>
      authorize(tx, { sessionId, permission: "sale.void", override }),
    );
    const limited = await run((tx) =>
      authorize(tx, { sessionId, permission: "sale.void", override }, attempts),
    );

    expect(plain.authorizedBy).toBe(supervisorId);
    expect(limited.authorizedBy).toBe(supervisorId);
    expect(pinSpy).not.toHaveBeenCalled();
  });
});

async function manager(): Promise<{ personId: string; email: string }> {
  const email = `mgr-${crypto.randomUUID()}@example.test`;
  return { personId: await seedManager(suite.db, { email }), email };
}

const login = (input: { email: string; password: string; checked?: unknown }) =>
  run((tx) =>
    loginManager(tx, {
      ...input,
      checked: input.checked as Parameters<typeof loginManager>[1]["checked"],
      totpKeyRing: TOTP_KEY_RING,
    }),
  );

describe("checkManagerPassword", () => {
  it("finds the person by email as login does, or by id, and reports whether the password matches", async () => {
    const { personId, email } = await manager();

    const byEmail = await checkManagerPassword(
      suite.db,
      { email: `  ${email.toUpperCase()} ` },
      "correct horse",
    );
    const byId = await checkManagerPassword(suite.db, { personId }, "correct horse");
    const wrong = await checkManagerPassword(suite.db, { email }, "wrong horse");

    expect(byEmail).toEqual({ personId, matches: true });
    expect(byId.matches).toBe(true);
    expect(wrong.matches).toBe(false);
  });

  it("derives one key for an unknown email or a suspended person, and never reports a match", async () => {
    const { personId } = await manager();
    await setStatus(personId, "suspended");

    const unknown = await checkManagerPassword(
      suite.db,
      { email: "nobody@example.test" },
      "timing-equalization-dummy",
    );
    const suspended = await checkManagerPassword(
      suite.db,
      { personId },
      "timing-equalization-dummy",
    );

    expect(unknown).toEqual({ personId: null, matches: false });
    expect(suspended.matches).toBe(false);
    expect(passwordSpy).toHaveBeenCalledTimes(2);
  });

  it("lets another writer commit while it derives the key", async () => {
    const { email } = await manager();
    const order: string[] = [];
    const checked = checkManagerPassword(suite.db, { email }, "correct horse").then(() =>
      order.push("checked"),
    );

    await Promise.all([checked, writeOnNextTurn(order)]);

    expect(order).toEqual(["writer", "checked"]);
  });
});

describe("loginManager and loginManagerById with a check", () => {
  it("sign in on a matching check, deriving no key inside the transaction", async () => {
    const { personId, email } = await manager();
    const byEmail = await checkManagerPassword(suite.db, { email }, "correct horse");
    const byId = await checkManagerPassword(suite.db, { personId }, "correct horse");
    passwordSpy.mockClear();

    const first = await login({ email, password: "correct horse", checked: byEmail });
    const second = await run((tx) =>
      loginManagerById(tx, {
        personId,
        password: "correct horse",
        checked: byId,
        totpKeyRing: TOTP_KEY_RING,
      }),
    );

    expect(first.personId).toBe(personId);
    expect(second.personId).toBe(personId);
    expect(passwordSpy).not.toHaveBeenCalled();
  });

  it("still asks for the authenticator code after a matching check", async () => {
    const { personId, email } = await manager();
    await run((tx) =>
      tx.execute(
        sql`update persons set totp_secret = ${encryptTotpSecret("JBSWY3DPEHPK3PXP", TOTP_KEY_RING.current)} where id = ${personId}`,
      ),
    );
    const checked = await checkManagerPassword(suite.db, { email }, "correct horse");

    expect(await codeOf(() => login({ email, password: "correct horse", checked }))).toBe(
      "totp.required",
    );
  });

  it("refuses an unknown email on its check's word, deriving no second key", async () => {
    const email = `ghost-${crypto.randomUUID()}@example.test`;
    const checked = await checkManagerPassword(suite.db, { email }, "correct horse");
    passwordSpy.mockClear();

    const refusal = await refusalOf(() => login({ email, password: "correct horse", checked }));

    expect(refusal).toEqual({ code: "password.invalid", params: {}, reason: "unknown_account" });
    expect(passwordSpy).not.toHaveBeenCalled();
  });

  it("does not trust a copy of an issued check, even with its verdict flipped", async () => {
    const { email } = await manager();
    const genuine = await checkManagerPassword(suite.db, { email }, "wrong horse");

    const refusal = await refusalOf(() =>
      login({ email, password: "wrong horse", checked: forge(genuine) }),
    );

    expect(refusal).toEqual({ code: "password.invalid", params: {}, reason: "wrong_password" });
  });

  it("does not trust a check made with a different password", async () => {
    const { email } = await manager();
    const checked = await checkManagerPassword(suite.db, { email }, "correct horse");

    const refusal = await refusalOf(() => login({ email, password: "wrong horse", checked }));

    expect(refusal).toEqual({ code: "password.invalid", params: {}, reason: "wrong_password" });
  });

  it("judges a password changed after the check against the new password", async () => {
    const { email, personId } = await manager();
    const oldPassword = await checkManagerPassword(suite.db, { email }, "correct horse");
    const newPassword = await checkManagerPassword(suite.db, { email }, "battery staple");
    await setPassword(personId, "battery staple");

    const refusal = await refusalOf(() =>
      login({ email, password: "correct horse", checked: oldPassword }),
    );
    const session = await login({ email, password: "battery staple", checked: newPassword });

    expect(refusal).toEqual({ code: "password.invalid", params: {}, reason: "wrong_password" });
    expect(session.personId).toBe(personId);
  });

  it("refuses the dummy phrase for a person suspended at the check and reactivated before it is used", async () => {
    const { email, personId } = await manager();
    await setStatus(personId, "suspended");
    const checked = await checkManagerPassword(suite.db, { email }, "timing-equalization-dummy");
    await setStatus(personId, "active");

    const refusal = await refusalOf(() =>
      login({ email, password: "timing-equalization-dummy", checked }),
    );

    expect(refusal).toEqual({ code: "password.invalid", params: {}, reason: "wrong_password" });
  });

  it("refuses a person suspended after a matching check, with today's reason", async () => {
    const { email, personId } = await manager();
    const checked = await checkManagerPassword(suite.db, { email }, "correct horse");
    await setStatus(personId, "suspended");

    const refusal = await refusalOf(() => login({ email, password: "correct horse", checked }));

    expect(refusal).toEqual({ code: "password.invalid", params: {}, reason: "suspended" });
  });
});

async function ownSession(): Promise<{ personId: string; managementSessionId: string }> {
  const { personId } = await manager();
  const session = await run((tx) => startManagementSession(tx, { personId }));
  return { personId, managementSessionId: session.token };
}

describe("checkOwnPassword", () => {
  it("reports whether the person's current password matches", async () => {
    const owner = await ownSession();

    const right = await checkOwnPassword(suite.db, { ...owner, currentPassword: "correct horse" });
    const wrong = await checkOwnPassword(suite.db, { ...owner, currentPassword: "wrong horse" });
    const missing = await checkOwnPassword(suite.db, { ...owner });

    expect(right).toEqual({ personId: owner.personId, matches: true });
    expect(wrong.matches).toBe(false);
    expect(missing.matches).toBe(false);
  });

  it("is not trusted by a change whose session names another person, even one with the same hash", async () => {
    const owner = await ownSession();
    const other = await ownSession();
    await run((tx) =>
      tx.execute(
        sql`update persons set password_hash = (select password_hash from persons where id = ${owner.personId}) where id = ${other.personId}`,
      ),
    );
    const checked = await checkOwnPassword(suite.db, {
      personId: other.personId,
      currentPassword: "correct horse",
    });
    passwordSpy.mockClear();

    const person = await run((tx) =>
      verifyOwnCredentials(tx, {
        ...owner,
        currentPassword: "correct horse",
        checked,
        keyRing: TOTP_KEY_RING,
      }),
    );

    expect(checked.matches).toBe(true);
    expect(person.id).toBe(owner.personId);
    expect(passwordSpy).toHaveBeenCalledTimes(1);
  });

  it("lets another writer commit while it derives the key", async () => {
    const owner = await ownSession();
    const order: string[] = [];
    const checked = checkOwnPassword(suite.db, { ...owner, currentPassword: "correct horse" }).then(
      () => order.push("checked"),
    );

    await Promise.all([checked, writeOnNextTurn(order)]);

    expect(order).toEqual(["writer", "checked"]);
  });

  it("derives no key for a person with no password, whose change is then refused as today", async () => {
    const owner = await ownSession();
    await setPassword(owner.personId, null);

    const checked = await checkOwnPassword(suite.db, {
      ...owner,
      currentPassword: "correct horse",
    });
    const code = await codeOf(() =>
      run((tx) =>
        verifyOwnCredentials(tx, {
          ...owner,
          currentPassword: "correct horse",
          checked,
          keyRing: TOTP_KEY_RING,
        }),
      ),
    );

    expect(checked.matches).toBe(false);
    expect(code).toBe("password.invalid");
    expect(passwordSpy).not.toHaveBeenCalled();
  });
});

describe("the profile changes with a check", () => {
  it("derive no key inside the transaction when the check matches", async () => {
    const owner = await ownSession();
    const checked = await checkOwnPassword(suite.db, {
      ...owner,
      currentPassword: "correct horse",
    });
    passwordSpy.mockClear();

    const person = await run((tx) =>
      verifyOwnCredentials(tx, {
        ...owner,
        currentPassword: "correct horse",
        checked,
        keyRing: TOTP_KEY_RING,
      }),
    );
    const begun = await run((tx) =>
      beginGoogleLink(tx, {
        clientId: "client.apps.googleusercontent.com",
        redirectUri: "https://waitron.example/management-api/google/callback",
        ...owner,
        currentPassword: "correct horse",
        checked,
        keyRing: TOTP_KEY_RING,
      }),
    );

    expect(person.id).toBe(owner.personId);
    expect(begun.state).toEqual(expect.any(String));
    expect(passwordSpy).not.toHaveBeenCalled();
  });

  it("refuse a wrong password on its check's word, deriving no key inside the transaction", async () => {
    const owner = await ownSession();
    const checked = await checkOwnPassword(suite.db, { ...owner, currentPassword: "wrong horse" });
    passwordSpy.mockClear();

    const code = await codeOf(() =>
      run((tx) =>
        verifyOwnCredentials(tx, {
          ...owner,
          currentPassword: "wrong horse",
          checked,
          keyRing: TOTP_KEY_RING,
        }),
      ),
    );

    expect(code).toBe("password.invalid");
    expect(passwordSpy).not.toHaveBeenCalled();
  });

  it("do not trust a copy of an issued check, or one made with a different password", async () => {
    const owner = await ownSession();
    const genuine = await checkOwnPassword(suite.db, { ...owner, currentPassword: "wrong horse" });
    const right = await checkOwnPassword(suite.db, { ...owner, currentPassword: "correct horse" });
    const verify = (currentPassword: string, checked: unknown) =>
      codeOf(() =>
        run((tx) =>
          verifyOwnCredentials(tx, {
            ...owner,
            currentPassword,
            checked: checked as Parameters<typeof verifyOwnCredentials>[1]["checked"],
            keyRing: TOTP_KEY_RING,
          }),
        ),
      );

    expect(await verify("wrong horse", forge(genuine))).toBe("password.invalid");
    expect(await verify("wrong horse", right)).toBe("password.invalid");
  });

  it("judge a password changed after the check against the new password", async () => {
    const owner = await ownSession();
    const checked = await checkOwnPassword(suite.db, {
      ...owner,
      currentPassword: "correct horse",
    });
    await run((tx) =>
      changeOwnPassword(tx, {
        ...owner,
        currentPassword: "correct horse",
        password: "battery staple",
        keyRing: TOTP_KEY_RING,
      }),
    );

    const code = await codeOf(() =>
      run((tx) =>
        verifyOwnCredentials(tx, {
          ...owner,
          currentPassword: "correct horse",
          checked,
          keyRing: TOTP_KEY_RING,
        }),
      ),
    );

    expect(code).toBe("password.invalid");
  });

  it("refuse a person suspended after a matching check, as today", async () => {
    const owner = await ownSession();
    const checked = await checkOwnPassword(suite.db, {
      ...owner,
      currentPassword: "correct horse",
    });
    await setStatus(owner.personId, "suspended");

    const code = await codeOf(() =>
      run((tx) =>
        verifyOwnCredentials(tx, {
          ...owner,
          currentPassword: "correct horse",
          checked,
          keyRing: TOTP_KEY_RING,
        }),
      ),
    );

    expect(code).toBe("person.suspended");
  });
});
