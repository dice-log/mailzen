import { Env } from "./types";

export async function enqueueAccounts(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM mail_accounts"
  ).all<{ id: string }>();

  if (!results.length) {
    console.log("No mail accounts configured");
    return;
  }

  await env.MAIL_QUEUE.sendBatch(
    results.map((r) => ({ body: { accountId: r.id } }))
  );
  console.log(`Enqueued ${results.length} account(s)`);
}
