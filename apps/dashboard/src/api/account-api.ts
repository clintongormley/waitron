import type { DashboardRequest, DownloadedFile, RequestOptions } from "@waitron/dashboard-kit";
import type { LegalAbout } from "@waitron/shared";
import { VenueApi, type TradingAdmissionView } from "./venue-api.js";

export type PersonRole = "staff" | "supervisor" | "manager" | "admin";

export interface AccountEmailDeliveryDetails {
  delivery?: "queued" | "captured";
  problem?: "email.unconfigured";
  uncertain?: boolean;
}

export type InvitationResult = { invitationSent: boolean } & AccountEmailDeliveryDetails;

export type ProfileSaveResult = { emailVerificationSent: boolean } & AccountEmailDeliveryDetails;

export interface OwnProfile {
  passkeySignals: PasskeySignals;
  displayName: string;
  firstNames: string | null;
  lastNames: string | null;
  telephone: string | null;
  email: string | null;
  pendingEmail: string | null;
  locale: string | null;
  hasPassword: boolean;
  hasTotp: boolean;
  hasGoogle: boolean;
  passkeys: Array<{
    id: string;
    createdAt: string;
    lastUsedAt: string | null;
    /** The password manager holding the passkey; null when its authenticator is not on the list. */
    provider: string | null;
  }>;
}

export interface ProfileCredentials {
  totp?: string;
}

export interface ProfileDetails extends ProfileCredentials {
  displayName: string;
  firstNames: string;
  lastNames: string;
  telephone: string | null;
  email: string;
  locale: string;
}

export type PasskeyOptions = Record<string, unknown>;

export interface PasskeyChallenge {
  challengeHandle: string;
  options: PasskeyOptions;
}
/** What the browser's password manager is told about the signed-in person's passkeys. */
export interface PasskeySignals {
  rpId: string;
  /** base64url, the user handle the person's passkeys were registered under. */
  userId: string;
  /** base64url credential ids. */
  credentialIds: string[];
  name: string;
  displayName: string;
}

export interface PasskeyVerification {
  challengeHandle: string;
  response: unknown;
}
/** The shared confirmation body — LOCAL copy of what
 * `apps/server/src/fresh-sign-in.ts` reads. */
export type FreshSignInBody = (
  | { method: "password"; password: string }
  | { method: "passkey"; challengeHandle: string; response: unknown }
) & { totp?: string; recoveryCode?: string };

export class AccountApi extends VenueApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getLegalAbout(): Promise<LegalAbout> {
    return this.#request<LegalAbout>("/legal/about", "GET", undefined, { passive: true });
  }
  login(input: {
    email: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
  }): Promise<{ personId: string; offerPasskey: boolean }> {
    return this.#request<{ personId: string; offerPasskey: boolean }>(
      "/management-api/session",
      "POST",
      input,
    );
  }
  passkeyOfferSeen(): Promise<void> {
    return this.#request<void>("/management-api/session/me/passkey-offer", "POST");
  }
  requestPasswordReset(email: string): Promise<void> {
    return this.#request<void>("/management-api/password-reset", "POST", { email });
  }
  inspectAccountAction(
    token: string,
    purpose: "invitation" | "password_reset",
  ): Promise<{ email: string; purpose: "invitation" | "password_reset" }> {
    return this.#request("/management-api/account-actions/inspect", "POST", { token, purpose });
  }
  getProfile(): Promise<OwnProfile> {
    return this.#request<OwnProfile>("/management-api/session/me/profile", "GET");
  }
  downloadOwnPersonalData(): Promise<DownloadedFile> {
    return this.#request<DownloadedFile>(
      "/management-api/me/personal-data/export",
      "GET",
      undefined,
      { as: "file" },
    );
  }
  getGoogleConfig(): Promise<{ configured: boolean; privacyNoticeUrl?: string }> {
    return this.#request<{ configured: boolean; privacyNoticeUrl?: string }>(
      "/management-api/google/config",
      "GET",
    );
  }
  beginGoogleLogin(): Promise<{ authorizationUrl: string }> {
    return this.#request<{ authorizationUrl: string }>("/management-api/google/login", "POST");
  }
  beginGoogleLink(input: ProfileCredentials): Promise<{ authorizationUrl: string }> {
    return this.#request<{ authorizationUrl: string }>(
      "/management-api/session/me/google",
      "POST",
      input,
    );
  }
  saveProfile(input: ProfileDetails): Promise<ProfileSaveResult> {
    return this.#request("/management-api/session/me/profile", "PUT", input);
  }
  confirmProfileEmail(code: string): Promise<{ email: string }> {
    return this.#request("/management-api/session/me/profile/email/confirm", "POST", { code });
  }
  changePassword(input: ProfileCredentials & { password: string }): Promise<void> {
    return this.#request<void>("/management-api/session/me/password", "PUT", input);
  }
  changePin(input: ProfileCredentials & { pin: string }): Promise<void> {
    return this.#request<void>("/management-api/session/me/pin", "PUT", input);
  }
  beginTotp(input: ProfileCredentials): Promise<{
    enrollmentId: string;
    secret: string;
    uri: string;
    expiresAt: string;
  }> {
    return this.#request("/management-api/session/me/totp/begin", "POST", input);
  }
  finishTotp(enrollmentId: string, code: string): Promise<{ codes: string[] }> {
    return this.#request("/management-api/session/me/totp/finish", "POST", {
      enrollmentId,
      code,
    });
  }
  regenerateRecoveryCodes(input: ProfileCredentials): Promise<{ codes: string[] }> {
    return this.#request("/management-api/session/me/recovery-codes", "POST", input);
  }
  disableTotp(input: ProfileCredentials): Promise<void> {
    return this.#request<void>("/management-api/session/me/totp", "DELETE", input);
  }
  unlinkGoogle(input: ProfileCredentials): Promise<void> {
    return this.#request<void>("/management-api/session/me/google", "DELETE", input);
  }
  removePasskey(id: string, input: ProfileCredentials): Promise<void> {
    return this.#request<void>(
      `/management-api/session/me/passkeys/${encodeURIComponent(id)}`,
      "DELETE",
      input,
    );
  }
  completeAccountAction(
    token: string,
    purpose: "invitation" | "password_reset",
    password: string,
    pin?: string,
  ): Promise<{ personId: string; authenticated: boolean }> {
    return this.#request<{ personId: string; authenticated: boolean }>(
      "/management-api/account-actions/complete",
      "POST",
      {
        token,
        purpose,
        password,
        ...(pin === undefined ? {} : { pin }),
      },
    );
  }
  logout(): Promise<void> {
    return this.#request<void>("/management-api/session", "DELETE");
  }
  passkeyRegisterOptions(input: ProfileCredentials): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>(
      "/management-api/passkey/register/options",
      "POST",
      input,
    );
  }
  passkeyRegisterVerify(body: PasskeyVerification): Promise<{ credentialId: string }> {
    return this.#request<{ credentialId: string }>(
      "/management-api/passkey/register/verify",
      "POST",
      body,
    );
  }
  passkeySignals(): Promise<PasskeySignals> {
    return this.#request<PasskeySignals>("/management-api/passkey/signals", "GET");
  }
  passkeyAuthOptions(): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>("/management-api/passkey/auth/options", "POST");
  }
  passkeyAuthVerify(body: PasskeyVerification): Promise<{ personId: string }> {
    return this.#request<{ personId: string }>("/management-api/passkey/auth/verify", "POST", body);
  }
  // ── Staff self-service (my schedule) ─────────────────────────────────────────────────────────────
  // The server takes the acting person from the session, never from the request
  // (`apps/server/src/me-api.ts`).

  getMe(options?: RequestOptions): Promise<{
    tradingAdmission?: TradingAdmissionView;
    personId: string;
    displayName: string;
    roleIds: string[];
    email: string | null;
    locale: string | null;
    venueLocale: string;
    sessionDefault: string;
    permissions: string[];
    modules: string[];
    venueName: string;
    venueCountry?: string;
    onboardingIntent?: "demo" | "prepare" | "live";
    simulatedCardPayments?: boolean;
    changePosition?: string;
    sessionExpiresInSeconds?: number;
    sessionIdleTimeoutSeconds?: number;
  }> {
    return this.#request<{
      tradingAdmission?: TradingAdmissionView;
      personId: string;
      displayName: string;
      roleIds: string[];
      email: string | null;
      locale: string | null;
      venueLocale: string;
      sessionDefault: string;
      permissions: string[];
      modules: string[];
      venueName: string;
      venueCountry?: string;
      onboardingIntent?: "demo" | "prepare" | "live";
      simulatedCardPayments?: boolean;
      changePosition?: string;
      sessionExpiresInSeconds?: number;
      sessionIdleTimeoutSeconds?: number;
    }>("/management-api/session/me", "GET", undefined, options);
  }
  putLocale(code: string): Promise<void> {
    return this.#request<void>("/management-api/session/me/locale", "PUT", { locale: code });
  }
  confirmFreshSignIn(body: FreshSignInBody): Promise<void> {
    return this.#request("/management-api/session/me/fresh-sign-in", "POST", body);
  }
  freshSignInPasskeyOptions(): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>(
      "/management-api/session/me/fresh-sign-in/passkey-options",
      "POST",
    );
  }
}
