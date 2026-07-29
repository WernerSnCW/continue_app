/**
 * Reminder that the play time tracker is still running.
 *
 * The tracker keeps counting when the app is backgrounded — that's the point,
 * since you're meant to be playing the game rather than staring at this. But a
 * clock left running overnight would quietly wreck the deaths-per-hour figure,
 * so if the app has been out of sight for a while we nudge.
 *
 * Everything here is best-effort: notifications are unavailable on the web,
 * and the user may decline the permission. Nothing in the app depends on it.
 */
import { LocalNotifications } from '@capacitor/local-notifications';

const NOTIFICATION_ID = 4711;

/** Minutes of the app being backgrounded before the reminder fires. */
export const REMINDER_AFTER_MINUTES = 25;

let permissionAsked = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    // Only prompt once per session; a decline shouldn't nag on every start.
    if (permissionAsked || current.display === 'denied') return false;
    permissionAsked = true;
    const asked = await LocalNotifications.requestPermissions();
    return asked.display === 'granted';
  } catch {
    return false; // web, or plugin unavailable
  }
}

/** Schedules the reminder. Safe to call repeatedly — it replaces any pending one. */
export async function scheduleTrackerReminder(gameName: string): Promise<void> {
  try {
    if (!(await ensureNotificationPermission())) return;
    await cancelTrackerReminder();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIFICATION_ID,
          title: 'Play time tracker still running',
          body: `Still counting your time on ${gameName}. Pause it if you've stopped playing.`,
          schedule: { at: new Date(Date.now() + REMINDER_AFTER_MINUTES * 60_000) },
          smallIcon: 'ic_launcher',
        },
      ],
    });
  } catch {
    // Non-fatal — the tracker itself is unaffected.
  }
}

export async function cancelTrackerReminder(): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
  } catch {
    // Nothing pending, or not supported here.
  }
}
