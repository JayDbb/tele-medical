import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/app/_lib/db/drizzle/index";
import { users } from "@/app/_lib/db/drizzle/schema";

// Track last Supabase auth rate-limit hit for logging only (do not block subsequent requests)
let lastAuthRateLimitLogAt = 0;

/**
 * Creates a Supabase client for use in server components and server actions.
 * This uses @supabase/ssr for proper cookie handling in Next.js server components.
 * 
 * Note: In Next.js 16, cookies() is async and must be awaited.
 * 
 * Cached to prevent duplicate client creation within the same request.
 */
export const createSupabaseServerClient = cache(async () => {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Please check your .env.local file."
    );
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options?: any) {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // The `set` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
      remove(name: string, options?: any) {
        try {
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        } catch {
          // The `remove` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  });
});

/**
 * Gets the current user session from Supabase.
 * Returns the user object if authenticated, null otherwise.
 * 
 * On a single 429 from getUser(), returns null for that call only.
 * Does not use a global cooldown that would make every RSC see "logged out" for several seconds.
 * Uses React cache() to deduplicate calls within the same request.
 */
export const getServerSession = cache(async () => {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error?.status === 429 || error?.code === "over_request_rate_limit" || error?.message?.includes("rate limit")) {
      const now = Date.now();
      if (now - lastAuthRateLimitLogAt > 10_000) {
        lastAuthRateLimitLogAt = now;
        console.warn("Supabase auth rate limited on getUser(); retry on next navigation");
      }
      return null;
    }

    if (error || !user) {
      return null;
    }

    // Get user info from users table (name, role)
    const userRecord = await db
      .select({
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // Fallback to metadata if not in users table
    const role = userRecord[0]?.role || (user.user_metadata?.role as string) || "patient";
    const name = userRecord[0]?.name || null;

    return {
      id: user.id,
      email: user.email,
      role,
      name,
    };
  } catch (error: unknown) {
    const err = error as { status?: number; code?: string; message?: string };
    if (err?.status === 429 || err?.code === "over_request_rate_limit" || err?.message?.includes("rate limit")) {
      return null;
    }
    console.error("Error getting server session:", error);
    return null;
  }
});

