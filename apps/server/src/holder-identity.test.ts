import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ setVenueHolderIdentity: vi.fn() }));
vi.mock("@waitron/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/db")>()),
  ...identity,
}));

const { nameVenueHolder } = await import("./holder-identity.js");
const { DEFAULT_STATE_ROOT } = await import("./boot.js");

beforeEach(() => identity.setVenueHolderIdentity.mockClear());

describe("nameVenueHolder", () => {
  it("passes the kind, the environment and the state directory the server's config resolves", () => {
    const env = { WAITRON_STATE_DIR: "relative/state", WAITRON_LOG_DIR: "/logs" };
    nameVenueHolder("restore", env);
    expect(identity.setVenueHolderIdentity).toHaveBeenCalledWith(
      "restore",
      env,
      resolve("relative/state"),
    );
  });

  it("falls back to the server's default state directory when WAITRON_STATE_DIR is unset or empty", () => {
    nameVenueHolder("rejoin", {});
    expect(identity.setVenueHolderIdentity).toHaveBeenLastCalledWith(
      "rejoin",
      {},
      DEFAULT_STATE_ROOT,
    );
    nameVenueHolder("rejoin", { WAITRON_STATE_DIR: "" });
    expect(identity.setVenueHolderIdentity).toHaveBeenLastCalledWith(
      "rejoin",
      { WAITRON_STATE_DIR: "" },
      DEFAULT_STATE_ROOT,
    );
  });
});
