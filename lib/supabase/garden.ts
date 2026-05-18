import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PlacedBird = {
  id: string;
  xPercent: number;
  yPercent: number;
  size: number;
};

export type BirdRecord = {
  id: string;
  name: string;
  feature: string;
  photoUrl: string | null;
  count: number;
  createdAt: string;
};

export type UserGardenPayload = {
  birds: PlacedBird[];
  records: BirdRecord[];
  dexSeenSpecies?: string[];
};

const EMPTY_PAYLOAD: UserGardenPayload = { birds: [], records: [], dexSeenSpecies: [] };

function normalizePayload(raw: unknown): UserGardenPayload {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_PAYLOAD };
  }
  const obj = raw as { birds?: unknown; records?: unknown };
  const birds = Array.isArray(obj.birds)
    ? obj.birds
        .filter(
          (item): item is PlacedBird =>
            !!item &&
            typeof item === "object" &&
            typeof (item as PlacedBird).id === "string" &&
            typeof (item as PlacedBird).xPercent === "number" &&
            typeof (item as PlacedBird).yPercent === "number" &&
            typeof (item as PlacedBird).size === "number"
        )
        .map((item) => ({
          id: item.id,
          xPercent: item.xPercent,
          yPercent: item.yPercent,
          size: item.size,
        }))
    : [];

  const records = Array.isArray(obj.records)
    ? obj.records
        .filter(
          (item): item is BirdRecord =>
            !!item &&
            typeof item === "object" &&
            typeof (item as BirdRecord).id === "string" &&
            typeof (item as BirdRecord).name === "string"
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          feature: typeof item.feature === "string" ? item.feature : "",
          photoUrl: typeof item.photoUrl === "string" ? item.photoUrl : null,
          count: typeof item.count === "number" ? item.count : 1,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        }))
    : [];

  const dexSeenSpecies = Array.isArray((obj as { dexSeenSpecies?: unknown }).dexSeenSpecies)
    ? (obj as { dexSeenSpecies: unknown[] }).dexSeenSpecies.filter(
        (name): name is string => typeof name === "string" && name.trim().length > 0
      )
    : [];

  return { birds, records, dexSeenSpecies };
}

export async function loadUserGarden(userId: string): Promise<UserGardenPayload> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("user_gardens").select("payload").eq("user_id", userId).maybeSingle();

  if (error) {
    throw error;
  }
  if (!data?.payload) {
    return { ...EMPTY_PAYLOAD };
  }
  return normalizePayload(data.payload);
}

export async function saveUserGarden(userId: string, payload: UserGardenPayload): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("user_gardens").upsert(
    {
      user_id: userId,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw error;
  }
}
