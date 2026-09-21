import { writeFileSync } from "node:fs";
import { PATHS, ensureDataDirs } from "./paths.mjs";
import { chat, llmAvailable } from "./llm.mjs";
import { extractSkillTokens } from "./similarity.mjs";

const TONE_PROFILES = {
  optimistic: "confident, enthusiastic, forward-looking",
  professional: "polished, concise, business-appropriate",
  conversational: "warm, authentic, slightly informal",
  direct: "brief, factual, no fluff",
};

function extractJdHighlights(description, maxItems = 3) {
  const text = String(description || "");
  const lines = text.split('\n');
  const highlights = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-*•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const clean = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '');
      if (clean.length > 20 && clean.length < 200) {
        const lower = clean.toLowerCase();
        const isReq = ['experience', 'proficient', 'strong', 'expert', 'knowledge', 'familiar', 'build', 'design', 'develop', 'ship', 'lead', 'own', 'drive'].some(w => lower.includes(w));
        if (isReq) highlights.push(clean);
        if (highlights.length >= maxItems) break;
      }
    }
  }
  return highlights;
}

function detectCompanyTone(company, description) {
  const text = `${company} ${description}`.toLowerCase();
  if (['startup', 'early-stage', 'seed', 'series a', 'fast-paced', 'move fast', 'ship fast'].some(w => text.includes(w))) return 'conversational';
  if (['enterprise', 'fortune', 'compliance', 'security', 'governance', 'regulated'].some(w => text.includes(w))) return 'professional';
  if (['research', 'phd', 'publications', 'academic', 'novel', 'cutting-edge', 'state-of-the-art'].some(w => text.includes(w))) return 'professional';
  return 'optimistic';
}

export function templateCoverLetter(candidate, job, highlights = []) {
  const lines = [
    `Dear ${job.company || "Hiring"} team,`,
    "",
    `I am applying for the ${job.title || "role"} position. I am an AI/ML and software engineer based in ${candidate.location || "the United States"}, currently at ${candidate.current_company || "my current company"}.`,
    "",
  ];
  
  if (highlights.length > 0) {
    lines.push("The role calls for:");
    for (const h of highlights) {
      lines.push(`• ${h}`);
    }
    lines.push("");
    lines.push("My background aligns well:");
    lines.push("• Production Python/ML pipelines, LLM/RAG features, Kafka, Docker/K8s, AWS");
    lines.push("• FastAPI/React full-stack; comfortable with take-home assessments");
    lines.push("• Measurable impact on latency, throughput, and model quality");
    lines.push("");
  } else {
    lines.push("I ship production Python services, data/ML pipelines, and LLM/RAG features with measurable impact. Please see my resume for specific metrics and projects.");
    lines.push("");
  }
  
  lines.push("Thank you for your time.");
  lines.push("");
  lines.push(candidate.full_name || `${candidate.first_name} ${candidate.last_name}`);
  lines.push(candidate.email);
  lines.push(candidate.phone);
  lines.push(candidate.linkedin);
  
  return lines.filter(l => l !== undefined).join("\n");
}

export async function generateCoverLetter(cfg, job) {
  const highlights = extractJdHighlights(job.description);
  const fallback = templateCoverLetter(cfg.candidate, job, highlights);
  
  if (!llmAvailable(cfg)) return fallback;
  
  try {
    const tone = detectCompanyTone(job.company, job.description);
    const toneDesc = TONE_PROFILES[tone] || TONE_PROFILES.optimistic;
    const jdExcerpt = String(job.description || "").slice(0, 2500);
    
    const prompt = `Write a short, honest cover letter (180 words max). 
    Tone: ${toneDesc}.
    Do not invent employers, degrees, or metrics. Plain text only.
    
    Candidate: ${cfg.candidate.full_name}, ${cfg.candidate.location}, ${cfg.candidate.current_company}.
    Years experience: ${cfg.candidate.years_experience}
    Key skills: ${(cfg.candidate.skills || BASE_SKILLS).slice(0, 10).join(', ')}
    
    Job: ${job.title} at ${job.company} (${job.location || ""})
    
    JD highlights to address:
    ${highlights.map(h => `- ${h}`).join('\n') || '(none extracted)'}
    
    JD excerpt:
    ${jdExcerpt}`;
    
    const text = await chat(
      `You write tailored cover letters for a real candidate. Tone: ${toneDesc}. Never invent facts. Match the company's voice.`,
      prompt,
      cfg,
      { temperature: 0.35, maxTokens: 1200, thinking: false }
    );
    
    return (text || fallback).trim();
  } catch (err) {
    console.warn("Cover letter LLM failed:", err.message);
    return fallback;
  }
}

export function writeCoverLetter(text, job = {}) {
  ensureDataDirs();
  const safeId = job.external_id || job.company?.replace(/\s+/g, "-") || "unknown";
  const path = PATHS.coverLetter.replace("cover_letter.txt", `cover_letter-${safeId}.txt`);
  writeFileSync(path, text, "utf8");
  return path;
}

const BASE_SKILLS = [
  "Python", "Machine Learning", "LLM/RAG", "FastAPI", "Kafka", "Docker", "Kubernetes", "AWS",
  "React", "Next.js", "TypeScript", "SQL", "PyTorch", "LangChain", "PostgreSQL", "Redis",
];