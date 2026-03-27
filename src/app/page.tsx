"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const FEATURED = [
  { org: "upstash", repo: "ratelimit-js" },
  { org: "vercel", repo: "ai" },
  { org: "prisma", repo: "prisma" },
  { org: "drizzle-team", repo: "drizzle-orm" },
  { org: "honojs", repo: "hono" },
  { org: "langchain-ai", repo: "langchainjs" },
];

export default function Home() {
  const [repo, setRepo] = useState("");
  const [focused, setFocused] = useState(false);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = repo
      .replace(/https?:\/\//g, "")
      .replace("github.com/", "")
      .replace(/\.git$/, "")
      .replace(/^\//, "");

    if (cleaned.includes("/")) {
      router.push(`/${cleaned}`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 relative overflow-hidden">
      {/* Noise texture overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Radial glow */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-emerald-500/[0.04] blur-[150px] pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-emerald-400/[0.02] blur-[100px] pointer-events-none" />

      <div className="relative z-10 text-center max-w-xl w-full">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-12">
          <Image
            src="/context7-logo-emerald.svg"
            alt="Context7"
            width={110}
            height={26}
            className="opacity-80"
          />
          <div className="h-5 w-px bg-white/10" />
          <span className="text-[12px] font-mono font-medium tracking-[0.15em] uppercase text-emerald-400/70">
            Wiki
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-[42px] font-bold tracking-[-0.035em] leading-[1.1] mb-4 text-white/95">
          Understand any
          <br />
          <span className="text-emerald-400">codebase</span>, instantly.
        </h1>
        <p className="text-[15px] text-white/40 mb-10 leading-relaxed max-w-sm mx-auto">
          AI-generated documentation from source code.
          Architecture, APIs, guides — in minutes.
        </p>

        {/* Search */}
        <form onSubmit={handleSubmit} className="relative max-w-md mx-auto mb-12">
          <div
            className={`relative transition-all duration-300 ${
              focused
                ? "shadow-[0_0_30px_rgba(16,185,129,0.08)]"
                : ""
            }`}
          >
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[13px] text-white/20 select-none">
              &gt;
            </span>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="owner/repository"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-24 py-3.5 text-[14px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/30 transition-all"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-emerald-500 text-[#0a0a0c] font-semibold rounded-lg px-5 py-2 text-[13px] hover:bg-emerald-400 active:bg-emerald-600 transition-colors"
            >
              Explore
            </button>
          </div>
        </form>

        {/* Featured repos */}
        <div className="space-y-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/15">
            Try a library
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {FEATURED.map(({ org, repo }) => (
              <button
                key={`${org}/${repo}`}
                onClick={() => router.push(`/${org}/${repo}`)}
                className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] font-mono text-white/35 hover:text-emerald-400/80 hover:border-emerald-500/20 hover:bg-emerald-500/[0.04] transition-all duration-200"
              >
                {org}/{repo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 text-center">
        <a
          href="https://context7.com"
          className="text-[11px] font-mono text-white/15 hover:text-white/30 transition-colors"
        >
          context7.com
        </a>
      </div>
    </div>
  );
}
