export interface Env {
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  GEMINI_API_KEY: string;
  SENDER_NAMES: KVNamespace;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}

export interface GeminiResult {
  summary: string;
  category: string;
  senderName: string | null;
}

export type Category =
  | "important"
  | "newsletter"
  | "notification"
  | "promotion"
  | "social"
  | "other";
