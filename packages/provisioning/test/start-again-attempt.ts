import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { hashPassword, hashPin } from "@waitron/identity";
import { canonicalFirstSetupRoots } from "../src/first-setup-resolution.js";
import {
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "../src/first-setup-start-again-deletion.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  type FirstSetupFrozen,
} from "../src/first-setup-state.js";

export const START_AGAIN_ADMIN_PASSWORD = "synthetic-start-again-password";
export const START_AGAIN_ADMIN = { displayName: "Elena", email: "elena@example.test" } as const;

export interface StartAgainAttempt {
  readonly roots: { readonly venueDir: string; readonly stateDir: string };
  readonly attemptId: string;
  readonly frozenDigest: string;
  readonly administratorId: string;
}

const digestOf = (value: string) => createHash("sha256").update(value).digest("hex");

function frozenAttempt(passwordHash: string): FirstSetupFrozen {
  const attemptId = randomUUID();
  return {
    attemptId,
    nodeId: randomUUID(),
    administratorId: randomUUID(),
    sourceId: `first-setup:${attemptId}`,
    environment: "production",
    modules: [
      {
        module: "probe",
        version: "0.1.0",
        eventId: randomUUID(),
        request: { bases: ["S000001-W1-A"], purposes: ["simplified"] },
      },
    ],
    request: {
      country: "ES",
      taxId: "B12345678",
      legalName: "Olivo SL",
      taxpayerDomicile: "Calle Fiscal 1",
      location: {
        name: "Olivo",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28001",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
      },
      seriesCode: "A",
      fullSeriesCode: "F",
      rectificativeSeriesCode: "R",
      admin: { ...START_AGAIN_ADMIN, pinHash: hashPin("4826"), passwordHash },
    },
  };
}

/**
 * A first setup claimed through `createFirstSetupStore(...).claim(...)`, whose `first-setup.json`
 * `parseFirstSetupState` accepts and whose `ownerVerifier` is `hashPassword(START_AGAIN_ADMIN_PASSWORD)`,
 * then A1042's marker over it: the box a cut left between the marker and the deletion. `before` runs
 * after the claim and before the marker, for files the attempt itself wrote (they are marked).
 * `base` is an empty scratch folder the caller made and removes; the roots are `<base>/venue` and
 * `<base>/state`.
 */
export async function startAgainAttempt(
  base: string,
  options: {
    before?: (roots: { venueDir: string; stateDir: string }) => Promise<void>;
  } = {},
): Promise<StartAgainAttempt> {
  const ownerVerifier = hashPassword(START_AGAIN_ADMIN_PASSWORD);
  const store = createFirstSetupStore({
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
    coordinator: createFirstSetupCoordinator(),
  });
  const claimed = await store.claim(
    frozenAttempt(ownerVerifier),
    ownerVerifier,
    digestOf("capability"),
    digestOf("nonce"),
  );
  const roots = await canonicalFirstSetupRoots({
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
  });
  await options.before?.(roots);
  await writeStartAgainMarker(
    roots,
    await startAgainMarkerFor(roots, {
      attemptId: claimed.frozen.attemptId,
      frozenDigest: claimed.frozenDigest,
    }),
  );
  return {
    roots,
    attemptId: claimed.frozen.attemptId,
    frozenDigest: claimed.frozenDigest,
    administratorId: claimed.frozen.administratorId,
  };
}
