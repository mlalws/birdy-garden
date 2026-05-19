import type { PlacedBird } from "@/lib/supabase/garden";

export type BirdFacing = "left" | "right";

type Slot = Pick<PlacedBird, "xPercent" | "yPercent" | "size">;

/** 호숫가·잔디 (다리 보임) */
const SHORE_SLOTS: Slot[] = [
  { xPercent: 14, yPercent: 63, size: 22 },
  { xPercent: 26, yPercent: 60, size: 24 },
  { xPercent: 38, yPercent: 62, size: 23 },
  { xPercent: 50, yPercent: 59, size: 25 },
  { xPercent: 62, yPercent: 61, size: 24 },
  { xPercent: 74, yPercent: 60, size: 22 },
  { xPercent: 86, yPercent: 63, size: 23 },
];

/** 호수 안 (다리 클리핑) */
const WATER_SLOTS: Slot[] = [
  { xPercent: 19, yPercent: 72, size: 24 },
  { xPercent: 30, yPercent: 78, size: 22 },
  { xPercent: 41, yPercent: 74, size: 26 },
  { xPercent: 55, yPercent: 80, size: 24 },
  { xPercent: 67, yPercent: 73, size: 23 },
  { xPercent: 78, yPercent: 82, size: 21 },
  { xPercent: 88, yPercent: 76, size: 22 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pickFacing = (): BirdFacing => (Math.random() < 0.6 ? "right" : "left");

export function createGardenBirds(count: number, offset: number, recordId: string): PlacedBird[] {
  const stamp = Date.now();
  return Array.from({ length: count }, (_, idx) => {
    const seq = offset + idx;
    const onShore = Math.random() < 0.4;
    const pool = onShore ? SHORE_SLOTS : WATER_SLOTS;
    const base = pool[seq % pool.length];
    const ring = Math.floor(seq / pool.length);
    const jitter = (ring % 2 === 0 ? 1 : -1) * Math.min(4, ring + 1);

    return {
      id: `garden-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      xPercent: clamp(base.xPercent + jitter, 8, 92),
      yPercent: onShore
        ? clamp(base.yPercent + (ring % 2), 56, 68)
        : clamp(base.yPercent + (ring % 3) - 1, 70, 88),
      size: clamp(base.size + (ring % 2), 20, 30),
      facing: pickFacing(),
      inWater: !onShore,
    };
  });
}
