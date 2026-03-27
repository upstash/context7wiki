"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function Home() {
  const [repo, setRepo] = useState("");
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
      {/* Grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Glow effects */}
      <div className="fixed -top-48 -right-24 w-[500px] h-[500px] rounded-full bg-blue-500 opacity-[0.04] blur-[120px] pointer-events-none" />
      <div className="fixed -bottom-48 -left-24 w-[500px] h-[500px] rounded-full bg-violet-500 opacity-[0.04] blur-[120px] pointer-events-none" />

      <div className="relative z-10 text-center max-w-md w-full">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <Image
            src="/context7-logo-emerald.svg"
            alt="Context7"
            width={120}
            height={28}
            className="opacity-90"
          />
          <span className="text-[13px] font-semibold tracking-wide uppercase text-zinc-500">
            Wiki
          </span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Code documentation for
          <br />
          any open source repo
        </h1>
        <p className="text-zinc-500 text-[15px] mb-10 leading-relaxed">
          AI-generated docs from source code analysis.
          <br />
          Enter a GitHub repository to get started.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="upstash/ratelimit-js"
              className="w-full bg-white/[0.03] border border-white/[0.07] rounded-[10px] pl-10 pr-4 py-3 text-white placeholder:text-zinc-600 text-[13.5px] focus:outline-none focus:border-blue-500/35 focus:ring-2 focus:ring-blue-500/[0.06] transition-all"
            />
          </div>
          <button
            type="submit"
            className="bg-white text-zinc-950 font-semibold rounded-[10px] px-6 py-3 text-[13.5px] hover:bg-zinc-200 hover:-translate-y-px hover:shadow-lg hover:shadow-black/30 active:translate-y-0 transition-all"
          >
            Go
          </button>
        </form>

        <p className="text-zinc-700 text-xs mt-6">
          Powered by{" "}
          <a
            href="https://context7.com"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Context7
          </a>
        </p>
      </div>
    </div>
  );
}
