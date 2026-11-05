import { Buffer } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  HOST_LINE_MAX,
  HOST_REPLY_MAX,
  HOST_VERBS,
  NETWORK_SCAN_MAX,
  PERSON_ID_MAX,
  SHELL_VERBS,
  VERB_PERMISSION,
  formatHostReply,
  formatHostRequest,
  parseHostReply,
  parseHostRequest,
} from "./host-protocol.mjs";

const formattedRecords = vi.hoisted(() => /** @type {Uint8Array[]} */ ([]));

vi.mock("./wifi-record.mjs", async (importOriginal) => {
  const real = /** @type {typeof import("./wifi-record.mjs")} */ (await importOriginal());
  return {
    ...real,
    /** @param {Parameters<typeof real.formatWifiRecord>[0]} network */
    formatWifiRecord: (network) => {
      const bytes = real.formatWifiRecord(network);
      formattedRecords.push(bytes);
      return bytes;
    },
  };
});

const person = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" };
const server = { source: "server" };

const PERSON = '{"source":"person","person":"0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11"}';
const SERVER = '{"source":"server"}';

/** @param {string} verb @param {string} objectText */
const line = (verb, objectText) => `${verb} ${objectText}`;

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
    expect(parseHostRequest(value)).toEqual({ ok: false, reason: "request_invalid" });
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
      "HOST_REPLY_MAX",
      "HOST_VERBS",
      "NETWORK_SCAN_MAX",
      "PERSON_ID_MAX",
      "SHELL_VERBS",
      "VERB_PERMISSION",
      "formatHostReply",
      "formatHostRequest",
      "parseHostReply",
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
        fields: { tag: { name: "Caf\u00e9 \u{1F600}", live: true } },
        actor: server,
      }),
    ).toBe(
      String.raw`tag.write {"tag":{"name":"Caf\u00e9 \ud83d\ude00","live":true},"actor":{"source":"server"}}`,
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

const LONG_PERSON = `{"source":"person","person":"${"a".repeat(64)}"}`;
const PASSWORD_63 = "Abc def-ghi_jkl.mno~pqr!stu@vwx#yz0$123%456^789&ABC*DEF(GHI)JKL";
const E_ACUTE_128 = "\\u00e9".repeat(128);
const EMOJI_256 = "\\ud83d\\ude00".repeat(256);

/** [name, line, fields, actor, the Wi-Fi record's length in bytes] */
const ACCEPTED_JOINS = [
  [
    "a wpa-psk password",
    line("network.join", `{${JOIN_FIELDS},"actor":${PERSON}}`),
    { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: false },
    person,
    95,
  ],
  [
    "a 63-character printable password",
    line(
      "network.join",
      `{"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"${PASSWORD_63}","hidden":false,"actor":${PERSON}}`,
    ),
    { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: PASSWORD_63, hidden: false },
    person,
    150,
  ],
  [
    "64 hex characters as the password",
    line(
      "network.join",
      `{"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"${"0123456789abcdef".repeat(4)}","hidden":false,"actor":${PERSON}}`,
    ),
    {
      ssidHex: "4361666550657065",
      keyMgmt: "wpa-psk",
      psk: "0123456789abcdef".repeat(4),
      hidden: false,
    },
    person,
    151,
  ],
  [
    "a 1-byte sae password",
    line(
      "network.join",
      `{"ssidHex":"4361666550657065","keyMgmt":"sae","psk":"x","hidden":false,"actor":${PERSON}}`,
    ),
    { ssidHex: "4361666550657065", keyMgmt: "sae", psk: "x", hidden: false },
    person,
    84,
  ],
  [
    "a 256-byte sae password",
    line(
      "network.join",
      `{"ssidHex":"4361666550657065","keyMgmt":"sae","psk":"${E_ACUTE_128}","hidden":false,"actor":${PERSON}}`,
    ),
    { ssidHex: "4361666550657065", keyMgmt: "sae", psk: "\u00e9".repeat(128), hidden: false },
    person,
    339,
  ],
  [
    "the longest join",
    line(
      "network.join",
      `{"ssidHex":"${"ab".repeat(32)}","keyMgmt":"sae","psk":"${E_ACUTE_128}","hidden":false,"actor":${LONG_PERSON}}`,
    ),
    { ssidHex: "ab".repeat(32), keyMgmt: "sae", psk: "\u00e9".repeat(128), hidden: false },
    { source: "person", person: "a".repeat(64) },
    387,
  ],
  [
    "a hidden network",
    line(
      "network.join",
      `{"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":true,"actor":${PERSON}}`,
    ),
    { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: true },
    person,
    94,
  ],
];

const EMOJI_TAG_LINE = line(
  "tag.write",
  `{"tag":{"name":"${EMOJI_256}","live":false},"actor":${SERVER}}`,
);

/** [name, line, fields, actor] */
const ACCEPTED_FIELD_VALUES = [
  ...ACCEPTED_JOINS.map(([name, text, fields, actor]) => [
    `a join with ${name}`,
    text,
    fields,
    actor,
  ]),
  [
    "a forget",
    line("network.forget", `{"ssidHex":"4361666550657065","actor":${PERSON}}`),
    { ssidHex: "4361666550657065" },
    person,
  ],
  [
    "the dashboard start screen",
    line("screen.set", `{"start":"dashboard","actor":${PERSON}}`),
    { start: "dashboard" },
    person,
  ],
  [
    "the till start screen",
    line("screen.set", `{"start":"till","actor":${PERSON}}`),
    { start: "till" },
    person,
  ],
  ["no tag", line("tag.write", `{"tag":null,"actor":${SERVER}}`), { tag: null }, server],
  [
    "a live tag",
    line("tag.write", `{"tag":{"name":"Bar Pepe","live":true},"actor":${SERVER}}`),
    { tag: { name: "Bar Pepe", live: true } },
    server,
  ],
  [
    "a composed accented name",
    line(
      "tag.write",
      String.raw`{"tag":{"name":"Caf\u00e9","live":false},"actor":{"source":"server"}}`,
    ),
    { tag: { name: "Caf\u00e9", live: false } },
    server,
  ],
  [
    "a 256-emoji name",
    EMOJI_TAG_LINE,
    { tag: { name: "\u{1F600}".repeat(256), live: false } },
    server,
  ],
];

/** @param {string} fieldsText */
const join = (fieldsText) => line("network.join", `{${fieldsText},"actor":${PERSON}}`);
/** @param {string} ssidHexText */
const forget = (ssidHexText) =>
  line("network.forget", `{"ssidHex":${ssidHexText},"actor":${PERSON}}`);
/** @param {string} startText */
const screen = (startText) => line("screen.set", `{"start":${startText},"actor":${PERSON}}`);
/** @param {string} tagText */
const tag = (tagText) => line("tag.write", `{"tag":${tagText},"actor":${SERVER}}`);

const REFUSED_FIELD_VALUES = [
  [
    "keyMgmt wpa-eap",
    join('"ssidHex":"4361666550657065","keyMgmt":"wpa-eap","psk":"abcdefgh","hidden":false'),
  ],
  [
    "keyMgmt none",
    join('"ssidHex":"4361666550657065","keyMgmt":"none","psk":"abcdefgh","hidden":false'),
  ],
  [
    "keyMgmt WPA-PSK",
    join('"ssidHex":"4361666550657065","keyMgmt":"WPA-PSK","psk":"abcdefgh","hidden":false'),
  ],
  [
    "keyMgmt null",
    join('"ssidHex":"4361666550657065","keyMgmt":null,"psk":"abcdefgh","hidden":false'),
  ],
  [
    "a 7-character password",
    join('"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefg","hidden":false'),
  ],
  [
    "64 characters not all hex",
    join(
      `"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"${"0123456789abcdef".repeat(3)}0123456789abcdeg","hidden":false`,
    ),
  ],
  [
    "a wpa-psk password outside printable ASCII",
    join(
      String.raw`"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"caf\u00e9secret","hidden":false`,
    ),
  ],
  [
    "a null password",
    join('"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":null,"hidden":false'),
  ],
  [
    "a 257-byte sae password",
    join(`"ssidHex":"4361666550657065","keyMgmt":"sae","psk":"${E_ACUTE_128}x","hidden":false`),
  ],
  [
    "an sae password with a tab",
    join(String.raw`"ssidHex":"4361666550657065","keyMgmt":"sae","psk":"a\tb","hidden":false`),
  ],
  [
    "an sae password with a lone surrogate",
    join(String.raw`"ssidHex":"4361666550657065","keyMgmt":"sae","psk":"a\ud800","hidden":false`),
  ],
  [
    "an empty ssidHex in a join",
    join('"ssidHex":"","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false'),
  ],
  [
    "an upper-case ssidHex in a join",
    join('"ssidHex":"F0","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false'),
  ],
  [
    "half a byte of ssidHex in a join",
    join('"ssidHex":"f","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false'),
  ],
  [
    "33 bytes of ssidHex in a join",
    join(`"ssidHex":"${"ab".repeat(33)}","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false`),
  ],
  [
    "hidden as a string",
    join('"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":"false"'),
  ],
  [
    "hidden as a number",
    join('"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":0'),
  ],
  ["an empty ssidHex to forget", forget('""')],
  ["an upper-case ssidHex to forget", forget('"F0"')],
  ["half a byte of ssidHex to forget", forget('"f"')],
  ["33 bytes of ssidHex to forget", forget(`"${"ab".repeat(33)}"`)],
  ["the start screen Panel", screen('"Panel"')],
  ["the start screen Caja", screen('"Caja"')],
  ["the start screen setup", screen('"setup"')],
  ["an empty start screen", screen('""')],
  ["the start screen DASHBOARD", screen('"DASHBOARD"')],
  ["a null start screen", screen("null")],
  ["a decomposed name", tag(String.raw`{"name":"Cafe\u0301","live":true}`)],
  ["a 257-code-point name", tag(`{"name":"${"a".repeat(257)}","live":true}`)],
  ["an empty name", tag('{"name":"","live":true}')],
  ["a name with a tab", tag(String.raw`{"name":"Bar\tPepe","live":true}`)],
  ["a number as name", tag('{"name":42,"live":true}')],
  ["live as a string", tag('{"name":"Bar Pepe","live":"true"}')],
  ["a tag with an extra key", tag('{"name":"Bar Pepe","live":true,"extra":1}')],
  ["a tag that is a string", tag('"Bar"')],
  ["a tag that is an array", tag("[]")],
];

/** The request a line's JSON spells, read by the test rather than the module. @param {string} text */
const requestSpelledBy = (text) => {
  const space = text.indexOf(" ");
  const { actor, ...fields } = JSON.parse(text.slice(space + 1));
  return { verb: text.slice(0, space), fields, actor };
};

/** @param {unknown} request */
const formatError = (request) => {
  try {
    formatHostRequest(/** @type {any} */ (request));
  } catch (error) {
    return error;
  }
  throw new Error("formatHostRequest did not throw");
};

describe("each request's field values", () => {
  it.each(ACCEPTED_FIELD_VALUES)("accepts %s", (_name, text, fields, actor) => {
    const result = parseHostRequest(text);
    expect(result).toEqual({
      ok: true,
      request: { verb: text.slice(0, text.indexOf(" ")), fields, actor },
    });
    expect(Object.keys(result.request.fields)).toEqual(Object.keys(fields));
    expect(Object.isFrozen(result.request.fields)).toBe(true);
  });

  it.each(ACCEPTED_FIELD_VALUES.filter(([, , fields]) => fields.tag))(
    "freezes the tag of %s",
    (_name, text) => {
      expect(Object.isFrozen(parseHostRequest(text).request.fields.tag)).toBe(true);
    },
  );

  it("writes the longest join in 1003 characters", () => {
    expect(ACCEPTED_JOINS[5][1].length).toBe(1003);
    expect(parseHostRequest(ACCEPTED_JOINS[5][1]).ok).toBe(true);
  });

  it("writes the 256-emoji tag in 3142 characters, 3141 when live", () => {
    const live = tag(`{"name":"${EMOJI_256}","live":true}`);
    expect(EMOJI_TAG_LINE.length).toBe(3142);
    expect(live.length).toBe(3141);
    expect(parseHostRequest(live).ok).toBe(true);
  });

  it.each(REFUSED_FIELD_VALUES)("refuses %s as fields_invalid", (_name, text) => {
    expect(parseHostRequest(text)).toEqual({ ok: false, reason: "fields_invalid" });
  });

  it.each(ACCEPTED_FIELD_VALUES)("writes back %s exactly", (_name, text) => {
    expect(formatHostRequest(parseHostRequest(text).request)).toBe(text);
  });

  it.each(REFUSED_FIELD_VALUES)("will not write %s", (_name, text) => {
    expect(formatError(requestSpelledBy(text))).toMatchObject({ code: "host_request.invalid" });
  });

  it.each([
    [
      "an undefined field value",
      { verb: "screen.set", fields: { start: undefined }, actor: person },
    ],
    [
      "a BigInt field value",
      {
        verb: "network.join",
        fields: { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: 1n },
        actor: person,
      },
    ],
  ])("will not write %s", (_name, request) => {
    expect(formatError(request)).toMatchObject({ code: "host_request.invalid" });
  });

  it("keeps a refused password out of the error and the refusal", () => {
    const error = formatError({
      verb: "network.join",
      fields: {
        ssidHex: "4361666550657065",
        keyMgmt: "wpa-eap",
        psk: "Canary-7f3a91",
        hidden: false,
      },
      actor: person,
    });
    expect(error).toMatchObject({ code: "host_request.invalid" });
    expect(JSON.stringify(error)).not.toContain("Canary-7f3a91");
    expect(String(error)).not.toContain("Canary-7f3a91");
    expect(String(error.stack)).not.toContain("Canary-7f3a91");
    expect(
      parseHostRequest(
        join(
          '"ssidHex":"4361666550657065","keyMgmt":"wpa-eap","psk":"Canary-7f3a91","hidden":false',
        ),
      ),
    ).toStrictEqual({ ok: false, reason: "fields_invalid" });
  });
});

describe("the join check zeroes the record it builds", () => {
  /** @param {number} length */
  const expectZeroedRecords = (length) => {
    expect(formattedRecords.length).toBeGreaterThanOrEqual(1);
    for (const bytes of formattedRecords) {
      expect(bytes.length).toBe(length);
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    }
  };

  it.each(ACCEPTED_JOINS)("for %s", (_name, text, _fields, _actor, length) => {
    formattedRecords.length = 0;
    expect(parseHostRequest(text).ok).toBe(true);
    expectZeroedRecords(length);
  });

  it("for a join whose line is refused after its fields pass", () => {
    formattedRecords.length = 0;
    expect(
      parseHostRequest(
        join('"ssidHex": "4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false'),
      ),
    ).toEqual({ ok: false, reason: "request_invalid" });
    expectZeroedRecords(95);
  });
});

const SSID = "4361666550657065";
const WIRED = { connected: true, address: "192.168.1.10" };
const WIFI = { connectedSsidHex: SSID, savedSsidHex: SSID };
const CURRENT_COPY = { state: "current", reason: null, failure: null };
const WIRED_TEXT = '{"connected":true,"address":"192.168.1.10"}';
const WIFI_TEXT = `{"connectedSsidHex":"${SSID}","savedSsidHex":"${SSID}"}`;
const CURRENT_COPY_TEXT = '{"state":"current","reason":null,"failure":null}';

/** @param {Record<string, unknown>} parts */
const readReply = (parts = {}) => ({
  ok: true,
  wired: WIRED,
  wifi: WIFI,
  change: null,
  bootCopy: CURRENT_COPY,
  ...parts,
});
/** @param {{ wired?: string, wifi?: string, change?: string, bootCopy?: string }} parts */
const readText = ({
  wired = WIRED_TEXT,
  wifi = WIFI_TEXT,
  change = "null",
  bootCopy = CURRENT_COPY_TEXT,
} = {}) =>
  `{"ok":true,"wired":${wired},"wifi":${wifi},"change":${change},"bootCopy":${bootCopy}}\n`;

/** @param {string} kind @param {string} state @param {string | null} reason */
const change = (kind, state, reason) => ({ kind, ssidHex: SSID, state, reason });
/** @param {string} kind @param {string} state @param {string} reason */
const changeText = (kind, state, reason) =>
  `{"kind":"${kind}","ssidHex":"${SSID}","state":"${state}","reason":${reason}}`;

/** @param {number} index two hex digits, so 32 networks are 32 different SSIDs */
const ssidOf = (index) => `5769${index.toString(16).padStart(2, "0")}`;
/** @param {number} count */
const scanNetworks = (count) =>
  Array.from({ length: count }, (_, index) => ({
    ssidHex: ssidOf(index),
    signal: 50,
    security: "wpa-psk",
  }));
/** @param {number} count */
const scanEntriesText = (count) =>
  Array.from(
    { length: count },
    (_, index) => `{"ssidHex":"${ssidOf(index)}","signal":50,"security":"wpa-psk"}`,
  ).join(",");

/** [name, verb, reply, line] */
const VALID_REPLIES = [
  [
    "the network example",
    "network.read",
    readReply(),
    '{"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}\n',
  ],
  [
    "a disconnected cable with no Wi-Fi",
    "network.read",
    readReply({
      wired: { connected: false, address: null },
      wifi: { connectedSsidHex: null, savedSsidHex: null },
    }),
    readText({
      wired: '{"connected":false,"address":null}',
      wifi: '{"connectedSsidHex":null,"savedSsidHex":null}',
    }),
  ],
  [
    "a connected cable with no address yet",
    "network.read",
    readReply({ wired: { connected: true, address: null } }),
    readText({ wired: '{"connected":true,"address":null}' }),
  ],
  [
    "an IPv6 address",
    "network.read",
    readReply({ wired: { connected: true, address: "fe80::1" } }),
    readText({ wired: '{"connected":true,"address":"fe80::1"}' }),
  ],
  [
    "a running join",
    "network.read",
    readReply({ change: change("join", "running", null) }),
    readText({ change: changeText("join", "running", "null") }),
  ],
  [
    "an applied join",
    "network.read",
    readReply({ change: change("join", "applied", null) }),
    readText({ change: changeText("join", "applied", "null") }),
  ],
  ...["password-rejected", "network-not-found", "timed-out", "failed"].map((reason) => [
    `a join refused ${reason}`,
    "network.read",
    readReply({ change: change("join", "refused", reason) }),
    readText({ change: changeText("join", "refused", `"${reason}"`) }),
  ]),
  [
    "a running forget",
    "network.read",
    readReply({ change: change("forget", "running", null) }),
    readText({ change: changeText("forget", "running", "null") }),
  ],
  [
    "a forget refused failed",
    "network.read",
    readReply({ change: change("forget", "refused", "failed") }),
    readText({ change: changeText("forget", "refused", '"failed"') }),
  ],
  ...["pending", "current", "absent"].map((state) => [
    `a ${state} boot copy`,
    "network.read",
    readReply({ bootCopy: { state, reason: null, failure: null } }),
    readText({ bootCopy: `{"state":"${state}","reason":null,"failure":null}` }),
  ]),
  ...[
    "mount-unverified",
    "root-changed",
    "path-unsafe",
    "permissions-unsafe",
    "io-failed",
    "publication-unverified",
  ].map((failure) => [
    `a boot copy failed ${failure}`,
    "network.read",
    readReply({ bootCopy: { state: "failed", reason: null, failure } }),
    readText({ bootCopy: `{"state":"failed","reason":null,"failure":"${failure}"}` }),
  ]),
  [
    "an absent boot copy for a cable-only box",
    "network.read",
    readReply({ bootCopy: { state: "absent", reason: "cable-only", failure: null } }),
    readText({ bootCopy: '{"state":"absent","reason":"cable-only","failure":null}' }),
  ],
  ["no networks", "network.scan", { ok: true, networks: [] }, '{"ok":true,"networks":[]}\n'],
  [
    "one network of each security",
    "network.scan",
    {
      ok: true,
      networks: [
        { ssidHex: "41", signal: 0, security: "wpa-psk" },
        { ssidHex: "42", signal: 100, security: "sae" },
        { ssidHex: "43", signal: 37, security: "other" },
      ],
    },
    '{"ok":true,"networks":[{"ssidHex":"41","signal":0,"security":"wpa-psk"},{"ssidHex":"42","signal":100,"security":"sae"},{"ssidHex":"43","signal":37,"security":"other"}]}\n',
  ],
  [
    "32 networks",
    "network.scan",
    { ok: true, networks: scanNetworks(32) },
    `{"ok":true,"networks":[${scanEntriesText(32)}]}\n`,
  ],
  ["a started join", "network.join", { ok: true }, '{"ok":true}\n'],
  ["a started forget", "network.forget", { ok: true }, '{"ok":true}\n'],
  [
    "the dashboard",
    "screen.read",
    { ok: true, start: "dashboard" },
    '{"ok":true,"start":"dashboard"}\n',
  ],
  ["the till", "screen.read", { ok: true, start: "till" }, '{"ok":true,"start":"till"}\n'],
  [
    "the dashboard set",
    "screen.set",
    { ok: true, start: "dashboard" },
    '{"ok":true,"start":"dashboard"}\n',
  ],
  ["the till set", "screen.set", { ok: true, start: "till" }, '{"ok":true,"start":"till"}\n'],
  ...["written", "removed", "unchanged"].map((kind) => [
    `a tag ${kind}`,
    "tag.write",
    { ok: true, tag: kind },
    `{"ok":true,"tag":"${kind}"}\n`,
  ]),
];

/** @param {unknown} value */
const expectDeeplyFrozen = (value) => {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
};

/** @param {string} verb @param {unknown} reply */
const replyError = (verb, reply) => {
  try {
    formatHostReply(verb, /** @type {any} */ (reply));
  } catch (error) {
    return error;
  }
  throw new Error("formatHostReply did not throw");
};

const PARSER_REASONS = ["request_invalid", "unknown_request", "actor_invalid", "fields_invalid"];
/** [verb, its own refusals] */
const OWN_REASONS = [
  ["network.read", []],
  ["network.scan", ["busy", "no_wifi"]],
  ["network.join", ["busy", "no_wifi"]],
  ["network.forget", ["busy", "not_saved"]],
  ["screen.read", []],
  ["screen.set", []],
  ["tag.write", ["busy", "no_free_token", "header_unreadable", "no_space"]],
];
const ALLOWED_REFUSALS = OWN_REASONS.flatMap(([verb, own]) =>
  [...PARSER_REASONS, "host_failed", ...own].map((reason) => [verb, reason]),
);

describe("the reply limits", () => {
  it("holds the client's reply limit and the scan's network limit", () => {
    expect(HOST_REPLY_MAX).toBe(4096);
    expect(NETWORK_SCAN_MAX).toBe(32);
  });
});

describe("valid replies", () => {
  it.each(VALID_REPLIES)("writes %s exactly", (_name, verb, reply, text) => {
    expect(formatHostReply(verb, reply)).toBe(text);
  });

  it.each(VALID_REPLIES)("reads %s back, deeply frozen", (_name, verb, reply, text) => {
    const value = { ...reply };
    delete value.ok;
    const result = parseHostReply(verb, text);
    expect(result).toEqual({ kind: "ok", value });
    expect(Object.isFrozen(result)).toBe(true);
    expectDeeplyFrozen(result.value);
  });

  it("writes the largest scan reply within the client's limit", () => {
    const networks = Array.from({ length: 32 }, (_, index) => ({
      ssidHex: index.toString(16).padStart(2, "0").repeat(32),
      signal: 100,
      security: "wpa-psk",
    }));
    const text = formatHostReply("network.scan", { ok: true, networks });
    expect(Buffer.byteLength(text)).toBe(3641);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(HOST_REPLY_MAX);
    expect(parseHostReply("network.scan", text).kind).toBe("ok");
  });
});

describe("refusals", () => {
  it.each(ALLOWED_REFUSALS)("%s may answer %s", (verb, reason) => {
    const text = `{"ok":false,"reason":"${reason}"}\n`;
    expect(formatHostReply(verb, { ok: false, reason })).toBe(text);
    const result = parseHostReply(verb, text);
    expect(result).toEqual({ kind: "refused", reason });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["network.join", "not_saved"],
    ["screen.read", "no_wifi"],
    ...HOST_VERBS.map((verb) => [verb, "nope"]),
  ])("%s may not answer %s", (verb, reason) => {
    expect(replyError(verb, { ok: false, reason })).toMatchObject({ code: "host_reply.invalid" });
    expect(parseHostReply(verb, `{"ok":false,"reason":"${reason}"}\n`)).toEqual({
      kind: "malformed",
    });
  });
});

/** [name, verb, reply, line] */
const REFUSED_SHAPES = [
  [
    "an extra key at the top",
    "screen.read",
    { ok: true, start: "till", extra: 1 },
    '{"ok":true,"start":"till","extra":1}\n',
  ],
  [
    "an extra key at the top of a network read",
    "network.read",
    readReply({ extra: 1 }),
    `${readText().slice(0, -2)},"extra":1}\n`,
  ],
  [
    "an extra key at the top of a scan",
    "network.scan",
    { ok: true, networks: [], extra: 1 },
    '{"ok":true,"networks":[],"extra":1}\n',
  ],
  [
    "an extra key in wired",
    "network.read",
    readReply({ wired: { ...WIRED, extra: 1 } }),
    readText({ wired: '{"connected":true,"address":"192.168.1.10","extra":1}' }),
  ],
  [
    "an extra key in wifi",
    "network.read",
    readReply({ wifi: { ...WIFI, extra: 1 } }),
    readText({ wifi: `{"connectedSsidHex":"${SSID}","savedSsidHex":"${SSID}","extra":1}` }),
  ],
  [
    "an extra key in change",
    "network.read",
    readReply({ change: { ...change("join", "running", null), extra: 1 } }),
    readText({
      change: `{"kind":"join","ssidHex":"${SSID}","state":"running","reason":null,"extra":1}`,
    }),
  ],
  [
    "an extra key in bootCopy",
    "network.read",
    readReply({ bootCopy: { ...CURRENT_COPY, extra: 1 } }),
    readText({ bootCopy: '{"state":"current","reason":null,"failure":null,"extra":1}' }),
  ],
  [
    "an extra key in a network",
    "network.scan",
    { ok: true, networks: [{ ssidHex: "41", signal: 1, security: "sae", extra: 1 }] },
    '{"ok":true,"networks":[{"ssidHex":"41","signal":1,"security":"sae","extra":1}]}\n',
  ],
  [
    "a missing key in a network",
    "network.scan",
    { ok: true, networks: [{ ssidHex: "41", signal: 1 }] },
    '{"ok":true,"networks":[{"ssidHex":"41","signal":1}]}\n',
  ],
  [
    "wired.connected as a string",
    "network.read",
    readReply({ wired: { connected: "yes", address: null } }),
    readText({ wired: '{"connected":"yes","address":null}' }),
  ],
  [
    "an address while disconnected",
    "network.read",
    readReply({ wired: { connected: false, address: "192.168.1.10" } }),
    readText({ wired: '{"connected":false,"address":"192.168.1.10"}' }),
  ],
  ...[
    ["a leading zero", "01.2.3.4"],
    ["a leading space", " 1.2.3.4"],
    ["a zone", "fe80::1%eth0"],
    ["a host name", "host.local"],
    ["46 characters", "0000:0000:0000:0000:0000:ffff:0255.255.255.255"],
  ].map(([name, address]) => [
    `an address with ${name}`,
    "network.read",
    readReply({ wired: { connected: true, address } }),
    readText({ wired: `{"connected":true,"address":"${address}"}` }),
  ]),
  [
    "an address that is a number",
    "network.read",
    readReply({ wired: { connected: true, address: 1 } }),
    readText({ wired: '{"connected":true,"address":1}' }),
  ],
  [
    "upper-case connected SSID hex",
    "network.read",
    readReply({ wifi: { connectedSsidHex: "FF", savedSsidHex: null } }),
    readText({ wifi: '{"connectedSsidHex":"FF","savedSsidHex":null}' }),
  ],
  [
    "upper-case saved SSID hex",
    "network.read",
    readReply({ wifi: { connectedSsidHex: null, savedSsidHex: "FF" } }),
    readText({ wifi: '{"connectedSsidHex":null,"savedSsidHex":"FF"}' }),
  ],
  [
    "a running change with a reason",
    "network.read",
    readReply({ change: change("join", "running", "failed") }),
    readText({ change: changeText("join", "running", '"failed"') }),
  ],
  [
    "a refused change with no reason",
    "network.read",
    readReply({ change: change("join", "refused", null) }),
    readText({ change: changeText("join", "refused", "null") }),
  ],
  [
    "a forget refused password-rejected",
    "network.read",
    readReply({ change: change("forget", "refused", "password-rejected") }),
    readText({ change: changeText("forget", "refused", '"password-rejected"') }),
  ],
  [
    "a change of kind scan",
    "network.read",
    readReply({ change: change("scan", "running", null) }),
    readText({ change: changeText("scan", "running", "null") }),
  ],
  [
    "a change with state done",
    "network.read",
    readReply({ change: change("join", "done", null) }),
    readText({ change: changeText("join", "done", "null") }),
  ],
  [
    "a change naming no SSID",
    "network.read",
    readReply({ change: { kind: "join", ssidHex: null, state: "running", reason: null } }),
    readText({ change: '{"kind":"join","ssidHex":null,"state":"running","reason":null}' }),
  ],
  [
    "a failed boot copy with no failure",
    "network.read",
    readReply({ bootCopy: { state: "failed", reason: null, failure: null } }),
    readText({ bootCopy: '{"state":"failed","reason":null,"failure":null}' }),
  ],
  [
    "a current boot copy with a failure",
    "network.read",
    readReply({ bootCopy: { state: "current", reason: null, failure: "io-failed" } }),
    readText({ bootCopy: '{"state":"current","reason":null,"failure":"io-failed"}' }),
  ],
  [
    "a failed boot copy with an unknown failure",
    "network.read",
    readReply({ bootCopy: { state: "failed", reason: null, failure: "disk-gone" } }),
    readText({ bootCopy: '{"state":"failed","reason":null,"failure":"disk-gone"}' }),
  ],
  [
    "a boot copy state ok",
    "network.read",
    readReply({ bootCopy: { state: "ok", reason: null, failure: null } }),
    readText({ bootCopy: '{"state":"ok","reason":null,"failure":null}' }),
  ],
  [
    "a boot copy reason wifi",
    "network.read",
    readReply({ bootCopy: { state: "absent", reason: "wifi", failure: null } }),
    readText({ bootCopy: '{"state":"absent","reason":"wifi","failure":null}' }),
  ],
  [
    "a wired value that is null",
    "network.read",
    readReply({ wired: null }),
    readText({ wired: "null" }),
  ],
  [
    "33 networks",
    "network.scan",
    { ok: true, networks: scanNetworks(33) },
    `{"ok":true,"networks":[${scanEntriesText(33)}]}\n`,
  ],
  [
    "the same SSID twice",
    "network.scan",
    {
      ok: true,
      networks: [
        { ssidHex: "41", signal: 1, security: "sae" },
        { ssidHex: "41", signal: 2, security: "wpa-psk" },
      ],
    },
    '{"ok":true,"networks":[{"ssidHex":"41","signal":1,"security":"sae"},{"ssidHex":"41","signal":2,"security":"wpa-psk"}]}\n',
  ],
  [
    "networks that are not a list",
    "network.scan",
    { ok: true, networks: {} },
    '{"ok":true,"networks":{}}\n',
  ],
  [
    "a network SSID in upper case",
    "network.scan",
    { ok: true, networks: [{ ssidHex: "AB", signal: 1, security: "sae" }] },
    '{"ok":true,"networks":[{"ssidHex":"AB","signal":1,"security":"sae"}]}\n',
  ],
  ...[
    ["101", 101, "101"],
    ["-1", -1, "-1"],
    ["50.5", 50.5, "50.5"],
    ['"50"', "50", '"50"'],
  ].map(([name, signal, signalText]) => [
    `signal ${name}`,
    "network.scan",
    { ok: true, networks: [{ ssidHex: "41", signal, security: "sae" }] },
    `{"ok":true,"networks":[{"ssidHex":"41","signal":${signalText},"security":"sae"}]}\n`,
  ]),
  [
    "security wep",
    "network.scan",
    { ok: true, networks: [{ ssidHex: "41", signal: 1, security: "wep" }] },
    '{"ok":true,"networks":[{"ssidHex":"41","signal":1,"security":"wep"}]}\n',
  ],
  ["start Panel", "screen.read", { ok: true, start: "Panel" }, '{"ok":true,"start":"Panel"}\n'],
  ["start Panel set", "screen.set", { ok: true, start: "Panel" }, '{"ok":true,"start":"Panel"}\n'],
  ["tag replaced", "tag.write", { ok: true, tag: "replaced" }, '{"ok":true,"tag":"replaced"}\n'],
  ["ok missing", "network.join", { start: "till" }, '{"start":"till"}\n'],
  ["ok as a string", "network.join", { ok: "true" }, '{"ok":"true"}\n'],
  [
    "an extra key on a started join",
    "network.join",
    { ok: true, extra: 1 },
    '{"ok":true,"extra":1}\n',
  ],
  [
    "an extra key on a started forget",
    "network.forget",
    { ok: true, extra: 1 },
    '{"ok":true,"extra":1}\n',
  ],
  [
    "a refusal with an extra key",
    "network.scan",
    { ok: false, reason: "busy", detail: "x" },
    '{"ok":false,"reason":"busy","detail":"x"}\n',
  ],
  ["a reply that is a list", "network.join", [true], "[true]\n"],
  ["a reply that is null", "network.join", null, "null\n"],
];

describe("refused reply shapes", () => {
  it.each(REFUSED_SHAPES)("will not write %s", (_name, verb, reply) => {
    expect(replyError(verb, reply)).toMatchObject({ code: "host_reply.invalid" });
  });

  it.each(REFUSED_SHAPES)("reads %s as malformed", (_name, verb, _reply, text) => {
    const result = parseHostReply(verb, text);
    expect(result).toEqual({ kind: "malformed" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("will not write a reply for an unknown verb", () => {
    expect(replyError("clock.status", { ok: true })).toMatchObject({ code: "host_reply.invalid" });
    expect(parseHostReply("clock.status", '{"ok":true}\n')).toEqual({ kind: "malformed" });
  });
});

describe("reading a reply's framing", () => {
  it.each([
    ["no trailing newline", "screen.read", '{"ok":true,"start":"till"}'],
    ["two newlines", "screen.read", '{"ok":true,"start":"till"}\n\n'],
    ["a carriage return", "screen.read", '{"ok":true,"start":"till"}\r\n'],
    ["a space after a colon", "screen.read", '{"ok": true,"start":"till"}\n'],
    ["keys reordered", "screen.read", '{"start":"till","ok":true}\n'],
    ["a duplicate key", "screen.read", '{"ok":true,"start":"dashboard","start":"till"}\n'],
    ["a non-string", "screen.read", null],
    ["a number", "screen.read", 7],
    ["non-JSON", "screen.read", "nope\n"],
  ])("reads %s as malformed", (_name, verb, text) => {
    expect(parseHostReply(verb, /** @type {any} */ (text))).toEqual({ kind: "malformed" });
  });

  it("reads a 4097-byte text as malformed", () => {
    const text = `{"ok":true}${" ".repeat(4085)}\n`;
    expect(text.length).toBe(4097);
    expect(parseHostReply("network.join", text)).toEqual({ kind: "malformed" });
  });
});
