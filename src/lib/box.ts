import { Box } from "@upstash/box";
import { getCodeDocs, setCodeDocs } from "./redis";

/**
 * Ensures a Box is running, serving on port 3000, and has a valid preview URL.
 * Resumes if paused, restarts serve if needed, re-creates preview if expired.
 * Updates Redis with new preview URL if it changed.
 * Returns the working preview URL, or null if recovery fails.
 */
export async function ensureBoxRunning(boxId: string, projectName: string): Promise<string | null> {
  try {
    const box = await Box.get(boxId);
    const { status } = await box.getStatus();

    if (status === "paused") {
      await box.resume();
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Check if serve is running
    const health = await box.exec.command(
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000"'
    );

    if (health.result.trim() !== "200") {
      // Restart serve
      const outDir = await box.exec.command(
        "find /workspace/home -name out -type d -maxdepth 3 2>/dev/null | head -1"
      );
      const dir = outDir.result.trim();
      if (!dir) return null;

      const parentDir = dir.replace(/\/out$/, "");
      await box.exec.command(`pkill -f serve 2>/dev/null || true`);
      await box.exec.command(
        `cd ${parentDir} && nohup sh -c 'while true; do npx -y serve out -p 3000 2>&1; sleep 1; done' > /tmp/serve.log 2>&1 &`
      );
      await new Promise((r) => setTimeout(r, 5000));

      const recheck = await box.exec.command(
        'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/'
      );
      if (recheck.result.trim() !== "200") return null;
    }

    // Re-create preview URL (it expires when Box pauses)
    const preview = await box.getPreviewUrl(3000);

    // Update Redis if preview URL changed
    const codeDocs = await getCodeDocs(projectName);
    if (codeDocs && codeDocs.previewUrl !== preview.url) {
      await setCodeDocs(projectName, { ...codeDocs, previewUrl: preview.url });
    }

    return preview.url;
  } catch {
    return null;
  }
}
