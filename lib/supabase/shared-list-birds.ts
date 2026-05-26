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
