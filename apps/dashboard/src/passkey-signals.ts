import type { DashboardApi } from "./api/client.js";

/**
 * The WebAuthn signal methods (WebAuthn Level 3, §5.1.10), absent from some browsers. Each resolves
 * once its options are well formed, whatever the password manager then does, so a resolved call is
 * not proof that anything was removed or renamed.
 */
type SignalMethods = Partial<
  Pick<
    typeof PublicKeyCredential,
    "signalAllAcceptedCredentials" | "signalCurrentUserDetails" | "signalUnknownCredential"
  >
>;

function browserSignals(): SignalMethods {
  return (globalThis as { PublicKeyCredential?: SignalMethods }).PublicKeyCredential ?? {};
}

async function attempt(call: () => Promise<void>): Promise<boolean> {
  try {
    await call();
    return true;
  } catch {
    return false;
  }
}

/** Never throws. */
export async function signalAcceptedPasskeys(
  api: Pick<DashboardApi, "passkeySignals">,
): Promise<void> {
  const browser = browserSignals();
  const { signalAllAcceptedCredentials: all, signalCurrentUserDetails: details } = browser;
  if (typeof all !== "function" && typeof details !== "function") return;
  let signals;
  try {
    signals = await api.passkeySignals();
  } catch {
    return;
  }
  const { rpId, userId, credentialIds, name, displayName } = signals;
  await Promise.all([
    typeof all === "function"
      ? attempt(() => all.call(browser, { rpId, userId, allAcceptedCredentialIds: credentialIds }))
      : undefined,
    typeof details === "function"
      ? attempt(() => details.call(browser, { rpId, userId, name, displayName }))
      : undefined,
  ]);
}

/** True only when the browser has the method and accepted the call. */
export async function signalUnknownPasskey(
  rpId: string | undefined,
  credentialId: string,
): Promise<boolean> {
  const browser = browserSignals();
  const unknown = browser.signalUnknownCredential;
  if (typeof unknown !== "function" || rpId === undefined) return false;
  return attempt(() => unknown.call(browser, { rpId, credentialId }));
}
