import { getRecordSpeciesLabel } from "@/lib/garden-daily";
import { migrateBirdRecord } from "@/lib/garden-records";
import type { BirdRecord, DailyGardenArchive } from "@/lib/supabase/garden";

const KST_TIMEZONE = "Asia/Seoul";

export type SpeciesDexInfo = {
  id: string;
  name: string;
  imageSrc: string;
  description: string;
};

export const SPECIES_DEX_CATALOG: SpeciesDexInfo[] = [
  {
    id: "mallard",
    name: "청둥오리",
    imageSrc: "/duck.png",
    description:
      "청둥오리는 우리나라에서 가장 흔히 만나는 오리입니다. 수컷은 머리가 녹색, 암컷은 갈색 깃으로 위장하며, 연못·강·습지에서 헤엄치거나 기와 주변을 걸어 다니며 먹이를 찾습니다. 겨울철에도 도심 공원 연못에서 자주 관찰됩니다.",
  },
  {
    id: "magpie",
    name: "까치",
    imageSrc: "/kachi.png",
    description:
      "까치는 검은색과 흰색이 뚜렷한 대표적인 텃새입니다. 숲 가장자리·공원·마을 근처에서 쌍이나 작은 무리로 지내며, 울음소리로 영역을 알립니다. 땅에서 벌레와 씨를 찾아 먹고, 둥지는 나무 위 높은 가지에 짓습니다.",
  },
];

const SPECIES_BY_NAME = new Map(SPECIES_DEX_CATALOG.map((item) => [item.name, item]));

export function getSpeciesDexInfo(speciesName: string): SpeciesDexInfo | null {
  return SPECIES_BY_NAME.get(speciesName.trim()) ?? null;
}

export type SpeciesSightingEntry = {
  recordId: string;
  dateKey: string;
  dateLabel: string;
  count: number;
  createdAt: string;
};

export function getKstDateKeyFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: KST_TIMEZONE }).format(new Date());
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST_TIMEZONE }).format(date);
}

export function formatKstShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const month = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: KST_TIMEZONE, month: "numeric" }).format(date)
  );
  const day = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: KST_TIMEZONE, day: "numeric" }).format(date)
  );
  return `${month}/${day}`;
}

export function collectSpeciesSightings(
  speciesName: string,
  liveRecords: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined
): { total: number; entries: SpeciesSightingEntry[] } {
  const key = speciesName.trim();
  const entries: SpeciesSightingEntry[] = [];

  const pushRecord = (record: BirdRecord, fallbackDateKey?: string) => {
    const migrated = migrateBirdRecord(record);
    if (getRecordSpeciesLabel(migrated) !== key) {
      return;
    }
    const dateKey = fallbackDateKey ?? getKstDateKeyFromIso(migrated.createdAt);
    entries.push({
      recordId: migrated.id,
      dateKey,
      dateLabel: formatKstShortDate(migrated.createdAt),
      count: Math.max(1, migrated.count),
      createdAt: migrated.createdAt,
    });
  };

  for (const record of liveRecords) {
    pushRecord(record);
  }

  if (archives) {
    for (const [dateKey, archive] of Object.entries(archives)) {
      for (const record of archive.records) {
        pushRecord(record, dateKey);
      }
    }
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return { total, entries };
}

export function findBirdRecordById(
  recordId: string,
  liveRecords: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined
): { record: BirdRecord; dateKey: string; inArchive: boolean } | null {
  const live = liveRecords.find((record) => record.id === recordId);
  if (live) {
    return { record: migrateBirdRecord(live), dateKey: getKstDateKeyFromIso(live.createdAt), inArchive: false };
  }

  if (!archives) {
    return null;
  }

  for (const [dateKey, archive] of Object.entries(archives)) {
    const archived = archive.records.find((record) => record.id === recordId);
    if (archived) {
      return { record: migrateBirdRecord(archived), dateKey, inArchive: true };
    }
  }

  return null;
}
