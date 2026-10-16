/** The fiscal seat's default description, or none when it is missing or blank, so the sale path,
 * the Departments check and the Edit receipt read all agree on whether one is offered. */
export function offeredOperationDescriptionDefault(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}
