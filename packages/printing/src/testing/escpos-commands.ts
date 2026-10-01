const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const DLE = 0x10;
const LF = 0x0a;
const COMMAND_START = [LF, ESC, GS, FS, DLE];

export interface EscPosCommand {
  /** `ESC p`, `GS v 0` and so on; `text` for a run of bytes that are not a command. */
  name: string;
  offset: number;
  length: number;
  /** A `GS v 0` image's size, read from its header. */
  widthDots?: number;
  heightDots?: number;
}

/** Commands of a fixed length, by their first two bytes. */
const FIXED: ReadonlyMap<number, { name: string; length: number }> = new Map([
  [(ESC << 8) | 0x40, { name: "ESC @", length: 2 }],
  [(ESC << 8) | 0x61, { name: "ESC a", length: 3 }],
  [(ESC << 8) | 0x64, { name: "ESC d", length: 3 }],
  [(ESC << 8) | 0x70, { name: "ESC p", length: 5 }],
  [(ESC << 8) | 0x74, { name: "ESC t", length: 3 }],
  [(FS << 8) | 0x2e, { name: "FS .", length: 2 }],
  [(GS << 8) | 0x56, { name: "GS V", length: 3 }],
  [(GS << 8) | 0x4c, { name: "GS L", length: 4 }],
  [(GS << 8) | 0x57, { name: "GS W", length: 4 }],
]);

/**
 * The commands of an ESC/POS payload in order, stepping over the data of `GS v 0` images and
 * `GS ( k` blocks, whose bytes can hold any sequence — a drawer pulse among them. Knows the commands
 * printing's builder sends, plus `ESC t`, `FS .` and the real-time drawer pulse `DLE DC4 1 m t`; any
 * other command, or one cut short by the end of the payload, throws a RangeError rather than guessing
 * where the next command starts. Kept apart from the preview's parser on purpose: a test oracle that
 * shared the production parser would share its bugs.
 */
export function escPosCommands(payload: Uint8Array): EscPosCommand[] {
  const commands: EscPosCommand[] = [];
  let offset = 0;
  const take = (name: string, length: number, size?: { widthDots: number; heightDots: number }) => {
    if (offset + length > payload.length) {
      throw new RangeError(`${name} at byte ${offset} runs past the end of the payload`);
    }
    commands.push({ name, offset, length, ...size });
    offset += length;
  };
  const at = (i: number): number => payload[offset + i] ?? 0;
  while (offset < payload.length) {
    const byte = payload[offset]!;
    if (byte === LF) {
      take("LF", 1);
    } else if (byte === DLE) {
      if (at(1) === 0x14 && at(2) === 0x01) take("DLE DC4", 5);
      else throw new RangeError(`unknown DLE command at byte ${offset}`);
    } else if (byte === ESC || byte === GS || byte === FS) {
      if (offset + 1 >= payload.length) {
        throw new RangeError(`a command at byte ${offset} runs past the end of the payload`);
      }
      const second = payload[offset + 1]!;
      const fixed = FIXED.get((byte << 8) | second);
      if (fixed !== undefined) take(fixed.name, fixed.length);
      else if (byte === GS && second === 0x76 && at(2) === 0x30) {
        const widthBytes = at(4) | (at(5) << 8);
        const heightDots = at(6) | (at(7) << 8);
        take("GS v 0", 8 + widthBytes * heightDots, { widthDots: widthBytes * 8, heightDots });
      } else if (byte === GS && second === 0x28 && at(2) === 0x6b) {
        take("GS ( k", 5 + (at(3) | (at(4) << 8)));
      } else {
        throw new RangeError(
          `unknown command 0x${byte.toString(16)} 0x${second.toString(16)} at byte ${offset}`,
        );
      }
    } else {
      let end = offset;
      while (end < payload.length && !COMMAND_START.includes(payload[end]!)) end++;
      take("text", end - offset);
    }
  }
  return commands;
}
