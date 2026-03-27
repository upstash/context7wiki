import { serve } from "@upstash/workflow/nextjs";
import { setCodeDocs } from "@/lib/redis";

const PARSER_API_URL =
  process.env.PARSER_API_URL || "https://parser.context7.com";

interface WorkflowPayload {
  project: string;
  email: string;
  repoUrl: string;
  branch?: string;
}

interface ParserWebhookResult {
  status: "ready" | "failed";
  project: string;
  email: string;
  previewUrl?: string;
  boxId?: string;
  fileCount?: number;
  prUrl?: string;
}

export const { POST } = serve(
  async (context) => {
    const { project, email, repoUrl, branch = "main" } =
      context.requestPayload as WorkflowPayload;

    const projectName = project.startsWith("/") ? project : `/${project}`;
    const displayName = projectName.slice(1);

    // ─── Step 1: Set status to generating ───
    await context.run("set-generating", async () => {
      await setCodeDocs(projectName, {
        project: projectName,
        generatedAt: new Date().toISOString(),
        boxId: "",
        previewUrl: "",
        fileCount: 0,
        status: "generating",
        repoUrl,
        branch,
      });
    });

    // ─── Step 2: Create webhook + call parser ───
    const webhook = await context.createWebhook("parser-done");

    await context.run("call-parser", async () => {
      const response = await fetch(`${PARSER_API_URL}/api/codedocs/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PARSER_API_TOKEN}`,
        },
        body: JSON.stringify({
          project: projectName,
          email,
          repoUrl,
          webhookUrl: webhook.webhookUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Parser returned ${response.status}: ${await response.text()}`
        );
      }
    });

    // ─── Step 3: Wait for parser to finish (up to 1h) ───
    const webhookResponse = await context.waitForWebhook(
      "wait-parser",
      webhook,
      "1h"
    );

    if (webhookResponse.timeout) {
      throw new Error("Parser timed out after 1 hour");
    }

    const result = (await webhookResponse.request.json()) as ParserWebhookResult;

    if (result.status === "failed") {
      throw new Error("Parser reported generation failed");
    }

    // ─── Step 4: Update Redis with result ───
    await context.run("update-redis", async () => {
      await setCodeDocs(projectName, {
        project: projectName,
        generatedAt: new Date().toISOString(),
        boxId: result.boxId || "",
        previewUrl: result.previewUrl || "",
        fileCount: result.fileCount || 0,
        prUrl: result.prUrl,
        status: "ready",
        repoUrl,
        branch,
      });
    });

    // ─── Step 5: Send email via Resend ───
    await context.api.resend.call("send-email", {
      token: process.env.RESEND_API_KEY!,
      body: {
        from: "Context7 Wiki <no-reply@context7.com>",
        to: email,
        subject: `Documentation ready: ${displayName}`,
        html: emailTemplate(
          displayName,
          result.previewUrl || `https://wiki.context7.com/${displayName}`,
          result.fileCount || 0
        ),
      },
    });
  },
  {
    failureFunction: async ({ context }) => {
      const { project, repoUrl, branch } =
        context.requestPayload as WorkflowPayload;
      const projectName = project.startsWith("/") ? project : `/${project}`;

      await setCodeDocs(projectName, {
        project: projectName,
        generatedAt: new Date().toISOString(),
        boxId: "",
        previewUrl: "",
        fileCount: 0,
        status: "failed",
        repoUrl,
        branch: branch || "main",
      });
    },
  }
);

// ─── Email Template ───

function emailTemplate(
  projectName: string,
  wikiUrl: string,
  fileCount: number
): string {
  const [org, repo] = projectName.split("/");
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
      <a href="${wikiUrl}" style="display:inline-block;padding:10px 24px;background:#0d9373;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
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
