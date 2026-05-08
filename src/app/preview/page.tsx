"use client";

/**
 * Standalone preview wrapper.
 *
 * Why this page exists
 * --------------------
 * WebContainer URLs come in two flavors:
 *   • `local-credentialless.webcontainer-api.io` — used when the parent
 *     page sends `Cross-Origin-Embedder-Policy: credentialless`
 *     (which our `next.config.ts` does, application-wide).
 *   • `local.webcontainer-api.io` (no `-credentialless`) — for `coep:
 *     "require-corp"` setups.
 *
 * The credentialless variant trades a bit of network sharing for the
 * looser cookie/storage semantics. The catch: when you navigate a
 * fresh tab DIRECTLY to a credentialless URL, WebContainer shows the
 * "You're almost there! Connect to Project" interstitial because that
 * tab's browsing context isn't yet linked to the originating project.
 *
 * The fix is to open the preview INSIDE one of OUR pages — same origin,
 * same COEP/COOP headers as the project view, so the credentialless
 * context is shared and no handshake is needed. The iframe just loads
 * and works.
 *
 * Usage
 * -----
 *   /preview?url=<encoded webcontainer URL>
 *
 * Called from PreviewView's "Open in new tab" button. We URL-encode the
 * full https URL into the `url` query param, then this page validates
 * it (must be a webcontainer-api.io subdomain — no open redirects) and
 * iframes it full-bleed.
 */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLinkIcon, AlertTriangleIcon } from "lucide-react";

/**
 * Allowlist for the iframe `src`. We MUST validate to prevent the
 * `?url=` param from being abused as an open redirect — anyone could
 * link `https://yourapp.com/preview?url=https://evil.com` and we'd
 * happily render their page inside our authenticated context. By only
 * allowing known WebContainer subdomains we keep this strictly a
 * preview-display tool.
 */
const ALLOWED_HOSTS = [
  "local-credentialless.webcontainer-api.io",
  "local.webcontainer-api.io",
  // StackBlitz also hosts on these for future-proofing — same vendor,
  // same security posture.
  "webcontainer-api.io",
];

function isAllowedUrl(raw: string | null): { ok: true; url: string } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: "Missing ?url= parameter" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL — must include the full https:// prefix" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: `Refused: only https URLs are allowed (got ${parsed.protocol})` };
  }
  // Match if the hostname IS one of the allowed hosts OR ends with one of
  // them as a suffix (the actual hostnames look like
  // `xyz123-3001--abc123.local-credentialless.webcontainer-api.io`).
  const ok = ALLOWED_HOSTS.some(
    (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
  );
  if (!ok) {
    return {
      ok: false,
      reason: `Refused: ${parsed.hostname} is not a WebContainer host`,
    };
  }
  return { ok: true, url: parsed.toString() };
}

function PreviewInner() {
  const searchParams = useSearchParams();
  const rawUrl = searchParams.get("url");
  const [validation] = useState(() => isAllowedUrl(rawUrl));

  // Update the document title with a snippet of the host so the user can
  // tell multiple preview tabs apart.
  useEffect(() => {
    if (validation.ok) {
      try {
        const u = new URL(validation.url);
        document.title = `Preview · ${u.hostname.split(".")[0].slice(0, 32)}`;
      } catch {
        document.title = "Preview";
      }
    } else {
      document.title = "Preview · Error";
    }
  }, [validation]);

  if (!validation.ok) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0f] text-gray-300 p-8">
        <div className="max-w-md w-full bg-white/[0.03] border border-white/10 rounded-2xl p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <AlertTriangleIcon className="size-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-white">
            Can&apos;t open this preview
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            {validation.reason}
          </p>
          <p className="text-xs text-gray-500">
            Open the project in REVDEV and click &quot;Open in new tab&quot; from the
            Preview pane.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0a0f]">
      {/* Slim header — keeps the URL visible and gives the user a way to
          jump straight to the raw WebContainer URL if they want to. The
          handshake page WOULD still appear there, so we warn them with a
          subtle hint. */}
      <header className="h-9 shrink-0 flex items-center bg-[#0d0d14] border-b border-white/5 px-3 gap-2 text-xs">
        <span className="text-gray-500">Preview</span>
        <span className="flex-1 truncate font-mono text-gray-400">
          {validation.url}
        </span>
        <a
          href={validation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 text-gray-400 hover:text-gray-200 transition-colors"
          title="Open the raw WebContainer URL (may show a connect handshake)"
        >
          <ExternalLinkIcon className="size-3" />
          <span>Raw</span>
        </a>
      </header>
      <iframe
        src={validation.url}
        className="flex-1 w-full border-0 bg-white"
        title="WebContainer preview"
        // sandbox + allow attributes left at iframe defaults — we explicitly
        // WANT scripts/storage/etc. enabled so the previewed app can run.
      />
    </div>
  );
}

/**
 * useSearchParams must be wrapped in Suspense for Next.js App Router.
 * The fallback is essentially never visible — it just satisfies the
 * compiler and React's "search params read during render" guard.
 */
export default function PreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0f] text-gray-500 text-sm">
          Loading preview…
        </div>
      }
    >
      <PreviewInner />
    </Suspense>
  );
}
