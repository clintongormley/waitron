import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { preparePaperRecoveryExport } from "./paper-recovery-export.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
  signPaperReservationForBlock,
} from "./paper-evidence.js";

export interface PaperCustodianIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export async function runPaperCustodian(argv: string[], io: PaperCustodianIo): Promise<number> {
  const [command, ...args] = argv;
  const options: Record<string, { type: "string" | "boolean" }> = {
    key: { type: "string" },
  };
  if (command === "prepare-recovery") {
    delete options.key;
    for (const name of [
      "block",
      "consumption",
      "input",
      "custodian",
      "fingerprint",
      "confirmation",
      "taxpayer",
      "environment",
      "action",
      "output",
    ])
      options[name] = { type: "string" };
  } else if (command === "keygen" || command === "public") {
    options.custodian = { type: "string" };
  } else if (
    command === "sign-block" ||
    command === "sign-register" ||
    command === "sign-consumption" ||
    command === "sign-reservation"
  ) {
    options.input = { type: "string" };
    options.output = { type: "string" };
    if (command === "sign-block" || command === "sign-register") {
      options["reserved-outside"] = { type: "boolean" };
    } else {
      options.block = { type: "string" };
      options.allocation = { type: "string" };
      options["current-register-confirmed"] = { type: "boolean" };
      options[command === "sign-reservation" ? "reserved-outside" : "consumed-outside"] = {
        type: "boolean",
      };
    }
  } else {
    io.stderr("Invalid paper custodian arguments");
    return 2;
  }

  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({ args, options, strict: true, allowPositionals: false }).values;
    if (
      Object.entries(options).some(([name, option]) =>
        option.type === "boolean"
          ? values[name] !== true
          : typeof values[name] !== "string" || values[name] === "",
      )
    ) {
      throw new RangeError("Missing arguments");
    }
  } catch {
    io.stderr("Invalid paper custodian arguments");
    return 2;
  }

  try {
    if (command === "prepare-recovery") {
      const output = await preparePaperRecoveryExport(values);
      await writeFile(values.output as string, JSON.stringify(output) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      return 0;
    }
    if (command === "keygen" || command === "public") {
      const key =
        command === "keygen"
          ? generateKeyPairSync("ed25519", {
              publicKeyEncoding: { type: "spki", format: "pem" },
              privateKeyEncoding: { type: "pkcs8", format: "pem" },
            })
          : {
              publicKey: createPublicKey(await readFile(values.key as string, "utf8"))
                .export({ type: "spki", format: "pem" })
                .toString(),
            };
      const trust = enrolPaperCustodian(
        values.custodian,
        key.publicKey,
        paperCustodianFingerprint(key.publicKey),
      );
      if (trust === null) {
        io.stderr("Invalid paper custodian arguments");
        return 2;
      }
      if ("privateKey" in key)
        await writeFile(values.key as string, key.privateKey, { flag: "wx", mode: 0o600 });
      io.stdout(JSON.stringify(trust));
      return 0;
    }

    const privateKey = await readFile(values.key as string, "utf8");
    const input: unknown = JSON.parse(await readFile(values.input as string, "utf8"));
    const signed =
      command === "sign-block" || command === "sign-register"
        ? signPaperBlock(input, privateKey)
        : (command === "sign-reservation"
            ? signPaperReservationForBlock
            : signPaperConsumptionForBlock)(
            JSON.parse(await readFile(values.block as string, "utf8")),
            values.allocation as string,
            input,
            privateKey,
          );
    const output =
      command === "sign-register"
        ? {
            "fiscal-verifactu": {
              block: signed,
              custodian: enrolPaperCustodian(
                signed.payload.custodianId,
                createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString(),
                paperCustodianFingerprint(
                  createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString(),
                ),
              ),
            },
          }
        : signed;
    await writeFile(values.output as string, JSON.stringify(output) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return 0;
  } catch (error) {
    io.stderr(
      `Paper custodian command failed (${error instanceof Error ? error.name : "UnknownError"})`,
    );
    return 1;
  }
}
