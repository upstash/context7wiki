import { getCodeDocs } from "@/lib/redis";
import { ensureBoxRunning } from "@/lib/box";
import { Client } from "@upstash/workflow";
import { NextRequest, NextResponse } from "next/server";

/**
 * Handles wiki.context7.com/{org}/{repo}
 * - Docs ready + Box alive → proxy to Fumadocs
 * - Docs ready + Box stopped → show loading, resume Box in background, auto-refresh
 * - No docs → show waiting page with generate form
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ org: string; repo: string }> }
) {
  const { org, repo } = await params;
  const projectName = `/${org}/${repo}`;
  const codeDocs = await getCodeDocs(projectName);

  if (codeDocs?.status === "ready" && codeDocs.previewUrl && codeDocs.boxId) {
    // Try to proxy
    const proxyResult = await proxyToBox(request, codeDocs.previewUrl, "/docs", org, repo);
    const isUnavailable = proxyResult.status === 502
      || proxyResult.status === 404
      || proxyResult.headers.get("x-box-unavailable") === "true";

    if (isUnavailable) {
      // Box is down or preview expired — resume + re-create preview in background
      ensureBoxRunning(codeDocs.boxId, projectName).catch(() => {});
      return renderResumingPage(org, repo);
    }

    return proxyResult;
  }

  const repoUrl = codeDocs?.repoUrl || `https://github.com/${org}/${repo}`;
  return renderWaitingPage(org, repo, codeDocs?.status, repoUrl);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ org: string; repo: string }> }
) {
  const { org, repo } = await params;
  const projectName = `/${org}/${repo}`;

  try {
    const body = await request.json();
    const { email, repoUrl } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const existing = await getCodeDocs(projectName);
    if (existing?.status === "ready") {
      return NextResponse.json({ status: "ready", previewUrl: existing.previewUrl });
    }
    if (existing?.status === "generating") {
      return NextResponse.json({ status: "generating", message: "Already in progress." });
    }

    const finalRepoUrl = repoUrl || `https://github.com/${org}/${repo}`;

    // Trigger the workflow
    const client = new Client({ token: process.env.QSTASH_TOKEN! });
    const baseUrl = process.env.UPSTASH_WORKFLOW_URL || `https://${process.env.VERCEL_URL}`;

    await client.trigger({
      url: `${baseUrl}/api/workflow`,
      body: {
        project: projectName,
        email,
        repoUrl: finalRepoUrl,
      },
    });

    return NextResponse.json({
      status: "generating",
      message: "Documentation generation started. You'll be emailed when it's ready.",
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Proxy ───

async function proxyToBox(
  request: NextRequest,
  previewUrl: string,
  path: string,
  org: string,
  repo: string,
): Promise<NextResponse> {
  const targetUrl = `${previewUrl}${path}`;

  try {
    const proxyResponse = await fetch(targetUrl, {
      headers: {
        Accept: request.headers.get("Accept") || "*/*",
      },
    });

    if (!proxyResponse.ok && (proxyResponse.status === 502 || proxyResponse.status === 503)) {
      return new NextResponse(null, {
        status: 502,
        headers: { "x-box-unavailable": "true" },
      });
    }

    const contentType = proxyResponse.headers.get("Content-Type") || "text/html";
    const body = await proxyResponse.arrayBuffer();

    if (contentType.includes("text/html")) {
      let html = new TextDecoder().decode(body);
      const previewOrigin = previewUrl.replace(/\/$/, "");
      html = html.replace(/(["'(])\/_next\//g, `$1${previewOrigin}/_next/`);
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
    // Network error — Box is likely paused/down
    return new NextResponse(null, {
      status: 502,
      headers: { "x-box-unavailable": "true" },
    });
  }
}

// ─── Shared Styles ───

const BASE_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0c;color:#fafafa;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.noise{position:fixed;inset:0;pointer-events:none;opacity:0.03;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.glow{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:700px;height:500px;border-radius:50%;background:rgba(16,185,129,0.04);filter:blur(150px);pointer-events:none}
.page{position:relative;z-index:1;width:100%;max-width:480px;padding:40px 24px;text-align:center}
.logo{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:32px}
.logo img{height:22px;opacity:0.75}
.logo-sep{width:1px;height:16px;background:rgba(255,255,255,0.08)}
.logo span{font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;color:rgba(16,185,129,0.6)}
.repo{font-size:14px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.25);margin-bottom:4px;letter-spacing:-0.01em}
.repo b{color:rgba(255,255,255,0.85);font-weight:600}
h1{font-size:28px;font-weight:700;letter-spacing:-0.03em;color:rgba(255,255,255,0.9);margin-bottom:6px;line-height:1.2}
.sub{font-size:13px;color:rgba(255,255,255,0.25);line-height:1.6}
.card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:16px;padding:28px 24px;margin-top:28px;backdrop-filter:blur(8px)}
.foot{margin-top:24px}
.foot a{font-size:11px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.12);text-decoration:none;letter-spacing:0.02em;transition:color 0.2s}
.foot a:hover{color:rgba(255,255,255,0.3)}
.spin{width:32px;height:32px;border:2px solid rgba(255,255,255,0.04);border-top-color:rgba(16,185,129,0.7);border-radius:50%;animation:s 0.7s linear infinite;margin:0 auto 16px}
@keyframes s{to{transform:rotate(360deg)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fade{animation:fadeIn 0.5s ease-out both}
.fade-d1{animation-delay:0.1s}
.fade-d2{animation-delay:0.2s}
.fade-d3{animation-delay:0.3s}
`;

const PAGE_HEAD = (title: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${BASE_STYLES}`;

const PAGE_BODY_START = `</style></head><body>
<div class="noise"></div>
<div class="glow"></div>
<div class="page">`;

const PAGE_END = `</div></body></html>`;

function logoHtml(): string {
  return `<div class="logo fade">
  <img src="/context7-logo-emerald.svg" alt="Context7">
  <div class="logo-sep"></div>
  <span>Wiki</span>
</div>`;
}

// ─── Pages ───

function renderResumingPage(org: string, repo: string): NextResponse {
  const html = `${PAGE_HEAD(`${org}/${repo} - Loading | Context7 Wiki`)}
${PAGE_BODY_START}
  ${logoHtml()}
  <p class="repo fade fade-d1">${org} / <b>${repo}</b></p>
  <div class="card fade fade-d2">
    <div class="spin"></div>
    <p style="font-size:14px;font-weight:500;margin-bottom:6px">Waking up server...</p>
    <p class="sub">Paused to save resources. Ready in a few seconds.</p>
  </div>
<script>setTimeout(()=>location.reload(),8000)</script>
${PAGE_END}`;

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

function renderWaitingPage(org: string, repo: string, status?: string, repoUrl?: string): NextResponse {
  const isGenerating = status === "generating";

  const extraStyles = `
  .badge{display:flex;align-items:center;gap:8px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.1);border-radius:8px;padding:8px 12px;margin-bottom:16px}
  .badge-dot{width:5px;height:5px;border-radius:50%;background:rgb(16,185,129);flex-shrink:0;box-shadow:0 0 8px rgba(16,185,129,0.4)}
  .badge span{font-size:12px;font-family:'JetBrains Mono',monospace;color:rgba(16,185,129,0.7)}
  .input-wrap{position:relative;margin-bottom:10px}
  .input-wrap .prompt{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-family:'JetBrains Mono',monospace;font-size:13px;color:rgba(255,255,255,0.15);pointer-events:none}
  input{width:100%;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 14px 12px 30px;color:#fafafa;font-size:13px;font-family:'JetBrains Mono',monospace;outline:none;transition:all 0.2s}
  input:focus{border-color:rgba(16,185,129,0.3);box-shadow:0 0 0 3px rgba(16,185,129,0.05),0 0 20px rgba(16,185,129,0.03)}
  input::placeholder{color:rgba(255,255,255,0.15)}
  button{width:100%;background:rgb(16,185,129);border:none;border-radius:10px;padding:12px 20px;color:#0a0a0c;font-size:13px;font-weight:600;font-family:'DM Sans',system-ui,sans-serif;cursor:pointer;transition:all 0.15s}
  button:hover{background:rgb(52,211,153);box-shadow:0 0 24px rgba(16,185,129,0.15)}
  button:active{transform:scale(0.98)}
  button:disabled{background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.2);cursor:not-allowed;box-shadow:none;transform:none}
  .err{background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.1);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;font-family:'JetBrains Mono',monospace;color:#fca5a5;display:none}
  .ok-icon{width:48px;height:48px;border-radius:50%;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
  .ok-icon svg{color:rgb(16,185,129)}
  `;

  const html = `${PAGE_HEAD(`${org}/${repo} - Context7 Wiki`)}
  ${extraStyles}
${PAGE_BODY_START}
  ${logoHtml()}
  <p class="repo fade fade-d1">${org} / <b>${repo}</b></p>

  <div class="card fade fade-d2" id="card">
    ${isGenerating ? `
      <div class="spin"></div>
      <p style="font-size:14px;font-weight:500;margin-bottom:6px">Analyzing source code...</p>
      <p class="sub">Building architecture docs, API reference, and guides.<br>Usually takes 15-30 minutes.</p>
    ` : `
      <h1 style="font-size:18px;margin-bottom:6px">Generate docs</h1>
      <p class="sub" style="margin-bottom:16px">We'll analyze the source code and build comprehensive documentation with architecture overviews, API reference, and guides.</p>
      <div class="badge"><div class="badge-dot"></div><span>~15 min to generate</span></div>
      <div id="err" class="err"></div>
      <form id="f">
        <div class="input-wrap">
          <span class="prompt">@</span>
          <input type="email" id="em" placeholder="your@email.com" required>
        </div>
        <button type="submit" id="btn">Generate documentation</button>
      </form>
    `}
  </div>

  <div class="foot fade fade-d3"><a href="https://context7.com/${org}/${repo}">${org}/${repo} on Context7</a></div>
${isGenerating ? `<script>setTimeout(()=>location.reload(),30000)</script>` : `
<script>
document.getElementById('f')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const b=document.getElementById('btn'),err=document.getElementById('err'),em=document.getElementById('em').value;
  b.disabled=true;b.textContent='Starting...';err.style.display='none';
  try{
    const r=await fetch('/${org}/${repo}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,repoUrl:'${repoUrl}'})});
    if(!r.ok){const d=await r.json();throw new Error(d.error||'Failed');}
    document.getElementById('card').innerHTML='<div class="ok-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><p style="font-size:15px;font-weight:500;margin-bottom:6px">Generation started</p><p class="sub">We\\x27ll email <strong style="color:rgba(255,255,255,0.7)">'+em+'</strong> when ready.</p>';
  }catch(e){err.textContent=e.message;err.style.display='block';b.disabled=false;b.textContent='Generate documentation';}
});
</script>`}
${PAGE_END}`;

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
}
