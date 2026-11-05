"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const { ready, session } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  // 既にログイン済みならホームへ。
  useEffect(() => {
    if (ready && session) router.replace("/");
  }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = getSupabase();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
        } else {
          setNotice("確認メールを送信しました。メール内のリンクを開いてから、ログインしてください。");
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="text-xl font-bold">Supabase の設定が必要です</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">.env.local</code> に
          NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してから開き直してください。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
          norimoney
        </h1>
        <p className="mt-1 text-sm text-slate-500">バイトのシフト・給料・支出を管理</p>
      </div>

      <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              mode === m
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500"
            }`}
          >
            {m === "signin" ? "ログイン" : "新規登録"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600 dark:text-slate-300">メールアドレス</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600 dark:text-slate-300">パスワード</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "処理中…" : mode === "signin" ? "ログイン" : "登録する"}
        </button>
      </form>
    </div>
  );
}
