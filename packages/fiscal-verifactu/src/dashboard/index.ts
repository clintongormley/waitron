import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { AEAT_CERTIFICATE_STRINGS } from "./strings.js";
import { AeatCertificateClient } from "./client.js";
import { FiscalFilingClient } from "./fiscal-filing-client.js";
import "./certificate-card.js";
import "./conflict-recovery.js";
import "./fiscal-filing-screen.js";

export const VERIFACTU_DASHBOARD: DashboardContribution = {
  module: "fiscal-verifactu",
  strings: AEAT_CERTIFICATE_STRINGS,
  moreScreens: [
    {
      screen: {
        id: "fiscal-filing",
        navLabelKey: "nav.fiscal_filing",
        group: "reports",
        order: -1,
        requiresPermission: "report.export",
      },
      create(ctx) {
        const client = new FiscalFilingClient(ctx.request);
        return {
          render: () => html`<vf-fiscal-filing-screen .client=${client}></vf-fiscal-filing-screen>`,
        };
      },
    },
  ],
  publicPages: [
    {
      path: "/manage/recovery/fiscal-conflict",
      create: ({ request, locale }) => ({
        render: () =>
          html`<vf-conflict-recovery .request=${request} .locale=${locale}></vf-conflict-recovery>`,
      }),
    },
  ],
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
              .permissionContinuation=${ctx.permissionContinuation}
            ></dashboard-aeat-certificate-card>`,
        };
      },
    },
  ],
};
