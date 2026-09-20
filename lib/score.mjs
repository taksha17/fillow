import { jaccardSimilarity } from "./similarity.mjs";
import { detectAts } from "./ats.mjs";
import { greenhouseJobMatchesUsSearch } from "./location.mjs";

const POSITIVE_SKILLS = [
  "python", "machine learning", "ml", "deep learning", "llm", "rag", "nlp",
  "xgboost", "pytorch", "tensorflow", "kafka", "aws", "kubernetes", "docker",
  "sql", "data pipeline", "etl", "fastapi", "backend", "api", "langchain",
  "embeddings", "pandas", "spark", "java", "go", "react", "typescript",
  "terraform", "ansible", "prometheus", "grafana", "elasticsearch", "redis",
  "postgresql", "mysql", "mongodb", "snowflake", "databricks", "spark",
  "airflow", "dbt", "pulsar", "flink", "ray", "vllm", "huggingface",
];

const TIER1_COMPANIES = new Set([
  "google", "meta", "apple", "amazon", "microsoft", "netflix", "openai",
  "anthropic", "databricks", "snowflake", "stripe", "uber", "airbnb",
  "spacex", "palantir", "scale", "anduril", "cerebras", "groq",
]);

const TIER2_COMPANIES = new Set([
  "datadog", "hashicorp", "confluent", "mongodb", "redis", "elastic",
  "cockroachdb", "planetscale", "neon", "supabase", "vercel", "linear",
  "notion", "figma", "replit", "temporal", "cohere", "perplexity",
  "huggingface", "weaviate", "pinecone", "chroma", "lancedb",
]);

function norm(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ");
}

function getCompanyTier(company) {
  const c = norm(company);
  if (TIER1_COMPANIES.has(c)) return 2;
  if (TIER2_COMPANIES.has(c)) return 1;
  return 0;
}

function estimateJobAge(job) {
  if (job.posted_at) {
    const posted = new Date(job.posted_at);
    const now = new Date();
    return Math.floor((now - posted) / (1000 * 60 * 60 * 24));
  }
  return null;
}

function hasSalaryInfo(description) {
  const blob = norm(description);
  const salaryPatterns = [
    /\$\d{2,3}k\s*[-–]\s*\$\d{2,3}k/,
    /\$\d{2,3}\s*[-–]\s*\$\d{2,3}/,
    /salary.*\$\d+/i,
    /compensation.*\$\d+/i,
    /pay.*\$\d+/i,
    /base.*\$\d+/i,
    /\d{2,3}k\s*[-–]\s*\d{2,3}k/,
  ];
  return salaryPatterns.some(p => p.test(blob));
}

export function scoreJob(job, targets, candidateProfile = {}) {
  const blob = norm(`${job.title} ${job.company} ${job.location} ${job.description}`);
  for (const bad of targets.exclude_keywords || []) {
    if (bad && blob.includes(bad.toLowerCase())) return 0;
  }
  let score = 0;
  const title = norm(job.title);
  let titleHits = 0;
  for (const kw of targets.keywords || []) {
    const k = kw.toLowerCase();
    if (title.includes(k)) {
      score += 22;
      titleHits += 1;
    } else if (blob.includes(k)) {
      score += 6;
    }
  }
  if (titleHits) score += 15;
  if (titleHits && !String(job.description || "").trim()) score += 5;
  if (titleHits) score = Math.max(score, 78);
  const hits = POSITIVE_SKILLS.filter((s) => blob.includes(s)).length;
  score += Math.min(35, hits * 2.5);
  const loc = norm(job.location);
  if (targets.remote_ok && ["remote", "anywhere", "united states", "usa"].some((x) => loc.includes(x))) {
    score += 8;
  }
  if (detectAts(job) === "greenhouse" && greenhouseJobMatchesUsSearch(job, candidateProfile)) {
    score += 6;
  }

  const companyTier = getCompanyTier(job.company);
  score += companyTier * 5;

  const jobAge = estimateJobAge(job);
  if (jobAge !== null) {
    if (jobAge <= 7) score += 5;
    else if (jobAge <= 30) score += 2;
    else if (jobAge <= 60) score -= 3;
    else score -= 10;
  }

  const similarity = jaccardSimilarity(
    `${candidateProfile.summary || ''} ${(candidateProfile.skills || []).join(' ')}`,
    `${job.title} ${job.description} ${job.company}`
  );
  score += Math.round(similarity * 20);

  const skillOverlap = (candidateProfile.skills || []).filter(s =>
    blob.includes(s.toLowerCase())
  ).length;
  score += Math.min(15, skillOverlap * 2);

  if (hasSalaryInfo(job.description)) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function legitimacyGate(job, cfg = {}) {
  const blob = norm(`${job.title} ${job.description} ${job.company}`);
  const flags = [];
  if (/\brepost(ed)?\b/.test(blob)) flags.push("repost");
  if (/\bno salary|compensation not|pay not disclosed/.test(blob) && /\burgent|immediate start/.test(blob)) {
    flags.push("urgency_without_comp");
  }
  const jobAge = estimateJobAge(job);
  if (jobAge !== null && jobAge > 90) flags.push("stale_posting");
  if (/\bcommission.only|commission.only|equity.only\b/.test(blob)) flags.push("no_base_salary");
  if (/\bfake|scam|test.posting|sample.posting\b/.test(blob)) flags.push("suspicious");
  if (!hasSalaryInfo(job.description) && /\burgent|asap|immediate|urgent/.test(blob)) {
    flags.push("urgency_no_salary");
  }
  const descLen = String(job.description || "").trim().length;
  if (cfg.minDescriptionLength && descLen > 0 && descLen < cfg.minDescriptionLength) flags.push("description_too_short");
  if (descLen === 0) flags.push("no_description_scraped");

  return { ok: flags.filter(f => f !== "no_description_scraped" && f !== "description_too_short").length === 0, flags };
}

export function rankJobs(jobs, targets, candidateProfile = {}) {
  return jobs
    .map(job => ({ ...job, match_score: scoreJob(job, targets, candidateProfile) }))
    .sort((a, b) => b.match_score - a.match_score);
}