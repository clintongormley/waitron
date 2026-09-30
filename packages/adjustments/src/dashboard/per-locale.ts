/** One per locale, built on first use: a table formats every row on every render. */
export function perLocale<T>(make: (locale: string) => T): (locale: string) => T {
  const made = new Map<string, T>();
  return (locale) => {
    let value = made.get(locale);
    if (value === undefined) {
      value = make(locale);
      made.set(locale, value);
    }
    return value;
  };
}
