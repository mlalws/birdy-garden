import { getKstWeekKey, getKstWeekKeyFromDateKey } from "@/lib/garden-weekly";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BirdRecord, DailyGardenArchive } from "@/lib/supabase/garden";

export type WeeklyRankingRow = {
  user_id: string;
  nickname: string;
  discovery_count: number;
  updated_at: string;
  avatar_url?: string | null;
};

export type WeeklyDiscoveryResult = {
  weekKey: string;
  discoveryCount: number;
  rank: number;
  previousRank: number | null;
};

const RANKING_SELECT_BASE = "user_id, nickname, discovery_count, updated_at";
const RANKING_SELECT_WITH_AVATAR = `${RANKING_SELECT_BASE}, avatar_url`;

/** Supabase에 avatar_url 컬럼이 없으면 false — 랭킹은 계속 동작 */
let rankingAvatarColumnSupported: boolean | null = null;

function isMissingAvatarColumnError(error: unknown): boolean {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: string }).message)
      : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("avatar_url") && (lower.includes("does not exist") || lower.includes("column"));
}

function rankingSelectColumns(): string {
  return rankingAvatarColumnSupported === false ? RANKING_SELECT_BASE : RANKING_SELECT_WITH_AVATAR;
}

function markAvatarColumnUnsupported(error: unknown): boolean {
  if (isMissingAvatarColumnError(error)) {
    rankingAvatarColumnSupported = false;
    return true;
  }
  return false;
}

function supportsRankingAvatar(): boolean {
  return rankingAvatarColumnSupported !== false;
}

function buildRankingUpsertPayload(
  userId: string,
  weekKey: string,
  discoveryCount: number,
  nickname: string,
  avatarUrl?: string | null
): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    user_id: userId,
    week_key: weekKey,
    discovery_count: discoveryCount,
    nickname,
    updated_at: new Date().toISOString(),
  };
  if (!supportsRankingAvatar()) {
    return payload;
  }
  const safeAvatar =
    typeof avatarUrl === "string" && avatarUrl.startsWith("data:image/") ? avatarUrl : null;
  if (safeAvatar) {
    payload.avatar_url = safeAvatar;
  }
  return payload;
}

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

/** 이번 주 정원 기록(오늘 + 일별 아카이브)에서 발견 마리 수 합산 */
export function countWeekDiscoveriesFromGarden(
  liveRecords: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined,
  weekKey = getKstWeekKey()
): number {
  const seenRecordIds = new Set<string>();
  let sum = 0;

  const addRecord = (record: BirdRecord) => {
    if (seenRecordIds.has(record.id)) {
      return;
    }
    seenRecordIds.add(record.id);
    sum += Math.max(1, record.count);
  };

  for (const record of liveRecords) {
    if (!record.createdAt) {
      continue;
    }
    if (getKstWeekKey(new Date(record.createdAt)) !== weekKey) {
      continue;
    }
    addRecord(record);
  }

  if (archives) {
    for (const [dateKey, archive] of Object.entries(archives)) {
      if (getKstWeekKeyFromDateKey(dateKey) !== weekKey) {
        continue;
      }
      for (const record of archive.records) {
        addRecord(record);
      }
    }
  }

  return sum;
}

async function queryWeeklyRankingRows(weekKey: string, limit: number): Promise<WeeklyRankingRow[]> {
  const supabase = getSupabaseBrowserClient();
  let result = await supabase
    .from("weekly_rankings")
    .select(rankingSelectColumns())
    .eq("week_key", weekKey)
    .order("discovery_count", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (result.error && markAvatarColumnUnsupported(result.error)) {
    result = await supabase
      .from("weekly_rankings")
      .select(rankingSelectColumns())
      .eq("week_key", weekKey)
      .order("discovery_count", { ascending: false })
      .order("updated_at", { ascending: true })
      .limit(limit);
  }

  if (result.error) {
    throw result.error;
  }

  if (rankingAvatarColumnSupported === null && !result.error) {
    rankingAvatarColumnSupported = true;
  }

  return (result.data ?? []) as WeeklyRankingRow[];
}

/** 랭킹 테이블 생성 전·저장 실패분 — 정원 데이터 기준으로 이번 주 점수 보정 */
export async function syncWeeklyRankingFromGarden(
  userId: string,
  nickname: string,
  liveRecords: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined,
  avatarUrl?: string | null
): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  const weekKey = getKstWeekKey();
  const fromGarden = countWeekDiscoveriesFromGarden(liveRecords, archives, weekKey);

  const supabase = getSupabaseBrowserClient();
  const safeNickname = nickname.trim() || "탐험가";

  const safeAvatar =
    typeof avatarUrl === "string" && avatarUrl.startsWith("data:image/") ? avatarUrl : null;

  let existingResult = await supabase
    .from("weekly_rankings")
    .select(supportsRankingAvatar() ? "discovery_count, avatar_url" : "discovery_count")
    .eq("user_id", userId)
    .eq("week_key", weekKey)
    .maybeSingle();

  if (existingResult.error && markAvatarColumnUnsupported(existingResult.error)) {
    existingResult = await supabase
      .from("weekly_rankings")
      .select("discovery_count")
      .eq("user_id", userId)
      .eq("week_key", weekKey)
      .maybeSingle();
  }

  if (existingResult.error) {
    throw existingResult.error;
  }

  const existing = existingResult.data as
    | { discovery_count: number; avatar_url?: string | null }
    | null
    | undefined;

  if (fromGarden <= 0) {
    if (!existing) {
      return;
    }
    const { error: deleteError } = await supabase
      .from("weekly_rankings")
      .delete()
      .eq("user_id", userId)
      .eq("week_key", weekKey);
    if (deleteError) {
      throw deleteError;
    }
    return;
  }

  const existingAvatar =
    supportsRankingAvatar() &&
    typeof existing?.avatar_url === "string" &&
    existing.avatar_url.startsWith("data:image/")
      ? existing.avatar_url
      : null;

  if (fromGarden === existing?.discovery_count && (!supportsRankingAvatar() || safeAvatar === existingAvatar)) {
    return;
  }

  let upsertError = (
    await supabase
      .from("weekly_rankings")
      .upsert(buildRankingUpsertPayload(userId, weekKey, fromGarden, safeNickname, avatarUrl), {
        onConflict: "user_id,week_key",
      })
  ).error;

  if (upsertError && markAvatarColumnUnsupported(upsertError)) {
    upsertError = (
      await supabase
        .from("weekly_rankings")
        .upsert(buildRankingUpsertPayload(userId, weekKey, fromGarden, safeNickname), {
          onConflict: "user_id,week_key",
        })
    ).error;
  }

  if (upsertError) {
    throw upsertError;
  }
}

export async function fetchWeeklyLeaderboard(
  weekKey = getKstWeekKey(),
  limit = 30
): Promise<WeeklyRankingRow[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  return queryWeeklyRankingRows(weekKey, limit);
}

export async function recordWeeklyDiscovery(
  userId: string,
  nickname: string,
  amount: number,
  avatarUrl?: string | null
): Promise<WeeklyDiscoveryResult | null> {
  if (!isSupabaseConfigured() || amount < 1) {
    return null;
  }

  const weekKey = getKstWeekKey();
  const supabase = getSupabaseBrowserClient();
  const safeNickname = nickname.trim() || "탐험가";
  const addCount = Math.max(1, Math.floor(amount));

  const sortedBefore = sortRankingRows(await queryWeeklyRankingRows(weekKey, 200));
  const previousRank = rankFromSortedRows(sortedBefore, userId);
  const existing = sortedBefore.find((row) => row.user_id === userId);
  const nextCount = (existing?.discovery_count ?? 0) + addCount;

  let upsertError = (
    await supabase
      .from("weekly_rankings")
      .upsert(buildRankingUpsertPayload(userId, weekKey, nextCount, safeNickname, avatarUrl), {
        onConflict: "user_id,week_key",
      })
  ).error;

  if (upsertError && markAvatarColumnUnsupported(upsertError)) {
    upsertError = (
      await supabase
        .from("weekly_rankings")
        .upsert(buildRankingUpsertPayload(userId, weekKey, nextCount, safeNickname), {
          onConflict: "user_id,week_key",
        })
    ).error;
  }

  if (upsertError) {
    throw upsertError;
  }

  const sortedAfter = sortRankingRows(await queryWeeklyRankingRows(weekKey, 200));
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
