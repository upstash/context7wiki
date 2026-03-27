import { serve } from "@upstash/workflow/nextjs";
import { Box, Agent, ClaudeCode } from "@upstash/box";
import { setCodeDocs } from "@/lib/redis";

const TEMPLATE_REPO = "https://github.com/upstash/codedocs-template";
const AGENT_TIMEOUT_MS = 25 * 60 * 1000;

interface WorkflowPayload {
  project: string;
  email: string;
  repoUrl: string;
  branch?: string;
}

export const { POST } = serve(
  async (context) => {
    const { project, email, repoUrl, branch = "main" } =
      context.requestPayload as WorkflowPayload;

    const projectName = project.startsWith("/") ? project.slice(1) : project;
    const [org, repo] = projectName.split("/");

    // ─── Step 1: Create Box + clone repos ───
    const boxId = await context.run("create-box", async () => {
      const box = await Box.create({
        runtime: "node",
        agent: {
          provider: Agent.ClaudeCode,
          model: ClaudeCode.Opus_4_6,
          apiKey: process.env.ANTHROPIC_API_KEY!,
        },
        git: { token: process.env.GITHUB_TOKEN! },
        timeout: 30 * 60 * 1000,
      });

      await box.git.clone({ repo: repoUrl, branch });
      await box.git.clone({ repo: TEMPLATE_REPO, branch: "main" });

      // Install template dependencies
      const pwd = await box.exec.command("pwd");
      const workspaceRoot = pwd.result.trim();
      await box.exec.command(
        `cd ${workspaceRoot}/codedocs-template && npm install`
      );

      return box.id;
    });

    // ─── Step 2: Run agent with webhook ───
    const webhook = await context.createWebhook("agent-done");

    await context.run("start-agent", async () => {
      const box = await Box.get(boxId);

      const pwd = await box.exec.command("pwd");
      const workspaceRoot = pwd.result.trim();
      const repoRoot = `${workspaceRoot}/${repo}`;
      const templateRoot = `${workspaceRoot}/codedocs-template`;
      const contentDir = `${templateRoot}/content/docs`;

      // Update shared.ts with project info
      await box.files.write({
        path: `${templateRoot}/src/lib/shared.ts`,
        content: [
          `export const appName = '${projectName}';`,
          `export const docsRoute = '/docs';`,
          `export const docsImageRoute = '/og/docs';`,
          `export const docsContentRoute = '/llms.mdx/docs';`,
          `export const gitConfig = { user: '${org}', repo: '${repo}', branch: 'main' };`,
        ].join("\n"),
      });

      const prompt = buildPrompt(projectName, repoRoot, contentDir, templateRoot);

      await box.agent.run({
        prompt,
        timeout: AGENT_TIMEOUT_MS,
        webhook: { url: webhook.webhookUrl },
      });
    });

    // ─── Step 3: Wait for agent (up to 1h) ───
    await context.waitForWebhook("wait-agent", webhook, "1h");

    // ─── Step 4: Build Fumadocs static site ───
    await context.run("build-site", async () => {
      const box = await Box.get(boxId);
      const pwd = await box.exec.command("pwd");
      const templateRoot = `${pwd.result.trim()}/codedocs-template`;

      const buildResult = await box.exec.command(
        `cd ${templateRoot} && npm run build 2>&1 | tail -20`
      );

      // Verify build succeeded
      const check = await box.exec.command(
        `ls ${templateRoot}/out/index.html 2>/dev/null && echo OK || echo FAIL`
      );
      if (!check.result.includes("OK")) {
        throw new Error(`Build failed: ${buildResult.result}`);
      }
    });

    // ─── Step 5: Serve + get preview URL ───
    const previewUrl = await context.run("serve-preview", async () => {
      const box = await Box.get(boxId);
      const pwd = await box.exec.command("pwd");
      const templateRoot = `${pwd.result.trim()}/codedocs-template`;

      // Write persistent server script
      await box.files.write({
        path: `${templateRoot}/serve.sh`,
        content:
          "#!/bin/sh\nwhile true; do npx -y serve out -p 3000 2>&1; sleep 1; done",
      });
      await box.exec.command(`chmod +x ${templateRoot}/serve.sh`);
      await box.exec.command(
        `cd ${templateRoot} && nohup sh serve.sh > /tmp/serve.log 2>&1 &`
      );

      // Wait and verify
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const h = await box.exec.command(
          'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/'
        );
        if (h.result.trim() === "200") break;
      }

      const preview = await box.getPreviewUrl(3000);
      return preview.url;
    });

    // ─── Step 6: Count files + update Redis ───
    const fileCount = await context.run("update-redis", async () => {
      const box = await Box.get(boxId);
      const pwd = await box.exec.command("pwd");
      const contentPath = `${pwd.result.trim()}/codedocs-template/content/docs`;

      const countResult = await box.exec.command(
        `find ${contentPath} -name '*.mdx' -type f | wc -l`
      );
      const count = parseInt(countResult.result.trim()) || 0;

      await setCodeDocs(`/${projectName}`, {
        project: `/${projectName}`,
        generatedAt: new Date().toISOString(),
        boxId,
        previewUrl,
        fileCount: count,
        status: "ready",
        repoUrl,
        branch,
      });

      return count;
    });

    // ─── Step 7: Send email ───
    await context.api.resend.call("send-email", {
      token: process.env.RESEND_API_KEY!,
      body: {
        from: "Context7 Wiki <no-reply@context7.com>",
        to: email,
        subject: `Documentation ready: ${projectName}`,
        html: emailTemplate(projectName, org, repo, previewUrl, fileCount),
      },
    });
  },
  {
    failureFunction: async ({ context }) => {
      const { project } =
        context.requestPayload as WorkflowPayload;
      const projectPath = project.startsWith("/")
        ? project
        : `/${project}`;

      await setCodeDocs(projectPath, {
        project: projectPath,
        generatedAt: new Date().toISOString(),
        boxId: "",
        previewUrl: "",
        fileCount: 0,
        status: "failed",
        repoUrl: (context.requestPayload as WorkflowPayload).repoUrl,
        branch: (context.requestPayload as WorkflowPayload).branch || "main",
      });
    },
  }
);

// ─── Email Template ───

function emailTemplate(
  projectName: string,
  org: string,
  repo: string,
  previewUrl: string,
  fileCount: number
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8f8f8;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden">
    <div style="padding:32px 32px 24px;border-bottom:1px solid #f0f0f0">
      <div style="font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#0d9373;margin-bottom:16px">Context7 Wiki</div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a">Documentation is ready</h1>
      <p style="margin:0;font-size:15px;color:#666;line-height:1.5">
        AI-generated documentation for <strong style="color:#1a1a1a">${org}/${repo}</strong> has been created with ${fileCount} pages.
      </p>
    </div>
    <div style="padding:24px 32px">
      <a href="https://wiki.context7.com/${projectName}" style="display:inline-block;padding:10px 24px;background:#0d9373;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
        View Documentation
      </a>
    </div>
    <div style="padding:16px 32px 24px;font-size:12px;color:#999">
      <a href="https://context7.com/${projectName}" style="color:#999">View on Context7</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── Agent Prompt ───

function buildPrompt(
  projectName: string,
  repoRoot: string,
  contentDir: string,
  templateRoot: string
): string {
  return `You have two repositories cloned in this environment:
1. **Source repo** at ${repoRoot} — the library to document
2. **Docs template** at ${templateRoot} — a Fumadocs project with static export configured

YOUR TASK: Analyze the source code and generate comprehensive documentation as .mdx files in ${contentDir}.

======================================================================
STEP 1: DEEP ANALYSIS
======================================================================

cd into ${repoRoot} and thoroughly analyze:

1. **Project identity** — Read README.md, package.json, pyproject.toml etc.
2. **Entry points** — Find package.json main/exports, __init__.py, mod.rs, index.ts, main.go, lib.rs
3. **Public API surface** — Walk from entry points outward. Map every exported function, class, interface, type, constant
4. **Architecture** — Understand how modules relate, data flow, patterns used
5. **Configuration** — Find all config options, environment variables, constructor parameters
6. **Examples** — Look for /examples, /demos, README code blocks

======================================================================
STEP 2: DOCUMENTATION STRUCTURE
======================================================================

Generate this hierarchy in ${contentDir}:

**1. Introduction & Overview** (MOST IMPORTANT)
- index.mdx — One-sentence positioning, "The Problem" section (3-4 pain points), "The Solution" (how this library solves them with quick code example), "Key Features" bullet list, "Supported Environments", <Cards> linking to key pages

**2. Getting Started**
- getting-started.mdx — Installation with <Tabs> for npm/pnpm/yarn/bun, basic setup, complete working example

**3. Architecture**
- architecture.mdx — Mermaid diagram of module relationships, key design decisions and WHY

**4. Core Concepts** (one .mdx per major concept)

**5. Guides** (in guides/ subfolder)

**6. API Reference** (in api-reference/ subfolder)
- One page per public class/function with parameter tables and examples

**7. Types** (if TypeScript)
- types.mdx — Actual type definitions from source

### meta.json (CRITICAL)

Create ${contentDir}/meta.json:
{
  "title": "${projectName}",
  "pages": ["index", "getting-started", "architecture", "---Core Concepts---", "concept1", "---Guides---", "...guides", "---API Reference---", "...api-reference", "---Types---", "types"]
}

For subfolders, create meta.json with: { "title": "...", "pages": ["page1", "page2"] }

======================================================================
STEP 3: CONTENT QUALITY
======================================================================

Every .mdx file MUST have:
---
title: "Page Title"
description: "One sentence"
---

Available MDX components (pre-registered):

<Cards> + <Card> — navigation grids
<Callout type="info|warn|error"> — notes/warnings
<Steps> + <Step> with ### headings inside
<Tabs items={[...]}> + <Tab value="...">
<Accordions> + <Accordion title="...">
Mermaid diagrams via \`\`\`mermaid code blocks

DO NOT use <Note>, <Warning>, <Tip>, <ParamField>, <ResponseField> — these will BREAK the build.

Use parameter tables in markdown:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|

All code MUST be actual code from the repository.

======================================================================
CONSTRAINTS
======================================================================

- Analyze at most 100 source files, generate at most 30 doc files
- Each file: 300-2500 words
- Focus on depth over breadth

Write ALL files to ${contentDir}.
Do NOT modify files outside ${contentDir}.`;
}
