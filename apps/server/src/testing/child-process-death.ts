import { expect } from "vitest";

interface ChildOutcome {
  code: number | string | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Awaits an `execFile` run that must end in `expected.signal`, having printed exactly
 * `expected.stdout` when that is given. A failure names the child's exit code, signal, stdout and
 * stderr: the error `execFile` rejects with carries them, but a `toMatchObject` diff prints only
 * the keys it compares.
 */
export async function expectChildKilled(
  run: Promise<{ stdout: string; stderr: string }>,
  expected: { signal: NodeJS.Signals; stdout?: string },
): Promise<void> {
  const outcome: ChildOutcome = await run.then(
    ({ stdout, stderr }) => ({ code: 0, signal: null, stdout, stderr }),
    (error: Partial<ChildOutcome>) => ({
      code: error.code ?? null,
      signal: error.signal ?? null,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    }),
  );
  expect(
    {
      signal: outcome.signal,
      ...(expected.stdout === undefined ? {} : { stdout: outcome.stdout }),
    },
    `child ended with exit code ${outcome.code}, signal ${outcome.signal}\n` +
      `--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}\n---`,
  ).toEqual(expected);
}
