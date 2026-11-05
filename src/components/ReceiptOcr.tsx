"use client";

import { useState } from "react";
import { ocrReceiptImage } from "@/lib/ocr";
import { createExpensesBulk, type ExpenseDraft } from "@/lib/data";
import { EXPENSE_CATEGORIES, PAY_METHODS } from "@/lib/categories";
import { yen, shortDate } from "@/lib/format";
import type { ParsedExpense } from "@/lib/csv";

type Phase = "idle" | "reading" | "review";

export function ReceiptOcr({
  onImported,
  onCancel,
  onError,
}: {
  onImported: (count: number) => void | Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<ParsedExpense[]>([]);
  const [category, setCategory] = useState("food");
  const [payMethod, setPayMethod] = useState("paypay");
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase("reading");
    try {
      const result = await ocrReceiptImage(file);
      setItems(result);
      setPhase("review");
      if (result.length === 0) {
        onError("画像から支出を読み取れませんでした。別の画像で試してください。");
      }
    } catch (err) {
      setPhase("idle");
      onError(err instanceof Error ? err.message : "OCR に失敗しました。");
    } finally {
      // 同じファイルを選び直せるように input をリセット
      e.target.value = "";
    }
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function doImport() {
    if (items.length === 0) return;
    setBusy(true);
    try {
      const drafts: ExpenseDraft[] = items.map((it) => ({
        spent_on: it.spent_on,
        amount: it.amount,
        category,
        store: it.store,
        pay_method: payMethod || null,
        memo: null,
        source: "ocr",
      }));
      const n = await createExpensesBulk(drafts);
      await onImported(n);
    } catch (err) {
      onError(err instanceof Error ? err.message : "登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">レシート・画像から取込</div>
        <button onClick={onCancel} className="text-sm text-slate-500 hover:underline">
          閉じる
        </button>
      </div>

      <p className="text-xs text-slate-500">
        レシートの写真、または PayPay 等の取引履歴のスクショを選ぶと、金額・店名・日付を自動抽出します。
        ポイント付与や返金は自動で除外します。画像は保存されません。
      </p>

      {phase !== "review" && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 py-8 text-sm text-slate-500 dark:border-slate-700">
          {phase === "reading" ? (
            <span>読み取り中…（数秒かかります）</span>
          ) : (
            <>
              <span className="text-2xl">📷</span>
              <span>写真を撮る / 画像を選ぶ</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            disabled={phase === "reading"}
            className="hidden"
          />
        </label>
      )}

      {phase === "review" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="カテゴリ（一括）">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="支払方法（一括）">
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputCls}>
                {PAY_METHODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <div className="mb-2 font-medium">読み取り結果 {items.length} 件</div>
            {items.length === 0 ? (
              <div className="text-slate-400">支出は見つかりませんでした。</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 tabular-nums">
                    <span className="min-w-0 truncate text-slate-500">
                      {shortDate(it.spent_on)} {it.store ?? ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{yen(it.amount)}</span>
                      <button
                        onClick={() => removeItem(i)}
                        className="text-xs text-rose-500 hover:underline"
                        aria-label="この行を除外"
                      >
                        除外
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={doImport}
              disabled={busy || items.length === 0}
              className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? "登録中…" : `${items.length} 件を登録`}
            </button>
            <button
              onClick={() => {
                setItems([]);
                setPhase("idle");
              }}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm dark:border-slate-700"
            >
              撮り直し
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
