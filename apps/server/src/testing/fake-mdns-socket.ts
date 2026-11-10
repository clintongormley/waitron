import type { MdnsAnswer, MdnsSocket } from "../mdns.js";

/** A responder socket a boot test hands queries to and reads the answered names from. */
export function fakeMdnsSocket() {
  let onQuery: ((query: { questions: { name: string; type: string }[] }) => void) | undefined;
  const responses: { answers: MdnsAnswer[] }[] = [];
  const socket: MdnsSocket = {
    on: ((event: string, handler: never) => {
      if (event === "query") onQuery = handler;
    }) as MdnsSocket["on"],
    respond: (response) => responses.push(response),
    destroy: (cb) => cb?.(),
  };
  return {
    socket,
    query: (name: string) => onQuery?.({ questions: [{ name, type: "A" }] }),
    answered: () => [...new Set(responses.flatMap((r) => r.answers.map((a) => a.name)))],
    clear: () => responses.splice(0),
  };
}
