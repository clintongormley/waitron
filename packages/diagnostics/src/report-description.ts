export function reportDescriptionValid(value: string): boolean {
  const characters = [...value];
  return (
    characters.length <= 2000 &&
    characters.every((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
  );
}
