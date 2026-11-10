import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOX_LEAF_HOSTNAMES } from "./box-name.js";
import { ensureBoxSecrets, type BoxTlsFiles } from "./box-secrets.js";

/** Two boxes' own secrets, minted as the setup start mints them: each its own authority. */
describe("a device trusting the venue's box and a second box answering waitron.local", () => {
  const dirs: string[] = [];
  let venueBox: BoxTlsFiles;
  let secondBox: BoxTlsFiles;

  beforeAll(async () => {
    const mint = async () => {
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-venue-name-"));
      dirs.push(stateDir);
      return ensureBoxSecrets({
        stateDir,
        hostnames: BOX_LEAF_HOSTNAMES,
        now: () => new Date(),
        listIpv4: () => ["192.168.10.5"],
      });
    };
    venueBox = await mint();
    secondBox = await mint();
  }, 60_000);

  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  /** Connects as a device whose only trust anchor is the venue box's authority, asking for waitron.local. */
  async function handshake(served: BoxTlsFiles): Promise<{ authorized: boolean; error?: string }> {
    const server: Server = createServer({
      cert: await readFile(served.certFile),
      key: await readFile(served.keyFile),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const ca = await readFile(venueBox.caCertFile);
    try {
      return await new Promise((resolve) => {
        const socket = connect({ host: "127.0.0.1", port, servername: "waitron.local", ca });
        socket.once("secureConnect", () => {
          resolve({ authorized: socket.authorized });
          socket.destroy();
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
          resolve({ authorized: false, error: error.code });
          socket.destroy();
        });
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("the two boxes' authorities share a name but not a key", async () => {
    const [a, b] = await Promise.all(
      [venueBox, secondBox].map(async (box) => new X509Certificate(await readFile(box.caCertFile))),
    );
    expect(a!.subject).toBe(b!.subject);
    expect(a!.publicKey.equals(b!.publicKey)).toBe(false);
  });

  it("accepts the venue box's own certificate for waitron.local", async () => {
    expect(await handshake(venueBox)).toEqual({ authorized: true });
  });

  it("refuses a second box's certificate for waitron.local", async () => {
    expect(await handshake(secondBox)).toEqual({
      authorized: false,
      error: "CERT_SIGNATURE_FAILURE",
    });
  });
});
