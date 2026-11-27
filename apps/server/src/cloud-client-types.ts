import type { CloudInstallationState } from "./cloud-installation.js";
import type { CloudSignInProfile } from "./cloud-sign-in.js";

export interface CloudRegistration {
  venueId: string;
  installationId: string;
  organisationId: string;
  legalBusinessId: string;
}

export interface CloudPairingView {
  requestId: string;
  venueId: string;
  environment: "test" | "production";
  expiresAt: string;
  state: "awaiting_cloud" | "awaiting_local" | "complete";
  organisationId?: string;
  legalBusinessId?: string;
  organisationName?: string;
  legalBusinessName?: string;
  registration?: CloudRegistration;
}

export interface CloudConnectionOptions {
  managementOrigin?: string;
  signIn?: {
    callback: string;
    readProfile(): Promise<CloudSignInProfile>;
    setup?: boolean;
    currentNodeId?(): string | undefined;
  };
  onEmergencyHintsError?: (error: unknown) => void;
  stateDir: string;
  tunnelDir?: string;
  origin: string;
  readVenueId(): Promise<string | null>;
  readVenueName(): Promise<string>;
  recordVenueId(venueId: string): Promise<void>;
  forgetVenueId(): Promise<void>;
  environment: "test" | "production";
}
export interface SavedEmergencyHints {
  registration: string;
  staffOrigin: string;
  address: string | null;
  open: boolean;
  asOf: string;
}

export interface CloudInstallationCredentials {
  origin: string;
  privateKey: string;
  publicKey: string;
  environment: "test" | "production";
  lifecycle?: CloudInstallationState;
  view?: { registration?: CloudRegistration };
}

export interface SavedCloudState extends CloudInstallationCredentials {
  emailRelayEnabled?: boolean;
  emergencyHints?: SavedEmergencyHints;
  remoteAccessEnabled?: boolean;
  version: 2;
  signedIn?: true;
  venueId: string;
  requestId: string;
  code: string;
  view?: CloudPairingView;
}
