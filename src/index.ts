import { Env } from "./types";
import { getAccessToken, fetchUnreadMessages, addLabel, createDraft } from "./gmail";
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

async function processEmails(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const messages = await fetchUnreadMessages(token);
  console.log(`Processing ${messages.length} unread messages`);

  for (const message of messages) {
    try {
      const result = await analyzeMessage(env, message);
      console.log(`[${message.id}] category=${result.category}`);

      // Label and mark as read
      await addLabel(token, message.id, `Mailzen/${result.category}`);

      // Create draft reply
      if (result.draftReply) {
        await createDraft(token, message.from, message.subject, result.draftReply);
      }

      // message object goes out of scope here — body is not persisted
    } catch (err) {
      console.error(`Failed to process message ${message.id}:`, err);
    }
  }

  console.log("Done");
}
