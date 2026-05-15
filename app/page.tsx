"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  loadUserGarden,
  saveUserGarden,
  type BirdRecord,
  type PlacedBird,
  type UserGardenPayload,
} from "@/lib/supabase/garden";

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

/** 조류 도감 슬롯 (청둥오리만 해금, 나머지 잠금) */
const DEX_ENTRIES: { id: string; name?: string; unlocked: boolean; isNew?: boolean }[] = [
  { id: "mallard", name: "청둥오리", unlocked: true, isNew: true },
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `locked-${i + 1}`,
    unlocked: false,
  })),
];

const GARDEN_STORAGE_KEY = "birdy-garden:birds:v1";

const BASE_BIRD_SLOTS: PlacedBird[] = [
  // 물/잔디 구역(하단부) 전용 배치
  { id: "w1", xPercent: 19, yPercent: 72, size: 24 },
  { id: "w2", xPercent: 30, yPercent: 78, size: 22 },
  { id: "w3", xPercent: 41, yPercent: 74, size: 26 },
  { id: "w4", xPercent: 55, yPercent: 80, size: 24 },
  { id: "w5", xPercent: 67, yPercent: 73, size: 23 },
  { id: "w6", xPercent: 78, yPercent: 82, size: 21 },
  { id: "w7", xPercent: 88, yPercent: 76, size: 22 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const displayIdFromAuthEmail = (email: string | undefined | null) => {
  if (!email) {
    return "";
  }
  const at = email.indexOf("@");
  if (at <= 0) {
    return email;
  }
  return email.slice(0, at);
};

const createGardenBirds = (count: number, offset: number): PlacedBird[] => {
  return Array.from({ length: count }, (_, idx) => {
    const seq = offset + idx;
    const base = BASE_BIRD_SLOTS[seq % BASE_BIRD_SLOTS.length];
    const ring = Math.floor(seq / BASE_BIRD_SLOTS.length);
    const jitter = (ring % 2 === 0 ? 1 : -1) * Math.min(5, ring + 1);

    return {
      id: `garden-${Date.now()}-${seq}`,
      xPercent: clamp(base.xPercent + jitter, 8, 92),
      yPercent: clamp(base.yPercent + (ring % 3) - 1, 66, 90),
      // 기존 대비 약 2배 크기
      size: clamp(base.size * 2 - (ring % 2), 36, 58),
    };
  });
};

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBirdListOpen, setIsBirdListOpen] = useState(false);
  const [selectedListBirdId, setSelectedListBirdId] = useState<string | null>(null);
  const [isBirdInfoScreenOpen, setIsBirdInfoScreenOpen] = useState(false);
  const [isPhotoPopupOpen, setIsPhotoPopupOpen] = useState(false);
  const [canOpenPhotoPopup, setCanOpenPhotoPopup] = useState(true);
  const [birdName, setBirdName] = useState("청둥오리");
  const [birdFeature, setBirdFeature] = useState("");
  const [birdCount, setBirdCount] = useState(1);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isDexOpen, setIsDexOpen] = useState(false);
  const [gardenBirds, setGardenBirds] = useState<PlacedBird[]>([]);
  const [birdRecords, setBirdRecords] = useState<BirdRecord[]>([]);
  const [isGardenHydrated, setIsGardenHydrated] = useState(false);
  const [isGardenSyncing, setIsGardenSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const saveGardenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const profileInitial = useMemo(() => {
    const trimmed = profileUsername.trim();
    if (!trimmed) {
      return "?";
    }
    return trimmed.slice(0, 1).toUpperCase();
  }, [profileUsername]);

  const syncProfileFromSession = (email: string | undefined | null) => {
    setProfileUsername(displayIdFromAuthEmail(email));
  };

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

  useEffect(() => {
    if (!isProfileOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (profileMenuRef.current?.contains(target)) {
        return;
      }
      setIsProfileOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isProfileOpen]);

  const applyGardenPayload = (birds: PlacedBird[], records: BirdRecord[]) => {
    setGardenBirds(birds);
    setBirdRecords(records);
  };

  const readGuestGardenFromLocal = (): UserGardenPayload => {
    try {
      const raw = window.localStorage.getItem(GARDEN_STORAGE_KEY);
      if (!raw) {
        return { birds: [], records: [] };
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return { birds: [], records: [] };
      }
      const birds: PlacedBird[] = parsed
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.xPercent === "number" &&
            typeof item.yPercent === "number" &&
            typeof item.size === "number"
        )
        .map((item) => ({
          id: item.id,
          xPercent: item.xPercent,
          yPercent: item.yPercent,
          size: item.size,
        }));
      return { birds, records: [] };
    } catch {
      return { birds: [], records: [] };
    }
  };

  const loadGardenForUser = async (uid: string, options?: { mergeGuestIfEmpty?: boolean }) => {
    setIsGardenSyncing(true);
    try {
      const payload = await loadUserGarden(uid);
      const guest = options?.mergeGuestIfEmpty ? readGuestGardenFromLocal() : { birds: [], records: [] };
      if (payload.birds.length === 0 && guest.birds.length > 0) {
        const merged = { birds: guest.birds, records: guest.records };
        applyGardenPayload(merged.birds, merged.records);
        await saveUserGarden(uid, merged);
        return;
      }
      applyGardenPayload(payload.birds, payload.records);
    } catch {
      applyGardenPayload([], []);
    } finally {
      setIsGardenSyncing(false);
    }
  };

  const loadGuestGardenFromLocal = () => {
    const guest = readGuestGardenFromLocal();
    applyGardenPayload(guest.birds, guest.records);
  };

  useEffect(() => {
    let unsubscribed = false;

    const syncAuthState = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!unsubscribed) {
          setIsLoggedIn(!!session);
          syncProfileFromSession(session?.user.email);
          const initialUserId = session?.user.id ?? null;
          setUserId(initialUserId);
          if (initialUserId) {
            await loadGardenForUser(initialUserId, { mergeGuestIfEmpty: true });
          } else {
            loadGuestGardenFromLocal();
          }
          setIsGardenHydrated(true);
        }
        const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
          setIsLoggedIn(!!nextSession);
          syncProfileFromSession(nextSession?.user.email);
          if (!nextSession) {
            setIsProfileOpen(false);
            setProfileUsername("");
          }
          const nextUserId = nextSession?.user.id ?? null;
          setUserId(nextUserId);
          if (nextUserId) {
            await loadGardenForUser(nextUserId, { mergeGuestIfEmpty: true });
          } else {
            loadGuestGardenFromLocal();
          }
        });
        return () => {
          listener.subscription.unsubscribe();
        };
      } catch {
        if (!unsubscribed) {
          setIsLoggedIn(false);
          setUserId(null);
          setProfileUsername("");
          setIsProfileOpen(false);
          loadGuestGardenFromLocal();
          setIsGardenHydrated(true);
        }
      }
      return () => undefined;
    };

    let cleanup = () => undefined;
    void syncAuthState().then((fn) => {
      cleanup = fn;
    });

    return () => {
      unsubscribed = true;
      cleanup();
      if (saveGardenTimerRef.current) {
        clearTimeout(saveGardenTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const warm = (src: string) => {
      const img = new window.Image();
      img.src = src;
    };
    warm("/x.png");
    warm("/left.png");
  }, []);

  useEffect(() => {
    if (!isGardenHydrated || isGardenSyncing) {
      return;
    }

    if (userId) {
      if (saveGardenTimerRef.current) {
        clearTimeout(saveGardenTimerRef.current);
      }
      saveGardenTimerRef.current = setTimeout(() => {
        void saveUserGarden(userId, { birds: gardenBirds, records: birdRecords }).catch(() => {
          // 네트워크/권한 오류 시 UI는 유지
        });
      }, 600);
      return () => {
        if (saveGardenTimerRef.current) {
          clearTimeout(saveGardenTimerRef.current);
        }
      };
    }

    try {
      window.localStorage.setItem(GARDEN_STORAGE_KEY, JSON.stringify(gardenBirds));
    } catch {
      // localStorage 저장 실패 시 무시
    }
  }, [gardenBirds, birdRecords, isGardenHydrated, isGardenSyncing, userId]);

  const resetBirdFormDraft = () => {
    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(true);
    setBirdName("청둥오리");
    setBirdFeature("");
    setBirdCount(1);
    setPhotoPreviewUrl(null);
  };

  const backFromBirdFormToList = () => {
    setIsBirdInfoScreenOpen(false);
    resetBirdFormDraft();
    setIsBirdListOpen(true);
    setSelectedListBirdId(null);
  };

  const openBirdList = () => {
    setIsBirdListOpen(true);
    setSelectedListBirdId(null);
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
    setBirdCount(1);
    setPhotoPreviewUrl(null);
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

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setPhotoPreviewUrl(result);
      }
      setIsPhotoPopupOpen(false);
      setCanOpenPhotoPopup(false);
      event.target.value = "";
    };
    reader.onerror = () => {
      setIsPhotoPopupOpen(false);
      setCanOpenPhotoPopup(true);
      event.target.value = "";
    };
    reader.readAsDataURL(file);
  };

  const clearPhotoPreview = () => {
    setPhotoPreviewUrl(null);
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

  const handleMenuItemActivate = (label: string) => {
    if (label === "도감") {
      setIsDexOpen(true);
      setIsMenuOpen(false);
    }
  };

  const onMenuDrawerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsMenuOpen((prev) => !prev);
    }
  };

  const persistGarden = async (uid: string, birds: PlacedBird[], records: BirdRecord[]) => {
    await saveUserGarden(uid, { birds, records });
  };

  const submitBirdRegistration = async () => {
    const amount = Math.max(1, birdCount);
    const newBirds = createGardenBirds(amount, gardenBirds.length);
    const newRecord: BirdRecord = {
      id: `record-${Date.now()}`,
      name: birdName.trim() || "청둥오리",
      feature: birdFeature.trim(),
      photoUrl: photoPreviewUrl,
      count: amount,
      createdAt: new Date().toISOString(),
    };
    const nextBirds = [...gardenBirds, ...newBirds];
    const nextRecords = [...birdRecords, newRecord];

    setGardenBirds(nextBirds);
    setBirdRecords(nextRecords);
    setIsBirdInfoScreenOpen(false);
    resetBirdFormDraft();

    if (userId) {
      try {
        await persistGarden(userId, nextBirds, nextRecords);
      } catch {
        // 저장 실패해도 화면 상태는 유지
      }
    }
  };

  const submitLogout = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setIsLoginOpen(false);
      setIsProfileOpen(false);
      setProfileUsername("");
      setLoginMessage("");
    } catch {
      // 로그아웃 실패 시에도 onAuthStateChange가 상태를 맞춤
    }
  };

  const toggleProfileMenu = () => {
    setIsProfileOpen((prev) => !prev);
  };

  const openLoginScreen = () => {
    setIsMenuOpen(false);
    setIsLoginOpen(true);
    setLoginMessage("");
  };

  const normalizeAuthEmail = (idOrEmail: string) => {
    const trimmed = idOrEmail.trim();
    if (trimmed.includes("@")) {
      return trimmed;
    }
    return `${trimmed}@birdy.local`;
  };

  const submitLogin = async () => {
    if (!loginId.trim() || !loginPassword.trim()) {
      setLoginMessage("아이디와 비밀번호를 입력해 주세요.");
      return;
    }
    try {
      setIsLoginSubmitting(true);
      setLoginMessage("");
      const supabase = getSupabaseBrowserClient();
      const loginAsEmail = normalizeAuthEmail(loginId);
      const { error } = await supabase.auth.signInWithPassword({
        email: loginAsEmail,
        password: loginPassword,
      });
      if (error) {
        setLoginMessage(`로그인 실패: ${error.message}`);
        return;
      }
      setLoginMessage("로그인 성공! 내 정원 데이터를 불러왔어요.");
      setIsLoginOpen(false);
      setProfileUsername(loginId.trim() || displayIdFromAuthEmail(loginAsEmail));
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user.id) {
        setUserId(sessionData.session.user.id);
        await loadGardenForUser(sessionData.session.user.id, { mergeGuestIfEmpty: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      setLoginMessage(`로그인 실패: ${message}`);
    } finally {
      setIsLoginSubmitting(false);
    }
  };

  const submitSignUp = async () => {
    if (!loginId.trim() || !loginPassword.trim()) {
      setLoginMessage("회원가입할 아이디와 비밀번호를 입력해 주세요.");
      return;
    }
    if (loginPassword.length < 6) {
      setLoginMessage("비밀번호는 6자 이상으로 입력해 주세요.");
      return;
    }
    try {
      setIsLoginSubmitting(true);
      setLoginMessage("");
      const supabase = getSupabaseBrowserClient();
      const signUpEmail = normalizeAuthEmail(loginId);
      const { error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: loginPassword,
      });
      if (error) {
        setLoginMessage(`회원가입 실패: ${error.message}`);
        return;
      }
      setLoginMessage("회원가입 완료! 이제 같은 아이디/비밀번호로 로그인해 보세요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      setLoginMessage(`회원가입 실패: ${message}`);
    } finally {
      setIsLoginSubmitting(false);
    }
  };

  return (
    <main className="garden-page">
      <section className="phone-frame">
        <div className="bird-chrome-preload" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/x.png" alt="" width={48} height={48} decoding="async" fetchPriority="high" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/left.png" alt="" width={48} height={48} decoding="async" fetchPriority="high" />
        </div>
        <div
          className={`menu-drawer ${isMenuOpen ? "open" : "closed"}`}
          role="button"
          tabIndex={0}
          aria-label="메뉴 열기 또는 닫기"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          onKeyDown={onMenuDrawerKeyDown}
        >
          <div className="menu-panel">
            {menuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="menu-item"
                onClick={(event) => {
                  event.stopPropagation();
                  handleMenuItemActivate(item.label);
                }}
              >
                <span className="menu-item-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="menu-item-label">{item.label}</span>
              </button>
            ))}
            {!isLoggedIn ? (
              <button type="button" className="menu-login-button" onClick={openLoginScreen}>
                로그인
              </button>
            ) : null}
          </div>
          <div className="menu-handle" aria-hidden>
            {isMenuOpen ? (
              <span className="menu-arrow menu-arrow--left" />
            ) : (
              <span className="menu-arrow menu-arrow--right" />
            )}
          </div>
        </div>

        <div className="garden-scroll" ref={scrollRef}>
          <div className="garden-world">
            {gardenBirds.map((bird) => (
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

        <div className="profile-corner" ref={profileMenuRef}>
          {!isLoggedIn ? (
            <button type="button" className="floating-login-button" onClick={openLoginScreen}>
              로그인
            </button>
          ) : (
            <>
              <button
                type="button"
                className="profile-trigger-button"
                onClick={toggleProfileMenu}
                aria-label="프로필 메뉴"
                aria-expanded={isProfileOpen}
                aria-haspopup="true"
              >
                <span className="profile-avatar profile-avatar--small" aria-hidden>
                  <span className="profile-avatar-initial">{profileInitial}</span>
                </span>
              </button>
              {isProfileOpen ? (
                <div className="profile-menu" role="dialog" aria-label="프로필">
                  <span className="profile-avatar profile-avatar--large" aria-hidden>
                    <span className="profile-avatar-initial">{profileInitial}</span>
                  </span>
                  <p className="profile-menu-id">{profileUsername || "사용자"}</p>
                  <button type="button" className="profile-menu-logout" onClick={submitLogout}>
                    로그아웃
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {isBirdListOpen ? (
          <div className="bird-list-screen" role="dialog" aria-modal="true" aria-label="조류 목록">
            <header className="bird-list-header">
              <button type="button" className="bird-list-close" onClick={closeBirdList} aria-label="목록 닫기">
                <img
                  src="/x.png"
                  alt=""
                  width={48}
                  height={48}
                  decoding="sync"
                  fetchPriority="high"
                  className="bird-list-close-img"
                />
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
                <img
                  src="/left.png"
                  alt=""
                  width={48}
                  height={48}
                  decoding="sync"
                  fetchPriority="high"
                  className="bird-form-back-img"
                />
              </button>
              <span className="bird-form-header-title">조류 등록</span>
              <span className="bird-form-header-spacer" aria-hidden />
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

                <input
                  id="bird-name-input"
                  type="text"
                  className="bird-nameplate-input"
                  value={birdName}
                  onChange={(e) => setBirdName(e.target.value)}
                  aria-label="이름"
                  autoComplete="off"
                />

                <textarea
                  id="bird-feature-input"
                  className="bird-feature-input"
                  value={birdFeature}
                  onChange={(e) => setBirdFeature(e.target.value)}
                  rows={3}
                  placeholder="메모: 예-부리가 유독 푸른색을 띄어요"
                  aria-label="메모"
                />

                <div className="bird-count-wrap" aria-label="수량 설정">
                  <div className="bird-count-row">
                    <button
                      type="button"
                      className="bird-count-btn"
                      onClick={() => setBirdCount((c) => Math.max(1, c - 1))}
                      disabled={birdCount <= 1}
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

              <section className="bird-map-section" aria-label="발견 장소 설정">
                <h3 className="bird-map-title">발견 장소 설정</h3>
                <div className="bird-map-frame">
                  <iframe
                    title="발견 장소 지도"
                    src="https://www.openstreetmap.org/export/embed.html?bbox=127.02%2C37.51%2C127.06%2C37.54&layer=mapnik"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </section>
            </div>

            <footer className="bird-form-footer">
              <button type="button" className="bird-form-submit" onClick={submitBirdRegistration}>
                추가하기
              </button>
            </footer>
          </div>
        ) : null}

        {isDexOpen ? (
          <div className="bird-dex-screen" role="dialog" aria-modal="true" aria-label="조류 도감">
            <header className="bird-dex-header">
              <button type="button" className="bird-dex-close" onClick={() => setIsDexOpen(false)} aria-label="도감 닫기">
                <img
                  src="/x.png"
                  alt=""
                  width={48}
                  height={48}
                  decoding="sync"
                  className="bird-dex-close-img"
                />
              </button>
              <div className="bird-dex-title-plank">
                <h1 className="bird-dex-title">조류 도감</h1>
              </div>
            </header>

            <div className="bird-dex-scroll">
              <div className="bird-dex-grid">
                {DEX_ENTRIES.map((entry) => (
                  <div
                    key={entry.id}
                    className={`bird-dex-card${entry.unlocked ? "" : " bird-dex-card--locked"}`}
                  >
                    {entry.unlocked && entry.isNew ? (
                      <span className="bird-dex-new" aria-label="새로 해금">
                        New!
                      </span>
                    ) : null}
                    <div className="bird-dex-card-visual">
                      {entry.unlocked ? (
                        <div className="bird-dex-unlocked-img-wrap">
                          <Image
                            src="/test.png"
                            alt={entry.name ?? "청둥오리"}
                            fill
                            sizes="120px"
                            className="bird-dex-card-img"
                          />
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src="/bird-silhouette.svg" alt="" className="bird-dex-silhouette" />
                      )}
                    </div>
                    <span className="bird-dex-card-name">{entry.unlocked ? entry.name : "???"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {isLoginOpen ? (
          <div className="bird-login-screen" role="dialog" aria-modal="true" aria-label="로그인">
            <header className="bird-login-header">
              <button type="button" className="bird-login-close" onClick={() => setIsLoginOpen(false)} aria-label="로그인 닫기">
                <img src="/x.png" alt="" width={48} height={48} decoding="sync" className="bird-login-close-img" />
              </button>
              <h2 className="bird-login-title">로그인</h2>
            </header>

            <div className="bird-login-body">
              <label className="bird-login-label" htmlFor="login-id-input">
                아이디
              </label>
              <input
                id="login-id-input"
                type="text"
                className="bird-login-input"
                placeholder="아이디를 입력하세요"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                autoComplete="username"
                inputMode="text"
                spellCheck={false}
              />
              <label className="bird-login-label" htmlFor="login-password-input">
                비밀번호
              </label>
              <input
                id="login-password-input"
                type="password"
                className="bird-login-input"
                placeholder="비밀번호를 입력하세요"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button type="button" className="bird-login-submit" onClick={submitLogin} disabled={isLoginSubmitting}>
                {isLoginSubmitting ? "로그인 중..." : "로그인"}
              </button>
              <button type="button" className="bird-login-signup-link" onClick={submitSignUp} disabled={isLoginSubmitting}>
                회원가입하기
              </button>
              {loginMessage ? <p className="bird-login-message">{loginMessage}</p> : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
