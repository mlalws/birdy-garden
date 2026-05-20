import { getRecordSpeciesLabel } from "@/lib/garden-daily";
import { migrateBirdRecord } from "@/lib/garden-records";
import { KNOWN_SPECIES_NAME_SET, LISTED_SPECIES, getListedSpeciesByName } from "@/lib/species-catalog";
import type { BirdRecord, CustomListBird, DailyGardenArchive } from "@/lib/supabase/garden";

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
      "청둥오리는 우리나라에서 가장 흔히 만나는 오리입니다. 수컷은 머리가 녹색, 암컷은 갈색 깃으로 위장하며, 연못·강·습지에서 헤엄치거나 물가를 걸어 다니며 먹이를 찾습니다. 등록할 때 수컷·암컷 마릿수를 따로 적을 수 있어요.",
  },
  {
    id: "mandarin_duck",
    name: "원앙",
    imageSrc: "/ang.png",
    description:
      "원앙은 수컷이 화려한 붉은·푸른 깃을 가진 대표적인 물새입니다. 연못·하천·습지에서 헤엄치거나 물가 잔디에서 쉬며, 겨울에는 따뜻한 지역으로 이동하기도 합니다. 등록할 때 수컷·암컷 마릿수를 따로 적을 수 있어요.",
  },
  {
    id: "magpie",
    name: "까치",
    imageSrc: "/kachi.png",
    description:
      "까치는 검은색과 흰색이 뚜렷한 대표적인 텃새입니다. 숲 가장자리·공원·마을 근처에서 쌍이나 작은 무리로 지내며, 울음소리로 영역을 알립니다. 땅에서 벌레와 씨를 찾아 먹고, 둥지는 나무 위 높은 가지에 짓습니다.",
  },
  {
    id: "sparrow",
    name: "참새",
    imageSrc: "/cham.png",
    description:
      "참새는 우리 주변에서 가장 흔한 작은 텃새입니다. 공원·마을·밭두렁에서 무리를 지어 뛰어다니며 씨앗과 곤충을 먹습니다. 짧고 가까운 짹짹 소리를 자주 내며, 사람과 가까운 거리에서도 쉽게 볼 수 있습니다.",
  },
  {
    id: "crow",
    name: "까마귀",
    imageSrc: "/kamak.png",
    description:
      "까마귀는 크고 검은 깃의 똑똑한 조류입니다. 도시 골목, 산책로, 들판에서 까까 울음을 내며 활동합니다. 잡식성으로 먹이를 넓게 찾으며, 무리로 움직일 때도 있어 관찰하기 쉽습니다.",
  },
  {
    id: "grey_heron",
    name: "해오라기",
    imageSrc: "/haeyo.png",
    description:
      "해오라기는 긴 다리와 부리를 가진 큰 물새입니다. 연못·하천·논두렁에서 조용히 서 있다가 물고기를 낚아챕니다. 회청색 깃과 느린 움직임이 특징이며, 우리나라 전역에서 널리 볼 수 있습니다.",
  },
  {
    id: "egret",
    name: "백로",
    imageSrc: "/baeklo.png",
    description:
      "백로는 눈에 띄는 하얀 깃의 우아한 물새입니다. 얕은 물가·논·강변에서 한 마리씩 서서 먹이를 찾습니다. 부리와 다리가 길고, 천천히 걷거나 날아오르는 모습이 인상적입니다.",
  },
  {
    id: "cattle_egret",
    name: "왜가리",
    imageSrc: "/whyga.png",
    description:
      "왜가리는 작고 흰색인 왜관목입니다. 논·들판·도로변에서 소나 농기구를 따라다니며 벌레를 잡아 먹기도 합니다. 오리·까치 등 다른 조류 옆에 붙어 먹이를 얻는 모습으로도 잘 알려져 있습니다.",
  },
];

const SPECIES_BY_NAME = new Map(SPECIES_DEX_CATALOG.map((item) => [item.name, item]));

export function getDexDetailDisplay(
  speciesName: string,
  options: {
    records: BirdRecord[];
    archives?: Record<string, DailyGardenArchive>;
    customListBirds?: CustomListBird[];
  }
): { imageSrc: string; description: string; isCatalogSpecies: boolean } {
  const trimmed = speciesName.trim();
  const catalog = getSpeciesDexInfo(trimmed);
  const custom = options.customListBirds?.find((entry) => entry.name === trimmed);

  const allRecords: BirdRecord[] = [...options.records];
  if (options.archives) {
    for (const archive of Object.values(options.archives)) {
      allRecords.push(...archive.records);
    }
  }
  const photoRecord = [...allRecords]
    .reverse()
    .find((record) => getRecordSpeciesLabel(record) === trimmed && record.photoUrl);

  const isCatalogSpecies = KNOWN_SPECIES_NAME_SET.has(trimmed);

  if (!isCatalogSpecies) {
    const imageSrc = photoRecord?.photoUrl ?? custom?.imageSrc ?? "/duck.png";
    const description =
      custom?.description?.trim() ||
      photoRecord?.feature?.trim() ||
      `${trimmed}에 대한 설명이 아직 준비되지 않았어요. 발견 기록을 쌓아 도감을 채워 보세요.`;
    return { imageSrc, description, isCatalogSpecies: false };
  }

  return {
    imageSrc: catalog?.imageSrc ?? "/duck.png",
    description:
      catalog?.description ??
      `${trimmed}에 대한 설명이 아직 준비되지 않았어요. 발견 기록을 쌓아 도감을 채워 보세요.`,
    isCatalogSpecies: true,
  };
}

export function getSpeciesDexInfo(speciesName: string): SpeciesDexInfo | null {
  const trimmed = speciesName.trim();
  const fromCatalog = SPECIES_BY_NAME.get(trimmed);
  if (fromCatalog) {
    return fromCatalog;
  }
  const listed = getListedSpeciesByName(trimmed);
  if (!listed) {
    return null;
  }
  return {
    id: listed.id,
    name: listed.name,
    imageSrc: listed.imageSrc,
    description: `${listed.name}에 대한 설명이 준비 중입니다.`,
  };
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

/** 도감 카드용 — catalog와 동기화 */
export const KNOWN_DEX_SPECIES = LISTED_SPECIES.map((species) => {
  const dex = SPECIES_DEX_CATALOG.find((item) => item.id === species.id);
  return {
    id: species.id,
    name: species.name,
    imageSrc: dex?.imageSrc ?? species.imageSrc,
  };
});
