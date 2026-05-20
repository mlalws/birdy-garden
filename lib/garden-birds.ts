import {
  getListedSpeciesByName,
  getSpeciesSizeScale,
  getSpeciesSizeScaleForRecord,
  isLandSpecies,
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

/** 육지·잔디 (까치·참새·까마귀) — 연못 물가 위쪽, 하늘(y 71 미만) 제외 */
const LAND_SLOTS: Slot[] = [
  { xPercent: 11, yPercent: 72 },
  { xPercent: 20, yPercent: 71 },
  { xPercent: 32, yPercent: 74 },
  { xPercent: 64, yPercent: 73 },
  { xPercent: 72, yPercent: 71 },
  { xPercent: 79, yPercent: 75 },
  { xPercent: 86, yPercent: 72 },
  { xPercent: 90, yPercent: 74 },
  { xPercent: 94, yPercent: 73 },
];

/** y가 이보다 작으면 하늘 쪽 — 배치 금지 */
const SKY_Y_MAX = 70;

/** 연못 물가 */
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

function clampLandYPercent(bird: Pick<PlacedBird, "xPercent" | "yPercent">): number {
  if (!isSkyY(bird.yPercent) && bird.yPercent >= SHORE_Y_MIN && bird.yPercent <= SHORE_Y_MAX) {
    return bird.yPercent;
  }
  const slot = LAND_SLOTS[Math.floor(bird.xPercent) % LAND_SLOTS.length];
  return clamp(slot.yPercent, SHORE_Y_MIN, SHORE_Y_MAX);
}

function clampNearWaterBird(bird: PlacedBird, sizeScale = 1): PlacedBird {
  const preferWater = Math.floor(bird.xPercent) % 3 !== 0;
  let yPercent = bird.yPercent;
  let inWater = bird.inWater === true;

  const onGrass = isSkyY(yPercent);

  if (onGrass) {
    if (preferWater) {
      yPercent = clamp(WATER_Y_MIN + (bird.xPercent % 10), WATER_Y_MIN, WATER_Y_MAX);
      inWater = true;
    } else {
      yPercent = clamp(SHORE_Y_MIN + (bird.xPercent % 8), SHORE_Y_MIN, SHORE_Y_MAX);
      inWater = false;
    }
  } else if (yPercent >= WATER_Y_MIN) {
    yPercent = clamp(yPercent, WATER_Y_MIN, WATER_Y_MAX);
    inWater = true;
  } else {
    yPercent = clamp(yPercent, SHORE_Y_MIN, SHORE_Y_MAX);
    inWater = false;
  }

  return {
    ...bird,
    yPercent,
    inWater,
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
  const onShore = onLand ? false : Math.random() < shoreProbabilityForSpecies(speciesIdForShore);
  const pool = onLand ? LAND_SLOTS : onShore ? SHORE_SLOTS : WATER_SLOTS;
  const base = pool[seq % pool.length];
  const ring = Math.floor(seq / pool.length);
  const xJitter = (ring % 2 === 0 ? 1 : -1) * Math.min(onLand ? 2 : 3, ring + 1);
  const yJitter = ((seq + ring) % 3) - 1;

  const yPercent = onLand
    ? clamp(base.yPercent + yJitter * 0.35, SHORE_Y_MIN, SHORE_Y_MAX)
    : onShore
      ? clamp(base.yPercent + yJitter * 0.35, SHORE_Y_MIN, SHORE_Y_MAX)
      : clamp(base.yPercent + yJitter * 0.35, WATER_Y_MIN, WATER_Y_MAX);

  return {
    id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
    recordId,
    xPercent: clamp(base.xPercent + xJitter, onLand ? 6 : 8, 94),
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

  if (forceLand) {
    const yPercent = clampLandYPercent(bird);
    return {
      ...bird,
      yPercent,
      inWater: false,
      size: getBirdDisplaySize({ yPercent }, sizeScale),
    };
  }

  if (forceNearWater) {
    return clampNearWaterBird(bird, sizeScale);
  }

  const wantsWater = bird.inWater === true;
  let yPercent = bird.yPercent;

  if (isSkyY(yPercent)) {
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

export function normalizePlacedBirds(birds: PlacedBird[], records: BirdRecord[] = []): PlacedBird[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const normalized = birds.map((bird) => {
    const record = bird.recordId ? recordById.get(bird.recordId) : undefined;
    return normalizePlacedBird(bird, {
      forceLand: recordMustStayOnLand(record),
      forceNearWater: recordMustStayNearWater(record),
      record,
    });
  });
  return assignSexToGardenBirds(normalized, records);
}
