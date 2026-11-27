import type { CertKind } from "./aeat-transport.js";

// ETSI EN 319 411-2 V2.6.1 §5.3 (QCP-l, QCP-l-qscd) and FNMT's dpc_sello_entidad.pdf v1.0 (Sello de
// Entidad and its G2), read 2026-11-26. A seal carrying none of these reads as a representative's
// certificate.
const SEAL_POLICIES = new Set(
  [
    "0.4.0.194112.1.1",
    "0.4.0.194112.1.3",
    "1.3.6.1.4.1.5734.3.11.4",
    "1.3.6.1.4.1.5734.3.22.1.0",
  ].map(encodedOid),
);

const SEQUENCE = 0x30;
const OID = 0x06;
const OCTET_STRING = 0x04;
const EXTENSIONS = 0xa3;
const CERTIFICATE_POLICIES = encodedOid("2.5.29.32");

/** An OID's DER content bytes, as hex. */
function encodedOid(dotted: string): string {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first! * 40 + second!];
  for (let arc of rest) {
    const digits = [arc % 128];
    while ((arc = Math.floor(arc / 128)) > 0) digits.unshift((arc % 128) | 0x80);
    bytes.push(...digits);
  }
  return Buffer.from(bytes).toString("hex");
}

interface Element {
  tag: number;
  start: number;
  end: number;
}

class Malformed extends Error {}

function element(der: Buffer, at: number, limit: number): Element {
  if (at + 2 > limit) throw new Malformed();
  const tag = der[at]!;
  let length = der[at + 1]!;
  let start = at + 2;
  if (length > 0x7f) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || start + count > limit) throw new Malformed();
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + der[start + i]!;
    start += count;
  }
  if (start + length > limit) throw new Malformed();
  return { tag, start, end: start + length };
}

function children(der: Buffer, parent: Element): Element[] {
  const found: Element[] = [];
  for (let at = parent.start; at < parent.end; at = found.at(-1)!.end) {
    found.push(element(der, at, parent.end));
  }
  return found;
}

function only(der: Buffer, parent: Element, tag: number): Element {
  const inner = element(der, parent.start, parent.end);
  if (inner.tag !== tag || inner.end !== parent.end) throw new Malformed();
  return inner;
}

function oid(der: Buffer, node: Element | undefined): string {
  if (node?.tag !== OID) throw new Malformed();
  return der.subarray(node.start, node.end).toString("hex");
}

function policies(der: Buffer): string[] {
  const certificate = element(der, 0, der.length);
  if (certificate.tag !== SEQUENCE) throw new Malformed();
  const [tbs] = children(der, certificate);
  if (tbs?.tag !== SEQUENCE) throw new Malformed();
  const wrapper = children(der, tbs).find((field) => field.tag === EXTENSIONS);
  if (wrapper === undefined) return [];
  for (const extension of children(der, only(der, wrapper, SEQUENCE))) {
    const fields = children(der, extension);
    if (oid(der, fields[0]) !== CERTIFICATE_POLICIES) continue;
    const value = fields.at(-1)!;
    if (value.tag !== OCTET_STRING) throw new Malformed();
    const found = children(der, only(der, value, SEQUENCE)).map((policy) => {
      if (policy.tag !== SEQUENCE) throw new Malformed();
      return oid(der, children(der, policy)[0]);
    });
    // RFC 5280 §4.2.1.4: a policy OID must not appear more than once.
    if (new Set(found).size !== found.length) throw new Malformed();
    return found;
  }
  return [];
}

/** Reads a DER certificate's kind from its policies; malformed input reads as a representative. */
export function certificateKind(der: Buffer): CertKind {
  try {
    return policies(der).some((policy) => SEAL_POLICIES.has(policy)) ? "sello" : "representante";
  } catch {
    return "representante";
  }
}
