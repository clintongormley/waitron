/** One workbook made, or passed on, at a time; kept in memory. */
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
