<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# norimoney

バイトのシフト・給料・支出を管理する PWA。年収の壁ゲージ付き。
学生・フリーター向け。「今月いくら稼いだか」「壁まであといくらか」が一目で分かることがコアバリュー。

## 技術構成
- Next.js 16 (App Router) / TypeScript / Tailwind v4
- `output: 'export'` の静的エクスポート（**SSR・API Routes は使用禁止**）
- Supabase (Auth + Postgres + RLS)。ブラウザから直接叩く。
- デプロイ先: CORESERVER に `out/` を FTP アップ
- レシート OCR のみ Supabase Edge Function 経由で Claude(vision) を呼ぶ（CORESERVER 側はサーバー処理ゼロを維持）

## 制約
- CORESERVER 側にサーバーサイド処理を書かないこと（Node 常駐不可の共用サーバー）
- 金銭データは全て `user_id` 紐付け、RLS 必須
- レシート画像はサーバー保存しない（金額/店名/日付を抽出したら破棄）
- 金額は integer（円単位）、小数を使わない
- 年収の壁の閾値はハードコードせず設定値として持つ（`settings.wall_limit`）

## 開発ルール
- 給料計算ロジックは `src/lib/payroll.ts` に純粋関数で置く（UI/Supabase を import しない）
- ロジック変更時は必ずテスト（`src/lib/payroll.test.ts`）も更新する。`npm test` で確認
- テーブル追加時は必ず RLS を有効化し、`using` と `with check` の両方を書く
- 内部計算は分単位の整数で厳密に。丸めは月合計で1回だけ

## 主要ファイル
- `src/lib/payroll.ts` — 給料計算の純粋関数（深夜割増・日またぎ・休憩比例控除）
- `supabase/schema.sql` — スキーマ + RLS + トリガー（Supabase SQL Editor に貼る）

## 実装順序
1. ✅ `src/lib/payroll.ts` + テスト
2. Supabase スキーマ適用 + RLS 検証（アカウント2つで越境不可を実測）
3. 認証（サインアップ/ログイン）
4. シフト入力 → 月次集計 → 壁ゲージ
5. 支出の手入力
6. レシート OCR（Supabase Edge Function + Claude vision）
7. CSV インポート（楽天カード・PayPay）
8. PWA 化 → CORESERVER へデプロイ
