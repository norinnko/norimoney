"use client";

import { useMemo, useState } from "react";
import {
  parseCSV,
  mapRowsToExpenses,
  guessMapping,
  type ColumnMapping,
} from "@/lib/csv";
import { createExpensesBulk, type ExpenseDraft } from "@/lib/data";
import { EXPENSE_CATEGORIES, PAY_METHODS } from "@/lib/categories";
import { yen, shortDate } from "@/lib/format";

type Encoding = "utf-8" | "shift_jis";

/** 文字化け（U+FFFD）が多ければ Shift_JIS の可能性が高い、という簡易判定。 */
function looksGarbled(text: string): boolean {
  const bad = (text.match(/�/g) ?? []).length;
  return bad > 3;
}

export function CsvImport({
  onImported,
  onCancel,
  onError,
}: {
  onImported: (count: number) => void | Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState<Encoding>("utf-8");
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: 0, amount: 1 });
  const [category, setCategory] = useState("other");
  const [payMethod, setPayMethod] = useState("other");
  const [busy, setBusy] = useState(false);

  // バッファ＋エンコーディングからテキストを復元し、CSV をパース。
  const rows = useMemo(() => {
    if (!buffer) return [] as string[][];
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      return parseCSV(text);
    } catch {
      return [] as string[][];
    }
  }, [buffer, encoding]);

  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const sampleRow = hasHeader ? rows[1] : rows[0];
  const headerRow = rows[0];

  const preview = useMemo(
    () => mapRowsToExpenses(rows, mapping, { hasHeader }),
    [rows, mapping, hasHeader],
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    // まず UTF-8 で試し、文字化けが多ければ Shift_JIS に切替。
    const utf = new TextDecoder("utf-8").decode(buf);
    const enc: Encoding = looksGarbled(utf) ? "shift_jis" : "utf-8";
    setEncoding(enc);
    setBuffer(buf);

    // ヘッダーから列を推定。
    const parsed = parseCSV(new TextDecoder(enc).decode(buf));
    const guessed = parsed[0] ? guessMapping(parsed[0]) : null;
    if (guessed) {
      setMapping(guessed);
      setHasHeader(true);
    }
  }

  async function doImport() {
    if (preview.records.length === 0) return;
    setBusy(true);
    try {
      const drafts: ExpenseDraft[] = preview.records.map((r) => ({
        spent_on: r.spent_on,
        amount: r.amount,
        category,
        store: r.store,
        pay_method: payMethod || null,
        memo: null,
        source: "csv",
      }));
      const n = await createExpensesBulk(drafts);
      await onImported(n);
    } catch (err) {
      onError(err instanceof Error ? err.message : "取り込みに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  const colOptions = Array.from({ length: colCount }, (_, i) => i);
  const colLabel = (i: number) => {
    const head = hasHeader ? headerRow?.[i]?.trim() : undefined;
    const sample = sampleRow?.[i]?.trim();
    const suffix = head || sample || "";
    return `列${i + 1}${suffix ? `: ${suffix.slice(0, 12)}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">CSV インポート</div>
        <button onClick={onCancel} className="text-sm text-slate-500 hover:underline">
          閉じる
        </button>
      </div>

      <p className="text-xs text-slate-500">
        楽天カード・PayPay 等の明細CSVを取り込みます。列を対応づけてプレビューを確認してから取り込みます。
        金額が正の行（＝支出）のみ取り込み、返金などは自動でスキップします。
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-white"
      />
      {fileName && <div className="text-xs text-slate-500">選択中: {fileName}</div>}

      {buffer && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="文字コード">
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value as Encoding)}
                className={inputCls}
              >
                <option value="utf-8">UTF-8</option>
                <option value="shift_jis">Shift_JIS（楽天カード等）</option>
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
              先頭行はヘッダー
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="日付の列">
              <select
                value={mapping.date}
                onChange={(e) => setMapping((m) => ({ ...m, date: Number(e.target.value) }))}
                className={inputCls}
              >
                {colOptions.map((i) => (
                  <option key={i} value={i}>
                    {colLabel(i)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="金額の列">
              <select
                value={mapping.amount}
                onChange={(e) => setMapping((m) => ({ ...m, amount: Number(e.target.value) }))}
                className={inputCls}
              >
                {colOptions.map((i) => (
                  <option key={i} value={i}>
                    {colLabel(i)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="店名の列（任意）">
              <select
                value={mapping.store ?? -1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMapping((m) => ({ ...m, store: v === -1 ? undefined : v }));
                }}
                className={inputCls}
              >
                <option value={-1}>なし</option>
                {colOptions.map((i) => (
                  <option key={i} value={i}>
                    {colLabel(i)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

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

          {/* プレビュー */}
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <div className="mb-2 font-medium">
              取り込み {preview.records.length} 件
              {preview.skippedNonPositive > 0 && (
                <span className="text-slate-400">
                  {" "}
                  / 返金等スキップ {preview.skippedNonPositive}
                </span>
              )}
              {preview.skippedInvalid > 0 && (
                <span className="text-slate-400"> / 不正 {preview.skippedInvalid}</span>
              )}
            </div>
            <ul className="flex flex-col gap-1">
              {preview.records.slice(0, 5).map((r, i) => (
                <li key={i} className="flex justify-between tabular-nums">
                  <span className="text-slate-500">
                    {shortDate(r.spent_on)} {r.store ?? ""}
                  </span>
                  <span className="font-medium">{yen(r.amount)}</span>
                </li>
              ))}
              {preview.records.length > 5 && (
                <li className="text-slate-400">…ほか {preview.records.length - 5} 件</li>
              )}
            </ul>
          </div>

          <button
            onClick={doImport}
            disabled={busy || preview.records.length === 0}
            className="rounded-lg bg-indigo-600 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "取り込み中…" : `${preview.records.length} 件を取り込む`}
          </button>
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
