import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../config.js";

export const db = drizzle(neon(env("DATABASE_URL")));
