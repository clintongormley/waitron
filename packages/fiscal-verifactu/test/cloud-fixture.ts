import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CloudAllocationReceipt, ReceiptTrust } from "../src/cloud-evidence.js";

export function cloudReceiptFixture(change?: (payload: CloudAllocationReceipt["payload"]) => void) {
  const original = JSON.parse(
    readFileSync(new URL("./cloud-allocation-receipt.json", import.meta.url), "utf8"),
  ) as { receipt: CloudAllocationReceipt };
  const payload = structuredClone(original.receipt.payload);
  change?.(payload);
  const keys = generateKeyPairSync("ed25519");
  const bytes = keys.publicKey.export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(bytes).digest("hex");
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (typeof value === "object" && value !== null)
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    return JSON.stringify(value);
  }
  const receipt: CloudAllocationReceipt = {
    payload,
    keyId,
    signature: sign(
      null,
      Buffer.from(canonical(["waitron.fiscal-allocation-receipt", 1, keyId, payload])),
      keys.privateKey,
    ).toString("base64url"),
  };
  const trust: ReceiptTrust = {
    issuer: payload.issuer,
    keys: new Map([[keyId, bytes.toString("base64url")]]),
  };
  const packet =
    "WAITRON-FISCAL-ALLOCATION-1:" + Buffer.from(canonical(receipt)).toString("base64url");
  return { receipt, trust, packet };
}
