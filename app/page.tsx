"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

function MenuIconCalendar() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <rect x="6" y="8" width="24" height="22" rx="3" fill="#fff" stroke="#c4c4c4" strokeWidth="1" />
      <rect x="6" y="8" width="24" height="7" rx="3" fill="#e85c4a" />
      <path d="M10 6v4M18 6v4M26 6v4" stroke="#8a8a8a" strokeWidth="1.5" strokeLinecap="round" />
      <polygon points="22,16 24,20 20,20" fill="#f4c430" />
    </svg>
  );
}

function MenuIconBook() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <rect x="8" y="7" width="20" height="24" rx="2" fill="#5cb85c" stroke="#3d8f3d" strokeWidth="1" />
      <ellipse cx="18" cy="16" rx="6" ry="4" fill="#e8f5e9" />
      <path d="M14 20 Q18 23 22 20" stroke="#2e7d32" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function MenuIconMedal() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="15" r="9" fill="#c4956a" stroke="#8d6b47" strokeWidth="1" />
      <rect x="17.2" y="11" width="1.6" height="7" rx="0.3" fill="#5c3d24" />
      <path d="M12 24 L10 30 M24 24 L26 30" stroke="#8d6b47" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MenuIconMap() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <path d="M8 10 L16 8 L28 11 L28 26 L16 23 L8 26 Z" fill="#f5e6c8" stroke="#a08060" strokeWidth="1" />
      <circle cx="20" cy="16" r="3" fill="none" stroke="#c62828" strokeWidth="1.2" />
      <path d="M20 13 L20 10 M22 17 L25 18" stroke="#c62828" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

const MENU_ITEMS = [
  { label: "캘린더", Icon: MenuIconCalendar },
  { label: "도감", Icon: MenuIconBook },
  { label: "랭킹", Icon: MenuIconMedal },
  { label: "지도", Icon: MenuIconMap },
] as const;

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  return (
    <main className="garden-page">
      <div className="app-shell">
        <header className="app-header">
          <p className="app-title">버디 가든</p>
          <p className="app-subtitle">오늘 만난 새로 채워가는 정원</p>
        </header>

        <div
          className={`side-drawer-wrap ${isMenuOpen ? "is-open" : "is-closed"}`}
          role="presentation"
        >
          <nav
            id="garden-side-menu"
            className="side-drawer-panel"
            aria-label="주요 메뉴"
            aria-hidden={!isMenuOpen}
          >
            {MENU_ITEMS.map(({ label, Icon }) => (
              <button
                key={label}
                type="button"
                className="side-drawer-item"
                tabIndex={isMenuOpen ? 0 : -1}
              >
                <span className="side-drawer-item-icon" aria-hidden>
                  <Icon />
                </span>
                <span className="side-drawer-item-label">{label}</span>
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="side-drawer-tab"
            onClick={() => setIsMenuOpen((v) => !v)}
            aria-expanded={isMenuOpen}
            aria-controls="garden-side-menu"
            id="garden-menu-toggle"
          >
            <span
              className={`side-drawer-tab-arrow ${isMenuOpen ? "points-left" : "points-right"}`}
              aria-hidden
            />
            <span className="sr-only">{isMenuOpen ? "메뉴 닫기" : "메뉴 열기"}</span>
          </button>
        </div>

        <section className="garden-scroll" ref={scrollRef} aria-label="나만의 정원">
          <div className="garden-world">
            <Image
              src="/garden-panorama.png"
              alt="하늘과 연못, 나무가 있는 정원 일러스트"
              fill
              priority
              sizes="240vw"
              className="garden-world-image"
            />
          </div>
        </section>

        <footer className="app-footer">
          <button
            type="button"
            className="add-bird-button"
            disabled
            aria-label="오늘의 새 추가하기 (준비 중)"
          >
            + 오늘의 새 추가하기
          </button>
        </footer>
      </div>
    </main>
  );
}
