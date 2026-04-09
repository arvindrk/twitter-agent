import { Client, OAuth1 } from "@xdevplatform/xdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function createXClient(): Client {
  const oauth1 = new OAuth1({
    apiKey: requireEnv("X_API_KEY"),
    apiSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessTokenSecret: requireEnv("X_ACCESS_TOKEN_SECRET"),
    callback: "oob",
  });

  return new Client({ oauth1 });
}

export const xClient = createXClient();
