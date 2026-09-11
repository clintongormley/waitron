export interface PrintJobPreview {
  text: string;
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
 * Feed/cut/drawer commands are omitted, so this is a text preview, not a paper replica.
 */
export function previewPrintJob(payload: Uint8Array): PrintJobPreview {
  const result: PrintJobPreview = {
    text: "",
    qrData: [],
    omittedGraphics: false,
    truncated: false,
    unsupported: false,
  };
  const limit = Math.min(payload.length, MAX_INPUT_BYTES);
  let offset = 0;
  let outputLength = 0;
  let storedQr = "";
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
    return true;
  };
  while (offset < limit) {
    const byte = payload[offset];
    if (byte === 0x0a || (byte >= 0x20 && byte <= 0x7e) || byte >= 0xa0) {
      if (outputLength === MAX_OUTPUT_CHARACTERS) {
        result.truncated = true;
        break;
      }
      result.text += String.fromCharCode(byte);
      outputLength++;
      offset++;
      continue;
    }
    if (!available(2)) break;
    const command = payload[offset + 1];
    if (byte === 0x1b && command === 0x40) {
      storedQr = "";
      offset += 2;
      continue;
    }
    if (byte === 0x1b && (command === 0x64 || command === 0x70)) {
      const length = command === 0x64 ? 3 : 5;
      if (!available(length)) break;
      offset += length;
      continue;
    }
    if (byte === 0x1d && command === 0x56) {
      if (!available(3)) break;
      if (payload[offset + 2] !== 0) {
        result.unsupported = true;
        break;
      }
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
      result.omittedGraphics = true;
      offset += length;
      continue;
    }
    result.unsupported = true;
    break;
  }
  if (payload.length > MAX_INPUT_BYTES) result.truncated = true;
  return result;
}
