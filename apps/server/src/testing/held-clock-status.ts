import { expect } from "vitest";
import type { ClockServiceStatus } from "../box-host-client.js";

/** A time-service status whose answer is held until `release`; `asked` settles once it is asked. */
export function heldClockStatus(): {
  status: () => Promise<ClockServiceStatus>;
  asked: Promise<void>;
  release: (answer: ClockServiceStatus) => void;
} {
  let markAsked!: () => void;
  const asked = new Promise<void>((resolve) => (markAsked = resolve));
  let release!: (answer: ClockServiceStatus) => void;
  const answer = new Promise<ClockServiceStatus>((resolve) => (release = resolve));
  return {
    status: () => {
      markAsked();
      return answer;
    },
    asked,
    release,
  };
}

/** Once the held status is asked, a write must run before the host answers. */
export async function expectWriteRunsWhileHostHeld(
  db: { withWriteLock: <T>(body: () => Promise<T>) => Promise<T> },
  held: ReturnType<typeof heldClockStatus>,
  answer: ClockServiceStatus,
): Promise<void> {
  const events: string[] = [];
  await held.asked;
  const write = db.withWriteLock(() => {
    events.push("wrote");
    return Promise.resolve();
  });
  // A free lock runs the write in this turn's microtasks; one held by the read cannot.
  await new Promise((resolve) => setImmediate(resolve));
  events.push("host answered");
  held.release(answer);
  await write;
  expect(events).toEqual(["wrote", "host answered"]);
}
