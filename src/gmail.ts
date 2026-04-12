import { Env, GmailMessage } from "./types";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain"
    );
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }
  }
  return "";
}

function getHeader(headers: any[], name: string): string {
  return headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function fetchUnreadMessages(token: string): Promise<GmailMessage[]> {
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `${GMAIL_API}/messages?q=is:unread&maxResults=10`,
    { headers }
  );
  const listData = (await listRes.json()) as {
    messages?: { id: string; threadId: string }[];
  };

  if (!listData.messages?.length) return [];

  const messages: GmailMessage[] = [];

  for (const msg of listData.messages) {
    const detailRes = await fetch(`${GMAIL_API}/messages/${msg.id}`, {
      headers,
    });
    const detail = (await detailRes.json()) as any;
    const hdrs = detail.payload?.headers ?? [];

    messages.push({
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader(hdrs, "From"),
      to: getHeader(hdrs, "To"),
      subject: getHeader(hdrs, "Subject"),
      body: extractBody(detail.payload),
      date: getHeader(hdrs, "Date"),
    });
  }

  return messages;
}

// Fetch existing labels and create missing ones, returning a name→id map
export async function resolveLabels(token: string, labelNames: string[]): Promise<Map<string, string>> {
  const headers = { Authorization: `Bearer ${token}` };
  const labelsRes = await fetch(`${GMAIL_API}/labels`, { headers });
  const labelsData = (await labelsRes.json()) as { labels: { id: string; name: string }[] };

  const labelMap = new Map<string, string>();
  for (const existing of labelsData.labels) {
    labelMap.set(existing.name, existing.id);
  }

  for (const name of labelNames) {
    if (!labelMap.has(name)) {
      const createRes = await fetch(`${GMAIL_API}/labels`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const created = (await createRes.json()) as { id: string; name: string };
      labelMap.set(created.name, created.id);
    }
  }

  return labelMap;
}

export async function addLabel(
  token: string,
  messageId: string,
  labelId: string
): Promise<void> {
  await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addLabelIds: [labelId],
      removeLabelIds: ["UNREAD"],
    }),
  });
}

export async function createDraft(
  token: string,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const mailContent = `To: ${to}\r\nSubject: Re: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
  const bytes = new TextEncoder().encode(mailContent);
  const raw = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await fetch(`${GMAIL_API}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });
}
