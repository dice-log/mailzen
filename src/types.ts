export interface AccountQueueMessage {
  accountId: string;
}

export interface Env {
  ENCRYPTION_KEY: string;
  GEMINI_API_KEY: string;
  SENDER_NAMES: KVNamespace;
  DB: D1Database;
  MAIL_QUEUE: Queue<AccountQueueMessage>;
}

export interface GeminiResult {
  summary: string;
  category: string;
  senderName: string | null;
  suspicious: boolean;
}

export type Category =
  | "important"
  | "newsletter"
  | "notification"
  | "promotion"
  | "social"
  | "other";
