import { normalizeUserProfile, type UserProfile } from "@/lib/profile";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type { UserProfile } from "@/lib/profile";

export type BirdFacing = "left" | "right";

export type PlacedBird = {
  id: string;
  xPercent: number;
  yPercent: number;
  size: number;
  /** 등록 기록과 연결 (탭 시 사진·삭제) */
  recordId?: string;
  facing?: BirdFacing;
  /** 호수 안이면 다리 영역 클리핑 */
  inWater?: boolean;
};

export type BirdRecord = {
  id: string;
  /** 사용자가 붙인 이름 */
  name: string;
  /** 목록상 종 이름 (캘린더·도감용) */
  speciesName?: string;
  /** 목록에서 고른 조류 id */
  listBirdId?: string;
  feature: string;
  photoUrl: string | null;
  count: number;
  latitude?: number;
  longitude?: number;
  createdAt: string;
};

export type DailyGardenArchive = {
  birds: PlacedBird[];
  records: BirdRecord[];
  savedAt: string;
};

export type UserGardenPayload = {
  birds: PlacedBird[];
  records: BirdRecord[];
  dexSeenSpecies?: string[];
  profile?: UserProfile;
  /** KST YYYY-MM-DD — 오늘 라이브 정원이 속한 날 */
  currentGardenDate?: string;
  /** 날짜별 정원 스냅샷 */
  dailyArchives?: Record<string, DailyGardenArchive>;
};

const EMPTY_PAYLOAD: UserGardenPayload = { birds: [], records: [], dexSeenSpecies: [] };

function normalizePayload(raw: unknown): UserGardenPayload {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_PAYLOAD };
  }
  const obj = raw as { birds?: unknown; records?: unknown };
  const birds = Array.isArray(obj.birds)
    ? obj.birds
        .filter(
          (item): item is PlacedBird =>
            !!item &&
            typeof item === "object" &&
            typeof (item as PlacedBird).id === "string" &&
            typeof (item as PlacedBird).xPercent === "number" &&
            typeof (item as PlacedBird).yPercent === "number" &&
            typeof (item as PlacedBird).size === "number"
        )
        .map((item) => {
          const raw = item as PlacedBird;
          const facing: BirdFacing = raw.facing === "left" ? "left" : "right";
          return {
            id: raw.id,
            xPercent: raw.xPercent,
            yPercent: raw.yPercent,
            size: raw.size,
            recordId: typeof raw.recordId === "string" ? raw.recordId : undefined,
            facing,
            inWater: raw.inWater !== false,
          };
        })
    : [];

  const records = Array.isArray(obj.records)
    ? obj.records
        .filter(
          (item): item is BirdRecord =>
            !!item &&
            typeof item === "object" &&
            typeof (item as BirdRecord).id === "string" &&
            typeof (item as BirdRecord).name === "string"
        )
        .map((item) => {
          const rawRecord = item as BirdRecord;
          return {
            id: rawRecord.id,
            name: rawRecord.name,
            speciesName:
              typeof rawRecord.speciesName === "string" && rawRecord.speciesName.trim()
                ? rawRecord.speciesName.trim()
                : undefined,
            listBirdId: typeof rawRecord.listBirdId === "string" ? rawRecord.listBirdId : undefined,
            feature: typeof rawRecord.feature === "string" ? rawRecord.feature : "",
            photoUrl: typeof rawRecord.photoUrl === "string" ? rawRecord.photoUrl : null,
            count: typeof rawRecord.count === "number" ? rawRecord.count : 1,
            latitude:
              typeof rawRecord.latitude === "number" && Number.isFinite(rawRecord.latitude)
                ? rawRecord.latitude
                : undefined,
            longitude:
              typeof rawRecord.longitude === "number" && Number.isFinite(rawRecord.longitude)
                ? rawRecord.longitude
                : undefined,
            createdAt:
              typeof rawRecord.createdAt === "string" ? rawRecord.createdAt : new Date().toISOString(),
          };
        })
    : [];

  const dexSeenSpecies = Array.isArray((obj as { dexSeenSpecies?: unknown }).dexSeenSpecies)
    ? (obj as { dexSeenSpecies: unknown[] }).dexSeenSpecies.filter(
        (name): name is string => typeof name === "string" && name.trim().length > 0
      )
    : [];

  const profile = normalizeUserProfile((obj as { profile?: unknown }).profile) ?? undefined;

  const currentGardenDate =
    typeof (obj as { currentGardenDate?: unknown }).currentGardenDate === "string"
      ? (obj as { currentGardenDate: string }).currentGardenDate
      : undefined;

  let dailyArchives: Record<string, DailyGardenArchive> | undefined;
  const rawArchives = (obj as { dailyArchives?: unknown }).dailyArchives;
  if (rawArchives && typeof rawArchives === "object") {
    dailyArchives = {};
    for (const [dateKey, value] of Object.entries(rawArchives as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !value || typeof value !== "object") {
        continue;
      }
      const entry = value as { birds?: unknown; records?: unknown; savedAt?: unknown };
      const archivedBirds = Array.isArray(entry.birds) ? (entry.birds as PlacedBird[]) : [];
      const archivedRecords = Array.isArray(entry.records) ? (entry.records as BirdRecord[]) : [];
      if (archivedBirds.length === 0 && archivedRecords.length === 0) {
        continue;
      }
      dailyArchives[dateKey] = {
        birds: archivedBirds.filter((bird) => typeof bird.id === "string"),
        records: archivedRecords.filter((record) => typeof record.id === "string" && typeof record.name === "string"),
        savedAt: typeof entry.savedAt === "string" ? entry.savedAt : new Date().toISOString(),
      };
    }
  }

  return { birds, records, dexSeenSpecies, profile, currentGardenDate, dailyArchives };
}

export async function loadUserGarden(userId: string): Promise<UserGardenPayload> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("user_gardens").select("payload").eq("user_id", userId).maybeSingle();

  if (error) {
    throw error;
  }
  if (!data?.payload) {
    return { ...EMPTY_PAYLOAD };
  }
  return normalizePayload(data.payload);
}

/** 부분 저장 시 dailyArchives 등이 사라지지 않도록 기존 payload와 합칩니다 */
export function mergeGardenPayload(existing: UserGardenPayload, incoming: UserGardenPayload): UserGardenPayload {
  return {
    birds: incoming.birds,
    records: incoming.records,
    dexSeenSpecies:
      incoming.dexSeenSpecies && incoming.dexSeenSpecies.length > 0
        ? incoming.dexSeenSpecies
        : (existing.dexSeenSpecies ?? []),
    profile: incoming.profile ?? existing.profile,
    currentGardenDate: incoming.currentGardenDate ?? existing.currentGardenDate ?? undefined,
    dailyArchives: {
      ...(existing.dailyArchives ?? {}),
      ...(incoming.dailyArchives ?? {}),
    },
  };
}

export async function saveUserGarden(userId: string, payload: UserGardenPayload): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  let toSave = payload;
  try {
    const existing = await loadUserGarden(userId);
    const hasExistingData =
      existing.birds.length > 0 ||
      existing.records.length > 0 ||
      Object.keys(existing.dailyArchives ?? {}).length > 0;
    if (hasExistingData) {
      toSave = mergeGardenPayload(existing, payload);
    }
  } catch {
    // 신규 사용자 등 — incoming 그대로 저장
  }

  const { error } = await supabase.from("user_gardens").upsert(
    {
      user_id: userId,
      payload: toSave,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw error;
  }
}
