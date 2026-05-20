import type { PlacedBird } from "@/lib/supabase/garden";

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

/** 까치 전용 (나무·언덕 위 고정 — 연못 구역과 겹치지 않는 우측 육지 위주) */
const MAGPIE_SLOTS: Slot[] = [
  { xPercent: 64, yPercent: 60 },
  { xPercent: 72, yPercent: 58 },
  { xPercent: 79, yPercent: 56 },
  { xPercent: 86, yPercent: 60 },
  { xPercent: 90, yPercent: 64 },
  { xPercent: 94, yPercent: 67 },
];

/** 잔디(물 밖)인데 y가 이 구간이면 “위쪽 자리”로 보고 연안으로 끌어내리지 않음 (까치 등) */
const UPPER_SHORE_Y_MIN = 52;
const UPPER_SHORE_Y_MAX = 70;

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

export function createGardenBirds(
  count: number,
  offset: number,
  recordId: string,
  options?: { listBirdId?: string | null }
): PlacedBird[] {
  const stamp = Date.now();
  const isMagpie = options?.listBirdId === "magpie";
  return Array.from({ length: count }, (_, idx) => {
    const seq = offset + idx;
    const onShore = isMagpie ? true : Math.random() < 0.22;
    const pool = isMagpie ? MAGPIE_SLOTS : onShore ? SHORE_SLOTS : WATER_SLOTS;
    const base = pool[seq % pool.length];
    const ring = Math.floor(seq / pool.length);
    const xJitter = (ring % 2 === 0 ? 1 : -1) * Math.min(isMagpie ? 2 : 3, ring + 1);
    const yJitter = ((seq + ring) % 3) - 1;

    const yPercent = isMagpie
      ? clamp(base.yPercent + yJitter * 0.45, UPPER_SHORE_Y_MIN, UPPER_SHORE_Y_MAX)
      : onShore
        ? clamp(base.yPercent + yJitter * 0.35, 71, 79)
        : clamp(base.yPercent + yJitter * 0.35, 80, 93);

    return {
      id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      xPercent: clamp(base.xPercent + xJitter, isMagpie ? 6 : 8, 94),
      yPercent,
      size: getBirdDisplaySize({ yPercent }),
      facing: pickFacing(),
      inWater: isMagpie ? false : !onShore,
    };
  });
}

/** 저장된 좌표가 하늘 쪽(구버전)이면 연못·잔디 구역으로 보정 */
export function normalizePlacedBird(bird: PlacedBird): PlacedBird {
  const wantsWater = bird.inWater !== false;
  let yPercent = bird.yPercent;

  if (yPercent < 71) {
    if (wantsWater) {
      yPercent = 84 + (bird.xPercent % 5);
    } else if (yPercent >= UPPER_SHORE_Y_MIN) {
      /** 물 밖 + 위쪽 자리는 그대로 (까치 배치). 그보다 위만 옛날 “하늘” 오리 연안으로 보정 */
      yPercent = clamp(yPercent, UPPER_SHORE_Y_MIN, UPPER_SHORE_Y_MAX);
    } else {
      yPercent = 75;
    }
  } else if (wantsWater) {
    yPercent = clamp(yPercent, 80, 93);
  } else {
    yPercent = clamp(yPercent, 71, 79);
  }

  return {
    ...bird,
    yPercent,
    inWater: wantsWater,
    size: getBirdDisplaySize({ yPercent }),
  };
}

export function normalizePlacedBirds(birds: PlacedBird[]): PlacedBird[] {
  return birds.map(normalizePlacedBird);
}
