import type { BirdRecord, DailyGardenArchive } from "@/lib/supabase/garden";

export type MapCoord = { lat: number; lng: number };

const STORAGE_KEY = "birdy-garden:record-coords:v1";

function readStore(): Record<string, MapCoord> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, MapCoord>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, MapCoord>) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota
  }
}

export function saveRecordMapCoord(recordId: string, coord: MapCoord) {
  const store = readStore();
  store[recordId] = coord;
  writeStore(store);
}

export function getStoredRecordMapCoord(recordId: string): MapCoord | null {
  const stored = readStore()[recordId];
  if (!stored || !Number.isFinite(stored.lat) || !Number.isFinite(stored.lng)) {
    return null;
  }
  return stored;
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % 9973;
  }
  return hash;
}

/** 좌표 없는 기록은 현위치 주변에 임시 표시(탭 후 위치 수정 유도) */
export function jitterAroundCenter(center: MapCoord, seed: string): MapCoord {
  const hash = hashSeed(seed);
  const dx = ((hash % 7) - 3) * 0.00042;
  const dy = (((hash >> 3) % 7) - 3) * 0.00042;
  return { lat: center.lat + dx, lng: center.lng + dy };
}

export function recordHasSavedMapCoord(record: BirdRecord): boolean {
  return (
    (typeof record.latitude === "number" && typeof record.longitude === "number") ||
    getStoredRecordMapCoord(record.id) !== null
  );
}

export function resolveRecordMapCoord(record: BirdRecord, fallbackCenter: MapCoord | null): MapCoord | null {
  if (typeof record.latitude === "number" && typeof record.longitude === "number") {
    return { lat: record.latitude, lng: record.longitude };
  }
  const stored = getStoredRecordMapCoord(record.id);
  if (stored) {
    return stored;
  }
  if (fallbackCenter) {
    return jitterAroundCenter(fallbackCenter, record.id);
  }
  return null;
}

export function mergeRecordMapCoords(records: BirdRecord[]): BirdRecord[] {
  return records.map((record) => {
    if (typeof record.latitude === "number" && typeof record.longitude === "number") {
      return record;
    }
    const stored = getStoredRecordMapCoord(record.id);
    if (!stored) {
      return record;
    }
    return { ...record, latitude: stored.lat, longitude: stored.lng };
  });
}

export function mergeArchiveRecordMapCoords(
  archives: Record<string, DailyGardenArchive> | undefined
) {
  if (!archives) {
    return archives;
  }
  const next: typeof archives = {};
  for (const [dateKey, archive] of Object.entries(archives)) {
    next[dateKey] = {
      ...archive,
      records: mergeRecordMapCoords(archive.records),
    };
  }
  return next;
}
