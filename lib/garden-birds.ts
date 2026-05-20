import {
  getListedSpeciesByName,
  isLandSpecies,
  recordMustStayNearWater,
  recordMustStayOnLand,
  shoreProbabilityForSpecies,
} from "@/lib/species-catalog";
import type { BirdRecord, PlacedBird } from "@/lib/supabase/garden";

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

/** 육지·나무 쪽 (까치·참새·까마귀 등) */
const LAND_SLOTS: Slot[] = [
  { xPercent: 11, yPercent: 62 },
  { xPercent: 20, yPercent: 58 },
  { xPercent: 32, yPercent: 64 },
  { xPercent: 64, yPercent: 60 },
  { xPercent: 72, yPercent: 58 },
  { xPercent: 79, yPercent: 56 },
  { xPercent: 86, yPercent: 60 },
  { xPercent: 90, yPercent: 64 },
  { xPercent: 94, yPercent: 67 },
];

/** 잔디(물 밖) — 까치·참새·까마귀 전용 */
const UPPER_SHORE_Y_MIN = 52;
const UPPER_SHORE_Y_MAX = 70;

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

/** y 위치 기준 원근 크기 (같은 높이대는 거의 동일) */
export function getBirdDisplaySize(bird: Pick<PlacedBird, "yPercent">): number {
  const t = clamp((bird.yPercent - DEPTH_FAR_Y) / (DEPTH_NEAR_Y - DEPTH_FAR_Y), 0, 1);
  return Math.round(SIZE_FAR + t * (SIZE_NEAR - SIZE_FAR));
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

function clampLandYPercent(bird: Pick<PlacedBird, "xPercent" | "yPercent">): number {
  if (bird.yPercent >= UPPER_SHORE_Y_MIN && bird.yPercent <= UPPER_SHORE_Y_MAX) {
    return bird.yPercent;
  }
  const slot = LAND_SLOTS[Math.floor(bird.xPercent) % LAND_SLOTS.length];
  return clamp(slot.yPercent, UPPER_SHORE_Y_MIN, UPPER_SHORE_Y_MAX);
}

function clampNearWaterBird(bird: PlacedBird): PlacedBird {
  const preferWater = Math.floor(bird.xPercent) % 3 !== 0;
  let yPercent = bird.yPercent;
  let inWater = bird.inWater === true;

  const onGrass = yPercent < SHORE_Y_MIN || (yPercent >= UPPER_SHORE_Y_MIN && yPercent <= UPPER_SHORE_Y_MAX);

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
    size: getBirdDisplaySize({ yPercent }),
  };
}

export function createGardenBirds(
  count: number,
  offset: number,
  recordId: string,
  options?: { listBirdId?: string | null; speciesName?: string | null }
): PlacedBird[] {
  const stamp = Date.now();
  const listBirdId = options?.listBirdId ?? null;
  const speciesName = options?.speciesName ?? null;
  const onLand = resolveOnLandPlacement(listBirdId, speciesName);
  const speciesIdForShore = listBirdId ?? getListedSpeciesByName(speciesName ?? "")?.id ?? null;
  const onShore = onLand ? false : Math.random() < shoreProbabilityForSpecies(speciesIdForShore);
  const pool = onLand ? LAND_SLOTS : onShore ? SHORE_SLOTS : WATER_SLOTS;
  const useUpperShoreBand = onLand;

  return Array.from({ length: count }, (_, idx) => {
    const seq = offset + idx;
    const base = pool[seq % pool.length];
    const ring = Math.floor(seq / pool.length);
    const xJitter = (ring % 2 === 0 ? 1 : -1) * Math.min(onLand ? 2 : 3, ring + 1);
    const yJitter = ((seq + ring) % 3) - 1;

    const yPercent = useUpperShoreBand
      ? clamp(base.yPercent + yJitter * 0.45, UPPER_SHORE_Y_MIN, UPPER_SHORE_Y_MAX)
      : onShore
        ? clamp(base.yPercent + yJitter * 0.35, SHORE_Y_MIN, SHORE_Y_MAX)
        : clamp(base.yPercent + yJitter * 0.35, WATER_Y_MIN, WATER_Y_MAX);

    return {
      id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      xPercent: clamp(base.xPercent + xJitter, onLand ? 6 : 8, 94),
      yPercent,
      size: getBirdDisplaySize({ yPercent }),
      facing: pickFacing(),
      inWater: onLand ? false : !onShore,
    };
  });
}

/** 저장된 좌표가 하늘 쪽(구버전)이면 연못·잔디 구역으로 보정 */
export function normalizePlacedBird(
  bird: PlacedBird,
  options?: { forceLand?: boolean; forceNearWater?: boolean }
): PlacedBird {
  const forceLand = options?.forceLand ?? false;
  const forceNearWater = options?.forceNearWater ?? false;

  if (forceLand) {
    const yPercent = clampLandYPercent(bird);
    return {
      ...bird,
      yPercent,
      inWater: false,
      size: getBirdDisplaySize({ yPercent }),
    };
  }

  if (forceNearWater) {
    return clampNearWaterBird(bird);
  }

  const wantsWater = bird.inWater === true;
  let yPercent = bird.yPercent;

  if (yPercent < SHORE_Y_MIN) {
    if (wantsWater) {
      yPercent = clamp(WATER_Y_MIN + (bird.xPercent % 10), WATER_Y_MIN, WATER_Y_MAX);
    } else if (yPercent >= UPPER_SHORE_Y_MIN) {
      yPercent = clamp(yPercent, UPPER_SHORE_Y_MIN, UPPER_SHORE_Y_MAX);
    } else {
      yPercent = SHORE_Y_MIN + (bird.xPercent % 6);
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
    size: getBirdDisplaySize({ yPercent }),
  };
}

export function normalizePlacedBirds(birds: PlacedBird[], records: BirdRecord[] = []): PlacedBird[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  return birds.map((bird) => {
    const record = bird.recordId ? recordById.get(bird.recordId) : undefined;
    return normalizePlacedBird(bird, {
      forceLand: recordMustStayOnLand(record),
      forceNearWater: recordMustStayNearWater(record),
    });
  });
}
