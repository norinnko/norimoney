/**
 * csv.ts — CSV の解析と、支出レコードへのマッピング（純粋関数）。
 *
 * 明細CSVはプロバイダごとに列順・文字コード・日付書式・金額表記が違う。
 * ここではフォーマットを決め打ちにせず、
 *   1) CSV を2次元配列にパース
 *   2) ユーザーが「日付 / 金額 / 店名」の列を指定
 *   3) 各行を支出ドラフトに変換
 * という汎用フローにする。文字コードのデコードは UI 側（TextDecoder）で行う。
 */

/**
 * RFC4180 風の CSV パーサ。ダブルクォート内のカンマ・改行・エスケープ("")に対応。
 * 区切り文字は既定カンマ（タブ等も指定可）。
 */
export function parseCSV(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // 先頭の BOM は除去。
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // CRLF / CR を吸収（次が \n ならスキップ）。
      if (s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // 最終フィールド（末尾に改行が無い場合）。
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 完全な空行は除去。
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * 金額文字列を整数(円)に変換する。失敗時は null。
 * "¥1,234" / "1,234円" / "-500" / "(500)" / 全角カンマ 等に対応。
 */
export function parseAmount(raw: string): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "") return null;
  // 括弧はマイナス表記とみなす。
  const paren = /^\((.*)\)$/.exec(s);
  let negative = false;
  if (paren) {
    negative = true;
    s = paren[1];
  }
  // 通貨記号・カンマ・空白・「円」を除去。全角カンマも。
  s = s.replace(/[¥￥,，\s円]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * 日付文字列を "YYYY-MM-DD" に正規化する。失敗時は null。
 * "2026/07/22" / "2026-7-2" / "2026.07.22" / "2026年7月22日" に対応。
 */
export function parseFlexibleDate(raw: string): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  const m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** 列マッピング（0始まりの列インデックス）。store は任意。 */
export interface ColumnMapping {
  date: number;
  amount: number;
  store?: number;
}

export interface ParsedExpense {
  spent_on: string;
  amount: number;
  store: string | null;
}

export interface MapResult {
  /** 取り込み可能な行。 */
  records: ParsedExpense[];
  /** 日付か金額が読めずスキップした行数。 */
  skippedInvalid: number;
  /** 金額が0以下（返金・支払以外）でスキップした行数。 */
  skippedNonPositive: number;
}

export interface MapOptions {
  /** 先頭行をヘッダーとして飛ばすか。 */
  hasHeader: boolean;
}

/**
 * パース済み2次元配列を、列マッピングに従って支出ドラフトへ変換する。
 * 支出（お金が出た行）だけを取り込むため、金額が正の行のみ採用する。
 */
export function mapRowsToExpenses(
  rows: string[][],
  mapping: ColumnMapping,
  options: MapOptions,
): MapResult {
  const body = options.hasHeader ? rows.slice(1) : rows;
  const records: ParsedExpense[] = [];
  let skippedInvalid = 0;
  let skippedNonPositive = 0;

  for (const row of body) {
    const date = parseFlexibleDate(row[mapping.date] ?? "");
    const amount = parseAmount(row[mapping.amount] ?? "");
    if (!date || amount === null) {
      skippedInvalid++;
      continue;
    }
    if (amount <= 0) {
      skippedNonPositive++;
      continue;
    }
    const store =
      mapping.store != null ? (row[mapping.store]?.trim() || null) : null;
    records.push({ spent_on: date, amount, store });
  }

  return { records, skippedInvalid, skippedNonPositive };
}

/** 既知プロバイダの列マッピング推定（ヘッダー名から）。無ければ null。 */
export function guessMapping(header: string[]): ColumnMapping | null {
  const norm = header.map((h) => h.trim());
  const find = (patterns: RegExp[]) =>
    norm.findIndex((h) => patterns.some((p) => p.test(h)));

  const date = find([/日付/, /利用日/, /ご利用日/, /date/i, /取引日/]);
  const amount = find([/金額/, /利用額/, /ご利用金額/, /amount/i, /支払/]);
  const store = find([/店名/, /利用先/, /ご利用先/, /店舗/, /摘要/, /内容/, /説明/, /name/i]);

  if (date === -1 || amount === -1) return null;
  return { date, amount, store: store === -1 ? undefined : store };
}
