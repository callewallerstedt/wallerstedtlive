"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Strategy" },
  { href: "/live", label: "Live Tracker" },
  { href: "/live-dash", label: "Live Dash" },
  { href: "/live-view", label: "Live View" },
  { href: "/stream-control", label: "Stream Control" },
  { href: "/stream-overlay", label: "Stream Overlay" },
];

export function TopNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/stream-overlay") || pathname.startsWith("/stream-control")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-30 border-b border-stone-800/80 bg-stone-950/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3 md:px-10">
        <p className="text-xs uppercase tracking-[0.35em] text-stone-400">Wallerstedt Console</p>
        <nav className="flex items-center gap-2">
          {items.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full border px-3 py-1.5 text-xs tracking-wide transition ${
                  isActive
                    ? "border-amber-200/60 bg-amber-200/15 text-amber-100"
                    : "border-stone-700 bg-stone-900 text-stone-300 hover:border-stone-600"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
