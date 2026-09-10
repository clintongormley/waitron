import { describe, expect, it } from "vitest";
import { parsePdlResponse } from "./network.js";

// A minimal DNS wire encoder — independent of the parser — so the test drives real bytes through
// `parsePdlResponse`: length-prefixed labels, a compression POINTER (0xC0) for the SRV target so the
// parser's pointer-following path is exercised, big-endian 16/32-bit fields.
class DnsWriter {
  private bytes: number[] = [];
  private readonly names = new Map<string, number>();

  u16(n: number): this {
    this.bytes.push((n >> 8) & 0xff, n & 0xff);
    return this;
  }
  u32(n: number): this {
    this.bytes.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    return this;
  }
  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  /** Writes a name, reusing a compression pointer to any suffix already written. */
  name(fqdn: string): this {
    let labels = fqdn.replace(/\.$/, "").split(".");
    while (labels.length > 0) {
      const suffix = labels.join(".");
      const seen = this.names.get(suffix);
      if (seen !== undefined) {
        this.bytes.push(0xc0 | ((seen >> 8) & 0x3f), seen & 0xff);
        return this;
      }
      this.names.set(suffix, this.bytes.length);
      const label = labels[0]!;
      this.bytes.push(label.length);
      for (const ch of label) this.bytes.push(ch.charCodeAt(0));
      labels = labels.slice(1);
    }
    this.bytes.push(0);
    return this;
  }
  build(): Buffer {
    return Buffer.from(this.bytes);
  }
}

function txtRdata(pairs: string[]): number[] {
  const out: number[] = [];
  for (const p of pairs) {
    out.push(p.length);
    for (const ch of p) out.push(ch.charCodeAt(0));
  }
  return out;
}

describe("parsePdlResponse", () => {
  it("decodes an SRV+A+TXT _pdl-datastream._tcp announcement into host/port/name/make/model", () => {
    const service = "_pdl-datastream._tcp.local";
    const instance = `HP LaserJet.${service}`;
    const target = "hp-printer.local";
    const w = new DnsWriter();
    w.u16(0).u16(0x8400).u16(0).u16(4).u16(0).u16(0); // header: response, 4 answers
    // PTR: service -> instance
    w.name(service).u16(12).u16(1).u32(120);
    const ptr = new DnsWriter().name(instance).build();
    w.u16(ptr.length).raw(...ptr);
    // SRV: instance -> priority/weight/port/target (target as a name, compressible)
    w.name(instance).u16(33).u16(1).u32(120);
    const srv = new DnsWriter();
    srv.u16(0).u16(0).u16(9100);
    // append the target name via a fresh writer whose offsets we cannot share, so write it inline:
    const srvBytes = [...srv.build()];
    const targetName = new DnsWriter().name(target).build();
    w.u16(srvBytes.length + targetName.length)
      .raw(...srvBytes)
      .raw(...targetName);
    // TXT: instance attributes
    w.name(instance).u16(16).u16(1).u32(120);
    const txt = txtRdata(["ty=HP LaserJet 4000", "usb_MFG=HP", "usb_MDL=LaserJet 4000"]);
    w.u16(txt.length).raw(...txt);
    // A: target -> 192.168.1.50
    w.name(target).u16(1).u16(1).u32(120).u16(4).raw(192, 168, 1, 50);

    expect(parsePdlResponse(w.build())).toEqual([
      {
        transport: "network_tcp",
        host: "192.168.1.50",
        port: 9100,
        name: "HP LaserJet",
        make: "HP",
        model: "LaserJet 4000",
      },
    ]);
  });

  it("falls back to the SRV target hostname when no A record is present", () => {
    const service = "_pdl-datastream._tcp.local";
    const instance = `Star.${service}`;
    const w = new DnsWriter();
    w.u16(0).u16(0x8400).u16(0).u16(1).u16(0).u16(0);
    w.name(instance).u16(33).u16(1).u32(120);
    const srvBytes = [...new DnsWriter().u16(0).u16(0).u16(9100).build()];
    const targetName = new DnsWriter().name("star.local").build();
    w.u16(srvBytes.length + targetName.length)
      .raw(...srvBytes)
      .raw(...targetName);
    expect(parsePdlResponse(w.build())).toEqual([
      { transport: "network_tcp", host: "star.local", port: 9100, name: "Star" },
    ]);
  });

  it("skips the question section (some responders echo the query) and still reads the answer", () => {
    const service = "_pdl-datastream._tcp.local";
    const instance = `Star.${service}`;
    const w = new DnsWriter();
    w.u16(0).u16(0x8400).u16(1).u16(1).u16(0).u16(0); // one question, one answer
    w.name(service).u16(12).u16(1); // question: PTR IN (no ttl/rdata)
    w.name(instance).u16(33).u16(1).u32(120);
    const srvBytes = [...new DnsWriter().u16(0).u16(0).u16(9100).build()];
    const targetName = new DnsWriter().name("star.local").build();
    w.u16(srvBytes.length + targetName.length)
      .raw(...srvBytes)
      .raw(...targetName);
    expect(parsePdlResponse(w.build())).toEqual([
      { transport: "network_tcp", host: "star.local", port: 9100, name: "Star" },
    ]);
  });

  it("ignores a truncated/garbage packet without throwing", () => {
    expect(parsePdlResponse(Buffer.from([0, 1, 2]))).toEqual([]);
    expect(parsePdlResponse(Buffer.alloc(0))).toEqual([]);
  });

  it("returns no devices when a record overruns the buffer (malformed mid-parse)", () => {
    // Header claims one answer, but the buffer ends immediately — reading the record overruns and the
    // parser folds it to an empty result rather than throwing.
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0x8400, 2);
    header.writeUInt16BE(1, 6); // ancount = 1, no record follows
    expect(parsePdlResponse(header)).toEqual([]);
  });
});
