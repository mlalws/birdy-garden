"use client";

import Image from "next/image";
import type { BirdRecord, PlacedBird } from "@/lib/supabase/garden";

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
  const recordById = new Map(records.map((record) => [record.id, record]));
  const selectedBird = birds.find((bird) => bird.id === selectedBirdId) ?? null;
  const selectedRecord = selectedBird?.recordId ? recordById.get(selectedBird.recordId) : undefined;

  return (
    <div className={`garden-world${className ? ` ${className}` : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/background.jpg" alt="" className="garden-world-bg" draggable={false} />
      <div className="garden-world-birds" aria-hidden={birds.length === 0}>
      {birds.map((bird) => {
        const isBubbleOpen = !readOnly && selectedBird?.id === bird.id;
        const bubbleSize = Math.round(bird.size * 1.8);

        return (
          <div
            key={bird.id}
            className={`bird-anchor${isBubbleOpen ? " bird-anchor--open" : ""}`}
            style={{ left: `${bird.xPercent}%`, top: `${bird.yPercent}%` }}
          >
            {readOnly ? (
              <div
                className={`bird bird--static${bird.inWater !== false ? " bird--in-water" : " bird--on-shore"}${bird.facing === "left" ? " bird--facing-left" : " bird--facing-right"}`}
                style={{ width: `${bird.size}px`, height: `${bird.size}px` }}
                aria-hidden
              >
                <span className="bird-sprite">
                  <Image src="/test.png" alt="" fill sizes="64px" className="bird-sprite-img" />
                </span>
              </div>
            ) : (
              <button
                type="button"
                className={`bird${bird.inWater !== false ? " bird--in-water" : " bird--on-shore"}${bird.facing === "left" ? " bird--facing-left" : " bird--facing-right"}${isBubbleOpen ? " bird--selected" : ""}`}
                style={{ width: `${bird.size}px`, height: `${bird.size}px` }}
                onClick={() => onBirdClick?.(bird.id)}
                aria-label="정원에 둔 조류 보기"
                aria-expanded={isBubbleOpen}
              >
                <span className="bird-sprite">
                  <Image src="/test.png" alt="" fill sizes="64px" className="bird-sprite-img" />
                </span>
              </button>
            )}

            {isBubbleOpen ? (
              <div
                className="bird-speech-bubble"
                role="dialog"
                aria-label="조류 상세"
                style={{ width: `${bubbleSize}px`, minHeight: `${Math.round(bubbleSize * 0.85)}px` }}
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
