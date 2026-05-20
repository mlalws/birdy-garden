"use client";

import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  assertSupabaseReachable,
  getSupabaseBrowserClient,
  getSupabaseConfigIssue,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  applyAvatarChange,
  applyNicknameChange,
  canChangeNickname,
  generateRandomNickname,
  validateNicknameInput,
  type UserProfile,
} from "@/lib/profile";
import { readProfileImageAsDataUrl } from "@/lib/profile-image";
import { GardenWorldView } from "@/components/garden-world-view";
import { createGardenBirds, normalizePlacedBirds } from "@/lib/garden-birds";
import {
  applyGardenDayRollover,
  buildCalendarCells,
  computeDayBirdStats,
  countLifetimeSpeciesSightings,
  dateKeyHasGarden,
  formatMonthLabel,
  getKstDateKey,
  getRecordSpeciesLabel,
  parseDateKey,
  repairGardenPayloadArchives,
  resolveDaySnapshot,
  shiftCalendarMonth,
  toDateKey,
} from "@/lib/garden-daily";
import { gardenPayloadNeedsMigration, migrateGardenPayload } from "@/lib/garden-records";
import { formatKstWeekLabel, formatKstWeekPeriod, getKstWeekKey } from "@/lib/garden-weekly";
import { getGardenStorageErrorMessage } from "@/lib/supabase/garden-errors";
import {
  fetchWeeklyLeaderboard,
  rankFromSortedRows,
  recordWeeklyDiscovery,
  syncWeeklyRankingFromGarden,
  weeklyRankBannerMessage,
  type WeeklyRankingRow,
} from "@/lib/supabase/ranking";
import {
  loadUserGarden,
  saveUserGarden,
  type BirdRecord,
  type DailyGardenArchive,
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
  imageSrc?: string;
  isPlaceholder?: boolean;
};

const BIRD_LIST_ITEMS: ListBird[] = [
  { id: "mallard", name: "청둥오리", imageSrc: "/test.png" },
  { id: "magpie", name: "까치", imageSrc: "/kachi.png" },
  { id: "ph1", name: "", isPlaceholder: true },
  { id: "ph2", name: "", isPlaceholder: true },
  { id: "ph3", name: "", isPlaceholder: true },
];

const DEX_SLOT_COUNT = 15;

/** 도감에 미리 정의된 조류 (추가해야 해금) */
const KNOWN_DEX_SPECIES: { id: string; name: string; imageSrc: string }[] = [
  { id: "mallard", name: "청둥오리", imageSrc: "/test.png" },
  { id: "magpie", name: "까치", imageSrc: "/kachi.png" },
];

type DexDisplayEntry = {
  id: string;
  name?: string;
  imageSrc: string;
  unlocked: boolean;
  isNew: boolean;
  photoUrl: string | null;
};

const getUnlockedSpeciesNames = (records: BirdRecord[]) =>
  new Set(records.map((record) => getRecordSpeciesLabel(record)).filter(Boolean));

const getSpeciesPhotoFromRecords = (records: BirdRecord[], speciesName: string) => {
  const match = [...records]
    .reverse()
    .find((record) => getRecordSpeciesLabel(record) === speciesName && record.photoUrl);
  return match?.photoUrl ?? null;
};

const buildDexDisplayEntries = (records: BirdRecord[], dexSeenSpecies: string[]): DexDisplayEntry[] => {
  const seen = new Set(dexSeenSpecies);
  const unlockedNames = getUnlockedSpeciesNames(records);
  const knownNames = new Set(KNOWN_DEX_SPECIES.map((species) => species.name));

  const entries: DexDisplayEntry[] = KNOWN_DEX_SPECIES.map((species) => {
    const unlocked = unlockedNames.has(species.name);
    return {
      id: species.id,
      name: species.name,
      imageSrc: species.imageSrc,
      unlocked,
      isNew: unlocked && !seen.has(species.name),
      photoUrl: unlocked ? getSpeciesPhotoFromRecords(records, species.name) : null,
    };
  });

  const customNames = [...unlockedNames].filter((name) => !knownNames.has(name));
  for (const customName of customNames) {
    entries.push({
      id: `custom-${customName}`,
      name: customName,
      imageSrc: DEFAULT_BIRD_IMAGE,
      unlocked: true,
      isNew: !seen.has(customName),
      photoUrl: getSpeciesPhotoFromRecords(records, customName),
    });
  }

  while (entries.length < DEX_SLOT_COUNT) {
    entries.push({
      id: `locked-${entries.length}`,
      imageSrc: DEFAULT_BIRD_IMAGE,
      unlocked: false,
      isNew: false,
      photoUrl: null,
    });
  }

  return entries.slice(0, DEX_SLOT_COUNT);
};

const GARDEN_STORAGE_KEY = "birdy-garden:birds:v1";
const DEFAULT_BIRD_IMAGE = "/test.png";
const EMPTY_GARDEN_PAYLOAD: UserGardenPayload = { birds: [], records: [], dexSeenSpecies: [] };

type RegistrationConfirmPayload = {
  /** 짹짹짹 화면·도감에 쓰는 목록상 종 이름 */
  speciesName: string;
  photoUrl: string | null;
  fallbackImageSrc: string;
  totalSightings: number;
  isFirstDiscovery: boolean;
  /** 이번 주 1위 등극·갱신 시 짹짹짹 화면 하단 배너 */
  weeklyRankBanner?: string | null;
};

/** Supabase가 거부하지 않는 가짜 이메일 도메인 (하이픈 없는 FQDN) */
const AUTH_EMAIL_DOMAIN = "users.birdygarden.app";
const LEGACY_AUTH_EMAIL_DOMAINS = ["users.birdy-garden.app", "birdy.local"] as const;

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

const SPECIES_IMAGE_BY_NAME = new Map(KNOWN_DEX_SPECIES.map((item) => [item.name, item.imageSrc]));

const getSpeciesFallbackImageSrc = (speciesName: string) =>
  SPECIES_IMAGE_BY_NAME.get(speciesName.trim()) ?? DEFAULT_BIRD_IMAGE;

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBirdListOpen, setIsBirdListOpen] = useState(false);
  const [selectedListBirdId, setSelectedListBirdId] = useState<string | null>(null);
  const [isBirdInfoScreenOpen, setIsBirdInfoScreenOpen] = useState(false);
  const [birdRegistrationMode, setBirdRegistrationMode] = useState<"listed" | "unlisted">("listed");
  const [isPhotoPopupOpen, setIsPhotoPopupOpen] = useState(false);
  const [canOpenPhotoPopup, setCanOpenPhotoPopup] = useState(true);
  const [birdName, setBirdName] = useState("청둥오리");
  const [registrationSpeciesName, setRegistrationSpeciesName] = useState<string | null>(null);
  const [birdFeature, setBirdFeature] = useState("");
  const [birdCount, setBirdCount] = useState(1);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isDexOpen, setIsDexOpen] = useState(false);
  const [dexSeenSpecies, setDexSeenSpecies] = useState<string[]>([]);
  const [gardenBirds, setGardenBirds] = useState<PlacedBird[]>([]);
  const [birdRecords, setBirdRecords] = useState<BirdRecord[]>([]);
  const [isGardenHydrated, setIsGardenHydrated] = useState(false);
  const [isGardenSyncing, setIsGardenSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNicknameEditing, setIsNicknameEditing] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [profileEditMessage, setProfileEditMessage] = useState("");
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [registrationConfirm, setRegistrationConfirm] = useState<RegistrationConfirmPayload | null>(null);
  const [selectedGardenBirdId, setSelectedGardenBirdId] = useState<string | null>(null);
  const [gardenBirdDeleteConfirm, setGardenBirdDeleteConfirm] = useState(false);
  const [gardenSyncError, setGardenSyncError] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isArchiveGardenOpen, setIsArchiveGardenOpen] = useState(false);
  const [dailyArchives, setDailyArchives] = useState<Record<string, DailyGardenArchive>>({});
  const [currentGardenDate, setCurrentGardenDate] = useState(() => getKstDateKey());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = parseDateKey(getKstDateKey());
    return { year: today.year, month: today.month };
  });
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState(() => getKstDateKey());
  const [isRankingOpen, setIsRankingOpen] = useState(false);
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<WeeklyRankingRow[]>([]);
  const [isRankingLoading, setIsRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCenteredGardenScrollRef = useRef(false);
  const archiveScrollRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const saveGardenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);
  const guestSessionPayloadRef = useRef<UserGardenPayload>(EMPTY_GARDEN_PAYLOAD);
  const gardenLoadSeqRef = useRef(0);
  const gardenDirtyRef = useRef(false);
  const loadedGardenUserIdRef = useRef<string | null>(null);
  const gardenSnapshotRef = useRef({
    gardenBirds,
    birdRecords,
    dexSeenSpecies,
    userProfile,
    dailyArchives,
    currentGardenDate,
  });

  const todayDateKey = getKstDateKey();

  const selectedDaySnapshot = useMemo(
    () => resolveDaySnapshot(selectedCalendarDateKey, dailyArchives, { birds: gardenBirds, records: birdRecords }),
    [selectedCalendarDateKey, dailyArchives, gardenBirds, birdRecords]
  );

  const selectedDayStats = useMemo(
    () => computeDayBirdStats(selectedDaySnapshot ?? undefined),
    [selectedDaySnapshot]
  );

  const archiveViewSnapshot = useMemo(() => {
    if (!isArchiveGardenOpen) {
      return null;
    }
    return resolveDaySnapshot(selectedCalendarDateKey, dailyArchives, { birds: gardenBirds, records: birdRecords });
  }, [isArchiveGardenOpen, selectedCalendarDateKey, dailyArchives, gardenBirds, birdRecords]);

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth.year, calendarMonth.month),
    [calendarMonth.year, calendarMonth.month]
  );

  const calendarWeekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

  const profileAvatarUrl = userProfile?.avatarUrl ?? null;

  const selectedGardenBird = useMemo(
    () => gardenBirds.find((bird) => bird.id === selectedGardenBirdId) ?? null,
    [gardenBirds, selectedGardenBirdId]
  );

  const selectedGardenBirdRecord = useMemo(() => {
    if (!selectedGardenBird?.recordId) {
      return null;
    }
    return birdRecords.find((record) => record.id === selectedGardenBird.recordId) ?? null;
  }, [birdRecords, selectedGardenBird]);

  const profileInitial = useMemo(() => {
    const trimmed = profileUsername.trim();
    if (!trimmed) {
      return "?";
    }
    return trimmed.slice(0, 1).toUpperCase();
  }, [profileUsername]);

  const renderProfileAvatar = (sizeClass: "profile-avatar--small" | "profile-avatar--large") => (
    <span className={`profile-avatar ${sizeClass}`} aria-hidden>
      {profileAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profileAvatarUrl} alt="" className="profile-avatar-img" />
      ) : (
        <span className="profile-avatar-initial">{profileInitial}</span>
      )}
    </span>
  );

  const applyProfileDisplay = (profile: UserProfile | null, email?: string | null) => {
    if (profile?.nickname) {
      setUserProfile(profile);
      setProfileUsername(profile.nickname);
      return;
    }
    setUserProfile(null);
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

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }

    const tryCenter = () => {
      if (hasCenteredGardenScrollRef.current) {
        return true;
      }
      const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
      if (maxScroll < 8) {
        return false;
      }
      scrollEl.scrollLeft = Math.round(maxScroll / 2);
      hasCenteredGardenScrollRef.current = true;
      return true;
    };

    const scheduleCenter = () => {
      if (tryCenter()) {
        return;
      }
      requestAnimationFrame(() => {
        if (tryCenter()) {
          return;
        }
        requestAnimationFrame(() => {
          tryCenter();
        });
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleCenter();
    });
    observer.observe(scrollEl);

    const world = scrollEl.querySelector(".garden-world");
    if (world instanceof HTMLElement) {
      observer.observe(world);
    }

    scheduleCenter();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedGardenBirdId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(".bird-speech-bubble") || target.closest(".bird")) {
        return;
      }
      closeGardenBirdDetail();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [selectedGardenBirdId]);

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

  const applyGardenPayload = (payload: UserGardenPayload) => {
    const migrated = migrateGardenPayload(payload);
    setGardenBirds(normalizePlacedBirds(migrated.birds));
    setBirdRecords(migrated.records);
    setDexSeenSpecies(migrated.dexSeenSpecies ?? []);
    setDailyArchives(migrated.dailyArchives ?? {});
    setCurrentGardenDate(migrated.currentGardenDate ?? getKstDateKey());
    return migrated;
  };

  const clearLegacyGuestStorage = () => {
    try {
      window.localStorage.removeItem(GARDEN_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const resetGuestGarden = () => {
    applyGardenPayload(EMPTY_GARDEN_PAYLOAD);
    guestSessionPayloadRef.current = EMPTY_GARDEN_PAYLOAD;
    clearLegacyGuestStorage();
  };

  useEffect(() => {
    clearLegacyGuestStorage();
  }, []);

  useEffect(() => {
    gardenSnapshotRef.current = {
      gardenBirds,
      birdRecords,
      dexSeenSpecies,
      userProfile,
      dailyArchives,
      currentGardenDate,
    };
  }, [gardenBirds, birdRecords, dexSeenSpecies, userProfile, dailyArchives, currentGardenDate]);

  const buildGardenPayloadFromSnapshot = (snapshot = gardenSnapshotRef.current): UserGardenPayload => ({
    birds: snapshot.gardenBirds,
    records: snapshot.birdRecords,
    dexSeenSpecies: snapshot.dexSeenSpecies,
    currentGardenDate: snapshot.currentGardenDate ?? getKstDateKey(),
    dailyArchives: snapshot.dailyArchives ?? {},
    ...(snapshot.userProfile ? { profile: snapshot.userProfile } : {}),
  });

  const runGardenDayRolloverIfNeeded = async (uid?: string | null) => {
    const { payload: rolled, didRollover } = applyGardenDayRollover(buildGardenPayloadFromSnapshot());
    if (!didRollover) {
      return false;
    }
    applyGardenPayload(rolled);
    if (uid) {
      try {
        await saveUserGarden(uid, rolled);
        gardenDirtyRef.current = false;
        setGardenSyncError("");
      } catch (error) {
        reportGardenSyncError(error);
      }
    } else {
      guestSessionPayloadRef.current = rolled;
    }
    return true;
  };

  const buildGardenPayload = (): UserGardenPayload => buildGardenPayloadFromSnapshot();

  const markGardenDirty = () => {
    gardenDirtyRef.current = true;
  };

  const dexDisplayEntries = useMemo(
    () => buildDexDisplayEntries(birdRecords, dexSeenSpecies),
    [birdRecords, dexSeenSpecies]
  );

  const loadGardenForUser = async (
    uid: string,
    options?: { mergeSessionGuestIfEmpty?: boolean; emailFallback?: string | null; force?: boolean }
  ) => {
    if (!options?.force && loadedGardenUserIdRef.current === uid) {
      return;
    }

    const loadSeq = ++gardenLoadSeqRef.current;
    setIsGardenSyncing(true);
    try {
      const loaded = repairGardenPayloadArchives(await loadUserGarden(uid));
      const { payload: payloadAfterRollover, didRollover } = applyGardenDayRollover(loaded);
      const hydratedPayload = repairGardenPayloadArchives(payloadAfterRollover);
      if (loadSeq !== gardenLoadSeqRef.current) {
        return;
      }

      const needsRepairSave =
        JSON.stringify(hydratedPayload.dailyArchives ?? {}) !==
          JSON.stringify(payloadAfterRollover.dailyArchives ?? {}) ||
        hydratedPayload.birds.length !== payloadAfterRollover.birds.length ||
        hydratedPayload.records.length !== payloadAfterRollover.records.length;

      const sessionGuest = options?.mergeSessionGuestIfEmpty ? guestSessionPayloadRef.current : EMPTY_GARDEN_PAYLOAD;
      if (hydratedPayload.birds.length === 0 && sessionGuest.birds.length > 0) {
        const merged: UserGardenPayload = {
          birds: sessionGuest.birds,
          records: sessionGuest.records,
          dexSeenSpecies: sessionGuest.dexSeenSpecies ?? [],
          dailyArchives: { ...hydratedPayload.dailyArchives, ...sessionGuest.dailyArchives },
          currentGardenDate: hydratedPayload.currentGardenDate ?? getKstDateKey(),
          profile: hydratedPayload.profile,
        };
        const migratedMerged = applyGardenPayload(merged);
        await saveUserGarden(uid, migratedMerged);
        guestSessionPayloadRef.current = EMPTY_GARDEN_PAYLOAD;
        clearLegacyGuestStorage();
        applyProfileDisplay(merged.profile ?? null, options?.emailFallback);
        loadedGardenUserIdRef.current = uid;
        gardenDirtyRef.current = false;
        return;
      }
      const migratedPayload = applyGardenPayload(hydratedPayload);
      applyProfileDisplay(migratedPayload.profile ?? null, options?.emailFallback);
      loadedGardenUserIdRef.current = uid;
      setGardenSyncError("");
      const needsSave = didRollover || needsRepairSave || gardenPayloadNeedsMigration(hydratedPayload);
      if (needsSave) {
        await saveUserGarden(uid, migratedPayload);
        gardenDirtyRef.current = false;
      } else {
        gardenDirtyRef.current = false;
      }
    } catch (error) {
      if (loadSeq !== gardenLoadSeqRef.current) {
        return;
      }
      // 로드 실패 시 빈 정원으로 덮지 않음 (자동 저장이 DB를 비우는 것 방지)
      reportGardenSyncError(error);
      applyProfileDisplay(null, options?.emailFallback);
    } finally {
      if (loadSeq === gardenLoadSeqRef.current) {
        setIsGardenSyncing(false);
      }
    }
  };

  const ensureSignupProfile = async (uid: string) => {
    const payload = await loadUserGarden(uid);
    if (payload.profile?.nickname) {
      setUserProfile(payload.profile);
      setProfileUsername(payload.profile.nickname);
      return;
    }
    const profile: UserProfile = {
      nickname: generateRandomNickname(),
      nicknameEditCount: 0,
      nicknameLastChangedAt: null,
      avatarUrl: null,
    };
    const merged: UserGardenPayload = { ...payload, profile };
    await saveUserGarden(uid, merged);
    setUserProfile(profile);
    setProfileUsername(profile.nickname);
  };

  useEffect(() => {
    let unsubscribed = false;

    const syncAuthState = async () => {
      if (!isSupabaseConfigured()) {
        if (!unsubscribed) {
          setIsLoggedIn(false);
          setUserId(null);
          resetGuestGarden();
          setIsGardenHydrated(true);
        }
        return () => undefined;
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!unsubscribed) {
          const initialUserId = session?.user.id ?? null;
          setIsLoggedIn(!!session);
          setUserId(initialUserId);
          if (initialUserId) {
            await loadGardenForUser(initialUserId, {
              mergeSessionGuestIfEmpty: true,
              emailFallback: session?.user.email,
            });
          } else {
            resetGuestGarden();
            setUserProfile(null);
            setProfileUsername("");
          }
          if (!unsubscribed) {
            setIsGardenHydrated(true);
          }
        }
        const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
          setIsLoggedIn(!!nextSession);
          if (!nextSession) {
            loadedGardenUserIdRef.current = null;
            gardenDirtyRef.current = false;
            setIsProfileOpen(false);
            setIsNicknameEditing(false);
            setProfileEditMessage("");
            setProfileUsername("");
            setUserProfile(null);
            setRegistrationConfirm(null);
            resetGuestGarden();
            setUserId(null);
            return;
          }
          const nextUserId = nextSession.user.id;
          setUserId(nextUserId);
          if (loadedGardenUserIdRef.current !== nextUserId) {
            await loadGardenForUser(nextUserId, {
              mergeSessionGuestIfEmpty: true,
              emailFallback: nextSession.user.email,
            });
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
          setUserProfile(null);
          setIsProfileOpen(false);
          resetGuestGarden();
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
    warm("/background.jpg");
  }, []);

  const currentWeekKey = getKstWeekKey();

  const myWeeklyRank = useMemo(() => {
    if (!userId) {
      return null;
    }
    return rankFromSortedRows(weeklyLeaderboard, userId);
  }, [weeklyLeaderboard, userId]);

  const myWeeklyEntry = useMemo(
    () => weeklyLeaderboard.find((row) => row.user_id === userId) ?? null,
    [weeklyLeaderboard, userId]
  );

  useEffect(() => {
    if (!isRankingOpen) {
      return;
    }
    void loadWeeklyRanking();
  }, [isRankingOpen, isLoggedIn]);

  const flushGardenSaveNow = async (uid: string) => {
    if (!gardenDirtyRef.current) {
      return;
    }
    try {
      await saveUserGarden(uid, buildGardenPayloadFromSnapshot());
      gardenDirtyRef.current = false;
    } catch (error) {
      reportGardenSyncError(error);
    }
  };

  useEffect(() => {
    if (!isGardenHydrated || isGardenSyncing) {
      return;
    }

    if (!userId) {
      guestSessionPayloadRef.current = buildGardenPayload();
      return;
    }

    if (!gardenDirtyRef.current) {
      return;
    }

    if (saveGardenTimerRef.current) {
      clearTimeout(saveGardenTimerRef.current);
    }
    saveGardenTimerRef.current = setTimeout(() => {
      void flushGardenSaveNow(userId);
    }, 600);
    return () => {
      if (saveGardenTimerRef.current) {
        clearTimeout(saveGardenTimerRef.current);
      }
    };
  }, [gardenBirds, birdRecords, dexSeenSpecies, userProfile, isGardenHydrated, isGardenSyncing, userId]);

  useEffect(() => {
    const onPageHide = () => {
      if (!userId) {
        return;
      }
      void flushGardenSaveNow(userId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        onPageHide();
        return;
      }
      if (document.visibilityState === "visible" && isGardenHydrated) {
        void runGardenDayRolloverIfNeeded(userId);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId, isGardenHydrated]);

  useEffect(() => {
    if (!isGardenHydrated) {
      return;
    }
    const timer = window.setInterval(() => {
      void runGardenDayRolloverIfNeeded(userId);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isGardenHydrated, userId, currentGardenDate]);

  const resetBirdFormDraft = () => {
    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(true);
    setBirdRegistrationMode("listed");
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

  const openBirdRegistration = (opts?: { name?: string; mode?: "listed" | "unlisted" }) => {
    const mode = opts?.mode ?? "listed";
    const nextName =
      mode === "unlisted" ? "" : opts?.name !== undefined ? opts.name : "청둥오리";
    setRegistrationSpeciesName(mode === "unlisted" ? null : nextName);
    setIsBirdListOpen(false);
    setSelectedListBirdId(null);
    setBirdRegistrationMode(mode);
    setIsBirdInfoScreenOpen(true);
    setIsPhotoPopupOpen(false);
    setCanOpenPhotoPopup(true);
    setBirdName(nextName);
    setBirdFeature("");
    setBirdCount(1);
    setPhotoPreviewUrl(null);
  };

  const openUnlistedBirdRegistration = () => {
    openBirdRegistration({ mode: "unlisted", name: "" });
  };

  const goNextFromBirdList = () => {
    const item = BIRD_LIST_ITEMS.find((b) => b.id === selectedListBirdId);
    if (!item || item.isPlaceholder) {
      return;
    }
    openBirdRegistration({ name: item.name, mode: "listed" });
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

  const closeDex = () => {
    const unlocked = [...getUnlockedSpeciesNames(birdRecords)];
    if (unlocked.length > 0) {
      markGardenDirty();
      setDexSeenSpecies((prev) => [...new Set([...prev, ...unlocked])]);
    }
    setIsDexOpen(false);
    setIsMenuOpen(false);
  };

  const openCalendar = () => {
    const today = parseDateKey(getKstDateKey());
    setCalendarMonth({ year: today.year, month: today.month });
    setSelectedCalendarDateKey(getKstDateKey());
    setIsCalendarOpen(true);
    setIsMenuOpen(false);
  };

  const closeCalendar = () => {
    setIsCalendarOpen(false);
    setIsMenuOpen(false);
  };

  const openRanking = () => {
    setIsRankingOpen(true);
    setIsMenuOpen(false);
  };

  const closeRanking = () => {
    setIsRankingOpen(false);
    setIsMenuOpen(false);
  };

  const loadWeeklyRanking = async () => {
    if (!isLoggedIn || !isSupabaseConfigured() || !userId) {
      setWeeklyLeaderboard([]);
      setRankingError("");
      return;
    }

    setIsRankingLoading(true);
    setRankingError("");
    try {
      await syncWeeklyRankingFromGarden(
        userId,
        profileUsername.trim() || "탐험가",
        birdRecords,
        dailyArchives
      );
      const rows = await fetchWeeklyLeaderboard(getKstWeekKey());
      setWeeklyLeaderboard(rows);
    } catch (error) {
      setWeeklyLeaderboard([]);
      setRankingError(getGardenStorageErrorMessage(error));
    } finally {
      setIsRankingLoading(false);
    }
  };

  const openArchiveGarden = () => {
    if (!selectedDaySnapshot || selectedDaySnapshot.birds.length === 0) {
      return;
    }
    setIsArchiveGardenOpen(true);
    setIsCalendarOpen(false);
  };

  const closeArchiveGarden = () => {
    setIsArchiveGardenOpen(false);
    setIsCalendarOpen(true);
  };

  const handleMenuItemActivate = (label: string) => {
    if (label === "도감") {
      setIsDexOpen(true);
      setIsMenuOpen(false);
    }
    if (label === "캘린더") {
      openCalendar();
    }
    if (label === "랭킹") {
      openRanking();
    }
  };

  const onMenuDrawerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsMenuOpen((prev) => !prev);
    }
  };

  const persistGarden = async (uid: string, payload: UserGardenPayload) => {
    await saveUserGarden(uid, payload);
    loadedGardenUserIdRef.current = uid;
    gardenDirtyRef.current = false;
    setGardenSyncError("");
  };

  const reportGardenSyncError = (error: unknown) => {
    setGardenSyncError(getGardenStorageErrorMessage(error));
    gardenDirtyRef.current = true;
  };

  const closeRegistrationConfirm = () => {
    setRegistrationConfirm(null);
    setIsBirdListOpen(false);
    setIsBirdInfoScreenOpen(false);
    resetBirdFormDraft();
  };

  const closeGardenBirdDetail = () => {
    setSelectedGardenBirdId(null);
    setGardenBirdDeleteConfirm(false);
  };

  const openGardenBirdDetail = (birdId: string) => {
    setSelectedGardenBirdId(birdId);
    setGardenBirdDeleteConfirm(false);
  };

  const requestGardenBirdDelete = () => {
    setGardenBirdDeleteConfirm(true);
  };

  const cancelGardenBirdDelete = () => {
    setGardenBirdDeleteConfirm(false);
  };

  const confirmGardenBirdDelete = async () => {
    if (!selectedGardenBird) {
      return;
    }
    const birdId = selectedGardenBird.id;
    const recordId = selectedGardenBird.recordId;
    const nextBirds = gardenBirds.filter((bird) => bird.id !== birdId);
    let nextRecords = birdRecords;

    if (recordId) {
      const target = birdRecords.find((record) => record.id === recordId);
      if (target) {
        const remainingForRecord = nextBirds.filter((bird) => bird.recordId === recordId).length;
        if (remainingForRecord === 0) {
          nextRecords = birdRecords.filter((record) => record.id !== recordId);
        } else if (target.count > remainingForRecord) {
          nextRecords = birdRecords.map((record) =>
            record.id === recordId ? { ...record, count: remainingForRecord } : record
          );
        }
      }
    }

    markGardenDirty();
    setGardenBirds(nextBirds);
    setBirdRecords(nextRecords);
    closeGardenBirdDetail();

    if (userId) {
      try {
        await persistGarden(userId, {
          ...buildGardenPayloadFromSnapshot(),
          birds: nextBirds,
          records: nextRecords,
        });
        if (isSupabaseConfigured()) {
          await syncWeeklyRankingFromGarden(
            userId,
            profileUsername.trim() || "탐험가",
            nextRecords,
            dailyArchives
          );
        }
      } catch (error) {
        reportGardenSyncError(error);
      }
    }
  };

  const submitBirdRegistration = async () => {
    const isUnlisted = birdRegistrationMode === "unlisted";
    const amount = isUnlisted ? 1 : Math.max(1, birdCount);
    const displayName = birdName.trim() || (isUnlisted ? "이름 없는 조류" : "청둥오리");
    const capturedPhoto = photoPreviewUrl;
    const recordId = `record-${Date.now()}`;
    const speciesNameForConfirm = isUnlisted
      ? displayName
      : registrationSpeciesName?.trim() || displayName;
    const newBirds = createGardenBirds(amount, gardenBirds.length, recordId, { listBirdId: selectedListBirdId });
    const newRecord: BirdRecord = {
      id: recordId,
      name: displayName,
      speciesName: speciesNameForConfirm,
      listBirdId: isUnlisted ? undefined : selectedListBirdId ?? undefined,
      feature: birdFeature.trim(),
      photoUrl: capturedPhoto,
      count: amount,
      createdAt: new Date().toISOString(),
    };
    const nextBirds = normalizePlacedBirds([...gardenBirds, ...newBirds]);
    const nextRecords = [...birdRecords, newRecord];
    const previousSightings = countLifetimeSpeciesSightings(birdRecords, dailyArchives, speciesNameForConfirm);
    const totalSightings = countLifetimeSpeciesSightings(nextRecords, dailyArchives, speciesNameForConfirm);
    const isFirstDiscovery = previousSightings === 0;
    const fallbackImageSrc = getSpeciesFallbackImageSrc(speciesNameForConfirm);

    markGardenDirty();
    setGardenBirds(nextBirds);
    setBirdRecords(nextRecords);
    setIsBirdInfoScreenOpen(false);
    resetBirdFormDraft();

    setRegistrationConfirm({
      speciesName: speciesNameForConfirm,
      photoUrl: capturedPhoto,
      fallbackImageSrc,
      totalSightings,
      isFirstDiscovery,
    });

    void (async () => {
      let weeklyRankBanner: string | null = null;
      if (userId && isSupabaseConfigured()) {
        try {
          const rankingResult = await recordWeeklyDiscovery(userId, profileUsername.trim() || "탐험가", amount);
          if (rankingResult) {
            weeklyRankBanner = weeklyRankBannerMessage(rankingResult);
          }
        } catch {
          // 랭킹 실패해도 짹짹짹 화면은 유지
        }
      }

      if (weeklyRankBanner) {
        setRegistrationConfirm((prev) =>
          prev ? { ...prev, weeklyRankBanner } : prev
        );
      }

      if (userId) {
        try {
          await persistGarden(userId, {
            ...buildGardenPayloadFromSnapshot(),
            birds: nextBirds,
            records: nextRecords,
          });
        } catch (error) {
          reportGardenSyncError(error);
        }
      }
    })();
  };

  const submitLogout = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setIsLoginOpen(false);
      setIsProfileOpen(false);
      setIsNicknameEditing(false);
      setProfileEditMessage("");
      setProfileUsername("");
      setUserProfile(null);
      setLoginMessage("");
    } catch {
      // 로그아웃 실패 시에도 onAuthStateChange가 상태를 맞춤
    }
  };

  const toggleProfileMenu = () => {
    setIsProfileOpen((prev) => {
      if (prev) {
        setIsNicknameEditing(false);
        setProfileEditMessage("");
      }
      return !prev;
    });
  };

  const resolveEditableProfile = (): UserProfile => {
    if (userProfile) {
      return userProfile;
    }
    return {
      nickname: profileUsername || "사용자",
      nicknameEditCount: 0,
      nicknameLastChangedAt: null,
      avatarUrl: null,
    };
  };

  const persistUserProfile = async (profile: UserProfile, message: string) => {
    if (!userId) {
      return;
    }
    setUserProfile(profile);
    markGardenDirty();
    await persistGarden(userId, {
      ...buildGardenPayload(),
      profile,
    });
    setProfileEditMessage(message);
  };

  const openNicknameEditor = () => {
    const profile = resolveEditableProfile();
    const check = canChangeNickname(profile);
    if (!check.ok) {
      setProfileEditMessage(check.message);
      setIsNicknameEditing(false);
      return;
    }
    setProfileEditMessage("");
    setNicknameDraft(profile.nickname);
    setIsNicknameEditing(true);
  };

  const cancelNicknameEdit = () => {
    setIsNicknameEditing(false);
    setNicknameDraft("");
    setProfileEditMessage("");
  };

  const submitNicknameChange = async () => {
    if (!userId) {
      return;
    }
    const validationError = validateNicknameInput(nicknameDraft);
    if (validationError) {
      setProfileEditMessage(validationError);
      return;
    }
    const trimmed = nicknameDraft.trim();
    const baseProfile = resolveEditableProfile();
    if (trimmed === baseProfile.nickname) {
      setProfileEditMessage("현재 닉네임과 같아요.");
      return;
    }
    const check = canChangeNickname(baseProfile);
    if (!check.ok) {
      setProfileEditMessage(check.message);
      return;
    }
    try {
      setIsProfileSaving(true);
      const updated = applyNicknameChange(baseProfile, trimmed);
      await persistUserProfile(updated, "닉네임을 저장했어요.");
      setProfileUsername(updated.nickname);
      setIsNicknameEditing(false);
    } catch {
      setProfileEditMessage("저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleProfileAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !userId) {
      return;
    }
    try {
      setIsProfileSaving(true);
      setProfileEditMessage("");
      const avatarUrl = await readProfileImageAsDataUrl(file);
      const updated = applyAvatarChange(resolveEditableProfile(), avatarUrl);
      await persistUserProfile(updated, "프로필 사진을 저장했어요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "사진 저장에 실패했어요.";
      setProfileEditMessage(message);
    } finally {
      setIsProfileSaving(false);
    }
  };

  const removeProfileAvatar = async () => {
    if (!userId || !profileAvatarUrl) {
      return;
    }
    try {
      setIsProfileSaving(true);
      setProfileEditMessage("");
      const updated = applyAvatarChange(resolveEditableProfile(), null);
      await persistUserProfile(updated, "프로필 사진을 제거했어요.");
    } catch {
      setProfileEditMessage("사진 제거에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsProfileSaving(false);
    }
  };

  const resetAuthForm = () => {
    setLoginMessage("");
    setSignupPasswordConfirm("");
  };

  const openLoginScreen = () => {
    setIsMenuOpen(false);
    setIsLoginOpen(true);
    setAuthMode("login");
    resetAuthForm();
  };

  const openSignUpScreen = () => {
    setIsMenuOpen(false);
    setIsLoginOpen(true);
    setAuthMode("signup");
    resetAuthForm();
  };

  const sanitizeAuthId = (id: string) => id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

  const validateAuthEmailInput = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "이메일과 비밀번호를 입력해 주세요.";
    }
    if (trimmed.includes("@")) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return "이메일 형식이 올바르지 않아요.";
      }
      return null;
    }
    if (sanitizeAuthId(trimmed).length < 2) {
      return "이메일을 입력해 주세요.";
    }
    return null;
  };

  const normalizeAuthEmail = (idOrEmail: string) => {
    const trimmed = idOrEmail.trim();
    if (trimmed.includes("@")) {
      return trimmed.toLowerCase();
    }
    const local = sanitizeAuthId(trimmed);
    if (!local) {
      throw new Error("INVALID_AUTH_ID");
    }
    return `${local}@${AUTH_EMAIL_DOMAIN}`;
  };

  const authEmailsForLogin = (idOrEmail: string) => {
    const trimmed = idOrEmail.trim();
    if (trimmed.includes("@")) {
      return [trimmed.toLowerCase()];
    }
    const local = sanitizeAuthId(trimmed);
    if (!local) {
      return [];
    }
    const domains = [AUTH_EMAIL_DOMAIN, ...LEGACY_AUTH_EMAIL_DOMAINS];
    return domains.map((domain) => `${local}@${domain}`);
  };

  const mapAuthErrorMessage = (message: string) => {
    const lower = message.toLowerCase();
    if (lower.includes("invalid_auth_id") || lower.includes("invalid auth")) {
      return "이메일 형식이 올바르지 않아요.";
    }
    if (lower.includes("already registered") || lower.includes("already been registered")) {
      return "이미 가입된 이메일이에요. 로그인해 주세요.";
    }
    if (lower.includes("invalid login credentials")) {
      return "이메일 또는 비밀번호가 맞지 않아요.";
    }
    if (lower.includes("email_address_invalid") || lower.includes("invalid email")) {
      return "이메일 형식이 올바르지 않아요.";
    }
    if (lower.includes("email not confirmed") || lower.includes("email_address_not_authorized")) {
      return "이메일 확인이 켜져 있어요. Supabase 대시보드에서 Confirm email을 끄거나, 가입 메일을 확인해 주세요.";
    }
    if (lower.includes("signup") && lower.includes("disabled")) {
      return "회원가입이 꺼져 있어요. Supabase Authentication 설정을 확인해 주세요.";
    }
    if (lower.includes("password") || lower.includes("weak")) {
      return "비밀번호는 8자 이상으로 입력해 주세요.";
    }
    if (lower.includes("rate limit") || lower.includes("too many")) {
      return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
    }
    if (lower.includes("supabase 환경 변수") || lower.includes("supabase 설정") || lower.includes("supabase url")) {
      return "서버에 Supabase 설정이 없어요. Vercel 환경 변수를 확인한 뒤 Redeploy 해 주세요.";
    }
    if (
      lower.includes("load failed") ||
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("network request failed") ||
      lower.includes("연결 시간")
    ) {
      return "Supabase 서버에 연결할 수 없어요. Vercel 환경 변수(URL·anon key)와 Supabase 프로젝트가 켜져 있는지 확인한 뒤, 배포를 다시 해 주세요.";
    }
    return message;
  };

  const completeAuthSession = async (successMessage: string, options?: { isNewSignup?: boolean }) => {
    setLoginMessage(successMessage);
    setIsLoginOpen(false);
    setAuthMode("login");
    setSignupPasswordConfirm("");
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user.id;
    const email = sessionData.session?.user.email;
    if (uid) {
      setUserId(uid);
      await loadGardenForUser(uid, { mergeSessionGuestIfEmpty: true, emailFallback: email });
      if (options?.isNewSignup) {
        await ensureSignupProfile(uid);
      }
    }
  };

  const submitLogin = async () => {
    const emailValidation = validateAuthEmailInput(loginId);
    if (emailValidation || !loginPassword.trim()) {
      setLoginMessage(emailValidation ?? "이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    const configIssue = getSupabaseConfigIssue();
    if (configIssue) {
      setLoginMessage(configIssue);
      return;
    }
    try {
      setIsLoginSubmitting(true);
      setLoginMessage("");
      await assertSupabaseReachable();
      const supabase = getSupabaseBrowserClient();
      const emails = authEmailsForLogin(loginId);
      if (emails.length === 0) {
        setLoginMessage("이메일 형식이 올바르지 않아요.");
        return;
      }

      let signedIn = false;
      let lastError = "";
      for (const email of emails) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: loginPassword,
        });
        if (!error) {
          signedIn = true;
          break;
        }
        lastError = error.message;
      }

      if (!signedIn) {
        setLoginMessage(`로그인 실패: ${mapAuthErrorMessage(lastError)}`);
        return;
      }

      await completeAuthSession("로그인 성공! 내 정원 데이터를 불러왔어요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      setLoginMessage(`로그인 실패: ${mapAuthErrorMessage(message)}`);
    } finally {
      setIsLoginSubmitting(false);
    }
  };

  const submitSignUp = async () => {
    const trimmedId = loginId.trim();
    const emailValidation = validateAuthEmailInput(trimmedId);
    if (emailValidation || !loginPassword.trim()) {
      setLoginMessage(emailValidation ?? "이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    if (loginPassword.length < 8) {
      setLoginMessage("비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }
    if (loginPassword !== signupPasswordConfirm) {
      setLoginMessage("비밀번호 확인이 일치하지 않아요.");
      return;
    }
    const configIssue = getSupabaseConfigIssue();
    if (configIssue) {
      setLoginMessage(configIssue);
      return;
    }
    try {
      setIsLoginSubmitting(true);
      setLoginMessage("가입 서버에 연결 중...");
      await assertSupabaseReachable();
      setLoginMessage("");
      const supabase = getSupabaseBrowserClient();
      const signUpEmail = normalizeAuthEmail(trimmedId);
      const { data, error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: loginPassword,
        options: {
          data: {
            username: trimmedId,
          },
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) {
        setLoginMessage(`회원가입 실패: ${mapAuthErrorMessage(error.message)}`);
        return;
      }

      if (data.session?.user?.id) {
        await completeAuthSession("회원가입 완료! 환영해요.", { isNewSignup: true });
        return;
      }

      if (data.user?.identities && data.user.identities.length === 0) {
        setLoginMessage("이미 가입된 이메일이에요. 로그인해 주세요.");
        setAuthMode("login");
        return;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: signUpEmail,
        password: loginPassword,
      });
      if (!signInError && signInData.session?.user?.id) {
        await completeAuthSession("회원가입 완료! 환영해요.", { isNewSignup: true });
        return;
      }

      if (signInError?.message.toLowerCase().includes("email not confirmed")) {
        setLoginMessage(
          "가입은 됐지만 이메일 확인이 필요해요. Supabase → Authentication → Providers → Email에서 Confirm email을 끄고 다시 시도해 주세요."
        );
        setAuthMode("login");
        return;
      }

      setLoginMessage("회원가입 완료! 아래에서 로그인해 주세요.");
      setAuthMode("login");
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      setLoginMessage(`회원가입 실패: ${mapAuthErrorMessage(message)}`);
    } finally {
      setIsLoginSubmitting(false);
    }
  };

  const handleAuthFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authMode === "signup") {
      void submitSignUp();
    } else {
      void submitLogin();
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
          <GardenWorldView
            birds={gardenBirds}
            records={birdRecords}
            selectedBirdId={selectedGardenBirdId}
            deleteConfirm={gardenBirdDeleteConfirm}
            onBirdClick={openGardenBirdDetail}
            onRequestDelete={requestGardenBirdDelete}
            onConfirmDelete={() => void confirmGardenBirdDelete()}
            onCancelDelete={cancelGardenBirdDelete}
          />
        </div>

        {!isCalendarOpen && !isArchiveGardenOpen && !isRankingOpen ? (
          <button type="button" className="add-bird-button" onClick={openBirdList}>
            + 오늘의 새 추가하기
          </button>
        ) : null}

        {gardenSyncError && isLoggedIn ? (
          <p className="garden-sync-error" role="alert">
            {gardenSyncError}
          </p>
        ) : null}

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
                {renderProfileAvatar("profile-avatar--small")}
              </button>
              {isProfileOpen ? (
                <div className="profile-menu" role="dialog" aria-label="프로필">
                  <input
                    ref={profileAvatarInputRef}
                    type="file"
                    accept="image/*"
                    className="profile-avatar-file-input"
                    onChange={(event) => void handleProfileAvatarChange(event)}
                    disabled={isProfileSaving}
                  />
                  <button
                    type="button"
                    className="profile-avatar-picker"
                    onClick={() => profileAvatarInputRef.current?.click()}
                    disabled={isProfileSaving}
                    aria-label="프로필 사진 변경"
                  >
                    {renderProfileAvatar("profile-avatar--large")}
                    <span className="profile-avatar-picker-label">
                      {isProfileSaving ? "저장 중..." : "사진 변경"}
                    </span>
                  </button>
                  {profileAvatarUrl ? (
                    <button
                      type="button"
                      className="profile-menu-avatar-remove"
                      onClick={() => void removeProfileAvatar()}
                      disabled={isProfileSaving}
                    >
                      사진 제거
                    </button>
                  ) : null}
                  <p className="profile-menu-id">{profileUsername || "사용자"}</p>
                  {!isNicknameEditing ? (
                    <button type="button" className="profile-menu-edit" onClick={openNicknameEditor}>
                      닉네임 수정
                    </button>
                  ) : (
                    <div className="profile-menu-edit-form">
                      <label className="profile-menu-edit-label" htmlFor="profile-nickname-input">
                        닉네임
                      </label>
                      <input
                        id="profile-nickname-input"
                        type="text"
                        className="profile-menu-edit-input"
                        value={nicknameDraft}
                        onChange={(event) => setNicknameDraft(event.target.value)}
                        maxLength={12}
                        autoComplete="nickname"
                        disabled={isProfileSaving}
                      />
                      <div className="profile-menu-edit-actions">
                        <button
                          type="button"
                          className="profile-menu-edit-save"
                          onClick={() => void submitNicknameChange()}
                          disabled={isProfileSaving}
                        >
                          {isProfileSaving ? "저장 중..." : "저장"}
                        </button>
                        <button
                          type="button"
                          className="profile-menu-edit-cancel"
                          onClick={cancelNicknameEdit}
                          disabled={isProfileSaving}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                  {profileEditMessage ? <p className="profile-menu-message">{profileEditMessage}</p> : null}
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
                onClick={openUnlistedBirdRegistration}
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
                      {item.imageSrc ? (
                        <Image
                          src={item.imageSrc}
                          alt={item.name}
                          fill
                          sizes="72px"
                          className="bird-list-thumb-img"
                        />
                      ) : (
                        <span>새 사진</span>
                      )}
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

        {isBirdInfoScreenOpen && birdRegistrationMode === "unlisted" ? (
          <div className="bird-new-register-screen" role="dialog" aria-modal="true" aria-label="신규 조류 등록">
            <header className="bird-new-register-header">
              <button
                type="button"
                className="bird-new-register-back"
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
                  className="bird-new-register-back-img"
                />
              </button>
              <div className="bird-new-register-title-plank">
                <span className="bird-new-register-star bird-new-register-star--left" aria-hidden>
                  🌿
                </span>
                <span className="bird-new-register-star bird-new-register-star--right" aria-hidden>
                  🍃
                </span>
                <h1 className="bird-new-register-title">신규 조류 등록!!</h1>
              </div>
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

            <div className="bird-new-register-scroll">
              <div className="bird-new-register-panel">
                <div className="bird-new-register-photo-box">
                  {isPhotoPopupOpen && !photoPreviewUrl && canOpenPhotoPopup ? (
                    <div className="bird-new-register-photo-popup" role="group" aria-label="사진 선택">
                      <button
                        type="button"
                        className="bird-new-register-photo-popup-btn"
                        onClick={() => cameraInputRef.current?.click()}
                      >
                        촬영하기
                      </button>
                      <button
                        type="button"
                        className="bird-new-register-photo-popup-btn"
                        onClick={() => galleryInputRef.current?.click()}
                      >
                        사진 업로드
                      </button>
                    </div>
                  ) : null}
                  <div
                    className="bird-new-register-photo-hit"
                    role="button"
                    tabIndex={0}
                    onClick={togglePhotoPopupFromHit}
                    onKeyDown={onPhotoHitKeyDown}
                    aria-label="사진 찍기"
                  >
                    {photoPreviewUrl ? (
                      <span className="bird-new-register-photo-preview-wrap">
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
                        <img
                          src={photoPreviewUrl}
                          alt="선택한 새 사진 미리보기"
                          className="bird-new-register-photo-preview"
                        />
                      </span>
                    ) : (
                      <span className="bird-new-register-photo-label">사진 찍기</span>
                    )}
                  </div>
                </div>

                <input
                  id="bird-new-name-input"
                  type="text"
                  className="bird-new-register-name-input"
                  placeholder="이름 입력"
                  value={birdName}
                  onChange={(e) => setBirdName(e.target.value)}
                  aria-label="이름 입력"
                  autoComplete="off"
                />

                <label className="bird-new-register-desc-label" htmlFor="bird-new-desc-input">
                  설명 입력:
                </label>
                <textarea
                  id="bird-new-desc-input"
                  className="bird-new-register-desc-input"
                  value={birdFeature}
                  onChange={(e) => setBirdFeature(e.target.value)}
                  rows={4}
                  aria-label="설명 입력"
                />

                <button type="button" className="bird-new-register-submit" onClick={submitBirdRegistration}>
                  목록에 추가하기
                </button>
              </div>
            </div>
          </div>
        ) : isBirdInfoScreenOpen ? (
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

        {registrationConfirm ? (
          <div className="bird-confirm-screen" role="dialog" aria-modal="true" aria-label="등록 확정">
            <header className="bird-confirm-header">
              <button
                type="button"
                className="bird-confirm-back"
                onClick={closeRegistrationConfirm}
                aria-label="홈으로 돌아가기"
              >
                <img
                  src="/left.png"
                  alt=""
                  width={48}
                  height={48}
                  decoding="sync"
                  fetchPriority="high"
                  className="bird-confirm-back-img"
                />
              </button>
              <h1 className="bird-confirm-title">짹짹짹!</h1>
            </header>

            <div className="bird-confirm-body">
              <div className="bird-confirm-photo-wrap">
                <span className="bird-confirm-confetti bird-confirm-confetti--tl" aria-hidden>
                  🌿
                </span>
                <span className="bird-confirm-confetti bird-confirm-confetti--br" aria-hidden>
                  🪶
                </span>
                <div className="bird-confirm-photo-frame">
                  {registrationConfirm.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={registrationConfirm.photoUrl}
                      alt={registrationConfirm.speciesName}
                      className="bird-confirm-photo-img"
                    />
                  ) : (
                    <div className="bird-confirm-photo-default">
                      <Image
                        src={registrationConfirm.fallbackImageSrc}
                        alt={registrationConfirm.speciesName}
                        fill
                        sizes="240px"
                        className="bird-confirm-photo-default-img"
                      />
                    </div>
                  )}
                </div>
              </div>

              {registrationConfirm.isFirstDiscovery ? (
                <p className="bird-confirm-message">
                  <span className="bird-confirm-message-name">{registrationConfirm.speciesName}</span>를 처음
                  발견하셨네요!
                </p>
              ) : (
                <p className="bird-confirm-message">
                  <span className="bird-confirm-message-name">{registrationConfirm.speciesName}</span>를 벌써{" "}
                  <span className="bird-confirm-message-count">{registrationConfirm.totalSightings}</span>번이나
                  발견하셨네요!
                </p>
              )}

              {registrationConfirm.weeklyRankBanner ? (
                <p className="bird-confirm-rank-banner" role="status">
                  {registrationConfirm.weeklyRankBanner}
                </p>
              ) : null}

              <button type="button" className="bird-confirm-home-btn" onClick={closeRegistrationConfirm}>
                홈으로 가기
              </button>
            </div>
          </div>
        ) : null}


        {isArchiveGardenOpen && archiveViewSnapshot ? (
          <div className="bird-archive-garden-screen" role="dialog" aria-modal="true" aria-label="이날의 정원">
            <header className="bird-archive-garden-header">
              <button type="button" className="bird-archive-garden-back" onClick={closeArchiveGarden} aria-label="캘린더로 돌아가기">
                <img src="/left.png" alt="" width={48} height={48} decoding="sync" className="bird-archive-garden-back-img" />
              </button>
              <h1 className="bird-archive-garden-title">
                {parseDateKey(selectedCalendarDateKey).month}월 {parseDateKey(selectedCalendarDateKey).day}일의 정원
              </h1>
            </header>
            <div className="garden-scroll bird-archive-garden-scroll" ref={archiveScrollRef}>
              <GardenWorldView birds={archiveViewSnapshot.birds} records={archiveViewSnapshot.records} readOnly />
            </div>
          </div>
        ) : null}

        {isCalendarOpen ? (
          <div className="bird-calendar-screen" role="dialog" aria-modal="true" aria-label="캘린더">
            <header className="bird-calendar-header">
              <button type="button" className="bird-calendar-close" onClick={closeCalendar} aria-label="캘린더 닫기">
                <img src="/x.png" alt="" width={48} height={48} decoding="sync" className="bird-calendar-close-img" />
              </button>
            </header>

            <div className="bird-calendar-body">
              <div className="bird-calendar-month-bar">
                <button
                  type="button"
                  className="bird-calendar-month-nav"
                  onClick={() => setCalendarMonth((prev) => shiftCalendarMonth(prev.year, prev.month, -1))}
                  aria-label="이전 달"
                >
                  ‹
                </button>
                <p className="bird-calendar-month-label">{formatMonthLabel(calendarMonth.year, calendarMonth.month)}</p>
                <button
                  type="button"
                  className="bird-calendar-month-nav"
                  onClick={() => setCalendarMonth((prev) => shiftCalendarMonth(prev.year, prev.month, 1))}
                  aria-label="다음 달"
                >
                  ›
                </button>
              </div>

              <div className="bird-calendar-weekdays" aria-hidden>
                {calendarWeekdays.map((label) => (
                  <span key={label} className="bird-calendar-weekday">
                    {label}
                  </span>
                ))}
              </div>

              <div className="bird-calendar-grid">
                {calendarCells.map((day, index) => {
                  if (day === null) {
                    return <span key={`empty-${index}`} className="bird-calendar-day bird-calendar-day--empty" />;
                  }
                  const dateKey = toDateKey(calendarMonth.year, calendarMonth.month, day);
                  const isSelected = dateKey === selectedCalendarDateKey;
                  const isFuture = dateKey > todayDateKey;
                  const hasGarden = dateKeyHasGarden(dateKey, dailyArchives, {
                    birds: gardenBirds,
                    records: birdRecords,
                  });
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      className={`bird-calendar-day${isSelected ? " bird-calendar-day--selected" : ""}${hasGarden ? " bird-calendar-day--has-garden" : ""}`}
                      disabled={isFuture}
                      onClick={() => setSelectedCalendarDateKey(dateKey)}
                    >
                      <span className="bird-calendar-day-num">{day}</span>
                    </button>
                  );
                })}
              </div>

              <hr className="bird-calendar-divider" />

              <div className="bird-calendar-summary">
                <div className="bird-calendar-stats">
                  <p className="bird-calendar-stat-row bird-calendar-stat-row--total">
                    <span className="bird-calendar-stat-label">Total</span>
                    <span className="bird-calendar-stat-value">{selectedDayStats.total}마리</span>
                  </p>
                  {selectedDayStats.bySpecies.map((row) => (
                    <p key={row.name} className="bird-calendar-stat-row">
                      <span className="bird-calendar-stat-label">{row.name}</span>
                      <span className="bird-calendar-stat-value">{row.count}마리</span>
                    </p>
                  ))}
                </div>

                <div className="bird-calendar-preview-col">
                  <div className="bird-calendar-preview" aria-hidden={selectedDayStats.total === 0}>
                    {selectedDaySnapshot && selectedDaySnapshot.birds.length > 0 ? (
                      <GardenWorldView
                        birds={selectedDaySnapshot.birds}
                        records={selectedDaySnapshot.records}
                        readOnly
                        className="garden-world--mini"
                      />
                    ) : (
                      <span className="bird-calendar-preview-empty">이날의 정원</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="bird-calendar-view-link"
                    onClick={openArchiveGarden}
                    disabled={!selectedDaySnapshot || selectedDaySnapshot.birds.length === 0}
                  >
                    이날의 정원 보기
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isRankingOpen ? (
          <div className="bird-ranking-screen" role="dialog" aria-modal="true" aria-label="주간 랭킹">
            <header className="bird-ranking-header">
              <button type="button" className="bird-ranking-close" onClick={closeRanking} aria-label="랭킹 닫기">
                <img src="/x.png" alt="" width={48} height={48} decoding="sync" className="bird-ranking-close-img" />
              </button>
              <div className="bird-ranking-title-wrap">
                <h1 className="bird-ranking-title">주간 랭킹</h1>
                <p className="bird-ranking-subtitle">
                  {formatKstWeekLabel(currentWeekKey)}
                  {formatKstWeekPeriod(currentWeekKey) ? ` · ${formatKstWeekPeriod(currentWeekKey)}` : ""}
                </p>
              </div>
            </header>

            <div className="bird-ranking-body">
              <p className="bird-ranking-desc">이번 주 가장 많이 조류를 발견한 순위예요. 매주 월요일에 새로 시작돼요.</p>

              {!isLoggedIn ? (
                <div className="bird-ranking-guest">
                  <p>로그인하면 주간 랭킹에 참여할 수 있어요.</p>
                  <button type="button" className="bird-ranking-login-btn" onClick={openLoginScreen}>
                    로그인하기
                  </button>
                </div>
              ) : isRankingLoading ? (
                <p className="bird-ranking-status">불러오는 중…</p>
              ) : rankingError ? (
                <p className="bird-ranking-status bird-ranking-status--error" role="alert">
                  {rankingError}
                </p>
              ) : weeklyLeaderboard.length === 0 ? (
                <p className="bird-ranking-status">아직 이번 주 기록이 없어요. 첫 발견의 주인공이 되어 보세요!</p>
              ) : (
                <ol className="bird-ranking-list">
                  {weeklyLeaderboard.map((row, index) => {
                    const rank = index + 1;
                    const isMe = row.user_id === userId;
                    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
                    return (
                      <li
                        key={row.user_id}
                        className={`bird-ranking-item${isMe ? " bird-ranking-item--me" : ""}`}
                      >
                        <span className="bird-ranking-rank" aria-hidden>
                          {medal ?? rank}
                        </span>
                        <span className="bird-ranking-name">{row.nickname || "탐험가"}</span>
                        <span className="bird-ranking-score">{row.discovery_count}마리</span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {isLoggedIn && myWeeklyRank !== null ? (
                <p className="bird-ranking-my-rank">
                  내 순위: <strong>{myWeeklyRank}위</strong>
                  {myWeeklyEntry ? ` · ${myWeeklyEntry.discovery_count}마리` : ""}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {isDexOpen ? (
          <div className="bird-dex-screen" role="dialog" aria-modal="true" aria-label="조류 도감">
            <header className="bird-dex-header">
              <button type="button" className="bird-dex-close" onClick={closeDex} aria-label="도감 닫기">
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
                {dexDisplayEntries.map((entry) => (
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
                          {entry.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={entry.photoUrl}
                              alt={entry.name ?? "조류"}
                              className="bird-dex-card-img bird-dex-card-img--uploaded"
                            />
                          ) : (
                            <Image
                              src={entry.imageSrc}
                              alt={entry.name ?? "조류"}
                              fill
                              sizes="120px"
                              className="bird-dex-card-img"
                            />
                          )}
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
          <div className="bird-login-screen" role="dialog" aria-modal="true" aria-label={authMode === "signup" ? "회원가입" : "로그인"}>
            <header className="bird-login-header">
              <button type="button" className="bird-login-close" onClick={() => setIsLoginOpen(false)} aria-label="로그인 닫기">
                <img src="/x.png" alt="" width={48} height={48} decoding="sync" className="bird-login-close-img" />
              </button>
              <h2 className="bird-login-title">{authMode === "signup" ? "회원가입" : "로그인"}</h2>
            </header>

            <form className="bird-login-body" onSubmit={handleAuthFormSubmit}>
              <label className="bird-login-label" htmlFor="login-id-input">
                이메일
              </label>
              <input
                id="login-id-input"
                type="email"
                className="bird-login-input"
                placeholder="이메일을 입력하세요"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
              />
              <label className="bird-login-label" htmlFor="login-password-input">
                비밀번호
              </label>
              <input
                id="login-password-input"
                type="password"
                className="bird-login-input"
                placeholder={authMode === "signup" ? "8자 이상 비밀번호" : "비밀번호를 입력하세요"}
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              />
              {authMode === "signup" ? (
                <>
                  <label className="bird-login-label" htmlFor="signup-password-confirm-input">
                    비밀번호 확인
                  </label>
                  <input
                    id="signup-password-confirm-input"
                    type="password"
                    className="bird-login-input"
                    placeholder="비밀번호를 다시 입력하세요"
                    value={signupPasswordConfirm}
                    onChange={(event) => setSignupPasswordConfirm(event.target.value)}
                    autoComplete="new-password"
                  />
                </>
              ) : null}
              <button type="submit" className="bird-login-submit" disabled={isLoginSubmitting}>
                {isLoginSubmitting
                  ? authMode === "signup"
                    ? "가입 중..."
                    : "로그인 중..."
                  : authMode === "signup"
                    ? "회원가입"
                    : "로그인"}
              </button>
              {authMode === "login" ? (
                <button
                  type="button"
                  className="bird-login-signup-link"
                  onClick={() => {
                    setAuthMode("signup");
                    setLoginMessage("");
                  }}
                  disabled={isLoginSubmitting}
                >
                  회원가입하기
                </button>
              ) : (
                <button
                  type="button"
                  className="bird-login-signup-link"
                  onClick={() => {
                    setAuthMode("login");
                    setLoginMessage("");
                    setSignupPasswordConfirm("");
                  }}
                  disabled={isLoginSubmitting}
                >
                  이미 계정이 있어요? 로그인하기
                </button>
              )}
              {loginMessage ? <p className="bird-login-message">{loginMessage}</p> : null}
            </form>
          </div>
        ) : null}
      </section>
    </main>
  );
}
