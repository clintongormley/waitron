import { afterEach, describe, expect, it, vi } from "vitest";

const { jwtVerify } = vi.hoisted(() => ({ jwtVerify: vi.fn() }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify,
}));

import { exchangeGoogleCode } from "./google-oidc.js";

const config = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://waitron.example/management-api/google/callback",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Google authorization-code exchange", () => {
  it("sends the PKCE verifier and validates signature, issuer, audience, expiry and nonce", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id_token: "signed-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    jwtVerify.mockResolvedValue({ payload: { sub: "stable-subject", nonce: "nonce" } });

    await expect(
      exchangeGoogleCode(config, {
        code: "authorization-code",
        verifier: "verifier",
        nonce: "nonce",
      }),
    ).resolves.toEqual({ subject: "stable-subject" });
    const request = fetchMock.mock.calls[0]!;
    expect(request[0]).toBe("https://oauth2.googleapis.com/token");
    expect(String((request[1] as RequestInit).body)).toContain("code_verifier=verifier");
    expect(jwtVerify).toHaveBeenCalledWith("signed-token", "jwks", {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: config.clientId,
    });
  });

  it("rejects a validly signed token from another ceremony", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "signed-token" }))),
    );
    jwtVerify.mockResolvedValue({ payload: { sub: "stable-subject", nonce: "other" } });
    await expect(
      exchangeGoogleCode(config, { code: "code", verifier: "verifier", nonce: "nonce" }),
    ).rejects.toThrow("did not match");
  });
});
