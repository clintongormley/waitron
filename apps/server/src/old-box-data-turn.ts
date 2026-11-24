/** One workbook made at a time, shared by the old box's page and its peer route; kept in memory. */
export interface BuildTurn {
  /** The turn's release, or null while another build holds it. */
  take(): (() => void) | null;
}

export function oneBuildAtATime(): BuildTurn {
  let held = false;
  return {
    take() {
      if (held) return null;
      held = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held = false;
      };
    },
  };
}
