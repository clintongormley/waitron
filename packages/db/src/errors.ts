// A bare side-effect import. It is what makes TypeScript treat "@waitron/shared" as a real module
// to augment rather than defining a fresh ambient module of the same name.
import "@waitron/shared";

/**
 * packages/db's own contribution to the shared error registry, added by declaration merging — see
 * the design note atop packages/shared/src/errors.ts.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * No such dining table. It lives here rather than in a verb package because it has throwers in
     * more than one package, and only their common dependency — this package — can hold the one
     * declaration they all import. `tableId` echoes the id the caller sent, so it carries no
     * secret. A DEACTIVATED table is the distinct `table.inactive`.
     */
    "table.not_found": { tableId: string };
    /**
     * No working order with this id where the caller looked. Declared here, as `table.not_found`
     * is, because it has throwers in more than one package. Retrieving a held order reads OPEN
     * orders only, so there a settled or abandoned order reports this same code, and the answer does
     * not confirm a closed order exists.
     */
    "working_order.not_found": { workingOrderId: string };
    /**
     * No kitchen station with this id in this venue, or, for a caller picking a routing or default
     * target, one that is DEACTIVATED: to that caller absent and retired are the same fact.
     * Declared here, as `table.not_found` is, because it has throwers in more than one package.
     */
    "station.not_found": { stationId: string };
    "series.not_found": { seriesId: string };
    /**
     * A node has no `purpose='standard'` invoice series. A corruption/misuse refusal, structured so
     * it reaches a screen translatable rather than a raw empty-result crash.
     */
    "series.no_standard_for_node": { nodeId: string };
    /**
     * A series code being opened for a node is one the node already holds — live or retired: the
     * natural key `(node_id, code)` covers both, so a retired code can never be reopened.
     * Reached only by a restore deriving a code that a human had chosen earlier; the restore is
     * redone.
     */
    "series.code_collision": { code: string };
    /**
     * A database already belongs to a different environment. Never overwritten: the rows written
     * under the first stamp cannot be moved to the second — an invoice series that filed to
     * pre-production has a numbering hole in production that nothing can fill.
     */
    "deployment.already_stamped": { stamped: string; requested: string };
    /**
     * A node's role was written to a database that has not been stamped with its environment
     * (`stampDeployment` must run first). A promotion primitive fails loud here rather than record a
     * role on a database nothing has claimed for an environment.
     */
    "deployment.not_stamped": Record<string, never>;
    /**
     * Another process holds this venue folder, usually the Waitron server. Refused at once, before
     * either database file is opened. The restart reset of in-flight AEAT submissions
     * (`apps/server/src/restart-reset.ts`) relies on one server process per folder. `database` is
     * the venue DIRECTORY, as in `provisioning.database_unmigrated`: operator configuration, never a
     * secret.
     */
    "provisioning.database_in_use": { database: string };
  }
}
