import { esc, prepareText } from "@waitron/printing";

const SAMPLE = "Café niño pingüino 5 €";

/** Print a human-readable probe for up to sixteen model-specific `ESC t n` assignments. */
export function formatCharacterTableTest(startTable: number): Uint8Array {
  if (!Number.isInteger(startTable) || startTable < 0 || startTable > 0xff) {
    throw new RangeError(`start table must be an integer in [0, 255], got ${startTable}`);
  }
  const b = esc("plain").init();
  b.line("CHARACTER TABLE FINDER");
  b.line("Choose a fully correct line.");
  b.line("W = Windows-1252; 8 = PC858");
  b.line();
  for (let table = startTable; table <= Math.min(0xff, startTable + 15); table++) {
    const label = `T${String(table).padStart(3, "0")}`;
    b.charset("wpc1252", table).line(`${label} W: ${prepareText(SAMPLE, "wpc1252")}`);
    b.charset("pc858", table).line(`${label} 8: ${prepareText(SAMPLE, "pc858")}`);
  }
  return b.feedAndCut().bytes();
}
