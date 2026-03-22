// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import type { Project } from "@/lib/types/database";

export async function getProjects(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export async function getProject(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Project;
}

export async function createProject(
  supabase: SupabaseClient,
  input: { name: string; description?: string; user_id: string }
) {
  const { data, error } = await supabase
    .from("projects")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<Pick<Project, "name" | "description" | "status" | "cover_image_url">>
) {
  const { data, error } = await supabase
    .from("projects")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function deleteProject(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
