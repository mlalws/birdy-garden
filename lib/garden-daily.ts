import { migrateBirdRecord } from "@/lib/garden-records";
import type { BirdRecord, DailyGardenArchive, PlacedBird, UserGardenPayload } from "@/lib/supabase/garden";

const KST_TIMEZONE = "Asia/Seoul";

/** KST 기준 YYYY-MM-DD */
export function getKstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST_TIMEZONE }).format(date);
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  return { year, month, day };
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
    return { birds: live.birds, records: live.records, savedAt: new Date().toISOString() };
  }
  return archives[dateKey] ?? null;
}

export function dateKeyHasGarden(
  dateKey: string,
  archives: Record<string, DailyGardenArchive>,
  live: { birds: PlacedBird[]; records: BirdRecord[] }
): boolean {
  const snapshot = resolveDaySnapshot(dateKey, archives, live);
  return !!snapshot && snapshot.birds.length > 0;
}
