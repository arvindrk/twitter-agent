import { Client, OAuth1 } from "@xdevplatform/xdk";
import { env } from "../config.js";

export const xClient = new Client({
  oauth1: new OAuth1({
    apiKey: env("X_API_KEY"),
    apiSecret: env("X_API_SECRET"),
    accessToken: env("X_ACCESS_TOKEN"),
    accessTokenSecret: env("X_ACCESS_TOKEN_SECRET"),
    callback: "oob",
  }),
});
