export async function registerOfflineWorker({
  built = import.meta.env.PROD,
  secure = isSecureContext,
  nav = navigator,
}: {
  built?: boolean;
  secure?: boolean;
  nav?: { serviceWorker?: Pick<ServiceWorkerContainer, "register"> };
} = {}): Promise<void> {
  if (!built || !secure) return;
  try {
    await nav.serviceWorker?.register("/till/offline-worker.js", { scope: "/till/" });
  } catch {
    // The till still opens in browsers that refuse worker registration.
  }
}
