import {
  bounded,
  digest,
  encoder,
  fromDer,
  guarded,
  hex,
  material,
  refuse,
  scopeOf,
  unhex,
} from "./internal.js";
import type { CustodyKey, CustodyPublic, CustodyScope } from "./internal.js";

async function groupCheck(
  scope: CustodyScope,
  fingerprint: string,
  index: string,
  group: string,
): Promise<string> {
  return (
    await digest(
      encoder.encode(
        JSON.stringify(["waitron.custodian-paper.group", 1, scope, fingerprint, index, group]),
      ),
    )
  )
    .slice(0, 8)
    .toUpperCase();
}
function wholeCheck(scope: CustodyScope, fingerprint: string, privateHex: string): Promise<string> {
  return digest(
    encoder.encode(JSON.stringify(["waitron.custodian-paper", 1, scope, fingerprint, privateHex])),
  );
}
export function encodeSecretPaper(key: CustodyKey): Promise<string> {
  return guarded(async () => {
    const privateHex = hex(material(key).der).toUpperCase();
    const lines = [
      "SECRET / SECRETO",
      "waitron-custodian-paper",
      "version 1",
      "Ed25519 / PKCS8-DER / HEX",
      `scope ${JSON.stringify(key.scope)}`,
      `fingerprint ${key.fingerprint}`,
      "page 1/1",
    ];
    for (let i = 0; i < 12; i++) {
      const index = String(i + 1).padStart(2, "0"),
        group = privateHex.slice(i * 8, i * 8 + 8);
      lines.push(`${index}:${group}:${await groupCheck(key.scope, key.fingerprint, index, group)}`);
    }
    lines.push(`checksum ${await wholeCheck(key.scope, key.fingerprint, privateHex)}`);
    return lines.join("\n");
  });
}
export function restoreSecretPaper(text: string, expected: CustodyPublic): Promise<CustodyKey> {
  return guarded(async () => {
    const lines = bounded(text).replaceAll("\r\n", "\n").split("\n");
    if (
      lines.length !== 20 ||
      lines[0] !== "SECRET / SECRETO" ||
      lines[1] !== "waitron-custodian-paper" ||
      lines[2] !== "version 1" ||
      lines[3] !== "Ed25519 / PKCS8-DER / HEX" ||
      !lines[4]!.startsWith("scope ") ||
      !/^fingerprint [0-9a-f]{64}$/.test(lines[5]!) ||
      lines[6] !== "page 1/1" ||
      !/^checksum [0-9a-f]{64}$/.test(lines[19]!)
    )
      refuse();
    const scope = scopeOf(JSON.parse(lines[4]!.slice(6)) as unknown);
    const fingerprint = lines[5]!.slice(12);
    let privateHex = "";
    for (let i = 0; i < 12; i++) {
      const group = /^(\d{2}):([0-9A-F]{8}):([0-9A-F]{8})$/.exec(lines[7 + i]!);
      if (
        group === null ||
        group[1] !== String(i + 1).padStart(2, "0") ||
        group[3] !== (await groupCheck(scope, fingerprint, group[1], group[2]!))
      )
        refuse();
      privateHex += group[2];
    }
    if (lines[19]!.slice(9) !== (await wholeCheck(scope, fingerprint, privateHex))) refuse();
    const key = await fromDer(unhex(privateHex), scope, "secret-paper", expected);
    if (key.fingerprint !== fingerprint) {
      key.dispose();
      refuse();
    }
    return key;
  });
}
