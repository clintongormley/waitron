import QRCode from "qrcode";

export type PrintPreviewBlock =
  | { kind: "text"; text: string }
  | { kind: "feed"; lines: number }
  | { kind: "cut" }
  | { kind: "image"; width: number; height: number; data: string; qrData?: string };

export interface PrintJobPreview {
  text: string;
  blocks: PrintPreviewBlock[];
  qrData: string[];
  omittedGraphics: boolean;
  truncated: boolean;
  unsupported: boolean;
}

const MAX_INPUT_BYTES = 262_144;
const MAX_OUTPUT_CHARACTERS = 65_536;

/**
 * Decode the commands emitted by printing's EscBuilder. Unknown commands stop the preview:
 * skipping an unknown header could expose its binary body as invented receipt text.
 * Preserve printable command order within the input, text, bitmap, feed and block caps.
 * Only model-2 QR and normal raster commands are rendered; drawer pulses have no paper representation.
 */
export function previewPrintJob(payload: Uint8Array): PrintJobPreview {
  const result: PrintJobPreview = {
    text: "",
    blocks: [],
    qrData: [],
    omittedGraphics: false,
    truncated: false,
    unsupported: false,
  };
  const limit = Math.min(payload.length, MAX_INPUT_BYTES);
  let offset = 0;
  let outputLength = 0;
  let storedQr = "";
  let qrSize = 3;
  let qrLevel: "L" | "M" | "Q" | "H" = "L";
  let imageBytes = 0;
  let feedLines = 0;
  const appendBlock = (block: PrintPreviewBlock): boolean => {
    if (result.blocks.length >= 2048) {
      result.truncated = true;
      return false;
    }
    result.blocks.push(block);
    return true;
  };
  const appendImage = (
    width: number,
    height: number,
    bytes: Uint8Array,
    qrData?: string,
  ): boolean => {
    if (
      width < 1 ||
      height < 1 ||
      width > 2048 ||
      height > 2048 ||
      imageBytes + bytes.length > 262_144
    ) {
      result.omittedGraphics = true;
      return true;
    }
    imageBytes += bytes.length;
    return appendBlock({
      kind: "image",
      width,
      height,
      data: Buffer.from(bytes).toString("base64"),
      ...(qrData === undefined ? {} : { qrData }),
    });
  };
  const available = (length: number): boolean => {
    if (offset + length <= limit) return true;
    result.truncated = true;
    return false;
  };
  const appendQr = (): boolean => {
    if (outputLength + storedQr.length > MAX_OUTPUT_CHARACTERS || result.qrData.length >= 128) {
      result.truncated = true;
      return false;
    }
    result.qrData.push(storedQr);
    outputLength += storedQr.length;
    try {
      const qr = QRCode.create([{ mode: "byte", data: Buffer.from(storedQr, "latin1") }], {
        errorCorrectionLevel: qrLevel,
      });
      const side = (qr.modules.size + 8) * qrSize;
      if (side > 2048) {
        result.omittedGraphics = true;
        return true;
      }
      const stride = Math.ceil(side / 8);
      const bytes = new Uint8Array(stride * side);
      for (let y = 0; y < qr.modules.size; y++) {
        for (let x = 0; x < qr.modules.size; x++) {
          if (!qr.modules.get(y, x)) continue;
          for (let dy = 0; dy < qrSize; dy++) {
            for (let dx = 0; dx < qrSize; dx++) {
              const px = (x + 4) * qrSize + dx;
              const py = (y + 4) * qrSize + dy;
              bytes[py * stride + (px >> 3)]! |= 0x80 >> (px % 8);
            }
          }
        }
      }
      return appendImage(side, side, bytes, storedQr);
    } catch {
      result.omittedGraphics = true;
      return true;
    }
  };
  while (offset < limit) {
    const byte = payload[offset];
    if (byte === 0x0a || (byte >= 0x20 && byte <= 0x7e) || byte >= 0xa0) {
      if (outputLength === MAX_OUTPUT_CHARACTERS) {
        result.truncated = true;
        break;
      }
      const character = String.fromCharCode(byte);
      const last = result.blocks.at(-1);
      if (last?.kind === "text") last.text += character;
      else if (!appendBlock({ kind: "text", text: character })) break;
      result.text += character;
      outputLength++;
      offset++;
      continue;
    }
    if (!available(2)) break;
    const command = payload[offset + 1];
    if (byte === 0x1b && command === 0x40) {
      storedQr = "";
      qrSize = 3;
      qrLevel = "L";
      offset += 2;
      continue;
    }
    if (byte === 0x1b && (command === 0x64 || command === 0x70)) {
      const length = command === 0x64 ? 3 : 5;
      if (!available(length)) break;
      if (command === 0x64) {
        const lines = payload[offset + 2];
        if (feedLines + lines > 4096) {
          result.truncated = true;
          break;
        }
        feedLines += lines;
        if (lines > 0 && !appendBlock({ kind: "feed", lines })) break;
      }
      offset += length;
      continue;
    }
    if (byte === 0x1d && command === 0x56) {
      if (!available(3)) break;
      if (payload[offset + 2] !== 0) {
        result.unsupported = true;
        break;
      }
      if (!appendBlock({ kind: "cut" })) break;
      offset += 3;
      continue;
    }
    if (byte === 0x1d && command === 0x28) {
      if (!available(5)) break;
      const length = payload[offset + 3] + 256 * payload[offset + 4];
      if (!available(5 + length)) break;
      const fn = payload[offset + 6];
      if (
        payload[offset + 2] !== 0x6b ||
        length < 3 ||
        payload[offset + 5] !== 0x31 ||
        ![0x41, 0x43, 0x45, 0x50, 0x51].includes(fn) ||
        (fn === 0x41 && length !== 4) ||
        ([0x43, 0x45, 0x51].includes(fn) && length !== 3) ||
        ([0x50, 0x51].includes(fn) && payload[offset + 7] !== 0x30)
      ) {
        result.unsupported = true;
        break;
      }
      const parameter = payload[offset + 7];
      if (
        (fn === 0x41 && (parameter !== 0x32 || payload[offset + 8] !== 0)) ||
        (fn === 0x43 && (parameter < 1 || parameter > 16)) ||
        (fn === 0x45 && (parameter < 0x30 || parameter > 0x33))
      ) {
        result.unsupported = true;
        break;
      }
      if (fn === 0x43) qrSize = parameter;
      if (fn === 0x45) qrLevel = (["L", "M", "Q", "H"] as const)[parameter - 0x30];
      if (fn === 0x50) {
        storedQr = Buffer.from(payload.subarray(offset + 8, offset + 5 + length)).toString(
          "latin1",
        );
      }
      if (fn === 0x51 && !appendQr()) break;
      offset += 5 + length;
      continue;
    }
    if (byte === 0x1d && command === 0x76) {
      if (!available(8)) break;
      if (payload[offset + 2] !== 0x30 || payload[offset + 3] !== 0) {
        result.unsupported = true;
        break;
      }
      const width = payload[offset + 4] + 256 * payload[offset + 5];
      const height = payload[offset + 6] + 256 * payload[offset + 7];
      const length = 8 + width * height;
      if (!available(length)) break;
      if (!appendImage(width * 8, height, payload.subarray(offset + 8, offset + length))) break;
      offset += length;
      continue;
    }
    result.unsupported = true;
    break;
  }
  if (payload.length > MAX_INPUT_BYTES) result.truncated = true;
  return result;
}
