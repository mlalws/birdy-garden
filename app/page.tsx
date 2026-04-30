"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type PlacedBird = {
  id: string;
  xPercent: number;
  yPercent: number;
  size: number;
};

type MenuItem = {
  label: string;
  icon: string;
};

const DECORATION_BIRDS: PlacedBird[] = [
  { id: "t1", xPercent: 62, yPercent: 24, size: 20 },
  { id: "t2", xPercent: 71, yPercent: 22, size: 18 },
  { id: "t3", xPercent: 56, yPercent: 30, size: 22 },
  { id: "t4", xPercent: 67, yPercent: 35, size: 20 },
  { id: "l1", xPercent: 33, yPercent: 74, size: 24 },
  { id: "l2", xPercent: 21, yPercent: 78, size: 24 },
  { id: "l3", xPercent: 44, yPercent: 76, size: 29 },
  { id: "g1", xPercent: 81, yPercent: 70, size: 18 },
  { id: "g2", xPercent: 87, yPercent: 82, size: 19 },
];

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuItems = useMemo<MenuItem[]>(
    () => [
      { label: "캘린더", icon: "📅" },
      { label: "도감", icon: "🪶" },
      { label: "랭킹", icon: "🏅" },
      { label: "지도", icon: "🧭" },
    ],
    []
  );

  useEffect(() => {
    const scrollElement = scrollRef.current;

    if (!scrollElement) {
      return;
    }

    // 처음 진입 시 나무/호수가 있는 중앙 영역이 보이도록 시작 위치를 설정합니다.
    scrollElement.scrollLeft = (scrollElement.scrollWidth - scrollElement.clientWidth) / 2;
  }, []);

  return (
    <main className="garden-page">
      <section className="phone-frame">
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

        <div className="garden-scroll" ref={scrollRef}>
          <div className="garden-world">
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
                  width: `${bird.size}px`,
                  height: `${bird.size}px`,
                }}
              >
                <Image src="/test.png" alt="청둥오리" fill sizes="32px" />
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
