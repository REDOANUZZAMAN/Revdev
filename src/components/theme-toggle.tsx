"use client"

import React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  const [portalEl, setPortalEl] = React.useState<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("id", "theme-toggle-portal");
    // ensure pointer events and very high z-index so it's clickable
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.right = "0";
    el.style.zIndex = "9999";
    el.style.pointerEvents = "auto";
    document.body.appendChild(el);
    setPortalEl(el);
    return () => {
      try {
        document.body.removeChild(el);
      } catch (e) {}
    };
  }, []);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const current = theme === "system" ? resolvedTheme : theme;

  const toggle = () => setTheme(current === "dark" ? "light" : "dark");

  

  if (!portalEl) return null;

  const button = (
    <div style={{ pointerEvents: "auto" }}>
      <button
        type="button"
        aria-label="Toggle theme"
        title="Toggle light / dark"
        onClick={toggle}
        className="fixed top-4 right-4 z-[9999] inline-flex items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm hover:opacity-90 pointer-events-auto"
      >
        {current === "dark" ? (
          // Sun icon for light
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <path d="M12 1v2"></path>
            <path d="M12 21v2"></path>
            <path d="M4.22 4.22l1.42 1.42"></path>
            <path d="M18.36 18.36l1.42 1.42"></path>
            <path d="M1 12h2"></path>
            <path d="M21 12h2"></path>
            <path d="M4.22 19.78l1.42-1.42"></path>
            <path d="M18.36 5.64l1.42-1.42"></path>
          </svg>
        ) : (
          // Moon icon for dark
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        )}
      </button>
    </div>
  );

  return createPortal(button, portalEl);
}
