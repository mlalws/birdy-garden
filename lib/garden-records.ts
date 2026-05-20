import type { BirdRecord, DailyGardenArchive, UserGardenPayload } from "@/lib/supabase/garden";

/** 목록에서 고를 수 있는 조류 (placeholder 제외) */
const LISTED_BIRDS = [
  { id: "mallard", name: "청둥오리" },
  { id: "magpie", name: "까치" },
] as const;

const KNOWN_SPECIES_NAMES = new Set(["청둥오리", "까치"]);

const LIST_SPECIES_BY_ID: Record<string, string> = {
  mallard: "청둥오리",
  magpie: "까치",
};

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

  const listedByExactName = LISTED_BIRDS.find((item) => item.name === trimmedName);
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

  if (KNOWN_SPECIES_NAMES.has(trimmedName)) {
    return { ...record, speciesName: trimmedName };
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

function migrateDexSeenSpecies(seen: string[] | undefined, records: BirdRecord[]): string[] {
  const labels = new Set<string>();
  for (const name of seen ?? []) {
    const trimmed = name.trim();
    if (!trimmed) {
      continue;
    }
    if (LEGACY_NICKNAME_TO_LIST[trimmed]) {
      labels.add(LEGACY_NICKNAME_TO_LIST[trimmed].speciesName);
    } else if (trimmed.startsWith("청둥")) {
      labels.add("청둥오리");
    } else {
      labels.add(trimmed);
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
  return {
    ...payload,
    records,
    dailyArchives: migrateArchives(payload.dailyArchives),
    dexSeenSpecies: migrateDexSeenSpecies(payload.dexSeenSpecies, records),
  };
}

export function gardenPayloadNeedsMigration(payload: UserGardenPayload): boolean {
  const migrated = migrateGardenPayload(payload);
  return JSON.stringify(migrated) !== JSON.stringify(payload);
}
