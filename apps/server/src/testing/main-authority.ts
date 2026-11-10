import { mintSelfSignedServerCert, type SelfSignedMaterial } from "../self-signed-cert.js";

/** The main box's authority. Real, because adopt issues the joining box's leaf from it. */
export const MAIN_AUTHORITY: SelfSignedMaterial = mintSelfSignedServerCert({
  hostnames: ["waitron.local"],
  ipAddresses: [],
  now: new Date(),
});
