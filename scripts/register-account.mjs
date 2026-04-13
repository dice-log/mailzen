#!/usr/bin/env node

import { randomUUID, createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function escapeSql(value) {
  return value.replaceAll("'", "''");
}

function encryptCredentials(plaintext, keyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes).");
  }
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, ciphertext, authTag]);
  return combined.toString("base64");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const provider = args.provider ?? "gmail";
  const credentialsFile = args["credentials-file"];
  const execute = args.execute === "true";
  const accountId = args["account-id"] ?? randomUUID();
  const dbName = args.db ?? "mailzen-db";
  const remote = args.remote !== "false";
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!email || !credentialsFile) {
    console.error(
      "Usage: node scripts/register-account.mjs --email you@example.com --credentials-file ./credentials.json [--provider gmail] [--execute true]"
    );
    process.exit(1);
  }
  if (!encryptionKey) {
    console.error("Set ENCRYPTION_KEY in environment before running.");
    process.exit(1);
  }

  const raw = readFileSync(credentialsFile, "utf8");
  JSON.parse(raw);

  const encrypted = encryptCredentials(raw, encryptionKey);
  const createdAt = new Date().toISOString();
  const sql = `INSERT INTO mail_accounts (id, email, provider, credentials, created_at)
VALUES ('${escapeSql(accountId)}', '${escapeSql(email)}', '${escapeSql(provider)}', '${escapeSql(encrypted)}', '${escapeSql(createdAt)}');`;

  if (!execute) {
    console.log(sql);
    console.log("\nUse --execute true to run via wrangler d1 execute.");
    return;
  }

  const wranglerArgs = ["wrangler", "d1", "execute", dbName];
  if (remote) {
    wranglerArgs.push("--remote");
  }
  wranglerArgs.push("--command", sql);

  const result = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
