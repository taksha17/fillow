import { chat, llmAvailable } from "./llm.mjs";
import { ensureJobDescription } from "./ats.mjs";
import { extractSkillTokens } from "./similarity.mjs";

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'have', 'will', 'you',
  'your', 'our', 'are', 'not', 'to', 'of', 'in', 'on', 'or', 'a', 'an',
]);

function tokenize(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .match(/[\p{L}\p{N}+#./-]+/gu)
      ?.map(t => t.replace(/^[./-]+|[./-]+$/g, ''))
      .filter(t => t && t.length > 1 && !STOP_WORDS.has(t)) || [],
  );
}

function containsSkill(blob, tokens, skill) {
  const normalized = String(skill || '').toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.includes(' ')) return blob.includes(normalized);
  return tokens.has(normalized);
}

function detectSeniority(text) {
  const blob = String(text || '').toLowerCase();
  return SENIORITY_SIGNALS.find((signal) => blob.includes(signal)) || null;
}

function groundedValues(values, source) {
  const sourceBlob = String(source || '').toLowerCase();
  const sourceTokens = tokenize(sourceBlob);
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => value && value.length <= 120)
    .filter((value) => {
      const normalized = value.toLowerCase();
      if (sourceBlob.includes(normalized)) return true;
      const valueTokens = tokenize(value);
      if (!valueTokens.size) return false;
      const hits = [...valueTokens].filter((token) => sourceTokens.has(token)).length;
      return hits >= Math.max(1, Math.ceil(valueTokens.size * 0.6));
    });
}

function mergeValues(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback].filter((value) => {
    const key = String(value || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SKILL_KEYWORDS = new Set([
  'python', 'java', 'go', 'rust', 'typescript', 'javascript', 'sql', 'c++', 'c#', 'ruby',
  'react', 'vue', 'angular', 'next.js', 'node.js', 'django', 'flask', 'fastapi', 'spring',
  'tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy', 'spark', 'hadoop', 'kafka',
  'docker', 'kubernetes', 'terraform', 'ansible', 'aws', 'gcp', 'azure', 'linux',
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb',
  'graphql', 'rest', 'grpc', 'microservices', 'api', 'git', 'ci/cd', 'jenkins', 'github',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'llm', 'rag', 'embeddings',
  'data science', 'data engineering', 'etl', 'data pipeline', 'statistics', 'matplotlib',
  'streaming', 'real-time', 'low-latency', 'performance', 'scalability', 'distributed',
  'agile', 'scrum', 'devops', 'sre', 'monitoring', 'observability', 'prometheus', 'grafana',
  'airflow', 'dbt', 'clickhouse', 'snowflake', 'databricks', 'bigquery', 'redshift',
]);

const SENIORITY_SIGNALS = [
  'senior', 'staff', 'principal', 'lead', 'architect', 'manager', 'director', 'vp',
  'head of', 'chief', 'distinguished', 'fellow', 'iii', '2', 'level ii', 'level 2',
  'mid-level', 'mid level', 'junior', 'entry', 'associate', 'intern', 'entry-level',
];

export function fallbackAnalyze(description, company = '') {
  const blob = `${description || ''} ${company || ''}`.toLowerCase();
  const tokens = tokenize(blob);
  const skills = [...SKILL_KEYWORDS].filter(s => tokens.has(s));
  const seniority = SENIORITY_SIGNALS.filter(s => blob.includes(s));
  return {
    required_skills: skills.slice(0, 15),
    nice_to_have_skills: [],
    responsibilities: [],
    tech_stack: skills.slice(0, 10),
    seniority_level: seniority[0] || null,
    company_context: '',
    key_requirements: [],
    raw_description: String(description || '').slice(0, 4000),
    token_count: tokens.size,
  };
}

export async function analyzeJD(job, cfg) {
  const sourceJob = await ensureJobDescription(job);
  const description = String(sourceJob?.description || sourceJob?.jd || '').slice(0, 6000);
  const company = String(sourceJob?.company || '');
  const title = String(sourceJob?.title || '');

  if (!description.trim()) {
    return { ...fallbackAnalyze('', company), _source: 'empty' };
  }

  if (!llmAvailable(cfg)) {
    return { ...fallbackAnalyze(description, company), _source: 'fallback' };
  }

  const prompt = `Analyze this job posting and extract structured information in JSON format ONLY (no markdown fences, no commentary).

Job: ${title} at ${company}

Description:
${description}

Return JSON with exactly these fields:
- "required_skills": array of strings — hard requirements (years of experience, must-haves)
- "nice_to_have_skills": array of strings — preferred/bonus qualifications
- "responsibilities": array of strings — main day-to-day duties (bullet-style, short)
- "tech_stack": array of strings — specific technologies, frameworks, tools mentioned
- "seniority_level": string — one of: "entry", "junior", "mid-level", "senior", "staff", "principal", "lead", "manager", "director", "unknown"
- "company_context": string — brief note about company type/size/industry if inferable (e.g. "fintech startup", "enterprise cloud", "AI research lab")
- "key_requirements": array of strings — top 5 most important requirements for this role

If a field has no data, use an empty array or null. Keep strings concise (under 80 chars). Do not invent information not present in the description.`;

  try {
    const result = await chat(
      'You extract structured data from job postings. Reply with ONLY valid JSON matching the schema above. Never invent facts.',
      prompt,
      cfg,
      { temperature: 0.15, maxTokens: 3000, thinking: false },
    );

    const start = result.indexOf('{');
    const end = result.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return { ...fallbackAnalyze(description, company), _source: 'parse-fail' };
    }

    const parsed = JSON.parse(result.slice(start, end + 1));
    return {
      required_skills: Array.isArray(parsed.required_skills) ? parsed.required_skills.filter(Boolean).map(String) : [],
      nice_to_have_skills: Array.isArray(parsed.nice_to_have_skills) ? parsed.nice_to_have_skills.filter(Boolean).map(String) : [],
      responsibilities: Array.isArray(parsed.responsibilities) ? parsed.responsibilities.filter(Boolean).map(String) : [],
      tech_stack: Array.isArray(parsed.tech_stack) ? parsed.tech_stack.filter(Boolean).map(String) : [],
      seniority_level: parsed.seniority_level || null,
      company_context: parsed.company_context || '',
      key_requirements: Array.isArray(parsed.key_requirements) ? parsed.key_requirements.filter(Boolean).map(String) : [],
      raw_description: description,
      token_count: tokenize(description).size,
      _source: 'llm',
    };
  } catch (err) {
    return { ...fallbackAnalyze(description, company), _source: 'error:' + err.message };
  }
}

export function buildRequirementTokens(jdAnalysis) {
  const allReqs = [
    ...(jdAnalysis.required_skills || []),
    ...(jdAnalysis.tech_stack || []),
    ...(jdAnalysis.key_requirements || []),
  ];
  const tokens = new Set();
  for (const req of allReqs) {
    for (const t of extractSkillTokens(req)) {
      tokens.add(t);
    }
  }
  return tokens;
}

export function seniorityBoost(seniorityLevel, candidateYears) {
  const order = ['entry', 'junior', 'mid-level', 'senior', 'staff', 'principal', 'lead', 'manager', 'director'];
  const idx = order.indexOf(String(seniorityLevel || '').toLowerCase());
  if (idx === -1) return 0;
  const candidateLevel = candidateYears <= 1 ? 0 : candidateYears <= 3 ? 1 : candidateYears <= 6 ? 2 : candidateYears <= 10 ? 3 : 4;
  const diff = candidateLevel - idx;
  if (diff >= 0) return Math.min(3, diff * 2);
  return Math.max(-5, diff * 3);
}
