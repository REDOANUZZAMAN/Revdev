import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/inngest(.*)",
  // Sentry example routes for verifying the integration
  "/sentry-example-page",
  "/api/sentry-example-api",
  // /preview is a same-origin wrapper around the WebContainer URL —
  // see src/app/preview/page.tsx. We route the user here from the
  // editor's "Open in new tab" button so the preview iframe inherits
  // our COEP/COOP headers and skips the "Connect to Project"
  // handshake. The page itself does its own ?url= allowlist check
  // (only webcontainer-api.io subdomains are accepted), so making it
  // unauthenticated is safe — there's nothing sensitive on it.
  "/preview(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Bypass auth entirely for the Sentry tunnel route (configured via
  // `tunnelRoute: "/monitoring"` in next.config.ts). Sentry POSTs binary
  // envelopes here that must be passed straight through.
  if (req.nextUrl.pathname.startsWith("/monitoring")) {
    return NextResponse.next();
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals, the Sentry tunnel (`/monitoring`), and all static files,
    // unless found in search params.
    "/((?!_next|monitoring|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes (excluding the Sentry tunnel handled at /monitoring)
    "/(api|trpc)(.*)",
  ],
};
