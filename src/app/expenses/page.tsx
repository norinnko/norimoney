"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CsvImport } from "@/components/CsvImport";
import { useAuth } from "@/components/AuthProvider";
import {
  listJobs,
  listExpensesInRange,
  createExpense,
  updateExpense,
  deleteExpense,
  type ExpenseDraft,
} from "@/lib/data";
import {
  payPeriodFor,
  payPeriodLabel,
  shiftPeriod,
  iso,
  type DateRange,
} from "@/lib/period";
import { yen, shortDate } from "@/lib/format";
import {
  EXPENSE_CATEGORIES,
  PAY_METHODS,
  categoryLabel,
  payMethodLabel,
} from "@/lib/categories";
import type { ExpenseRow } from "@/lib/database.types";

function todayISO(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export default function ExpensesPage() {
  return (
    <AppShell>
      <ExpensesView />
    </AppShell>
  );
}

function ExpensesView() {
  const { session } = useAuth();
  const [closingDay, setClosingDay] = useState(31);
  const [period, setPeriod] = useState<DateRange | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 締め日は主 job から取得（支出も同じ期間で見る）。
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const j = await listJobs();
        const cd = j[0]?.closing_day ?? 31;
        setClosingDay(cd);
        setPeriod(payPeriodFor(cd, todayISO()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
        setLoading(false);
      }
    })();
  }, [session]);

  const reload = useCallback(async () => {
    if (!period) return;
    try {
      const list = await listExpensesInRange(period.start, period.end);
      setExpenses(list);
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

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  async function onDelete(id: string) {
    if (!confirm("この支出を削除しますか？")) return;
    try {
      await deleteExpense(id);
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
        <div className="text-center">
          <div className="text-lg font-bold">
            {period ? payPeriodLabel(period) : "—"}
          </div>
          <div className="text-xs text-slate-400">支出合計 {yen(total)}</div>
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

      {editing === null && !importing && (
        <div className="flex gap-2">
          <button
            onClick={() => setEditing("new")}
            className="flex-1 rounded-xl bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700"
          >
            ＋ 支出を追加
          </button>
          <button
            onClick={() => setImporting(true)}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium dark:border-slate-700"
          >
            CSV取込
          </button>
        </div>
      )}

      {importing && (
        <CsvImport
          onCancel={() => setImporting(false)}
          onImported={async (count) => {
            setImporting(false);
            setError(null);
            await reload();
            if (count === 0) setError("取り込める行がありませんでした。列の対応や文字コードを確認してください。");
          }}
          onError={setError}
        />
      )}

      {editing !== null && (
        <ExpenseForm
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
        {expenses.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{categoryLabel(e.category)}</span>
                {e.source !== "manual" && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                    {e.source.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="truncate text-sm text-slate-500">
                {shortDate(e.spent_on)}
                {e.store ? ` ・ ${e.store}` : ""}
                {e.pay_method ? ` ・ ${payMethodLabel(e.pay_method)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-bold tabular-nums">{yen(e.amount)}</span>
              <button
                onClick={() => setEditing(e)}
                className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
              >
                編集
              </button>
              <button
                onClick={() => onDelete(e.id)}
                className="text-sm text-rose-500 hover:underline"
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!loading && expenses.length === 0 && editing === null && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          この期間の支出はまだありません。
        </div>
      )}
    </div>
  );
}

function ExpenseForm({
  initial,
  onCancel,
  onSaved,
  onError,
}: {
  initial: ExpenseRow | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [spentOn, setSpentOn] = useState(initial?.spent_on ?? todayISO());
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial?.category ?? "food");
  const [store, setStore] = useState(initial?.store ?? "");
  const [payMethod, setPayMethod] = useState(initial?.pay_method ?? "cash");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const valid = amount !== "" && Number.isFinite(amountNum) && amountNum >= 0;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!valid) return;
    setBusy(true);
    const draft: ExpenseDraft = {
      spent_on: spentOn,
      amount: Math.round(amountNum),
      category,
      store: store.trim() || null,
      pay_method: payMethod || null,
      memo: memo.trim() || null,
      source: initial?.source ?? "manual",
    };
    try {
      if (initial) await updateExpense(initial.id, draft);
      else await createExpense(draft);
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
        {initial ? "支出を編集" : "支出を追加"}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="日付">
          <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="金額（円）">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
      </div>

      <Field label="カテゴリ">
        <div className="grid grid-cols-3 gap-2">
          {EXPENSE_CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`rounded-lg border px-2 py-2 text-sm transition ${
                category === c.value
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                  : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="店名（任意）">
          <input type="text" value={store} onChange={(e) => setStore(e.target.value)} className={inputCls} />
        </Field>
        <Field label="支払方法">
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputCls}>
            {PAY_METHODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="メモ（任意）">
        <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputCls} />
      </Field>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !valid}
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
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
