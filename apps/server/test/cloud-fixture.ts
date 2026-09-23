import { createServer } from "node:http";
import { createPublicKey, verify, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

export async function cloudFixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-cloud-client-"));
  const requests: unknown[][] = [];
  let reject = false;
  let bad = false;
  let approved = false;
  let complete = false;
  let lose = false;
  let unavailable = false;
  let oversized = false;
  let redirect = false;
  const organisationId = randomUUID(),
    legalBusinessId = randomUUID(),
    venueId = randomUUID(),
    installationId = randomUUID();
  let onStatus = async () => {};
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const { payload, signature } = JSON.parse(Buffer.concat(chunks).toString()) as {
      payload: string;
      signature: string;
    };
    const values = JSON.parse(Buffer.from(payload, "base64url").toString()) as string[];
    expect(
      verify(
        null,
        Buffer.from(payload, "base64url"),
        createPublicKey({ key: Buffer.from(values[4]!, "base64url"), format: "der", type: "spki" }),
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(values[0]).toBe("waitron-cloud-pair-v1");
    expect(req.url).toBe(`/api/pairing/${values[2]}`);
    const saved = JSON.parse(await readFile(join(stateDir, "cloud-connection.json"), "utf8"));
    expect(saved.requestId).toBe(values[3]);
    expect(saved.publicKey).toBe(values[4]);
    requests.push(values);
    if (values[2] === "status") await onStatus();
    if (unavailable) {
      res.writeHead(400);
      res.end('{"error":"pairing_unavailable"}');
      return;
    }
    if (oversized) {
      res.end("x".repeat(20000));
      return;
    }
    if (redirect) {
      res.writeHead(302, { location: "/private" });
      res.end();
      return;
    }
    if (reject) {
      res.writeHead(503);
      res.end("{}");
      return;
    }
    if (values[2] === "complete") {
      expect(values.slice(8, 10)).toEqual([organisationId, legalBusinessId]);
      complete = true;
      if (lose) {
        lose = false;
        req.socket.destroy();
        return;
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        requestId: bad ? randomUUID() : values[3],
        localVenueId: values[5],
        environment: values[6],
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        state: complete ? "complete" : approved ? "awaiting_local" : "awaiting_cloud",
        ...(approved
          ? {
              organisationId,
              legalBusinessId,
              organisationName: "Café Sol",
              legalBusinessName: "Sol SL",
            }
          : {}),
        ...(complete
          ? { registration: { venueId, installationId, organisationId, legalBusinessId } }
          : {}),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const origin = `http://127.0.0.1:${address.port}`;
  const options = { stateDir, origin, localVenueId: randomUUID(), environment: "test" as const };
  return {
    stateDir,
    requests,
    options,
    organisationId,
    legalBusinessId,
    installationId,
    loseCompletion: () => {
      lose = true;
    },
    unavailable: () => {
      unavailable = true;
    },
    available: () => {
      unavailable = false;
    },
    oversized: () => {
      oversized = true;
    },
    redirect: () => {
      redirect = true;
    },
    onStatus: (fn: () => Promise<void>) => {
      onStatus = fn;
    },
    reject: () => {
      reject = true;
    },
    accept: () => {
      reject = false;
    },
    bad: () => {
      bad = true;
    },
    approve: () => {
      approved = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}
