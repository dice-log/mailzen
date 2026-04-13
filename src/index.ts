import { Env, AccountQueueMessage } from "./types";
import { enqueueAccounts } from "./producer";
import { processAccount } from "./consumer";

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
        message.ack();
      } catch (err) {
        console.error(`Failed to process account ${message.body.accountId}:`, err);
        message.retry();
      }
    }
  },
};
