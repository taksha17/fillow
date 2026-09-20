import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'have', 'will', 'you',
  'your', 'our', 'are', 'not', 'to', 'of', 'in', 'on', 'or', 'a', 'an',
  'required', 'requirements', 'qualifications', 'must', 'have', 'experience',
  'years', 'year', 'senior', 'junior', 'entry', 'level', 'minimum', 'preferred',
  'strong', 'excellent', 'proven', 'ability', 'able', 'knowledge', 'understanding',
  'familiarity', 'exposure', 'background', 'skills', 'skill', 'communication',
  'team', 'teams', 'work', 'working', 'deep', 'interest', 'genuine', 'solid',
  'comfortable', 'passion', 'passionate', 'track', 'record', 'real', 'bonus',
  'plus', 'hands', 'proficiency', 'fluency', 'expertise', 'demonstrated',
  'extensive', 'practical', 'good', 'great', 'clear', 'candidates', 'candidate',
  'applicants', 'applicant', 'ideal', 'successful', 'degree', 'bachelor',
  'master', 'phd', 'diploma', 'certification', 'certificate',
]);

const SKILL_ALIASES = new Map([
  ['k8s', 'kubernetes'],
  ['kubernetes', 'kubernetes'],
  ['postgres', 'postgresql'],
  ['postgresql', 'postgresql'],
  ['go', 'golang'],
  ['golang', 'golang'],
  ['reactjs', 'react'],
  ['react.js', 'react'],
  ['nextjs', 'next.js'],
  ['next.js', 'next.js'],
  ['vuejs', 'vue'],
  ['vue.js', 'vue'],
  ['nodejs', 'node.js'],
  ['node.js', 'node.js'],
  ['ts', 'typescript'],
  ['js', 'javascript'],
  ['py', 'python'],
  ['ml', 'machine learning'],
  ['ai', 'artificial intelligence'],
  ['llm', 'large language model'],
  ['rag', 'retrieval augmented generation'],
  ['ci/cd', 'cicd'],
  ['cicd', 'cicd'],
  ['ci cd', 'cicd'],
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud platform'],
  ['azure', 'microsoft azure'],
]);

function canonicalize(skill) {
  const normalized = skill.toLowerCase().trim();
  return SKILL_ALIASES.get(normalized) || normalized;
}

function tokenize(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .match(/[\p{L}\p{N}+#./-]+/gu)
      ?.map(token => token.replace(/^[./-]+|[./-]+$/g, ''))
      .map(canonicalize)
      .filter(token => token && (token.length > 1 || /\d/.test(token)) && !STOP_WORDS.has(token)) || [],
  );
}

export function jaccardSimilarity(left, right) {
  const a = left instanceof Set ? left : tokenize(left);
  const b = right instanceof Set ? right : tokenize(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function cosineSimilarity(left, right) {
  const a = left instanceof Set ? left : tokenize(left);
  const b = right instanceof Set ? right : tokenize(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let dot = 0;
  for (const token of a) if (b.has(token)) dot++;
  return dot / Math.sqrt(a.size * b.size);
}

export function skillOverlapScore(job, candidateSkills) {
  const jobTokens = tokenize(`${job.title} ${job.description} ${job.company}`);
  if (!jobTokens.size) return 0;
  const candidateSet = new Set(candidateSkills.map(canonicalize));
  let matches = 0;
  for (const token of jobTokens) if (candidateSet.has(token)) matches++;
  return matches / jobTokens.size;
}

export function extractSkillTokens(text) {
  return [...tokenize(text)];
}

export function computeSimilarityMatrix(jobs, candidateProfile) {
  const candidateSkills = candidateProfile.skills || [];
  const profileText = `${candidateProfile.summary || ''} ${candidateSkills.join(' ')}`;
  return jobs.map(job => ({
    ...job,
    similarity: jaccardSimilarity(profileText, `${job.title} ${job.description} ${job.company}`),
    skillOverlap: skillOverlapScore(job, candidateSkills),
  }));
}