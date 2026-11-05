"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { WallGauge } from "@/components/WallGauge";
import { useAuth } from "@/components/AuthProvider";
import {
  getSettings,
  listJobs,
  listShiftsInRange,
  listExpensesInRange,
  toShiftInput,
} from "@/lib/data";
import { summarizeShifts } from "@/lib/payroll";
import {
  payPeriodFor,
  payPeriodLabel,
  shiftPeriod,
  taxYearRange,
  iso,
  type DateRange,
} from "@/lib/period";
import { yen, hoursLabel } from "@/lib/format";
import type { JobRow, SettingsRow, ShiftRow } from "@/lib/database.types";

function todayISO(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function wallDisplayName(kind: string): string {
  const map: Record<string, string> = {
    tax_dependent: "税の扶養",
    social_insurance: "社保の扶養",
    income_tax: "本人所得税",
  };
  return map[kind] ?? "設定ライン";
}

/** シフト群の交通費を job ごとの出勤日数で正しく合算する。 */
function sumTransport(shifts: ShiftRow[], jobsById: Map<string, JobRow>): number {
  const daysByJob = new Map<string, Set<string>>();
  for (const s of shifts) {
    if (!s.job_id) continue;
    if (!daysByJob.has(s.job_id)) daysByJob.set(s.job_id, new Set());
    daysByJob.get(s.job_id)!.add(s.work_date);
  }
  let total = 0;
  for (const [jobId, days] of daysByJob) {
    const job = jobsById.get(jobId);
    if (job) total += job.transport_per_day * days.size;
  }
  return total;
}

export default function HomePage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { session } = useAuth();
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [period, setPeriod] = useState<DateRange | null>(null);
  const [periodShifts, setPeriodShifts] = useState<ShiftRow[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [annualWage, setAnnualWage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const closingDay = jobs[0]?.closing_day ?? 31;
  const fallbackWage = jobs[0]?.hourly_wage ?? 1100;

  // 初期ロード: 設定・job・期間の初期化。
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [s, j] = await Promise.all([getSettings(), listJobs()]);
        setSettings(s);
        setJobs(j);
        const cd = j[0]?.closing_day ?? 31;
        setPeriod(payPeriodFor(cd, todayISO()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
        setLoading(false);
      }
    })();
  }, [session]);

  // 期間が変わるたびに、その期間のシフト＋今年の累計を取得。
  const reload = useCallback(async () => {
    if (!period) return;
    try {
      const year = Number(period.end.slice(0, 4));
      const yr = taxYearRange(year);
      const [inPeriod, inYear, periodExpenses] = await Promise.all([
        listShiftsInRange(period.start, period.end),
        listShiftsInRange(yr.start, yr.end),
        listExpensesInRange(period.start, period.end),
      ]);
      setPeriodShifts(inPeriod);
      setExpenseTotal(periodExpenses.reduce((s, e) => s + e.amount, 0));
      const jobsById = new Map(jobs.map((j) => [j.id, j]));
      const yearInputs = inYear.map((r) => toShiftInput(r, jobsById, fallbackWage));
      setAnnualWage(summarizeShifts(yearInputs).wageTotal);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [period, jobs, fallbackWage]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const summary = summarizeShifts(
    periodShifts.map((r) => toShiftInput(r, jobsById, fallbackWage)),
    { workDates: periodShifts.map((r) => r.work_date) },
  );
  const transport = sumTransport(periodShifts, jobsById);
  const grandTotal = summary.wageTotal + transport;
  const net = grandTotal - expenseTotal;

  const wallLimit = settings?.wall_limit ?? 1360000;
  const wallName = `${wallDisplayName(settings?.wall_kind ?? "tax_dependent")}(${Math.round(
    wallLimit / 10000,
  )}万)`;

  return (
    <div className="flex flex-col gap-5">
      {/* 期間ナビ */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => period && setPeriod(shiftPeriod(closingDay, period, -1))}
          className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          aria-label="前の期間"
        >
          ◀
        </button>
        <div className="text-center">
          <div className="text-lg font-bold">
            {period ? payPeriodLabel(period) : "—"}
          </div>
          {period && (
            <div className="text-xs text-slate-400">
              {period.start} 〜 {period.end}
            </div>
          )}
        </div>
        <button
          onClick={() => period && setPeriod(shiftPeriod(closingDay, period, 1))}
          className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          aria-label="次の期間"
        >
          ▶
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* 今期の見込み */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          今期の見込み
        </h2>
        <div className="mt-1 text-4xl font-bold tabular-nums">{yen(grandTotal)}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Stat label="賃金" value={yen(summary.wageTotal)} />
          <Stat label="交通費" value={yen(transport)} />
          <Stat label="労働時間" value={hoursLabel(summary.totalWorkedMinutes)} />
          <Stat label="うち深夜" value={hoursLabel(summary.totalNightMinutes)} />
          <Stat label="出勤日数" value={`${summary.workDays}日`} />
          <Stat label="シフト数" value={`${periodShifts.length}件`} />
        </div>
      </section>

      {/* 今期の収支 */}
      <section className="grid grid-cols-3 gap-3">
        <NetTile label="収入" value={yen(grandTotal)} tone="in" />
        <NetTile label="支出" value={yen(expenseTotal)} tone="out" />
        <NetTile label="収支" value={yen(net)} tone={net >= 0 ? "in" : "out"} strong />
      </section>

      {/* 壁ゲージ */}
      <WallGauge current={annualWage} limit={wallLimit} wallName={wallName} />

      {loading && (
        <div className="text-center text-sm text-slate-400">読み込み中…</div>
      )}

      {!loading && periodShifts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          この期間のシフトはまだありません。
        </div>
      )}

      <Link
        href="/shifts"
        className="rounded-xl bg-indigo-600 py-3 text-center font-semibold text-white transition hover:bg-indigo-700"
      >
        シフトを追加・編集する
      </Link>
    </div>
  );
}

function NetTile({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone: "in" | "out";
  strong?: boolean;
}) {
  const color =
    tone === "in"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`${strong ? "text-lg font-bold" : "font-semibold"} tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
