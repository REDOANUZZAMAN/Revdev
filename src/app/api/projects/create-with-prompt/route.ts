import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { DEFAULT_CONVERSATION_TITLE } from "@/features/conversations/constants";

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";

const requestSchema = z.object({
  prompt: z.string().min(1),
});

// -----------------------------------------------------------------------------
// Phase H — fast project bootstrap.
// -----------------------------------------------------------------------------
//
// Was: this route did 6-8 sequential Convex round-trips before returning the
// projectId — create project, create user message, create assistant message,
// create `app` folder, query files, create layout/page, query files again,
// create package.json, etc. On a cold cache that easily exceeded the dev
// server's 10-15s request timeout, and the user saw a TimeoutError modal
// while a perfectly good project existed in the background.
//
// New plan:
//   1) Create project + conversation + user msg + processing assistant msg
//      synchronously (4 round-trips, parallelised where safe). This is the
//      minimum the redirect target needs — the projects page reads from
//      Convex directly so we just need the IDs to exist.
//   2) Fire Inngest "message/sent" event — fire-and-forget.
//   3) Return projectId immediately.
//   4) Scaffold the minimal `app/layout.tsx` + `app/page.tsx` + root config
//      files via a SINGLE batched fire-and-forget Convex mutation that runs
//      AFTER we've already responded to the client. The agent will overwrite
//      these as it executes its plan, so they only need to exist before the
//      user opens the Preview tab — well within the agent's startup latency.
//
// Result: this endpoint typically returns in <500ms (was 3-12s) and the
// "could not create a project" timeout is gone.

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      return NextResponse.json(
        { error: "Internal key not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { prompt } = requestSchema.parse(body);

    // Generate a random project name
    const projectName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, colors],
      separator: "-",
      length: 3,
    });

    // ----- Step 1 — project + conversation in one mutation -----
    const { projectId, conversationId } = await convex.mutation(
      api.system.createProjectWithConversation,
      {
        internalKey,
        projectName,
        conversationTitle: DEFAULT_CONVERSATION_TITLE,
        ownerId: userId,
      },
    );

    // ----- Step 2 — user + assistant messages in parallel -----
    // These are independent inserts in the same conversation, so we don't
    // need to await them sequentially. Convex handles concurrent inserts
    // fine; the only thing that depends on the assistant id is the Inngest
    // event below.
    const [, assistantMessageId] = await Promise.all([
      convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId,
        projectId,
        role: "user",
        content: prompt,
      }),
      convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId,
        projectId,
        role: "assistant",
        content: "",
        status: "processing",
      }),
    ]);

    // ----- Step 3 — fire Inngest event (fire-and-forget) -----
    // The agent will create its own files, so we don't need to block on
    // scaffolding before the event. If Inngest is down we still return a
    // valid projectId — the user can resend the message manually.
    inngest
      .send({
        name: "message/sent",
        data: {
          messageId: assistantMessageId,
          conversationId,
          projectId,
          message: prompt,
        },
      })
      .catch((err) => {
        console.error("Failed to send Inngest event:", err);
      });

    // ----- Step 4 — fire-and-forget scaffold of minimal preview files -----
    // We don't `await` this. It runs against Convex directly and is best-effort:
    // if it loses the race with the agent's first `createFiles` call the
    // agent's version wins (its files have unique names, ours are minimal
    // placeholders). The whole block is wrapped so any throw is logged
    // server-side and never surfaces to the client.
    void scaffoldMinimalPreviewFiles({
      internalKey,
      projectId,
      projectName,
    }).catch((err) => {
      console.error("Background scaffold failed:", err);
    });

    return NextResponse.json({ projectId });
  } catch (error) {
    console.error("Failed to create project with prompt:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}

/**
 * Best-effort scaffold of the minimal Next.js files needed for the WebContainer
 * preview to render *something* before the agent gets going. Runs asynchronously
 * after the route has already responded — never block the user-facing request
 * on this.
 *
 * Idempotent: if a file with the same name already exists at the same parent,
 * Convex's createFiles errors out and we just swallow it (the agent's version
 * is the source of truth).
 */
async function scaffoldMinimalPreviewFiles(opts: {
  internalKey: string;
  projectId: import("../../../../../convex/_generated/dataModel").Id<"projects">;
  projectName: string;
}) {
  const { internalKey, projectId, projectName } = opts;

  // Create `app` folder. If creation fails we look it up in the existing tree.
  let appFolderId: import("../../../../../convex/_generated/dataModel").Id<"files"> | undefined;
  try {
    appFolderId = await convex.mutation(api.system.createFolder, {
      internalKey,
      projectId,
      name: "app",
    });
  } catch {
    try {
      const allFiles = await convex.query(api.system.getProjectFiles, {
        internalKey,
        projectId,
      });
      const existing = allFiles.find(
        (f) => f.name === "app" && f.type === "folder"
      );
      if (existing) appFolderId = existing._id;
    } catch {
      /* swallow — we'll just skip scaffolding */
    }
  }

  // Tailwind-ready scaffold.
  //
  // The earlier scaffold gave the agent a bare `app/layout.tsx` + `app/page.tsx`
  // and a `package.json` with literally nothing in dependencies. Result: the
  // agent built every site with a) Tailwind utility classes (because every
  // model trained on web code defaults to that idiom), b) imports like
  // `import './globals.css'`, c) `@/components/Foo` paths — but NONE of those
  // worked at runtime because there was no Tailwind toolchain, no globals.css,
  // no `paths` config in tsconfig.json. Preview rendered as raw unstyled HTML
  // until the user said "the css is missing" and the auto-fix loop scrambled
  // to add it on round 2.
  //
  // Fix: scaffold a COMPLETE working Next.js + Tailwind setup up front. Now
  // the agent's "I'll write a Hero component with `className='text-4xl font-bold'`"
  // intuition Just Works on the first compile. The agent doesn't even need
  // to know Tailwind is here — it just writes idiomatic JSX and the styles
  // render. (We also tell the system prompt about it for good measure.)

  const layoutContent = `import React from 'react';
import './globals.css';

export const metadata = {
  title: '${projectName}',
  description: 'Built with REVDEV',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-gray-900">{children}</body>
    </html>
  );
}
`;

  const pageContent = `export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Welcome
        </h1>
        <p className="mt-4 text-gray-600">
          Your project is loading. The AI is preparing your site…
        </p>
      </div>
    </main>
  );
}
`;

  // Tailwind v3 directives. v3 because v4 still has rough edges in the
  // WebContainer build pipeline as of this writing — and v3 is what the
  // agent's training data overwhelmingly produces.
  const globalsCssContent = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

  // Create the minimal files under `app` and the root config in parallel.
  // Each call is wrapped individually so a failure in one doesn't abort the
  // other — getting the partial scaffold is still useful.
  const tasks: Promise<unknown>[] = [];

  if (appFolderId) {
    tasks.push(
      convex
        .mutation(api.system.createFiles, {
          internalKey,
          projectId,
          parentId: appFolderId,
          files: [
            { name: "layout.tsx", content: layoutContent },
            { name: "page.tsx", content: pageContent },
            { name: "globals.css", content: globalsCssContent },
          ],
        })
        .catch((err) => console.warn("scaffold app/* failed:", err))
    );
  }

  // Tailwind v3 scans these globs for class names. Including `app/**/*` and
  // a generous `components/**/*` covers the agent's typical output structure
  // without it needing to think about it.
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
`;

  const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;

  // tsconfig with `@/` path alias so the agent can use `import x from '@/lib/foo'`
  // and not have to think about relative paths from deep folders. This was
  // ALSO missing in the old scaffold — the auto-fix loop kept having to add it.
  const tsConfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

  tasks.push(
    convex
      .mutation(api.system.createFiles, {
        internalKey,
        projectId,
        parentId: undefined,
        files: [
          {
            name: "package.json",
            content: JSON.stringify(
              {
                name: projectName,
                private: true,
                scripts: {
                  dev: "next dev",
                  build: "next build",
                  start: "next start",
                  lint: "next lint",
                },
                // Pinning to current LTS-ish versions that all play nice with
                // Tailwind v3 and the latest Next.js App Router. Keeping the
                // list minimal — the agent can add more if it needs them.
                dependencies: {
                  next: "^14.2.0",
                  react: "^18.3.0",
                  "react-dom": "^18.3.0",
                },
                devDependencies: {
                  "@types/node": "^20.12.0",
                  "@types/react": "^18.3.0",
                  "@types/react-dom": "^18.3.0",
                  autoprefixer: "^10.4.20",
                  postcss: "^8.4.40",
                  tailwindcss: "^3.4.10",
                  typescript: "^5.5.0",
                },
              },
              null,
              2
            ),
          },
          {
            name: "next.config.js",
            content:
              "/** @type {import('next').NextConfig} */\nconst nextConfig = { reactStrictMode: true };\nmodule.exports = nextConfig;\n",
          },
          { name: "tailwind.config.js", content: tailwindConfig },
          { name: "postcss.config.js", content: postcssConfig },
          { name: "tsconfig.json", content: tsConfig },
        ],
      })
      .catch((err) => console.warn("scaffold root/* failed:", err))
  );

  await Promise.all(tasks);
}
