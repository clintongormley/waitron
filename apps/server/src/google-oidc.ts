import { createRemoteJWKSet, jwtVerify } from "jose";

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Exchanges a one-time authorization code and verifies the signed ID token before returning the
 * stable Google subject. No access or refresh token is retained because Waitron requests login only. */
export async function exchangeGoogleCode(
  config: GoogleOidcConfig,
  input: { code: string; verifier: string; nonce: string },
): Promise<{ subject: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
  });
  if (!response.ok) throw new Error("Google authorization-code exchange failed");
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new Error("Google response omitted its ID token");
  const verified = await jwtVerify(body.id_token, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: config.clientId,
  });
  if (verified.payload.nonce !== input.nonce || typeof verified.payload.sub !== "string") {
    throw new Error("Google ID token did not match the login ceremony");
  }
  return { subject: verified.payload.sub };
}
