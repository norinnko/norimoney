/**
 * ocr.ts — レシート/画像OCR のクライアント側ヘルパ。
 * 画像を base64 にして Supabase Edge Function(ocr-receipt) に送り、抽出結果を受け取る。
 * 画像はどこにも保存しない（Edge Function 側も破棄する）。
 */
import { getSupabase } from "./supabase";
import { iso } from "./period";
import type { ParsedExpense } from "./csv";

/** File を "base64本体" と media_type に分解する。 */
function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
    reader.onload = () => {
      const result = String(reader.result);
      // "data:image/jpeg;base64,XXXX" → mediaType と本体に分解
      const m = /^data:(.+?);base64,(.*)$/.exec(result);
      if (!m) {
        reject(new Error("画像の形式を認識できませんでした。"));
        return;
      }
      resolve({ mediaType: m[1], data: m[2] });
    };
    reader.readAsDataURL(file);
  });
}

function todayISO(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/**
 * 画像を OCR して支出候補を返す。
 * 返り値は CSV と同じ ParsedExpense[]（プレビュー・一括登録を共通化するため）。
 */
export async function ocrReceiptImage(file: File): Promise<ParsedExpense[]> {
  const { data, mediaType } = await fileToBase64(file);

  const { data: res, error } = await getSupabase().functions.invoke<{
    items?: ParsedExpense[];
    error?: string;
  }>("ocr-receipt", {
    body: { image: data, media_type: mediaType, today: todayISO() },
  });

  if (error) {
    throw new Error(
      "OCR の呼び出しに失敗しました。Edge Function のデプロイと ANTHROPIC_API_KEY の設定を確認してください。",
    );
  }
  if (res?.error) throw new Error(res.error);
  return res?.items ?? [];
}
