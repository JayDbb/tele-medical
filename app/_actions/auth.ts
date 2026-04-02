"use server";

import { createClient } from "@supabase/supabase-js";
import { db } from "@/app/_lib/db/drizzle/index";
import { users } from "@/app/_lib/db/drizzle/schema";

interface SignUpPayload {
  email: string;
  password: string;
  name: string;
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing Supabase environment variables. Please check your .env.local file."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function createPublicUserAction(payload: SignUpPayload) {
  const email = payload.email.trim().toLowerCase();
  const name = payload.name.trim();

  if (!name) {
    return { success: false, error: "Full name is required" };
  }

  if (!email) {
    return { success: false, error: "Email is required" };
  }

  if (payload.password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data: usersList, error: listError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (!listError) {
      const existingUser = usersList.users.find((user) => user.email === email);
      if (existingUser) {
        return {
          success: false,
          error: "A user with this email already exists",
        };
      }
    }

    const { data: authUser, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: payload.password,
        email_confirm: true,
        user_metadata: {
          name,
          role: "patient",
        },
      });

    if (authError || !authUser.user) {
      if (
        authError?.message?.toLowerCase().includes("already registered") ||
        authError?.message?.toLowerCase().includes("already exists") ||
        authError?.message?.toLowerCase().includes("user already")
      ) {
        return {
          success: false,
          error: "A user with this email already exists",
        };
      }

      return {
        success: false,
        error: authError?.message || "Failed to create account",
      };
    }

    try {
      await db.insert(users).values({
        id: authUser.user.id,
        email,
        name,
        role: "patient",
      });
    } catch (dbError: unknown) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      } catch (cleanupError) {
        console.error("Failed to cleanup auth user after DB error:", cleanupError);
      }

      return {
        success: false,
        error:
          dbError instanceof Error
            ? dbError.message
            : "Failed to create user record in database",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error creating public user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create account",
    };
  }
}
