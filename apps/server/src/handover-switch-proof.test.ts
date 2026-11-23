import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withFoldedPersonChanges,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedPerson, seedVenue } from "@waitron/db/testing/seed.js";
import { signEnvelope } from "@waitron/handover";
import { persons } from "@waitron/identity";
import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { NODE_MIGRATIONS, setNodeMode } from "@waitron/node-db";
import { isAppError } from "@waitron/shared";
import type { Context } from "hono";
import { signAsThisBox } from "./handover-signing.js";
import {
  SWITCH_PROOF_TTL_MS,
  checkSwitchProof,
  createSwitchChallenges,
  keepSwitchSignInAlive,
  makeSwitchProof,
} from "./handover-switch-proof.js";
import { establishNodeIdentity } from "./node-identity.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NOW = Date.parse("2026-11-15T10:00:00Z");

const box = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });

let nodeId: string;
let personId: string;
let now: number;
const deps = () => ({ db: box.db, node: box.node, ring: RING, nodeId, now: () => now });

beforeEach(async () => {
  now = NOW;
  await seedVenue(box.db);
  nodeId = await seedNode(box.db);
  await stampDeployment(box.db, "preproduction");
  await establishNodeIdentity({ ownerDb: box.db, node: box.node, ring: RING }, nodeId);
  await setNodeMode({ venue: box.db, node: box.node }, nodeId, "mirror", "adopt");
  personId = await seedPerson(box.db);
  await setBuiltInRoleForTest(box.db, personId, "admin");
});

/** The refusal's log-only reason, or "accepted". */
async function verdictOf(proof: string | null): Promise<string> {
  try {
    expect(await checkSwitchProof(deps(), proof)).toEqual({ personId });
    return "accepted";
  } catch (error) {
    if (!isAppError(error)) throw error;
    // Refused exactly as a wrong password is: the same code and no params.
    expect(error.code).toBe("password.invalid");
    expect(error.params).toEqual({});
    return error.reason ?? "no reason";
  }
}

const encode = (envelope: unknown) => Buffer.from(JSON.stringify(envelope)).toString("base64url");

describe("checking a switch proof", () => {
  it("accepts a proof this box made for an active person who holds node.manage", async () => {
    expect(await verdictOf(await makeSwitchProof(deps(), personId))).toBe("accepted");
  });

  it("accepts it until its 15 minutes are up, and refuses it after", async () => {
    const proof = await makeSwitchProof(deps(), personId);
    now = NOW + SWITCH_PROOF_TTL_MS - 1;
    expect(await verdictOf(proof)).toBe("accepted");
    now = NOW + SWITCH_PROOF_TTL_MS;
    expect(await verdictOf(proof)).toBe("expired");
    expect(SWITCH_PROOF_TTL_MS).toBe(15 * 60_000);
  });

  it("refuses a proof the other box signed, under its own name or this box's", async () => {
    const other = { ...generateNodeKeyPair(), nodeId: "22222222-2222-4222-8222-222222222222" };
    const body = { personId, nodeId, expiresAtMs: NOW + SWITCH_PROOF_TTL_MS };
    expect(await verdictOf(encode(signEnvelope("switch-proof", body, other)))).toBe("not_this_box");
    expect(await verdictOf(encode(signEnvelope("switch-proof", body, { ...other, nodeId })))).toBe(
      "not_this_box",
    );
  });

  it("refuses a proof once this box is no longer a spare", async () => {
    const proof = await makeSwitchProof(deps(), personId);
    await setNodeMode({ venue: box.db, node: box.node }, nodeId, "primary", "promote");
    expect(await verdictOf(proof)).toBe("not_a_spare");
  });

  it("refuses a proof for a person who no longer holds node.manage", async () => {
    const proof = await makeSwitchProof(deps(), personId);
    await setBuiltInRoleForTest(box.db, personId, "staff");
    expect(await verdictOf(proof)).toBe("not_permitted");
  });

  it("refuses a proof for a person who is not active", async () => {
    const proof = await makeSwitchProof(deps(), personId);
    await box.db
      .update(persons)
      .set(withFoldedPersonChanges({ status: "suspended" }))
      .where(eq(persons.id, personId));
    expect(await verdictOf(proof)).toBe("not_permitted");
  });

  it.each(["status", "query"] as const)(
    "refuses a %s message this same box signed",
    async (kind) => {
      const body = { personId, nodeId, expiresAtMs: NOW + SWITCH_PROOF_TTL_MS };
      expect(await verdictOf(encode(await signAsThisBox(deps(), kind, body)))).toBe("wrong_kind");
    },
  );

  it.each([
    [null, "missing"],
    ["", "missing"],
    ["not-base64-json", "malformed"],
    [encode({ purpose: "x" }), "malformed"],
  ])("refuses a missing or unreadable proof (%s)", async (proof, reason) => {
    expect(await verdictOf(proof)).toBe(reason);
  });
});

describe("the switch's passkey challenges", () => {
  it("holds no more than 32 however many are asked for at once", async () => {
    const challenges = createSwitchChallenges();
    const made = await Promise.all(
      Array.from({ length: 40 }, () => challenges.make("spare.example")),
    );
    expect(made.filter((options) => challenges.live(options.challenge))).toHaveLength(32);
  });
});

describe("keeping a switch sign-in alive while the spare catches up", () => {
  it("passes on a failure that is not a refusal", async () => {
    const proof = await makeSwitchProof({ ...deps(), now: Date.now }, personId);
    const failing = {
      select: () => {
        throw new Error("synthetic read failure");
      },
    } as unknown as Database;
    const sw = {
      node: box.node,
      ring: RING,
      nodeId,
      rpId: "spare.example",
      origin: "https://spare.example",
      challenges: createSwitchChallenges(),
    };
    await expect(
      keepSwitchSignInAlive({} as Context, sw, failing, { kind: "proof", proof }),
    ).rejects.toThrow("synthetic read failure");
  });
});
