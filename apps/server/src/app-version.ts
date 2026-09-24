/** The version this build reports for itself: the image's build id, then the package version. */
export function applicationVersion(env: NodeJS.ProcessEnv): string {
  return env.WAITRON_BUILD_ID ?? env.npm_package_version ?? "development";
}
