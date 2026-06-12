import { normalizeUserProfile, type UserProfile } from "@/lib/profile";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type { UserProfile } from "@/lib/profile";

export type BirdFacing = "left" | "right";
export type BirdSex = "male" | "female";

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
  /** 청둥오리·원앙 등 암수 구분 종 */
  sex?: BirdSex;
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
  /** 청둥오리·원앙: 암수 마릿수 (count = maleCount + femaleCount) */
  maleCount?: number;
  femaleCount?: number;
  latitude?: number;
  longitude?: number;
  createdAt: string;
};

export type DailyGardenArchive = {
  birds: PlacedBird[];
  records: BirdRecord[];
  savedAt: string;
};

/** 신규 조류 등록 → 전체 사용자 공용 목록 종 */
export type CustomListBird = {
  id: string;
  name: string;
  description: string;
  imageSrc: string;
  createdAt: string;
  /** 공용 목록 등록자 — 본인만 수정·삭제 */
  createdBy?: string;
};

export type UserGardenPayload = {
  birds: PlacedBird[];
  records: BirdRecord[];
  /** 한 번이라도 발견해 도감에 해금된 종 (기록 삭제 후에도 유지) */
  dexUnlockedSpecies?: string[];
  dexSeenSpecies?: string[];
  /** 신규 조류 등록으로 만든 목록 항목 */
  customListBirds?: CustomListBird[];
  profile?: UserProfile;
  /** KST YYYY-MM-DD — 오늘 라이브 정원이 속한 날 */
  currentGardenDate?: string;
  /** 날짜별 정원 스냅샷 */
  dailyArchives?: Record<string, DailyGardenArchive>;
};

const EMPTY_PAYLOAD: UserGardenPayload = { birds: [], records: [], dexUnlockedSpecies: [], dexSeenSpecies: [] };

export type GardenPayloadCounts = {
  liveBirds: number;
  liveRecords: number;
  archiveDays: number;
  archiveBirds: number;
  archiveRecords: number;
};

export function countGardenPayloadItems(payload: UserGardenPayload): GardenPayloadCounts {
  const archives = Object.values(payload.dailyArchives ?? {});
  return {
    liveBirds: payload.birds.length,
    liveRecords: payload.records.length,
    archiveDays: archives.length,
    archiveBirds: archives.reduce((sum, archive) => sum + archive.birds.length, 0),
    archiveRecords: archives.reduce((sum, archive) => sum + archive.records.length, 0),
  };
}

export function isEmptyGardenPayload(payload: UserGardenPayload): boolean {
  const counts = countGardenPayloadItems(payload);
  return (
    counts.liveBirds === 0 &&
    counts.liveRecords === 0 &&
    counts.archiveDays === 0 &&
    counts.archiveBirds === 0 &&
    counts.archiveRecords === 0
  );
}

/** 빈 스냅샷·오늘 정원 전체 삭제 등 사고성 저장인지 (의도적 개별 삭제는 허용) */
export function isRegressiveGardenSave(
  existing: UserGardenPayload,
  incoming: UserGardenPayload
): boolean {
  if (isEmptyGardenPayload(incoming) && !isEmptyGardenPayload(existing)) {
    return true;
  }

  const ex = countGardenPayloadItems(existing);
  const inc = countGardenPayloadItems(incoming);
  const hadLiveGarden = ex.liveBirds > 0 || ex.liveRecords > 0;
  const wipedLiveGarden = inc.liveBirds === 0 && inc.liveRecords === 0;

  return hadLiveGarden && wipedLiveGarden && inc.archiveDays >= ex.archiveDays;
}

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
          const sex: BirdSex | undefined =
            raw.sex === "female" ? "female" : raw.sex === "male" ? "male" : undefined;
          return {
            id: raw.id,
            xPercent: raw.xPercent,
            yPercent: raw.yPercent,
            size: raw.size,
            recordId: typeof raw.recordId === "string" ? raw.recordId : undefined,
            facing,
            inWater: raw.inWater === true,
            sex,
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
            maleCount:
              typeof rawRecord.maleCount === "number" && rawRecord.maleCount >= 0
                ? rawRecord.maleCount
                : undefined,
            femaleCount:
              typeof rawRecord.femaleCount === "number" && rawRecord.femaleCount >= 0
                ? rawRecord.femaleCount
                : undefined,
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

  const dexUnlockedSpecies = Array.isArray((obj as { dexUnlockedSpecies?: unknown }).dexUnlockedSpecies)
    ? (obj as { dexUnlockedSpecies: unknown[] }).dexUnlockedSpecies.filter(
        (name): name is string => typeof name === "string" && name.trim().length > 0
      )
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

  const customListBirds = Array.isArray((obj as { customListBirds?: unknown }).customListBirds)
    ? (obj as { customListBirds: unknown[] }).customListBirds
        .filter(
          (item): item is CustomListBird =>
            !!item &&
            typeof item === "object" &&
            typeof (item as CustomListBird).id === "string" &&
            typeof (item as CustomListBird).name === "string" &&
            typeof (item as CustomListBird).imageSrc === "string"
        )
        .map((item) => ({
          id: item.id,
          name: item.name.trim() || "이름 없는 조류",
          description: typeof item.description === "string" ? item.description : "",
          imageSrc: item.imageSrc,
          createdAt:
            typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        }))
    : [];

  return { birds, records, dexUnlockedSpecies, dexSeenSpecies, customListBirds, profile, currentGardenDate, dailyArchives };
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

/**
 * 저장 직전 병합 — 클라이언트 스냅샷(incoming)을 기준으로 덮어씁니다.
 * 예전 union 병합은 목록·도감 삭제가 새로고침 후 되살아나는 원인이었습니다.
 */
export function mergeGardenPayload(existing: UserGardenPayload, incoming: UserGardenPayload): UserGardenPayload {
  if (isRegressiveGardenSave(existing, incoming)) {
    return {
      birds: incoming.birds.length > 0 ? incoming.birds : existing.birds,
      records: incoming.records.length > 0 ? incoming.records : existing.records,
      customListBirds: incoming.customListBirds ?? existing.customListBirds ?? [],
      dexUnlockedSpecies: [
        ...new Set([...(existing.dexUnlockedSpecies ?? []), ...(incoming.dexUnlockedSpecies ?? [])]),
      ],
      dexSeenSpecies: [...new Set([...(existing.dexSeenSpecies ?? []), ...(incoming.dexSeenSpecies ?? [])])],
      profile: incoming.profile ?? existing.profile,
      currentGardenDate: incoming.currentGardenDate ?? existing.currentGardenDate ?? undefined,
      dailyArchives: {
        ...(existing.dailyArchives ?? {}),
        ...(incoming.dailyArchives ?? {}),
      },
    };
  }

  return {
    birds: incoming.birds,
    records: incoming.records,
    customListBirds: incoming.customListBirds ?? [],
    dexUnlockedSpecies: incoming.dexUnlockedSpecies ?? [],
    dexSeenSpecies: incoming.dexSeenSpecies ?? [],
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
    const hasExistingData = !isEmptyGardenPayload(existing);
    if (hasExistingData && isEmptyGardenPayload(payload)) {
      // 새로고침 직후 빈 스냅샷이 서버 기록을 지우는 사고 방지
      return;
    }
    if (hasExistingData) {
      toSave = mergeGardenPayload(existing, payload);
      if (isRegressiveGardenSave(existing, toSave)) {
        return;
      }
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
