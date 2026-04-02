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

    try {
      const {
        data: { user: authUser },
        error,
      } = await supabase.auth.getUser();

      // Rate limited: allow request through with existing cookies; avoid forcing /sign-in
      if (
        error?.status === 429 ||
        error?.code === "over_request_rate_limit" ||
        error?.message?.includes("rate limit")
      ) {
        return response;
      }

      user = authUser;
      isAuthenticated = !!user && !error;
    } catch (authError: unknown) {
      const ae = authError as { status?: number; code?: string; message?: string };
      if (
        ae?.status === 429 ||
        ae?.code === "over_request_rate_limit" ||
        ae?.message?.includes("rate limit")
      ) {
        return response;
      }
      isAuthenticated = false;
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
