import { MailAdapter, MailMessage } from "./adapters";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailAdapter implements MailAdapter {
  private token: string | null = null;

  constructor(private readonly creds: GmailCredentials) {}

  private async readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await this.readJson(res)) as Record<string, unknown> | null;
    if (!res.ok) {
      throw new Error(
        `OAuth token exchange failed: status=${res.status} body=${JSON.stringify(data)}`
      );
    }

    const accessToken = data?.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error(
        `OAuth token exchange returned no access_token: body=${JSON.stringify(data)}`
      );
    }

    this.token = accessToken;
    return this.token;
  }

  async fetchUnreadMessages(): Promise<MailMessage[]> {
    const token = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const listRes = await fetch(
      `${GMAIL_API}/messages?q=is:unread&maxResults=10`,
      { headers }
    );
    const listData = ((await this.readJson(listRes)) ?? null) as {
      messages?: { id: string; threadId: string }[];
    } | null;

    if (!listRes.ok) {
      throw new Error(
        `Gmail messages.list failed: status=${listRes.status} body=${JSON.stringify(listData)}`
      );
    }

    const safeListData = listData ?? { messages: [] };
    if (!safeListData.messages?.length) return [];

    const messages: MailMessage[] = [];
    for (const msg of safeListData.messages) {
      const detailRes = await fetch(`${GMAIL_API}/messages/${msg.id}`, { headers });
      const detail = (await this.readJson(detailRes)) as any;
      if (!detailRes.ok) {
        throw new Error(
          `Gmail messages.get failed: id=${msg.id} status=${detailRes.status} body=${JSON.stringify(
            detail
          )}`
        );
      }
      const hdrs = detail.payload?.headers ?? [];

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader(hdrs, "From"),
        to: getHeader(hdrs, "To"),
        subject: getHeader(hdrs, "Subject"),
        body: extractBody(detail.payload),
        date: getHeader(hdrs, "Date"),
        authResults: getHeader(hdrs, "Authentication-Results"),
      });
    }
    return messages;
  }

  async resolveLabels(labelNames: string[]): Promise<Map<string, string>> {
    const token = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const labelsRes = await fetch(`${GMAIL_API}/labels`, { headers });
    const labelsData = ((await this.readJson(labelsRes)) ?? null) as {
      labels: { id: string; name: string }[];
    } | null;

    if (!labelsRes.ok) {
      throw new Error(
        `Gmail labels.list failed: status=${labelsRes.status} body=${JSON.stringify(labelsData)}`
      );
    }

    const safeLabelsData = labelsData ?? { labels: [] };

    const labelMap = new Map<string, string>();
    for (const existing of safeLabelsData.labels ?? []) {
      labelMap.set(existing.name, existing.id);
    }

    for (const name of labelNames) {
      if (!labelMap.has(name)) {
        const createRes = await fetch(`${GMAIL_API}/labels`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const created = (await this.readJson(createRes)) as { id: string; name: string } | null;
        if (!createRes.ok) {
          throw new Error(
            `Gmail labels.create failed: name=${name} status=${createRes.status} body=${JSON.stringify(
              created
            )}`
          );
        }
        if (!created?.id || !created?.name) {
          throw new Error(
            `Gmail labels.create returned unexpected body: body=${JSON.stringify(created)}`
          );
        }
        labelMap.set(created.name, created.id);
      }
    }
    return labelMap;
  }

  async addLabel(
    messageId: string,
    labelId: string,
    options: { markAsRead: boolean } = { markAsRead: true }
  ): Promise<void> {
    const token = await this.getAccessToken();
    const modifyRes = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLabelIds: [labelId],
        removeLabelIds: options.markAsRead ? ["UNREAD"] : [],
      }),
    });
    const modifyBody = await this.readJson(modifyRes);
    if (!modifyRes.ok) {
      throw new Error(
        `Gmail messages.modify failed: id=${messageId} status=${modifyRes.status} body=${JSON.stringify(
          modifyBody
        )}`
      );
    }
  }
}

function getHeader(headers: any[], name: string): string {
  return (
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
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

function decodeBase64Url(str: string): string {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}
