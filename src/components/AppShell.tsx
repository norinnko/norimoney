"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { isSupabaseConfigured } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/shifts", label: "シフト" },
  { href: "/expenses", label: "支出" },
  { href: "/settings", label: "設定" },
];

/** ログイン必須ページを包む。認証ガード + ナビゲーション。 */
export function AppShell({ children }: { children: ReactNode }) {
  const { ready, session, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (ready && configured && !session) {
      router.replace("/login");
    }
  }, [ready, configured, session, router]);

  if (!configured) return <SetupNotice />;
  if (!ready) return <FullScreenMessage>読み込み中…</FullScreenMessage>;
  if (!session) return <FullScreenMessage>ログイン画面へ移動中…</FullScreenMessage>;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            norimoney
          </Link>
          <button
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5">{children}</main>

      <nav className="sticky bottom-0 border-t border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex w-full max-w-2xl">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 py-3 text-center text-sm font-medium ${
                  active
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 text-center text-slate-500">
      {children}
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-bold">Supabase の設定が必要です</h1>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">.env.local</code>{" "}
        に接続情報が未設定です。以下を行ってください：
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>Supabase でプロジェクトを作成</li>
        <li>
          <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">supabase/schema.sql</code>{" "}
          を SQL Editor で実行
        </li>
        <li>
          <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">.env.local.example</code>{" "}
          を <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">.env.local</code>{" "}
          にコピーして URL / anon key を記入
        </li>
        <li>開発サーバーを再起動</li>
      </ol>
    </div>
  );
}
