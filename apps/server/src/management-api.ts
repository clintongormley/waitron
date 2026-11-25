import { isRemoteStaffRequest, managementSite } from "./request-from-box.js";
import { venuePasskeyOrigins } from "./passkey-origins.js";
import { mountAccessRolesApi } from "./access-roles-api.js";
import { mountDepartmentReceiptSettingsApi } from "./department-receipt-api.js";
import type { Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createPasswordThrottle } from "./password-throttle.js";
import { ownPasswordChanges } from "./own-password-ahead.js";
import type { Logger } from "./logger.js";
import { exchangeGoogleCode } from "./google-oidc.js";
import {
  createAccountActionRateLimiter,
  createPasswordResetCooldown,
} from "./account-rate-limit.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { requireVenueCfg } from "./management-request-fields.js";
import { mountManagementGoogleRoutes } from "./management-google-routes.js";
import { mountManagementAccountRoutes } from "./management-account-routes.js";
import { mountManagementMembershipRoutes } from "./management-membership-routes.js";
import { mountManagementStaffRoutes } from "./management-staff-routes.js";
import { mountManagementDeviceProfileRoutes } from "./management-device-profiles-routes.js";
import { mountManagementFloorRoutes } from "./management-floor-routes.js";
import { mountManagementStationRoutes } from "./management-stations-routes.js";
import { mountManagementCourseRoutes } from "./management-courses-routes.js";
import { mountManagementPasskeyRoutes } from "./management-passkey-routes.js";

export interface MountedManagementApi {
  /**
   * Resolves once every password reset answered so far has finished its lookup and, for a known
   * address, its token write. It does not wait for the email.
   */
  settle(): Promise<void>;
}

export function mountManagementApi(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
): MountedManagementApi {
  mountDepartmentReceiptSettingsApi(
    app,
    {
      db: deps.db,
      venueCfg: () => requireVenueCfg(deps),
      validateOperationDescription: deps.validateOperationDescription,
    },
    log,
  );
  const recoveries = new Set<Promise<void>>();
  const credentialKeyRing = deps.credentialKeyRing;
  const passkeySite = (c: Context) => managementSite(c, deps);
  const passkeyOrigins = venuePasskeyOrigins(deps.db, deps.origin);
  const secureCookie = (c: Context) => deps.secureCookies || isRemoteStaffRequest(c);
  const googleRedirect = (c: Context) =>
    isRemoteStaffRequest(c)
      ? new URL("/management-api/google/callback", c.req.url).href
      : deps.googleOidc!.redirectUri;
  const passwordThrottle = deps.passwordThrottle ?? createPasswordThrottle();
  const credentialChangeThrottle = createPasswordThrottle();
  const acceptPasswordReset = createPasswordResetCooldown();
  const acceptInvitation = createPasswordResetCooldown();
  const passwordResetRateLimiter =
    deps.accountActionRateLimiters?.passwordReset ?? createAccountActionRateLimiter();
  const completionRateLimiter =
    deps.accountActionRateLimiters?.completion ?? createAccountActionRateLimiter();
  const googleCodeExchange = deps.googleCodeExchange ?? exchangeGoogleCode;
  const googleFlowCookie = "waitron_google_flow";
  const changeAccount = ownPasswordChanges(deps.db, credentialChangeThrottle);
  const withCredentialChange: typeof changeAccount = (token, input, change) =>
    changeAccount(token, input, change, false);
  const bindGoogleFlow = (c: Context, state: string): void => {
    setCookie(c, googleFlowCookie, state, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookie(c),
      path: "/management-api/google/callback",
      maxAge: 10 * 60,
    });
  };

  mountManagementGoogleRoutes(
    app,
    deps,
    log,
    credentialKeyRing,
    passkeySite,
    secureCookie,
    googleRedirect,
    googleCodeExchange,
    googleFlowCookie,
    withCredentialChange,
    bindGoogleFlow,
  );
  mountManagementAccountRoutes(
    app,
    deps,
    log,
    recoveries,
    credentialKeyRing,
    passkeySite,
    secureCookie,
    passwordThrottle,
    acceptPasswordReset,
    passwordResetRateLimiter,
    completionRateLimiter,
  );

  mountManagementMembershipRoutes(app, deps, log, credentialKeyRing);

  mountAccessRolesApi(app, deps, log);

  mountManagementStaffRoutes(app, deps, log, passkeySite, acceptInvitation);

  mountManagementDeviceProfileRoutes(app, deps, log);

  mountManagementFloorRoutes(app, deps, log);

  mountManagementStationRoutes(app, deps, log);

  mountManagementCourseRoutes(app, deps, log);

  mountManagementPasskeyRoutes(
    app,
    deps,
    log,
    credentialKeyRing,
    passkeySite,
    passkeyOrigins,
    secureCookie,
    withCredentialChange,
  );

  return {
    settle: async () => {
      await Promise.all(recoveries);
    },
  };
}
