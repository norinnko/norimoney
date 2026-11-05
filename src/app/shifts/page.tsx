"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import {
  listJobs,
  listShiftsInRange,
  createShift,
  updateShift,
  deleteShift,
  toShiftInput,
  type ShiftDraft,
} from "@/lib/data";
import { calcShiftPay, validateShift } from "@/lib/payroll";
import {
  payPeriodFor,
  payPeriodLabel,
  shiftPeriod,
  iso,
  type DateRange,
} from "@/lib/period";
import { yen, hoursLabel, shortDate, hhmm } from "@/lib/format";
import type { JobRow, ShiftRow } from "@/lib/database.types";

function todayISO(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export default function ShiftsPage() {
  return (
    <AppShell>
      <ShiftsView />
    </AppShell>
  );
}

function ShiftsView() {
  const { session } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [period, setPeriod] = useState<DateRange | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [editing, setEditing] = useState<ShiftRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const closingDay = jobs[0]?.closing_day ?? 31;
  const fallbackWage = jobs[0]?.hourly_wage ?? 1100;
  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const j = await listJobs();
        setJobs(j);
        setPeriod(payPeriodFor(j[0]?.closing_day ?? 31, todayISO()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
        setLoading(false);
      }
    })();
  }, [session]);

  const reload = useCallback(async () => {
    if (!period) return;
    try {
      const list = await listShiftsInRange(period.start, period.end);
      setShifts(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  async function onDelete(id: string) {
    if (!confirm("このシフトを削除しますか？")) return;
    try {
      await deleteShift(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 期間ナビ */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => period && setPeriod(shiftPeriod(closingDay, period, -1))}
          className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          aria-label="前の期間"
        >
          ◀
        </button>
        <div className="text-lg font-bold">
          {period ? payPeriodLabel(period) : "—"}
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

      {editing === null && (
        <button
          onClick={() => setEditing("new")}
          className="rounded-xl bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700"
        >
          ＋ シフトを追加
        </button>
      )}

      {editing !== null && (
        <ShiftForm
          jobs={jobs}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
          onError={setError}
        />
      )}

      {loading && <div className="text-center text-sm text-slate-400">読み込み中…</div>}

      <ul className="flex flex-col gap-2">
        {shifts.map((s) => {
          const pay = Math.round(calcShiftPay(toShiftInput(s, jobsById, fallbackWage)).pay);
          const worked = calcShiftPay(toShiftInput(s, jobsById, fallbackWage)).workedMinutes;
          const job = s.job_id ? jobsById.get(s.job_id) : undefined;
          return (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{shortDate(s.work_date)}</span>
                  {s.is_confirmed ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                      確定
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                      見込み
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  {hhmm(s.start_at)}〜{hhmm(s.end_at)} ・ {hoursLabel(worked)}
                  {job ? ` ・ ${job.name}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold tabular-nums">{yen(pay)}</span>
                <button
                  onClick={() => setEditing(s)}
                  className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  編集
                </button>
                <button
                  onClick={() => onDelete(s.id)}
                  className="text-sm text-rose-500 hover:underline"
                >
                  削除
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {!loading && shifts.length === 0 && editing === null && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          この期間のシフトはまだありません。
        </div>
      )}
    </div>
  );
}

function ShiftForm({
  jobs,
  initial,
  onCancel,
  onSaved,
  onError,
}: {
  jobs: JobRow[];
  initial: ShiftRow | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [workDate, setWorkDate] = useState(initial?.work_date ?? todayISO());
  const [jobId, setJobId] = useState<string>(initial?.job_id ?? jobs[0]?.id ?? "");
  const [start, setStart] = useState(hhmm(initial?.start_at ?? "17:00"));
  const [end, setEnd] = useState(hhmm(initial?.end_at ?? "22:00"));
  const [breakMin, setBreakMin] = useState(String(initial?.break_minutes ?? 0));
  const [wageOverride, setWageOverride] = useState(
    initial?.wage_override != null ? String(initial.wage_override) : "",
  );
  const [confirmed, setConfirmed] = useState(initial?.is_confirmed ?? false);
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [busy, setBusy] = useState(false);

  const errors = validateShift({ start, end, breakMinutes: Number(breakMin) || 0 });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (errors.length > 0) return;
    setBusy(true);
    const draft: ShiftDraft = {
      job_id: jobId || null,
      work_date: workDate,
      start_at: start,
      end_at: end,
      break_minutes: Number(breakMin) || 0,
      wage_override: wageOverride ? Number(wageOverride) : null,
      is_confirmed: confirmed,
      memo: memo.trim() || null,
    };
    try {
      if (initial) await updateShift(initial.id, draft);
      else await createShift(draft);
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="text-sm font-semibold">
        {initial ? "シフトを編集" : "シフトを追加"}
      </div>

      <Field label="日付">
        <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={inputCls} required />
      </Field>

      {jobs.length > 1 && (
        <Field label="バイト先">
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={inputCls}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="開始">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="終了（翌日でも可）">
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="休憩（分）">
          <input type="number" min={0} value={breakMin} onChange={(e) => setBreakMin(e.target.value)} className={inputCls} />
        </Field>
        <Field label="時給（この日だけ変更・任意）">
          <input
            type="number"
            min={0}
            placeholder={`既定 ${jobs.find((j) => j.id === jobId)?.hourly_wage ?? ""}`}
            value={wageOverride}
            onChange={(e) => setWageOverride(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="メモ（任意）">
        <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputCls} />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        実績確定（見込みではなく確定した勤務）
      </label>

      {errors.length > 0 && (
        <ul className="text-sm text-rose-600">
          {errors.map((msg) => (
            <li key={msg}>・{msg}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || errors.length > 0}
          className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm dark:border-slate-700"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
