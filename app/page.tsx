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
import { LocationMap, type MapViewerPoint } from "@/components/location-map";
import { createGardenBirds, normalizePlacedBirds } from "@/lib/garden-birds";
import {
  applyGardenDayRollover,
  buildCalendarCells,
  computeDayBirdStats,
  countLifetimeSpeciesSightings,
  createdAtForDateKey,
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
import {
  collectSpeciesSightings,
  findBirdRecordById,
  getDexDetailDisplay,
  KNOWN_DEX_SPECIES,
} from "@/lib/garden-dex";
import {
  getListedSpeciesByRecord,
  isCustomListBirdId,
  LISTED_SPECIES,
  speciesUsesSexSplit,
} from "@/lib/species-catalog";
import {
  mergeArchiveRecordMapCoords,
  mergeRecordMapCoords,
  recordHasSavedMapCoord,
  resolveRecordMapCoord,
  saveRecordMapCoord,
} from "@/lib/record-map-coords";
import {
  applyRecordCountChange,
  collectSpeciesLabelsFromGarden,
  gardenPayloadNeedsMigration,
  buildDexStateFromGarden,
  migrateGardenPayload,
} from "@/lib/garden-records";
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
import {
  deleteSharedListBird,
  ensureGlobalSharedListSync,
  fetchSharedListBirds,
  insertSharedListBird,
  migrateLegacyCustomListBirdsToShared,
  updateSharedListBird,
  type SharedListBird,
} from "@/lib/supabase/shared-list-birds";

type MenuItem = {
  label: string;
  icon: string;
};

type ListBird = {
  id: string;
  name: string;
  imageSrc?: string;
  listBlurb?: string;
  isPlaceholder?: boolean;
  isCustom?: boolean;
  /** 공용 목록 등록자 — 본인만 수정·삭제 */
  createdBy?: string;
};

const BIRD_LIST_ITEMS: ListBird[] = LISTED_SPECIES.map((species) => ({
  id: species.id,
  name: species.name,
  imageSrc: species.imageSrc,
  listBlurb: species.listBlurb,
}));

const shortenCustomListBlurb = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "직접 등록";
  }
  const firstLine = trimmed.split(/[.。!?\n]/)[0]?.trim() ?? trimmed;
  return firstLine.length <= 34 ? firstLine : firstLine.slice(0, 34).trim();
};

const DEX_SLOT_COUNT = 15;

type DexDisplayEntry = {
  id: string;
  name?: string;
  imageSrc: string;
  unlocked: boolean;
  isNew: boolean;
  photoUrl: string | null;
};

type BirdPoint = {
  lat: number;
  lng: number;
};

type BirdMapGroup = {
  id: string;
  lat: number;
  lng: number;
  totalCount: number;
  records: BirdRecord[];
};

/** 이날의 정원 닫을 때 돌아갈 화면 */
type ArchiveGardenReturnTarget =
  | { type: "calendar" }
  | { type: "dex-detail"; speciesName: string };

const LOCKED_DEX_IMAGE = "/qm.png";

const getSpeciesPhotoFromRecords = (records: BirdRecord[], speciesName: string) => {
  const match = [...records]
    .reverse()
    .find((record) => getRecordSpeciesLabel(record) === speciesName && record.photoUrl);
  return match?.photoUrl ?? null;
};

const buildDexDisplayEntries = (
  records: BirdRecord[],
  dailyArchives: Record<string, DailyGardenArchive> | undefined,
  dexUnlockedSpecies: string[],
  dexSeenSpecies: string[]
): DexDisplayEntry[] => {
  const seen = new Set(dexSeenSpecies);
  const unlockedNames = new Set([
    ...dexUnlockedSpecies,
    ...collectSpeciesLabelsFromGarden(records, dailyArchives),
  ]);
  const knownNames = new Set(KNOWN_DEX_SPECIES.map((species) => species.name));

  const entries: DexDisplayEntry[] = KNOWN_DEX_SPECIES.map((species) => {
    const unlocked = unlockedNames.has(species.name);
    return {
      id: species.id,
      name: species.name,
      imageSrc: species.imageSrc,
      unlocked,
      isNew: unlocked && !seen.has(species.name),
      /** 목록 도감 종(청둥오리 등) — 등록 사진이 아닌 catalog imageSrc 고정 */
      photoUrl: null,
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
      imageSrc: LOCKED_DEX_IMAGE,
      unlocked: false,
      isNew: false,
      photoUrl: null,
    });
  }

  return entries.slice(0, DEX_SLOT_COUNT);
};

const GARDEN_STORAGE_KEY = "birdy-garden:birds:v1";
const DEFAULT_BIRD_IMAGE = "/duck.png";
const EMPTY_GARDEN_PAYLOAD: UserGardenPayload = { birds: [], records: [], dexUnlockedSpecies: [], dexSeenSpecies: [] };
const DEFAULT_MAP_CENTER: BirdPoint = { lat: 37.5665, lng: 126.978 };

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

const getRecordMapImageSrc = (record: BirdRecord) => {
  if (isCustomListBirdId(record.listBirdId) && record.photoUrl) {
    return record.photoUrl;
  }
  const listed = getListedSpeciesByRecord(record);
  if (listed) {
    return listed.imageSrc;
  }
  const species = getRecordSpeciesLabel(record);
  return getSpeciesFallbackImageSrc(species || record.name);
};

const collectAllMapRecords = (
  records: BirdRecord[],
  archives: Record<string, DailyGardenArchive> | undefined
): BirdRecord[] => {
  const byId = new Map<string, BirdRecord>();
  for (const record of records) {
    byId.set(record.id, record);
  }
  if (archives) {
    for (const archive of Object.values(archives)) {
      for (const record of archive.records) {
        if (!byId.has(record.id)) {
          byId.set(record.id, record);
        }
      }
    }
  }
  return [...byId.values()];
};

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBirdListOpen, setIsBirdListOpen] = useState(false);
  const [selectedListBirdId, setSelectedListBirdId] = useState<string | null>(null);
  const [isBirdInfoScreenOpen, setIsBirdInfoScreenOpen] = useState(false);
  const [birdRegistrationMode, setBirdRegistrationMode] = useState<"listed" | "unlisted">("listed");
  const [canOpenPhotoPopup, setCanOpenPhotoPopup] = useState(true);
  const [birdName, setBirdName] = useState("청둥오리");
  const [registrationSpeciesName, setRegistrationSpeciesName] = useState<string | null>(null);
  const [birdFeature, setBirdFeature] = useState("");
  const [birdCount, setBirdCount] = useState(1);
  const [birdMaleCount, setBirdMaleCount] = useState(1);
  const [birdFemaleCount, setBirdFemaleCount] = useState(0);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isDexOpen, setIsDexOpen] = useState(false);
  const [dexDetailSpecies, setDexDetailSpecies] = useState<string | null>(null);
  const [isDexDescPopupOpen, setIsDexDescPopupOpen] = useState(false);
  const [dexDescOverflows, setDexDescOverflows] = useState(false);
  const dexDescWrapRef = useRef<HTMLDivElement>(null);
  const [dexMenuRecordId, setDexMenuRecordId] = useState<string | null>(null);
  const [dexEditRecordId, setDexEditRecordId] = useState<string | null>(null);
  const [dexEditCount, setDexEditCount] = useState(1);
  const [dexEditFeature, setDexEditFeature] = useState("");
  const [dexUnlockedSpecies, setDexUnlockedSpecies] = useState<string[]>([]);
  const [dexSeenSpecies, setDexSeenSpecies] = useState<string[]>([]);
  const [gardenBirds, setGardenBirds] = useState<PlacedBird[]>([]);
  const [birdRecords, setBirdRecords] = useState<BirdRecord[]>([]);
  const [sharedListBirds, setSharedListBirds] = useState<SharedListBird[]>([]);
  const [editingCustomListBirdId, setEditingCustomListBirdId] = useState<string | null>(null);
  const [customListDeleteConfirmId, setCustomListDeleteConfirmId] = useState<string | null>(null);
  const [isGardenHydrated, setIsGardenHydrated] = useState(false);
  const [isGardenSyncing, setIsGardenSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [isLogoutSubmitting, setIsLogoutSubmitting] = useState(false);
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
  const [archiveGardenReturnTarget, setArchiveGardenReturnTarget] = useState<ArchiveGardenReturnTarget | null>(
    null
  );
  /** 캘린더 이날의 정원에서 추가하기 플로우 — 해당 날짜 아카이브에 저장 */
  const [archiveAddFlowDateKey, setArchiveAddFlowDateKey] = useState<string | null>(null);
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
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapSession, setMapSession] = useState(0);
  const [mapPickerSession, setMapPickerSession] = useState(0);
  const [mapCenter, setMapCenter] = useState<BirdPoint>(DEFAULT_MAP_CENTER);
  const [pickedLocation, setPickedLocation] = useState<BirdPoint | null>(null);
  const [selectedMapGroupId, setSelectedMapGroupId] = useState<string | null>(null);
  const [selectedMapRecordId, setSelectedMapRecordId] = useState<string | null>(null);
  const [editingMapRecordId, setEditingMapRecordId] = useState<string | null>(null);
  const [mapEditCount, setMapEditCount] = useState(1);
  const [mapEditFeature, setMapEditFeature] = useState("");
  const [mapEditLocation, setMapEditLocation] = useState<BirdPoint | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCenteredGardenScrollRef = useRef(false);
  const archiveScrollRef = useRef<HTMLDivElement>(null);
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
    sharedListBirds,
    dexUnlockedSpecies,
    dexSeenSpecies,
    userProfile,
    dailyArchives,
    currentGardenDate,
  });

  const displayBirdListItems = useMemo<ListBird[]>(
    () => [
      ...BIRD_LIST_ITEMS,
      ...sharedListBirds.map((custom) => ({
        id: custom.id,
        name: custom.name,
        imageSrc: custom.imageSrc,
        listBlurb: shortenCustomListBlurb(custom.description),
        isCustom: true,
        createdBy: custom.createdBy,
      })),
    ],
    [sharedListBirds]
  );

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
    return (
      resolveDaySnapshot(selectedCalendarDateKey, dailyArchives, {
        birds: gardenBirds,
        records: birdRecords,
      }) ?? {
        birds: [],
        records: [],
        savedAt: new Date().toISOString(),
      }
    );
  }, [isArchiveGardenOpen, selectedCalendarDateKey, dailyArchives, gardenBirds, birdRecords]);

  const showArchiveGardenScreen =
    isArchiveGardenOpen &&
    archiveViewSnapshot !== null &&
    !isBirdListOpen &&
    !isBirdInfoScreenOpen &&
    registrationConfirm === null;

  useLayoutEffect(() => {
    if (!isArchiveGardenOpen) {
      return;
    }
    const scrollEl = archiveScrollRef.current;
    if (!scrollEl) {
      return;
    }
    scrollEl.scrollLeft = 0;
  }, [isArchiveGardenOpen, selectedCalendarDateKey, archiveViewSnapshot?.birds.length]);

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth.year, calendarMonth.month),
    [calendarMonth.year, calendarMonth.month]
  );

  const calendarWeekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

  const profileAvatarUrl = userProfile?.avatarUrl ?? null;

  const activeGardenBirds = useMemo(() => {
    if (isArchiveGardenOpen && archiveViewSnapshot) {
      return archiveViewSnapshot.birds;
    }
    return gardenBirds;
  }, [isArchiveGardenOpen, archiveViewSnapshot, gardenBirds]);

  const activeGardenRecords = useMemo(() => {
    if (isArchiveGardenOpen && archiveViewSnapshot) {
      return archiveViewSnapshot.records;
    }
    return birdRecords;
  }, [isArchiveGardenOpen, archiveViewSnapshot, birdRecords]);

  const selectedGardenBird = useMemo(
    () => activeGardenBirds.find((bird) => bird.id === selectedGardenBirdId) ?? null,
    [activeGardenBirds, selectedGardenBirdId]
  );

  const selectedGardenBirdRecord = useMemo(() => {
    if (!selectedGardenBird?.recordId) {
      return null;
    }
    return activeGardenRecords.find((record) => record.id === selectedGardenBird.recordId) ?? null;
  }, [activeGardenRecords, selectedGardenBird]);

  const allMapRecords = useMemo(
    () => collectAllMapRecords(birdRecords, dailyArchives),
    [birdRecords, dailyArchives]
  );

  const mapGroups = useMemo<BirdMapGroup[]>(() => {
    const grouped = new Map<string, BirdMapGroup>();
    for (const record of allMapRecords) {
      const coord = resolveRecordMapCoord(record, mapCenter);
      if (!coord) {
        continue;
      }
      const key = `${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          id: key,
          lat: coord.lat,
          lng: coord.lng,
          totalCount: Math.max(1, record.count),
          records: [record],
        });
      } else {
        existing.totalCount += Math.max(1, record.count);
        existing.records.push(record);
      }
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      records: [...group.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }));
  }, [allMapRecords, mapCenter]);

  const selectedMapGroup = useMemo(
    () => mapGroups.find((group) => group.id === selectedMapGroupId) ?? null,
    [mapGroups, selectedMapGroupId]
  );
  const selectedMapRecord = useMemo(
    () => selectedMapGroup?.records.find((record) => record.id === selectedMapRecordId) ?? null,
    [selectedMapGroup, selectedMapRecordId]
  );

  useEffect(() => {
    if (!selectedMapGroupId || mapGroups.some((group) => group.id === selectedMapGroupId)) {
      return;
    }
    setSelectedMapGroupId(null);
    setSelectedMapRecordId(null);
    setEditingMapRecordId(null);
  }, [mapGroups, selectedMapGroupId]);

  const mapViewerPoints = useMemo<MapViewerPoint[]>(
    () =>
      mapGroups.map((group) => {
        const latest = group.records[0];
        return {
          id: group.id,
          lat: group.lat,
          lng: group.lng,
          count: group.totalCount,
          imageSrc: latest ? getRecordMapImageSrc(latest) : DEFAULT_BIRD_IMAGE,
          selected: group.id === selectedMapGroupId,
          entries: group.records.map((record) => ({
            id: record.id,
            dateLabel: new Date(record.createdAt).toLocaleString("ko-KR", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
            count: Math.max(1, record.count),
            speciesName: record.speciesName || record.name,
            needsLocationFix: !recordHasSavedMapCoord(record),
          })),
        };
      }),
    [mapGroups, selectedMapGroupId]
  );

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
    const recordsWithMap = mergeRecordMapCoords(migrated.records);
    const archivesWithMap = mergeArchiveRecordMapCoords(migrated.dailyArchives) ?? {};
    setGardenBirds(normalizePlacedBirds(migrated.birds, recordsWithMap));
    setBirdRecords(recordsWithMap);
    setDexUnlockedSpecies(migrated.dexUnlockedSpecies ?? []);
    setDexSeenSpecies(migrated.dexSeenSpecies ?? []);
    setDailyArchives(archivesWithMap);
    setCurrentGardenDate(migrated.currentGardenDate ?? getKstDateKey());
    return { ...migrated, records: recordsWithMap, dailyArchives: archivesWithMap };
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
    setSharedListBirds([]);
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
      sharedListBirds,
      dexUnlockedSpecies,
      dexSeenSpecies,
      userProfile,
      dailyArchives,
      currentGardenDate,
    };
  }, [gardenBirds, birdRecords, sharedListBirds, dexUnlockedSpecies, dexSeenSpecies, userProfile, dailyArchives, currentGardenDate]);

  const buildGardenPayloadFromSnapshot = (snapshot = gardenSnapshotRef.current): UserGardenPayload => ({
    birds: snapshot.gardenBirds,
    records: snapshot.birdRecords,
    customListBirds: [],
    dexUnlockedSpecies: snapshot.dexUnlockedSpecies,
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

  const refreshSharedListBirds = async (
    uid: string,
    legacyFromPayload: { id: string; name: string; description: string; imageSrc: string; createdAt: string }[] = []
  ) => {
    if (!isSupabaseConfigured()) {
      setSharedListBirds([]);
      return [];
    }
    try {
      await ensureGlobalSharedListSync();
      let shared = await fetchSharedListBirds();
      if (legacyFromPayload.length > 0) {
        shared = await migrateLegacyCustomListBirdsToShared(uid, legacyFromPayload, shared);
      }
      setSharedListBirds(shared);
      return shared;
    } catch (error) {
      reportGardenSyncError(error);
      return [];
    }
  };

  const dexDisplayEntries = useMemo(
    () => buildDexDisplayEntries(birdRecords, dailyArchives, dexUnlockedSpecies, dexSeenSpecies),
    [birdRecords, dailyArchives, dexUnlockedSpecies, dexSeenSpecies]
  );

  const dexDetailDisplay = useMemo(
    () =>
      dexDetailSpecies
        ? getDexDetailDisplay(dexDetailSpecies, {
            records: birdRecords,
            archives: dailyArchives,
            customListBirds: sharedListBirds,
          })
        : null,
    [dexDetailSpecies, birdRecords, dailyArchives, sharedListBirds]
  );

  const dexDetailSightings = useMemo(() => {
    if (!dexDetailSpecies) {
      return { total: 0, entries: [] };
    }
    return collectSpeciesSightings(dexDetailSpecies, birdRecords, dailyArchives);
  }, [dexDetailSpecies, birdRecords, dailyArchives]);

  const dexDetailDescription = useMemo(() => {
    if (!dexDetailSpecies) {
      return "";
    }
    return (
      dexDetailDisplay?.description ??
      `${dexDetailSpecies}에 대한 설명이 아직 준비되지 않았어요. 발견 기록을 쌓아 도감을 채워 보세요.`
    );
  }, [dexDetailDisplay?.description, dexDetailSpecies]);

  useLayoutEffect(() => {
    if (!dexDetailSpecies) {
      setDexDescOverflows(false);
      return;
    }
    const el = dexDescWrapRef.current;
    if (!el) {
      return;
    }

    const measure = () => {
      setDexDescOverflows(el.scrollHeight > el.clientHeight + 2);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dexDetailDescription, dexDetailSpecies]);

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
          dexUnlockedSpecies: sessionGuest.dexUnlockedSpecies ?? sessionGuest.dexSeenSpecies ?? [],
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
        await refreshSharedListBirds(uid, hydratedPayload.customListBirds ?? []);
        return;
      }
      const legacyCustom = hydratedPayload.customListBirds ?? [];
      const migratedPayload = applyGardenPayload(hydratedPayload);
      await refreshSharedListBirds(uid, legacyCustom);
      const dexFromGarden = buildDexStateFromGarden(
        migratedPayload.records,
        migratedPayload.dailyArchives,
        migratedPayload.dexSeenSpecies ?? []
      );
      setDexUnlockedSpecies(dexFromGarden.dexUnlockedSpecies);
      setDexSeenSpecies(dexFromGarden.dexSeenSpecies);
      applyProfileDisplay(migratedPayload.profile ?? null, options?.emailFallback);
      loadedGardenUserIdRef.current = uid;
      setGardenSyncError("");
      const needsSave =
        didRollover ||
        needsRepairSave ||
        gardenPayloadNeedsMigration(hydratedPayload) ||
        legacyCustom.length > 0;
      if (needsSave) {
        await saveUserGarden(uid, { ...migratedPayload, customListBirds: [] });
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
  }, [gardenBirds, birdRecords, dexUnlockedSpecies, dexSeenSpecies, userProfile, isGardenHydrated, isGardenSyncing, userId]);

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
    setCanOpenPhotoPopup(true);
    setBirdRegistrationMode("listed");
    setBirdName("청둥오리");
    setBirdFeature("");
    setBirdCount(1);
    setBirdMaleCount(1);
    setBirdFemaleCount(0);
    setPhotoPreviewUrl(null);
    setPickedLocation(null);
    setEditingCustomListBirdId(null);
  };

  const registrationUsesSexSplit = speciesUsesSexSplit(selectedListBirdId);

  /** 도감·목록 등 전체 화면이 열리면 홈 정원·추가 버튼·프로필 숨김 */
  const isHomeChromeHidden =
    isDexOpen ||
    isBirdListOpen ||
    isBirdInfoScreenOpen ||
    isCalendarOpen ||
    isArchiveGardenOpen ||
    isRankingOpen ||
    isMapOpen ||
    isLoginOpen ||
    registrationConfirm !== null;

  const captureCurrentLocation = (forcePin = false) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setMapCenter(point);
        if (forcePin) {
          setPickedLocation(point);
        } else {
          setPickedLocation((prev) => prev ?? point);
        }
      },
      () => {
        // 권한 거부 시 기본 중심점을 유지
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  useEffect(() => {
    if (!isBirdInfoScreenOpen) {
      return;
    }
    captureCurrentLocation(true);
  }, [isBirdInfoScreenOpen]);

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
    setCustomListDeleteConfirmId(null);
  };

  const openBirdRegistration = (opts?: {
    name?: string;
    mode?: "listed" | "unlisted";
    listBirdId?: string | null;
    photoUrl?: string | null;
    feature?: string;
  }) => {
    const mode = opts?.mode ?? "listed";
    const nextName =
      mode === "unlisted" ? "" : opts?.name !== undefined ? opts.name : "청둥오리";
    setRegistrationSpeciesName(mode === "unlisted" ? null : nextName);
    setIsBirdListOpen(false);
    if (mode === "unlisted") {
      setSelectedListBirdId(null);
    } else {
      setSelectedListBirdId(opts?.listBirdId ?? null);
    }
    setBirdRegistrationMode(mode);
    setIsBirdInfoScreenOpen(true);
    setCanOpenPhotoPopup(!opts?.photoUrl);
    setBirdName(nextName);
    setBirdFeature(opts?.feature ?? "");
    setBirdCount(1);
    setBirdMaleCount(1);
    setBirdFemaleCount(0);
    setPhotoPreviewUrl(opts?.photoUrl ?? null);
    setMapPickerSession((prev) => prev + 1);
    setPickedLocation(null);
    captureCurrentLocation(true);
  };

  const openUnlistedBirdRegistration = () => {
    setEditingCustomListBirdId(null);
    openBirdRegistration({ mode: "unlisted", name: "" });
  };

  const patchRecordsForCustomListBird = (
    records: BirdRecord[],
    listBirdId: string,
    patch: { name: string; description: string; imageSrc: string }
  ): BirdRecord[] =>
    records.map((record) =>
      record.listBirdId === listBirdId
        ? {
            ...record,
            name: patch.name,
            speciesName: patch.name,
            feature: patch.description,
            photoUrl: patch.imageSrc,
          }
        : record
    );

  const openEditCustomListBird = (listBirdId: string) => {
    const custom = sharedListBirds.find((entry) => entry.id === listBirdId);
    if (!custom || !userId || custom.createdBy !== userId) {
      return;
    }
    setCustomListDeleteConfirmId(null);
    setEditingCustomListBirdId(custom.id);
    setBirdRegistrationMode("unlisted");
    setBirdName(custom.name);
    setBirdFeature(custom.description);
    setPhotoPreviewUrl(custom.imageSrc);
    setCanOpenPhotoPopup(false);
    setIsBirdListOpen(false);
    setIsBirdInfoScreenOpen(true);
  };

  const requestDeleteCustomListBird = (listBirdId: string, event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    setCustomListDeleteConfirmId(listBirdId);
    setSelectedListBirdId(listBirdId);
  };

  const cancelDeleteCustomListBird = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    setCustomListDeleteConfirmId(null);
  };

  const confirmDeleteCustomListBird = async (listBirdId: string) => {
    const target = sharedListBirds.find((entry) => entry.id === listBirdId);
    if (!target || !userId || target.createdBy !== userId) {
      return;
    }

    const recordIdsToRemove = new Set(
      birdRecords.filter((record) => record.listBirdId === listBirdId).map((record) => record.id)
    );
    const nextCustom = sharedListBirds.filter((entry) => entry.id !== listBirdId);
    const nextRecords = birdRecords.filter((record) => record.listBirdId !== listBirdId);
    const nextBirds = gardenBirds.filter(
      (bird) => !bird.recordId || !recordIdsToRemove.has(bird.recordId)
    );

    const nextArchives: Record<string, DailyGardenArchive> = {};
    for (const [dateKey, archive] of Object.entries(dailyArchives)) {
      const removedIds = new Set(
        archive.records.filter((record) => record.listBirdId === listBirdId).map((record) => record.id)
      );
      nextArchives[dateKey] = {
        ...archive,
        records: archive.records.filter((record) => record.listBirdId !== listBirdId),
        birds: archive.birds.filter((bird) => !bird.recordId || !removedIds.has(bird.recordId)),
      };
    }

    const nextDex = buildDexStateFromGarden(nextRecords, nextArchives, dexSeenSpecies);

    setSharedListBirds(nextCustom);
    setBirdRecords(nextRecords);
    setGardenBirds(nextBirds);
    setDailyArchives(nextArchives);
    setDexUnlockedSpecies(nextDex.dexUnlockedSpecies);
    setDexSeenSpecies(nextDex.dexSeenSpecies);
    setCustomListDeleteConfirmId(null);
    if (selectedListBirdId === listBirdId) {
      setSelectedListBirdId(null);
    }

    const payload: UserGardenPayload = {
      birds: nextBirds,
      records: nextRecords,
      customListBirds: [],
      dailyArchives: nextArchives,
      dexUnlockedSpecies: nextDex.dexUnlockedSpecies,
      dexSeenSpecies: nextDex.dexSeenSpecies,
      currentGardenDate: currentGardenDate ?? getKstDateKey(),
      ...(userProfile ? { profile: userProfile } : {}),
    };

    gardenSnapshotRef.current = {
      ...gardenSnapshotRef.current,
      gardenBirds: nextBirds,
      birdRecords: nextRecords,
      sharedListBirds: nextCustom,
      dailyArchives: nextArchives,
      dexUnlockedSpecies: nextDex.dexUnlockedSpecies,
      dexSeenSpecies: nextDex.dexSeenSpecies,
    };

    if (userId) {
      try {
        await deleteSharedListBird(listBirdId);
        await persistGarden(userId, payload);
        gardenDirtyRef.current = false;
        if (isSupabaseConfigured()) {
          await syncWeeklyRankingFromGarden(
            userId,
            profileUsername.trim() || "탐험가",
            nextRecords,
            nextArchives,
            profileAvatarUrl
          );
        }
      } catch (error) {
        markGardenDirty();
        reportGardenSyncError(error);
      }
    } else {
      guestSessionPayloadRef.current = payload;
      gardenDirtyRef.current = false;
    }
  };

  const goNextFromBirdList = () => {
    const item = displayBirdListItems.find((b) => b.id === selectedListBirdId);
    if (!item || item.isPlaceholder) {
      return;
    }
    const custom = sharedListBirds.find((entry) => entry.id === item.id);
    if (custom) {
      openBirdRegistration({
        name: custom.name,
        mode: "listed",
        listBirdId: custom.id,
        photoUrl: custom.imageSrc,
        feature: custom.description,
      });
      return;
    }
    openBirdRegistration({ name: item.name, mode: "listed", listBirdId: item.id });
  };

  const submitCustomBirdToList = async () => {
    const name = birdName.trim();
    if (!name || !photoPreviewUrl) {
      return;
    }
    if (!userId || !isSupabaseConfigured()) {
      setLoginMessage("공용 목록에 올리려면 로그인이 필요해요.");
      setIsBirdInfoScreenOpen(false);
      openLoginScreen();
      return;
    }
    const description = birdFeature.trim();

    if (editingCustomListBirdId) {
      const editId = editingCustomListBirdId;
      const existing = sharedListBirds.find((entry) => entry.id === editId);
      if (!existing || existing.createdBy !== userId) {
        return;
      }
      try {
        const updated = await updateSharedListBird(editId, {
          name,
          description,
          imageSrc: photoPreviewUrl,
        });
        const nextCustom = sharedListBirds.map((entry) => (entry.id === editId ? updated : entry));
        const nextRecords = patchRecordsForCustomListBird(birdRecords, editId, {
          name,
          description,
          imageSrc: photoPreviewUrl,
        });
        const nextArchives: Record<string, DailyGardenArchive> = {};
        for (const [dateKey, archive] of Object.entries(dailyArchives)) {
          nextArchives[dateKey] = {
            ...archive,
            records: patchRecordsForCustomListBird(archive.records, editId, {
              name,
              description,
              imageSrc: photoPreviewUrl,
            }),
          };
        }

        setSharedListBirds(nextCustom);
        setBirdRecords(nextRecords);
        setDailyArchives(nextArchives);
        setIsBirdInfoScreenOpen(false);
        resetBirdFormDraft();
        setRegistrationSpeciesName(name);
        setIsBirdListOpen(true);
        setSelectedListBirdId(editId);

        await persistGarden(userId, {
          birds: gardenBirds,
          records: nextRecords,
          customListBirds: [],
          dailyArchives: nextArchives,
          dexUnlockedSpecies,
          dexSeenSpecies,
          currentGardenDate,
          ...(userProfile ? { profile: userProfile } : {}),
        });
        gardenDirtyRef.current = false;
      } catch (error) {
        reportGardenSyncError(error);
      }
      return;
    }

    try {
      const entry = await insertSharedListBird(userId, {
        name,
        description,
        imageSrc: photoPreviewUrl,
      });
      const nextCustom = [...sharedListBirds, entry];
      setSharedListBirds(nextCustom);
      const dexFromList = buildDexStateFromGarden(
        birdRecords,
        dailyArchives,
        dexSeenSpecies
      );
      setDexUnlockedSpecies(dexFromList.dexUnlockedSpecies);
      setIsBirdInfoScreenOpen(false);
      resetBirdFormDraft();
      setRegistrationSpeciesName(name);
      setIsBirdListOpen(true);
      setSelectedListBirdId(entry.id);
    } catch (error) {
      reportGardenSyncError(error);
    }
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
      setCanOpenPhotoPopup(false);
      event.target.value = "";
    };
    reader.onerror = () => {
      setCanOpenPhotoPopup(true);
      event.target.value = "";
    };
    reader.readAsDataURL(file);
  };

  const clearPhotoPreview = () => {
    setPhotoPreviewUrl(null);
    setCanOpenPhotoPopup(true);
  };

  const openPhotoPickerFromHit = () => {
    if (photoPreviewUrl || !canOpenPhotoPopup) {
      return;
    }
    galleryInputRef.current?.click();
  };

  const onPhotoHitKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPhotoPickerFromHit();
    }
  };

  const closeDex = () => {
    const fromGarden = collectSpeciesLabelsFromGarden(birdRecords, dailyArchives);
    if (fromGarden.length > 0) {
      markGardenDirty();
      setDexUnlockedSpecies((prev) => [...new Set([...prev, ...fromGarden])]);
      setDexSeenSpecies((prev) => [...new Set([...prev, ...fromGarden])]);
    }
    setDexDetailSpecies(null);
    setDexMenuRecordId(null);
    setDexEditRecordId(null);
    setIsDexOpen(false);
    setIsMenuOpen(false);
  };

  const closeDexDetail = () => {
    setDexDetailSpecies(null);
    setDexMenuRecordId(null);
    setDexEditRecordId(null);
    setIsDexDescPopupOpen(false);
  };

  const openDexDetail = (speciesName: string) => {
    markGardenDirty();
    setDexSeenSpecies((prev) => [...new Set([...prev, speciesName])]);
    setDexDetailSpecies(speciesName);
    setDexMenuRecordId(null);
    setDexEditRecordId(null);
    setIsDexDescPopupOpen(false);
  };

  const openArchiveGardenForDate = (dateKey: string, options?: { returnToDexSpecies?: string | null }) => {
    const snapshot = resolveDaySnapshot(dateKey, dailyArchives, { birds: gardenBirds, records: birdRecords });
    if (!snapshot || snapshot.birds.length === 0) {
      return;
    }
    const { year, month } = parseDateKey(dateKey);
    setSelectedCalendarDateKey(dateKey);
    setCalendarMonth({ year, month });
    setDexMenuRecordId(null);
    setDexEditRecordId(null);
    setIsDexDescPopupOpen(false);
    if (options?.returnToDexSpecies) {
      setArchiveGardenReturnTarget({ type: "dex-detail", speciesName: options.returnToDexSpecies });
    } else {
      setArchiveGardenReturnTarget({ type: "calendar" });
    }
    setDexDetailSpecies(null);
    setIsDexOpen(false);
    setIsCalendarOpen(false);
    setIsArchiveGardenOpen(true);
  };

  const startEditDexRecord = (recordId: string) => {
    const located = findBirdRecordById(recordId, birdRecords, dailyArchives);
    if (!located) {
      return;
    }
    setDexMenuRecordId(null);
    setDexEditRecordId(recordId);
    setDexEditCount(Math.max(1, located.record.count));
    setDexEditFeature(located.record.feature ?? "");
  };

  const saveDexRecordEdit = async () => {
    if (!dexEditRecordId) {
      return;
    }
    const located = findBirdRecordById(dexEditRecordId, birdRecords, dailyArchives);
    if (!located) {
      return;
    }

    const nextCount = Math.max(1, dexEditCount);
    const nextFeature = dexEditFeature.trim();

    if (!located.inArchive) {
      const target = located.record;
      let nextBirds = [...gardenBirds];
      const existingBirdsForRecord = nextBirds.filter((bird) => bird.recordId === dexEditRecordId);
      if (nextCount < existingBirdsForRecord.length) {
        const removeIds = new Set(existingBirdsForRecord.slice(nextCount).map((bird) => bird.id));
        nextBirds = nextBirds.filter((bird) => !removeIds.has(bird.id));
      } else if (nextCount > existingBirdsForRecord.length) {
        const addCount = nextCount - existingBirdsForRecord.length;
        const added = createGardenBirds(nextBirds.length, target.id, {
          listBirdId: target.listBirdId,
          speciesName: target.speciesName,
          ...(speciesUsesSexSplit(target.listBirdId)
            ? { maleCount: addCount, femaleCount: 0 }
            : { count: addCount }),
        });
        nextBirds = normalizePlacedBirds([...nextBirds, ...added], birdRecords);
      }

      const nextRecords = birdRecords.map((record) =>
        record.id === dexEditRecordId
          ? { ...applyRecordCountChange(record, nextCount), feature: nextFeature }
          : record
      );
      markGardenDirty();
      setGardenBirds(nextBirds);
      setBirdRecords(nextRecords);
      setDexEditRecordId(null);

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
              dailyArchives,
              profileAvatarUrl
            );
          }
        } catch (error) {
          reportGardenSyncError(error);
        }
      }
      return;
    }

    const archive = dailyArchives[located.dateKey];
    if (!archive) {
      return;
    }

    const nextRecords = archive.records.map((record) =>
      record.id === dexEditRecordId ? { ...record, count: nextCount, feature: nextFeature } : record
    );
    let nextBirds = [...archive.birds];
    const linkedBirds = nextBirds.filter((bird) => bird.recordId === dexEditRecordId);
    if (nextCount < linkedBirds.length) {
      const removeIds = new Set(linkedBirds.slice(nextCount).map((bird) => bird.id));
      nextBirds = nextBirds.filter((bird) => !removeIds.has(bird.id));
    }

    const nextArchives = {
      ...dailyArchives,
      [located.dateKey]: {
        ...archive,
        birds: nextBirds,
        records: nextRecords,
      },
    };

    markGardenDirty();
    setDailyArchives(nextArchives);
    setDexEditRecordId(null);

    if (userId) {
      try {
        await persistGarden(userId, {
          ...buildGardenPayloadFromSnapshot(),
          dailyArchives: nextArchives,
        });
      } catch (error) {
        reportGardenSyncError(error);
      }
    }
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

  const openMap = () => {
    setMapSession((prev) => prev + 1);
    setIsMapOpen(true);
    setIsMenuOpen(false);
    setSelectedMapGroupId(null);
    setSelectedMapRecordId(null);
    setEditingMapRecordId(null);
    captureCurrentLocation(true);
  };

  const closeMap = () => {
    setIsMapOpen(false);
    setSelectedMapGroupId(null);
    setSelectedMapRecordId(null);
    setEditingMapRecordId(null);
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
        dailyArchives,
        profileAvatarUrl
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
    if (selectedCalendarDateKey > todayDateKey) {
      return;
    }
    setArchiveGardenReturnTarget({ type: "calendar" });
    setArchiveAddFlowDateKey(null);
    setIsArchiveGardenOpen(true);
    setIsCalendarOpen(false);
  };

  const openBirdListFromArchive = () => {
    if (!isArchiveGardenOpen || selectedCalendarDateKey > todayDateKey) {
      return;
    }
    setArchiveAddFlowDateKey(selectedCalendarDateKey);
    closeGardenBirdDetail();
    openBirdList();
  };

  const closeArchiveGarden = () => {
    const returnTarget = archiveGardenReturnTarget;
    closeGardenBirdDetail();
    setIsArchiveGardenOpen(false);
    setArchiveGardenReturnTarget(null);
    setArchiveAddFlowDateKey(null);

    if (returnTarget?.type === "dex-detail") {
      setIsDexOpen(true);
      setDexDetailSpecies(returnTarget.speciesName);
      setDexMenuRecordId(null);
      setDexEditRecordId(null);
      setIsCalendarOpen(false);
      return;
    }

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
    if (label === "지도") {
      openMap();
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
    const returnToArchive = !!archiveAddFlowDateKey;
    setRegistrationConfirm(null);
    setIsBirdListOpen(false);
    setIsBirdInfoScreenOpen(false);
    resetBirdFormDraft();
    setArchiveAddFlowDateKey(null);
    if (returnToArchive) {
      setIsArchiveGardenOpen(true);
      setIsCalendarOpen(false);
    }
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
    const todayKey = getKstDateKey();
    const isPastArchiveDay =
      isArchiveGardenOpen && selectedCalendarDateKey !== todayKey && !!dailyArchives[selectedCalendarDateKey];

    const applyDeleteToSnapshot = (
      birds: PlacedBird[],
      records: BirdRecord[]
    ): { birds: PlacedBird[]; records: BirdRecord[] } => {
      const nextBirds = birds.filter((bird) => bird.id !== birdId);
      let nextRecords = records;
      if (recordId) {
        const target = records.find((record) => record.id === recordId);
        if (target) {
          const remainingForRecord = nextBirds.filter((bird) => bird.recordId === recordId).length;
          if (remainingForRecord === 0) {
            nextRecords = records.filter((record) => record.id !== recordId);
          } else if (target.count > remainingForRecord) {
            nextRecords = records.map((record) =>
              record.id === recordId ? { ...record, count: remainingForRecord } : record
            );
          }
        }
      }
      return { birds: nextBirds, records: nextRecords };
    };

    if (isPastArchiveDay) {
      const archive = dailyArchives[selectedCalendarDateKey];
      const { birds: nextBirds, records: nextRecords } = applyDeleteToSnapshot(archive.birds, archive.records);
      const nextArchives = {
        ...dailyArchives,
        [selectedCalendarDateKey]: { ...archive, birds: nextBirds, records: nextRecords },
      };
      markGardenDirty();
      setDailyArchives(nextArchives);
      closeGardenBirdDetail();

      if (userId) {
        try {
          await persistGarden(userId, {
            ...buildGardenPayloadFromSnapshot(),
            dailyArchives: nextArchives,
          });
          if (isSupabaseConfigured()) {
            await syncWeeklyRankingFromGarden(
              userId,
              profileUsername.trim() || "탐험가",
              birdRecords,
              nextArchives,
              profileAvatarUrl
            );
          }
        } catch (error) {
          reportGardenSyncError(error);
        }
      }
      return;
    }

    const { birds: nextBirds, records: nextRecords } = applyDeleteToSnapshot(gardenBirds, birdRecords);
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
            dailyArchives,
            profileAvatarUrl
          );
        }
      } catch (error) {
        reportGardenSyncError(error);
      }
    }
  };

  const deleteMapRecord = async (recordId: string) => {
    const nextBirds = gardenBirds.filter((bird) => bird.recordId !== recordId);
    const nextRecords = birdRecords.filter((record) => record.id !== recordId);
    markGardenDirty();
    setGardenBirds(nextBirds);
    setBirdRecords(nextRecords);
    setSelectedMapRecordId(null);
    setEditingMapRecordId(null);

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
            dailyArchives,
            profileAvatarUrl
          );
        }
      } catch (error) {
        reportGardenSyncError(error);
      }
    }
  };

  const handleEditMapPoint = (pointId: string, entryId?: string) => {
    const group = mapGroups.find((item) => item.id === pointId);
    if (!group) {
      return;
    }
    const record =
      (entryId ? group.records.find((item) => item.id === entryId) : null) ?? group.records[0] ?? null;
    if (!record) {
      return;
    }
    setSelectedMapGroupId(pointId);
    setSelectedMapRecordId(record.id);
    startEditMapRecord(record);
  };

  const startEditMapRecord = (record: BirdRecord) => {
    setEditingMapRecordId(record.id);
    setMapEditCount(Math.max(1, record.count));
    setMapEditFeature(record.feature ?? "");
    if (typeof record.latitude === "number" && typeof record.longitude === "number") {
      setMapEditLocation({ lat: record.latitude, lng: record.longitude });
      setMapCenter({ lat: record.latitude, lng: record.longitude });
    } else {
      setMapEditLocation(null);
    }
  };

  const saveMapRecordEdit = async () => {
    if (!editingMapRecordId) {
      return;
    }
    const target = birdRecords.find((record) => record.id === editingMapRecordId);
    if (!target) {
      return;
    }

    let nextBirds = [...gardenBirds];
    const existingBirdsForRecord = nextBirds.filter((bird) => bird.recordId === editingMapRecordId);
    const nextCount = Math.max(1, mapEditCount);
    if (nextCount < existingBirdsForRecord.length) {
      const removeIds = new Set(existingBirdsForRecord.slice(nextCount).map((bird) => bird.id));
      nextBirds = nextBirds.filter((bird) => !removeIds.has(bird.id));
    } else if (nextCount > existingBirdsForRecord.length) {
      const addCount = nextCount - existingBirdsForRecord.length;
      const added = createGardenBirds(nextBirds.length, target.id, {
        listBirdId: target.listBirdId,
        speciesName: target.speciesName,
        ...(speciesUsesSexSplit(target.listBirdId)
          ? { maleCount: addCount, femaleCount: 0 }
          : { count: addCount }),
      });
      nextBirds = normalizePlacedBirds([...nextBirds, ...added], birdRecords);
    }

    const nextRecords = birdRecords.map((record) =>
      record.id === editingMapRecordId
        ? {
            ...applyRecordCountChange(record, nextCount),
            feature: mapEditFeature.trim(),
            latitude: mapEditLocation?.lat,
            longitude: mapEditLocation?.lng,
          }
        : record
    );
    if (mapEditLocation) {
      saveRecordMapCoord(editingMapRecordId, mapEditLocation);
    }

    markGardenDirty();
    setGardenBirds(nextBirds);
    setBirdRecords(nextRecords);
    setEditingMapRecordId(null);

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
            dailyArchives,
            profileAvatarUrl
          );
        }
      } catch (error) {
        reportGardenSyncError(error);
      }
    }
  };

  const submitBirdRegistration = async () => {
    const isUnlisted = birdRegistrationMode === "unlisted";
    const customEntry = isCustomListBirdId(selectedListBirdId)
      ? sharedListBirds.find((entry) => entry.id === selectedListBirdId)
      : undefined;
    const usesSexSplit = !isUnlisted && !customEntry && speciesUsesSexSplit(selectedListBirdId);
    const maleCount = usesSexSplit ? Math.max(0, birdMaleCount) : 0;
    const femaleCount = usesSexSplit ? Math.max(0, birdFemaleCount) : 0;
    const amount = usesSexSplit ? maleCount + femaleCount : isUnlisted ? 1 : Math.max(1, birdCount);
    if (amount < 1) {
      return;
    }
    const displayName =
      birdName.trim() || customEntry?.name || (isUnlisted ? "이름 없는 조류" : "청둥오리");
    const capturedPhoto = customEntry?.imageSrc ?? photoPreviewUrl;
    const recordId = `record-${Date.now()}`;
    const speciesNameForConfirm = customEntry
      ? customEntry.name
      : isUnlisted
        ? displayName
        : registrationSpeciesName?.trim() || displayName;
    const archiveDateKey = archiveAddFlowDateKey;
    const isAddingToPastArchive = !!archiveDateKey && archiveDateKey < todayDateKey;
    const recordCreatedAt = isAddingToPastArchive
      ? createdAtForDateKey(archiveDateKey)
      : new Date().toISOString();

    const baseBirds = isAddingToPastArchive
      ? (dailyArchives[archiveDateKey]?.birds ?? [])
      : gardenBirds;
    const baseRecords = isAddingToPastArchive
      ? (dailyArchives[archiveDateKey]?.records ?? [])
      : birdRecords;

    const newBirds = createGardenBirds(baseBirds.length, recordId, {
      listBirdId: isUnlisted ? undefined : selectedListBirdId,
      speciesName: speciesNameForConfirm,
      ...(usesSexSplit ? { maleCount, femaleCount } : { count: amount }),
    });
    const newRecord: BirdRecord = {
      id: recordId,
      name: displayName,
      speciesName: speciesNameForConfirm,
      listBirdId: isUnlisted ? undefined : selectedListBirdId ?? undefined,
      feature: birdFeature.trim() || customEntry?.description || "",
      photoUrl: capturedPhoto,
      count: amount,
      ...(usesSexSplit ? { maleCount, femaleCount } : {}),
      latitude: pickedLocation?.lat ?? mapCenter.lat,
      longitude: pickedLocation?.lng ?? mapCenter.lng,
      createdAt: recordCreatedAt,
    };
    const nextRecords = [...baseRecords, newRecord];
    const nextBirds = normalizePlacedBirds([...baseBirds, ...newBirds], nextRecords);
    const previousSightings = countLifetimeSpeciesSightings(birdRecords, dailyArchives, speciesNameForConfirm);
    const totalSightings = isAddingToPastArchive
      ? countLifetimeSpeciesSightings(birdRecords, { ...dailyArchives, [archiveDateKey]: { birds: nextBirds, records: nextRecords, savedAt: new Date().toISOString() } }, speciesNameForConfirm)
      : countLifetimeSpeciesSightings(nextRecords, dailyArchives, speciesNameForConfirm);
    const isFirstDiscovery = previousSightings === 0;
    const fallbackImageSrc = customEntry?.imageSrc ?? getSpeciesFallbackImageSrc(speciesNameForConfirm);

    const speciesLabel = speciesNameForConfirm.trim();
    const nextUnlocked =
      speciesLabel.length > 0
        ? [...new Set([...dexUnlockedSpecies, speciesLabel])]
        : dexUnlockedSpecies;
    const nextSeen =
      speciesLabel.length > 0 ? [...new Set([...dexSeenSpecies, speciesLabel])] : dexSeenSpecies;

    const savedLat = pickedLocation?.lat ?? mapCenter.lat;
    const savedLng = pickedLocation?.lng ?? mapCenter.lng;
    saveRecordMapCoord(recordId, { lat: savedLat, lng: savedLng });

    let nextArchives = dailyArchives;
    if (isAddingToPastArchive && archiveDateKey) {
      nextArchives = {
        ...dailyArchives,
        [archiveDateKey]: {
          birds: nextBirds,
          records: nextRecords,
          savedAt: new Date().toISOString(),
        },
      };
      setDailyArchives(nextArchives);
    } else {
      setGardenBirds(nextBirds);
      setBirdRecords(nextRecords);
    }
    if (speciesLabel.length > 0) {
      setDexUnlockedSpecies(nextUnlocked);
      setDexSeenSpecies(nextSeen);
    }

    const savePayload: UserGardenPayload = {
      birds: isAddingToPastArchive ? gardenBirds : nextBirds,
      records: isAddingToPastArchive ? birdRecords : nextRecords,
      customListBirds: [],
      dexUnlockedSpecies: nextUnlocked,
      dexSeenSpecies: nextSeen,
      currentGardenDate,
      dailyArchives: nextArchives,
      ...(userProfile ? { profile: userProfile } : {}),
    };

    gardenSnapshotRef.current = {
      ...gardenSnapshotRef.current,
      gardenBirds: isAddingToPastArchive ? gardenBirds : nextBirds,
      birdRecords: isAddingToPastArchive ? birdRecords : nextRecords,
      dailyArchives: nextArchives,
      dexUnlockedSpecies: nextUnlocked,
      dexSeenSpecies: nextSeen,
    };
    markGardenDirty();

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
          await persistGarden(userId, savePayload);
          gardenDirtyRef.current = false;
          setGardenSyncError("");
          const rankingResult = await recordWeeklyDiscovery(
            userId,
            profileUsername.trim() || "탐험가",
            amount,
            profileAvatarUrl
          );
          if (rankingResult) {
            weeklyRankBanner = weeklyRankBannerMessage(rankingResult);
          }
          await syncWeeklyRankingFromGarden(
            userId,
            profileUsername.trim() || "탐험가",
            savePayload.records,
            savePayload.dailyArchives,
            profileAvatarUrl
          );
        } catch (error) {
          markGardenDirty();
          reportGardenSyncError(error);
        }
      } else {
        guestSessionPayloadRef.current = savePayload;
        gardenDirtyRef.current = false;
      }

      if (weeklyRankBanner) {
        setRegistrationConfirm((prev) =>
          prev ? { ...prev, weeklyRankBanner } : prev
        );
      }
    })();
  };

  const submitLogout = async () => {
    if (isLogoutSubmitting) {
      return;
    }
    try {
      setIsLogoutSubmitting(true);
      setIsProfileOpen(false);
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setIsLoginOpen(false);
      setIsNicknameEditing(false);
      setProfileEditMessage("");
      setProfileUsername("");
      setUserProfile(null);
      setLoginMessage("");
    } catch {
      // 로그아웃 실패 시에도 onAuthStateChange가 상태를 맞춤
    } finally {
      setIsLogoutSubmitting(false);
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
    if (isSupabaseConfigured()) {
      try {
        await syncWeeklyRankingFromGarden(
          userId,
          profile.nickname.trim() || profileUsername.trim() || "탐험가",
          birdRecords,
          dailyArchives,
          profile.avatarUrl ?? null
        );
      } catch {
        /* 랭킹 아바타 동기화 실패는 프로필 저장을 막지 않음 */
      }
    }
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
      <section className={`phone-frame${isHomeChromeHidden ? " phone-frame--overlay" : ""}`}>
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

        {!isHomeChromeHidden ? (
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
        ) : null}

        {!isHomeChromeHidden ? (
          <button type="button" className="add-bird-button" onClick={openBirdList}>
            + 오늘의 새 추가하기
          </button>
        ) : null}

        {gardenSyncError && isLoggedIn ? (
          <p className="garden-sync-error" role="alert">
            {gardenSyncError}
          </p>
        ) : null}

        {!isHomeChromeHidden ? (
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
                  <button
                    type="button"
                    className="profile-menu-logout"
                    onClick={submitLogout}
                    disabled={isLogoutSubmitting}
                  >
                    {isLogoutSubmitting ? "로그아웃 중..." : "로그아웃"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
        ) : null}

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
              {displayBirdListItems.map((item) =>
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
                  <div
                    key={item.id}
                    className={`bird-list-card-wrap${selectedListBirdId === item.id ? " bird-list-card-wrap--selected" : ""}`}
                  >
                    <button
                      type="button"
                      className={`bird-list-card${selectedListBirdId === item.id ? " bird-list-card--selected" : ""}`}
                      onClick={() => {
                        setCustomListDeleteConfirmId(null);
                        setSelectedListBirdId(item.id);
                      }}
                    >
                      <div className="bird-list-thumb">
                        {item.imageSrc ? (
                          item.imageSrc.startsWith("data:") || item.imageSrc.startsWith("blob:") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.imageSrc} alt={item.name} className="bird-list-thumb-img" />
                          ) : (
                            <Image
                              src={item.imageSrc}
                              alt={item.name}
                              fill
                              sizes="72px"
                              className="bird-list-thumb-img"
                            />
                          )
                        ) : (
                          <span>새 사진</span>
                        )}
                      </div>
                      <div className="bird-list-text">
                        <span className="bird-list-name">{item.name}</span>
                        {item.listBlurb ? <p className="bird-list-blurb">{item.listBlurb}</p> : null}
                      </div>
                    </button>
                    {item.isCustom && item.createdBy && userId && item.createdBy === userId ? (
                      <div className="bird-list-card-actions">
                        {customListDeleteConfirmId === item.id ? (
                          <div className="bird-list-card-confirm">
                            <p className="bird-list-card-confirm-text">목록에서 삭제할까요?</p>
                            <p className="bird-list-card-confirm-hint">
                              모든 사용자 목록·도감에서 사라지며, 내 정원에 둔 이 종의 새·기록도 함께 삭제돼요.
                            </p>
                            <div className="bird-list-card-confirm-btns">
                              <button
                                type="button"
                                className="bird-list-card-action-btn bird-list-card-action-btn--danger"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void confirmDeleteCustomListBird(item.id);
                                }}
                              >
                                삭제
                              </button>
                              <button
                                type="button"
                                className="bird-list-card-action-btn"
                                onClick={cancelDeleteCustomListBird}
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="bird-list-card-action-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditCustomListBird(item.id);
                              }}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="bird-list-card-action-btn bird-list-card-action-btn--danger"
                              onClick={(event) => requestDeleteCustomListBird(item.id, event)}
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              )}
            </div>

            <footer className="bird-list-footer">
              <button
                type="button"
                className="bird-list-next"
                onClick={goNextFromBirdList}
                disabled={
                  !selectedListBirdId ||
                  !!displayBirdListItems.find((b) => b.id === selectedListBirdId)?.isPlaceholder
                }
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
                <h1 className="bird-new-register-title">
                  {editingCustomListBirdId ? "조류 수정" : "신규 조류 등록!!"}
                </h1>
              </div>
            </header>

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/*"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={handlePhotoFileChange}
            />

            <div className="bird-new-register-scroll">
              <div className="bird-new-register-panel">
                <div className="bird-new-register-photo-box">
                  <div
                    className="bird-new-register-photo-hit"
                    role="button"
                    tabIndex={0}
                    onClick={openPhotoPickerFromHit}
                    onKeyDown={onPhotoHitKeyDown}
                    aria-label="사진 업로드하기"
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
                      <span className="bird-new-register-photo-label">사진 업로드하기</span>
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

                <button
                  type="button"
                  className="bird-new-register-submit"
                  onClick={() => void submitCustomBirdToList()}
                >
                  {editingCustomListBirdId ? "저장하기" : "목록에 추가하기"}
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
                    <div
                      className="bird-photo-hit"
                      role="button"
                      tabIndex={0}
                      onClick={openPhotoPickerFromHit}
                      onKeyDown={onPhotoHitKeyDown}
                      aria-label="사진 업로드하기"
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
                        <span className="bird-photo-placeholder">사진 업로드하기</span>
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

                {registrationUsesSexSplit ? (
                  <div className="bird-count-wrap bird-count-wrap--sex-split" aria-label="수컷·암컷 수량">
                    <div className="bird-count-sex-group">
                      <span className="bird-count-sex-label">수컷</span>
                      <div className="bird-count-row">
                        <button
                          type="button"
                          className="bird-count-btn"
                          onClick={() => setBirdMaleCount((c) => Math.max(0, c - 1))}
                          disabled={birdMaleCount <= 0}
                          aria-label="수컷 줄이기"
                        >
                          −
                        </button>
                        <span className="bird-count-value">{birdMaleCount}</span>
                        <button
                          type="button"
                          className="bird-count-btn"
                          onClick={() => setBirdMaleCount((c) => c + 1)}
                          aria-label="수컷 늘리기"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="bird-count-sex-group">
                      <span className="bird-count-sex-label">암컷</span>
                      <div className="bird-count-row">
                        <button
                          type="button"
                          className="bird-count-btn"
                          onClick={() => setBirdFemaleCount((c) => Math.max(0, c - 1))}
                          disabled={birdFemaleCount <= 0}
                          aria-label="암컷 줄이기"
                        >
                          −
                        </button>
                        <span className="bird-count-value">{birdFemaleCount}</span>
                        <button
                          type="button"
                          className="bird-count-btn"
                          onClick={() => setBirdFemaleCount((c) => c + 1)}
                          aria-label="암컷 늘리기"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
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
                )}
              </div>

              <section className="bird-map-section" aria-label="발견 장소 설정">
                <h3 className="bird-map-title">발견 장소 설정</h3>
                <div className="bird-map-frame">
                  <LocationMap
                    key={`map-registration-picker-${mapPickerSession}`}
                    active={isBirdInfoScreenOpen}
                    mode="picker"
                    theme="warm"
                    zoom={15}
                    center={mapCenter}
                    userLocation={mapCenter}
                    selectedPoint={pickedLocation}
                    points={mapViewerPoints}
                    onPick={(point) => setPickedLocation(point)}
                  />
                </div>
                <div className="bird-map-actions">
                  <button type="button" className="bird-map-action-btn" onClick={() => captureCurrentLocation(true)}>
                    현재 위치로 이동
                  </button>
                  <p className="bird-map-picked-text">
                    {pickedLocation
                      ? `핀 위치: ${pickedLocation.lat.toFixed(5)}, ${pickedLocation.lng.toFixed(5)}`
                      : "지도를 터치해서 발견 위치 핀을 고정해 주세요."}
                  </p>
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
                {archiveAddFlowDateKey ? "정원으로 돌아가기" : "홈으로 가기"}
              </button>
            </div>
          </div>
        ) : null}


        {showArchiveGardenScreen && archiveViewSnapshot ? (
          <div className="bird-archive-garden-screen" role="dialog" aria-modal="true" aria-label="이날의 정원">
            <header className="bird-archive-garden-header">
              <button
                type="button"
                className="bird-archive-garden-back"
                onClick={closeArchiveGarden}
                aria-label={
                  archiveGardenReturnTarget?.type === "dex-detail" ? "도감 상세로 돌아가기" : "캘린더로 돌아가기"
                }
              >
                <img src="/left.png" alt="" width={48} height={48} decoding="sync" className="bird-archive-garden-back-img" />
              </button>
              <h1 className="bird-archive-garden-title">
                {parseDateKey(selectedCalendarDateKey).month}월 {parseDateKey(selectedCalendarDateKey).day}일의 정원
              </h1>
              <button
                type="button"
                className="bird-archive-garden-add"
                onClick={openBirdListFromArchive}
                aria-label="이날의 정원에 조류 추가"
              >
                추가하기
              </button>
            </header>
            <div className="garden-scroll bird-archive-garden-scroll" ref={archiveScrollRef}>
              <GardenWorldView
                birds={archiveViewSnapshot.birds}
                records={archiveViewSnapshot.records}
                selectedBirdId={selectedGardenBirdId}
                deleteConfirm={gardenBirdDeleteConfirm}
                onBirdClick={openGardenBirdDetail}
                onRequestDelete={requestGardenBirdDelete}
                onConfirmDelete={() => void confirmGardenBirdDelete()}
                onCancelDelete={cancelGardenBirdDelete}
              />
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
                    disabled={selectedCalendarDateKey > todayDateKey}
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
                    const rowAvatarUrl = row.avatar_url ?? (isMe ? profileAvatarUrl : null);
                    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
                    return (
                      <li
                        key={row.user_id}
                        className={`bird-ranking-item${isMe ? " bird-ranking-item--me" : ""}`}
                      >
                        <span className="bird-ranking-rank" aria-hidden>
                          {medal ?? rank}
                        </span>
                        <span className="bird-ranking-avatar" aria-hidden>
                          {rowAvatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={rowAvatarUrl} alt="" className="bird-ranking-avatar-img" />
                          ) : (
                            <span className="bird-ranking-avatar-initial">
                              {(row.nickname || "탐").charAt(0)}
                            </span>
                          )}
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

        {isMapOpen ? (
          <div className="bird-map-screen" role="dialog" aria-modal="true" aria-label="나의 조류 지도">
            <header className="bird-map-screen-header">
              <button type="button" className="bird-map-screen-close" onClick={closeMap} aria-label="지도 닫기">
                <img src="/x.png" alt="" width={48} height={48} decoding="sync" className="bird-map-screen-close-img" />
              </button>
              <h1 className="bird-map-screen-title">나의 조류 지도</h1>
            </header>
            <div className="bird-map-screen-body">
              <div className="bird-map-screen-map">
                <LocationMap
                  key={`map-viewer-${mapSession}`}
                  active={isMapOpen}
                  mode="viewer"
                  theme="warm"
                  zoom={15}
                  center={mapCenter}
                  userLocation={mapCenter}
                  points={mapViewerPoints}
                  onSelectPoint={(id) => {
                    setSelectedMapGroupId(id);
                    setSelectedMapRecordId(null);
                    setEditingMapRecordId(null);
                  }}
                  onSelectEntry={(pointId, entryId) => {
                    setSelectedMapGroupId(pointId);
                    setSelectedMapRecordId(entryId);
                    setEditingMapRecordId(null);
                  }}
                  onEditPoint={handleEditMapPoint}
                />
                {mapViewerPoints.length === 0 ? (
                  <p className="bird-map-onmap-empty">
                    {birdRecords.length > 0
                      ? "위치 권한을 허용한 뒤 새로고침하거나, 조류 추가 시 지도에서 핀을 찍어 주세요."
                      : "발견 위치를 기록하면 지도에 핀이 표시돼요."}
                  </p>
                ) : null}
              </div>

              {selectedMapRecord && !editingMapRecordId ? (
                <div className="bird-map-floating-bar">
                  <p className="bird-map-floating-label">
                    {new Date(selectedMapRecord.createdAt).toLocaleDateString("ko-KR")} · {Math.max(1, selectedMapRecord.count)}마리 ·{" "}
                    {selectedMapRecord.speciesName || selectedMapRecord.name}
                  </p>
                  <div className="bird-map-floating-actions">
                    <button type="button" className="bird-map-action-btn" onClick={() => startEditMapRecord(selectedMapRecord)}>
                      위치·기록 수정
                    </button>
                    <button
                      type="button"
                      className="bird-map-action-btn bird-map-action-btn--danger"
                      onClick={() => void deleteMapRecord(selectedMapRecord.id)}
                    >
                      삭제하기
                    </button>
                  </div>
                </div>
              ) : null}

              {editingMapRecordId ? (
                <div className="bird-map-edit-sheet">
                  <p className="bird-map-floating-label">위치를 지도에서 다시 찍어 저장할 수 있어요.</p>
                  <label className="bird-map-edit-label">
                    마리수
                    <input
                      type="number"
                      min={1}
                      className="bird-map-edit-input"
                      value={mapEditCount}
                      onChange={(event) => setMapEditCount(Math.max(1, Number(event.target.value) || 1))}
                    />
                  </label>
                  <label className="bird-map-edit-label">
                    메모
                    <textarea
                      className="bird-map-edit-input"
                      rows={2}
                      value={mapEditFeature}
                      onChange={(event) => setMapEditFeature(event.target.value)}
                    />
                  </label>
                  <div className="bird-map-frame bird-map-frame--small">
                    <LocationMap
                      key={`map-edit-${editingMapRecordId}`}
                      active={!!editingMapRecordId}
                      mode="picker"
                      theme="warm"
                      center={mapEditLocation ?? mapCenter}
                      selectedPoint={mapEditLocation}
                      onPick={(point) => setMapEditLocation(point)}
                    />
                  </div>
                  <div className="bird-map-floating-actions">
                    <button type="button" className="bird-map-action-btn" onClick={() => void saveMapRecordEdit()}>
                      저장
                    </button>
                    <button type="button" className="bird-map-action-btn" onClick={() => setEditingMapRecordId(null)}>
                      취소
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isDexOpen ? (
          <div
            className={`bird-dex-screen${dexDetailSpecies ? " bird-dex-screen--detail" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={dexDetailSpecies ? `${dexDetailSpecies} 도감 상세` : "조류 도감"}
            onClick={() => setDexMenuRecordId(null)}
          >
            {dexDetailSpecies ? (
              <>
                <header className="bird-dex-detail-header">
                  <button type="button" className="bird-dex-detail-back" onClick={closeDexDetail} aria-label="도감으로 돌아가기">
                    <img src="/left.png" alt="" width={40} height={40} decoding="sync" className="bird-dex-detail-back-img" />
                  </button>
                  <button type="button" className="bird-dex-detail-close-text" onClick={closeDex}>
                    닫기
                  </button>
                </header>

                <div className="bird-dex-detail-scroll" onClick={(event) => event.stopPropagation()}>
                  <div className="bird-dex-detail-top">
                    <div className="bird-dex-detail-photo">
                      {dexDetailDisplay &&
                      (dexDetailDisplay.imageSrc.startsWith("data:") ||
                        dexDetailDisplay.imageSrc.startsWith("blob:")) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dexDetailDisplay.imageSrc}
                          alt={dexDetailSpecies}
                          className="bird-dex-detail-photo-img bird-dex-detail-photo-img--uploaded"
                        />
                      ) : (
                        <Image
                          src={dexDetailDisplay?.imageSrc ?? getSpeciesFallbackImageSrc(dexDetailSpecies)}
                          alt={dexDetailSpecies}
                          fill
                          sizes="160px"
                          className="bird-dex-detail-photo-img"
                        />
                      )}
                    </div>
                    <div
                      ref={dexDescWrapRef}
                      className={`bird-dex-detail-desc-wrap${dexDescOverflows ? " bird-dex-detail-desc-wrap--overflow" : ""}`}
                      role={dexDescOverflows ? "button" : undefined}
                      tabIndex={dexDescOverflows ? 0 : undefined}
                      aria-label={dexDescOverflows ? "전체 설명 보기" : undefined}
                      onClick={() => {
                        if (dexDescOverflows) {
                          setIsDexDescPopupOpen(true);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (!dexDescOverflows) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setIsDexDescPopupOpen(true);
                        }
                      }}
                    >
                      <p className="bird-dex-detail-desc-text">{dexDetailDescription}</p>
                      {dexDescOverflows ? (
                        <div className="bird-dex-detail-desc-fade" aria-hidden>
                          <span className="bird-dex-detail-desc-ellipsis">...</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <h2 className="bird-dex-detail-name">{dexDetailSpecies}</h2>

                  <div className="bird-dex-detail-panel">
                    <p className="bird-dex-detail-total">Total 발견 수: {dexDetailSightings.total}마리</p>
                    <ul className="bird-dex-detail-list">
                      {dexDetailSightings.entries.map((entry) => (
                        <li key={entry.recordId} className="bird-dex-detail-row">
                          <span className="bird-dex-detail-row-label">
                            {entry.dateLabel} - {entry.count}마리
                          </span>
                          <button
                            type="button"
                            className="bird-dex-detail-menu-btn"
                            aria-label="기록 메뉴"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDexMenuRecordId((prev) => (prev === entry.recordId ? null : entry.recordId));
                            }}
                          >
                            ⋮
                          </button>
                          {dexMenuRecordId === entry.recordId ? (
                            <div className="bird-dex-detail-menu-popup" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => startEditDexRecord(entry.recordId)}
                              >
                                수정하기
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  openArchiveGardenForDate(entry.dateKey, {
                                    returnToDexSpecies: dexDetailSpecies,
                                  })
                                }
                              >
                                이날의 정원
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {dexDetailSightings.entries.length === 0 ? (
                      <p className="bird-dex-detail-empty">아직 이 조류의 발견 기록이 없어요.</p>
                    ) : null}
                  </div>

                  {dexEditRecordId ? (
                    <div className="bird-dex-detail-edit">
                      <label className="bird-dex-detail-edit-label">
                        마리수
                        <input
                          type="number"
                          min={1}
                          className="bird-dex-detail-edit-input"
                          value={dexEditCount}
                          onChange={(event) => setDexEditCount(Math.max(1, Number(event.target.value) || 1))}
                        />
                      </label>
                      <label className="bird-dex-detail-edit-label">
                        메모
                        <textarea
                          className="bird-dex-detail-edit-input"
                          rows={2}
                          value={dexEditFeature}
                          onChange={(event) => setDexEditFeature(event.target.value)}
                        />
                      </label>
                      <div className="bird-dex-detail-edit-actions">
                        <button type="button" className="bird-dex-detail-edit-btn" onClick={() => void saveDexRecordEdit()}>
                          저장
                        </button>
                        <button type="button" className="bird-dex-detail-edit-btn" onClick={() => setDexEditRecordId(null)}>
                          취소
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {isDexDescPopupOpen ? (
                  <div
                    className="bird-dex-desc-popup-screen"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${dexDetailSpecies} 설명`}
                    onClick={() => setIsDexDescPopupOpen(false)}
                  >
                    <div className="bird-dex-desc-popup" onClick={(event) => event.stopPropagation()}>
                      <header className="bird-dex-desc-popup-header">
                        <button
                          type="button"
                          className="bird-dex-desc-popup-close"
                          onClick={() => setIsDexDescPopupOpen(false)}
                          aria-label="설명 닫기"
                        >
                          <img src="/x.png" alt="" width={44} height={44} decoding="sync" className="bird-dex-desc-popup-close-img" />
                        </button>
                      </header>
                      <p className="bird-dex-desc-popup-text">{dexDetailDescription}</p>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
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
                    {dexDisplayEntries.map((entry) =>
                      entry.unlocked && entry.name ? (
                        <button
                          key={entry.id}
                          type="button"
                          className="bird-dex-card"
                          onClick={() => openDexDetail(entry.name)}
                        >
                          {entry.isNew ? (
                            <span className="bird-dex-new" aria-label="새로 해금">
                              New!
                            </span>
                          ) : null}
                          <div className="bird-dex-card-visual">
                            <div className="bird-dex-unlocked-img-wrap">
                              {entry.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={entry.photoUrl}
                                  alt={entry.name}
                                  className="bird-dex-card-img bird-dex-card-img--uploaded"
                                />
                              ) : (
                                <Image
                                  src={entry.imageSrc}
                                  alt={entry.name}
                                  fill
                                  sizes="120px"
                                  className="bird-dex-card-img"
                                />
                              )}
                            </div>
                          </div>
                          <span className="bird-dex-card-name">{entry.name}</span>
                        </button>
                      ) : (
                        <div key={entry.id} className="bird-dex-card bird-dex-card--locked">
                          <div className="bird-dex-card-visual">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <Image src={LOCKED_DEX_IMAGE} alt="" fill sizes="120px" className="bird-dex-card-img" />
                          </div>
                          <span className="bird-dex-card-name">???</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </>
            )}
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
