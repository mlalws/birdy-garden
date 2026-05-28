import { getKstWeekKey } from "@/lib/garden-weekly";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export const NORTH_STAR_EVENT = {
  BIRD_RECORD_COMPLETED: "bird_record_completed",
  GARDEN_INTERACTION: "garden_interaction",
} as const;

export type NorthStarEventName = (typeof NORTH_STAR_EVENT)[keyof typeof NORTH_STAR_EVENT];

const WEEKLY_EVENT_SESSION_KEY = "birdy-garden:weekly-event:v1";

function buildWeeklyDedupKey(userId: string, eventName: NorthStarEventName, weekKey: string): string {
  return `${WEEKLY_EVENT_SESSION_KEY}:${userId}:${eventName}:${weekKey}`;
}

export async function logNorthStarEventOncePerWeek(
  userId: string,
  eventName: NorthStarEventName
): Promise<void> {
  if (!userId || !isSupabaseConfigured() || typeof window === "undefined") {
    return;
  }
  const weekKey = getKstWeekKey();
  const dedupKey = buildWeeklyDedupKey(userId, eventName, weekKey);

  try {
    if (window.sessionStorage.getItem(dedupKey) === "1") {
      return;
    }
  } catch {
    // sessionStorage 접근 실패 시에도 로그는 시도
  }

  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("user_event_logs").insert({
    user_id: userId,
    event_name: eventName,
    week_key: weekKey,
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }

  try {
    window.sessionStorage.setItem(dedupKey, "1");
  } catch {
    // ignore
  }
}
