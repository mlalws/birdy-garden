export type UserProfile = {
  nickname: string;
  /** 프로필에서 닉네임을 저장한 횟수 (첫 저장은 한 달 제한 없음) */
  nicknameEditCount: number;
  nicknameLastChangedAt: string | null;
};

const NICKNAME_WORDS = [
  "새싹",
  "구름",
  "별빛",
  "숲속",
  "파랑",
  "초록",
  "밤하늘",
  "산들",
  "바람",
  "자람",
  "노을",
  "이슬",
  "솔방울",
  "무지개",
  "달빛",
  "들판",
  "연두",
  "포근",
  "보리",
  "하늘",
] as const;

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 12;
const NICKNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function generateRandomNickname(): string {
  const word = NICKNAME_WORDS[Math.floor(Math.random() * NICKNAME_WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}${num}`;
}

export function normalizeUserProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Partial<UserProfile>;
  const nickname = typeof obj.nickname === "string" ? obj.nickname.trim() : "";
  if (!nickname) {
    return null;
  }
  return {
    nickname: nickname.slice(0, NICKNAME_MAX),
    nicknameEditCount:
      typeof obj.nicknameEditCount === "number" && obj.nicknameEditCount >= 0
        ? Math.floor(obj.nicknameEditCount)
        : 0,
    nicknameLastChangedAt:
      typeof obj.nicknameLastChangedAt === "string" ? obj.nicknameLastChangedAt : null,
  };
}

export function validateNicknameInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < NICKNAME_MIN) {
    return `닉네임은 ${NICKNAME_MIN}자 이상이어야 해요.`;
  }
  if (trimmed.length > NICKNAME_MAX) {
    return `닉네임은 ${NICKNAME_MAX}자 이하로 입력해 주세요.`;
  }
  if (!/^[가-힣a-zA-Z0-9_]+$/.test(trimmed)) {
    return "닉네임은 한글, 영문, 숫자, _(밑줄)만 사용할 수 있어요.";
  }
  return null;
}

export function canChangeNickname(profile: UserProfile, now = Date.now()): { ok: true } | { ok: false; message: string } {
  if (profile.nicknameEditCount === 0) {
    return { ok: true };
  }
  if (!profile.nicknameLastChangedAt) {
    return { ok: true };
  }
  const last = new Date(profile.nicknameLastChangedAt).getTime();
  if (Number.isNaN(last)) {
    return { ok: true };
  }
  const elapsed = now - last;
  if (elapsed >= NICKNAME_CHANGE_COOLDOWN_MS) {
    return { ok: true };
  }
  const nextAt = new Date(last + NICKNAME_CHANGE_COOLDOWN_MS);
  const dateLabel = nextAt.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return {
    ok: false,
    message: `닉네임은 한 달에 한 번만 바꿀 수 있어요. (${dateLabel} 이후 가능)`,
  };
}

export function applyNicknameChange(profile: UserProfile, nextNickname: string): UserProfile {
  return {
    nickname: nextNickname.trim().slice(0, NICKNAME_MAX),
    nicknameEditCount: profile.nicknameEditCount + 1,
    nicknameLastChangedAt: new Date().toISOString(),
  };
}
