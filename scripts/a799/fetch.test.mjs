import { Buffer } from "node:buffer";
import { setTimeout } from "node:timers";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as fetcher from "./fetch.mjs";
import { selectCells } from "./selection.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const sha = (n) => String(n).padStart(40, "0");
const h = (n) => String(n).padStart(64, "0");
const file = (path, body = "facts") => ({
  path,
  kind: "file",
  mode: 384,
  bytes: Buffer.byteLength(body),
  sha256: hash(body),
});
const encode = (list) =>
  gzipSync(
    Buffer.concat([
      Buffer.from("a799-state-v1\n"),
      ...list.flatMap((e) => {
        const b = Buffer.from(JSON.stringify(e));
        const n = Buffer.alloc(4);
        n.writeUInt32BE(b.length);
        return [n, b, Buffer.from("facts")];
      }),
    ]),
  );
async function* chunks(b) {
  yield b;
}
function setup() {
  const bytes = encode([file("facts.json")]);
  const asset = (n) => ({
    releaseId: 100,
    assetId: n,
    name: `${n}.a799.gz`,
    bytes: bytes.length,
    sha256: hash(bytes),
    inventory: [file("facts.json")],
  });
  const image = (n) => ({
    sourceSha: sha(n),
    manifestDigest: h(n),
    platformDigest: h(n + 5),
    platform: "linux/arm64",
    buildIdentity: `R${n}`,
    nodeVersion: "26",
    sqliteVersion: "3",
    entry: ["node", "/app/node-entry.js"],
  });
  const fixture = (variant, n) => ({
    id: variant,
    version: 1,
    epochId: "post-reset",
    image: image(1),
    driverSha: sha(3),
    scenarioVersion: "1",
    retainedOrdinal: 1,
    moduleVariant: variant,
    bundle: asset(n),
    evidence: asset(n + 1),
    limits: {
      compressedBytes: 4096,
      unpackedBytes: 4096,
      entries: 10,
      perFileBytes: 1024,
      logBytes: 1024,
      memoryBytes: 1024,
      scratchBytes: 1024,
      processCount: 2,
    },
    reviewReceipt: "review",
    controlReceipt: "controls",
  });
  const index = {
    version: 1,
    epoch: {
      id: "post-reset",
      a760ResetReceipt: "reset",
      baselineSourceSha: sha(1),
      baselineMigrationHashes: [{ set: "core", table: "__migrations", hash: h(1) }],
    },
    fixtures: [fixture("required-verifactu", 1), fixture("never-enabled", 3)],
    oldestSource: sha(1),
    retirements: [],
  };
  const candidate = { image: image(2), epochId: "post-reset", orderedSourceShas: [sha(1), sha(2)] };
  const indexBytes = Buffer.from(JSON.stringify(index));
  const events = [];
  const roots = [];
  const surfaces = {
    environment: [],
    checkoutConfig: [],
    credentialHelpers: [],
    registryLogins: [],
    scratchFiles: [],
    subprocessArguments: [],
    history: [],
    dockerConfig: [],
  };
  const deps = {
    indexBytes,
    indexSha256: hash(indexBytes),
    trustedRevision: sha(4),
    candidate,
    deadlines: { totalMs: 1000, cleanupMs: 100 },
    retrySchedule: [0, 0],
    signal: new globalThis.AbortController().signal,
    transport: {
      fetch(asset, sourceSha) {
        events.push(["fetch", asset.assetId, sourceSha]);
        return chunks(bytes);
      },
      async close() {
        events.push(["transport-closed"]);
      },
    },
    credentialScope: {
      async close() {
        events.push(["scope-closed"]);
        return { closed: true, surfaces };
      },
    },
    async scratch() {
      const root = `/owned/${roots.length}`;
      const ownerId = `owner-${roots.length}`;
      const placed = new Map();
      let ino = 1;
      const stat = (kind, mode) => ({ kind, mode, ownerId, dev: 1, ino: ++ino, nlink: 1 });
      const rootStat = stat("directory", 448);
      const owned = { root, placed, disposed: false };
      roots.push(owned);
      return {
        async dispose() {
          owned.disposed = true;
          placed.clear();
        },
        io: {
          root,
          ownerId,
          async inspectEntry(path) {
            return path === "" ? rootStat : placed.get(path)?.stat;
          },
          async createDirectory(e) {
            placed.set(e.path, { stat: stat("directory", e.mode) });
          },
          async openExclusiveNoFollow(e) {
            const v = { stat: stat("file", e.mode), bytes: Buffer.alloc(0) };
            placed.set(e.path, v);
            v.identity = v.stat;
            return v;
          },
          async writeChunk(handle, b) {
            handle.bytes = Buffer.concat([handle.bytes, b]);
          },
          async finishVerifiedFile() {},
          async removeOwnedPartial() {
            placed.clear();
          },
        },
      };
    },
  };
  return { deps, cells: selectCells(index, candidate), index, events, roots, surfaces, bytes };
}
const run = (s) => fetcher.fetchInputs(s.cells, s.deps);
const rewrite = (s) => {
  s.deps.indexBytes = Buffer.from(JSON.stringify(s.index));
  s.deps.indexSha256 = hash(s.deps.indexBytes);
  s.cells = selectCells(s.index, s.deps.candidate);
};

describe("trusted fetch handoff", () => {
  it("admits both external inventories before closing credentials and returning all cells", async () => {
    const s = setup();
    const result = await run(s);
    expect(result).toEqual({
      cells: s.cells.map((c, i) => ({
        cellId: c.id,
        state: {
          root: `/owned/${i * 2}`,
          ownerId: `owner-${i * 2}`,
          inventory: [file("facts.json")],
          archiveSha256: hash(s.bytes),
        },
        evidence: {
          root: `/owned/${i * 2 + 1}`,
          ownerId: `owner-${i * 2 + 1}`,
          inventory: [file("facts.json")],
          archiveSha256: hash(s.bytes),
        },
      })),
      trustedRevision: sha(4),
      indexSha256: s.deps.indexSha256,
      credentialScopeClosed: true,
    });
    expect(s.events.slice(-2)).toEqual([["transport-closed"], ["scope-closed"]]);
    expect(s.roots.every((r) => !r.disposed)).toBe(true);
  });
  it.each([
    "index checksum",
    "index duplicate key",
    "index missing inventory",
    "index aliased inventory",
    "missing facts",
    "wrong epoch",
    "wrong cell",
    "empty cells",
    "wrong revision",
  ])("refuses %s before transport or placement", async (fault) => {
    const s = setup();
    if (fault === "index checksum") s.deps.indexSha256 = h(9);
    if (fault === "index duplicate key") {
      s.deps.indexBytes = Buffer.from(
        s.deps.indexBytes.toString().replace('"version":1', '"version":1,"version":1'),
      );
      s.deps.indexSha256 = hash(s.deps.indexBytes);
    }
    if (fault === "index missing inventory") {
      delete s.index.fixtures[0].evidence.inventory;
      s.deps.indexBytes = Buffer.from(JSON.stringify(s.index));
      s.deps.indexSha256 = hash(s.deps.indexBytes);
    }
    if (fault === "index aliased inventory") {
      s.index.fixtures[1].evidence.inventory = [file("../facts.json")];
      s.deps.indexBytes = Buffer.from(JSON.stringify(s.index));
      s.deps.indexSha256 = hash(s.deps.indexBytes);
    }
    if (fault === "missing facts") {
      s.index.fixtures[1].evidence.inventory = [file("other.json")];
      rewrite(s);
    }
    if (fault === "wrong epoch") s.cells[0].fixture.epochId = "before-reset";
    if (fault === "wrong cell") s.cells[0].id = "substitute";
    if (fault === "empty cells") s.cells = [];
    if (fault === "wrong revision") s.deps.trustedRevision = "mutable-main";
    await expect(run(s)).rejects.toThrow(/^fetch\.(index|cells|facts)/);
    expect(s.events.filter(([e]) => e === "fetch")).toEqual([]);
    expect(s.roots).toEqual([]);
    expect(s.events.slice(-2)).toEqual([["transport-closed"], ["scope-closed"]]);
  });
  it.each(["short", "extra", "corrupt", "wrong hash"])(
    "refuses %s archive bytes and disposes every owned root",
    async (fault) => {
      const s = setup();
      let bytes = s.bytes;
      if (fault === "short") bytes = bytes.subarray(0, -1);
      if (fault === "extra") bytes = Buffer.concat([bytes, Buffer.from([0])]);
      if (fault === "corrupt") {
        bytes = Buffer.from(bytes);
        bytes[20] ^= 1;
      }
      if (fault === "wrong hash") {
        s.index.fixtures[0].bundle.sha256 = h(9);
        rewrite(s);
      }
      s.deps.transport.fetch = () => chunks(bytes);
      await expect(run(s)).rejects.toThrow(/^(fetch\.(size|hash)|archive\.)/);
      expect(s.roots.every((r) => r.disposed)).toBe(true);
    },
  );
  it("does not retain the first verified asset after the second fails", async () => {
    const s = setup();
    s.deps.transport.fetch = (a) => chunks(a.assetId === 1 ? s.bytes : s.bytes.subarray(0, -1));
    await expect(run(s)).rejects.toThrow("fetch.size");
    expect(s.roots.length).toBe(2);
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
  it("retries only transient retrieval failures with fresh owned roots", async () => {
    const s = setup();
    let attempts = 0;
    s.deps.transport.fetch = () => {
      attempts++;
      if (attempts < 3) throw new Error("fetch.transient: sentinel");
      return chunks(s.bytes);
    };
    expect((await run(s)).credentialScopeClosed).toBe(true);
    expect(attempts).toBe(6);
    expect(s.roots.slice(0, 2).every((r) => r.disposed)).toBe(true);
    expect(s.roots.slice(2).every((r) => !r.disposed)).toBe(true);
  });
  it("fails distinctly after the finite retry schedule", async () => {
    const s = setup();
    let attempts = 0;
    s.deps.transport.fetch = () => {
      attempts++;
      throw new Error("fetch.transient: sentinel");
    };
    await expect(run(s)).rejects.toThrow("fetch.exhausted");
    expect(attempts).toBe(3);
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
  it.each(Object.keys(setup().surfaces))("refuses credential residue in %s", async (surface) => {
    const s = setup();
    s.surfaces[surface] = ["SENTINEL-CREDENTIAL"];
    let error;
    try {
      await run(s);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/^fetch.credentials:/);
    expect(error?.message).not.toContain("SENTINEL-CREDENTIAL");
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
  it.each(["transport", "scope", "scratch"])(
    "does not expose an adapter's secret %s error",
    async (where) => {
      const s = setup();
      if (where === "transport")
        s.deps.transport.fetch = () => {
          throw new Error("SENTINEL-CREDENTIAL");
        };
      if (where === "scope")
        s.deps.credentialScope.close = async () => {
          throw new Error("SENTINEL-CREDENTIAL");
        };
      if (where === "scratch")
        s.deps.scratch = async () => {
          throw new Error("SENTINEL-CREDENTIAL");
        };
      let error;
      try {
        await run(s);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toMatch(
        new RegExp(`^fetch.${where === "scope" ? "credentials" : where}:`),
      );
      expect(error.message).not.toContain("SENTINEL-CREDENTIAL");
      expect(s.roots.every((r) => r.disposed)).toBe(true);
    },
  );
  it("bounds a stalled body and closes credentials on deadline", async () => {
    const s = setup();
    s.deps.deadlines.totalMs = 10;
    s.deps.transport.fetch = () => ({
      async *[Symbol.asyncIterator]() {
        yield await new Promise(() => {});
      },
    });
    await expect(run(s)).rejects.toThrow("fetch.deadline");
    expect(s.roots.every((r) => r.disposed)).toBe(true);
    expect(s.events.slice(-2)).toEqual([["transport-closed"], ["scope-closed"]]);
  });
  it("honours external cancellation", async () => {
    const s = setup();
    const controller = new globalThis.AbortController();
    s.deps.signal = controller.signal;
    controller.abort();
    await expect(run(s)).rejects.toThrow("fetch.cancelled");
    expect(s.events.filter(([e]) => e === "fetch")).toEqual([]);
  });
  it("reports unresolved owned-root cleanup separately", async () => {
    const s = setup();
    const scratch = s.deps.scratch;
    s.deps.scratch = async () => {
      const v = await scratch();
      v.dispose = async () => {
        throw new Error("secret");
      };
      return v;
    };
    s.deps.transport.fetch = () => chunks(s.bytes.subarray(0, -1));
    await expect(run(s)).rejects.toThrow("fetch.cleanup");
  });
});

const response = (status, value, headers = {}) => ({
  status,
  headers,
  body: chunks(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))),
});
function httpSetup() {
  const s = setup();
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith("/releases/100"))
      return response(200, {
        tag_name: "release-1",
        assets: [{ id: 1, name: "1.a799.gz", size: s.bytes.length }],
      });
    if (url.includes("/git/ref/tags/"))
      return response(200, { object: { type: "commit", sha: sha(1) } });
    return response(200, s.bytes);
  };
  return { ...s, requests, request, asset: s.cells[0].fixture.bundle };
}
async function download(s) {
  const transport = fetcher.createGitHubTransport({
    request: s.request,
    credential: "SENTINEL-CREDENTIAL",
    metadataBytes: 4096,
    maxRedirects: 2,
  });
  try {
    const out = [];
    for await (const b of transport.fetch(s.asset, sha(1), new globalThis.AbortController().signal))
      out.push(b);
    return Buffer.concat(out);
  } finally {
    await transport.close();
  }
}
describe("pinned GitHub release transport", () => {
  it("binds the source tag, release membership and exact asset request to the Waitron repository", async () => {
    const s = httpSetup();
    expect(await download(s)).toEqual(s.bytes);
    expect(s.requests.map((r) => r.url)).toEqual([
      "https://api.github.com/repos/clintongormley/waitron/releases/100",
      "https://api.github.com/repos/clintongormley/waitron/git/ref/tags/release-1",
      "https://api.github.com/repos/clintongormley/waitron/releases/assets/1",
    ]);
    expect(
      s.requests.every(
        (r) => r.headers.Authorization === "Bearer SENTINEL-CREDENTIAL" && r.redirect === "manual",
      ),
    ).toBe(true);
  });
  it.each([401, 403, 404, 429, 500])(
    "classifies HTTP %s without response secrets",
    async (status) => {
      const s = httpSetup();
      s.request = async () => response(status, "SENTINEL-CREDENTIAL");
      await expect(download(s)).rejects.toThrow(
        status >= 429 ? "fetch.transient" : `fetch.http_${status}`,
      );
    },
  );
  it.each(["source", "asset", "name", "size", "metadata overflow", "duplicate JSON"])(
    "refuses wrong %s release evidence",
    async (fault) => {
      const s = httpSetup();
      const request = s.request;
      s.request = async (url, options) => {
        if (fault === "source" && url.includes("/git/ref/"))
          return response(200, { object: { type: "commit", sha: sha(9) } });
        if (url.endsWith("/releases/100")) {
          const asset = {
            id: fault === "asset" ? 2 : 1,
            name: fault === "name" ? "other" : "1.a799.gz",
            size: fault === "size" ? 1 : s.bytes.length,
          };
          if (fault === "metadata overflow") return response(200, Buffer.alloc(4097));
          if (fault === "duplicate JSON")
            return response(
              200,
              Buffer.from('{"tag_name":"release-1","tag_name":"other","assets":[]}'),
            );
          return response(200, { tag_name: "release-1", assets: [asset] });
        }
        return request(url, options);
      };
      await expect(download(s)).rejects.toThrow(/^fetch\.(source|asset|metadata)/);
    },
  );
  it("follows an annotated tag to its pinned commit", async () => {
    const s = httpSetup();
    const request = s.request;
    s.request = async (url, options) => {
      if (url.includes("/git/ref/")) return response(200, { object: { type: "tag", sha: sha(7) } });
      if (url.endsWith(`/git/tags/${sha(7)}`))
        return response(200, { object: { type: "commit", sha: sha(1) } });
      return request(url, options);
    };
    expect(await download(s)).toEqual(s.bytes);
  });
  it("strips authorization on the allowed cross-origin asset redirect", async () => {
    const s = httpSetup();
    const request = s.request;
    s.request = async (url, options) => {
      if (url.endsWith("/assets/1")) {
        s.requests.push({ url, ...options });
        return response(302, null, {
          location: "https://release-assets.githubusercontent.com/path?signed=value",
        });
      }
      return request(url, options);
    };
    expect(await download(s)).toEqual(s.bytes);
    expect(s.requests.at(-1).url).toBe(
      "https://release-assets.githubusercontent.com/path?signed=value",
    );
    expect(s.requests.at(-1).headers).not.toHaveProperty("Authorization");
  });
  it.each([
    "https://evil.test/a",
    "http://release-assets.githubusercontent.com/a",
    "https://release-assets.githubusercontent.com.evil.test/a",
    "https://user:pass@release-assets.githubusercontent.com/a",
    "https://release-assets.githubusercontent.com:444/a",
    "https://api.github.com/other",
  ])("refuses redirect %s before sending it a request", async (url) => {
    const s = httpSetup();
    const request = s.request;
    s.request = (u, o) =>
      u.endsWith("/assets/1") ? response(302, null, { location: url }) : request(u, o);
    await expect(download(s)).rejects.toThrow("fetch.redirect");
    expect(s.requests.some((r) => r.url === url)).toBe(false);
  });
  it("bounds redirect cycles", async () => {
    const s = httpSetup();
    const request = s.request;
    let redirects = 0;
    s.request = (u, o) => {
      if (u.endsWith("/assets/1") || u.startsWith("https://objects.githubusercontent.com/")) {
        redirects++;
        return response(302, null, { location: "https://objects.githubusercontent.com/a" });
      }
      return request(u, o);
    };
    await expect(download(s)).rejects.toThrow("fetch.redirect");
    expect(redirects).toBe(3);
  });
  it("removes its credential and refuses subsequent transport use", async () => {
    const s = httpSetup();
    const transport = fetcher.createGitHubTransport({
      request: s.request,
      credential: "SENTINEL-CREDENTIAL",
      metadataBytes: 4096,
      maxRedirects: 2,
    });
    await transport.close();
    await expect(async () => {
      for await (const _ of transport.fetch(
        s.asset,
        sha(1),
        new globalThis.AbortController().signal,
      )) {
        expect(_).toBeInstanceOf(Uint8Array);
      }
    }).rejects.toThrow("fetch.closed");
    expect(s.requests).toEqual([]);
  });
});

describe("handoff refusal controls", () => {
  it("refuses reuse of an admitted root for the next asset", async () => {
    const s = setup();
    const scratch = s.deps.scratch;
    let original;
    s.deps.scratch = async () => {
      original ??= await scratch();
      return original;
    };
    await expect(run(s)).rejects.toThrow("fetch.scratch");
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
  it("waits for cancellation during credential closure before deciding whether to hand off", async () => {
    const s = setup();
    const controller = new globalThis.AbortController();
    s.deps.signal = controller.signal;
    const close = s.deps.credentialScope.close;
    s.deps.credentialScope.close = async () => {
      controller.abort();
      return close();
    };
    await expect(run(s)).rejects.toThrow("fetch.cancelled");
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
  it("bounds successful fetch plus credential closure by the total deadline", async () => {
    const s = setup();
    s.deps.deadlines.totalMs = 10;
    const close = s.deps.credentialScope.close;
    s.deps.credentialScope.close = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return close();
    };
    await expect(run(s)).rejects.toThrow("fetch.deadline");
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
});

describe("strict input and transport failure paths", () => {
  it.each([
    "",
    "{",
    '{"x" 1}',
    '{"x":1;"y":2}',
    "{x:1}",
    "[] trailing",
    '{"x":"unterminated}',
    '{"x":' + "[".repeat(66) + "0" + "]".repeat(66) + "}",
    '{"x":1,"\\u0078":2}',
  ])("refuses malformed index JSON %# before network activity", async (body) => {
    const s = setup();
    s.deps.indexBytes = Buffer.from(body);
    s.deps.indexSha256 = hash(s.deps.indexBytes);
    await expect(run(s)).rejects.toThrow("fetch.index");
    expect(s.roots).toEqual([]);
  });
  it("accepts insignificant JSON whitespace and escaped strings in a committed index", async () => {
    const s = setup();
    s.index.fixtures[0].reviewReceipt = 'review "quoted"';
    s.deps.indexBytes = Buffer.from(JSON.stringify(s.index, null, 2));
    s.deps.indexSha256 = hash(s.deps.indexBytes);
    s.cells = selectCells(s.index, s.deps.candidate);
    expect((await run(s)).cells.length).toBe(2);
  });
  it.each(["deadline", "cleanup", "retries", "inventory", "asset cap"])(
    "refuses invalid %s contract before network activity",
    async (fault) => {
      const s = setup();
      if (fault === "deadline") s.deps.deadlines.totalMs = 0;
      if (fault === "cleanup") s.deps.deadlines.cleanupMs = 0;
      if (fault === "retries") s.deps.retrySchedule = [-1];
      if (fault === "inventory") {
        s.index.fixtures[1].bundle.inventory[0].mode = 420;
        rewrite(s);
      }
      if (fault === "asset cap") {
        s.index.fixtures[1].bundle.bytes = 5000;
        rewrite(s);
      }
      await expect(run(s)).rejects.toThrow("fetch.index");
      expect(s.events.filter(([e]) => e === "fetch")).toEqual([]);
    },
  );
  it("does not retry a nonbinary retrieval body", async () => {
    const s = setup();
    s.deps.transport.fetch = () =>
      (async function* () {
        yield "secret";
      })();
    await expect(run(s)).rejects.toThrow("fetch.transport");
    expect(s.roots.length).toBe(1);
    expect(s.roots[0].disposed).toBe(true);
  });
  it("sanitizes a thrown non-Error value", async () => {
    const s = setup();
    s.deps.transport.fetch = () => {
      throw "SENTINEL";
    };
    await expect(run(s)).rejects.toThrow("fetch.transport: input handoff refused");
  });
  it("can use an explicit total deadline without a parent signal", async () => {
    const s = setup();
    delete s.deps.signal;
    expect((await run(s)).credentialScopeClosed).toBe(true);
  });
  it.each(["transport close", "scope close", "stalled scope"])(
    "refuses %s and disposes all retained assets",
    async (fault) => {
      const s = setup();
      if (fault === "transport close")
        s.deps.transport.close = async () => {
          throw new Error("SENTINEL");
        };
      if (fault === "scope close")
        s.deps.credentialScope.close = async () => ({ closed: false, surfaces: s.surfaces });
      if (fault === "stalled scope") {
        s.deps.deadlines.cleanupMs = 10;
        s.deps.credentialScope.close = () => new Promise(() => {});
      }
      await expect(run(s)).rejects.toThrow("fetch.credentials");
      expect(s.roots.every((r) => r.disposed)).toBe(true);
    },
  );
  it.each([401, 403, 404, 418, 408, 429, 503])(
    "uses real HTTP refusal %s through the handoff",
    async (status) => {
      const s = setup();
      let attempts = 0;
      s.deps.transport = fetcher.createGitHubTransport({
        request: async () => {
          attempts++;
          return response(status, null);
        },
        credential: "SENTINEL-CREDENTIAL",
        metadataBytes: 4096,
        maxRedirects: 2,
      });
      await expect(run(s)).rejects.toThrow(
        status === 408 || status === 429 || status >= 500
          ? "fetch.exhausted"
          : status === 418
            ? "fetch.http:"
            : `fetch.http_${status}`,
      );
      expect(attempts).toBe([408, 429, 503].includes(status) ? 3 : 1);
      expect(s.roots.every((r) => r.disposed)).toBe(true);
    },
  );
  it.each([
    "request throw",
    "cancelled request",
    "response shape",
    "metadata bytes",
    "bad tag",
    "cyclic tag",
    "relative redirect",
  ])("refuses %s at the HTTP boundary", async (fault) => {
    const s = httpSetup();
    const request = s.request;
    s.request = (url, options) => {
      if (fault === "request throw") throw new Error("SENTINEL");
      if (fault === "cancelled request") {
        options.signal.throwIfAborted();
        return Promise.reject(new Error("SENTINEL"));
      }
      if (fault === "response shape") return { status: 200, body: null };
      if (fault === "metadata bytes")
        return {
          status: 200,
          headers: {},
          body: (async function* () {
            yield "SENTINEL";
          })(),
        };
      if (
        (fault === "bad tag" || fault === "cyclic tag") &&
        (url.includes("/git/ref/") || url.includes("/git/tags/"))
      )
        return response(200, {
          object: { type: "tag", sha: fault === "bad tag" ? "invalid" : sha(9) },
        });
      if (fault === "relative redirect" && url.endsWith("/assets/1"))
        return response(302, null, { location: "/relative" });
      return request(url, options);
    };
    await expect(download(s)).rejects.toThrow(
      /^fetch\.(transient|transport|metadata|source|redirect)/,
    );
  });
  it("reports cancellation of the real request signal", async () => {
    const s = httpSetup();
    const controller = new globalThis.AbortController();
    s.request = async () => {
      controller.abort();
      throw new Error("SENTINEL");
    };
    const transport = fetcher.createGitHubTransport({
      request: s.request,
      credential: "SENTINEL-CREDENTIAL",
      metadataBytes: 4096,
      maxRedirects: 2,
    });
    await expect(async () => {
      for await (const b of transport.fetch(s.asset, sha(1), controller.signal))
        expect(b).toBeDefined();
    }).rejects.toThrow("fetch.cancelled");
    await transport.close();
  });
  it("refuses closure between source validation and the asset request", async () => {
    const s = httpSetup();
    const request = s.request;
    let transport;
    s.request = async (url, options) => {
      const r = await request(url, options);
      if (url.includes("/git/ref/")) await transport.close();
      return r;
    };
    transport = fetcher.createGitHubTransport({
      request: s.request,
      credential: "SENTINEL-CREDENTIAL",
      metadataBytes: 4096,
      maxRedirects: 2,
    });
    await expect(async () => {
      for await (const b of transport.fetch(
        s.asset,
        sha(1),
        new globalThis.AbortController().signal,
      ))
        expect(b).toBeDefined();
    }).rejects.toThrow("fetch.closed");
    expect(s.requests.length).toBe(2);
  });
  it.each(["bounds", "asset", "source"])("requires explicit %s transport inputs", async (fault) => {
    const s = httpSetup();
    if (fault === "bounds")
      expect(() =>
        fetcher.createGitHubTransport({
          request: s.request,
          credential: "SENTINEL",
          metadataBytes: 0,
          maxRedirects: 2,
        }),
      ).toThrow("fetch.transport");
    else {
      if (fault === "asset") s.asset.assetId = -1;
      const transport = fetcher.createGitHubTransport({
        request: s.request,
        credential: "SENTINEL",
        metadataBytes: 4096,
        maxRedirects: 2,
      });
      await expect(async () => {
        for await (const b of transport.fetch(
          s.asset,
          fault === "source" ? "main" : sha(1),
          new globalThis.AbortController().signal,
        ))
          expect(b).toBeDefined();
      }).rejects.toThrow("fetch.asset");
      await transport.close();
    }
  });
});

describe("transport ownership", () => {
  it("aborts its HTTP request signals when its credential scope closes", async () => {
    const s = httpSetup();
    const transport = fetcher.createGitHubTransport({
      request: s.request,
      credential: "SENTINEL",
      metadataBytes: 4096,
      maxRedirects: 2,
    });
    for await (const b of transport.fetch(s.asset, sha(1), new globalThis.AbortController().signal))
      expect(b).toEqual(s.bytes);
    await transport.close();
    expect(s.requests.every((r) => r.signal.aborted)).toBe(true);
  });
  it("aborts the retrieval signal after a failed or successful handoff", async () => {
    const s = setup();
    const signals = [];
    const transport = s.deps.transport.fetch;
    s.deps.transport.fetch = (asset, source, signal) => {
      signals.push(signal);
      return transport(asset, source, signal);
    };
    await run(s);
    expect(signals.length).toBe(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe("scratch allocation custody", () => {
  it("collects and disposes a scratch allocation that finishes after the fetch deadline", async () => {
    const s = setup();
    s.deps.deadlines.totalMs = 10;
    const scratch = s.deps.scratch;
    s.deps.scratch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return scratch();
    };
    await expect(run(s)).rejects.toThrow("fetch.deadline");
    expect(s.roots.length).toBe(1);
    expect(s.roots[0].disposed).toBe(true);
  });
});

it("reports a scratch allocation that never settles as unresolved cleanup", async () => {
  const s = setup();
  s.deps.deadlines.totalMs = 10;
  s.deps.deadlines.cleanupMs = 10;
  s.deps.scratch = () => new Promise(() => {});
  await expect(run(s)).rejects.toThrow("fetch.cleanup");
  expect(s.roots).toEqual([]);
});
it("recognizes a cancelled scratch request that rejects without creating a root", async () => {
  const s = setup();
  s.deps.deadlines.totalMs = 10;
  s.deps.scratch = ({ signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
  await expect(run(s)).rejects.toThrow("fetch.deadline");
  expect(s.roots).toEqual([]);
});

describe("reviewed custody and HTTP boundaries", () => {
  it("keeps unresolved allocation ahead of closure and deadline failures", async () => {
    const s = setup();
    s.deps.deadlines = { totalMs: 10, cleanupMs: 20 };
    s.deps.scratch = () => new Promise(() => {});
    s.deps.transport.close = () => new Promise(() => {});
    await expect(run(s)).rejects.toThrow("fetch.cleanup");
  });
  it("keeps credential residue ahead of parent cancellation", async () => {
    const s = setup();
    const controller = new globalThis.AbortController();
    s.deps.signal = controller.signal;
    const close = s.deps.credentialScope.close;
    s.deps.credentialScope.close = async () => {
      s.surfaces.environment = ["SENTINEL"];
      controller.abort();
      return close();
    };
    await expect(run(s)).rejects.toThrow("fetch.credentials");
    expect(s.roots.every((r) => r.disposed)).toBe(true);
  });
  it("closes both credential seats after a malformed signal", async () => {
    const s = setup();
    s.deps.signal = {};
    await expect(run(s)).rejects.toThrow("fetch.index");
    expect(s.events).toEqual([["transport-closed"], ["scope-closed"]]);
  });
  it("retries a real transport body reset with a fresh scratch root", async () => {
    const s = setup();
    const http = httpSetup();
    let requests = 0;
    s.deps.transport = fetcher.createGitHubTransport({
      credential: "SENTINEL",
      metadataBytes: 4096,
      maxRedirects: 2,
      request: async (url, options) => {
        if (url.endsWith("/releases/100"))
          return response(200, {
            tag_name: "release-1",
            assets: s.index.fixtures
              .flatMap((f) => [f.bundle, f.evidence])
              .map((a) => ({ id: a.assetId, name: a.name, size: a.bytes })),
          });
        if (url.includes("/git/ref/"))
          return response(200, { object: { type: "commit", sha: sha(1) } });
        requests++;
        if (requests === 1)
          return {
            status: 200,
            headers: {},
            body: {
              [Symbol.asyncIterator]() {
                let first = true;
                return {
                  next() {
                    if (first) {
                      first = false;
                      return Promise.resolve({ done: false, value: s.bytes.subarray(0, 10) });
                    }
                    return Promise.reject(
                      Object.assign(new Error("SENTINEL"), { code: "ECONNRESET" }),
                    );
                  },
                };
              },
            },
          };
        return http.request(url, options);
      },
    });
    expect((await run(s)).credentialScopeClosed).toBe(true);
    expect(requests).toBe(5);
    expect(s.roots[0].disposed).toBe(true);
  });
  it("accepts a native Response and Headers at an allowed asset redirect", async () => {
    const s = httpSetup();
    const request = s.request;
    s.request = async (url, options) =>
      url.endsWith("/assets/1")
        ? new globalThis.Response(null, {
            status: 302,
            headers: { location: "https://release-assets.githubusercontent.com/file" },
          })
        : request(url, options);
    expect(await download(s)).toEqual(s.bytes);
  });
  it("bounds all stalled cleanup seats within one fetch-plus-cleanup allowance", async () => {
    const s = setup();
    s.deps.deadlines = { totalMs: 20, cleanupMs: 20 };
    s.deps.transport.close = () => new Promise(() => {});
    s.deps.credentialScope.close = () => new Promise(() => {});
    const start = Date.now();
    await expect(run(s)).rejects.toThrow("fetch.credentials");
    expect(Date.now() - start).toBeLessThan(70);
  });
  it("cancels response bodies on both a redirect and an HTTP refusal", async () => {
    const s = httpSetup();
    const request = s.request;
    const closed = [];
    const body = (name) => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true };
          },
          async return() {
            closed.push(name);
            return { done: true };
          },
        };
      },
    });
    s.request = async (url, options) => {
      if (url.endsWith("/assets/1"))
        return {
          status: 302,
          headers: { location: "https://objects.githubusercontent.com/file" },
          body: body("redirect"),
        };
      if (url.startsWith("https://objects."))
        return { status: 404, headers: {}, body: body("refusal") };
      return request(url, options);
    };
    await expect(download(s)).rejects.toThrow("fetch.http_404");
    expect(closed).toEqual(["redirect", "refusal"]);
  });
  it("uses a valid oversized metadata document as its cap control", async () => {
    const s = httpSetup();
    const request = s.request;
    s.request = (url, options) =>
      url.endsWith("/releases/100")
        ? response(
            200,
            Buffer.from(
              JSON.stringify({
                tag_name: "release-1",
                assets: [{ id: 1, name: "1.a799.gz", size: s.bytes.length }],
              }) + " ".repeat(4096),
            ),
          )
        : request(url, options);
    await expect(download(s)).rejects.toThrow("fetch.metadata");
  });
});

describe("shared cleanup reserve", () => {
  it("serializes disposal when a first attempt has not settled", async () => {
    const s = setup();
    s.deps.deadlines = { totalMs: 40, cleanupMs: 40 };
    const scratch = s.deps.scratch;
    let calls = 0;
    s.deps.scratch = async (...args) => {
      const r = await scratch(...args);
      r.dispose = () => {
        calls++;
        return new Promise(() => {});
      };
      return r;
    };
    s.deps.transport.fetch = () => chunks(s.bytes.subarray(0, -1));
    await expect(run(s)).rejects.toThrow("fetch.cleanup");
    expect(calls).toBe(1);
  });
  it("shares the outer cleanup deadline across all retained roots and both closures", async () => {
    const s = setup();
    s.deps.deadlines = { totalMs: 40, cleanupMs: 40 };
    const scratch = s.deps.scratch;
    s.deps.scratch = async (...args) => {
      const r = await scratch(...args);
      r.dispose = () => new Promise(() => {});
      return r;
    };
    s.deps.transport.close = () => new Promise(() => {});
    s.deps.credentialScope.close = () => new Promise(() => {});
    const start = Date.now();
    let error;
    try {
      await run(s);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(Date.now() - start).toBeLessThan(180);
    expect(error.message).toMatch(/^fetch.cleanup:/);
  });
});

it("classifies a reset inside release metadata as retryable", async () => {
  const s = httpSetup();
  s.request = async () => ({
    status: 200,
    headers: {},
    body: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(Object.assign(new Error("SENTINEL"), { code: "ECONNRESET" }));
          },
        };
      },
    },
  });
  await expect(download(s)).rejects.toThrow("fetch.transient");
});
