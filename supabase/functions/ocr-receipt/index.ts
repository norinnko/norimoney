// ============================================================================
// ocr-receipt — レシート/明細スクショから 日付/店名/金額 を抽出する Edge Function
//
// 役割:
//   - ブラウザから base64 画像を受け取り、Claude(vision) に構造化抽出させる。
//   - ANTHROPIC_API_KEY は Supabase の secret として保持し、フロントに出さない。
//   - 画像は保存しない（抽出したら破棄）。CORESERVER 側はサーバー処理ゼロを維持。
//
// デプロイ（ローカルで実行。キーはあなたが直接登録する）:
//   supabase login
//   supabase functions deploy ocr-receipt --project-ref <PROJECT_REF>
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   （任意）supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5   ← コスト重視ならこれ
//
// 認証: Supabase Edge Function は既定で JWT を検証する（verify_jwt=true）。
//   supabase.functions.invoke がログイン中ユーザーの JWT を自動付与するため、
//   未ログインの呼び出しは 401 で弾かれる。有料の Anthropic キーの濫用を防ぐ。
// ============================================================================

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// 既定は最も高精度な claude-opus-4-8。コスト重視なら secret で claude-haiku-4-5 に。
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 抽出結果の型（tool の入力スキーマと一致させる）。
interface OcrExpense {
  spent_on: string; // "YYYY-MM-DD"
  store: string;
  amount: number; // 円・整数
}

const EXTRACT_TOOL = {
  name: "record_expenses",
  description:
    "レシートまたは決済アプリの取引履歴スクショから、実際の支出（お金が出た行）を抽出して記録する。",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "抽出した支出の配列。支出が無ければ空配列。",
        items: {
          type: "object",
          properties: {
            spent_on: {
              type: "string",
              description:
                '支出日を "YYYY-MM-DD" 形式で。年の記載が無ければ本文で指示された「今日の日付」の年を補う。',
            },
            store: {
              type: "string",
              description: "店名・利用先。レシートなら発行店名。",
            },
            amount: {
              type: "integer",
              description: "支払金額（円・整数）。税込の合計支払額。小数不可。",
            },
          },
          required: ["spent_on", "store", "amount"],
        },
      },
    },
    required: ["items"],
  },
} as const;

function buildPrompt(todayISO: string): string {
  return [
    "この画像はレシート、または PayPay・楽天カード等の決済アプリの取引履歴です。",
    "実際の支出（お金が出た取引）だけを抽出し、record_expenses ツールで記録してください。",
    "",
    "【除外するもの（支出ではない）】",
    "・ポイント付与 / ポイント還元（例: PayPayポイント、○○pt、付与処理中）",
    "・返金 / キャンセル / 取消（マイナス金額の行）",
    "・チャージ / 入金 / 残高追加",
    "・合計以外の内訳（レシートは1枚につき合計支払額を1件だけ）",
    "",
    "【ルール】",
    `・年の記載が無い日付は、今日の日付 ${todayISO} の年を補ってください。`,
    "・金額はカンマや円記号を除いた整数にしてください。",
    "・判断に迷う行は含めないでください。",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST のみ対応しています。" }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(
      { error: "サーバー未設定: ANTHROPIC_API_KEY が secret に登録されていません。" },
      500,
    );
  }

  let body: { image?: string; media_type?: string; today?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "リクエストボディが不正です。" }, 400);
  }

  const image = body.image?.trim();
  const mediaType = body.media_type ?? "image/jpeg";
  const todayISO = body.today ?? new Date().toISOString().slice(0, 10);
  if (!image) {
    return json({ error: "image（base64）が必要です。" }, 400);
  }

  const anthropicReq = {
    model: MODEL,
    max_tokens: 2048,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_expenses" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: image },
          },
          { type: "text", text: buildPrompt(todayISO) },
        ],
      },
    ],
  };

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicReq),
    });
  } catch {
    return json({ error: "Anthropic API への接続に失敗しました。" }, 502);
  }

  if (!anthropicRes.ok) {
    const detail = await safeText(anthropicRes);
    return json(
      { error: `Anthropic API エラー (${anthropicRes.status})`, detail },
      502,
    );
  }

  const data = await anthropicRes.json();
  // stop_reason が refusal の場合は安全側で弾く。
  if (data.stop_reason === "refusal") {
    return json({ error: "画像の内容が処理できませんでした。" }, 422);
  }

  const toolUse = (data.content ?? []).find(
    (b: { type: string }) => b.type === "tool_use",
  );
  const items: OcrExpense[] = toolUse?.input?.items ?? [];

  // 正の金額の支出のみ返す（防御的に再フィルタ）。
  const clean = items.filter(
    (it) =>
      it &&
      typeof it.amount === "number" &&
      it.amount > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(it.spent_on ?? ""),
  );

  return json({ items: clean });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
