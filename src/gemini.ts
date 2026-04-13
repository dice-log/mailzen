import { MailMessage } from "./adapters";
import { Env, GeminiResult, Category } from "./types";

const GEMINI_API =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent";

const CATEGORIES: Category[] = [
  "important",
  "newsletter",
  "notification",
  "promotion",
  "social",
  "other",
];

function buildPrompt(message: MailMessage): string {
  return `以下のメールを分析して、JSON形式で回答してください。

件名: ${message.subject}
差出人: ${message.from}
日時: ${message.date}
認証結果: ${message.authResults || "なし"}
本文:
${message.body.slice(0, 3000)}

以下のJSON形式で回答してください（他のテキストは不要）:
{
  "summary": "3行以内の要約（日本語）。氏名・住所・電話番号・口座番号・メールアドレス・確認コード・ワンタイムパスワード等の個人情報やセキュリティ情報は含めないこと",
  "category": "${CATEGORIES.join(" | ")}のいずれか",
  "senderName": "送信者の企業・サービス名（日本語）。個人からのメールの場合はnull",
  "suspicious": "フィッシング・詐欺の疑いがある場合はtrue、そうでない場合はfalse。判断基準: SPF/DKIM/DMARCのfail、差出人の表示名とドメインの不一致、緊急性を煽る・個人情報要求・不審なURL等の文面"
}`;
}

export async function analyzeMessage(
  env: Env,
  message: MailMessage
): Promise<GeminiResult> {
  const res = await fetch(`${GEMINI_API}?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(message) }] }],
    }),
  });

  const data = (await res.json()) as {
    candidates?: { content: { parts: { text: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      summary: "解析に失敗しました",
      category: "other",
      senderName: null,
      suspicious: false,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeminiResult;

  // Validate category
  if (!CATEGORIES.includes(parsed.category as Category)) {
    parsed.category = "other";
  }

  return parsed;
}
