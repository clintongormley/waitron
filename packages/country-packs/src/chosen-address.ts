import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  type AdministrativeArea,
  type CountryPack,
  type ResolvedAddress,
} from "@waitron/country";

/** The area an address chosen from the search lies in: the one its area code names, else the one
 *  its postcode names. */
export function areaOfChosenAddress(
  pack: CountryPack,
  address: ResolvedAddress,
): AdministrativeArea | undefined {
  const postal = pack.postalCode?.validate(address.postalCode);
  return (
    (address.administrativeAreaCode === undefined
      ? undefined
      : findAdministrativeArea(pack, address.administrativeAreaCode)) ??
    (postal?.valid === true
      ? findAdministrativeAreaByPostalCode(pack, postal.normalized)
      : undefined)
  );
}
