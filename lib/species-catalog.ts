import type { BirdRecord, PlacedBird } from "@/lib/supabase/garden";
import { getRecordSpeciesLabel } from "@/lib/garden-daily";

/** waterfowl: 연못 수영/연안, land: 육지만, wader: 물가 위주 */
export type SpeciesPlacement = "waterfowl" | "land" | "wader";

export type ListedSpecies = {
  id: string;
  name: string;
  imageSrc: string;
  waterImageSrc?: string;
  placement: SpeciesPlacement;
};

export const LISTED_SPECIES: ListedSpecies[] = [
  {
    id: "mallard",
    name: "청둥오리",
    imageSrc: "/duck.png",
    waterImageSrc: "/wduck.png",
    placement: "waterfowl",
  },
  {
    id: "mallard_female",
    name: "청둥오리 암컷",
    imageSrc: "/gduck.png",
    waterImageSrc: "/wgduck.png",
    placement: "waterfowl",
  },
  { id: "magpie", name: "까치", imageSrc: "/kachi.png", placement: "land" },
  { id: "sparrow", name: "참새", imageSrc: "/cham.png", placement: "land" },
  { id: "crow", name: "까마귀", imageSrc: "/kamak.png", placement: "land" },
  {
    id: "grey_heron",
    name: "해오라기",
    imageSrc: "/haeyo.png",
    waterImageSrc: "/whaeyo.png",
    placement: "wader",
  },
  {
    id: "egret",
    name: "백로",
    imageSrc: "/baeklo.png",
    waterImageSrc: "/wbaeklo.png",
    placement: "wader",
  },
  {
    id: "cattle_egret",
    name: "왜가리",
    imageSrc: "/whyga.png",
    waterImageSrc: "/wwhyga.png",
    placement: "wader",
  },
];

const BY_ID = new Map(LISTED_SPECIES.map((species) => [species.id, species]));
const BY_NAME = new Map(LISTED_SPECIES.map((species) => [species.name, species]));

export const LIST_SPECIES_BY_ID: Record<string, string> = Object.fromEntries(
  LISTED_SPECIES.map((species) => [species.id, species.name])
);

export const KNOWN_SPECIES_NAME_SET = new Set(LISTED_SPECIES.map((species) => species.name));

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

/** 연못 안(y ≥ 80) — w* 스프라이트는 이 구간에서만 */
export const WATER_ZONE_Y_MIN = 80;

export function birdIsInWaterZone(bird: Pick<PlacedBird, "yPercent">): boolean {
  return bird.yPercent >= WATER_ZONE_Y_MIN;
}

export function getSpeciesSpriteSrc(species: ListedSpecies | null, inWater: boolean): string {
  if (!species) {
    return "/duck.png";
  }
  if (species.placement === "land") {
    return species.imageSrc;
  }
  if (inWater === true && species.waterImageSrc) {
    return species.waterImageSrc;
  }
  return species.imageSrc;
}

export function getSpriteSrcForRecord(record: BirdRecord | undefined, inWater: boolean): string {
  return getSpeciesSpriteSrc(getListedSpeciesByRecord(record), inWater);
}

/** 까치·참새·까마귀 — 연못(물) 위 배치 금지 */
export const LAND_ONLY_SPECIES_IDS = new Set(["magpie", "sparrow", "crow"]);

/** 연못 안·물가만 — 잔디(육지) 배치 금지 */
export const WATER_AFFINITY_SPECIES_IDS = new Set([
  "mallard",
  "mallard_female",
  "grey_heron",
  "egret",
  "cattle_egret",
]);

const WATER_AFFINITY_NAMES = new Set([
  "청둥오리",
  "청둥오리 암컷",
  "해오라기",
  "백로",
  "왜가리",
]);

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

/** 화면용 inWater — 물 전용 종은 y 좌표로 w* 스프라이트 여부를 확정 */
export function resolveBirdInWater(
  bird: Pick<PlacedBird, "yPercent" | "inWater">,
  record?: BirdRecord | null
): boolean {
  if (record && recordMustStayOnLand(record)) {
    return false;
  }
  if (record && recordMustStayNearWater(record)) {
    return birdIsInWaterZone(bird);
  }
  return bird.inWater === true;
}

export function recordMustStayOnLand(record: BirdRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }
  if (record.listBirdId && isLandSpecies(record.listBirdId)) {
    return true;
  }
  const species = getListedSpeciesByRecord(record);
  if (species?.placement === "land") {
    return true;
  }
  const label = record.speciesName?.trim() || record.name.trim();
  return label === "까치" || label === "참새" || label === "까마귀";
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
