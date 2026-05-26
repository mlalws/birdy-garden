import { normalizePlacedBirds } from "@/lib/garden-birds";
import { migrateBirdRecord, migrateBirdRecords } from "@/lib/garden-records";
import type { BirdRecord, DailyGardenArchive, PlacedBird, UserGardenPayload } from "@/lib/supabase/garden";

export function normalizeDaySnapshot(snapshot: DailyGardenArchive): DailyGardenArchive {
  const records = migrateBirdRecords(snapshot.records);
  return {
    ...snapshot,
    records,
    birds: normalizePlacedBirds(snapshot.birds, records),
  };
}

const KST_TIMEZONE = "Asia/Seoul";

/** KST 기준 YYYY-MM-DD */
export function getKstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST_TIMEZONE }).format(date);
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  return { year, month, day };
}

/** 캘린더 과거 날짜에 조류 등록 시 createdAt — KST 정오 */
export function createdAtForDateKey(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T12:00:00+09:00`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${month}월 ${year}`;
}

export function shiftCalendarMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** 월요일 시작 달력 그리드 (빈 칸은 null) */
export function buildCalendarCells(year: number, month: number): (number | null)[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const mondayStart = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: mondayStart }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(day);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

export function toDateKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export type DayBirdStats = {
  total: number;
  bySpecies: { name: string; count: number }[];
};

/** 앱 사용 누적 — 오늘 기록 + 과거 일별 아카이브 전부 합산 */
export function countLifetimeSpeciesSightings(
  liveRecords: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined,
  speciesName: string
): number {
  const key = speciesName.trim();
  if (!key) {
    return 0;
  }

  const archiveRecords = archives
    ? Object.values(archives).flatMap((archive) => archive.records)
    : [];

  const allRecords = [...liveRecords, ...archiveRecords];
  return allRecords.reduce((sum, record) => {
    if (getRecordSpeciesLabel(record) === key) {
      return sum + Math.max(1, record.count);
    }
    return sum;
  }, 0);
}

/** 캘린더·도감에 쓸 목록상 종 이름 */
export function getRecordSpeciesLabel(record: BirdRecord): string {
  const migrated = migrateBirdRecord(record);
  if (migrated.speciesName?.trim()) {
    return migrated.speciesName.trim();
  }
  return migrated.name.trim() || "이름 없는 조류";
}

export function computeDayBirdStats(archive: DailyGardenArchive | undefined): DayBirdStats {
  if (!archive || archive.birds.length === 0) {
    return { total: 0, bySpecies: [] };
  }

  const recordById = new Map(archive.records.map((record) => [record.id, record]));
  const speciesCounts = new Map<string, number>();

  for (const bird of archive.birds) {
    const record = bird.recordId ? recordById.get(bird.recordId) : undefined;
    const name = record ? getRecordSpeciesLabel(record) : "이름 없는 조류";
    speciesCounts.set(name, (speciesCounts.get(name) ?? 0) + 1);
  }

  const bySpecies = [...speciesCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));

  return { total: archive.birds.length, bySpecies };
}

function normalizeArchives(raw: unknown): Record<string, DailyGardenArchive> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const result: Record<string, DailyGardenArchive> = {};
  for (const [dateKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !value || typeof value !== "object") {
      continue;
    }
    const entry = value as { birds?: unknown; records?: unknown; savedAt?: unknown };
    const birds = Array.isArray(entry.birds)
      ? (entry.birds as PlacedBird[]).filter((bird) => typeof bird?.id === "string")
      : [];
    const records = Array.isArray(entry.records)
      ? (entry.records as BirdRecord[]).filter((record) => typeof record?.id === "string")
      : [];
    if (birds.length === 0 && records.length === 0) {
      continue;
    }
    result[dateKey] = {
      birds,
      records,
      savedAt: typeof entry.savedAt === "string" ? entry.savedAt : new Date().toISOString(),
    };
  }
  return result;
}

/** createdAt 기준으로 과거 날짜 기록을 dailyArchives로 되돌려 넣기 (저장 누락 복구) */
export function repairGardenPayloadArchives(payload: UserGardenPayload): UserGardenPayload {
  const today = getKstDateKey();
  const archives: Record<string, DailyGardenArchive> = { ...(payload.dailyArchives ?? {}) };
  const recordById = new Map<string, BirdRecord>();

  const registerRecord = (record: BirdRecord) => {
    const migrated = migrateBirdRecord(record);
    recordById.set(migrated.id, migrated);
    return migrated;
  };

  for (const record of payload.records) {
    registerRecord(record);
  }
  for (const archive of Object.values(archives)) {
    for (const record of archive.records) {
      registerRecord(record);
    }
  }

  const todayRecords: BirdRecord[] = [];
  const todayBirds: PlacedBird[] = [];

  for (const record of recordById.values()) {
    const dateKey = record.createdAt ? getKstDateKey(new Date(record.createdAt)) : today;
    if (dateKey === today) {
      todayRecords.push(record);
      continue;
    }
    if (!archives[dateKey]) {
      archives[dateKey] = { birds: [], records: [], savedAt: new Date().toISOString() };
    }
    if (!archives[dateKey].records.some((item) => item.id === record.id)) {
      archives[dateKey].records.push(record);
    }
  }

  const allBirds = [...payload.birds, ...Object.values(archives).flatMap((archive) => archive.birds)];
  const seenBirdIds = new Set<string>();

  for (const bird of allBirds) {
    if (seenBirdIds.has(bird.id)) {
      continue;
    }
    seenBirdIds.add(bird.id);

    const record = bird.recordId ? recordById.get(bird.recordId) : undefined;
    const dateKey = record?.createdAt ? getKstDateKey(new Date(record.createdAt)) : today;

    if (dateKey === today) {
      todayBirds.push(bird);
      continue;
    }

    if (!archives[dateKey]) {
      archives[dateKey] = { birds: [], records: [], savedAt: new Date().toISOString() };
    }
    if (!archives[dateKey].birds.some((item) => item.id === bird.id)) {
      archives[dateKey].birds.push(bird);
    }
  }

  return {
    ...payload,
    birds: todayBirds,
    records: todayRecords,
    dailyArchives: archives,
    currentGardenDate: today,
  };
}

/** 자정이 지나면 전날 정원을 아카이브하고 오늘 정원을 비운다 */
export function applyGardenDayRollover(payload: UserGardenPayload): {
  payload: UserGardenPayload;
  didRollover: boolean;
} {
  const today = getKstDateKey();
  const lastDate = payload.currentGardenDate ?? today;

  if (lastDate >= today) {
    return {
      payload: { ...payload, currentGardenDate: today },
      didRollover: false,
    };
  }

  const archives = normalizeArchives(payload.dailyArchives);
  const hasLiveGarden = payload.birds.length > 0 || payload.records.length > 0;

  if (hasLiveGarden) {
    archives[lastDate] = {
      birds: payload.birds,
      records: payload.records,
      savedAt: new Date().toISOString(),
    };
  }

  return {
    payload: {
      ...payload,
      birds: [],
      records: [],
      dailyArchives: archives,
      currentGardenDate: today,
    },
    didRollover: true,
  };
}

export function pickPayloadMeta(payload: UserGardenPayload): Pick<UserGardenPayload, "currentGardenDate" | "dailyArchives"> {
  return {
    currentGardenDate: payload.currentGardenDate ?? getKstDateKey(),
    dailyArchives: normalizeArchives(payload.dailyArchives),
  };
}

export function resolveDaySnapshot(
  dateKey: string,
  archives: Record<string, DailyGardenArchive>,
  live: { birds: PlacedBird[]; records: BirdRecord[] }
): DailyGardenArchive | null {
  const today = getKstDateKey();
  if (dateKey > today) {
    return null;
  }
  if (dateKey === today) {
    return normalizeDaySnapshot({
      birds: live.birds,
      records: live.records,
      savedAt: new Date().toISOString(),
    });
  }
  const archived = archives[dateKey];
  return archived ? normalizeDaySnapshot(archived) : null;
}

export function dateKeyHasGarden(
  dateKey: string,
  archives: Record<string, DailyGardenArchive>,
  live: { birds: PlacedBird[]; records: BirdRecord[] }
): boolean {
  const snapshot = resolveDaySnapshot(dateKey, archives, live);
  return !!snapshot && snapshot.birds.length > 0;
}
