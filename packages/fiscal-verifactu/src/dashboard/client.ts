import type { DashboardRequest } from "@waitron/dashboard-kit";

// Local copies of the route's JSON shapes (`src/certificate-card.ts`, `src/certificate-install.ts`):
// importing them would pull `@waitron/db` and Node builtins into the browser bundle.

export type CertificateKind = "sello" | "representante";

export interface CertificateCardView {
  filing: boolean;
  revision: string | null;
  timeZone: string;
  installed: null | {
    kind: CertificateKind;
    organisation: string | null;
    taxId: string | null;
    taxIdMatches: boolean | null;
    issuer: string | null;
    validFrom: string;
    validUntil: string;
    /** Calendar days from today to the expiry date, both in `timeZone`. */
    daysLeft: number;
    stage: "warning" | "urgent" | "expired" | null;
    installedAt: string;
    source: "setup" | "dashboard";
    installedByName: string | null;
    lastAcceptedAt: string | null;
  };
}

export interface InstallBody {
  pfxBase64: string;
  passphrase: string;
  certKind: CertificateKind;
  expectedRevision: string | null;
}

export interface InstallAnswerView {
  outcome: "installed" | "refused";
  reason: string;
  field?: "file" | "passphrase";
  details?: Record<string, string | number>;
}

const PATH = "/management-api/fiscal-certificate";

export class AeatCertificateClient {
  readonly #request: DashboardRequest;

  constructor(request: DashboardRequest) {
    this.#request = request;
  }

  read(): Promise<CertificateCardView> {
    return this.#request<CertificateCardView>(PATH, "GET", undefined, { passive: true });
  }

  install(body: InstallBody): Promise<InstallAnswerView> {
    return this.#request<InstallAnswerView>(PATH, "POST", body);
  }
}
