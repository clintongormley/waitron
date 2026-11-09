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
  /** Suffixes the type with this NOT NULL column’s value and omits the id. */
  typeSuffixColumn?: string;
}

export const SETTINGS_CHANGE_TYPE = "settings";
export function settingsChangeType(module: string): string {
  return `${SETTINGS_CHANGE_TYPE}.${module}`;
}
