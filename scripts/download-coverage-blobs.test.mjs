import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { clearTimeout, setTimeout } from "node:timers";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const scratch = mkdtempSync(join(tmpdir(), "coverage-download-"));
writeFileSync(join(scratch, "blob-1.json"), '{"coverage":1}\n');
execFileSync("zip", ["-q", "report.zip", "blob-1.json"], { cwd: scratch });
const archive = readFileSync(join(scratch, "report.zip"));
const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
writeFileSync(join(scratch, "outside.json"), "unexpected");
execFileSync("zip", ["-q", "wrong.zip", "outside.json"], { cwd: scratch });
execFileSync("zip", ["-q", "multiple.zip", "blob-1.json", "outside.json"], { cwd: scratch });
const otherArchives = {
  "wrong-entry": readFileSync(join(scratch, "wrong.zip")),
  "extra-entry": readFileSync(join(scratch, "multiple.zip")),
  "invalid-zip": Buffer.from("broken zip"),
};
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function fixture(mode = "healthy") {
  const requests = [];
  let cancelled;
  const responseClosed = new Promise((resolve) => {
    cancelled = resolve;
  });
  const artifact = { id: 1, name: "server-blob-1", digest, expired: false };
  const bytes = otherArchives[mode] ?? archive;
  if (otherArchives[mode])
    artifact.digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    if (request.url.includes("/runs/")) {
      if (mode === "list-failure") {
        response.writeHead(503);
        response.write("temporarily unavailable");
        response.once("close", cancelled);
      } else {
        const entries =
          mode === "empty"
            ? []
            : mode === "pagination" && request.url.endsWith("page=1")
              ? Array.from({ length: 100 }, (_, id) => ({ id, name: `other-${id}` }))
              : [artifact];
        if (mode === "expired") artifact.expired = true;
        if (mode === "bad-name") artifact.name = "server-blob-../outside";
        if (mode === "bad-id") artifact.id = "../other";
        if (mode === "bad-digest") artifact.digest = "sha256:" + "0".repeat(64);
        if (mode === "missing-digest") delete artifact.digest;
        if (mode === "duplicate") entries.push(artifact);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ artifacts: entries, total_count: entries.length }));
      }
    } else if (request.url.endsWith("/zip")) {
      response.writeHead(
        mode === "no-redirect" ? 200 : 302,
        mode === "missing-location" ? {} : { location: `${base}/storage.zip` },
      );
      response.end();
    } else if (mode === "blob-failure") {
      response.writeHead(503);
      response.write("retry later");
      response.once("close", cancelled);
    } else {
      response.end(mode === "corrupt" ? Buffer.from("corrupt") : bytes);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = mkdtempSync(join(scratch, "reports-"));
  const options = {
    repository: "waitron/restaurant",
    runId: "42",
    pattern: "server-blob-*",
    directory,
    token: "probe-token",
    apiUrl: base,
  };
  return {
    options,
    directory,
    requests,
    responseClosed,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("coverage artifact downloads", () => {
  it("verifies the archive and extracts the report without sending the API token to storage", async () => {
    const { downloadCoverageBlobs } = await import("./download-coverage-blobs.mjs");
    const rig = await fixture();
    try {
      await downloadCoverageBlobs(rig.options);
      expect(readFileSync(join(rig.directory, "blob-1.json"), "utf8")).toBe('{"coverage":1}\n');
      expect(rig.requests).toEqual([
        {
          path: "/repos/waitron/restaurant/actions/runs/42/artifacts?per_page=100&page=1",
          authorization: "Bearer probe-token",
        },
        {
          path: "/repos/waitron/restaurant/actions/artifacts/1/zip",
          authorization: "Bearer probe-token",
        },
        { path: "/storage.zip", authorization: undefined },
      ]);
    } finally {
      await rig.close();
    }
  });

  it.each(["list-failure", "blob-failure"])(
    "closes a refused %s response whose body never ends",
    async (mode) => {
      const { downloadCoverageBlobs } = await import("./download-coverage-blobs.mjs");
      const rig = await fixture(mode);
      try {
        await expect(downloadCoverageBlobs(rig.options)).rejects.toThrow("503");
        await rig.responseClosed;
        expect(readdirSync(rig.directory)).toEqual([]);
      } finally {
        await rig.close();
      }
    },
  );

  it.each([
    "empty",
    "expired",
    "bad-name",
    "bad-id",
    "bad-digest",
    "missing-digest",
    "duplicate",
    "no-redirect",
    "missing-location",
    "corrupt",
    "wrong-entry",
    "extra-entry",
    "invalid-zip",
  ])("refuses %s before publishing a report", async (mode) => {
    const { downloadCoverageBlobs } = await import("./download-coverage-blobs.mjs");
    const rig = await fixture(mode);
    try {
      await expect(downloadCoverageBlobs(rig.options)).rejects.toThrow();
      expect(readdirSync(rig.directory)).toEqual([]);
    } finally {
      await rig.close();
    }
  });

  it("finds the matching report after a full page of other artifacts", async () => {
    const { downloadCoverageBlobs } = await import("./download-coverage-blobs.mjs");
    const rig = await fixture("pagination");
    try {
      await downloadCoverageBlobs(rig.options);
      expect(readFileSync(join(rig.directory, "blob-1.json"), "utf8")).toBe('{"coverage":1}\n');
      expect(rig.requests[1].path).toBe(
        "/repos/waitron/restaurant/actions/runs/42/artifacts?per_page=100&page=2",
      );
    } finally {
      await rig.close();
    }
  });

  it.each([{ repository: "../restaurant" }, { runId: "../42" }, { token: "" }, { pattern: "*" }])(
    "refuses invalid request inputs %s",
    async (changes) => {
      const { downloadCoverageBlobs } = await import("./download-coverage-blobs.mjs");
      const rig = await fixture();
      try {
        await expect(downloadCoverageBlobs({ ...rig.options, ...changes })).rejects.toThrow();
        expect(rig.requests).toEqual([]);
      } finally {
        await rig.close();
      }
    },
  );

  it("the command exits after a refused response, so the workflow can clear and retry", async () => {
    const rig = await fixture("blob-failure");
    try {
      const child = spawn(
        process.execPath,
        [join(import.meta.dirname, "download-coverage-blobs.mjs"), "server-blob-*", rig.directory],
        {
          env: {
            ...process.env,
            GITHUB_REPOSITORY: "waitron/restaurant",
            GITHUB_RUN_ID: "42",
            GH_TOKEN: "probe-token",
            GITHUB_API_URL: rig.options.apiUrl,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const deadline = setTimeout(() => child.kill("SIGTERM"), 5000);
      let error = "";
      child.stderr.on("data", (chunk) => {
        error += chunk;
      });
      const result = await new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      clearTimeout(deadline);
      expect(result).toEqual({ code: 1, signal: null });
      expect(error).toContain("503");
      await rig.responseClosed;
    } finally {
      await rig.close();
    }
  });

  it.each(["healthy", "blob-failure"])(
    "the command maps the workflow environment to its %s result",
    async (mode) => {
      const rig = await fixture(mode);
      const originalArgv = process.argv;
      const originalExit = process.exitCode;
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        process.argv = [
          process.execPath,
          join(import.meta.dirname, "download-coverage-blobs.mjs"),
          "server-blob-*",
          rig.directory,
        ];
        vi.stubEnv("GITHUB_REPOSITORY", "waitron/restaurant");
        vi.stubEnv("GITHUB_RUN_ID", "42");
        vi.stubEnv("GH_TOKEN", "probe-token");
        vi.stubEnv("GITHUB_API_URL", rig.options.apiUrl);
        vi.resetModules();
        await import("./download-coverage-blobs.mjs");
        if (mode === "healthy") {
          await vi.waitFor(() =>
            expect(readFileSync(join(rig.directory, "blob-1.json"), "utf8")).toBe(
              '{"coverage":1}\n',
            ),
          );
          expect(process.exitCode).toBe(originalExit);
          expect(errors).not.toHaveBeenCalled();
        } else {
          await vi.waitFor(() =>
            expect(errors).toHaveBeenCalledWith("Artifact request refused (503)"),
          );
          expect(process.exitCode).toBe(1);
          await rig.responseClosed;
        }
      } finally {
        process.argv = originalArgv;
        process.exitCode = originalExit;
        vi.unstubAllEnvs();
        errors.mockRestore();
        vi.resetModules();
        await rig.close();
      }
    },
  );
});
