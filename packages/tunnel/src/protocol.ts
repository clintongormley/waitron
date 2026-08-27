// The tunnel's control-plane wire format: newline-delimited JSON frames used ONLY for the
// pre-splice handshake. After a `go` frame the connection carries raw bytes (the cloud's TLS
// records) and is never reframed — so decodeFrame stops after exactly one frame and returns the
// remaining bytes verbatim as `rest`, which the client hands straight to the byte splice.
export type Frame =
  | { t: "register"; boxId: string; token: string }
  | { t: "ack" }
  | { t: "reject"; code: string }
  | { t: "ping" }
  | { t: "pong" }
  | { t: "go" };

export function encodeFrame(frame: Frame): Buffer {
  return Buffer.from(`${JSON.stringify(frame)}\n`);
}

/**
 * The first complete newline-terminated frame in `buffer`, plus the bytes after that newline as
 * `rest`; or `null` when no `\n` has arrived yet. Parses at most one line, so bytes after a `go`
 * frame (raw TLS) are returned untouched in `rest` rather than fed to JSON.parse.
 */
export function decodeFrame(buffer: Buffer): { frame: Frame; rest: Buffer } | null {
  const nl = buffer.indexOf(0x0a);
  if (nl === -1) return null;
  const line = buffer.subarray(0, nl).toString();
  const rest = buffer.subarray(nl + 1);
  return { frame: JSON.parse(line) as Frame, rest };
}
