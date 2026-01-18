"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { db } from "@/app/_lib/db/drizzle/index";
import { users } from "@/app/_lib/db/drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Create a Supabase admin client using service role key
 * This bypasses RLS and allows creating users
 */
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

export interface CreateUserPayload {
  email: string;
  password: string;
  name: string;
  role: "doctor" | "nurse";
}

/**
 * Create a new user (doctor or nurse) in Supabase auth and users table
 */
export async function createUserAction(payload: CreateUserPayload) {
  // Check authentication - only allow doctors and nurses to create users
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Only doctors and nurses can create users
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error("Unauthorized: Only doctors and nurses can create users");
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    // Check if user already exists by listing users and filtering by email
    // Note: This is a workaround since getUserByEmail doesn't exist in the admin API
    const { data: usersList, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error("Error listing users:", listError);
      // Continue anyway - we'll catch duplicate email error during creation
    } else {
      const existingUser = usersList?.users?.find((u: any) => u.email === payload.email);
      if (existingUser) {
        return {
          success: false,
          error: "A user with this email already exists",
        };
      }
    }

    // Create user in Supabase Auth
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        role: payload.role,
        name: payload.name,
      },
    });

    if (authError || !authUser.user) {
      // Check if error is due to duplicate email
      if (authError?.message?.toLowerCase().includes("already registered") || 
          authError?.message?.toLowerCase().includes("already exists") ||
          authError?.message?.toLowerCase().includes("user already")) {
        return {
          success: false,
          error: "A user with this email already exists",
        };
      }
      
      return {
        success: false,
        error: authError?.message || "Failed to create user in authentication system",
      };
    }

    // Insert user into users table
    try {
      await db.insert(users).values({
        id: authUser.user.id,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      });
    } catch (dbError: any) {
      // If database insert fails, try to clean up the auth user
      try {
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      } catch (cleanupError) {
        console.error("Failed to cleanup auth user after DB error:", cleanupError);
      }

      return {
        success: false,
        error: dbError?.message || "Failed to create user record in database",
      };
    }

    return {
      success: true,
      userId: authUser.user.id,
    };
  } catch (error) {
    console.error("Error creating user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create user",
    };
  }
}
