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

// ─── HTML ───

function renderResumingPage(org: string, repo: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${org}/${repo} - Loading | Context7 Wiki</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#09090b;color:#fafafa;font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
  body::before{content:'';position:fixed;inset:0;background-image:
    linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px);
    background-size:64px 64px;pointer-events:none}
  .glow{position:fixed;border-radius:50%;filter:blur(120px);pointer-events:none}
  .g1{width:500px;height:500px;background:#3b82f6;opacity:0.04;top:-200px;right:-100px}
  .g2{width:500px;height:500px;background:#8b5cf6;opacity:0.04;bottom:-200px;left:-100px}
  .page{position:relative;z-index:1;width:100%;max-width:460px;padding:40px 24px;text-align:center}
  .logo{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:28px}
  .logo img{height:24px;opacity:0.9}
  .logo span{font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#52525b}
  .title{font-size:32px;font-weight:700;letter-spacing:-0.03em;margin-bottom:6px}
  .title .dim{color:#52525b;font-weight:500}
  .card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:28px 24px;margin-top:36px}
  .spin{width:36px;height:36px;border:2.5px solid rgba(255,255,255,0.05);border-top-color:#3b82f6;border-radius:50%;animation:s 0.7s linear infinite;margin:0 auto 16px}
  @keyframes s{to{transform:rotate(360deg)}}
  .msg{font-size:15px;font-weight:500;margin-bottom:8px}
  .sub{font-size:13px;color:#71717a;line-height:1.5}
</style></head>
<body>
<div class="glow g1"></div>
<div class="glow g2"></div>
<div class="page">
  <div class="logo"><img src="/context7-logo-emerald.svg" alt="Context7"><span>Wiki</span></div>
  <h1 class="title"><span class="dim">${org} / </span>${repo}</h1>
  <div class="card">
    <div class="spin"></div>
    <p class="msg">Starting documentation server...</p>
    <p class="sub">The server was paused to save resources. It will be ready in a few seconds.</p>
  </div>
</div>
<script>setTimeout(()=>location.reload(),8000)</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}


function renderWaitingPage(org: string, repo: string, status?: string, repoUrl?: string): NextResponse {
  const isGenerating = status === "generating";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${org}/${repo} - Context7 Wiki</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#09090b;color:#fafafa;font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
  body::before{content:'';position:fixed;inset:0;background-image:
    linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px);
    background-size:64px 64px;pointer-events:none}
  .glow{position:fixed;border-radius:50%;filter:blur(120px);pointer-events:none}
  .g1{width:500px;height:500px;background:#3b82f6;opacity:0.04;top:-200px;right:-100px}
  .g2{width:500px;height:500px;background:#8b5cf6;opacity:0.04;bottom:-200px;left:-100px}
  .page{position:relative;z-index:1;width:100%;max-width:460px;padding:40px 24px}
  .header{text-align:center;margin-bottom:36px}
  .logo{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:28px}
  .logo img{height:24px;opacity:0.9}
  .logo span{font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#52525b}
  .title{font-size:32px;font-weight:700;letter-spacing:-0.03em;margin-bottom:6px}
  .title .dim{color:#52525b;font-weight:500}
  .desc{font-size:15px;color:#52525b}
  .card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:28px 24px;transition:border-color 0.3s}
  .card-title{font-size:15px;font-weight:600;margin-bottom:8px}
  .card-desc{font-size:13.5px;color:#71717a;line-height:1.65;margin-bottom:18px}
  .badge{display:flex;align-items:center;gap:8px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.12);border-radius:8px;padding:9px 14px;margin-bottom:18px}
  .badge-dot{width:5px;height:5px;border-radius:50%;background:#3b82f6;flex-shrink:0}
  .badge span{font-size:13px;color:#93c5fd}
  .input-wrap{position:relative;margin-bottom:10px}
  .input-wrap svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:#3f3f46}
  input{width:100%;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:11px 14px 11px 40px;color:#fafafa;font-size:13.5px;font-family:inherit;outline:none;transition:all 0.2s}
  input:focus{border-color:rgba(59,130,246,0.35);box-shadow:0 0 0 3px rgba(59,130,246,0.06)}
  input::placeholder{color:#3f3f46}
  button{width:100%;background:#fafafa;border:none;border-radius:10px;padding:11px 20px;color:#09090b;font-size:13.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.15s}
  button:hover{background:#d4d4d8;transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,0.4)}
  button:active{transform:translateY(0)}
  button:disabled{background:#27272a;color:#52525b;cursor:not-allowed;transform:none;box-shadow:none}
  .spin-wrap{display:flex;flex-direction:column;align-items:center;gap:16px;padding:12px 0}
  .spin{width:36px;height:36px;border:2.5px solid rgba(255,255,255,0.05);border-top-color:#3b82f6;border-radius:50%;animation:s 0.7s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  .ok-wrap{display:flex;flex-direction:column;align-items:center;gap:14px;padding:12px 0}
  .ok-icon{width:44px;height:44px;border-radius:50%;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center}
  .ok-icon svg{color:#22c55e}
  .err{background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.12);border-radius:8px;padding:9px 14px;margin-bottom:10px;font-size:13px;color:#fca5a5;display:none}
  .foot{text-align:center;margin-top:28px}
  .foot a{font-size:12px;color:#3f3f46;text-decoration:none;transition:color 0.2s}
  .foot a:hover{color:#a1a1aa}
</style></head>
<body>
<div class="glow g1"></div>
<div class="glow g2"></div>
<div class="page">
  <div class="header">
    <div class="logo">
      <img src="/context7-logo-emerald.svg" alt="Context7">
      <span>Wiki</span>
    </div>
    <h1 class="title"><span class="dim">${org} / </span>${repo}</h1>
    <p class="desc">Code Documentation</p>
  </div>
  <div class="card" id="card">
    ${isGenerating ? `
      <div class="spin-wrap">
        <div class="spin"></div>
        <p style="font-size:15px;font-weight:500">Generating documentation...</p>
        <p style="font-size:13px;color:#71717a;text-align:center;max-width:260px;line-height:1.5">Analyzing source code and building docs. This usually takes 15-30 minutes.</p>
      </div>
    ` : `
      <p class="card-title">Generate documentation</p>
      <p class="card-desc">AI-powered documentation hasn't been created for this repository yet. We'll analyze the source code and generate comprehensive docs.</p>
      <div class="badge"><div class="badge-dot"></div><span>Takes 15-30 minutes to generate</span></div>
      <div id="err" class="err"></div>
      <form id="f">
        <div class="input-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <input type="email" id="em" placeholder="your@email.com" required>
        </div>
        <button type="submit" id="btn">Generate documentation</button>
      </form>
    `}
  </div>
  <div class="foot"><a href="https://context7.com/${org}/${repo}">${org}/${repo} on Context7</a></div>
</div>
${isGenerating ? `<script>setTimeout(()=>location.reload(),30000)</script>` : `
<script>
document.getElementById('f')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const b=document.getElementById('btn'),err=document.getElementById('err'),em=document.getElementById('em').value;
  b.disabled=true;b.textContent='Generating...';err.style.display='none';
  try{
    const r=await fetch('/${org}/${repo}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,repoUrl:'${repoUrl}'})});
    if(!r.ok){const d=await r.json();throw new Error(d.error||'Failed');}
    document.getElementById('card').innerHTML='<div class="ok-wrap"><div class="ok-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><p style="font-size:15px;font-weight:500">Generation started</p><p style="font-size:13px;color:#71717a;text-align:center;max-width:260px;line-height:1.5">We\\x27ll notify you at <strong style="color:#fafafa">'+em+'</strong> when your docs are ready.</p></div>';
  }catch(e){err.textContent=e.message;err.style.display='block';b.disabled=false;b.textContent='Generate documentation';}
});
</script>`}
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
