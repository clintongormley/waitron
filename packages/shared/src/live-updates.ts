export interface ResourceIdentity {
  type: string;
  id?: string;
}

export interface ResourceChange {
  resources: ResourceIdentity[];
}

/** The owning module declares the identities a table mutation affects. */
export interface ChangeSource {
  table: string;
  type: string;
  related?: readonly { type: string; column: string }[];
}
