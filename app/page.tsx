"use client";

import { useMemo, useState } from "react";

type PlacedBird = {
  id: string;
  xPercent: number;
  yPercent: number;
  size: number;
  emoji: string;
};

type MenuItem = {
  label: string;
  icon: string;
};

const DECORATION_BIRDS: PlacedBird[] = [
  { id: "t1", xPercent: 62, yPercent: 24, size: 20, emoji: "🐦" },
  { id: "t2", xPercent: 71, yPercent: 22, size: 18, emoji: "🐦" },
  { id: "t3", xPercent: 56, yPercent: 30, size: 22, emoji: "🐦" },
  { id: "t4", xPercent: 67, yPercent: 35, size: 20, emoji: "🐦" },
  { id: "l1", xPercent: 33, yPercent: 74, size: 24, emoji: "🦆" },
  { id: "l2", xPercent: 21, yPercent: 78, size: 24, emoji: "🦆" },
  { id: "l3", xPercent: 44, yPercent: 76, size: 29, emoji: "🪽" },
  { id: "g1", xPercent: 81, yPercent: 70, size: 18, emoji: "🐦" },
  { id: "g2", xPercent: 87, yPercent: 82, size: 19, emoji: "🐦" },
];

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const menuItems = useMemo<MenuItem[]>(
    () => [
      { label: "캘린더", icon: "📅" },
      { label: "도감", icon: "🪶" },
      { label: "랭킹", icon: "🏅" },
      { label: "지도", icon: "🧭" },
    ],
    []
  );

  return (
    <main className="garden-page">
      <section className="phone-frame">
        <div className="garden-scroll">
          <div className="garden-world">
            <button
              type="button"
              className={`menu-drawer ${isMenuOpen ? "open" : "closed"}`}
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-label="메뉴 열기 또는 닫기"
            >
              <div className="menu-panel">
                {menuItems.map((item) => (
                  <span key={item.label} className="menu-item">
                    <span className="menu-item-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </span>
                ))}
              </div>
              <div className="menu-handle">
                <span className="menu-arrow">{isMenuOpen ? "◀" : "▶"}</span>
              </div>
            </button>

            <div className="tree" aria-hidden />
            <div className="lake" aria-hidden />
            <div className="hill" aria-hidden />
            <div className="cloud cloud-a" aria-hidden />
            <div className="cloud cloud-b" aria-hidden />

            {DECORATION_BIRDS.map((bird) => (
              <span
                key={bird.id}
                className="bird"
                style={{
                  left: `${bird.xPercent}%`,
                  top: `${bird.yPercent}%`,
                  fontSize: `${bird.size}px`,
                }}
              >
                {bird.emoji}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="add-bird-button"
          onClick={() => setIsAddSheetOpen(true)}
        >
          + 오늘의 새 추가하기
        </button>

        {isAddSheetOpen ? (
          <div className="add-sheet-overlay" onClick={() => setIsAddSheetOpen(false)}>
            <section
              className="add-sheet"
              onClick={(event) => event.stopPropagation()}
              aria-label="새 추가 메뉴"
            >
              <button
                type="button"
                className="add-sheet-close"
                onClick={() => setIsAddSheetOpen(false)}
                aria-label="닫기"
              >
                ✕
              </button>
              <h2 className="add-sheet-title">오늘의 새를 기록해볼까요?</h2>
              <p className="add-sheet-description">
                다음 단계에서 촬영한 사진, 이름, 발견 위치를 입력해 정원에 새를 추가할 수 있어요.
              </p>
              <button type="button" className="add-sheet-action">
                기록 시작하기
              </button>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
