import { Env, GmailMessage } from "./types";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function getAccessToken(env: Env): Promise<string> {
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

export async function fetchUnreadMessages(env: Env): Promise<GmailMessage[]> {
  const token = await getAccessToken(env);
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

export async function addLabel(
  env: Env,
  messageId: string,
  labelName: string
): Promise<void> {
  const token = await getAccessToken(env);

  // Get or create label
  const labelsRes = await fetch(`${GMAIL_API}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const labelsData = (await labelsRes.json()) as {
    labels: { id: string; name: string }[];
  };
  let label = labelsData.labels.find((l) => l.name === labelName);

  if (!label) {
    const createRes = await fetch(`${GMAIL_API}/labels`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: labelName }),
    });
    label = (await createRes.json()) as { id: string; name: string };
  }

  // Apply label and mark as read
  await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addLabelIds: [label.id],
      removeLabelIds: ["UNREAD"],
    }),
  });
}

export async function createDraft(
  env: Env,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const token = await getAccessToken(env);

  const raw = btoa(
    `To: ${to}\r\nSubject: Re: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  )
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
