import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { CustomListBird } from "@/lib/supabase/garden";

export type SharedListBird = CustomListBird & {
  createdBy: string;
};

type SharedListBirdRow = {
  id: string;
  created_by: string;
  name: string;
  description: string;
  image_src: string;
  created_at: string;
  updated_at: string;
};

function rowToSharedListBird(row: SharedListBirdRow): SharedListBird {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    imageSrc: row.image_src,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

const SHARED_LIST_SYNC_SESSION_KEY = "birdy-garden:shared-list-global-sync-v1";

/** 모든 사용자 정원 payload에 남은 customListBirds를 공용 테이블로 연동 */
export async function syncSharedListBirdsFromAllGardens(): Promise<number> {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("sync_shared_list_birds_from_all_gardens");

  if (error) {
    if (
      error.message.includes("sync_shared_list_birds_from_all_gardens") &&
      (error.message.includes("does not exist") || error.message.includes("Could not find"))
    ) {
      return 0;
    }
    throw error;
  }

  return typeof data === "number" ? data : 0;
}

export async function fetchSharedListBirds(): Promise<SharedListBird[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("shared_list_birds")
    .select("id, created_by, name, description, image_src, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SharedListBirdRow[]).map(rowToSharedListBird);
}

export async function insertSharedListBird(
  userId: string,
  input: { name: string; description: string; imageSrc: string }
): Promise<SharedListBird> {
  const supabase = getSupabaseBrowserClient();
  const id = `custom-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("shared_list_birds")
    .insert({
      id,
      created_by: userId,
      name: input.name.trim(),
      description: input.description.trim(),
      image_src: input.imageSrc,
      created_at: now,
      updated_at: now,
    })
    .select("id, created_by, name, description, image_src, created_at, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return rowToSharedListBird(data as SharedListBirdRow);
}

export async function updateSharedListBird(
  listBirdId: string,
  input: { name: string; description: string; imageSrc: string }
): Promise<SharedListBird> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("shared_list_birds")
    .update({
      name: input.name.trim(),
      description: input.description.trim(),
      image_src: input.imageSrc,
      updated_at: new Date().toISOString(),
    })
    .eq("id", listBirdId)
    .select("id, created_by, name, description, image_src, created_at, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return rowToSharedListBird(data as SharedListBirdRow);
}

export async function deleteSharedListBird(listBirdId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("shared_list_birds").delete().eq("id", listBirdId);
  if (error) {
    throw error;
  }
}

/** 예전 user_gardens.payload.customListBirds → 공용 테이블로 한 번 옮김 */
export async function migrateLegacyCustomListBirdsToShared(
  userId: string,
  legacy: CustomListBird[],
  existing: SharedListBird[]
): Promise<SharedListBird[]> {
  if (!isSupabaseConfigured() || legacy.length === 0) {
    return existing;
  }

  const existingIds = new Set(existing.map((item) => item.id));
  let next = [...existing];

  for (const item of legacy) {
    if (!item.id || existingIds.has(item.id)) {
      continue;
    }
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("shared_list_birds")
        .insert({
          id: item.id,
          created_by: userId,
          name: item.name.trim(),
          description: (item.description ?? "").trim(),
          image_src: item.imageSrc,
          created_at: item.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id, created_by, name, description, image_src, created_at, updated_at")
        .single();

      if (!error && data) {
        const mapped = rowToSharedListBird(data as SharedListBirdRow);
        next.push(mapped);
        existingIds.add(mapped.id);
      }
    } catch {
      // 이미 다른 사용자가 같은 id를 썼거나 RLS — 건너뜀
    }
  }

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 로그인 후 세션당 1회 — 다른 사용자가 예전에 넣은 목록까지 공용 테이블로 모음 */
export async function ensureGlobalSharedListSync(): Promise<void> {
  if (!isSupabaseConfigured() || typeof window === "undefined") {
    return;
  }
  try {
    if (sessionStorage.getItem(SHARED_LIST_SYNC_SESSION_KEY) === "1") {
      return;
    }
    await syncSharedListBirdsFromAllGardens();
    sessionStorage.setItem(SHARED_LIST_SYNC_SESSION_KEY, "1");
  } catch {
    // RPC·테이블 미준비 시 무시 — 개인 legacy 마이그레이션만 진행
  }
}
