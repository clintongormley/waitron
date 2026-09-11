import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type {
  AddReaderResult,
  CardProviderBuildDeps,
  CardProviderContribution,
  CardProviderRuntimeDeps,
  ConnectResult,
  PaymentProvider,
  ReaderStatus,
} from "@waitron/payments";
import type { SumUpClient } from "./client.js";
import { sumupClient } from "./sumup-client.js";
import type { SumUpClientOptions } from "./sumup-client.js";
import { SumUpCloudProvider } from "./provider.js";
// Registers `payment.provider_merchant_ambiguous` (the one SumUp-specific code this seat throws) on
// the shared `ErrorParams` registry. `payment.provider_credential_rejected` is the neutral code both
// provider seats throw, declared in `@waitron/payments` and reachable through the import above.
import "./errors.js";

const PROVIDER_ID = "sumup";
const CREDENTIAL_PURPOSE = "payments.sumup";

/** The literal an operator seals for an absent affiliate field, matching
 * `sumupClientOptionsFrom`'s NO_AFFILIATE convention: a `-` in either affiliate slot means "no
 * affiliate", and the create call omits the `affiliate` block. */
const NO_AFFILIATE = "-";

/** `memberships()` reads `GET /v0.1/memberships`, which does not carry a merchant code, so `connect`
 * builds its probe client with this placeholder rather than a real one it does not yet know. */
const UNKNOWN_MERCHANT = "";

/** The nine `SumUpClient` methods, listed once so `deferredClient` can build a lazy wrapper without
 * repeating a per-method arrow (which would each read as a separate uncovered function). */
const CLIENT_METHODS = [
  "createCheckout",
  "findTransaction",
  "refund",
  "listReaders",
  "pairReader",
  "getReader",
  "readerStatus",
  "deleteReader",
  "memberships",
] as const;

/** Read the tenant's sealed `payments.sumup` credential and construct a real `sumupClient` from it.
 * The read happens on each call so provisioning and rotation take effect without a restart (the
 * `readCredential` convention). `fetch` is threaded through for tests and for a host that injects
 * its own. */
export async function sumupClientForTenant(deps: {
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  fetch?: typeof fetch;
}): Promise<SumUpClient> {
  const payload = await withTenant(deps.db, deps.tenantId, (tx) =>
    getCredential(tx, deps.ring, { tenantId: deps.tenantId, purpose: CREDENTIAL_PURPOSE }),
  );
  return sumupClient({
    ...optionsFromSealed(payload),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

/** Turn a decrypted `payments.sumup` payload into client options — the read-site validation the
 * server's `sumupClientOptionsFrom` does. A `-` in either affiliate slot (or an absent slot) means
 * no affiliate. A payload missing `apiKey` or `merchantCode` cannot build a client, so it is
 * rejected here rather than reaching the network with an undefined bearer or merchant. */
export function optionsFromSealed(
  payload: Record<string, string>,
): Pick<SumUpClientOptions, "apiKey" | "merchantCode" | "affiliate"> {
  const { apiKey, merchantCode, affiliateAppId, affiliateKey } = payload;
  if (apiKey === undefined || merchantCode === undefined)
    throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });
  const affiliate =
    affiliateAppId === undefined ||
    affiliateKey === undefined ||
    affiliateAppId === NO_AFFILIATE ||
    affiliateKey === NO_AFFILIATE
      ? undefined
      : { appId: affiliateAppId, key: affiliateKey };
  return { apiKey, merchantCode, ...(affiliate ? { affiliate } : {}) };
}

/** A `SumUpClient` that resolves the real client (from the sealed credential) on first use. `build`
 * must return synchronously, but reading the credential is asynchronous; every `SumUpClient` method
 * is async, so deferring the read to the first call is transparent to `SumUpCloudProvider`. The
 * resolved client is cached for the provider's lifetime — matching the server's read-once-at-boot
 * wiring — and a failed read is not cached, so a transient database error is retried on the next
 * sale rather than bricking the provider. */
export function deferredClient(deps: {
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  fetch?: typeof fetch;
}): SumUpClient {
  let cached: Promise<SumUpClient> | undefined;
  const client = (): Promise<SumUpClient> =>
    (cached ??= sumupClientForTenant(deps).catch((error: unknown) => {
      cached = undefined;
      throw error;
    }));
  const wrapped = Object.fromEntries(
    CLIENT_METHODS.map((method) => [
      method,
      (...args: unknown[]) =>
        client().then((c) => (c[method] as (...a: unknown[]) => unknown)(...args)),
    ]),
  );
  return wrapped as unknown as SumUpClient;
}

/** Map SumUp's reader status string onto the seat's two-value pairing outcome. SumUp returns
 * `paired` once the device has confirmed and any other value (`processing`) while it has not; the
 * screen polls `status` until it flips. */
function pairingStatus(raw: string): AddReaderResult["status"] {
  return raw === "paired" ? "paired" : "processing";
}

/**
 * The SumUp fill of the generic `CardProviderContribution` seat. It keeps every provider name inside
 * this package: the generic connect route, provider registry and pool reach SumUp only through this
 * value, never by importing SumUp directly. `connect` verifies the typed key against SumUp's
 * memberships endpoint and assembles the full four-field payload the route seals verbatim; `build`
 * turns a sealed credential into the live `SumUpCloudProvider`; `readers.*` manage the merchant's
 * paired card readers.
 */
export const SUMUP_CARD_PROVIDER: CardProviderContribution = {
  providerId: PROVIDER_ID,
  credentialPurpose: CREDENTIAL_PURPOSE,
  credentialFields: [
    { name: "apiKey", labelKey: "payments.sumup.api_key", secret: true },
    {
      name: "affiliateAppId",
      labelKey: "payments.sumup.affiliate_app_id",
      secret: true,
      optional: true,
    },
    {
      name: "affiliateKey",
      labelKey: "payments.sumup.affiliate_key",
      secret: true,
      optional: true,
    },
  ],
  readerAdd: { kind: "pairing-poll", codeLabelKey: "payments.sumup.pairing_code" },

  async connect(deps, payload): Promise<ConnectResult> {
    const apiKey = payload.apiKey;
    if (apiKey === undefined || apiKey === "")
      throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });

    // `memberships()` ignores the merchant code, so the probe client carries a placeholder. A bad
    // key makes SumUp answer 4xx, which surfaces here as a thrown error; an empty membership list
    // means the key acts as no merchant. Both are a rejected credential.
    const client = sumupClient({
      apiKey,
      merchantCode: UNKNOWN_MERCHANT,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    let merchants: { merchantCode: string; name: string }[];
    try {
      merchants = await client.memberships();
    } catch {
      throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });
    }
    if (merchants.length === 0)
      throw new AppError("payment.provider_credential_rejected", { providerId: PROVIDER_ID });

    const chosen =
      merchants.length === 1
        ? merchants[0]
        : merchants.find((m) => m.merchantCode === payload.merchantCode);
    if (chosen === undefined)
      throw new AppError("payment.provider_merchant_ambiguous", {
        merchants: merchants.map((m) => ({ code: m.merchantCode, name: m.name })),
      });

    return {
      merchantName: chosen.name,
      sealedPayload: {
        apiKey,
        merchantCode: chosen.merchantCode,
        affiliateAppId: payload.affiliateAppId || NO_AFFILIATE,
        affiliateKey: payload.affiliateKey || NO_AFFILIATE,
      },
    };
  },

  build(deps: CardProviderBuildDeps): PaymentProvider {
    return new SumUpCloudProvider({
      client: deferredClient({ db: deps.db, ring: deps.ring, tenantId: deps.tenantId }),
      db: deps.db,
      tenantId: deps.tenantId,
      nodeId: deps.nodeId,
      resolveReader: deps.resolveReader,
      incidents: deps.incidents,
    });
  },

  readers: {
    async add(deps: CardProviderRuntimeDeps, input): Promise<AddReaderResult> {
      // SumUp's reader-add mode is `pairing-poll`, so the route always supplies a pairing `code`;
      // its absence is a caller-contract violation, not a runtime condition an operator can act on.
      if (input.code === undefined) throw new Error("sumup readers.add requires a pairing code");
      const client = await sumupClientForTenant(deps);
      const reader = await client.pairReader({ pairingCode: input.code, name: input.name });
      return { providerRef: reader.id, status: pairingStatus(reader.status) };
    },

    async status(deps: CardProviderRuntimeDeps, providerRef: string): Promise<ReaderStatus> {
      const client = await sumupClientForTenant(deps);
      try {
        return await client.readerStatus(providerRef);
      } catch {
        // The low-level status call throws on an unknown/removed reader or a SumUp outage. A reader
        // page must render that as offline, never crash — so an unreadable status is reported, not
        // rethrown (Task 6 review).
        return { online: false, detail: "unreachable" };
      }
    },

    async remove(deps: CardProviderRuntimeDeps, providerRef: string): Promise<void> {
      const client = await sumupClientForTenant(deps);
      await client.deleteReader(providerRef);
    },
  },
};
