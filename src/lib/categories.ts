/** 支出カテゴリと支払方法の定義。DB には value(英字) を保存し、UI では label を表示する。 */

export const EXPENSE_CATEGORIES: { value: string; label: string; emoji: string }[] = [
  { value: "food", label: "食費", emoji: "🍚" },
  { value: "daily", label: "日用品", emoji: "🧴" },
  { value: "transport", label: "交通", emoji: "🚃" },
  { value: "social", label: "交際", emoji: "🍻" },
  { value: "fun", label: "娯楽", emoji: "🎮" },
  { value: "clothes", label: "衣服", emoji: "👕" },
  { value: "health", label: "医療", emoji: "💊" },
  { value: "study", label: "学業", emoji: "📚" },
  { value: "other", label: "その他", emoji: "📦" },
];

export const PAY_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "現金" },
  { value: "paypay", label: "PayPay" },
  { value: "rakuten", label: "楽天カード" },
  { value: "other", label: "その他" },
];

const CATEGORY_MAP = new Map(EXPENSE_CATEGORIES.map((c) => [c.value, c]));
const PAY_METHOD_MAP = new Map(PAY_METHODS.map((p) => [p.value, p]));

export function categoryLabel(value: string): string {
  const c = CATEGORY_MAP.get(value);
  return c ? `${c.emoji} ${c.label}` : value;
}

export function payMethodLabel(value: string | null): string {
  if (!value) return "";
  return PAY_METHOD_MAP.get(value)?.label ?? value;
}
