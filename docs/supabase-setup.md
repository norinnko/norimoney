# Supabase セットアップ手順

norimoney は Auth と DB を Supabase に任せ、ブラウザから直接叩く構成。
この手順を最後まで済ませると、ログイン〜シフト入力〜壁ゲージまで実際に動く。

所要時間: 15分程度。

---

## 1. プロジェクトを作る

1. https://supabase.com にアクセスし、GitHub アカウント等でサインアップ
2. **New project** をクリック
3. 入力項目:
   - **Name**: `norimoney`
   - **Database Password**: 自動生成でよい。**必ず控えておく**
     （これは DB 直接接続用のパスワード。アプリのログインパスワードとは別物）
   - **Region**: `Northeast Asia (Tokyo)` を選ぶ。日本から使うので遅延が小さい
4. **Create new project** → プロビジョニングに1〜2分かかる

---

## 2. スキーマを適用する

1. 左サイドバーの **SQL Editor** を開く
2. **New query** をクリック
3. リポジトリの [`supabase/schema.sql`](../supabase/schema.sql) の中身を**全部**コピーして貼り付ける
4. **Run**（Ctrl+Enter）

`Success. No rows returned` と出れば成功。

これで作られるもの:

| テーブル | 役割 |
|---|---|
| `settings` | 年収の壁の設定（ユーザーごとに1行） |
| `jobs` | バイト先。時給・深夜割増率・交通費・締め日を店ごとに保持 |
| `shifts` | シフト1件。`end_at < start_at` なら日またぎ |
| `expenses` | 支出。手入力／OCR／CSV の区別を `source` で持つ |

あわせて RLS ポリシー、複合FK、新規ユーザー用トリガーも適用される。

---

## 3. RLS が効いているか目視確認（重要）

Supabase の典型的な事故は「RLS 未設定のテーブルが1つあって全開放」。必ず確認する。

1. 左サイドバーの **Table Editor** を開く
2. `settings` / `jobs` / `shifts` / `expenses` の4つすべてに
   緑の **RLS enabled** バッジが出ていることを確認

1つでも出ていなければ、そのテーブルは**全世界から読み書き可能**な状態。
その場合は `schema.sql` の `alter table ... enable row level security;` が
流れているか確認して再実行する。

---

## 4. 認証の設定

### メール確認について（オンのままでよい）

デフォルトでは新規登録時に確認メールが送られる。**この設定は変更しなくてよい。**

ダッシュボードのバージョンによって `Confirm email` トグルの位置が違い
（`Authentication → Sign In / Providers → Email` の中にある場合と、
無い／別の場所にある場合がある）、探す手間に見合わない。
オンのままでも次の手順で問題なくテストできる。

**テスト用に複数アカウントを作る方法**: Gmail の `+` エイリアスを使う。
`you+a@gmail.com` と `you+b@gmail.com` は**どちらも同じ受信箱に届く**ので、
1つのメールアドレスでアカウントを何個でも作れる。RLS の越境テスト（手順8）は
これで実施できる。

アプリ側も確認メール前提の作りになっている:
登録すると「確認メールを送信しました」と表示され、ログインタブに切り替わる。
メール内のリンクを開いてからログインすればよい。

> オンのままにしておく方が安全。オフだと他人のメールアドレスで
> 勝手に登録できてしまうため、公開時にはどのみちオンが必須になる。

### Site URL を設定する

1. **Authentication** → **URL Configuration**
2. **Site URL** に `http://localhost:3000` を設定
3. 本番ドメインが決まったら **Redirect URLs** に追加する

---

## 5. 接続情報を取得する

### 一番簡単: 上部の「Connect」ボタン

1. 画面上部の **Connect** をクリック
2. **App Frameworks** タブ → Framework で **Next.js** を選択
3. `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` が
   `.env` 形式で表示されるので、そのまま手順6にコピペする

変数名まで一致しているのでこれが確実。手順6と同時に終わる。

### 手動で取る場合

**Project URL**:
- **Settings（歯車）→ Data API** の一番上に **Project URL**（`https://xxxx.supabase.co`）

**キー**（新ダッシュボードは方式が変わっている）:
- **Settings → API Keys** を開く
- **Publishable key**（`sb_publishable_...`）があればそれを使う
- 無ければ **Legacy API Keys** タブの **anon** キー（`eyJ...` で始まる）を使う
- **どちらでもこのアプリは動く**（publishable は anon の新しい置き換え。役割は同じ）

> ❌ `sb_secret_...` / `service_role` キーは**絶対にフロントに置かない**。
> RLS を無視できる管理者キーで、`.env.local` に入れると全データが誰でも読める。
> ✅ 使うのは **publishable**（`sb_publishable_...`）か **anon**（`eyJ...`）だけ。
> 見分け方: 名前に secret / service_role が入っていたらアウト。

---

## 6. .env.local を作る

`norimoney/` 直下で:

```bash
cp .env.local.example .env.local
```

`.env.local` を開き、手順5で取得した値を記入:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=（anon / publishable キー）
```

`.env.local` は `.gitignore` 済みなのでコミットされない。

---

## 7. 起動して動作確認

```bash
cd norimoney
npm run dev
```

http://localhost:3000 を開く。

- セットアップ画面が消えて**ログイン画面**が出れば env の読み込み成功
- まだセットアップ画面が出る場合は、**dev サーバーを再起動**する
  （`NEXT_PUBLIC_*` はビルド時に埋め込まれるため）

### 新規登録してトリガーを確認

1. 「新規登録」タブでメールとパスワード（6文字以上）を入力して登録
2. ホーム画面に入れることを確認
3. Supabase の **Table Editor** で確認:
   - `settings` に自分の行が1件（`wall_limit` = 1360000）
   - `jobs` に「メイン」が1件

この2行はトリガー `on_auth_user_created` が自動生成したもの。
出ていなければトリガーが失敗している（→ トラブルシュート参照）。

### ひと通り触る

1. **設定** タブ → 時給・交通費・締め日を自分の条件に変更して保存
2. **シフト** タブ → 「＋ シフトを追加」で1件登録
   （深夜割増を試すなら `22:00`〜`翌 05:00` を入れてみる）
3. **ホーム** → 今期の見込みと壁ゲージに反映されることを確認

---

## 8. RLS の越境不可テスト（作品のアピールポイント）

「認可を DB 層に置いた」ことを実測で示すテスト。**必ず実施する。**

1. アカウント A（例: `you+a@gmail.com`）で登録し、シフトを1件登録する
2. ログアウトし、アカウント B（例: `you+b@gmail.com`）で登録する
   — `+` エイリアスなので確認メールは同じ受信箱に届く
3. B でシフト一覧を開く → **1件も見えないこと**を確認

さらに強い確認（B でログイン中にブラウザの DevTools コンソールで実行）:

```js
// A の user_id で明示的に取りにいっても 0 件で返るのが正しい
const { data, error } = await window.__sb.from('shifts').select('*')
console.log(data, error)
```

> 上を試すには一時的に `window.__sb = getSupabase()` を仕込む必要がある。
> 手軽に済ませるなら、手順3の目視確認＋アカウント2つでの実測で十分。

**期待結果**: B からは A のデータが1件も取得できない。
アプリ側で `where user_id = ...` を書き忘れても、Postgres の RLS が弾く。
これが多層防御。

---

## トラブルシュート

### 登録時に `Database error saving new user`

トリガー `handle_new_user` が失敗している。
SQL Editor で以下を実行し、関数とトリガーが存在するか確認:

```sql
select tgname from pg_trigger where tgname = 'on_auth_user_created';
```

無ければ `schema.sql` のトリガー部分を再実行する。

### `Invalid API key`

`.env.local` のキーが `service_role` になっていないか、
改行や余分な空白が混じっていないか確認。修正後は dev サーバーを再起動。

### セットアップ画面から進まない

`NEXT_PUBLIC_*` はビルド時に埋め込まれるため、
`.env.local` を書き換えたら**必ず dev サーバーを再起動**する。

### 確認メールが届かない

まず迷惑メールフォルダを確認する。
Supabase の無料プランは送信メール数に制限（1時間あたり数通）があるため、
短時間に何度も登録を試すと止まることがある。数十分待つか、
Table Editor の `auth.users` で該当ユーザーを削除してから再試行する。

---

## 公開前チェックリスト

CORESERVER にデプロイして一般公開する前に:

- [ ] メール確認（`Confirm email`）が**オン**であることを確認
      （デフォルトのまま触っていなければオン）
- [ ] **Site URL / Redirect URLs** を本番ドメインに設定
- [ ] 全テーブルの RLS バッジを再確認
- [ ] `service_role` キーがリポジトリやフロントに混入していないか grep で確認
