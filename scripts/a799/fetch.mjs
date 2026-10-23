import { Buffer } from "node:buffer";
import { setTimeout, clearTimeout } from "node:timers";
import { TextDecoder } from "node:util";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  abortable,
  admitArchive,
  validateInventory,
  admissionCode as codeFor,
} from "./archive.mjs";
import { fail, parseIndex } from "./contracts.mjs";
import { selectCells } from "./selection.mjs";

const digest = (b) => createHash("sha256").update(b).digest("hex");
const sourcePattern = /^[0-9a-f]{40}$/;
const scopeFields = [
  "environment",
  "checkoutConfig",
  "credentialHelpers",
  "registryLogins",
  "scratchFiles",
  "subprocessArguments",
  "history",
  "dockerConfig",
];

function json(bytes, code) {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let i = 0;
    const space = () => {
      while (/[\t\r\n ]/.test(source[i] ?? "") && i < source.length) i++;
    };
    function string() {
      const start = i++;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i++] === '"') return JSON.parse(source.slice(start, i));
      }
      throw new Error();
    }
    function value(depth) {
      if (depth > 64) throw new Error();
      space();
      if (source[i] === '"') {
        string();
        return;
      }
      const start = source[i++];
      if (start === "{" || start === "[") {
        const end = start === "{" ? "}" : "]";
        const keys = new Set();
        space();
        if (source[i] === end) {
          i++;
          return;
        }
        for (;;) {
          space();
          if (start === "{") {
            if (source[i] !== '"') throw new Error();
            const key = string();
            if (keys.has(key)) throw new Error();
            keys.add(key);
            space();
            if (source[i++] !== ":") throw new Error();
          }
          value(depth + 1);
          space();
          const next = source[i++];
          if (next === end) return;
          if (next !== ",") throw new Error();
        }
      }
      const begin = i - 1;
      while (i < source.length && !/[\s,}\]]/.test(source[i])) i++;
      JSON.parse(source.slice(begin, i));
    }
    value(0);
    space();
    if (i !== source.length) throw new Error();
    return JSON.parse(source);
  } catch {
    fail(code, "strict UTF-8 JSON required");
  }
}

export function createGitHubTransport({ request, credential, metadataBytes, maxRedirects }) {
  if (
    !Number.isSafeInteger(metadataBytes) ||
    metadataBytes <= 0 ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > 8 ||
    typeof request !== "function" ||
    typeof credential !== "string" ||
    !credential
  )
    fail("fetch.transport", "explicit transport bounds and credential required");
  let closed = false;
  const requests = new globalThis.AbortController();
  const base = "https://api.github.com/repos/clintongormley/waitron";
  function status(response) {
    if (response.status === 408 || response.status === 429 || response.status >= 500)
      fail("fetch.transient", "HTTP retryable refusal");
    if (response.status !== 200)
      fail(
        [401, 403, 404].includes(response.status) ? `fetch.http_${response.status}` : "fetch.http",
        "HTTP refusal",
      );
  }
  async function send(url, accept, authenticated, signal) {
    if (closed) fail("fetch.closed", "transport is closed");
    signal = globalThis.AbortSignal.any([signal, requests.signal]);
    let response;
    try {
      response = await abortable(
        request(url, {
          headers: {
            Accept: accept,
            ...(authenticated ? { Authorization: `Bearer ${credential}` } : {}),
          },
          redirect: "manual",
          signal,
        }),
        signal,
        "fetch.cancelled",
      );
    } catch {
      if (closed) fail("fetch.closed", "transport is closed");
      fail(signal.aborted ? "fetch.cancelled" : "fetch.transient", "request failed");
    }
    if (
      !response ||
      !Number.isInteger(response.status) ||
      (response.status === 200 && !response.body?.[Symbol.asyncIterator])
    )
      fail("fetch.transport", "response contract");
    return response;
  }
  async function closeBody(response, signal) {
    try {
      const body = response.body;
      if (body === null || body === undefined) return;
      await abortable(
        Promise.resolve().then(() =>
          typeof body.cancel === "function"
            ? body.cancel()
            : body[Symbol.asyncIterator]().return?.(),
        ),
        signal,
        "fetch.cancelled",
      );
    } catch {
      fail(signal.aborted ? "fetch.cancelled" : "fetch.transport", "response body closure failed");
    }
  }
  async function requireOk(response, signal) {
    if (response.status !== 200) {
      await closeBody(response, signal);
      status(response);
    }
  }
  async function readBody(iterator, signal) {
    try {
      return await abortable(iterator.next(), signal, "fetch.cancelled");
    } catch {
      fail(signal.aborted ? "fetch.cancelled" : "fetch.transient", "body retrieval failed");
    }
  }
  async function metadata(path, signal) {
    const response = await send(`${base}${path}`, "application/vnd.github+json", true, signal);
    await requireOk(response, signal);
    const out = [];
    let size = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    for (;;) {
      const result = await readBody(iterator, signal);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) fail("fetch.metadata", "binary body required");
      size += result.value.byteLength;
      if (size > metadataBytes) fail("fetch.metadata", "metadata cap exceeded");
      out.push(result.value);
    }
    return json(Buffer.concat(out), "fetch.metadata");
  }
  return {
    async close() {
      credential = "";
      closed = true;
      requests.abort();
    },
    async *fetch(asset, sourceSha, signal) {
      if (closed) fail("fetch.closed", "transport is closed");
      if (
        !sourcePattern.test(sourceSha) ||
        !Number.isSafeInteger(asset.releaseId) ||
        asset.releaseId <= 0 ||
        !Number.isSafeInteger(asset.assetId) ||
        asset.assetId <= 0
      )
        fail("fetch.asset", "pinned source/release/asset required");
      const release = await metadata(`/releases/${asset.releaseId}`, signal);
      const matches = release.assets?.filter((a) => a.id === asset.assetId);
      if (
        !Array.isArray(matches) ||
        matches.length !== 1 ||
        matches[0].name !== asset.name ||
        matches[0].size !== asset.bytes ||
        typeof release.tag_name !== "string" ||
        !release.tag_name
      )
        fail("fetch.asset", "release membership differs");
      let ref = await metadata(`/git/ref/tags/${encodeURIComponent(release.tag_name)}`, signal);
      let tags = 0;
      while (ref?.object?.type === "tag") {
        if (++tags > 8 || !sourcePattern.test(ref.object.sha)) fail("fetch.source", "tag chain");
        ref = await metadata(`/git/tags/${ref.object.sha}`, signal);
      }
      if (ref?.object?.type !== "commit" || ref.object.sha !== sourceSha)
        fail("fetch.source", "release tag differs from frozen source");
      let url = `${base}/releases/assets/${asset.assetId}`;
      for (let redirects = 0; ; redirects++) {
        const response = await send(url, "application/octet-stream", redirects === 0, signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await closeBody(response, signal);
          if (redirects >= maxRedirects) fail("fetch.redirect", "redirect budget");
          let target;
          try {
            target = new globalThis.URL(
              typeof response.headers?.get === "function"
                ? response.headers.get("location")
                : response.headers?.location,
            );
          } catch {
            fail("fetch.redirect", "absolute destination required");
          }
          if (
            target.protocol !== "https:" ||
            target.username ||
            target.password ||
            target.port ||
            target.hash ||
            !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(
              target.hostname,
            )
          )
            fail("fetch.redirect", "destination outside asset-host policy");
          url = target.href;
          continue;
        }
        await requireOk(response, signal);
        const iterator = response.body[Symbol.asyncIterator]();
        for (;;) {
          const result = await readBody(iterator, signal);
          if (result.done) break;
          yield result.value;
        }
        return;
      }
    },
  };
}

export async function fetchInputs(cells, deps) {
  const owned = new Set();
  const usedRoots = new Set();
  let result;
  let failure;
  const controller = new globalThis.AbortController();
  let timer;
  let signal = controller.signal;
  let hardDeadline = Date.now() + 1000;
  const disposing = new Map();
  function remember(code, detail) {
    const rank = (value) =>
      value === "fetch.cleanup"
        ? 4
        : value === "fetch.credentials"
          ? 3
          : ["fetch.deadline", "fetch.cancelled"].includes(value)
            ? 2
            : 1;
    if (!failure || rank(code) > rank(codeFor(failure, "fetch.transport")))
      failure = new Error(`${code}: ${detail}`);
  }
  function cancelled() {
    if (signal.aborted)
      fail(deps.signal?.aborted ? "fetch.cancelled" : "fetch.deadline", "fetch stopped");
  }
  async function cleanupCall(fn) {
    const cleanup = new globalThis.AbortController();
    const remaining = Math.max(
      0,
      Math.min(deps.deadlines?.cleanupMs || 1000, hardDeadline - Date.now()),
    );
    const timeout = setTimeout(() => cleanup.abort(), remaining);
    try {
      return await abortable(Promise.resolve().then(fn), cleanup.signal, "fetch.cleanup");
    } finally {
      clearTimeout(timeout);
    }
  }
  async function dispose(resource) {
    if (!disposing.has(resource))
      disposing.set(
        resource,
        Promise.resolve().then(() => resource.dispose()),
      );
    await cleanupCall(() => disposing.get(resource));
    owned.delete(resource);
  }
  try {
    if (
      !Number.isSafeInteger(deps.deadlines?.totalMs) ||
      deps.deadlines.totalMs <= 0 ||
      !Number.isSafeInteger(deps.deadlines.cleanupMs) ||
      deps.deadlines.cleanupMs <= 0 ||
      !Array.isArray(deps.retrySchedule) ||
      deps.retrySchedule.length > 8 ||
      deps.retrySchedule.some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      fail("fetch.index", "explicit finite budgets required");
    hardDeadline = Date.now() + deps.deadlines.totalMs + deps.deadlines.cleanupMs;
    try {
      signal = deps.signal
        ? globalThis.AbortSignal.any([deps.signal, controller.signal])
        : controller.signal;
    } catch {
      fail("fetch.index", "AbortSignal required");
    }
    timer = setTimeout(() => controller.abort(), deps.deadlines.totalMs);
    cancelled();
    if (
      !(deps.indexBytes instanceof Uint8Array) ||
      deps.indexBytes.length > 1048576 ||
      digest(deps.indexBytes) !== deps.indexSha256 ||
      !sourcePattern.test(deps.trustedRevision)
    )
      fail("fetch.index", "trusted index byte identity required");
    let index;
    let selected;
    try {
      index = parseIndex(json(deps.indexBytes, "fetch.index"));
      selected = selectCells(index, deps.candidate);
    } catch {
      fail("fetch.index", "index or source/candidate admission failed");
    }
    if (!isDeepStrictEqual(cells, selected))
      fail("fetch.cells", "exact required cell set required");
    for (const cell of selected) {
      for (const asset of [cell.fixture.bundle, cell.fixture.evidence]) {
        try {
          validateInventory(asset.inventory, cell.fixture.limits);
        } catch {
          fail("fetch.index", "external inventory invalid");
        }
        if (asset.bytes > cell.fixture.limits.compressedBytes)
          fail("fetch.index", "compressed asset cap");
      }
      if (
        !cell.fixture.evidence.inventory.some((e) => e.path === "facts.json" && e.kind === "file")
      )
        fail("fetch.facts", "external evidence inventory requires facts.json");
    }
    const verified = [];
    async function retrieve(cell, asset, kind) {
      for (let attempt = 0; ; attempt++) {
        cancelled();
        let resource;
        try {
          let allocation;
          try {
            allocation = Promise.resolve(deps.scratch({ cellId: cell.id, kind, signal }));
            resource = await abortable(allocation, signal, "fetch.cancelled");
          } catch {
            if (signal.aborted && allocation) {
              let settled;
              try {
                settled = await cleanupCall(() =>
                  allocation.then(
                    (value) => ({ value }),
                    () => ({ rejected: true }),
                  ),
                );
              } catch {
                fail("fetch.cleanup", "scratch allocation unresolved");
              }
              if (!settled.rejected) {
                resource = settled.value;
                owned.add(resource);
              }
            }
            cancelled();
            fail("fetch.scratch", "owned scratch unavailable");
          }
          if (usedRoots.has(resource?.io?.root))
            fail("fetch.scratch", "fresh independent root required");
          usedRoots.add(resource?.io?.root);
          owned.add(resource);
          let stream;
          try {
            stream = await abortable(
              Promise.resolve().then(() => deps.transport.fetch(asset, cell.sourceSha, signal)),
              signal,
              "fetch.cancelled",
            );
          } catch (error) {
            cancelled();
            fail(codeFor(error, "fetch.transport"), "retrieval refused");
          }
          let size = 0;
          const content = createHash("sha256");
          async function* checked() {
            for await (const bytes of stream) {
              if (!(bytes instanceof Uint8Array)) fail("fetch.transport", "binary body required");
              size += bytes.byteLength;
              if (size > asset.bytes) fail("fetch.size", "extra body bytes");
              content.update(bytes);
              yield bytes;
            }
            if (size !== asset.bytes) fail("fetch.size", "short body");
            if (content.digest("hex") !== asset.sha256)
              fail("fetch.hash", "committed checksum differs");
          }
          const admitted = await admitArchive(checked(), asset.inventory, cell.fixture.limits, {
            ...resource.io,
            signal,
            cleanupMs: deps.deadlines.cleanupMs,
          });
          return admitted;
        } catch (error) {
          if (resource) {
            try {
              await dispose(resource);
            } catch {
              fail("fetch.cleanup", "owned scratch unresolved");
            }
          }
          const code = codeFor(error, "fetch.transport");
          if (code === "fetch.cleanup") fail(code, "owned allocation unresolved");
          cancelled();
          if (code !== "fetch.transient") fail(code, "input admission refused");
          if (attempt >= deps.retrySchedule.length)
            fail("fetch.exhausted", "retrieval retry budget");
          await abortable(delay(deps.retrySchedule[attempt]), signal, "fetch.cancelled");
        }
      }
    }
    for (const cell of selected) {
      const state = await retrieve(cell, cell.fixture.bundle, "state");
      const evidence = await retrieve(cell, cell.fixture.evidence, "evidence");
      verified.push({ cellId: cell.id, state, evidence });
    }
    result = {
      cells: verified,
      trustedRevision: deps.trustedRevision,
      indexSha256: deps.indexSha256,
      credentialScopeClosed: true,
    };
  } catch (error) {
    const code = codeFor(error, "fetch.transport");
    remember(code, "input handoff refused");
    if (signal.aborted)
      remember(
        deps.signal?.aborted ? "fetch.cancelled" : "fetch.deadline",
        "input handoff stopped",
      );
  } finally {
    try {
      await cleanupCall(() => deps.transport.close());
    } catch {
      remember("fetch.credentials", "transport closure failed");
    }
    try {
      const scope = await cleanupCall(() => deps.credentialScope.close());
      if (
        !scope ||
        scope.closed !== true ||
        !scope.surfaces ||
        Object.keys(scope.surfaces).length !== scopeFields.length ||
        scopeFields.some((f) => !Array.isArray(scope.surfaces[f]) || scope.surfaces[f].length)
      )
        fail("fetch.credentials", "credential scope residue");
    } catch {
      remember("fetch.credentials", "credential scope unverified");
    }
    if (signal.aborted)
      remember(
        deps.signal?.aborted ? "fetch.cancelled" : "fetch.deadline",
        "handoff stopped during closure",
      );
    clearTimeout(timer);
    controller.abort();
    if (failure)
      for (const resource of owned) {
        try {
          await dispose(resource);
        } catch {
          remember("fetch.cleanup", "owned scratch unresolved");
        }
      }
  }
  if (failure) throw failure;
  return result;
}
