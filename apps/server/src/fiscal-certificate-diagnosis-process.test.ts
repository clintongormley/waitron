import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import { certificateDiagnosisRuntime } from "./fiscal-certificate-diagnosis-runtime.js";

let root: string;
const runners: ReturnType<typeof createCertificateDiagnosisRunner>[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "diagnosis-process-"));
});
afterEach(async ({ task }) => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()));
  vi.unstubAllEnvs();
  if (task.result?.state === "fail") {
    const markers = await Promise.all(
      (await readdir(root)).map(async (name) => ({
        name,
        events: await records(join(root, name)),
      })),
    );
    console.error("Certificate child process diagnostics", markers);
  }
  await rm(root, { recursive: true, force: true });
});
function runner(workMs = 5_000, cleanupMs = 200) {
  const value = createCertificateDiagnosisRunner({
    fiscalId: "fixture",
    entry: new URL("./testing/certificate-diagnosis-child.ts", import.meta.url),
    execArgv: ["--import", import.meta.resolve("tsx")],
    workMs,
    cleanupMs,
  });
  runners.push(value);
  return value;
}
const signal = () => new AbortController().signal;
async function records(marker: string): Promise<{ stage: string; pid: number }[]> {
  try {
    return (await readFile(marker, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
function gone(pid: number) {
  expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
}

describe("owned certificate child lifetime", () => {
  it("resolves only after its exact child exits and permits the next attempt", async () => {
    const value = runner();
    const marker = join(root, "normal");
    await expect(
      value.attempt(async (runChild, abort) => {
        const result = await runChild({ mode: "normal", marker, value: "selected" }, abort);
        gone((await records(marker))[0]!.pid);
        return { result };
      }, signal()),
    ).resolves.toEqual({ result: { outcome: "completed", value: { value: "selected" } } });
    await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
  });

  it.each(["block", "ignore-term", "body", "cleanup"])(
    "aborts %s, observes exit, and releases admission",
    async (mode) => {
      const value = runner();
      const marker = join(root, mode);
      const controller = new AbortController();
      const held = value.attempt(
        async (runChild, abort) => ({ result: await runChild({ mode, marker }, abort) }),
        controller.signal,
      );
      const rejected = expect(held).rejects.toMatchObject({
        code: "fiscal.certificate_diagnosis_unavailable",
        params: {},
      });
      await vi.waitFor(async () => expect(await records(marker)).toHaveLength(1), {
        timeout: 4_000,
      });
      const pid = (await records(marker))[0]!.pid;
      controller.abort();
      await rejected;
      gone(pid);
      await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
    },
  );

  it("includes startup in the work deadline and never releases late evidence", async () => {
    const value = runner(1, 200);
    const at = performance.now();
    await expect(
      value.attempt(
        async (runChild, abort) => ({
          result: await runChild({ mode: "block", marker: join(root, "startup") }, abort),
        }),
        signal(),
      ),
    ).resolves.toEqual({
      result: { outcome: "interrupted", reason: "deadline", lastProgress: null },
    });
    expect(performance.now() - at).toBeLessThan(3_000);
    await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
  });

  it.each([
    "crash",
    "disconnect",
    "malformed",
    "bad-json",
    "oversized-frame",
    "oversized",
    "progress-big",
    "progress-many",
    "output-held",
  ])("turns %s into a fixed interruption without retaining raw content", async (mode) => {
    const value = runner();
    const marker = join(root, mode);
    const result = await value.attempt(
      async (runChild, abort) => ({ result: await runChild({ mode, marker }, abort) }),
      signal(),
    );
    expect(result).toEqual({
      result: {
        outcome: "interrupted",
        reason: "unavailable",
        lastProgress: mode === "progress-many" ? { step: 15 } : null,
      },
    });
    gone((await records(marker))[0]!.pid);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("stops an active child and permanently closes admission", async () => {
    const value = runner();
    const marker = join(root, "stop");
    const held = value.attempt(
      async (runChild, abort) => ({
        result: await runChild({ mode: "ignore-term", marker }, abort),
      }),
      signal(),
    );
    const rejected = expect(held).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
    });
    await vi.waitFor(async () => expect(await records(marker)).toHaveLength(1), { timeout: 4_000 });
    await value.stop();
    await rejected;
    gone((await records(marker))[0]!.pid);
    await expect(value.attempt(async () => null, signal())).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
    });
  });

  it("does not forward credential environments, NODE_OPTIONS or secret command arguments", async () => {
    vi.stubEnv("DIAGNOSIS_PRIVATE_CREDENTIAL", "PRIVATE SECRET");
    vi.stubEnv("NODE_OPTIONS", "--no-warnings");
    vi.stubEnv("TZ", "UTC");
    const result = await runner().attempt(
      async (runChild, abort) => ({
        result: await runChild({ mode: "environment", marker: join(root, "environment") }, abort),
      }),
      signal(),
    );
    const completed = (
      result as { result: { value: { env: Record<string, string>; argv: string[] } } }
    ).result.value;
    expect(completed.env.TZ).toBe("UTC");
    expect(completed.env).not.toHaveProperty("DIAGNOSIS_PRIVATE_CREDENTIAL");
    expect(completed.env).not.toHaveProperty("NODE_OPTIONS");
    const platformKeys = process.platform === "darwin" ? ["__CF_USER_TEXT_ENCODING"] : [];
    expect(
      Object.keys(completed.env).filter(
        (key) =>
          ![
            "PATH",
            "LANG",
            "LC_ALL",
            "TZ",
            "NODE_EXTRA_CA_CERTS",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            ...platformKeys,
          ].includes(key),
      ),
    ).toEqual([]);
    expect(completed.argv).toEqual([]);
  });

  it("refuses oversized input and a second child in one attempt", async () => {
    const value = runner();
    const marker = join(root, "limit");
    const result = await value.attempt(async (runChild, abort) => {
      const large = await runChild({ value: "x".repeat(208_192) }, abort);
      const again = await runChild({ mode: "normal", marker }, abort);
      return { large, again };
    }, signal());
    expect(result).toEqual({
      large: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
      again: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
    });
    expect(await records(marker)).toEqual([]);
  });

  it("applies the work deadline to a recorded child stuck in synchronous opening", async () => {
    const value = runner(1_500, 200);
    const marker = join(root, "native-deadline");
    const at = performance.now();
    const held = value.attempt(
      async (runChild, abort) => ({
        result: await runChild({ mode: "ignore-term", marker }, abort),
      }),
      signal(),
    );
    await vi.waitFor(async () => expect(await records(marker)).toHaveLength(1), { timeout: 1_400 });
    await expect(held).resolves.toEqual({
      result: { outcome: "interrupted", reason: "deadline", lastProgress: null },
    });
    gone((await records(marker))[0]!.pid);
    expect(performance.now() - at).toBeLessThan(3_000);
    await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
  });

  it("uses the resolved source loader only for a source entry", () => {
    const runtime = certificateDiagnosisRuntime();
    expect(runtime.entry.pathname).toMatch(/fiscal-certificate-diagnosis-entry\.ts$/);
    expect(runtime.execArgv).toEqual(["--import", import.meta.resolve("tsx")]);
  });

  it("retains only the latest validated observation when the child exits before a result", async () => {
    const marker = join(root, "progress-crash");
    const value = runner();
    await expect(
      value.attempt(
        async (runChild, abort) => ({
          result: await runChild({ mode: "progress-crash", marker }, abort),
        }),
        signal(),
      ),
    ).resolves.toEqual({
      result: {
        outcome: "interrupted",
        reason: "unavailable",
        lastProgress: { stage: "response", category: "http-response", httpStatus: 403 },
      },
    });
    gone((await records(marker))[0]!.pid);
  });
});
