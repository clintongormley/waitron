import { createServer } from "node:http";
import { TextEncoder } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { downloadRelease } from "./download-release.mjs";

const URL_ = "https://github.com/example/tool/releases/download/v1.0.0/tool.tar.gz";

const answer = (status, body = "") => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: { 200: "OK", 404: "Not Found", 503: "Service Unavailable", 504: "Gateway Timeout" }[
    status
  ],
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

/** A fetch that plays `steps` in order: a number is an answer's status, an Error is thrown. */
function scripted(...steps) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const step = steps[calls.length - 1];
    if (step instanceof Error) throw step;
    return answer(step, "release bytes");
  };
  return { fetch, calls };
}

function recordingSleep() {
  const waits = [];
  return { sleep: async (ms) => void waits.push(ms), waits };
}

function recordingLog() {
  const lines = [];
  return { log: (line) => void lines.push(line), lines };
}

let server;

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

/** A local server that answers 200 and part of the body, then never sends the rest. */
async function stallingServer() {
  const seen = { requests: 0 };
  server = createServer((request, response) => {
    seen.requests += 1;
    response.writeHead(200, { "Content-Length": "1000" });
    response.write("partial");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/tool.tar.gz`, seen };
}

/** A local server that refuses with `status` and part of a body it never finishes. */
async function refusingServer(status) {
  let closed;
  const responseClosed = new Promise((resolve) => {
    closed = resolve;
  });
  server = createServer((request, response) => {
    response.writeHead(status, { "Content-Length": "1000" });
    response.write("partial");
    response.once("close", closed);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/tool.tar.gz`, responseClosed };
}

describe("downloadRelease", () => {
  it("retries a 504 and returns the bytes of the answer that succeeds", async () => {
    const { fetch, calls } = scripted(504, 200);
    const { sleep } = recordingSleep();
    const { log, lines } = recordingLog();
    const bytes = await downloadRelease(URL_, { fetch, sleep, log, env: {} });
    expect(bytes.toString()).toBe("release bytes");
    expect(calls).toHaveLength(2);
    expect(lines).toEqual([`${URL_} answered 504 Gateway Timeout after 1 attempt; trying again`]);
  });

  it("gives up after three 5xx answers, naming the URL, the last status and the attempts", async () => {
    const { fetch, calls } = scripted(503, 504, 503);
    const { sleep, waits } = recordingSleep();
    const { log, lines } = recordingLog();
    await expect(downloadRelease(URL_, { fetch, sleep, log, env: {} })).rejects.toThrow(
      `${URL_} answered 503 Service Unavailable after 3 attempts`,
    );
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 4000]);
    expect(lines).toEqual([
      `${URL_} answered 503 Service Unavailable after 1 attempt; trying again`,
      `${URL_} answered 504 Gateway Timeout after 2 attempts; trying again`,
    ]);
  });

  it("fails at once on a 404", async () => {
    const { fetch, calls } = scripted(404, 200);
    const { sleep, waits } = recordingSleep();
    const { log, lines } = recordingLog();
    await expect(downloadRelease(URL_, { fetch, sleep, log, env: {} })).rejects.toThrow(
      `${URL_} answered 404 Not Found after 1 attempt`,
    );
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("retries a network error", async () => {
    const { fetch, calls } = scripted(new TypeError("fetch failed"), 200);
    const { sleep } = recordingSleep();
    const bytes = await downloadRelease(URL_, { fetch, sleep, env: {} });
    expect(bytes.toString()).toBe("release bytes");
    expect(calls).toHaveLength(2);
  });

  it("names the last network error when every attempt fails to connect", async () => {
    const { fetch } = scripted(new Error("one"), new Error("two"), new Error("timed out"));
    const { sleep } = recordingSleep();
    await expect(downloadRelease(URL_, { fetch, sleep, env: {} })).rejects.toThrow(
      `${URL_} failed after 3 attempts: Error: timed out`,
    );
  });

  it(
    "abandons an attempt whose body stalls past the limit, three times",
    { timeout: 2000 },
    async () => {
      const { url, seen } = await stallingServer();
      const { log, lines } = recordingLog();
      const timedOut = "TimeoutError: The operation was aborted due to timeout";
      await expect(
        downloadRelease(url, { env: {}, log, attemptMs: 100, firstWaitMs: 1 }),
      ).rejects.toThrow(`${url} failed after 3 attempts: ${timedOut}`);
      expect(seen.requests).toBe(3);
      expect(lines).toEqual([
        `${url} failed after 1 attempt: ${timedOut}; trying again`,
        `${url} failed after 2 attempts: ${timedOut}; trying again`,
      ]);
    },
  );

  it.each([
    [404, "Not Found after 1 attempt"],
    [503, "Service Unavailable after 3 attempts"],
  ])(
    "closes a refused %i answer's connection even when its body never finishes",
    { timeout: 2000 },
    async (status, failure) => {
      const { url, responseClosed } = await refusingServer(status);
      const { sleep } = recordingSleep();
      const options = { env: {}, sleep, log: () => {}, attemptMs: 10_000 };
      await expect(downloadRelease(url, options)).rejects.toThrow(
        `${url} answered ${status} ${failure}`,
      );
      await responseClosed;
    },
  );

  it("keeps the status in the failure when closing the refused body fails", async () => {
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      return {
        ...answer(404),
        body: { cancel: async () => Promise.reject(new TypeError("connection reset")) },
      };
    };
    const { sleep } = recordingSleep();
    await expect(downloadRelease(URL_, { fetch, sleep, env: {} })).rejects.toThrow(
      `${URL_} answered 404 Not Found after 1 attempt`,
    );
    expect(calls).toHaveLength(1);
  });

  it("sends GITHUB_TOKEN as a bearer only when it is set and not empty", async () => {
    const headers = async (env) => {
      const { fetch, calls } = scripted(200);
      await downloadRelease(URL_, { fetch, env });
      return calls[0].init.headers;
    };
    expect(await headers({ GITHUB_TOKEN: "secret-value" })).toEqual({
      Authorization: "Bearer secret-value",
    });
    expect(await headers({ GITHUB_TOKEN: "" })).toEqual({});
    expect(await headers({})).toEqual({});
  });

  it("never puts the token in a failure message or a logged line", async () => {
    const { fetch } = scripted(503, 503, 503);
    const { sleep } = recordingSleep();
    const { log, lines } = recordingLog();
    await expect(
      downloadRelease(URL_, { fetch, sleep, log, env: { GITHUB_TOKEN: "secret-value" } }),
    ).rejects.not.toThrow("secret-value");
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("secret-value");
  });

  it("waits for real between attempts by default", async () => {
    const { fetch } = scripted(503, 200);
    const started = Date.now();
    await downloadRelease(URL_, { fetch, env: {}, log: () => {}, firstWaitMs: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
