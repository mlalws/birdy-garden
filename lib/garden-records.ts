import { getRecordSpeciesLabel } from "@/lib/garden-daily";
import {
  KNOWN_SPECIES_NAME_SET,
  LIST_SPECIES_BY_ID,
  LISTED_SPECIES,
  getListedSpeciesById,
  getListedSpeciesByName,
} from "@/lib/species-catalog";
import type { BirdRecord, DailyGardenArchive, UserGardenPayload } from "@/lib/supabase/garden";

/** 예전 빌드에서 저장된 별명 → 목록 종 */
const LEGACY_NICKNAME_TO_LIST: Record<string, { speciesName: string; listBirdId: string }> = {
  청둥이: { speciesName: "청둥오리", listBirdId: "mallard" },
  청둥: { speciesName: "청둥오리", listBirdId: "mallard" },
};

export function migrateBirdRecord(record: BirdRecord): BirdRecord {
  if (record.speciesName?.trim()) {
    return {
      ...record,
      speciesName: record.speciesName.trim(),
      listBirdId: record.listBirdId ?? undefined,
    };
  }

  if (record.listBirdId && LIST_SPECIES_BY_ID[record.listBirdId]) {
    return {
      ...record,
      speciesName: LIST_SPECIES_BY_ID[record.listBirdId],
      listBirdId: record.listBirdId,
    };
  }

  const trimmedName = record.name.trim();
  const legacy = LEGACY_NICKNAME_TO_LIST[trimmedName];
  if (legacy) {
    return { ...record, speciesName: legacy.speciesName, listBirdId: legacy.listBirdId };
  }

  const listedByExactName = LISTED_SPECIES.find((item) => item.name === trimmedName);
  if (listedByExactName) {
    return {
      ...record,
      speciesName: listedByExactName.name,
      listBirdId: listedByExactName.id,
    };
  }

  if (trimmedName.startsWith("청둥")) {
    return { ...record, speciesName: "청둥오리", listBirdId: "mallard" };
  }

  if (KNOWN_SPECIES_NAME_SET.has(trimmedName)) {
    const listed = getListedSpeciesByName(trimmedName);
    return {
      ...record,
      speciesName: trimmedName,
      listBirdId: listed?.id,
    };
  }

  return record;
}

export function migrateBirdRecords(records: BirdRecord[]): BirdRecord[] {
  return records.map(migrateBirdRecord);
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

export function migrateGardenPayload(payload: UserGardenPayload): UserGardenPayload {
  const records = migrateBirdRecords(payload.records);
  const dailyArchives = migrateArchives(payload.dailyArchives);
  return {
    ...payload,
    records,
    dailyArchives,
    dexUnlockedSpecies: migrateDexUnlockedSpecies(
      payload.dexUnlockedSpecies,
      payload.dexSeenSpecies,
      records,
      dailyArchives
    ),
    dexSeenSpecies: migrateDexSeenSpecies(payload.dexSeenSpecies, records),
  };
}

export function gardenPayloadNeedsMigration(payload: UserGardenPayload): boolean {
  const migrated = migrateGardenPayload(payload);
  return JSON.stringify(migrated) !== JSON.stringify(payload);
}
