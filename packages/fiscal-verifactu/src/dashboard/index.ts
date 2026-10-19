import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { AEAT_CERTIFICATE_STRINGS } from "./strings.js";
import { AeatCertificateClient } from "./client.js";
import "./certificate-card.js";

export const VERIFACTU_DASHBOARD: DashboardContribution = {
  module: "fiscal-verifactu",
  strings: AEAT_CERTIFICATE_STRINGS,
  settingsPanels: [
    {
      id: "aeat-certificate",
      tab: "venue-details",
      order: 1,
      requiresPermission: "system.manage",
      readPermission: "fiscal.view",
      create: (ctx) => {
        const client = new AeatCertificateClient(ctx.request);
        return {
          render: (readOnly = false) =>
            html`<dashboard-aeat-certificate-card
              .client=${client}
              .readOnly=${readOnly}
            ></dashboard-aeat-certificate-card>`,
        };
      },
    },
  ],
};
