import { ALL_MODULES } from "@waitron/composition";
import { runCertificateDiagnosisEntry } from "./fiscal-certificate-diagnosis-dispatch.js";

export { runCertificateDiagnosisEntry } from "./fiscal-certificate-diagnosis-dispatch.js";

await runCertificateDiagnosisEntry((id) => {
  const matches = ALL_MODULES.filter((module) => module.fiscal?.id === id);
  if (matches.length !== 1 || !matches[0]!.fiscal?.certificate?.diagnoseInChild)
    throw new TypeError("Certificate diagnosis unavailable");
  return matches[0]!.fiscal!.certificate!;
});
