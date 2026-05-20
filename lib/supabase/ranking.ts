import { getKstWeekKey } from "@/lib/garden-weekly";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type WeeklyRankingRow = {
  user_id: string;
  nickname: string;
  discovery_count: number;
  updated_at: string;
};

export type WeeklyDiscoveryResult = {
  weekKey: string;
  discoveryCount: number;
  rank: number;
  previousRank: number | null;
};

const sortRankingRows = (rows: WeeklyRankingRow[]): WeeklyRankingRow[] =>
  [...rows].sort((a, b) => {
    if (b.discovery_count !== a.discovery_count) {
      return b.discovery_count - a.discovery_count;
    }
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  });

export const rankFromSortedRows = (rows: WeeklyRankingRow[], userId: string): number | null => {
  const index = rows.findIndex((row) => row.user_id === userId);
  return index >= 0 ? index + 1 : null;
};

export async function fetchWeeklyLeaderboard(
  weekKey = getKstWeekKey(),
  limit = 30
): Promise<WeeklyRankingRow[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("weekly_rankings")
    .select("user_id, nickname, discovery_count, updated_at")
    .eq("week_key", weekKey)
    .order("discovery_count", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as WeeklyRankingRow[];
}

export async function recordWeeklyDiscovery(
  userId: string,
  nickname: string,
  amount: number
): Promise<WeeklyDiscoveryResult | null> {
  if (!isSupabaseConfigured() || amount < 1) {
    return null;
  }

  const weekKey = getKstWeekKey();
  const supabase = getSupabaseBrowserClient();
  const safeNickname = nickname.trim() || "탐험가";
  const addCount = Math.max(1, Math.floor(amount));

  const { data: beforeRows, error: beforeError } = await supabase
    .from("weekly_rankings")
    .select("user_id, nickname, discovery_count, updated_at")
    .eq("week_key", weekKey);

  if (beforeError) {
    throw beforeError;
  }

  const sortedBefore = sortRankingRows((beforeRows ?? []) as WeeklyRankingRow[]);
  const previousRank = rankFromSortedRows(sortedBefore, userId);
  const existing = sortedBefore.find((row) => row.user_id === userId);
  const nextCount = (existing?.discovery_count ?? 0) + addCount;

  const { error: upsertError } = await supabase.from("weekly_rankings").upsert(
    {
      user_id: userId,
      week_key: weekKey,
      discovery_count: nextCount,
      nickname: safeNickname,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,week_key" }
  );

  if (upsertError) {
    throw upsertError;
  }

  const { data: afterRows, error: afterError } = await supabase
    .from("weekly_rankings")
    .select("user_id, nickname, discovery_count, updated_at")
    .eq("week_key", weekKey);

  if (afterError) {
    throw afterError;
  }

  const sortedAfter = sortRankingRows((afterRows ?? []) as WeeklyRankingRow[]);
  const rank = rankFromSortedRows(sortedAfter, userId);

  return {
    weekKey,
    discoveryCount: nextCount,
    rank: rank ?? 1,
    previousRank,
  };
}

export function weeklyRankBannerMessage(result: WeeklyDiscoveryResult): string | null {
  if (result.rank !== 1) {
    return null;
  }
  if (result.previousRank === null || result.previousRank > 1) {
    return "이번 주의 랭킹 1위 등극!🥇";
  }
  if (result.previousRank === 1) {
    return "이번 주 랭킹 1위 갱신!🥇";
  }
  return null;
}
