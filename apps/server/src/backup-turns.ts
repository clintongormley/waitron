/** Runs each body once every body handed over before it has settled, whatever its outcome. */
export type Turns = <T>(body: () => Promise<T>) => Promise<T>;

export function createTurns(): Turns {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(body: () => Promise<T>): Promise<T> => {
    const mine = tail.then(body);
    tail = mine.catch(() => undefined);
    return mine;
  };
}
