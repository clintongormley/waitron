import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { policiesExtension } from "../test/certificate-fixtures.js";
import { certificateKind } from "./certificate-policy.js";

const { create, Class, Type, toDer } = forge.asn1;
type Asn1 = forge.asn1.Asn1;

const QCP_L = "0.4.0.194112.1.1";
const QCP_L_QSCD = "0.4.0.194112.1.3";
const FNMT_SELLO = "1.3.6.1.4.1.5734.3.11.4";
const FNMT_SELLO_G2 = "1.3.6.1.4.1.5734.3.22.1.0";
const QCP_N = "0.4.0.194112.1.0";
const QCP_N_QSCD = "0.4.0.194112.1.2";
const FNMT_REPRESENTATIVE = "1.3.6.1.4.1.5734.3.11.1";

const seq = (value: Asn1[]) => create(Class.UNIVERSAL, Type.SEQUENCE, true, value);
const oid = (dotted: string) =>
  create(Class.UNIVERSAL, Type.OID, false, forge.asn1.oidToDer(dotted).getBytes());
const octets = (bytes: string) => create(Class.UNIVERSAL, Type.OCTETSTRING, false, bytes);
const integer = (n: number) => create(Class.UNIVERSAL, Type.INTEGER, false, String.fromCharCode(n));

/** An extension as RFC 5280 writes it: OID, optional critical flag, OCTET STRING. */
function extension(id: string, value: string, critical = false): Asn1 {
  return seq([
    oid(id),
    ...(critical ? [create(Class.UNIVERSAL, Type.BOOLEAN, false, "\xff")] : []),
    octets(value),
  ]);
}

function policies(oids: string[]): string {
  return (policiesExtension(oids) as { value: string }).value;
}

const KEY_USAGE = extension(
  "2.5.29.15",
  toDer(create(0, Type.BITSTRING, false, "\x05\xa0")).getBytes(),
);

interface Outline {
  certificateTag?: number;
  tbsTag?: number;
  /** Raw bytes placed in tbsCertificate before its extensions. */
  tbsBefore?: Buffer;
  /** Raw bytes placed in tbsCertificate after its extensions. */
  tbsAfter?: Buffer;
  /** The tag of the list inside the extensions' [3] wrapper. */
  extensionsTag?: number;
  /** Raw bytes placed in the [3] wrapper after that list. */
  extensionsAfter?: Buffer;
}

function tlv(tag: number, content: Buffer): Buffer {
  const length = content.length;
  const header =
    length < 0x80
      ? [tag, length]
      : length < 0x100
        ? [tag, 0x81, length]
        : [tag, 0x82, length >> 8, length & 0xff];
  return Buffer.concat([Buffer.from(header), content]);
}

const der = (node: Asn1) => Buffer.from(toDer(node).getBytes(), "binary");

function tbsCertificate(extensions: Asn1[] | null, outline: Outline): Buffer {
  return tlv(
    outline.tbsTag ?? 0x30,
    Buffer.concat([
      der(create(Class.CONTEXT_SPECIFIC, 0, true, [integer(2)])),
      der(integer(7)),
      der(seq([oid("1.2.840.113549.1.1.11")])),
      outline.tbsBefore ?? Buffer.alloc(0),
      extensions === null
        ? Buffer.alloc(0)
        : tlv(
            0xa3,
            Buffer.concat([
              tlv(outline.extensionsTag ?? 0x30, Buffer.concat(extensions.map(der))),
              outline.extensionsAfter ?? Buffer.alloc(0),
            ]),
          ),
      outline.tbsAfter ?? Buffer.alloc(0),
    ]),
  );
}

/** A certificate's outline: the reader walks structure only, so no signature is needed. */
function certificate(extensions: Asn1[] | null, outline: Outline = {}): Buffer {
  return tlv(
    outline.certificateTag ?? 0x30,
    Buffer.concat([
      tbsCertificate(extensions, outline),
      der(seq([oid("1.2.840.113549.1.1.11")])),
      der(create(0, Type.BITSTRING, false, "\x00")),
    ]),
  );
}

const withPolicies = (oids: string[]) =>
  certificate([KEY_USAGE, extension("2.5.29.32", policies(oids))]);

describe("certificateKind", () => {
  it.each([
    ["QCP-l", QCP_L],
    ["QCP-l-qscd", QCP_L_QSCD],
    ["FNMT's Sello de Entidad", FNMT_SELLO],
    ["FNMT's Sello de Entidad G2", FNMT_SELLO_G2],
  ])("reads a %s policy as a seal", (_label, policy) => {
    expect(certificateKind(withPolicies([policy]))).toBe("sello");
  });

  it.each([
    ["QCP-n", QCP_N],
    ["QCP-n-qscd", QCP_N_QSCD],
    ["an FNMT representative policy", FNMT_REPRESENTATIVE],
  ])("reads a %s policy as a representative", (_label, policy) => {
    expect(certificateKind(withPolicies([policy]))).toBe("representante");
  });

  it("finds a seal policy that is not the first in the list", () => {
    expect(certificateKind(withPolicies([FNMT_REPRESENTATIVE, QCP_N, QCP_L]))).toBe("sello");
  });

  it("finds the policies extension when it is marked critical", () => {
    const cert = certificate([extension("2.5.29.32", policies([QCP_L]), true)]);
    expect(certificateKind(cert)).toBe("sello");
  });

  it("reads a seal OID in another extension as no policy", () => {
    expect(certificateKind(certificate([extension("2.5.29.33", policies([QCP_L]))]))).toBe(
      "representante",
    );
  });

  it("reads a certificate with no policies extension as a representative", () => {
    expect(certificateKind(certificate([KEY_USAGE]))).toBe("representante");
  });

  it("reads a certificate with no extensions at all as a representative", () => {
    expect(certificateKind(certificate(null))).toBe("representante");
  });

  it("does not take a seal OID outside the extensions as a policy", () => {
    const tbsBefore = der(seq([oid(QCP_L)]));
    expect(certificateKind(certificate(null, { tbsBefore }))).toBe("representante");
  });

  it.each([
    [0, [0x04, 0x00]],
    [127, [0x04, 0x7f]],
    [128, [0x04, 0x81, 0x80]],
    [255, [0x04, 0x81, 0xff]],
    [256, [0x04, 0x82, 0x01, 0x00]],
    [300, [0x04, 0x82, 0x01, 0x2c]],
  ])("skips another tbsCertificate field holding %i bytes", (size, header) => {
    const field = der(octets("\x00".repeat(size)));
    expect([...field.subarray(0, header.length)]).toEqual(header);
    const cert = certificate([extension("2.5.29.32", policies([QCP_L]))], { tbsBefore: field });
    expect(certificateKind(cert)).toBe("sello");
  });

  it("reads a policy only from an OID in its first field", () => {
    const sealBytes = forge.asn1.oidToDer(QCP_L).getBytes();
    const notOid = toDer(seq([seq([octets(sealBytes)])])).getBytes();
    expect(certificateKind(certificate([extension("2.5.29.32", notOid)]))).toBe("representante");
    const second = toDer(seq([seq([integer(1), oid(QCP_L)])])).getBytes();
    expect(certificateKind(certificate([extension("2.5.29.32", second)]))).toBe("representante");
  });

  it("reads an extension's id only from an OID", () => {
    const policyBytes = forge.asn1.oidToDer("2.5.29.32").getBytes();
    const cert = certificate([seq([octets(policyBytes), octets(policies([QCP_L]))])]);
    expect(certificateKind(cert)).toBe("representante");
  });

  it("does not read a prefix or an extension of a seal OID as the seal", () => {
    expect(certificateKind(withPolicies(["0.4.0.194112.1"]))).toBe("representante");
    expect(certificateKind(withPolicies(["0.4.0.194112.1.1.5"]))).toBe("representante");
    expect(certificateKind(withPolicies(["2.4.0.194112.1.1"]))).toBe("representante");
  });

  describe("never throws on malformed input", () => {
    const valid = withPolicies([QCP_L]);
    const policiesAt = valid.indexOf(
      Buffer.from(forge.asn1.oidToDer("2.5.29.32").getBytes(), "binary"),
    );

    it.each([
      ["no bytes", Buffer.alloc(0)],
      ["one byte", Buffer.from([0x30])],
      ["random bytes", Buffer.from("not a certificate at all")],
      ["a truncated certificate", valid.subarray(0, policiesAt + 6)],
      ["a certificate missing its last byte", valid.subarray(0, valid.length - 1)],
      ["an indefinite length", Buffer.from([0x30, 0x80, 0x00, 0x00])],
      ["a length longer than the input", Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff])],
      ["a length of length past the input", Buffer.from([0x30, 0x82, 0x01])],
      ["a certificate that is not a sequence", Buffer.from([0x31, 0x00])],
      ["an empty certificate", Buffer.from([0x30, 0x00])],
      [
        "a certificate whose first field is not a sequence",
        Buffer.from([0x30, 0x03, 0x02, 0x01, 0x07]),
      ],
    ])("%s", (_label, input) => {
      expect(() => certificateKind(input)).not.toThrow();
      expect(certificateKind(input)).toBe("representante");
    });

    it.each([
      ["is not DER", "\xff\xff"],
      [
        "is a set, not a sequence",
        toDer(create(0, Type.SET, true, [seq([oid(QCP_L)])])).getBytes(),
      ],
      ["holds a policy that is not a sequence", toDer(seq([oid(QCP_L)])).getBytes()],
      ["has bytes after its sequence", `${toDer(seq([seq([oid(QCP_L)])])).getBytes()}\x00`],
      ["holds an empty policy", toDer(seq([seq([])])).getBytes()],
      [
        "holds a policy that is a set",
        toDer(seq([create(0, Type.SET, true, [oid(QCP_L)])])).getBytes(),
      ],
      ["names a seal policy twice", policies([QCP_L, QCP_L])],
      ["names another policy twice beside a seal policy", policies([QCP_N, QCP_L, QCP_N])],
    ])("a policies extension that %s", (_label, value) => {
      const cert = certificate([extension("2.5.29.32", value)]);
      expect(() => certificateKind(cert)).not.toThrow();
      expect(certificateKind(cert)).toBe("representante");
    });

    it("an extension whose value is not an OCTET STRING", () => {
      const value = create(Class.CONTEXT_SPECIFIC, 0, true, [seq([seq([oid(QCP_L)])])]);
      expect(certificateKind(certificate([seq([oid("2.5.29.32"), value])]))).toBe("representante");
    });

    it.each([
      ["a certificate that is a set", { certificateTag: 0x31 }],
      ["a tbsCertificate that is a set", { tbsTag: 0x31 }],
      [
        "an indefinite length before the extensions",
        { tbsBefore: Buffer.from([0x04, 0x80, ...Array<number>(128).fill(0)]) },
      ],
      [
        "a five-byte length before the extensions",
        { tbsBefore: Buffer.from([0x04, 0x85, 0, 0, 0, 0, 1, 0]) },
      ],
      ["its extensions in a set", { extensionsTag: 0x31 }],
      ["a byte after its extensions' sequence", { extensionsAfter: Buffer.from([0x00]) }],
    ])("an otherwise sealed certificate with %s", (_label, outline: Outline) => {
      const cert = certificate([extension("2.5.29.32", policies([QCP_L]))], outline);
      expect(certificateKind(cert)).toBe("representante");
    });

    it.each([
      ["a lone tag byte", [0x04]],
      ["a length whose bytes run past the end", [0x04, 0x82, 0x01]],
    ])("an otherwise sealed certificate whose last bytes are %s", (_label, last) => {
      const tbs = tbsCertificate([extension("2.5.29.32", policies([QCP_L]))], {
        tbsAfter: Buffer.from(last),
      });
      expect(certificateKind(tlv(0x30, tbs))).toBe("representante");
    });
  });
});
