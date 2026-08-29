import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertMirrorBindSafe } from "./mirror-bind-guard.js";

/**
 * A mirror serves an UNAUTHENTICATED admin dashboard (`ensureMirrorViewer` + `mirrorSession`); the
 * only thing keeping it off the network is that the server binds to a loopback `httpHost` by default.
 * `assertMirrorBindSafe` is the fail-closed boot guard: under `mode='mirror'` it refuses a
 * non-loopback bind unless `WAITRON_MIRROR_ALLOW_EXPOSED` is explicitly truthy. A primary may bind
 * non-loopback legitimately, so the guard is mirror-only.
 */

function reason(
  httpHost: string,
  isMirror: boolean,
  env: Record<string, string | undefined>,
): string {
  try {
    assertMirrorBindSafe({ httpHost }, isMirror, env);
    return "ALLOWED";
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
}

describe("assertMirrorBindSafe", () => {
  it("refuses a mirror binding a non-loopback host with no opt-in", () => {
    expect(reason("0.0.0.0", true, {})).toBe("server.mirror_bind_exposed");
    expect(reason("::", true, {})).toBe("server.mirror_bind_exposed");
    expect(reason("10.0.0.1", true, {})).toBe("server.mirror_bind_exposed");
    expect(reason("mirror.example.com", true, {})).toBe("server.mirror_bind_exposed");
  });

  it("names the offending host in the error params", () => {
    try {
      assertMirrorBindSafe({ httpHost: "0.0.0.0" }, true, {});
      throw new Error("expected assertMirrorBindSafe to throw");
    } catch (error) {
      if (!isAppError(error)) throw error;
      expect(error.code).toBe("server.mirror_bind_exposed");
      expect(error.params).toEqual({ host: "0.0.0.0" });
    }
  });

  it("allows a mirror binding a non-loopback host when explicitly opted in", () => {
    expect(reason("0.0.0.0", true, { WAITRON_MIRROR_ALLOW_EXPOSED: "true" })).toBe("ALLOWED");
    expect(reason("0.0.0.0", true, { WAITRON_MIRROR_ALLOW_EXPOSED: "1" })).toBe("ALLOWED");
  });

  it("treats a non-truthy opt-in value as NOT opted in (fails safe)", () => {
    expect(reason("0.0.0.0", true, { WAITRON_MIRROR_ALLOW_EXPOSED: "" })).toBe(
      "server.mirror_bind_exposed",
    );
    expect(reason("0.0.0.0", true, { WAITRON_MIRROR_ALLOW_EXPOSED: "yes" })).toBe(
      "server.mirror_bind_exposed",
    );
    expect(reason("0.0.0.0", true, { WAITRON_MIRROR_ALLOW_EXPOSED: "false" })).toBe(
      "server.mirror_bind_exposed",
    );
  });

  it("allows a mirror binding a loopback host (the default posture)", () => {
    expect(reason("127.0.0.1", true, {})).toBe("ALLOWED");
    expect(reason("127.5.5.5", true, {})).toBe("ALLOWED");
    expect(reason("::1", true, {})).toBe("ALLOWED");
    expect(reason("localhost", true, {})).toBe("ALLOWED");
  });

  it("never guards a primary — it may bind non-loopback legitimately", () => {
    expect(reason("0.0.0.0", false, {})).toBe("ALLOWED");
    expect(reason("10.0.0.1", false, {})).toBe("ALLOWED");
    expect(reason("mirror.example.com", false, {})).toBe("ALLOWED");
  });
});
