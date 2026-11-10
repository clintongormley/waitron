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
    /** Throws when no responder took this socket, so an empty answer cannot mean an unwired one. */
    query: (name: string) => {
      if (onQuery === undefined) throw new Error("no mDNS responder is listening on this socket");
      onQuery({ questions: [{ name, type: "A" }] });
    },
    answered: () => [...new Set(responses.flatMap((r) => r.answers.map((a) => a.name)))],
    answers: () => responses.flatMap((r) => r.answers),
    clear: () => responses.splice(0),
  };
}
