import { findAdministrativeArea, type AddressAutocompleteProvider } from "@waitron/country";
import { makeBrowserUuid } from "@waitron/shared";
import { getCountryPack } from "./registry.js";

export type CloudAddressOperation =
  | { kind: "available" }
  | { kind: "suggest"; workflowId: string; query: string; language: "en" | "es" }
  | { kind: "validate"; workflowId: string; selectedText: string };

export interface CloudAddressReply {
  available?: boolean;
  candidates?: { text: string }[];
  fields?: {
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    city: string;
    province: string;
    countryCode: "ES";
  };
}

const attribution = "Google Maps";

export async function cloudAddressProvider(
  lookup: (operation: CloudAddressOperation, signal?: AbortSignal) => Promise<CloudAddressReply>,
  language: () => "en" | "es",
): Promise<AddressAutocompleteProvider | undefined> {
  if (!(await lookup({ kind: "available" })).available) return;
  const workflows = new Map<string, string>();
  const spain = getCountryPack("ES")!;
  return {
    async suggest({ query, sessionToken }, signal) {
      const workflowId = workflows.get(sessionToken) ?? makeBrowserUuid();
      workflows.set(sessionToken, workflowId);
      try {
        const { candidates } = await lookup(
          { kind: "suggest", workflowId, query, language: language() },
          signal,
        );
        return (candidates ?? []).map(({ text }) => ({
          id: text,
          label: text,
          secondaryLabel: attribution,
        }));
      } catch (error) {
        if (
          (error as { code?: unknown } | null)?.code === "cloud.address_lookup_expired" &&
          workflows.get(sessionToken) === workflowId
        )
          workflows.delete(sessionToken);
        throw error;
      }
    },
    async resolve({ suggestionId, sessionToken }) {
      const workflowId = workflows.get(sessionToken);
      if (!workflowId) throw new Error("No address search");
      workflows.delete(sessionToken);
      const { fields } = await lookup({ kind: "validate", workflowId, selectedText: suggestionId });
      if (!fields?.addressLine1.trim() || !fields.postalCode.trim() || !fields.city.trim())
        throw new Error("Incomplete address fields");
      const area = findAdministrativeArea(spain, fields.province);
      return {
        attribution,
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
