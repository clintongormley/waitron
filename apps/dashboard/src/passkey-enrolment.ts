import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import type { DashboardApi } from "./api/client.js";
import type { ProfileCredentials } from "./api/account-api.js";
import { codeOf } from "./i18n/codes.js";
import { classifyPasskeyRegistrationError } from "./passkey-errors.js";

/** Stops quietly after any step that `active` no longer holds for. */
export async function enrolPasskey(
  api: Pick<DashboardApi, "passkeyRegisterOptions" | "passkeyRegisterVerify">,
  credentials: ProfileCredentials,
  active: () => boolean,
): Promise<void> {
  const { challengeHandle, options } = await api.passkeyRegisterOptions(credentials);
  if (!active()) return;
  const response = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  if (!active()) return;
  await api.passkeyRegisterVerify({ challengeHandle, response });
}

/**
 * The code to show for a failed enrolment, or `null` for a prompt the person cancelled. The browser's
 * failures are classified first, so no WebAuthn library `.code` is read as one of ours.
 */
export function enrolmentCode(error: unknown): string | null {
  const passkey = classifyPasskeyRegistrationError(error);
  if (passkey === "cancelled") return null;
  if (passkey === "already_registered") return "passkey.already_registered";
  if (passkey === "failed") return "passkey.verification_failed";
  return codeOf(error, "passkey.verification_failed");
}
