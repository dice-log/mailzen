import { Env, AccountQueueMessage } from "./types";
import { enqueueAccounts } from "./producer";
import { processAccount } from "./consumer";

function logInfo(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", event, ...data }));
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(enqueueAccounts(env));
  },

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      ctx.waitUntil(enqueueAccounts(env));
      return new Response("Processing started", { status: 200 });
    }

    if (url.pathname === "/api/mails") {
      const category = url.searchParams.get("category");
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

      let query = `SELECT id, sender, sender_domain, subject, category, summary, suspicious, processed_at, thread_id, account_id
                   FROM mail_results`;
      const params: (string | number)[] = [];

      if (category && category !== "all") {
        if (category === "suspicious") {
          query += ` WHERE suspicious = 1`;
        } else {
          query += ` WHERE category = ?`;
          params.push(category);
        }
      }

      query += ` ORDER BY processed_at DESC LIMIT ?`;
      params.push(limit);

      const { results } = await env.DB.prepare(query).bind(...params).all();

      return new Response(JSON.stringify(results), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Mailzen is running", { status: 200 });
  },

  async queue(
    batch: MessageBatch<AccountQueueMessage>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processAccount(env, message.body.accountId);
        logInfo("queue_message_acked", {
          accountId: message.body.accountId,
        });
        message.ack();
      } catch (err) {
        logError("queue_message_failed", {
          accountId: message.body.accountId,
          error: err instanceof Error ? err.message : String(err),
        });
        message.retry();
      }
    }
  },
};
