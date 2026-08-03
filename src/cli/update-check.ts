/** Update checking is intentionally disabled for the private secured fork. */

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export async function checkForUpdateNow(currentVersion: string): Promise<UpdateInfo | null> {
  void currentVersion;
  return null;
}

export async function checkForUpdateSWR(currentVersion: string): Promise<UpdateInfo | null> {
  void currentVersion;
  return null;
}

export function printUpdateNotification(info: UpdateInfo): void {
  void info;
}
