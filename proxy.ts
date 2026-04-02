import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseMiddlewareClient } from "@/app/_lib/supabase/middleware";

const publicRoutes = ["/sign-in", "/sign-up", "/reset-password"];
const authRoutes = ["/sign-in", "/sign-up", "/reset-password"];

let lastRateLimitTime = 0;
const RATE_LIMIT_COOLDOWN = 10000;

function getAuthenticatedRedirectPath(role: string | undefined) {
  if (role === "doctor") {
    return "/waiting-room";
  }

  if (role === "nurse") {
    return "/patients";
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  try {
    const { supabase, response } = createSupabaseMiddlewareClient(request);

    let isAuthenticated = false;
    let user: { user_metadata?: { role?: string } } | null = null;

    const now = Date.now();
    const inCooldown = now - lastRateLimitTime < RATE_LIMIT_COOLDOWN;

    if (!inCooldown) {
      try {
        const {
          data: { user: authUser },
          error,
        } = await supabase.auth.getUser();

        if (
          error?.status === 429 ||
          error?.code === "over_request_rate_limit" ||
          error?.message?.includes("rate limit")
        ) {
          lastRateLimitTime = now;
          return response;
        }

        user = authUser;
        isAuthenticated = !!user && !error;
      } catch (authError: unknown) {
        if (
          authError &&
          typeof authError === "object" &&
          "message" in authError &&
          "status" in authError &&
          (((authError.status as number | undefined) === 429) ||
            (typeof authError.message === "string" &&
              authError.message.includes("rate limit")))
        ) {
          lastRateLimitTime = now;
          return response;
        }

        isAuthenticated = false;
      }
    }

    if (isAuthenticated && isAuthRoute && user) {
      const redirectPath = getAuthenticatedRedirectPath(user.user_metadata?.role);

      if (redirectPath) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = redirectPath;
        return NextResponse.redirect(redirectUrl);
      }

      return response;
    }

    if (!isAuthenticated && !isPublicRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/sign-in";
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
