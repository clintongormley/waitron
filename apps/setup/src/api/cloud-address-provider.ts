import { findAdministrativeArea } from "@waitron/country";
import { getVenueSetupCountryPack } from "@waitron/country-packs";
import type { AddressLookupProvider } from "@waitron/ui";
import type { SetupApi } from "./client.js";

export async function setupCloudAddressProvider(
  api: SetupApi,
  tab: string,
  language: () => "en" | "es",
): Promise<AddressLookupProvider | undefined> {
  if (!(await api.cloudAddressLookup(tab, { kind: "available" })).available) return;
  const workflows = new Map<string, string>();
  const spain = getVenueSetupCountryPack("ES")!;
  return {
    async suggest({ query, sessionToken }) {
      let workflowId = workflows.get(sessionToken);
      if (!workflowId) {
        workflowId = crypto.randomUUID();
        workflows.set(sessionToken, workflowId);
      }
      const { candidates } = await api.cloudAddressLookup(tab, {
        kind: "suggest",
        workflowId,
        query,
        language: language(),
      });
      return (candidates ?? []).map(({ text }) => ({
        id: text,
        label: text,
        secondaryLabel: "Google Maps",
      }));
    },
    async resolve({ suggestionId, sessionToken }) {
      const workflowId = workflows.get(sessionToken);
      if (!workflowId) throw new Error("No address search");
      workflows.delete(sessionToken);
      const { fields } = await api.cloudAddressLookup(tab, {
        kind: "validate",
        workflowId,
        selectedText: suggestionId,
      });
      if (
        !fields ||
        ![
          fields.addressLine1,
          fields.addressLine2,
          fields.postalCode,
          fields.city,
          fields.province,
        ].some((field) => field?.trim())
      )
        throw new Error("No address fields");
      const area = findAdministrativeArea(spain, fields.province);
      return {
        lines: fields.addressLine2
          ? [fields.addressLine1, fields.addressLine2]
          : [fields.addressLine1],
        locality: fields.city,
        postalCode: fields.postalCode,
        countryCode: fields.countryCode,
        ...(area && { administrativeAreaCode: area.code }),
      };
    },
  };
}
