import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type AddressInfo, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEnv } from "./config.js";
import { prepareDevEnv, serverIsListening, waitForDevServer } from "./dev.js";

describe("development print agent", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "dev-print-agent-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("connects to the local HTTP server and keeps agent state inside its own directory", async () => {
    const env = await prepareDevEnv({ WAITRON_STATE_DIR: stateDir });
    expect(readEnv(env, "dev-machine")).toEqual({
      serverUrl: "http://127.0.0.1:8080",
      name: "dev-machine",
      stateDir: join(stateDir, "print-agent"),
      setupPort: 9110,
    });
  });

  it("uses the box HTTPS leaf and caches its public CA without needing port 80", async () => {
    await mkdir(join(stateDir, "tls"));
    await writeFile(join(stateDir, "tls", "server.crt"), "leaf");
    await writeFile(join(stateDir, "tls", "server.key"), "private key");
    await writeFile(join(stateDir, "tls", "ca.crt"), "development CA");
    const env = await prepareDevEnv({ WAITRON_STATE_DIR: stateDir });
    expect(readEnv(env, "dev-machine").serverUrl).toBe("https://127.0.0.1:8080");
    expect(await readFile(join(env.WAITRON_STATE_DIR!, "server-ca.crt"), "utf8")).toBe(
      "development CA",
    );
    await writeFile(join(stateDir, "tls", "ca.crt"), "replacement CA");
    await prepareDevEnv({ WAITRON_STATE_DIR: stateDir });
    expect(await readFile(join(env.WAITRON_STATE_DIR!, "server-ca.crt"), "utf8")).toBe(
      "replacement CA",
    );
  });

  it("keeps HTTP when only one leaf file exists", async () => {
    await mkdir(join(stateDir, "tls"));
    await writeFile(join(stateDir, "tls", "server.crt"), "leaf");
    expect((await prepareDevEnv({ WAITRON_STATE_DIR: stateDir })).WAITRON_SERVER_URL).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("preserves an explicit server and agent options without copying the local CA", async () => {
    const input = {
      WAITRON_STATE_DIR: stateDir,
      WAITRON_SERVER_URL: "https://other-box.test",
      WAITRON_AGENT_NAME: "Kitchen",
      WAITRON_SETUP_PORT: "9120",
    };
    expect(await prepareDevEnv(input)).toEqual({
      ...input,
      WAITRON_STATE_DIR: join(stateDir, "print-agent"),
    });
    expect(input.WAITRON_STATE_DIR).toBe(stateDir);
    await expect(readFile(join(stateDir, "print-agent", "server-ca.crt"))).rejects.toThrow();
  });

  it.each([undefined, "", "  "])(
    "uses the server's source default for unset state %j",
    async (value) => {
      const env = await prepareDevEnv({
        WAITRON_STATE_DIR: value,
        WAITRON_SERVER_URL: "http://127.0.0.1:8080",
      });
      expect(env.WAITRON_STATE_DIR).toBe(
        fileURLToPath(new URL("../../server/src/state/print-agent", import.meta.url)),
      );
    },
  );

  it("treats a blank server URL as local development", async () => {
    expect(
      (await prepareDevEnv({ WAITRON_STATE_DIR: stateDir, WAITRON_SERVER_URL: "  " }))
        .WAITRON_SERVER_URL,
    ).toBe("http://127.0.0.1:8080");
  });
});

describe("development server readiness", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((done) => server!.close(() => done()));
  });

  it("waits for the local listener and rejects a server that never starts", async () => {
    server = createServer((socket) => socket.end());
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;
    await expect(serverIsListening(port)).resolves.toBe(true);
    await expect(waitForDevServer(port)).resolves.toBeUndefined();
    await new Promise<void>((done) => server!.close(() => done()));
    await expect(serverIsListening(port)).resolves.toBe(false);
    await expect(waitForDevServer(port, 0)).rejects.toThrow(
      `Dev server did not listen on port ${port}`,
    );

    // The listener arrives after the first refused connection, like the slower server boot.
    const started = new Promise<void>((done) => {
      setTimeout(() => server!.listen(port, "127.0.0.1", done), 50);
    });
    await waitForDevServer(port);
    await started;
  });
});
