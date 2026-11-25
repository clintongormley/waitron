import { cloudAddressProvider } from "@waitron/country-packs";
import type { SetupApi } from "./client.js";

export function setupCloudAddressProvider(api: SetupApi, tab: string, language: () => "en" | "es") {
  return cloudAddressProvider((operation) => api.cloudAddressLookup(tab, operation), language);
}
