import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
}

function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
}

/** 빌드/배포 시 환경 변수가 비어 있거나 예시 값이면 안내 문구 반환 */
export function getSupabaseConfigIssue(): string | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    return "Supabase 설정이 없어요. Vercel → Settings → Environment Variables에 URL·anon key를 넣고 Redeploy 해 주세요.";
  }

  if (url.includes("YOUR_PROJECT") || anonKey.includes("YOUR_ANON")) {
    return "Supabase 키가 예시 값 그대로예요. 대시보드의 실제 URL·anon key로 바꾼 뒤 다시 배포해 주세요.";
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    return "Supabase URL이 올바르지 않아요. https://프로젝트ID.supabase.co 형식인지 확인해 주세요.";
  }

  return null;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigIssue() === null;
}

/**
 * 브라우저(클라이언트 컴포넌트)에서 쓰는 Supabase 클라이언트.
 * 환경 변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  const configIssue = getSupabaseConfigIssue();
  if (configIssue) {
    throw new Error(configIssue);
  }

  const url = getSupabaseUrl()!;
  const anonKey = getSupabaseAnonKey()!;

  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}

/** 회원가입/로그인 전 Supabase 서버 연결 확인 */
export async function assertSupabaseReachable(): Promise<void> {
  const url = getSupabaseUrl()?.replace(/\/$/, "");
  if (!url) {
    throw new Error("Supabase URL이 없습니다.");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Supabase 서버 응답 오류 (${response.status})`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Supabase 연결 시간이 초과됐어요.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
