import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  isPairingV4Profile,
  pairingPayload,
  pairingV4Payload,
  pairingVenueName,
  verifyPairingProof,
  verifyPairingV4Proof,
  PairingError,
  PAIRING_VENUE_NAME_MAX,
  type PairingClaims,
  type PairingV4Claims,
} from "../index.js";
const keys = generateKeyPairSync("ed25519");
const now = 1_800_000_000_000;
const claims: PairingClaims = {
  origin: "https://cloud.example.test",
  action: "start",
  requestId: "12345678-1234-4234-8234-123456789abc",
  venueId: "22345678-1234-4234-8234-123456789abc",
  publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
  environment: "test",
  code: "12345678",
  organisationId: "",
  legalBusinessId: "",
  issuedAt: now,
  venueName: "Bar Pepe",
};
const proof = (c = claims) => {
  const bytes = pairingPayload(c);
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, keys.privateKey).toString("base64url"),
  };
};
const check = (p = proof(), origin = claims.origin, action = "start", at = now) =>
  verifyPairingProof(p.payload, p.signature, origin, action, at);
const signed = (value: unknown) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, keys.privateKey).toString("base64url"),
  };
};
it("encodes the literal v3 fields and binds every signed field", () => {
  expect(pairingPayload(claims).toString()).toBe(
    JSON.stringify([
      "waitron-cloud-pair-v3",
      claims.origin,
      "start",
      claims.requestId,
      claims.publicKey,
      claims.venueId,
      "test",
      "12345678",
      "",
      "",
      now,
      "Bar Pepe",
    ]),
  );
  expect(check()).toEqual(claims);
  for (const changed of [
    { requestId: randomUUID() },
    { code: "87654321" },
    { venueId: randomUUID() },
    { environment: "production" as const },
    { venueName: "Bar Pepa" },
  ])
    expect(() =>
      check({ ...proof({ ...claims, ...changed }), signature: proof().signature }),
    ).toThrow(PairingError);
  expect(() => check(proof(), "https://other.test")).toThrow(PairingError);
  expect(() => check(proof(), claims.origin, "complete")).toThrow(PairingError);
});
it.each([-60000, 60000])("accepts the inclusive %i ms clock allowance", (delta) =>
  expect(check(proof({ ...claims, issuedAt: now + delta }))).toEqual({
    ...claims,
    issuedAt: now + delta,
  }),
);
it("enforces the 4096-character encoded payload limit with a matching origin", () => {
  const value = { ...claims, origin: `https://${"a".repeat(2834)}.test` };
  const boundary = proof(value);
  expect(boundary.payload).toHaveLength(4096);
  expect(check(boundary, value.origin)).toEqual(value);
  const oversized = { ...value, origin: value.origin + "a" };
  const envelope = proof(oversized);
  expect(envelope.payload).toHaveLength(4098);
  expect(() => check(envelope, oversized.origin)).toThrow(PairingError);
});
it.each([
  { issuedAt: now - 60001 },
  { issuedAt: now + 60001 },
  { issuedAt: 1.5 },
  { requestId: "bad" },
  { venueId: "bad" },
  { code: "123" },
  { organisationId: randomUUID() },
  { publicKey: "a".repeat(129) },
  { environment: "dev" },
  { venueName: " Bar Pepe" },
  { venueName: "Bar Pepe\n" },
  { venueName: "😀".repeat(121) },
])("refuses invalid claims %j", (changed) =>
  expect(() => check(proof({ ...claims, ...changed } as PairingClaims))).toThrow(PairingError),
);
it("refuses malformed, noncanonical and differently signed envelopes", () => {
  for (const value of [
    [],
    {},
    ["v2"],
    [...JSON.parse(pairingPayload(claims).toString()), "extra"],
    [...JSON.parse(pairingPayload(claims).toString()).slice(0, 11), 5],
    [...JSON.parse(pairingPayload(claims).toString()).slice(0, 11), null],
  ]) {
    const bytes = Buffer.from(JSON.stringify(value));
    expect(() =>
      check({
        payload: bytes.toString("base64url"),
        signature: sign(null, bytes, keys.privateKey).toString("base64url"),
      }),
    ).toThrow(PairingError);
  }
  expect(() => check({ ...proof(), payload: proof().payload + "=" })).toThrow(PairingError);
  expect(() => check({ ...proof(), signature: proof().signature + "=" })).toThrow(PairingError);
  const other = generateKeyPairSync("ed25519");
  expect(() =>
    check({
      ...proof(),
      signature: sign(null, pairingPayload(claims), other.privateKey).toString("base64url"),
    }),
  ).toThrow(PairingError);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
  expect(() =>
    check(
      proof({
        ...claims,
        publicKey: rsa.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      }),
    ),
  ).toThrow(PairingError);
});
it("requires empty status choices and complete business identifiers", () => {
  const status = { ...claims, action: "status" as const, code: "", venueName: "" };
  expect(check(proof(status), claims.origin, "status")).toEqual(status);
  expect(() => check(proof({ ...status, code: "12345678" }), claims.origin, "status")).toThrow(
    PairingError,
  );
  const complete = {
    ...status,
    action: "complete" as const,
    organisationId: randomUUID(),
    legalBusinessId: randomUUID(),
  };
  expect(check(proof(complete), claims.origin, "complete")).toEqual(complete);
  expect(() => check(proof({ ...status, venueName: "Bar Pepe" }), claims.origin, "status")).toThrow(
    PairingError,
  );
  expect(() =>
    check(proof({ ...complete, venueName: "Bar Pepe" }), claims.origin, "complete"),
  ).toThrow(PairingError);
  for (const key of ["organisationId", "legalBusinessId"])
    expect(() => check(proof({ ...complete, [key]: "" }), claims.origin, "complete")).toThrow(
      PairingError,
    );
});

it("rejects a supported-size non-Ed25519 key and checks the default clock", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() =>
    check(
      proof({
        ...claims,
        publicKey: ec.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      }),
    ),
  ).toThrow(PairingError);
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const stale = proof({ ...claims, issuedAt: now - 60001 });
    expect(() =>
      verifyPairingProof(stale.payload, stale.signature, claims.origin, "start"),
    ).toThrow(PairingError);
  } finally {
    vi.restoreAllMocks();
  }
});

it("refuses an unpadded base64 alias of an otherwise valid signature", () => {
  const value = proof(),
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const alias =
    value.signature.slice(0, -1) + alphabet[alphabet.indexOf(value.signature.at(-1)!) + 1];
  expect(Buffer.from(alias, "base64url").equals(Buffer.from(value.signature, "base64url"))).toBe(
    true,
  );
  expect(() => check({ ...value, signature: alias })).toThrow(PairingError);
});

it("accepts a new venue without an id or name and refuses signed v1 and v2 requests", () => {
  const fresh = { ...claims, venueId: "", venueName: "" };
  expect(check(proof(fresh))).toEqual(fresh);
  const v2 = JSON.parse(pairingPayload(claims).toString()).slice(0, 11);
  v2[0] = "waitron-cloud-pair-v2";
  expect(() => check(signed(v2))).toThrow(PairingError);
  expect(() => check(signed(["waitron-cloud-pair-v1", ...v2.slice(1)]))).toThrow(PairingError);
});

it("accepts a name of 120 code points and refuses 121", () => {
  const longest = { ...claims, venueName: "😀".repeat(PAIRING_VENUE_NAME_MAX) };
  expect(longest.venueName).toHaveLength(240);
  expect(check(proof(longest))).toEqual(longest);
  const longer = { ...claims, venueName: `${longest.venueName}a` };
  expect(() => check(proof(longer))).toThrow(PairingError);
});

it("trims a venue name and keeps at most 120 code points", () => {
  expect(PAIRING_VENUE_NAME_MAX).toBe(120);
  expect(pairingVenueName("  Bar Pepe \t")).toBe("Bar Pepe");
  expect(pairingVenueName("   ")).toBe("");
  expect(pairingVenueName("😀".repeat(121))).toBe("😀".repeat(120));
  expect(pairingVenueName(` ${"a".repeat(119)} b`)).toBe("a".repeat(119));
  expect(pairingVenueName("a".repeat(120))).toBe("a".repeat(120));
});

const state = Buffer.alloc(32, 1).toString("base64url");
const challenge = Buffer.alloc(32, 2).toString("base64url");
const code = Buffer.alloc(32, 3).toString("base64url");
const verifier = Buffer.alloc(32, 4).toString("base64url");
const callback = "https://box.example.test/cloud/pairing/callback";
const profile = [
  "ES",
  "Bar Pepe",
  ["High Street", "", "12345", "Madrid", ""],
  "",
  "Bar Pepe Ltd",
] as const;
const v4 = {
  origin: claims.origin,
  requestId: claims.requestId,
  publicKey: claims.publicKey,
  issuedAt: now,
};
const complete: PairingV4Claims = { ...v4, action: "complete", args: profile };
const v4Vector = (action: string, args: unknown, issuedAt = now) => [
  "waitron-cloud-pair-v4",
  v4.origin,
  action,
  v4.requestId,
  v4.publicKey,
  "test",
  issuedAt,
  args,
];
const checkV4 = (
  envelope: ReturnType<typeof signed>,
  action: PairingV4Claims["action"] = "complete",
  origin = v4.origin,
) => verifyPairingV4Proof(envelope.payload, envelope.signature, origin, action, now);

it.each([
  { action: "start", args: [callback, state, challenge] },
  { action: "redeem", args: [code, verifier] },
  { action: "status", args: [] },
  { action: "complete", args: profile },
] satisfies Omit<PairingV4Claims, keyof typeof v4>[])(
  "signs and verifies the v4 $action tuple",
  (request) => {
    const vector = v4Vector(request.action, request.args);
    const value = { ...v4, ...request } as PairingV4Claims;
    expect(pairingV4Payload(value).toString()).toBe(JSON.stringify(vector));
    expect(checkV4(signed(vector), request.action)).toEqual(value);
  },
);

it("binds a v4 proof to its payload, destination and action", () => {
  const envelope = signed(v4Vector("complete", profile));
  const changed = signed(v4Vector("complete", ["ES", "Other venue", ...profile.slice(2)]));
  expect(() => checkV4({ ...changed, signature: envelope.signature })).toThrow(PairingError);
  expect(() => checkV4(envelope, "complete", "https://other.example.test")).toThrow(PairingError);
  expect(() => checkV4(envelope, "status")).toThrow(PairingError);
});

it("refuses a signed action outside the v4 contract", () => {
  const envelope = signed(v4Vector("approve", []));
  expect(() =>
    verifyPairingV4Proof(envelope.payload, envelope.signature, v4.origin, "approve", now),
  ).toThrow(PairingError);
});

it("refuses a non-list in place of the signed v4 argument tuple", () => {
  expect(() => checkV4(signed(v4Vector("status", {})), "status")).toThrow(PairingError);
  expect(() => checkV4(signed(v4Vector("status", "")), "status")).toThrow(PairingError);
});

it("refuses expired, noncanonical and cross-version proofs", () => {
  const vector = v4Vector("complete", profile);
  const envelope = signed(vector);
  expect(checkV4(signed(v4Vector("complete", profile, now - 60000))).issuedAt).toBe(now - 60000);
  expect(() => checkV4(signed(v4Vector("complete", profile, now - 60001)))).toThrow(PairingError);
  expect(checkV4(signed(v4Vector("complete", profile, now + 60000))).issuedAt).toBe(now + 60000);
  expect(() => checkV4(signed(v4Vector("complete", profile, now + 60001)))).toThrow(PairingError);
  expect(() => checkV4({ ...envelope, payload: envelope.payload + "=" })).toThrow(PairingError);
  expect(() => checkV4(proof(), "start")).toThrow(PairingError);
  expect(() => check(signed(v4Vector("start", [callback, state, challenge])))).toThrow(
    PairingError,
  );
  const bytes = Buffer.from(JSON.stringify(vector, null, 1));
  expect(() =>
    checkV4({
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, keys.privateKey).toString("base64url"),
    }),
  ).toThrow(PairingError);
});

it("refuses a non-UUID request or a timestamp sent as text", () => {
  const malformedId = v4Vector("status", []);
  malformedId[3] = "not-a-uuid";
  const malformedTime = v4Vector("status", []);
  malformedTime[6] = String(now);
  expect(() => checkV4(signed(malformedId), "status")).toThrow(PairingError);
  expect(() => checkV4(signed(malformedTime), "status")).toThrow(PairingError);
  expect(() => checkV4(signed(v4Vector("status", [], now + 0.5)), "status")).toThrow(PairingError);
});

it("refuses non-Ed25519 and noncanonical keys even with valid signatures", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 512 });
  const wrongKey = v4Vector("status", []);
  wrongKey[4] = rsa.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const bytes = Buffer.from(JSON.stringify(wrongKey));
  expect(() =>
    checkV4(
      {
        payload: bytes.toString("base64url"),
        signature: sign(null, bytes, rsa.privateKey).toString("base64url"),
      },
      "status",
    ),
  ).toThrow(PairingError);
  const trailingByte = v4Vector("status", []);
  trailingByte[4] = Buffer.concat([Buffer.from(v4.publicKey, "base64url"), Buffer.of(0)]).toString(
    "base64url",
  );
  expect(() => checkV4(signed(trailingByte), "status")).toThrow(PairingError);
});

it.each([
  ["start", ["", state, challenge]],
  ["start", ["https://box.example.test/a\tb", state, challenge]],
  ["start", [callback, state.slice(1), challenge]],
  ["start", [callback, state, challenge + "="]],
  ["start", [callback, state, challenge, ""]],
  ["redeem", [code.slice(0, -1) + "x", verifier]],
  ["redeem", [code, verifier.slice(1)]],
  ["redeem", [code, verifier, ""]],
  ["status", [state]],
  ["complete", profile.slice(1)],
  ["complete", [...profile, ""]],
] as const)("refuses malformed v4 %s arguments %j", (action, args) =>
  expect(() => checkV4(signed(v4Vector(action, args)), action)).toThrow(PairingError),
);

it.each([
  ["es", profile[1], profile[2], "", profile[4]],
  [["ES"], profile[1], profile[2], "", profile[4]],
  ["ES", "", profile[2], "", profile[4]],
  ["ES", "😀".repeat(121), profile[2], "", profile[4]],
  ["ES", profile[1], ["Only a street"], "", profile[4]],
  ["ES", profile[1], [...profile[2], ""], "", profile[4]],
  ["ES", profile[1], "abcde", "", profile[4]],
  ["ES", profile[1], ["a".repeat(201), "", "", "", ""], "", profile[4]],
  ["ES", profile[1], ["", "", "a".repeat(21), "", ""], "", profile[4]],
  ["ES", profile[1], ["", "", "", "", "a".repeat(101)], "", profile[4]],
  ["ES", profile[1], profile[2], "a".repeat(33), profile[4]],
  ["ES", profile[1], profile[2], "😀".repeat(17), profile[4]],
  ["ES", profile[1], profile[2], "", "😀".repeat(101)],
  ["ES", profile[1], profile[2], "", "a".repeat(201)],
  ["ES", profile[1], profile[2], "", ""],
  ["ES", " Bar Pepe", profile[2], "", profile[4]],
  ["ES", "Bar \ud800 Pepe", profile[2], "", profile[4]],
  ["ES", profile[1], profile[2], "A\tB", profile[4]],
  ["ES", profile[1], profile[2], "", "A\u2028B"],
  ["ES", profile[1], profile[2], "", "A\u2029B"],
])("refuses invalid v4 completion fields %j", (...args) =>
  expect(() => checkV4(signed(v4Vector("complete", args)))).toThrow(PairingError),
);

it("accepts a completion at the field limits within the total cap", () => {
  const args = [
    "ES",
    "😀".repeat(120),
    ["a".repeat(200), "b".repeat(200), "c".repeat(20), "d".repeat(200), "e".repeat(100)],
    "f".repeat(32),
    "😀".repeat(100),
  ] as const;
  expect(checkV4(signed(v4Vector("complete", args)))).toEqual({ ...complete, args });
});

it("accepts a completion with maximum UTF-8 bytes in each text field", () => {
  const codePoint = "𠮷";
  const codeUnit = "\u4e2d";
  const args = [
    "ES",
    codePoint.repeat(120),
    [
      codePoint.repeat(200),
      codePoint.repeat(200),
      codePoint.repeat(20),
      codePoint.repeat(200),
      codePoint.repeat(100),
    ],
    codeUnit.repeat(32),
    codeUnit.repeat(200),
  ] as const;
  const envelope = signed(v4Vector("complete", args));
  expect(envelope.payload.length).toBeGreaterThan(4096);
  expect(checkV4(envelope)).toEqual({ ...complete, args });
});

it("accepts a business profile on its own and refuses one without a legal name", () => {
  expect(isPairingV4Profile(profile)).toBe(true);
  expect(isPairingV4Profile(["ES", profile[1], profile[2], profile[3], ""])).toBe(false);
});

it("accepts exactly 8192 encoded characters and refuses a larger proof", () => {
  const base = v4Vector("start", [callback, state, challenge]);
  const filler = "a".repeat(6144 - Buffer.byteLength(JSON.stringify(base)));
  const boundary = [callback + filler, state, challenge];
  const envelope = signed(v4Vector("start", boundary));
  expect(envelope.payload).toHaveLength(8192);
  expect(checkV4(envelope, "start").args).toEqual(boundary);
  expect(() =>
    checkV4(signed(v4Vector("start", [callback + filler + "a", state, challenge])), "start"),
  ).toThrow(PairingError);
});
