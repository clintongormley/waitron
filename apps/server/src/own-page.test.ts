import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "./logger.js";
import { requireManagementChangeFromOwnPage, sentFromThisOrigin } from "./own-page.js";

const BOX = "https://box.test";
const TRUSTED = "https://till.example.test";
const COOKIE = `waitron_management_session=${randomUUID()}`;
const REFUSED = { error: { code: "management.origin_refused", params: {} } };

let trusted: ReturnType<typeof vi.fn<(origin: string) => Promise<boolean>>>;
let log: ReturnType<typeof vi.fn<Logger>>;
let calls: Record<string, number>;

function build(): Hono {
  const app = new Hono();
  app.use("*", requireManagementChangeFromOwnPage(trusted, log));
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "PROPFIND", "GET", "OPTIONS"]) {
    app.on(method, "/x", (c) => {
      calls[method] = (calls[method] ?? 0) + 1;
      return c.text("ok");
    });
  }
  return app;
}

function send(
  headers: Record<string, string>,
  init: { method?: string; url?: string; cookie?: boolean; body?: BodyInit } = {},
) {
  const { method = "POST", url = `${BOX}/x`, cookie = true, body } = init;
  return build().request(url, {
    method,
    headers: { ...(cookie ? { cookie: COOKIE } : {}), ...headers },
    ...(body === undefined ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

beforeEach(() => {
  trusted = vi.fn(async (origin: string) => origin === TRUSTED);
  log = vi.fn();
  calls = {};
});

async function expectRefused(
  response: Response,
  method: string,
  headers: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual(REFUSED);
  expect(calls[method] ?? 0).toBe(0);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("warn", "management.origin_refused", {
    requestId: undefined,
    method,
    origin: headers.origin ?? null,
    site: headers["sec-fetch-site"] ?? null,
    ...extra,
  });
}

async function expectTaken(response: Response, method = "POST") {
  expect(response.status).toBe(200);
  expect(calls[method]).toBe(1);
  expect(log).not.toHaveBeenCalled();
}

const REFUSED_ROWS: [string, Record<string, string>, { noLookup?: boolean }][] = [
  [
    "another port of the box's own name",
    { origin: `${BOX}:8443`, "sec-fetch-site": "same-site" },
    {},
  ],
  ["the box's own name over plain HTTP", { origin: "http://box.test" }, {}],
  ["another site", { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site" }, {}],
  ["an empty origin", { origin: "" }, { noLookup: true }],
  ["an empty Sec-Fetch-Site", { origin: BOX, "sec-fetch-site": "" }, { noLookup: true }],
  ["a same-site fetch with no Origin", { "sec-fetch-site": "same-site" }, { noLookup: true }],
  ["a cross-site fetch with no Origin", { "sec-fetch-site": "cross-site" }, { noLookup: true }],
  [
    "the box's own origin with a same-site fetch",
    { origin: BOX, "sec-fetch-site": "same-site" },
    { noLookup: true },
  ],
];

describe("requireManagementChangeFromOwnPage refuses a change carrying the manager's cookie", () => {
  for (const [name, headers, { noLookup }] of REFUSED_ROWS) {
    it(name, async () => {
      await expectRefused(await send(headers), "POST", headers);
      if (noLookup === true) expect(trusted).not.toHaveBeenCalled();
    });
  }

  it("a null origin", async () => {
    const headers = { origin: "null" };
    await expectRefused(await send(headers), "POST", headers);
    expect(trusted).not.toHaveBeenCalled();
  });

  it("a trusted-origin lookup that fails", async () => {
    trusted.mockRejectedValue(new Error("membership read failed"));
    const headers = { origin: TRUSTED };
    await expectRefused(await send(headers), "POST", headers, { lookupFailed: true });
  });

  for (const method of ["PUT", "PATCH", "DELETE", "PROPFIND"]) {
    it(`a ${method} from another port of the box's own name`, async () => {
      const headers = { origin: `${BOX}:8443`, "sec-fetch-site": "same-site" };
      await expectRefused(await send(headers, { method }), method, headers);
    });
  }

  it("without reading one byte of its body", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(4097).fill(0x20));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const headers = { origin: `${BOX}:8443`, "content-type": "application/json" };
    await expectRefused(await send(headers, { body: stream }), "POST", headers);
    expect(pulls).toBe(0);
  });
});

describe("requireManagementChangeFromOwnPage takes", () => {
  it("the box's own page", async () => {
    await expectTaken(await send({ origin: BOX, "sec-fetch-site": "same-origin" }));
  });

  it("a page the person opened themselves", async () => {
    await expectTaken(await send({ origin: BOX, "sec-fetch-site": "none" }));
  });

  it("a tool sending neither header", async () => {
    await expectTaken(await send({}));
  });

  it("a trusted page on another origin", async () => {
    await expectTaken(await send({ origin: TRUSTED, "sec-fetch-site": "cross-site" }));
    expect(trusted).toHaveBeenCalledTimes(1);
    expect(trusted).toHaveBeenCalledWith(TRUSTED);
  });

  it("a form post from the box's own page", async () => {
    await expectTaken(
      await send(
        { origin: BOX, "content-type": "application/x-www-form-urlencoded" },
        { body: "a=1" },
      ),
    );
  });

  it("the box by IP address", async () => {
    await expectTaken(
      await send({ origin: "http://192.168.1.10:8080" }, { url: "http://192.168.1.10:8080/x" }),
    );
  });

  it("another page with no management cookie", async () => {
    await expectTaken(await send({ origin: "https://elsewhere.example" }, { cookie: false }));
    expect(trusted).not.toHaveBeenCalled();
  });

  it("a GET from another page", async () => {
    await expectTaken(
      await send({ origin: `${BOX}:8443`, "sec-fetch-site": "same-site" }, { method: "GET" }),
      "GET",
    );
  });

  it("a HEAD from another page", async () => {
    await expectTaken(
      await send({ origin: `${BOX}:8443`, "sec-fetch-site": "same-site" }, { method: "HEAD" }),
      "GET",
    );
  });

  it("an OPTIONS from another page", async () => {
    await expectTaken(
      await send({ origin: `${BOX}:8443`, "sec-fetch-site": "same-site" }, { method: "OPTIONS" }),
      "OPTIONS",
    );
  });
});

describe("sentFromThisOrigin", () => {
  async function judge(headers: Record<string, string>): Promise<boolean> {
    let verdict: boolean | undefined;
    const app = new Hono();
    app.post("/x", (c: Context) => {
      verdict = sentFromThisOrigin(c);
      return c.text("ok");
    });
    await app.request(`${BOX}/x`, { method: "POST", headers });
    if (verdict === undefined) throw new Error("the route did not run");
    return verdict;
  }

  const TAKEN_ROWS: [string, Record<string, string>][] = [
    ["the box's own page", { origin: BOX, "sec-fetch-site": "same-origin" }],
    ["a page the person opened themselves", { origin: BOX, "sec-fetch-site": "none" }],
    ["a tool sending neither header", {}],
  ];
  for (const [name, headers] of TAKEN_ROWS) {
    it(`is true for ${name}`, async () => {
      expect(await judge(headers)).toBe(true);
    });
  }

  const FALSE_ROWS: [string, Record<string, string>][] = [
    ...REFUSED_ROWS.map(([name, headers]): [string, Record<string, string>] => [name, headers]),
    ["a null origin", { origin: "null" }],
    ["a trusted page on another origin", { origin: TRUSTED, "sec-fetch-site": "cross-site" }],
  ];
  for (const [name, headers] of FALSE_ROWS) {
    it(`is false for ${name}`, async () => {
      expect(await judge(headers)).toBe(false);
    });
  }
});
