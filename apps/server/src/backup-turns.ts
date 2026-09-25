/**
 * Runs each body once every body handed over before it has settled, whatever its outcome. The backup
 * routes and the stream settings' Save each read the held recovery key and then write one; side by
 * side, one could write back a key another just replaced. The stream host also refuses a reload
 * while another runs.
 */
export type Turns = <T>(body: () => Promise<T>) => Promise<T>;

export function createTurns(): Turns {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(body: () => Promise<T>): Promise<T> => {
    const mine = tail.then(body);
    tail = mine.catch(() => undefined);
    return mine;
  };
}
