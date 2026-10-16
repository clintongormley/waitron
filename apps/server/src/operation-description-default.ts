/** The fiscal seat's default description, or none when it is missing or blank. Boot hands the
 * result to the sale path, the Departments check and the Edit receipt read. */
export function offeredOperationDescriptionDefault(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}
