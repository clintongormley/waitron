import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("leaves an unfinished outside attempt when the process is killed inside its callback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "emergency-killed-attempt-"));
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  try {
    const path = join(directory, "incident.json");
    const consumption = {
      eventId: "interrupted-event",
      installationIdentity: "E00000000000000000000000000",
    };
    await writeFile(path, JSON.stringify({ ...consumption, attempts: [] }), { mode: 0o600 });
    const script = join(directory, "attempt.mjs");
    const entry = join(directory, "attempt-input.mjs");
    await writeFile(
      entry,
      `import { withEmergencyAttempt } from ${JSON.stringify(resolve("src/emergency-attempt.ts"))};
          const directory = process.argv[2];
          const path = process.argv[3];
          const consumption = JSON.parse(process.argv[4]);
          await withEmergencyAttempt(directory, path, consumption, async () => {
            console.log("CALLBACK_STARTED");
            await new Promise(() => { setInterval(() => {}, 1000); });
          });`,
    );
    const bundled = spawnSync(
      process.execPath,
      [resolve("../../scripts/bundle-node.mjs"), `${entry}=${script}`],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(bundled.stderr).not.toContain("ERROR");
    expect(bundled.status).toBe(0);
    child = spawn(process.execPath, [script, directory, path, JSON.stringify(consumption)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    exited = new Promise((resolveExit, reject) => {
      child!.once("error", reject);
      child!.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    let output = "";
    const ready = new Promise<void>((resolveReady) => {
      child!.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("CALLBACK_STARTED\n")) resolveReady();
      });
      child!.stderr!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
    });
    const deadline = AbortSignal.timeout(10_000);
    const timedOut = new Promise<never>((_resolve, reject) => {
      deadline.addEventListener(
        "abort",
        () => reject(new Error(`child did not enter its callback: ${output}`)),
        { once: true },
      );
    });
    await Promise.race([
      ready,
      exited.then((result) => {
        throw new Error(`child exited before callback: ${JSON.stringify(result)} ${output}`);
      }),
      timedOut,
    ]);
    expect(child.pid).toBeGreaterThan(0);
    expect(child.kill("SIGKILL")).toBe(true);
    await expect(exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
    const record = JSON.parse(await readFile(path, "utf8"));
    expect(record).toEqual({
      ...consumption,
      attempts: [
        {
          id: expect.any(String),
          startedAt: expect.any(String),
          finishedAt: null,
          outcome: "started",
        },
      ],
    });
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".lock") || name.endsWith(".next")),
    ).toEqual([]);
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
