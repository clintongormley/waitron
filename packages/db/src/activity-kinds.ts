/**
 * Data holds no person's name, email, telephone, tax number or guest health detail: A980's design erases
 * people by anonymising persons, while these rows cannot change. Readers resolve names now.
 * People appear as the actor, a person subject, or an id in a declared personFields entry (dv17).
 * The taxpayer's legal name is the sole exception (vb2): it is already kept in fiscal records
 * and does not name a persons row that A980 anonymises.
 *
 * Older rows must satisfy a kind's data shape: add an optional field or a new kind.
 * Ids inside data have no database key and may outlive their target; product logic never decides
 * from this log. State each kind's additional privacy rules beside its data declaration.
 */
export interface ActivityKindData {
  readonly "job_role.created": { readonly name: string };
  readonly "job_role.renamed": { readonly from: string; readonly to: string };
  readonly "job_role.deleted": { readonly name: string };
  readonly "job_role.hidden": { readonly name: string };
  readonly "job_role.member_added": { readonly staffRoleId: string; readonly name: string };
  readonly "job_role.member_removed": { readonly staffRoleId: string; readonly name: string };

  /** Clash identifiers only; the signed decision, not this history, holds the reason. */
  readonly "handover.return_clash_accepted": {
    readonly clashId: string;
    readonly sourceNodeId: string;
    readonly module: string;
  };

  /** Who saved which document and its new revision; never a document value. */
  readonly "settings.saved": { readonly revision: number };
  /** Who removed a never-joined standby from the membership chart, at which term. */
  readonly "membership.node_removed": { readonly contactUrl: string; readonly term: number };
  /** Who cleared a removed machine from the chart, freeing its place, at which term. */
  readonly "membership.node_cleared": { readonly term: number };
  /** Calendar dates and invoice counts only; never a customer or supplier named in the file. */
  readonly "accountant_export.downloaded": {
    readonly from: string;
    readonly to: string;
    readonly invoices: number;
    readonly purchases: number;
  };
  /** Who downloaded the file of deferred payments, for which business days, and its row
   * count; never a customer named in the file. */
  readonly "deferred_payment_export.downloaded": {
    readonly from: string;
    readonly to: string;
    readonly rows: number;
  };
}
export type ActivityKind = keyof ActivityKindData;
export interface ActivityKindRule {
  readonly subject: string;
}
export const ACTIVITY_KINDS = {
  "job_role.created": { subject: "job_role" },
  "job_role.renamed": { subject: "job_role" },
  "job_role.deleted": { subject: "job_role" },
  "job_role.hidden": { subject: "job_role" },
  "job_role.member_added": { subject: "person" },
  "job_role.member_removed": { subject: "person" },
  "handover.return_clash_accepted": { subject: "node" },
  "settings.saved": { subject: "settings" },
  "membership.node_removed": { subject: "node" },
  "membership.node_cleared": { subject: "node" },
  "deferred_payment_export.downloaded": { subject: "report" },
  "accountant_export.downloaded": { subject: "report" },
} as const satisfies Record<ActivityKind, ActivityKindRule>;
export type ActivitySubjectKind = (typeof ACTIVITY_KINDS)[ActivityKind]["subject"];
