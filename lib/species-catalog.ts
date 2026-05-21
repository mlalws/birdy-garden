import type { BirdRecord, BirdSex, PlacedBird } from "@/lib/supabase/garden";
import { getRecordSpeciesLabel } from "@/lib/garden-daily";

/** waterfowl: 연못 수영/연안, land: 육지만, wader: 물가 위주 */
export type SpeciesPlacement = "waterfowl" | "land" | "wader";

export type ListedSpecies = {
  id: string;
  name: string;
  imageSrc: string;
  waterImageSrc?: string;
  /** 암수 구분 종 — 물가/잔디 */
  femaleImageSrc?: string;
  /** 암수 구분 종 — 연못 안 */
  femaleWaterImageSrc?: string;
  placement: SpeciesPlacement;
  /** 등록 목록 카드용 한 줄 요약 */
  listBlurb: string;
};

/** 등록 화면에서 수컷·암컷 마릿수를 따로 받는 종 */
export const SPECIES_WITH_SEX_SPLIT = new Set(["mallard", "mandarin_duck"]);

export const LISTED_SPECIES: ListedSpecies[] = [
  {
    id: "mallard",
    name: "청둥오리",
    imageSrc: "/duck.png",
    waterImageSrc: "/wduck.png",
    femaleImageSrc: "/gduck.png",
    femaleWaterImageSrc: "/wgduck.png",
    placement: "waterfowl",
    listBlurb:
      "머리가 반짝이는 녹색을 띠는 수컷이 유명하며, 우리 주변에서 가장 흔히 볼 수 있는 오리입니다.",
  },
  {
    id: "mandarin_duck",
    name: "원앙",
    imageSrc: "/ang.png",
    waterImageSrc: "/wang.png",
    femaleImageSrc: "/gang.png",
    femaleWaterImageSrc: "/wgang.png",
    placement: "waterfowl",
    listBlurb:
      "수컷의 깃털이 눈부시게 화려하며, 문화적으로 부부금슬을 상징하는 아름다운 물새입니다.",
  },
  {
    id: "magpie",
    name: "까치",
    imageSrc: "/kachi.png",
    placement: "land",
    listBlurb:
      "거울 속 자신을 알아볼 정도로 지능이 높고, 흑백의 깃털을 가진 대표적인 텃새입니다.",
  },
  {
    id: "sparrow",
    name: "참새",
    imageSrc: "/cham.png",
    placement: "land",
    listBlurb:
      "갈색의 작고 통통한 몸집을 가졌으며, 늘 무리 지어 다니며 짹짹거리는 친숙한 새입니다.",
  },
  {
    id: "crow",
    name: "까마귀",
    imageSrc: "/kamak.png",
    placement: "land",
    listBlurb:
      "온몸이 새검은 깃털로 덮여 있으며, 도구를 쓸 줄 알만큼 조류 중 지능이 가장 뛰어납니다.",
  },
  {
    id: "pigeon",
    name: "비둘기",
    imageSrc: "/bidul.png",
    placement: "land",
    listBlurb:
      "도시와 마을 곳곳에서 흔히 볼 수 있는 회색 깃의 새로, 짧은 부리와 둥근 몸집이 특징입니다.",
  },
  {
    id: "grey_heron",
    name: "해오라기",
    imageSrc: "/haeyo.png",
    waterImageSrc: "/whaeyo.png",
    placement: "wader",
    listBlurb:
      "낮에는 숨어있다가 밤에 주로 활동하며, 물가에서 물고기를 사냥하는 야행성 물새입니다.",
  },
  {
    id: "egret",
    name: "백로",
    imageSrc: "/baeklo.png",
    waterImageSrc: "/wbaeklo.png",
    placement: "wader",
    listBlurb:
      "온몸이 눈부시게 하얀 깃털로 뒤덮여 있으며, 긴 다리로 물가를 거니는 우아한 새입니다.",
  },
  {
    id: "cattle_egret",
    name: "왜가리",
    imageSrc: "/whyga.png",
    waterImageSrc: "/wwhyga.png",
    placement: "wader",
    listBlurb:
      "하천 생태계의 최상위 포식자로, 큰 덩치와 긴 목을 가진 우리나라에서 가장 큰 왜가리과 새입니다.",
  },
];

const BY_ID = new Map(LISTED_SPECIES.map((species) => [species.id, species]));
const BY_NAME = new Map(LISTED_SPECIES.map((species) => [species.name, species]));

export const LIST_SPECIES_BY_ID: Record<string, string> = Object.fromEntries(
  LISTED_SPECIES.map((species) => [species.id, species.name])
);

export const KNOWN_SPECIES_NAME_SET = new Set(LISTED_SPECIES.map((species) => species.name));

export function isCustomListBirdId(listBirdId: string | null | undefined): boolean {
  return !!listBirdId && listBirdId.startsWith("custom-");
}

export function getListedSpeciesById(id: string | null | undefined): ListedSpecies | null {
  if (!id) {
    return null;
  }
  return BY_ID.get(id) ?? null;
}

export function getListedSpeciesByName(name: string): ListedSpecies | null {
  return BY_NAME.get(name.trim()) ?? null;
}

export function getListedSpeciesByRecord(record: BirdRecord | undefined): ListedSpecies | null {
  if (!record) {
    return null;
  }
  if (record.listBirdId) {
    const byId = getListedSpeciesById(record.listBirdId);
    if (byId) {
      return byId;
    }
  }
  const label = getRecordSpeciesLabel(record);
  return getListedSpeciesByName(label);
}

/** background.jpg 연못 대략 영역 (왼쪽·오른쪽 물웅덩이) */
const POND_LEFT = { xMin: 14, xMax: 54, yMin: 68, yMax: 88 };
const POND_RIGHT = { xMin: 66, xMax: 96, yMin: 70, yMax: 94 };

/** @deprecated y만 쓰던 구버전 호환 */
export const WATER_ZONE_Y_MIN = POND_LEFT.yMin;

/** 푸른 물 위인지 — x·y로 연못 영역 판별 */
export function birdIsInWaterZone(bird: Pick<PlacedBird, "xPercent" | "yPercent">): boolean {
  const x = bird.xPercent;
  const y = bird.yPercent;
  const inLeft = x >= POND_LEFT.xMin && x <= POND_LEFT.xMax && y >= POND_LEFT.yMin && y <= POND_LEFT.yMax;
  const inRight = x >= POND_RIGHT.xMin && x <= POND_RIGHT.xMax && y >= POND_RIGHT.yMin && y <= POND_RIGHT.yMax;
  return inLeft || inRight;
}

export function speciesUsesSexSplit(listBirdId: string | null | undefined): boolean {
  return !!listBirdId && SPECIES_WITH_SEX_SPLIT.has(listBirdId);
}

export function getSpeciesSpriteSrc(
  species: ListedSpecies | null,
  inWater: boolean,
  sex: BirdSex = "male"
): string {
  if (!species) {
    return "/duck.png";
  }
  if (species.placement === "land") {
    return species.imageSrc;
  }
  if (sex === "female") {
    if (inWater === true && species.femaleWaterImageSrc) {
      return species.femaleWaterImageSrc;
    }
    if (species.femaleImageSrc) {
      return species.femaleImageSrc;
    }
  }
  if (inWater === true && species.waterImageSrc) {
    return species.waterImageSrc;
  }
  return species.imageSrc;
}

export function getSpriteSrcForPlacedBird(
  bird: Pick<PlacedBird, "sex">,
  record: BirdRecord | undefined,
  inWater: boolean
): string {
  if (record?.photoUrl && isCustomListBirdId(record.listBirdId)) {
    return record.photoUrl;
  }
  const species = getListedSpeciesByRecord(record);
  const sex: BirdSex = bird.sex === "female" ? "female" : "male";
  return getSpeciesSpriteSrc(species, inWater, sex);
}

/** @deprecated PlacedBird.sex 없을 때만 사용 */
export function getSpriteSrcForRecord(record: BirdRecord | undefined, inWater: boolean): string {
  const species = getListedSpeciesByRecord(record);
  const sex: BirdSex =
    speciesUsesSexSplit(record?.listBirdId) && (record?.femaleCount ?? 0) > 0 && (record?.maleCount ?? 0) === 0
      ? "female"
      : "male";
  return getSpeciesSpriteSrc(species, inWater, sex);
}

/** 정원 표시 크기 — 청둥오리(1.0) 기준 배율 */
const SPECIES_SIZE_SCALE_BY_ID: Record<string, number> = {
  mallard: 1,
  mandarin_duck: 1,
  magpie: 1,
  sparrow: 0.5,
  crow: 1.2,
  grey_heron: 1.2,
  egret: 1.8,
  cattle_egret: 1.8,
};

export function getSpeciesSizeScale(
  listBirdId?: string | null,
  speciesName?: string | null
): number {
  if (listBirdId && listBirdId in SPECIES_SIZE_SCALE_BY_ID) {
    return SPECIES_SIZE_SCALE_BY_ID[listBirdId];
  }
  const label = speciesName?.trim();
  if (label) {
    const byName = getListedSpeciesByName(label);
    if (byName && byName.id in SPECIES_SIZE_SCALE_BY_ID) {
      return SPECIES_SIZE_SCALE_BY_ID[byName.id];
    }
  }
  const byId = getListedSpeciesById(listBirdId);
  if (byId && byId.id in SPECIES_SIZE_SCALE_BY_ID) {
    return SPECIES_SIZE_SCALE_BY_ID[byId.id];
  }
  return 1;
}

export function getSpeciesSizeScaleForRecord(record?: BirdRecord | null): number {
  if (!record) {
    return 1;
  }
  const species = getListedSpeciesByRecord(record);
  if (species) {
    return SPECIES_SIZE_SCALE_BY_ID[species.id] ?? 1;
  }
  return getSpeciesSizeScale(record.listBirdId, record.speciesName ?? record.name);
}

/** 까치·참새·까마귀 — 연못(물) 위 배치 금지 */
export const LAND_ONLY_SPECIES_IDS = new Set(["magpie", "sparrow", "crow", "pigeon"]);

/** 연못 안·물가만 — 잔디(육지) 배치 금지 */
export const WATER_AFFINITY_SPECIES_IDS = new Set([
  "mallard",
  "mandarin_duck",
  "grey_heron",
  "egret",
  "cattle_egret",
]);

const WATER_AFFINITY_NAMES = new Set(["청둥오리", "원앙", "해오라기", "백로", "왜가리"]);

export function isLandSpecies(listBirdId: string | null | undefined): boolean {
  if (!listBirdId) {
    return false;
  }
  if (LAND_ONLY_SPECIES_IDS.has(listBirdId)) {
    return true;
  }
  return getListedSpeciesById(listBirdId)?.placement === "land";
}

/** 기록(목록 id·종 이름) 기준 육지 전용 여부 */
export function isWaterAffinitySpecies(listBirdId: string | null | undefined): boolean {
  if (!listBirdId) {
    return false;
  }
  if (WATER_AFFINITY_SPECIES_IDS.has(listBirdId)) {
    return true;
  }
  const placement = getListedSpeciesById(listBirdId)?.placement;
  return placement === "waterfowl" || placement === "wader";
}

export function isWaterAffinityByName(speciesName: string | null | undefined): boolean {
  const label = speciesName?.trim();
  if (!label) {
    return false;
  }
  if (WATER_AFFINITY_NAMES.has(label)) {
    return true;
  }
  const placement = getListedSpeciesByName(label)?.placement;
  return placement === "waterfowl" || placement === "wader";
}

/** 기록 기준 — 연못·물가 전용 (잔디 금지) */
export function recordMustStayNearWater(record: BirdRecord | null | undefined): boolean {
  if (!record || recordMustStayOnLand(record)) {
    return false;
  }
  if (record.listBirdId && isWaterAffinitySpecies(record.listBirdId)) {
    return true;
  }
  const species = getListedSpeciesByRecord(record);
  if (species && (species.placement === "waterfowl" || species.placement === "wader")) {
    return true;
  }
  const label = record.speciesName?.trim() || record.name.trim();
  return WATER_AFFINITY_NAMES.has(label);
}

/** 물·육지 스프라이트 쌍이 있는 종 */
export function speciesHasWaterSprite(species: ListedSpecies | null | undefined): boolean {
  return !!species?.waterImageSrc;
}

/** 화면용 inWater — 연못(x·y) 안이면 w*, 밖이면 duck/g*·ang·haeyo 등 */
export function resolveBirdInWater(
  bird: Pick<PlacedBird, "xPercent" | "yPercent" | "inWater">,
  record?: BirdRecord | null
): boolean {
  if (record && recordMustStayOnLand(record)) {
    return false;
  }
  const species = getListedSpeciesByRecord(record ?? undefined);
  if (speciesHasWaterSprite(species)) {
    return birdIsInWaterZone(bird);
  }
  return bird.inWater === true;
}

export function recordMustStayOnLand(record: BirdRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }
  if (isCustomListBirdId(record.listBirdId)) {
    return true;
  }
  if (record.listBirdId && isLandSpecies(record.listBirdId)) {
    return true;
  }
  const species = getListedSpeciesByRecord(record);
  if (species?.placement === "land") {
    return true;
  }
  const label = record.speciesName?.trim() || record.name.trim();
  return label === "까치" || label === "참새" || label === "까마귀" || label === "비둘기";
}

export function isWaderSpecies(listBirdId: string | null | undefined): boolean {
  return getListedSpeciesById(listBirdId)?.placement === "wader";
}

export function shoreProbabilityForSpecies(listBirdId: string | null | undefined): number {
  const species = getListedSpeciesById(listBirdId);
  if (!species) {
    return 0.22;
  }
  if (species.placement === "land") {
    return 1;
  }
  if (species.placement === "wader") {
    return 0.35;
  }
  return 0.22;
}
