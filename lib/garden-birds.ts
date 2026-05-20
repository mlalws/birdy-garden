import {
  getListedSpeciesByName,
  getSpeciesSizeScale,
  getSpeciesSizeScaleForRecord,
  isLandSpecies,
  isWaterAffinitySpecies,
  recordMustStayNearWater,
  recordMustStayOnLand,
  shoreProbabilityForSpecies,
  speciesUsesSexSplit,
} from "@/lib/species-catalog";
import type { BirdRecord, BirdSex, PlacedBird } from "@/lib/supabase/garden";

export type BirdFacing = "left" | "right";

type Slot = Pick<PlacedBird, "xPercent" | "yPercent">;

/** 연못 가장자리 잔디 */
const SHORE_SLOTS: Slot[] = [
  { xPercent: 14, yPercent: 74 },
  { xPercent: 26, yPercent: 72 },
  { xPercent: 38, yPercent: 75 },
  { xPercent: 50, yPercent: 73 },
  { xPercent: 62, yPercent: 74 },
  { xPercent: 74, yPercent: 72 },
  { xPercent: 86, yPercent: 75 },
];

/** 연못 안 */
const WATER_SLOTS: Slot[] = [
  { xPercent: 19, yPercent: 82 },
  { xPercent: 30, yPercent: 85 },
  { xPercent: 41, yPercent: 83 },
  { xPercent: 55, yPercent: 88 },
  { xPercent: 67, yPercent: 84 },
  { xPercent: 78, yPercent: 90 },
  { xPercent: 88, yPercent: 86 },
];

/** 왼쪽 나무 가지·잎 (하늘색 배경이어도 나무 위면 허용) */
const LAND_TREE_SLOTS: Slot[] = [
  { xPercent: 7, yPercent: 54 },
  { xPercent: 11, yPercent: 50 },
  { xPercent: 14, yPercent: 57 },
  { xPercent: 9, yPercent: 48 },
];

/** 잔디 바닥만 — 지평선(약 50%) 아래 초록 잔디 (가운데·오른쪽 하늘 금지) */
const LAND_GROUND_SLOTS: Slot[] = [
  { xPercent: 24, yPercent: 68 },
  { xPercent: 34, yPercent: 66 },
  { xPercent: 44, yPercent: 69 },
  { xPercent: 54, yPercent: 67 },
  { xPercent: 64, yPercent: 68 },
  { xPercent: 74, yPercent: 66 },
  { xPercent: 84, yPercent: 69 },
  { xPercent: 93, yPercent: 67 },
];

/** 배경 이미지 상단 맨 하늘 — 배치 금지 */
const SKY_Y_MAX = 58;

/** 잔디 바닥 발 위치 */
export const LAND_GROUND_Y_MIN = 66;
export const LAND_GROUND_Y_MAX = 72;

/** 연못 물가·물 (y ≥ 71 = 파란 연못 영역) */
const SHORE_Y_MIN = 71;
const SHORE_Y_MAX = 79;

/** 연못 안 */
const WATER_Y_MIN = 80;
const WATER_Y_MAX = 93;

/** 화면 위쪽(멀리)일수록 작게, 아래(가까이)일수록 크게 */
const DEPTH_FAR_Y = 72;
const DEPTH_NEAR_Y = 92;
const SIZE_FAR = 45;
const SIZE_NEAR = 72;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pickFacing = (): BirdFacing => (Math.random() < 0.6 ? "right" : "left");

/** y 위치 기준 원근 크기 (같은 높이대는 거의 동일), 종별 배율은 청둥오리=1.0 기준 */
export function getBirdDisplaySize(
  bird: Pick<PlacedBird, "yPercent">,
  sizeScale = 1
): number {
  const t = clamp((bird.yPercent - DEPTH_FAR_Y) / (DEPTH_NEAR_Y - DEPTH_FAR_Y), 0, 1);
  const base = SIZE_FAR + t * (SIZE_NEAR - SIZE_FAR);
  return Math.max(8, Math.round(base * sizeScale));
}

function resolveOnLandPlacement(listBirdId: string | null | undefined, speciesName?: string | null): boolean {
  if (listBirdId?.startsWith("custom-")) {
    return true;
  }
  if (isLandSpecies(listBirdId)) {
    return true;
  }
  const label = speciesName?.trim();
  if (!label) {
    return false;
  }
  return getListedSpeciesByName(label)?.placement === "land";
}

function isSkyY(yPercent: number): boolean {
  return yPercent <= SKY_Y_MAX;
}

/** 육지·나무 슬롯 (물가 종이 잘못 들어온 경우 연못으로 보냄) */
function isLandPlacementZoneY(yPercent: number): boolean {
  return yPercent >= 46 && yPercent <= LAND_GROUND_Y_MAX;
}

/** 연못 물가·물 안 (파란색 배경) */
function isWaterZoneY(yPercent: number): boolean {
  return yPercent >= SHORE_Y_MIN;
}

function pickLandSlot(slotIndex: number): Slot {
  if (slotIndex % 4 === 0) {
    return LAND_TREE_SLOTS[Math.floor(slotIndex / 4) % LAND_TREE_SLOTS.length];
  }
  return LAND_GROUND_SLOTS[slotIndex % LAND_GROUND_SLOTS.length];
}

function snapLandBirdToSlot(bird: PlacedBird, slotIndex: number, sizeScale = 1): PlacedBird {
  const slot = pickLandSlot(slotIndex);
  const yPercent = slot.yPercent;
  return {
    ...bird,
    xPercent: slot.xPercent,
    yPercent,
    inWater: false,
    size: getBirdDisplaySize({ yPercent }, sizeScale),
  };
}

/** 나무 가지·잎 위 */
export function isLandTreePlacement(bird: Pick<PlacedBird, "xPercent" | "yPercent" | "inWater">): boolean {
  return (
    bird.inWater !== true &&
    bird.xPercent < 22 &&
    bird.yPercent >= 46 &&
    bird.yPercent < LAND_GROUND_Y_MIN
  );
}

/** 잔디 바닥 또는 나무 */
export function isLandBirdPlacement(bird: Pick<PlacedBird, "xPercent" | "yPercent" | "inWater">): boolean {
  if (bird.inWater === true) {
    return false;
  }
  return isLandTreePlacement(bird) || (bird.yPercent >= LAND_GROUND_Y_MIN && bird.yPercent <= LAND_GROUND_Y_MAX);
}

function clampNearWaterBird(bird: PlacedBird, sizeScale = 1): PlacedBird {
  const slotIndex = Math.floor(bird.xPercent) + Math.floor(bird.yPercent);
  const base = WATER_SLOTS[slotIndex % WATER_SLOTS.length];
  const ring = Math.floor(slotIndex / WATER_SLOTS.length);
  const xJitter = (ring % 2 === 0 ? 1 : -1) * Math.min(2, ring);
  const yJitter = (slotIndex % 3) - 1;
  const yPercent = clamp(base.yPercent + yJitter * 0.35, WATER_Y_MIN, WATER_Y_MAX);

  return {
    ...bird,
    xPercent: clamp(base.xPercent + xJitter, 8, 94),
    yPercent,
    inWater: true,
    size: getBirdDisplaySize({ yPercent }, sizeScale),
  };
}

export type CreateGardenBirdsOptions = {
  listBirdId?: string | null;
  speciesName?: string | null;
  count?: number;
  maleCount?: number;
  femaleCount?: number;
};

function createOneGardenBird(
  seq: number,
  recordId: string,
  stamp: number,
  listBirdId: string | null,
  speciesName: string | null,
  sex: BirdSex | undefined
): PlacedBird {
  const onLand = resolveOnLandPlacement(listBirdId, speciesName);
  const sizeScale = getSpeciesSizeScale(listBirdId, speciesName);
  const speciesIdForShore = listBirdId ?? getListedSpeciesByName(speciesName ?? "")?.id ?? null;
  const onShore = onLand
    ? false
    : isWaterAffinitySpecies(speciesIdForShore)
      ? false
      : Math.random() < shoreProbabilityForSpecies(speciesIdForShore);

  if (onLand) {
    const slot = pickLandSlot(seq);
    const yPercent = slot.yPercent;
    return {
      id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      xPercent: slot.xPercent,
      yPercent,
      size: getBirdDisplaySize({ yPercent }, sizeScale),
      facing: pickFacing(),
      inWater: false,
      sex,
    };
  }

  const pool = onShore ? SHORE_SLOTS : WATER_SLOTS;
  const base = pool[seq % pool.length];
  const ring = Math.floor(seq / pool.length);
  const xJitter = (ring % 2 === 0 ? 1 : -1) * Math.min(3, ring + 1);
  const yJitter = ((seq + ring) % 3) - 1;

  const yPercent = onShore
    ? clamp(base.yPercent + yJitter * 0.35, SHORE_Y_MIN, SHORE_Y_MAX)
    : clamp(base.yPercent + yJitter * 0.35, WATER_Y_MIN, WATER_Y_MAX);

  return {
    id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
    recordId,
    xPercent: clamp(base.xPercent + xJitter, 8, 94),
    yPercent,
    size: getBirdDisplaySize({ yPercent }, sizeScale),
    facing: pickFacing(),
    inWater: onLand ? false : !onShore,
    sex,
  };
}

export function createGardenBirds(
  offset: number,
  recordId: string,
  options: CreateGardenBirdsOptions = {}
): PlacedBird[] {
  const stamp = Date.now();
  const listBirdId = options.listBirdId ?? null;
  const speciesName = options.speciesName ?? null;
  const useSexSplit = speciesUsesSexSplit(listBirdId);
  const maleCount = useSexSplit ? Math.max(0, options.maleCount ?? 0) : 0;
  const femaleCount = useSexSplit ? Math.max(0, options.femaleCount ?? 0) : 0;
  const plainCount = useSexSplit ? 0 : Math.max(0, options.count ?? 0);

  const birds: PlacedBird[] = [];
  let seq = offset;

  if (useSexSplit) {
    for (let i = 0; i < maleCount; i += 1) {
      birds.push(createOneGardenBird(seq, recordId, stamp, listBirdId, speciesName, "male"));
      seq += 1;
    }
    for (let i = 0; i < femaleCount; i += 1) {
      birds.push(createOneGardenBird(seq, recordId, stamp, listBirdId, speciesName, "female"));
      seq += 1;
    }
    return birds;
  }

  for (let i = 0; i < plainCount; i += 1) {
    birds.push(createOneGardenBird(seq, recordId, stamp, listBirdId, speciesName, undefined));
    seq += 1;
  }
  return birds;
}

function assignSexToGardenBirds(birds: PlacedBird[], records: BirdRecord[]): PlacedBird[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const sexByBirdId = new Map<string, BirdSex>();

  for (const record of records) {
    if (!speciesUsesSexSplit(record.listBirdId)) {
      continue;
    }
    const recordBirds = birds.filter((bird) => bird.recordId === record.id);
    let maleLeft = record.maleCount ?? Math.max(0, record.count - (record.femaleCount ?? 0));
    let femaleLeft = record.femaleCount ?? 0;

    for (const bird of recordBirds) {
      if (bird.sex === "male") {
        maleLeft = Math.max(0, maleLeft - 1);
      } else if (bird.sex === "female") {
        femaleLeft = Math.max(0, femaleLeft - 1);
      }
    }

    for (const bird of recordBirds) {
      if (bird.sex) {
        continue;
      }
      if (maleLeft > 0) {
        sexByBirdId.set(bird.id, "male");
        maleLeft -= 1;
      } else if (femaleLeft > 0) {
        sexByBirdId.set(bird.id, "female");
        femaleLeft -= 1;
      } else {
        sexByBirdId.set(bird.id, "male");
      }
    }
  }

  if (sexByBirdId.size === 0) {
    return birds;
  }

  return birds.map((bird) => {
    const sex = sexByBirdId.get(bird.id);
    return sex ? { ...bird, sex } : bird;
  });
}

/** 저장된 좌표가 하늘 쪽(구버전)이면 연못·잔디 구역으로 보정 */
export function normalizePlacedBird(
  bird: PlacedBird,
  options?: { forceLand?: boolean; forceNearWater?: boolean; record?: BirdRecord }
): PlacedBird {
  const forceLand = options?.forceLand ?? false;
  const forceNearWater = options?.forceNearWater ?? false;
  const sizeScale = getSpeciesSizeScaleForRecord(options?.record);

  if (forceNearWater) {
    return clampNearWaterBird(bird, sizeScale);
  }

  const wantsWater = bird.inWater === true;
  let yPercent = bird.yPercent;

  if (isSkyY(yPercent) || isLandPlacementZoneY(yPercent)) {
    if (wantsWater) {
      yPercent = clamp(WATER_Y_MIN + (bird.xPercent % 10), WATER_Y_MIN, WATER_Y_MAX);
    } else {
      yPercent = clamp(SHORE_Y_MIN + (bird.xPercent % 8), SHORE_Y_MIN, SHORE_Y_MAX);
    }
  } else if (wantsWater) {
    yPercent = clamp(yPercent, WATER_Y_MIN, WATER_Y_MAX);
  } else {
    yPercent = clamp(yPercent, SHORE_Y_MIN, SHORE_Y_MAX);
  }

  return {
    ...bird,
    yPercent,
    inWater: wantsWater,
    size: getBirdDisplaySize({ yPercent }, sizeScale),
  };
}

function isLikelyFloatingLandBird(bird: PlacedBird): boolean {
  if (bird.inWater === true) {
    return false;
  }
  if (bird.yPercent >= LAND_GROUND_Y_MIN) {
    return false;
  }
  if (isLandTreePlacement(bird)) {
    return false;
  }
  return bird.yPercent <= SKY_Y_MAX || (bird.xPercent >= 20 && bird.yPercent < LAND_GROUND_Y_MIN);
}

export function normalizePlacedBirds(birds: PlacedBird[], records: BirdRecord[] = []): PlacedBird[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  let landSlotIndex = 0;
  const normalized = birds.map((bird) => {
    const record = bird.recordId ? recordById.get(bird.recordId) : undefined;
    const forceLand = recordMustStayOnLand(record) || isLikelyFloatingLandBird(bird);
    if (forceLand) {
      const snapped = snapLandBirdToSlot(bird, landSlotIndex, getSpeciesSizeScaleForRecord(record));
      landSlotIndex += 1;
      return snapped;
    }
    return normalizePlacedBird(bird, {
      forceLand: false,
      forceNearWater: recordMustStayNearWater(record),
      record,
    });
  });
  return assignSexToGardenBirds(normalized, records);
}
