"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

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

type ListBird = {
  id: string;
  name: string;
  isPlaceholder?: boolean;
};

const BIRD_LIST_ITEMS: ListBird[] = [
  { id: "mallard", name: "청둥오리" },
  { id: "ph1", name: "", isPlaceholder: true },
  { id: "ph2", name: "", isPlaceholder: true },
  { id: "ph3", name: "", isPlaceholder: true },
  { id: "ph4", name: "", isPlaceholder: true },
];

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
  const [isBirdListOpen, setIsBirdListOpen] = useState(false);
  const [selectedListBirdId, setSelectedListBirdId] = useState<string | null>(null);
  const [isBirdInfoScreenOpen, setIsBirdInfoScreenOpen] = useState(false);
  const [isPhotoPopupOpen, setIsPhotoPopupOpen] = useState(false);
  const [canOpenPhotoPopup, setCanOpenPhotoPopup] = useState(true);
  const [birdName, setBirdName] = useState("청둥오리");
  const [birdFeature, setBirdFeature] = useState("");
  const [birdCount, setBirdCount] = useState(2);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

    scrollElement.scrollLeft = (scrollElement.scrollWidth - scrollElement.clientWidth) / 2;
  }, []);

  const resetBirdFormDraft = () => {
    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(true);
    setBirdName("청둥오리");
    setBirdFeature("");
    setBirdCount(2);
    setPhotoPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  };

  const backFromBirdFormToList = () => {
    setIsBirdInfoScreenOpen(false);
    resetBirdFormDraft();
    setIsBirdListOpen(true);
    setSelectedListBirdId("mallard");
  };

  const openBirdList = () => {
    setIsBirdListOpen(true);
    setSelectedListBirdId("mallard");
  };

  const closeBirdList = () => {
    setIsBirdListOpen(false);
    setSelectedListBirdId(null);
  };

  const openBirdRegistration = (opts?: { name?: string }) => {
    const nextName = opts?.name !== undefined ? opts.name : "청둥오리";
    setIsBirdListOpen(false);
    setSelectedListBirdId(null);
    setIsBirdInfoScreenOpen(true);
    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(true);
    setBirdName(nextName);
    setBirdFeature("");
    setBirdCount(2);
    setPhotoPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  };

  const goNextFromBirdList = () => {
    const item = BIRD_LIST_ITEMS.find((b) => b.id === selectedListBirdId);
    if (!item || item.isPlaceholder) {
      return;
    }
    openBirdRegistration({ name: item.name });
  };

  const handlePhotoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setPhotoPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });

    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(false);
    event.target.value = "";
  };

  const clearPhotoPreview = () => {
    setPhotoPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(true);
  };

  const togglePhotoPopupFromHit = () => {
    if (photoPreviewUrl) {
      return;
    }
    if (!canOpenPhotoPopup) {
      return;
    }
    setIsPhotoPopupOpen((prev) => !prev);
  };

  const onPhotoHitKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      togglePhotoPopupFromHit();
    }
  };

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
                <span className="menu-item-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="menu-item-label">{item.label}</span>
              </span>
            ))}
          </div>
          <div className="menu-handle" aria-hidden>
            {isMenuOpen ? (
              <span className="menu-arrow menu-arrow--left" />
            ) : (
              <span className="menu-arrow menu-arrow--right" />
            )}
          </div>
        </button>

        <div className="garden-scroll" ref={scrollRef}>
          <div className="garden-world">
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

        <button type="button" className="add-bird-button" onClick={openBirdList}>
          + 오늘의 새 추가하기
        </button>

        {isBirdListOpen ? (
          <div className="bird-list-screen" role="dialog" aria-modal="true" aria-label="조류 목록">
            <header className="bird-list-header">
              <button type="button" className="bird-list-close" onClick={closeBirdList} aria-label="목록 닫기">
                <Image src="/x.png" alt="" width={48} height={48} className="bird-list-close-img" />
              </button>
              <button
                type="button"
                className="bird-list-add-unlisted"
                onClick={() => openBirdRegistration({ name: "" })}
              >
                리스트에 없는 조류 추가
              </button>
            </header>

            <div className="bird-list-scroll">
              {BIRD_LIST_ITEMS.map((item) =>
                item.isPlaceholder ? (
                  <div key={item.id} className="bird-list-card bird-list-card--placeholder" aria-hidden>
                    <div className="bird-list-thumb bird-list-thumb--muted">
                      <span>새 사진</span>
                    </div>
                    <div className="bird-list-text">
                      <span className="bird-list-line bird-list-line--title" />
                      <span className="bird-list-line" />
                      <span className="bird-list-line bird-list-line--short" />
                    </div>
                  </div>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className={`bird-list-card${selectedListBirdId === item.id ? " bird-list-card--selected" : ""}`}
                    onClick={() => {
                      setSelectedListBirdId(item.id);
                      openBirdRegistration({ name: item.name });
                    }}
                  >
                    <div className="bird-list-thumb">
                      <span>새 사진</span>
                    </div>
                    <div className="bird-list-text">
                      <span className="bird-list-name">{item.name}</span>
                      <span className="bird-list-line" />
                      <span className="bird-list-line bird-list-line--short" />
                    </div>
                  </button>
                )
              )}
            </div>

            <footer className="bird-list-footer">
              <button
                type="button"
                className="bird-list-next"
                onClick={goNextFromBirdList}
                disabled={!selectedListBirdId || !!BIRD_LIST_ITEMS.find((b) => b.id === selectedListBirdId)?.isPlaceholder}
              >
                다음으로
              </button>
            </footer>
          </div>
        ) : null}

        {isBirdInfoScreenOpen ? (
          <div className="bird-form-screen" role="dialog" aria-modal="true" aria-label="조류 등록">
            <header className="bird-form-header">
              <button
                type="button"
                className="bird-form-back"
                onClick={backFromBirdFormToList}
                aria-label="조류 목록으로 돌아가기"
              >
                <Image src="/left.png" alt="" width={96} height={96} className="bird-form-back-img" />
              </button>
              <span className="bird-form-header-title">조류 등록</span>
            </header>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={handlePhotoFileChange}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={handlePhotoFileChange}
            />

            <div className="bird-form-scroll">
              <div className="bird-form-card">
                <div className="bird-photo-block">
                  <div className="bird-photo-frame">
                    {isPhotoPopupOpen && !photoPreviewUrl && canOpenPhotoPopup ? (
                      <div className="bird-photo-popup" role="group" aria-label="사진 선택">
                        <button
                          type="button"
                          className="bird-photo-popup-btn"
                          onClick={() => cameraInputRef.current?.click()}
                        >
                          <span className="bird-photo-popup-ico" aria-hidden>
                            📷
                          </span>
                          촬영하기
                        </button>
                        <button
                          type="button"
                          className="bird-photo-popup-btn"
                          onClick={() => galleryInputRef.current?.click()}
                        >
                          <span className="bird-photo-popup-ico" aria-hidden>
                            ☁️
                          </span>
                          사진업로드
                        </button>
                      </div>
                    ) : null}

                    <div
                      className="bird-photo-hit"
                      role="button"
                      tabIndex={0}
                      onClick={togglePhotoPopupFromHit}
                      onKeyDown={onPhotoHitKeyDown}
                      aria-label="사진 찍기"
                    >
                      {photoPreviewUrl ? (
                        <span className="bird-photo-preview-wrap">
                          <button
                            type="button"
                            className="bird-photo-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              clearPhotoPreview();
                            }}
                            aria-label="선택한 사진 지우기"
                          >
                            ×
                          </button>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photoPreviewUrl} alt="선택한 새 사진 미리보기" className="bird-photo-preview" />
                        </span>
                      ) : (
                        <span className="bird-photo-placeholder">사진 찍기</span>
                      )}
                    </div>
                  </div>
                </div>

                <label className="bird-nameplate-label" htmlFor="bird-name-input">
                  이름
                </label>
                <input
                  id="bird-name-input"
                  type="text"
                  className="bird-nameplate-input"
                  value={birdName}
                  onChange={(e) => setBirdName(e.target.value)}
                  placeholder="이름을 입력하세요"
                  autoComplete="off"
                />

                <label className="bird-feature-label" htmlFor="bird-feature-input">
                  (선택) 특징 입력
                </label>
                <textarea
                  id="bird-feature-input"
                  className="bird-feature-input"
                  value={birdFeature}
                  onChange={(e) => setBirdFeature(e.target.value)}
                  rows={3}
                  placeholder="예: 부리가 노랗고 목에 흰 고리가 있어요"
                />

                <div className="bird-count-wrap" aria-label="수량 설정">
                  <span className="bird-count-label">수량</span>
                  <div className="bird-count-row">
                    <button
                      type="button"
                      className="bird-count-btn"
                      onClick={() => setBirdCount((c) => Math.max(1, c - 1))}
                      aria-label="수량 줄이기"
                    >
                      −
                    </button>
                    <span className="bird-count-value">{birdCount}</span>
                    <button
                      type="button"
                      className="bird-count-btn"
                      onClick={() => setBirdCount((c) => c + 1)}
                      aria-label="수량 늘리기"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
