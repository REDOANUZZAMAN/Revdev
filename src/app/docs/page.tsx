import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Docs - REVDEV",
  description: "Documentation for REVDEV — getting started, guides, and API reference.",
};

export default function DocsPage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <header className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 relative">
          <Image src="/logo.svg" alt="REVDEV" fill className="object-contain" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold">Documentation</h1>
          <p className="text-sm text-muted-foreground">Guides, reference, and how-tos for REVDEV.</p>
        </div>
      </header>

      <nav className="mb-8">
        <ul className="flex gap-4 flex-wrap text-sm">
          <li><a href="#getting-started" className="underline">Getting Started</a></li>
          <li><a href="#guides" className="underline">Guides</a></li>
          <li><a href="#api" className="underline">API Reference</a></li>
          <li><a href="#faq" className="underline">FAQ</a></li>
        </ul>
      </nav>

      <section id="getting-started" className="mb-12">
        <h2 className="text-2xl font-medium mb-3">Getting Started</h2>
        <p className="text-muted-foreground">This quick start helps you get REVDEV running locally and understanding the core workflow.</p>
        <ol className="list-decimal list-inside mt-4 space-y-2">
          <li>Clone the repo.</li>
          <li>Install dependencies: <code className="px-1 bg-muted/50 rounded">npm install</code>.</li>
          <li>Start the development server: <code className="px-1 bg-muted/50 rounded">npm run dev</code>.</li>
          <li>Open <code className="px-1 bg-muted/50 rounded">http://localhost:3000</code>.</li>
        </ol>
      </section>

      <section id="guides" className="mb-12">
        <h2 className="text-2xl font-medium mb-3">Guides</h2>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>Projects:</strong> How to create, import, and download projects.</li>
          <li><strong>Auth:</strong> Clerk integration and user sessions.</li>
          <li><strong>Theme:</strong> Light/dark theming via next-themes and CSS tokens.</li>
        </ul>
      </section>

      <section id="api" className="mb-12">
        <h2 className="text-2xl font-medium mb-3">API Reference</h2>
        <p className="text-muted-foreground">Reference for the main application API routes and Convex functions. Add your detailed endpoints here.</p>
      </section>

      <section id="faq" className="mb-12">
        <h2 className="text-2xl font-medium mb-3">FAQ</h2>
        <details className="mb-3">
          <summary className="cursor-pointer">Why isn't the favicon updating?</summary>
          <div className="mt-2 text-sm text-muted-foreground">Browsers cache favicons aggressively — try a hard refresh or open an incognito window.</div>
        </details>
        <details>
          <summary className="cursor-pointer">How do I contribute?</summary>
          <div className="mt-2 text-sm text-muted-foreground">Open a PR with a clear description and include screenshots or reproduction steps for UI changes.</div>
        </details>
      </section>

      <footer className="pt-8 border-t mt-8 text-sm text-muted-foreground">
        <div>Need more docs? I can scaffold a full docs sidebar and markdown-driven pages.</div>
      </footer>
    </main>
  );
}
