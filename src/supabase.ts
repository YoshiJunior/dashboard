import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost:54321", key || "anon-key-missing");

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "user";
  notifications_enabled: boolean;
};
