"use client";

import Image from "next/image";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getBirdDisplaySize, isLandBirdPlacement, isLandTreePlacement } from "@/lib/garden-birds";
import {
  getSpeciesSizeScaleForRecord,
  getSpriteSrcForPlacedBird,
  recordMustStayOnLand,
  resolveBirdInWater,
} from "@/lib/species-catalog";
import type { BirdRecord, PlacedBird } from "@/lib/supabase/garden";

const BACKGROUND_SRC = "/background.jpg";

type BgLayout = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

const FULL_BG_LAYOUT: BgLayout = { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 };
const DEFAULT_SPRITE = "/duck.png";

function BirdSpriteImage({ src, className }: { src: string; className: string }) {
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={className} draggable={false} />
    );
  }
  return <Image src={src} alt="" fill sizes="64px" className={className} />;
}

/** object-fit: contain + left center 기준 실제 그려진 배경 영역 */
function computeContainedImageLayout(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): BgLayout {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return FULL_BG_LAYOUT;
  }

  const imageAspect = imageW / imageH;
  const containerAspect = containerW / containerH;
  let renderW: number;
  let renderH: number;
  let offsetX = 0;
  let offsetY = 0;

  if (containerAspect > imageAspect) {
    renderH = containerH;
    renderW = containerH * imageAspect;
    offsetX = 0;
    offsetY = 0;
  } else {
    renderW = containerW;
    renderH = containerW / imageAspect;
    offsetX = 0;
    offsetY = (containerH - renderH) / 2;
  }

  return {
    leftPct: (offsetX / containerW) * 100,
    topPct: (offsetY / containerH) * 100,
    widthPct: (renderW / containerW) * 100,
    heightPct: (renderH / containerH) * 100,
  };
}

function mapBirdAnchorPosition(bird: PlacedBird, layout: BgLayout): { left: string; top: string } {
  const left = layout.leftPct + (bird.xPercent / 100) * layout.widthPct;
  const top = layout.topPct + (bird.yPercent / 100) * layout.heightPct;
  return { left: `${left}%`, top: `${top}%` };
}

type GardenWorldViewProps = {
  birds: PlacedBird[];
  records?: BirdRecord[];
  readOnly?: boolean;
  selectedBirdId?: string | null;
  deleteConfirm?: boolean;
  onBirdClick?: (birdId: string) => void;
  onRequestDelete?: () => void;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
  className?: string;
};

export function GardenWorldView({
  birds,
  records = [],
  readOnly = false,
  selectedBirdId = null,
  deleteConfirm = false,
  onBirdClick,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  className = "",
}: GardenWorldViewProps) {
  const worldRef = useRef<HTMLDivElement>(null);
  const bgImgRef = useRef<HTMLImageElement>(null);
  const [worldSize, setWorldSize] = useState<{ width: number; height: number } | null>(null);
  const [bgLayout, setBgLayout] = useState<BgLayout>(FULL_BG_LAYOUT);
  const isMini = className.includes("garden-world--mini");

  const measureBgLayout = useCallback(() => {
    if (isMini) {
      setBgLayout(FULL_BG_LAYOUT);
      return;
    }
    const world = worldRef.current;
    const img = bgImgRef.current;
    if (!world || !img?.naturalWidth) {
      return;
    }
    setBgLayout(
      computeContainedImageLayout(world.clientWidth, world.clientHeight, img.naturalWidth, img.naturalHeight)
    );
  }, [isMini]);

  useLayoutEffect(() => {
    if (isMini) {
      return;
    }

    const scrollEl = worldRef.current?.closest(
      ".garden-scroll, .bird-archive-garden-scroll, .bird-calendar-preview"
    ) as HTMLElement | null;
    if (!scrollEl) {
      return;
    }

    let cancelled = false;

    const updateSize = () => {
      const viewH = scrollEl.clientHeight;
      const viewW = scrollEl.clientWidth;
      if (viewH <= 0 || viewW <= 0) {
        return;
      }

      const img = new window.Image();
      img.src = BACKGROUND_SRC;
      img.onload = () => {
        if (cancelled) {
          return;
        }
        const aspect = img.naturalWidth / img.naturalHeight;
        const widthAtFullHeight = viewH * aspect;
        const nextWidth = Math.ceil(Math.max(viewW, widthAtFullHeight));
        setWorldSize({ width: nextWidth, height: viewH });
        requestAnimationFrame(measureBgLayout);
      };
    };

    updateSize();
    const observer = new ResizeObserver(() => {
      updateSize();
      measureBgLayout();
    });
    observer.observe(scrollEl);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [isMini, measureBgLayout]);

  const recordById = new Map(records.map((record) => [record.id, record]));
  const selectedBird = birds.find((bird) => bird.id === selectedBirdId) ?? null;
  const selectedRecord = selectedBird?.recordId ? recordById.get(selectedBird.recordId) : undefined;
  const birdSizeScale = isMini ? 0.3 : 1;

  const worldStyle = isMini
    ? { width: "100%", height: "100%" }
    : worldSize !== null
      ? { width: worldSize.width, height: worldSize.height }
      : { height: "100%", minWidth: "100%" as const };

  return (
    <div
      ref={worldRef}
      className={`garden-world${className ? ` ${className}` : ""}`}
      style={worldStyle}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={bgImgRef}
        src={BACKGROUND_SRC}
        alt=""
        className="garden-world-bg"
        draggable={false}
        onLoad={measureBgLayout}
      />
      <div className="garden-world-birds" aria-hidden={birds.length === 0}>
        {birds.map((bird) => {
          const isBubbleOpen = !readOnly && selectedBird?.id === bird.id;
          const record = bird.recordId ? recordById.get(bird.recordId) : undefined;
          const inWater = resolveBirdInWater(bird, record);
          const birdSpriteSrc = record ? getSpriteSrcForPlacedBird(bird, record, inWater) : DEFAULT_SPRITE;
          const isMagpie = record?.listBirdId === "magpie" || record?.speciesName === "까치";
          const birdSpriteClassName = `bird-sprite-img${isMagpie ? " bird-sprite-img--magpie" : ""}`;
          const displaySize = Math.round(
            getBirdDisplaySize(bird, getSpeciesSizeScaleForRecord(record)) * birdSizeScale
          );
          const bubbleWidth = Math.min(200, Math.max(152, Math.round(displaySize * 2.6)));
          const anchorPos = mapBirdAnchorPosition(bird, isMini ? FULL_BG_LAYOUT : bgLayout);
          const onLand =
            (record ? recordMustStayOnLand(record) : false) || isLandBirdPlacement(bird);
          const onTree = onLand && isLandTreePlacement(bird);

          return (
            <div
              key={bird.id}
              className={`bird-anchor${onLand ? (onTree ? " bird-anchor--on-tree" : " bird-anchor--on-land") : ""}${isBubbleOpen ? " bird-anchor--open" : ""}`}
              style={anchorPos}
            >
              {readOnly ? (
                <div
                  className={`bird bird--static${inWater ? " bird--in-water" : " bird--on-shore"}${bird.facing === "left" ? " bird--facing-left" : " bird--facing-right"}`}
                  style={{ width: `${displaySize}px`, height: `${displaySize}px` }}
                  aria-hidden
                >
                  <span className="bird-sprite">
                    <BirdSpriteImage src={birdSpriteSrc} className={birdSpriteClassName} />
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className={`bird${inWater ? " bird--in-water" : " bird--on-shore"}${bird.facing === "left" ? " bird--facing-left" : " bird--facing-right"}${isBubbleOpen ? " bird--selected" : ""}`}
                  style={{ width: `${displaySize}px`, height: `${displaySize}px` }}
                  onClick={() => onBirdClick?.(bird.id)}
                  aria-label="정원에 둔 조류 보기"
                  aria-expanded={isBubbleOpen}
                >
                  <span className="bird-sprite">
                    <BirdSpriteImage src={birdSpriteSrc} className={birdSpriteClassName} />
                  </span>
                </button>
              )}

              {isBubbleOpen ? (
                <div
                  className="bird-speech-bubble"
                  role="dialog"
                  aria-label="조류 상세"
                  style={{ width: `${bubbleWidth}px` }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {deleteConfirm ? (
                    <div className="bird-speech-bubble-inner bird-speech-bubble-inner--confirm">
                      <p className="bird-speech-confirm-text">삭제하시겠습니까?</p>
                      <div className="bird-speech-confirm-actions">
                        <button type="button" className="garden-bird-text-btn" onClick={onConfirmDelete}>
                          네
                        </button>
                        <button type="button" className="garden-bird-text-btn" onClick={onCancelDelete}>
                          아니요
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bird-speech-bubble-inner">
                      {selectedRecord?.photoUrl ? (
                        <div className="bird-speech-photo">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={selectedRecord.photoUrl} alt={selectedRecord.name} />
                        </div>
                      ) : null}
                      <button type="button" className="garden-bird-delete-link" onClick={onRequestDelete}>
                        삭제하기
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
