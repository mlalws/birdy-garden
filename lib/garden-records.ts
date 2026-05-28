import { getRecordSpeciesLabel } from "@/lib/garden-daily";
import { normalizePlacedBirds } from "@/lib/garden-birds";
import {
  KNOWN_SPECIES_NAME_SET,
  LIST_SPECIES_BY_ID,
  LISTED_SPECIES,
  getListedSpeciesById,
  getListedSpeciesByName,
  speciesUsesSexSplit,
} from "@/lib/species-catalog";
import type {
  BirdRecord,
  DailyGardenArchive,
  UserGardenPayload,
} from "@/lib/supabase/garden";

/** 예전 빌드에서 저장된 별명 → 목록 종 */
const LEGACY_NICKNAME_TO_LIST: Record<string, { speciesName: string; listBirdId: string }> = {
  청둥이: { speciesName: "청둥오리", listBirdId: "mallard" },
  청둥: { speciesName: "청둥오리", listBirdId: "mallard" },
};

function normalizeSexCounts(record: BirdRecord): BirdRecord {
  if (record.listBirdId === "mallard_female") {
    const count = Math.max(1, record.count);
    return {
      ...record,
      listBirdId: "mallard",
      speciesName: "청둥오리",
      maleCount: 0,
      femaleCount: count,
      count,
    };
  }
  if (!speciesUsesSexSplit(record.listBirdId)) {
    return record;
  }
  const male = record.maleCount ?? 0;
  const female = record.femaleCount ?? 0;
  if (male + female > 0) {
    return { ...record, maleCount: male, femaleCount: female, count: male + female };
  }
  const total = Math.max(1, record.count);
  return { ...record, maleCount: total, femaleCount: 0, count: total };
}

export function migrateBirdRecord(record: BirdRecord): BirdRecord {
  const withSex = normalizeSexCounts(record);

  if (withSex.listBirdId === "mallard_female") {
    return normalizeSexCounts({ ...withSex, listBirdId: "mallard", speciesName: "청둥오리" });
  }

  if (withSex.speciesName?.trim()) {
    return normalizeSexCounts({
      ...withSex,
      speciesName: withSex.speciesName.trim(),
      listBirdId: withSex.listBirdId ?? undefined,
    });
  }

  if (withSex.listBirdId && LIST_SPECIES_BY_ID[withSex.listBirdId]) {
    return normalizeSexCounts({
      ...withSex,
      speciesName: LIST_SPECIES_BY_ID[withSex.listBirdId],
      listBirdId: withSex.listBirdId,
    });
  }

  const trimmedName = withSex.name.trim();
  const legacy = LEGACY_NICKNAME_TO_LIST[trimmedName];
  if (legacy) {
    return normalizeSexCounts({ ...withSex, speciesName: legacy.speciesName, listBirdId: legacy.listBirdId });
  }

  const listedByExactName = LISTED_SPECIES.find((item) => item.name === trimmedName);
  if (listedByExactName) {
    return normalizeSexCounts({
      ...withSex,
      speciesName: listedByExactName.name,
      listBirdId: listedByExactName.id,
    });
  }

  if (trimmedName.startsWith("청둥")) {
    return normalizeSexCounts({ ...withSex, speciesName: "청둥오리", listBirdId: "mallard" });
  }

  if (trimmedName === "청둥오리 암컷") {
    return normalizeSexCounts({
      ...withSex,
      speciesName: "청둥오리",
      listBirdId: "mallard",
      maleCount: 0,
      femaleCount: Math.max(1, withSex.count),
      count: Math.max(1, withSex.count),
    });
  }

  if (KNOWN_SPECIES_NAME_SET.has(trimmedName)) {
    const listed = getListedSpeciesByName(trimmedName);
    return normalizeSexCounts({
      ...withSex,
      speciesName: trimmedName,
      listBirdId: listed?.id,
    });
  }

  return withSex;
}

export function migrateBirdRecords(records: BirdRecord[]): BirdRecord[] {
  return records.map(migrateBirdRecord);
}

/** 도감·지도 수정 시 총 마릿수 변경 — 암수 종은 암컷부터 줄이고 추가는 수컷 */
export function applyRecordCountChange(record: BirdRecord, nextCount: number): BirdRecord {
  const migrated = migrateBirdRecord(record);
  const safeCount = Math.max(1, nextCount);
  if (!speciesUsesSexSplit(migrated.listBirdId)) {
    return { ...migrated, count: safeCount };
  }
  const male = migrated.maleCount ?? migrated.count;
  const female = migrated.femaleCount ?? 0;
  const total = male + female;
  const delta = safeCount - total;
  let newMale = male;
  let newFemale = female;
  if (delta > 0) {
    newMale += delta;
  } else {
    let remove = -delta;
    const fromFemale = Math.min(remove, newFemale);
    newFemale -= fromFemale;
    remove -= fromFemale;
    newMale = Math.max(0, newMale - remove);
  }
  return { ...migrated, maleCount: newMale, femaleCount: newFemale, count: newMale + newFemale };
}

function migrateArchives(
  archives: Record<string, DailyGardenArchive> | undefined
): Record<string, DailyGardenArchive> | undefined {
  if (!archives) {
    return undefined;
  }

  const next: Record<string, DailyGardenArchive> = {};
  for (const [dateKey, archive] of Object.entries(archives)) {
    next[dateKey] = {
      ...archive,
      records: migrateBirdRecords(archive.records),
    };
  }
  return next;
}

const normalizeDexSpeciesLabel = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  if (LEGACY_NICKNAME_TO_LIST[trimmed]) {
    return LEGACY_NICKNAME_TO_LIST[trimmed].speciesName;
  }
  if (trimmed.startsWith("청둥")) {
    return "청둥오리";
  }
  if (KNOWN_SPECIES_NAME_SET.has(trimmed)) {
    return trimmed;
  }
  const listed = getListedSpeciesByName(trimmed);
  return listed?.name ?? trimmed;
};

/** 정원·목록에 실제로 남아 있는 종만 도감 해금/열람 목록으로 맞춤 */
export function buildDexStateFromGarden(
  records: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined,
  previousSeen: string[] = []
): { dexUnlockedSpecies: string[]; dexSeenSpecies: string[] } {
  const activeLabels = new Set(collectSpeciesLabelsFromGarden(records, archives));
  const dexUnlockedSpecies = [...activeLabels];
  const dexSeenSpecies = previousSeen.filter((name) => activeLabels.has(name.trim()));
  return { dexUnlockedSpecies, dexSeenSpecies };
}

export function collectSpeciesLabelsFromGarden(
  records: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined
): string[] {
  const labels = new Set<string>();
  const addRecord = (record: BirdRecord) => {
    const label = getRecordSpeciesLabel(migrateBirdRecord(record));
    if (label) {
      labels.add(label);
    }
  };

  for (const record of records) {
    addRecord(record);
  }

  if (archives) {
    for (const archive of Object.values(archives)) {
      for (const record of archive.records) {
        addRecord(record);
      }
    }
  }

  return [...labels];
}

function migrateDexUnlockedSpecies(
  unlocked: string[] | undefined,
  seen: string[] | undefined,
  records: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined
): string[] {
  const labels = new Set<string>();
  for (const name of [...(unlocked ?? []), ...(seen ?? [])]) {
    const normalized = normalizeDexSpeciesLabel(name);
    if (normalized) {
      labels.add(normalized);
    }
  }
  for (const label of collectSpeciesLabelsFromGarden(records, archives)) {
    labels.add(label);
  }
  return [...labels];
}

function migrateDexSeenSpecies(seen: string[] | undefined, records: BirdRecord[]): string[] {
  const labels = new Set<string>();
  for (const name of seen ?? []) {
    const normalized = normalizeDexSpeciesLabel(name);
    if (normalized) {
      labels.add(normalized);
    }
  }
  for (const record of records) {
    const label = migrateBirdRecord(record).speciesName;
    if (label) {
      labels.add(label);
    }
  }
  return [...labels];
}

function normalizeArchiveBirds(archives: Record<string, DailyGardenArchive> | undefined) {
  if (!archives) {
    return undefined;
  }

  const next: Record<string, DailyGardenArchive> = {};
  for (const [dateKey, archive] of Object.entries(archives)) {
    const records = migrateBirdRecords(archive.records);
    next[dateKey] = {
      ...archive,
      records,
      birds: normalizePlacedBirds(archive.birds, records),
    };
  }
  return next;
}

export function migrateGardenPayload(payload: UserGardenPayload): UserGardenPayload {
  const records = migrateBirdRecords(payload.records);
  const dailyArchives = normalizeArchiveBirds(migrateArchives(payload.dailyArchives));
  const customListBirds = payload.customListBirds ?? [];
  const dex = buildDexStateFromGarden(
    records,
    dailyArchives,
    migrateDexSeenSpecies(payload.dexSeenSpecies, records)
  );
  return {
    ...payload,
    records,
    birds: normalizePlacedBirds(payload.birds, records),
    dailyArchives,
    customListBirds,
    dexUnlockedSpecies: dex.dexUnlockedSpecies,
    dexSeenSpecies: dex.dexSeenSpecies,
  };
}

export function gardenPayloadNeedsMigration(payload: UserGardenPayload): boolean {
  const migrated = migrateGardenPayload(payload);
  return JSON.stringify(migrated) !== JSON.stringify(payload);
}
