import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { installationFixture } from "./cloud-installation-fixture.js";
import type { SavedCloudState } from "../src/cloud-client.js";

export async function ownerRecoveryFixture() {
  const calls: unknown[][] = [];
  let status = 200,
    error = "conflict",
    reply: unknown;
  let wait = async () => {};
  const f = await installationFixture(undefined, {
    ownerRecovery: async (values, _saved, _req, res) => {
      calls.push(values);
      await wait();
      res.writeHead(status);
      res.end(JSON.stringify(status === 200 ? reply : { error }));
    },
  });
  onTestFinished(() => f.close());
  const path = join(f.stateDir, "cloud/connection.json");
  const read = async () => JSON.parse(await readFile(path, "utf8")) as SavedCloudState;
  const patch = async (change: (state: SavedCloudState) => void) => {
    const state = await read();
    change(state);
    await writeFile(path, JSON.stringify(state));
  };
  const state = await read();
  const request = {
    requestId: randomUUID(),
    accountId: randomUUID(),
    email: "owner@example.test",
    organisationId: state.view!.registration!.organisationId,
    legalBusinessId: state.view!.registration!.legalBusinessId,
    venueId: state.venueId,
    installationId: state.view!.registration!.installationId,
    publicKey: state.publicKey,
    environment: state.environment,
    countryCode: "ES",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  reply = { requests: [request] };
  return {
    ...f,
    request,
    calls,
    read,
    patch,
    reply: (value: unknown) => {
      reply = value;
    },
    refuse: (code: string, http: number) => {
      error = code;
      status = http;
    },
    hold: (value: () => Promise<void>) => {
      wait = value;
    },
  };
}
