import * as Updates from 'expo-updates';

/** Download a compatible production JS patch without interrupting the user.
 * The downloaded update is deliberately not reloaded here: expo-updates applies
 * it on the next launch, preserving the current session and native runtime.
 */
export async function downloadSecurityPatchInBackground(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline/mobile startup must remain usable; retry on the next launch.
  }
}
