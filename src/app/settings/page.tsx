"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import {
  getSettings,
  updateSettings,
  listJobs,
  updateJob,
  createJob,
} from "@/lib/data";
import { yen } from "@/lib/format";
import type { JobRow, SettingsRow } from "@/lib/database.types";

/** 年収の壁プリセット（2026年基準）。金額はいつでも設定で上書きできる。 */
const WALL_PRESETS: { kind: string; label: string; limit: number; note: string }[] = [
  { kind: "tax_dependent", label: "税の扶養", limit: 1360000, note: "2026年分 136万" },
  { kind: "social_insurance", label: "社保の扶養", limit: 1500000, note: "150万未満" },
  { kind: "income_tax", label: "本人所得税", limit: 1780000, note: "2026年分 178万" },
];

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsView />
    </AppShell>
  );
}

function SettingsView() {
  const { session } = useAuth();
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [s, j] = await Promise.all([getSettings(), listJobs()]);
        setSettings(s);
        setJobs(j);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveWall(kind: string, limit: number) {
    try {
      await updateSettings({ wall_kind: kind, wall_limit: limit });
      setSettings((prev) => (prev ? { ...prev, wall_kind: kind, wall_limit: limit } : prev));
      flashSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
    }
  }

  async function saveJob(id: string, patch: Partial<JobRow>) {
    try {
      await updateJob(id, patch);
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
      flashSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
    }
  }

  async function addJob() {
    try {
      const j = await createJob({ name: "新しいバイト先", sort_order: jobs.length });
      setJobs((prev) => [...prev, j]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました。");
    }
  }

  if (loading) return <div className="text-center text-sm text-slate-400">読み込み中…</div>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">設定</h1>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg bg-emerald-50 p-2 text-center text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          保存しました
        </div>
      )}

      {/* 年収の壁 */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">年収の壁</h2>
        <div className="grid grid-cols-1 gap-2">
          {WALL_PRESETS.map((p) => {
            const active = settings?.wall_kind === p.kind && settings?.wall_limit === p.limit;
            return (
              <button
                key={p.kind}
                onClick={() => saveWall(p.kind, p.limit)}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-slate-400">{p.note}</div>
                </div>
                <div className="font-bold tabular-nums">{yen(p.limit)}</div>
              </button>
            );
          })}
        </div>
        {/* カスタム金額 */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600 dark:text-slate-300">カスタム金額（円）</span>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              defaultValue={settings?.wall_limit ?? 1360000}
              className={inputCls}
              id="custom-wall"
            />
            <button
              onClick={() => {
                const el = document.getElementById("custom-wall") as HTMLInputElement | null;
                const v = Number(el?.value);
                if (v > 0) saveWall("custom", v);
              }}
              className="rounded-lg bg-slate-800 px-4 text-sm font-medium text-white dark:bg-slate-200 dark:text-slate-900"
            >
              適用
            </button>
          </div>
        </label>
      </section>

      {/* バイト先 */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">バイト先</h2>
          <button onClick={addJob} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
            ＋ 追加
          </button>
        </div>
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onSave={(patch) => saveJob(job.id, patch)} />
        ))}
      </section>
    </div>
  );
}

function JobCard({ job, onSave }: { job: JobRow; onSave: (patch: Partial<JobRow>) => void }) {
  const [name, setName] = useState(job.name);
  const [wage, setWage] = useState(String(job.hourly_wage));
  const [nightRate, setNightRate] = useState(String(job.night_rate));
  const [transport, setTransport] = useState(String(job.transport_per_day));
  const [closing, setClosing] = useState(String(job.closing_day));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-600 dark:text-slate-300">店名</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="時給（円）">
          <input type="number" min={0} value={wage} onChange={(e) => setWage(e.target.value)} className={inputCls} />
        </Field>
        <Field label="深夜割増率">
          <input type="number" step={0.05} min={1} value={nightRate} onChange={(e) => setNightRate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="交通費/日（円）">
          <input type="number" min={0} value={transport} onChange={(e) => setTransport(e.target.value)} className={inputCls} />
        </Field>
        <Field label="締め日（31=末日）">
          <input type="number" min={1} max={31} value={closing} onChange={(e) => setClosing(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <button
        onClick={() =>
          onSave({
            name: name.trim() || "バイト先",
            hourly_wage: Number(wage) || 0,
            night_rate: Number(nightRate) || 1.25,
            transport_per_day: Number(transport) || 0,
            closing_day: Number(closing) || 31,
          })
        }
        className="rounded-lg bg-indigo-600 py-2.5 font-semibold text-white transition hover:bg-indigo-700"
      >
        保存
      </button>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
