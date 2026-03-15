import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room, RoomImage } from "@/lib/types/database";

export async function getRooms(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as Room[];
}

export async function getRoom(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Room;
}

export async function createRoom(
  supabase: SupabaseClient,
  input: {
    project_id: string;
    name: string;
    room_type: string;
    budget_mode?: string;
    sourcing_mode?: string;
    priorities?: string[];
    keep_items?: string[];
    replace_items?: string[];
  }
) {
  const { data, error } = await supabase
    .from("rooms")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Room;
}

export async function updateRoom(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<Room>
) {
  const { data, error } = await supabase
    .from("rooms")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Room;
}

export async function deleteRoom(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) throw error;
}

export async function getRoomImages(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase
    .from("room_images")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as RoomImage[];
}

export async function addRoomImage(
  supabase: SupabaseClient,
  input: {
    room_id: string;
    image_url: string;
    image_type?: string;
    storage_path?: string;
    caption?: string;
  }
) {
  const { data, error } = await supabase
    .from("room_images")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as RoomImage;
}

export async function deleteRoomImage(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("room_images").delete().eq("id", id);
  if (error) throw error;
}
