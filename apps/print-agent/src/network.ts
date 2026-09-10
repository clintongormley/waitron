import type { DiscoveredDevice } from "@waitron/print-agent";

/**
 * The mDNS service printers announce a raw-9100 (ESC/POS) queue under (verified against the design's §7
 * capture note; the real-LAN receipt confirms it). `parsePdlResponse` decodes one response packet into
 * the printers it advertises. The live multicast socket is a separate, gated seam ({@link openMdnsProbe});
 * this parser is pure and fully tested, because a wrong decode is the failure that reaches a real print.
 */
export const PDL_SERVICE = "_pdl-datastream._tcp.local";

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;

interface Reader {
  buf: Buffer;
  offset: number;
}

/** Reads a DNS name, following compression pointers (0xC0) to earlier offsets. Bounds- and loop-guarded:
 * a pointer past the buffer or a longer-than-the-packet chain throws, caught by {@link parsePdlResponse}
 * so a malformed packet yields no devices rather than a crash. Advances `r.offset` past the name in the
 * record stream (a pointer ends the name; the offset stops just after the two pointer bytes). */
function readName(r: Reader): string {
  const labels: string[] = [];
  let offset = r.offset;
  let jumped = false;
  let guard = 0;
  for (;;) {
    if (guard++ > r.buf.length) throw new Error("dns name loop");
    if (offset >= r.buf.length) throw new Error("dns name overrun");
    const len = r.buf[offset]!;
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (offset + 1 >= r.buf.length) throw new Error("dns pointer overrun");
      const pointer = ((len & 0x3f) << 8) | r.buf[offset + 1]!;
      if (!jumped) r.offset = offset + 2;
      offset = pointer;
      jumped = true;
      continue;
    }
    const start = offset + 1;
    const end = start + len;
    if (end > r.buf.length) throw new Error("dns label overrun");
    labels.push(r.buf.toString("ascii", start, end));
    offset = end;
  }
  if (!jumped) r.offset = offset;
  return labels.join(".");
}

interface ResourceRecord {
  name: string;
  type: number;
  rdata: Buffer;
  rdataOffset: number;
}

function readQuestion(r: Reader): void {
  readName(r);
  r.offset += 4; // qtype + qclass
}

function readRecord(r: Reader): ResourceRecord {
  const name = readName(r);
  const type = r.buf.readUInt16BE(r.offset);
  const rdlength = r.buf.readUInt16BE(r.offset + 8);
  const rdataOffset = r.offset + 10;
  const end = rdataOffset + rdlength;
  if (end > r.buf.length) throw new Error("dns rdata overrun");
  const rdata = r.buf.subarray(rdataOffset, end);
  r.offset = end;
  return { name, type, rdata, rdataOffset };
}

/** Lower-cased, trailing-dot-stripped, for matching an SRV target against an A record's owner. */
function key(name: string): string {
  return name.replace(/\.$/, "").toLowerCase();
}

function parseTxt(rdata: Buffer): Map<string, string> {
  const attrs = new Map<string, string>();
  let i = 0;
  while (i < rdata.length) {
    const len = rdata[i]!;
    const start = i + 1;
    const end = start + len;
    if (end > rdata.length) break;
    const pair = rdata.toString("utf8", start, end);
    const eq = pair.indexOf("=");
    if (eq > 0) attrs.set(pair.slice(0, eq).toLowerCase(), pair.slice(eq + 1));
    i = end;
  }
  return attrs;
}

interface SrvRecord {
  name: string;
  port: number;
  target: string;
}

export function parsePdlResponse(packet: Buffer): DiscoveredDevice[] {
  try {
    if (packet.length < 12) return [];
    const counts = {
      qd: packet.readUInt16BE(4),
      an: packet.readUInt16BE(6),
      ns: packet.readUInt16BE(8),
      ar: packet.readUInt16BE(10),
    };
    const r: Reader = { buf: packet, offset: 12 };
    for (let i = 0; i < counts.qd; i++) readQuestion(r);

    const srvs: SrvRecord[] = [];
    const addresses = new Map<string, string>();
    const txts = new Map<string, Map<string, string>>();
    const total = counts.an + counts.ns + counts.ar;
    for (let i = 0; i < total; i++) {
      const rec = readRecord(r);
      switch (rec.type) {
        case TYPE_SRV: {
          const port = rec.rdata.readUInt16BE(4);
          const target = readName({ buf: packet, offset: rec.rdataOffset + 6 });
          srvs.push({ name: rec.name, port, target });
          break;
        }
        case TYPE_A:
          if (rec.rdata.length === 4) addresses.set(key(rec.name), rec.rdata.join("."));
          break;
        case TYPE_TXT:
          txts.set(key(rec.name), parseTxt(rec.rdata));
          break;
        case TYPE_PTR:
          break;
      }
    }

    const devices: DiscoveredDevice[] = [];
    for (const srv of srvs) {
      const host = addresses.get(key(srv.target)) ?? srv.target.replace(/\.$/, "");
      const attrs = txts.get(key(srv.name));
      const make = attrs?.get("usb_mfg");
      const model = attrs?.get("usb_mdl") ?? attrs?.get("ty");
      devices.push({
        transport: "network_tcp",
        host,
        port: srv.port,
        // The instance label the printer chose (the first label of its SRV owner), which the operator
        // recognises on the dashboard's discovered list.
        name: srv.name.split(".")[0] ?? srv.name,
        ...(make !== undefined ? { make } : {}),
        ...(model !== undefined ? { model } : {}),
      });
    }
    return devices;
  } catch {
    // A truncated or malformed packet (a stray multicast frame) yields no devices, never a throw.
    return [];
  }
}
