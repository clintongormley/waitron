import { Buffer } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  HOST_LINE_MAX,
  HOST_VERBS,
  PERSON_ID_MAX,
  SHELL_VERBS,
  VERB_PERMISSION,
  formatHostRequest,
  parseHostRequest,
} from "./host-protocol.mjs";

const person = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" };
const server = { source: "server" };

const PERSON = '{"source":"person","person":"0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11"}';
const SERVER = '{"source":"server"}';

/** @param {string} verb @param {string} objectText */
const line = (verb, objectText) => `${verb} ${objectText}`;

/** @param {unknown} value */
const reasonOf = (value) => parseHostRequest(value);

const JOIN_FIELDS =
  '"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false';

/** @type {Array<import("vitest").MockInstance>} */
let spies = [];

beforeAll(() => {
  spies = [
    vi.spyOn(console, "log"),
    vi.spyOn(console, "error"),
    vi.spyOn(process.stdout, "write"),
    vi.spyOn(process.stderr, "write"),
  ];
});

afterEach(() => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

afterAll(() => {
  for (const spy of spies) spy.mockRestore();
});

describe("the lists", () => {
  it("names the host's verbs and the shell's, apart, and freezes both", () => {
    expect(HOST_VERBS).toEqual([
      "network.read",
      "network.scan",
      "network.join",
      "network.forget",
      "screen.read",
      "screen.set",
      "tag.write",
    ]);
    expect(SHELL_VERBS).toEqual(["clock.status", "clock.set"]);
    expect(HOST_VERBS.filter((verb) => SHELL_VERBS.includes(verb))).toEqual([]);
    expect(Object.isFrozen(HOST_VERBS)).toBe(true);
    expect(Object.isFrozen(SHELL_VERBS)).toBe(true);
  });

  it("treats first-start.status like any unknown verb", () => {
    expect(parseHostRequest(line("first-start.status", `{"actor":${SERVER}}`))).toEqual({
      ok: false,
      reason: "unknown_request",
    });
  });

  it("names system.manage for each verb a person may ask, and nothing for tag.write", () => {
    expect(VERB_PERMISSION).toEqual({
      "network.read": "system.manage",
      "network.scan": "system.manage",
      "network.join": "system.manage",
      "network.forget": "system.manage",
      "screen.read": "system.manage",
      "screen.set": "system.manage",
    });
    expect(Object.hasOwn(VERB_PERMISSION, "tag.write")).toBe(false);
    expect(Object.isFrozen(VERB_PERMISSION)).toBe(true);
  });

  it("holds the limits", () => {
    expect(HOST_LINE_MAX).toBe(4096);
    expect(PERSON_ID_MAX).toBe(64);
  });
});

const ACCEPTED_FIELDLESS = [
  ["network.read", person, `{"actor":${PERSON}}`],
  ["network.read", server, `{"actor":${SERVER}}`],
  ["network.scan", person, `{"actor":${PERSON}}`],
  ["screen.read", person, `{"actor":${PERSON}}`],
  ["screen.read", server, `{"actor":${SERVER}}`],
];

const ACCEPTED_WITH_FIELDS = [
  [
    "network.join",
    `{${JOIN_FIELDS},"actor":${PERSON}}`,
    { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: false },
    person,
  ],
  [
    "network.forget",
    `{"ssidHex":"4361666550657065","actor":${PERSON}}`,
    { ssidHex: "4361666550657065" },
    person,
  ],
  ["screen.set", `{"start":"dashboard","actor":${PERSON}}`, { start: "dashboard" }, person],
  [
    "tag.write",
    `{"tag":{"name":"Bar Pepe","live":true},"actor":${SERVER}}`,
    { tag: { name: "Bar Pepe", live: true } },
    server,
  ],
  ["tag.write", `{"tag":null,"actor":${SERVER}}`, { tag: null }, server],
];

describe("accepted lines", () => {
  it("answers the exact frozen request for network.read by a person", () => {
    const result = parseHostRequest(line("network.read", `{"actor":${PERSON}}`));
    expect(result).toEqual({
      ok: true,
      request: {
        verb: "network.read",
        fields: {},
        actor: { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.fields)).toBe(true);
    expect(Object.isFrozen(result.request.actor)).toBe(true);
  });

  it("answers the exact frozen request for network.read by the server", () => {
    const result = parseHostRequest(line("network.read", `{"actor":${SERVER}}`));
    expect(result).toEqual({
      ok: true,
      request: { verb: "network.read", fields: {}, actor: { source: "server" } },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.fields)).toBe(true);
    expect(Object.isFrozen(result.request.actor)).toBe(true);
  });

  it.each(ACCEPTED_FIELDLESS)("accepts %s with its source", (verb, actor, objectText) => {
    expect(parseHostRequest(line(verb, objectText))).toEqual({
      ok: true,
      request: { verb, fields: {}, actor },
    });
  });

  it.each(ACCEPTED_WITH_FIELDS)(
    "accepts %s with exactly its field keys",
    (verb, objectText, fields, actor) => {
      const result = parseHostRequest(line(verb, objectText));
      expect(result).toEqual({ ok: true, request: { verb, fields, actor } });
      expect(Object.keys(result.request.fields)).toEqual(Object.keys(fields));
      expect(Object.isFrozen(result.request.fields)).toBe(true);
    },
  );

  it.each([
    ["a 64-character id", "a".repeat(64)],
    ["an upper-case UUID", "0B9C4A1E-6F1D-4C55-9A83-2F7D1E5C0A11"],
    ["p1", "p1"],
  ])("accepts a person id of %s", (_name, id) => {
    expect(
      parseHostRequest(line("network.read", `{"actor":{"source":"person","person":"${id}"}}`)),
    ).toEqual({
      ok: true,
      request: { verb: "network.read", fields: {}, actor: { source: "person", person: id } },
    });
  });
});

const VALID = line("network.read", `{"actor":${PERSON}}`);

describe("framing", () => {
  it.each([
    ["undefined", undefined],
    ["a number", 42],
    ["a Buffer of a valid line", Buffer.from(VALID)],
    ["an empty line", ""],
    ["a known verb with no space", "network.read"],
    ["nothing after the space", "network.read "],
    ["a leading space", ` network.read {"actor":${PERSON}}`],
    ["two spaces after the verb", `network.read  {"actor":${PERSON}}`],
    ["a trailing space", `${VALID} `],
    ["a trailing newline", `${VALID}\n`],
    ["a carriage return", `network.read {"actor":${PERSON}}\r`],
    ["a tab inside the JSON", `network.read {"actor":\t${PERSON}}`],
    [
      "a raw U+00E9 inside a string",
      `network.read {"actor":{"source":"person","person":"caf\u00e9"}}`,
    ],
    ["DEL", `network.read {"actor":{"source":"person","person":"p\u007f1"}}`],
  ])("refuses %s as request_invalid", (_name, value) => {
    expect(reasonOf(value)).toEqual({ ok: false, reason: "request_invalid" });
  });

  const atLength = (/** @type {number} */ length) => {
    const head = 'unknown.verb {"a":"';
    const tail = '"}';
    return head + "a".repeat(length - head.length - tail.length) + tail;
  };

  it("checks the length before the verb: 4097 characters is request_invalid", () => {
    const text = atLength(4097);
    expect(text.length).toBe(4097);
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "request_invalid" });
  });

  it("holds the limit inclusive: 4096 characters reaches the verb check", () => {
    const text = atLength(4096);
    expect(text.length).toBe(4096);
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "unknown_request" });
  });
});

describe("the verb", () => {
  it.each([
    ["clock.status", "clock.status"],
    ["clock.set", 'clock.set 1730073600000 {"source":"admin","person":"p1"}'],
    ["a longer verb", `network.readx {"actor":${PERSON}}`],
    ["upper case", `NETWORK.READ {"actor":${PERSON}}`],
    ["a prefix", `network {"actor":${PERSON}}`],
  ])("refuses %s as unknown_request", (_name, text) => {
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "unknown_request" });
  });

  it("exports no adapter to call", async () => {
    const module = await import("./host-protocol.mjs");
    expect(Object.keys(module).sort()).toEqual([
      "HOST_LINE_MAX",
      "HOST_VERBS",
      "PERSON_ID_MAX",
      "SHELL_VERBS",
      "VERB_PERMISSION",
      "formatHostRequest",
      "parseHostRequest",
    ]);
  });
});

describe("the object and its keys", () => {
  it.each([
    ["an array", "network.read []"],
    ["null", "network.read null"],
    ["a string", 'network.read "x"'],
    ["not JSON", "network.read {"],
    ["no actor", "network.read {}"],
    ["an extra key", `network.read {"actor":${PERSON},"extra":1}`],
    ["a __proto__ key", `network.read {"__proto__":{},"actor":${PERSON}}`],
    [
      "a join missing psk",
      `network.join {"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","hidden":false,"actor":${PERSON}}`,
    ],
    [
      "a join holding password instead of psk",
      `network.join {"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","password":"abcdefgh","hidden":false,"actor":${PERSON}}`,
    ],
  ])("refuses %s as request_invalid", (_name, text) => {
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "request_invalid" });
  });
});

describe("the canonical form", () => {
  it.each([
    ["a space after a colon", `network.read {"actor": ${PERSON}}`],
    [
      "the actor's keys reordered",
      'network.read {"actor":{"person":"0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11","source":"person"}}',
    ],
    ["actor given twice", `network.read {"actor":{"source":"nobody"},"actor":${PERSON}}`],
    ["actor before a field", `screen.set {"actor":${PERSON},"start":"dashboard"}`],
    [
      "an upper-case escape",
      String.raw`tag.write {"tag":{"name":"Caf\u00E9","live":true},"actor":{"source":"server"}}`,
    ],
  ])("refuses %s as request_invalid", (_name, text) => {
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "request_invalid" });
  });
});

describe("the actor", () => {
  /** @param {string} actorText */
  const read = (actorText) => line("network.read", `{"actor":${actorText}}`);

  it.each([
    ["null", read("null")],
    ["an array", read("[]")],
    ["a string", read('"person"')],
    ["an empty object", read("{}")],
    ["admin", read('{"source":"admin","person":"p1"}')],
    ["staff", read('{"source":"staff","person":"p1","device":"d1"}')],
    ["authority", read('{"source":"authority","check":null}')],
    ["a person with a device", read('{"source":"person","person":"p1","device":"d1"}')],
    ["an empty person id", read('{"source":"person","person":""}')],
    ["a 65-character person id", read(`{"source":"person","person":"${"a".repeat(65)}"}`)],
    ["a person id with a space", read('{"source":"person","person":"a b"}')],
    ["a person id with an underscore", read('{"source":"person","person":"a_b"}')],
    ["a person id with a quote", read(String.raw`{"source":"person","person":"a\"b"}`)],
    ["a person id with a dot", read('{"source":"person","person":"a.b"}')],
    ["a number as person id", read('{"source":"person","person":7}')],
    ["null as person id", read('{"source":"person","person":null}')],
    ["the server with a person", read('{"source":"server","person":"p1"}')],
    ["the server on network.scan", line("network.scan", `{"actor":${SERVER}}`)],
    ["the server on network.join", line("network.join", `{${JOIN_FIELDS},"actor":${SERVER}}`)],
    [
      "the server on network.forget",
      line("network.forget", `{"ssidHex":"4361666550657065","actor":${SERVER}}`),
    ],
    ["the server on screen.set", line("screen.set", `{"start":"dashboard","actor":${SERVER}}`)],
    [
      "a person on tag.write",
      line("tag.write", `{"tag":{"name":"Bar Pepe","live":true},"actor":${PERSON}}`),
    ],
  ])("refuses %s as actor_invalid", (_name, text) => {
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "actor_invalid" });
  });
});

describe("the order of the checks", () => {
  it("checks the keys before the actor", () => {
    expect(
      parseHostRequest('network.read {"actor":{"source":"admin","person":"p1"},"extra":1}'),
    ).toEqual({
      ok: false,
      reason: "request_invalid",
    });
  });

  it("checks the actor before the canonical form", () => {
    expect(parseHostRequest('network.read {"actor": {"source":"admin","person":"p1"}}')).toEqual({
      ok: false,
      reason: "actor_invalid",
    });
  });
});

describe("formatHostRequest", () => {
  it.each([
    ...ACCEPTED_FIELDLESS.map(([verb, , objectText]) => line(verb, objectText)),
    ...ACCEPTED_WITH_FIELDS.map(([verb, objectText]) => line(verb, objectText)),
  ])("writes back %s exactly", (text) => {
    const result = parseHostRequest(text);
    expect(result.ok).toBe(true);
    expect(formatHostRequest(result.request)).toBe(text);
  });

  it("escapes every character outside printable ASCII in lower case", () => {
    expect(
      formatHostRequest({
        verb: "tag.write",
        fields: { tag: { name: "Caf\u00e9 \u{1F600}\u007f", live: true } },
        actor: server,
      }),
    ).toBe(
      String.raw`tag.write {"tag":{"name":"Caf\u00e9 \ud83d\ude00\u007f","live":true},"actor":{"source":"server"}}`,
    );
  });

  /** @param {unknown} request */
  const thrown = (request) => {
    try {
      formatHostRequest(request);
    } catch (error) {
      return error;
    }
    throw new Error("formatHostRequest did not throw");
  };

  it.each([
    ["an unknown verb", { verb: "network.readx", fields: {}, actor: person }],
    ["a shell verb", { verb: "clock.status", fields: {}, actor: person }],
    ["a bad actor", { verb: "network.read", fields: {}, actor: { source: "admin", person: "p1" } }],
    ["the server where only a person may ask", { verb: "network.scan", fields: {}, actor: server }],
    ["a missing field key", { verb: "screen.set", fields: {}, actor: person }],
    ["an extra field key", { verb: "network.read", fields: { extra: 1 }, actor: person }],
    ["fields that are not an object", { verb: "network.read", fields: null, actor: person }],
    ["an extra request key", { verb: "network.read", fields: {}, actor: person, extra: 1 }],
    ["a non-object", "network.read"],
    ["null", null],
  ])("throws host_request.invalid for %s", (_name, request) => {
    expect(thrown(request)).toMatchObject({ code: "host_request.invalid" });
  });

  it("puts none of the request's values in its error", () => {
    const error = thrown({
      verb: "network.join",
      fields: {
        ssidHex: "4361666550657065",
        keyMgmt: "wpa-psk",
        password: "Canary-7f3a91",
        hidden: false,
      },
      actor: person,
    });
    expect(error).toMatchObject({ code: "host_request.invalid" });
    expect(JSON.stringify(error)).not.toContain("Canary-7f3a91");
    expect(String(error)).not.toContain("Canary-7f3a91");
    expect(String(error.stack)).not.toContain("Canary-7f3a91");
  });
});
