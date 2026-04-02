import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * This module is server-only and should never be imported in client components.
 * Drizzle ORM is used for type-safe database queries in server-side code.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is required. Please add it to your .env.local file."
  );
}

// Use singleton pattern in development to avoid too many connections
declare global {
  var postgresClient: postgres.Sql | undefined;
}

let postgresClient: postgres.Sql;
const connectionString = process.env.DATABASE_URL;

function createPostgresClient() {
  return postgres(connectionString, {
    max: 1,
    ssl: "require",
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    // onnotice: () => {
    //   // Suppress noisy pooler notices in development logs.
    // },
  });
}

if (process.env.NODE_ENV === "production") {
  postgresClient = createPostgresClient();
} else {
  if (!global.postgresClient) {
    global.postgresClient = createPostgresClient();
  }
  postgresClient = global.postgresClient;
}

export const db = drizzle(postgresClient, { schema });

// Export schema for use in queries
export type Schema = typeof schema;

