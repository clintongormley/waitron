import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClient, validate } from "@waitron/verifactu";
import { aeatEndpointFor, mtlsFetch } from "@waitron/fiscal-verifactu/src/aeat-transport.js";
import { openCertificateFile } from "@waitron/fiscal-verifactu/src/certificate-file.js";
import {
  describeRecord,
  inSendWindow,
  notSentText,
  outcomeOf,
  probeRecords,
  recordLine,
  resultText,
  type ProbeResult,
} from "@waitron/fiscal-verifactu/src/aeat-midnight-probe.js";
import { isUnset } from "./env-value.js";

const pfxBase64 = process.env.WAITRON_CERT_CHECK_PFX_BASE64;
const passphrase = process.env.WAITRON_CERT_CHECK_PASSPHRASE;
const nif = process.env.WAITRON_CERT_CHECK_NIF;
const legalName = process.env.WAITRON_CERT_CHECK_LEGAL_NAME;
const environment = process.env.WAITRON_CERT_CHECK_ENVIRONMENT;
const mode = process.env.WAITRON_AEAT_PROBE_MODE;
const dryRun = process.env.WAITRON_AEAT_PROBE_DRY_RUN === "1";
const fixedNow = process.env.WAITRON_AEAT_PROBE_NOW;
const resultFiles = (process.env.WAITRON_AEAT_PROBE_RESULT_FILES ?? "")
  .split(":")
  .filter((file) => file !== "");

const configured = [pfxBase64, passphrase, nif, legalName].every((value) => !isUnset(value));
const SEND_LIMIT_MS = 90_000;

describe.runIf(configured)("A1270: the date AEAT calls the future", () => {
  const taxpayer = { taxId: nif!, legalName: legalName! };
  const write = (text: string) => {
    for (const file of resultFiles) appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  };
  const refuse = (now: Date, reason: string): never => {
    write(notSentText(now, reason, taxpayer));
    throw new Error(notSentText(now, reason, taxpayer));
  };

  it(`runs the ${mode ?? "unnamed"} step`, async () => {
    let now = new Date();
    if (!isUnset(fixedNow)) {
      if (!dryRun) refuse(now, "WAITRON_AEAT_PROBE_NOW is honoured only in a dry run");
      now = new Date(fixedNow!);
      if (Number.isNaN(now.getTime())) refuse(new Date(), "WAITRON_AEAT_PROBE_NOW is not a time");
    }
    if (!isUnset(environment) && environment !== "preproduction") {
      refuse(now, "this probe sends only to AEAT's test service");
    }
    if (mode !== "preflight" && mode !== "send") {
      refuse(now, "WAITRON_AEAT_PROBE_MODE must be preflight or send");
    }
    const material = {
      pfx: Buffer.from(pfxBase64!, "base64"),
      passphrase: passphrase!,
      certKind: "representante" as const,
    };
    const cabecera = { ObligadoEmision: { NombreRazon: taxpayer.legalName, NIF: taxpayer.taxId } };
    const endpoint = aeatEndpointFor("preproduction")("representante");

    if (mode === "preflight") {
      if (!openCertificateFile(material.pfx, material.passphrase).ok) {
        refuse(now, "pre-flight: the certificate did not open with its passphrase");
      }
      for (const entry of probeRecords(now, taxpayer)) {
        const issues = validate(entry.record, { now }).filter(
          (issue) => issue.severity === "error" && issue.code !== "FECHA_EXPEDICION_FUTURE",
        );
        if (issues.length > 0) {
          refuse(now, `pre-flight: ${entry.label} has ${issues.map((i) => i.code).join(", ")}`);
        }
      }
      if (dryRun) {
        console.log("pre-flight ok (dry run: no query sent)");
        return;
      }
      const transport = mtlsFetch(material);
      try {
        const client = createClient({ endpoint, fetch: transport.fetch });
        await client.consultar(cabecera, {
          Ejercicio: String(now.getUTCFullYear()),
          Periodo: String(now.getUTCMonth() + 1).padStart(2, "0"),
        });
      } catch (error) {
        refuse(now, `pre-flight query failed: ${(error as Error).message}`);
      } finally {
        await transport.close();
      }
      console.log("pre-flight ok");
      return;
    }

    if (!inSendWindow(now)) refuse(now, "outside 00:05–00:55 Madrid");
    const records = probeRecords(now, taxpayer);
    if (dryRun) {
      for (const entry of records) console.log(describeRecord(entry));
      write(records.map(describeRecord).join("\n"));
      write(notSentText(now, "dry run: no record sent", taxpayer));
      console.log(notSentText(now, "dry run: no record sent", taxpayer));
      return;
    }
    const transport = mtlsFetch(material);
    const results: ProbeResult[] = [];
    try {
      const client = createClient({
        endpoint,
        fetch: ((input, init) =>
          transport.fetch(input, {
            ...init,
            signal: AbortSignal.timeout(SEND_LIMIT_MS),
          })) as typeof globalThis.fetch,
      });
      for (const entry of records) {
        let outcome;
        try {
          const answer = await client.submit(cabecera, [{ RegistroAlta: entry.record }]);
          outcome = outcomeOf(answer.RespuestaLinea[0]);
        } catch (error) {
          outcome = outcomeOf(error instanceof Error ? error : new Error(String(error)));
        }
        const result = { entry, outcome };
        results.push(result);
        write(recordLine(result, taxpayer));
        console.log(recordLine(result, taxpayer));
      }
    } finally {
      await transport.close();
    }
    write("--- whole result ---");
    write(resultText(now, results, taxpayer));
    console.log(resultText(now, results, taxpayer));
    expect(results).toHaveLength(4);
  }, 400_000);
});
