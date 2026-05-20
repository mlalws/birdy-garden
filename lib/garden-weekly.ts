const KST_TIMEZONE = "Asia/Seoul";

export function getKstCalendarParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  return {
    year: Number(parts.find((p) => p.type === "year")!.value),
    month: Number(parts.find((p) => p.type === "month")!.value),
    day: Number(parts.find((p) => p.type === "day")!.value),
  };
}

/** KST 기준 ISO 주차 키 (예: 2026-W20) */
export function getKstWeekKey(date = new Date()): string {
  const { year, month, day } = getKstCalendarParts(date);
  const local = new Date(year, month - 1, day);
  local.setHours(0, 0, 0, 0);
  local.setDate(local.getDate() + 3 - ((local.getDay() + 6) % 7));
  const weekYear = local.getFullYear();
  const week1 = new Date(weekYear, 0, 4);
  const weekNum =
    1 +
    Math.round(
      ((local.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    );
  return `${weekYear}-W${String(weekNum).padStart(2, "0")}`;
}

export function parseKstWeekKey(weekKey: string): { year: number; week: number } | null {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), week: Number(match[2]) };
}

/** ISO 주차의 월요일 (로컬 Date, KST 달력 기준 계산) */
export function getKstWeekMonday(weekKey: string): Date | null {
  const parsed = parseKstWeekKey(weekKey);
  if (!parsed) {
    return null;
  }
  const jan4 = new Date(parsed.year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (parsed.week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function formatKstWeekLabel(weekKey: string): string {
  const parsed = parseKstWeekKey(weekKey);
  if (!parsed) {
    return "이번 주";
  }
  return `${parsed.year}년 ${parsed.week}주차`;
}

/** KST 날짜 키(YYYY-MM-DD)가 속한 ISO 주차 */
export function getKstWeekKeyFromDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return getKstWeekKey();
  }
  return getKstWeekKey(new Date(year, month - 1, day));
}

export function formatKstWeekPeriod(weekKey: string): string {
  const monday = getKstWeekMonday(weekKey);
  if (!monday) {
    return "";
  }
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(monday)} ~ ${fmt(sunday)}`;
}
