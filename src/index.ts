import { Env } from "./types";
import { getAccessToken, fetchUnreadMessages, resolveLabels, addLabel } from "./gmail";
import { analyzeMessage } from "./gemini";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(processEmails(env));
  },

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Manual trigger via HTTP (for testing)
    if (new URL(request.url).pathname === "/run") {
      ctx.waitUntil(processEmails(env));
      return new Response("Processing started", { status: 200 });
    }
    return new Response("Mailzen is running", { status: 200 });
  },
};

const CATEGORIES = ["important", "newsletter", "notification", "promotion", "social", "other"];

async function processEmails(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const messages = await fetchUnreadMessages(token);
  console.log(`Processing ${messages.length} unread messages`);

  if (!messages.length) return;

  // Resolve all labels once upfront
  const labelNames = CATEGORIES.map((c) => `Mailzen/${c}`);
  const labelMap = await resolveLabels(token, labelNames);

  for (const message of messages) {
    try {
      const result = await analyzeMessage(env, message);

      // Resolve sender name: check KV cache first, then use Gemini result
      const domain = message.from.match(/@([\w.-]+)/)?.[1]?.toLowerCase() ?? null;
      let senderName: string | null = null;
      if (domain) {
        senderName = await env.SENDER_NAMES.get(domain);
        if (!senderName && result.senderName) {
          senderName = result.senderName;
          await env.SENDER_NAMES.put(domain, senderName);
        }
      }

      console.log(`[${message.id}] sender=${senderName ?? "unknown"} category=${result.category} summary=${result.summary}`);

      // Skip labeling if analysis failed — leave as unread
      if (result.summary === "解析に失敗しました") continue;

      // Label and mark as read
      const labelId = labelMap.get(`Mailzen/${result.category}`);
      if (labelId) {
        await addLabel(token, message.id, labelId);
      }

      // message object goes out of scope here — body is not persisted
    } catch (err) {
      console.error(`Failed to process message ${message.id}:`, err);
    }
  }

  console.log("Done");
}
