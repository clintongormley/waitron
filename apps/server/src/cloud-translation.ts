import { createHash, createPrivateKey, sign } from "node:crypto";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import "./errors.js";

export type TranslationAction =
  "translation-submit" | "translation-status" | "translation-collect" | "translation-release";

export function jobFingerprint(body: string): { jobSha256: string; jobBytes: number } {
  const bytes = Buffer.from(body, "utf8");
  return { jobSha256: createHash("sha256").update(bytes).digest("hex"), jobBytes: bytes.length };
}

/** The shared vectors pin this key order. */
export function submitSignedBody(body: string): string {
  const { jobSha256, jobBytes } = jobFingerprint(body);
  return JSON.stringify({ version: 1, jobSha256, jobBytes });
}

export function translationEnvelope(
  state: Pick<SavedCloudState, "origin" | "view" | "privateKey">,
  action: TranslationAction,
  input: { operationId: string; lease: string; signedBody: string },
  now = Date.now(),
): { payload: string; signature: string } {
  const bytes = machinePayload(
    state,
    { action, operationId: input.operationId, lease: input.lease, body: input.signedBody },
    now,
  );
  const key = createPrivateKey({
    key: Buffer.from(state.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, key).toString("base64url"),
  };
}
