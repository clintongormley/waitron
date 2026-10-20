import { SetupApi, type ProvisionBody } from "../src/api/client.js";
export const venue: ProvisionBody["venue"] = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Olivo SL",
  taxpayerDomicile: "Mayor 1, Madrid",
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  location: {
    name: "Olivo",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
    addressLine1: "Mayor 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  },
  admin: {
    firstNames: "Elena",
    lastNames: "García",
    displayName: "Elena",
    email: "elena@example.test",
    password: "administrator password",
    pin: "1357",
  },
};
export const initial = {
  attemptId: "bd185bdc-b7dd-4abb-991a-a9c3d613d38e",
  nodeId: "75544019-26d4-4448-91b0-e803a12f7610",
  administratorId: "c67ebebf-632b-4481-9b83-f78cb7ece82f",
  revision: 1,
  ownerGeneration: 1,
  status: "claimed",
  consumptionIntent: false,
  environment: "production",
  venue: {
    ...venue,
    admin: {
      firstNames: "Elena",
      lastNames: "García",
      displayName: "Elena",
      email: "elena@example.test",
    },
  },
  modules: [{ module: "fiscal-verifactu", version: "0.0.0" }],
};
export function wizardApi(
  options: {
    offering?: boolean;
    developmentMode?: boolean;
    claimed?: boolean;
    intercept?: (
      path: string,
      body: unknown,
      headers: Headers,
    ) => Response | Promise<Response> | undefined;
  } = {},
) {
  const requests: { path: string; body: unknown; headers: Headers }[] = [];
  let claimed = options.claimed ?? false;
  const api = new SetupApi("", async (url, init) => {
    const path = String(url),
      body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      headers = new Headers(init?.headers);
    requests.push({ path, body, headers });
    const intercepted = options.intercept?.(path, body, headers);
    if (intercepted !== undefined) return intercepted;
    if (path === "/setup-api/status")
      return Response.json({
        provisioned: false,
        environment: "production",
        developmentMode: options.developmentMode ?? false,
        needs: ["venue"],
      });
    if (path === "/setup-api/discovery") return Response.json({ caDownloadAvailable: false });
    if (path === "/setup-api/venue-defaults")
      return Response.json({ verifactu: { operationDescription: "Restaurant" } });
    if (path.endsWith("/offerings"))
      return Response.json({
        modules:
          options.offering === false ? [] : [{ module: "fiscal-verifactu", version: "0.0.0" }],
      });
    if (path.endsWith("/first-setup/resolution"))
      return Response.json({
        version: 2,
        inspectionId: "a".repeat(64),
        pair: "valid",
        database: "no-venue-rows",
        password: "checkable",
        revision: 1,
        ownerGeneration: 1,
        repairEligible: false,
        emptyDatabase: true,
        artifacts: [],
      });
    if (path.endsWith("/first-setup/status"))
      return Response.json(
        headers.has("X-Waitron-Setup-Owner") ? { claimed: true, state: initial } : { claimed },
      );
    if (path.endsWith("/claim")) {
      claimed = true;
      return Response.json({ state: initial, capability: "A".repeat(43), ownerGeneration: 1 });
    }
    if (path.endsWith("/fiscal-test")) return Response.json({ status: "accepted" });
    if (path.endsWith("/provision")) return Response.json({ provisioned: true, restarting: true });
    throw new Error(`Unhandled test route ${path}`);
  });
  return { api, requests };
}
