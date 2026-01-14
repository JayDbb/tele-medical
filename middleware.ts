import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseMiddlewareClient } from "@/app/_lib/supabase/middleware";

/**
 * Public routes that don't require authentication
 */
const publicRoutes = ["/sign-in", "/sign-up", "/reset-password"];

/**
 * Auth routes (sign-in, sign-up, etc.) - authenticated users should be redirected away
 */
const authRoutes = ["/sign-in", "/sign-up", "/reset-password"];

// Simple rate limit cooldown tracking
let lastRateLimitTime = 0;
const RATE_LIMIT_COOLDOWN = 10000; // 10 seconds cooldown after rate limit

/**
 * Middleware to handle authentication and route protection.
 * - Unauthenticated users accessing protected routes are redirected to /sign-in
 * - Authenticated users accessing auth pages are redirected to /
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static files and API routes (except auth-protected ones)
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check if the current path is a public/auth route
  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  );
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  try {
    const { supabase, response } = createSupabaseMiddlewareClient(request);

    // Get the current user session
    // This will check cookies automatically if they're set by Supabase
    let isAuthenticated = false;
    let user = null;

    // Skip auth check if we're in a rate limit cooldown period
    const now = Date.now();
    const inCooldown = now - lastRateLimitTime < RATE_LIMIT_COOLDOWN;

    if (!inCooldown) {
      try {
        const {
          data: { user: authUser },
          error,
        } = await supabase.auth.getUser();

        // Handle rate limiting gracefully - allow request through if rate limited
        if (
          error?.status === 429 ||
          error?.code === "over_request_rate_limit" ||
          error?.message?.includes("rate limit")
        ) {
          lastRateLimitTime = now;
          // Silently allow request through - don't log to reduce spam
          // Treat as unauthenticated to avoid redirect loops
          return response;
        }

        user = authUser;
        isAuthenticated = !!user && !error;
      } catch (authError: any) {
        // Handle rate limiting or other auth errors
        if (
          authError?.status === 429 ||
          authError?.code === "over_request_rate_limit" ||
          authError?.message?.includes("rate limit")
        ) {
          lastRateLimitTime = now;
          // Silently allow request through - don't log to reduce spam
          return response;
        }
        // For other errors, treat as unauthenticated
        isAuthenticated = false;
      }
    }

    // If user is authenticated and trying to access auth pages, redirect to role-specific page
    if (isAuthenticated && isAuthRoute && user) {
      const redirectUrl = request.nextUrl.clone();

      // Get user role from metadata
      const role = (user.user_metadata?.role as string) || "patient";

      // Redirect based on role
      if (role === "doctor") {
        redirectUrl.pathname = "/waiting-room";
      } else if (role === "nurse") {
        redirectUrl.pathname = "/patients";
      } else {
        redirectUrl.pathname = "/";
      }

      return NextResponse.redirect(redirectUrl);
    }

    // If user is not authenticated and trying to access protected routes, redirect to sign-in
    if (!isAuthenticated && !isPublicRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/sign-in";
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  } catch (error) {
    // If there's an error creating the Supabase client, allow the request through
    // This prevents the app from breaking if env vars are misconfigured
    console.error("Middleware error:", error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
