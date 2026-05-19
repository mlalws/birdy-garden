import type { PlacedBird } from "@/lib/supabase/garden";

export type BirdFacing = "left" | "right";

type Slot = Pick<PlacedBird, "xPercent" | "yPercent">;

/** 호숫가·잔디 (멀리 — 위쪽) */
const SHORE_SLOTS: Slot[] = [
  { xPercent: 14, yPercent: 63 },
  { xPercent: 26, yPercent: 60 },
  { xPercent: 38, yPercent: 62 },
  { xPercent: 50, yPercent: 59 },
  { xPercent: 62, yPercent: 61 },
  { xPercent: 74, yPercent: 60 },
  { xPercent: 86, yPercent: 63 },
];

/** 호수 안 (가까이 — 아래쪽) */
const WATER_SLOTS: Slot[] = [
  { xPercent: 19, yPercent: 72 },
  { xPercent: 30, yPercent: 75 },
  { xPercent: 41, yPercent: 74 },
  { xPercent: 55, yPercent: 77 },
  { xPercent: 67, yPercent: 73 },
  { xPercent: 78, yPercent: 80 },
  { xPercent: 88, yPercent: 76 },
];

/** 화면 위쪽(멀리)일수록 작게, 아래(가까이)일수록 크게 */
const DEPTH_FAR_Y = 58;
const DEPTH_NEAR_Y = 84;
const SIZE_FAR = 22;
const SIZE_NEAR = 36;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pickFacing = (): BirdFacing => (Math.random() < 0.6 ? "right" : "left");

/** y 위치 기준 원근 크기 (같은 높이대는 거의 동일) */
export function getBirdDisplaySize(bird: Pick<PlacedBird, "yPercent">): number {
  const t = clamp((bird.yPercent - DEPTH_FAR_Y) / (DEPTH_NEAR_Y - DEPTH_FAR_Y), 0, 1);
  return Math.round(SIZE_FAR + t * (SIZE_NEAR - SIZE_FAR));
}

export function createGardenBirds(count: number, offset: number, recordId: string): PlacedBird[] {
  const stamp = Date.now();
  return Array.from({ length: count }, (_, idx) => {
    const seq = offset + idx;
    const onShore = Math.random() < 0.4;
    const pool = onShore ? SHORE_SLOTS : WATER_SLOTS;
    const base = pool[seq % pool.length];
    const ring = Math.floor(seq / pool.length);
    const xJitter = (ring % 2 === 0 ? 1 : -1) * Math.min(3, ring + 1);
    const yJitter = ((seq + ring) % 3) - 1;

    const yPercent = onShore
      ? clamp(base.yPercent + yJitter * 0.35, 56, 68)
      : clamp(base.yPercent + yJitter * 0.35, 70, 86);

    return {
      id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      xPercent: clamp(base.xPercent + xJitter, 8, 92),
      yPercent,
      size: getBirdDisplaySize({ yPercent }),
      facing: pickFacing(),
      inWater: !onShore,
    };
  });
}
