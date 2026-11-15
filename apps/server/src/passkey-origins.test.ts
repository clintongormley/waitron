import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venuePasskeyOrigins } from "./passkey-origins.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function holdChart(): Promise<void> {
  await writeNodeMembership(suite.db, {
    body: {
      term: 3,
      nodes: [
        { nodeId: "a", contactUrl: "https://box-aaaa.waitron.local", standing: "serving-primary" },
        { nodeId: "b", contactUrl: "https://box-bbbb.waitron.local", standing: "evicted" },
        { nodeId: "c", contactUrl: "", standing: "serving-secondary" },
      ],
    },
    signerNodeId: "a",
    signature: "sig",
    endorsements: [],
  });
}

describe("venuePasskeyOrigins", () => {
  it("lists the venue's name and each box the chart holds, leaving out an evicted box and an empty address", async () => {
    await holdChart();

    expect(await venuePasskeyOrigins(suite.db, "https://waitron.local")()).toEqual([
      "https://waitron.local",
      "https://box-aaaa.waitron.local",
    ]);
  });

  it("lists only an https address under the venue's name, as its origin", async () => {
    await writeNodeMembership(suite.db, {
      body: {
        term: 4,
        nodes: [
          {
            nodeId: "a",
            contactUrl: "https://box-aaaa.waitron.local/",
            standing: "serving-primary",
          },
          {
            nodeId: "b",
            contactUrl: "http://box-bbbb.waitron.local",
            standing: "serving-secondary",
          },
          {
            nodeId: "c",
            contactUrl: "https://box-cccc.example.test",
            standing: "serving-secondary",
          },
          { nodeId: "d", contactUrl: "https://notwaitron.local", standing: "serving-secondary" },
          { nodeId: "e", contactUrl: "not a url", standing: "sell-only" },
          { nodeId: "f", contactUrl: "https://box-ffff.waitron.local:8443", standing: "sell-only" },
        ],
      },
      signerNodeId: "a",
      signature: "sig",
      endorsements: [],
    });

    expect(await venuePasskeyOrigins(suite.db, "https://waitron.local")()).toEqual([
      "https://waitron.local",
      "https://box-aaaa.waitron.local",
      "https://box-ffff.waitron.local:8443",
    ]);
  });

  it("lists only the management origin when that is not the venue's name", async () => {
    await holdChart();

    expect(await venuePasskeyOrigins(suite.db, "http://localhost:5191")()).toEqual([
      "http://localhost:5191",
    ]);
  });

  it("lists only the venue's name when no chart is held", async () => {
    expect(await venuePasskeyOrigins(suite.db, "https://waitron.local")()).toEqual([
      "https://waitron.local",
    ]);
  });
});
