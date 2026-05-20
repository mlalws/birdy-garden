import type { BirdRecord } from "@/lib/supabase/garden";
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

export function getSpeciesSpriteSrc(species: ListedSpecies | null, inWater: boolean): string {
  if (!species) {
    return "/duck.png";
  }
  if (species.placement === "land") {
    return species.imageSrc;
  }
  if (inWater && species.waterImageSrc) {
    return species.waterImageSrc;
  }
  return species.imageSrc;
}

export function getSpriteSrcForRecord(record: BirdRecord | undefined, inWater: boolean): string {
  return getSpeciesSpriteSrc(getListedSpeciesByRecord(record), inWater);
}

export function isLandSpecies(listBirdId: string | null | undefined): boolean {
  return getListedSpeciesById(listBirdId)?.placement === "land";
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
