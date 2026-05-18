export function getGardenStorageErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "정원 데이터를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const message = "message" in error ? String((error as { message?: string }).message) : "";

  if (code === "PGRST205" || message.includes("user_gardens")) {
    return "정원 저장 테이블이 아직 없어요. Supabase → SQL Editor에서 schema.sql을 실행해 주세요.";
  }

  if (code === "42501" || message.toLowerCase().includes("permission")) {
    return "정원 저장 권한이 없어요. Supabase에서 user_gardens 테이블과 RLS 정책을 확인해 주세요.";
  }

  return `정원 데이터 저장 오류: ${message || "알 수 없는 오류"}`;
}

export function isMissingGardenTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const message = "message" in error ? String((error as { message?: string }).message) : "";
  return code === "PGRST205" || message.includes("user_gardens");
}
