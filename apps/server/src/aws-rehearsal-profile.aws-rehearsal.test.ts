import { readFile } from "node:fs/promises";
import { loadRehearsalProfile } from "./testing/aws-rehearsal.js";

describe("AWS rehearsal profile", () => {
  it("loads the static profile for the configured region", async () => {
    const profile = await loadRehearsalProfile(process.env, {
      readFile: (path) => readFile(path, "utf8"),
    });
    expect(profile.region === process.env.AWS_REGION).toBe(true);
    expect(typeof profile.accessKeyId === "string" && profile.accessKeyId.length > 0).toBe(true);
    expect(typeof profile.secretAccessKey === "string" && profile.secretAccessKey.length > 0).toBe(
      true,
    );
  });
});
