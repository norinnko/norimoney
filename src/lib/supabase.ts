/**
 * supabase.ts — ブラウザから直接叩く Supabase クライアント（シングルトン）。
 *
 * 静的エクスポート構成のため、認証もデータ取得も全てクライアント側で行う。
 * anon key は公開前提（RLS で守る）。service_role キーはフロントに置かない。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** .env.local に Supabase の接続情報が設定されているか。 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Supabase クライアントを取得する（初回のみ生成）。
 * ブラウザ実行を前提とし、env が無ければ分かりやすく失敗させる。
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase の環境変数が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。",
    );
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}
