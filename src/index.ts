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
    if (new URL(request.url).pathname === "/run") {
      ctx.waitUntil(enqueueAccounts(env));
      return new Response("Processing started", { status: 200 });
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
