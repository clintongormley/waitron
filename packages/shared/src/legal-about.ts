/** What `/legal/about` answers: the release this build carries, if any, and the build's own name. */
export interface LegalAbout {
  release: { version: string; releasedOn: string } | null;
  build: string;
}
