import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default redis;

const CODEDOCS_KEY_PREFIX = "#codedocs#";

export interface CodeDocsMetadata {
  project: string;
  generatedAt: string;
  boxId: string;
  previewUrl: string;
  fileCount: number;
  prUrl?: string;
  status: "generating" | "ready" | "failed";
  repoUrl: string;
  branch: string;
}

export async function getCodeDocs(projectName: string): Promise<CodeDocsMetadata | null> {
  return await redis.get<CodeDocsMetadata>(CODEDOCS_KEY_PREFIX + projectName);
}

export async function setCodeDocs(projectName: string, metadata: CodeDocsMetadata): Promise<void> {
  await redis.set(CODEDOCS_KEY_PREFIX + projectName, metadata);
}
