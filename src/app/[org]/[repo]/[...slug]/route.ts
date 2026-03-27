import { getCodeDocs } from "@/lib/redis";
import { ensureBoxRunning } from "@/lib/box";
import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies sub-paths to the Box preview.
 * wiki.context7.com/upstash/ratelimit-js/docs/algorithms
 *   → proxied to https://{BOX}-3000.preview.box.upstash.com/docs/algorithms
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ org: string; repo: string; slug: string[] }> }
) {
  const { org, repo, slug } = await params;
  const projectName = `/${org}/${repo}`;
  const codeDocs = await getCodeDocs(projectName);

  if (!codeDocs || codeDocs.status !== "ready" || !codeDocs.previewUrl) {
    return NextResponse.redirect(new URL(`/${org}/${repo}`, request.url));
  }

  const proxyPath = `/${slug.join("/")}`;
  const targetUrl = `${codeDocs.previewUrl}${proxyPath}`;

  try {
    const proxyResponse = await fetch(targetUrl, {
      headers: { Accept: request.headers.get("Accept") || "*/*" },
    });

    if (!proxyResponse.ok && [404, 502, 503].includes(proxyResponse.status)) {
      if (codeDocs.boxId) {
        ensureBoxRunning(codeDocs.boxId, projectName).catch(() => {});
      }
      return renderLoadingPage(org, repo);
    }

    const contentType = proxyResponse.headers.get("Content-Type") || "text/html";
    const body = await proxyResponse.arrayBuffer();

    if (contentType.includes("text/html")) {
      let html = new TextDecoder().decode(body);
      const origin = codeDocs.previewUrl.replace(/\/$/, "");
      html = html.replace(/(["'(])\/_next\//g, `$1${origin}/_next/`);
      html = html.replace(/href="\/(docs\/[^"]*?)"/g, `href="/${org}/${repo}/$1"`);
      return new NextResponse(html, {
        status: proxyResponse.status,
        headers: { "Content-Type": "text/html", "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    }

    return new NextResponse(body, {
      status: proxyResponse.status,
      headers: { "Content-Type": contentType, "Cache-Control": "public, s-maxage=3600" },
    });
  } catch {
    // Network error — Box likely paused
    if (codeDocs.boxId) {
      ensureBoxRunning(codeDocs.boxId, projectName).catch(() => {});
    }
    return renderLoadingPage(org, repo);
  }
}

function renderLoadingPage(org: string, repo: string): NextResponse {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loading | Context7 Wiki</title>
<style>
  *{margin:0;box-sizing:border-box}
  body{background:#09090b;color:#fafafa;font-family:system-ui,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center}
  .spin{width:32px;height:32px;border:2.5px solid rgba(255,255,255,0.05);border-top-color:#3b82f6;border-radius:50%;animation:s 0.7s linear infinite;margin:0 auto 14px}
  @keyframes s{to{transform:rotate(360deg)}}
  p{text-align:center}
  .sub{font-size:13px;color:#71717a;margin-top:6px}
</style></head>
<body>
<div>
  <div class="spin"></div>
  <p>Starting documentation server...</p>
  <p class="sub">Will be ready in a few seconds.</p>
</div>
<script>setTimeout(()=>location.reload(),8000)</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
