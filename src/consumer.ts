import { Env } from "./types";
import { decrypt } from "./crypto";
import { GmailAdapter, GmailCredentials } from "./gmail";
import { MailAdapter } from "./adapters";
import { analyzeMessage } from "./gemini";

const CATEGORIES = [
  "important",
  "newsletter",
  "notification",
  "promotion",
  "social",
  "other",
];

interface MailAccount {
  id: string;
  email: string;
  provider: string;
  credentials: string;
}

function getAdapter(provider: string, credentials: unknown): MailAdapter {
  if (provider === "gmail") {
    return new GmailAdapter(credentials as GmailCredentials);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

export async function processAccount(env: Env, accountId: string): Promise<void> {
  const account = await env.DB.prepare(
    "SELECT id, email, provider, credentials FROM mail_accounts WHERE id = ?"
  ).bind(accountId).first<MailAccount>();

  if (!account) {
    console.error(`Account not found: ${accountId}`);
    return;
  }

  const credentialsJson = await decrypt(account.credentials, env.ENCRYPTION_KEY);
  const credentials = JSON.parse(credentialsJson);
  const adapter = getAdapter(account.provider, credentials);

  const messages = await adapter.fetchUnreadMessages();
  console.log(`[${account.email}] ${messages.length} unread message(s)`);
  if (!messages.length) return;

  const labelNames = [
    ...CATEGORIES.map((c) => `Mailzen/${c}`),
    "Mailzen/suspicious",
  ];
  const labelMap = await adapter.resolveLabels(labelNames);

  for (const message of messages) {
    try {
      const result = await analyzeMessage(env, message);

      const domain = message.from.match(/@([\w.-]+)/)?.[1]?.toLowerCase() ?? null;
      let senderName: string | null = null;
      if (domain) {
        senderName = await env.SENDER_NAMES.get(domain);
        if (!senderName && result.senderName) {
          senderName = result.senderName;
          await env.SENDER_NAMES.put(domain, senderName);
        }
      }

      console.log(
        `[${message.id}] sender=${senderName ?? "unknown"} category=${result.category} suspicious=${result.suspicious}`
      );

      if (result.summary === "解析に失敗しました") continue;

      await env.DB.prepare(
        `INSERT OR IGNORE INTO mail_results
           (account_id, message_id, thread_id, sender, subject, category, summary, suspicious, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          accountId,
          message.id,
          message.threadId,
          senderName ?? message.from,
          message.subject,
          result.category,
          result.summary,
          result.suspicious ? 1 : 0,
          new Date().toISOString()
        )
        .run();

      if (result.suspicious) {
        const suspiciousLabelId = labelMap.get("Mailzen/suspicious");
        if (suspiciousLabelId) {
          await adapter.addLabel(message.id, suspiciousLabelId, { markAsRead: false });
        }
        continue;
      }

      const labelId = labelMap.get(`Mailzen/${result.category}`);
      if (labelId) {
        await adapter.addLabel(message.id, labelId);
      }
    } catch (err) {
      console.error(`Failed to process message ${message.id}:`, err);
    }
  }
}
