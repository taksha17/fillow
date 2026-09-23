import { jaccardSimilarity } from "./similarity.mjs";
import { detectAts } from "./ats.mjs";
import { greenhouseJobMatchesUsSearch } from "./location.mjs";
import { chat, llmAvailable } from "./llm.mjs";

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

export async function verifyMatchWithNim(job, candidateProfile, cfg) {
  if (!llmAvailable(cfg)) return { verified: false, reason: "no_llm_key" };

  const minScore = cfg.runtime?.min_match_score ?? 78;
  const borderlineRange = cfg.runtime?.nim_verify_borderline_range ?? 10;
  const heuristicScore = job.match_score ?? 0;
  const distanceFromThreshold = Math.abs(heuristicScore - minScore);

  if (distanceFromThreshold > borderlineRange) {
    return { verified: false, reason: "not_borderline", heuristicScore };
  }

  const description = String(job.description || job.jd || "").slice(0, 4000);
  if (!description.trim()) {
    return { verified: false, reason: "no_description", heuristicScore };
  }

  const candidateSummary = `${candidateProfile.summary || ''} ${(candidateProfile.skills || []).join(', ')}`;
  const prompt = `Assess how well this candidate matches the job. Reply with ONLY a JSON object:
{
  "match_score": number (0-100),
  "reasoning": "brief explanation"
}

Candidate: ${candidateSummary}
Years experience: ${candidateProfile.years_experience || "unknown"}
Location: ${candidateProfile.location || "unknown"}

Job: ${job.title} at ${job.company}
Location: ${job.location || "unknown"}

Job Description:
${description}`;

  try {
    const result = await chat(
      "You are a technical recruiter scoring candidate-job fit. Be precise. Reply with ONLY valid JSON.",
      prompt,
      cfg,
      { temperature: 0.15, maxTokens: 500, thinking: false }
    );

    const start = result.indexOf("{");
    const end = result.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return { verified: false, reason: "parse_failed", heuristicScore };
    }

    const parsed = JSON.parse(result.slice(start, end + 1));
    const nimScore = Math.max(0, Math.min(100, Math.round(parsed.match_score || heuristicScore)));
    
    return {
      verified: true,
      heuristicScore,
      nimScore,
      reasoning: parsed.reasoning || "",
      adjustedScore: Math.round((heuristicScore + nimScore) / 2)
    };
  } catch (err) {
    return { verified: false, reason: `error:${err.message}`, heuristicScore };
  }
}

export async function verifyBorderlineJobs(jobs, candidateProfile, cfg) {
  const results = [];
  for (const job of jobs) {
    const result = await verifyMatchWithNim(job, candidateProfile, cfg);
    results.push({ job, ...result });
    if (result.verified && result.adjustedScore !== undefined) {
      job.match_score = result.adjustedScore;
      job._nim_verified = true;
      job._nim_reasoning = result.reasoning;
    }
  }
  return results;
}