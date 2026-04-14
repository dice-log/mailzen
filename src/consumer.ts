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

function logInfo(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", event, ...data }));
}

function getAdapter(provider: string, credentials: unknown): MailAdapter {
  if (provider === "gmail") {
    return new GmailAdapter(credentials as GmailCredentials);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

function extractEmailAddress(from: string): string | null {
  const bracketMatch = from.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }
  const directMatch = from.trim().match(/[^\s<>()]+@[^\s<>()]+/);
  return directMatch ? directMatch[0].trim() : null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

function extractDisplayName(from: string): string | null {
  const bracketMatch = from.match(/^(.*?)\s*<[^>]+>$/);
  const raw = bracketMatch?.[1]?.replace(/^"+|"+$/g, "").trim() ?? "";
  if (!raw || raw.includes("@")) return null;
  return raw;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (!local) return `***@${domain}`;
  return `${local[0]}***@${domain}`;
}

async function buildSenderId(normalizedEmail: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizedEmail)
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 20);
}

async function isTrustedSender(env: Env, senderId: string | null): Promise<boolean> {
  if (!senderId) return false;
  const row = await env.DB.prepare(
    "SELECT sender_id FROM sender_policies WHERE sender_id = ? AND action = 'trust' LIMIT 1"
  )
    .bind(senderId)
    .first<{ sender_id: string }>();
  return !!row;
}

export async function processAccount(env: Env, accountId: string): Promise<void> {
  const account = await env.DB.prepare(
    "SELECT id, email, provider, credentials FROM mail_accounts WHERE id = ?"
  ).bind(accountId).first<MailAccount>();

  if (!account) {
    logError("account_not_found", { accountId });
    return;
  }

  const credentialsJson = await decrypt(account.credentials, env.ENCRYPTION_KEY);
  const credentials = JSON.parse(credentialsJson);
  const adapter = getAdapter(account.provider, credentials);

  const messages = await adapter.fetchUnreadMessages();
  logInfo("account_messages_fetched", {
    accountId,
    provider: account.provider,
    email: account.email,
    unreadCount: messages.length,
  });
  if (!messages.length) return;

  const labelNames = [
    ...CATEGORIES.map((c) => `Mailzen/${c}`),
    "Mailzen/suspicious",
  ];
  const labelMap = await adapter.resolveLabels(labelNames);

  for (const message of messages) {
    try {
      const result = await analyzeMessage(env, message);

      const rawEmail = extractEmailAddress(message.from);
      const normalizedEmail = rawEmail ? normalizeEmail(rawEmail) : null;
      const senderDomain = normalizedEmail ? extractDomain(normalizedEmail) : null;
      const senderId = normalizedEmail ? await buildSenderId(normalizedEmail) : null;
      const trustedSender = await isTrustedSender(env, senderId);
      const domain = senderDomain;
      let senderName: string | null = null;
      if (domain) {
        senderName = await env.SENDER_NAMES.get(domain);
        if (!senderName && result.senderName) {
          senderName = result.senderName;
          await env.SENDER_NAMES.put(domain, senderName);
        }
      }
      const displayName = extractDisplayName(message.from);
      const senderLabel = senderName ?? displayName ?? (normalizedEmail ? maskEmail(normalizedEmail) : "unknown");

      logInfo("message_analyzed", {
        accountId,
        messageId: message.id,
        provider: account.provider,
        sender: senderLabel,
        category: result.category,
        suspicious: result.suspicious,
      });

      if (result.summary === "解析に失敗しました") continue;

      await env.DB.prepare(
        `INSERT OR IGNORE INTO mail_results
           (account_id, message_id, thread_id, sender, sender_id, sender_domain, subject, category, summary, suspicious, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          accountId,
          message.id,
          message.threadId,
          senderLabel,
          senderId,
          senderDomain,
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
          await adapter.addLabel(message.id, suspiciousLabelId, {
            markAsRead: trustedSender,
          });
        }
        continue;
      }

      const labelId = labelMap.get(`Mailzen/${result.category}`);
      if (labelId) {
        await adapter.addLabel(message.id, labelId);
      }
    } catch (err) {
      logError("message_processing_failed", {
        accountId,
        messageId: message.id,
        provider: account.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
