import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS, ensureDataDirs } from "./paths.mjs";
import { chat, llmAvailable } from "./llm.mjs";
import { extractSkillTokens } from "./similarity.mjs";

const ENRICH_CACHE = join(PATHS.tailored, "profile-enrich.json");
const CACHE_MS = 24 * 60 * 60 * 1000;
const UA = "fillow-resume/0.1 (personal; +https://github.com)";

const FALLBACK_SKILLS = {
  languages: ["Python", "TypeScript", "JavaScript", "SQL"],
  frameworks: ["React", "Next.js", "FastAPI", "LangChain"],
  tools: ["Git", "Docker", "Kubernetes", "AWS", "Kafka"],
  libraries: ["PyTorch", "pandas"],
};

export function githubLogin(url) {
  const m = String(url || "").match(/github\.com\/([^/?#]+)/i);
  if (!m) return "";
  const login = decodeURIComponent(m[1]);
  if (["orgs", "settings", "topics", "features", "pricing", "about"].includes(login.toLowerCase())) return "";
  return login;
}

export function linkedinSlug(url) {
  const m = String(url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/\/+$/, "") : "";
}

export function parseJsonArray(text) {
  const t = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.map((x) => String(x || "").trim()).filter(Boolean) : null;
  } catch {
    return null;
  }
}

export function relevanceScore(text, tokens) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9.+#]+/)
    .filter(Boolean);
  let n = 0;
  for (const w of words) {
    if (tokens.has(w)) n += 1;
  }
  return n;
}

function claimLines(cfg) {
  const claims = cfg.answer_preferences?.claims || {};
  return Object.values(claims)
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter((v) => v.length > 20)
    .slice(0, 4);
}

function normalizeRole(role) {
  return {
    title: String(role?.title || "").trim(),
    company: String(role?.company || "").trim(),
    location: String(role?.location || "").trim(),
    dates: String(role?.dates || "").trim(),
    bullets: (role?.bullets || []).map((b) => String(b || "").trim()).filter(Boolean),
  };
}

function normalizeProject(project) {
  return {
    name: String(project?.name || project?.title || "").trim(),
    stack: String(project?.stack || "").trim(),
    dates: String(project?.dates || "").trim(),
    url: String(project?.url || "").trim(),
    bullets: (project?.bullets || []).map((b) => String(b || "").trim()).filter(Boolean),
  };
}

function normalizeEdu(row) {
  return {
    school: String(row?.school || "").trim(),
    degree: String(row?.degree || "").trim(),
    location: String(row?.location || "").trim(),
    dates: String(row?.dates || "").trim(),
  };
}

function normalizeSkills(skills) {
  if (!skills || typeof skills !== "object") return { ...FALLBACK_SKILLS };
  const out = {};
  for (const key of ["languages", "frameworks", "tools", "libraries"]) {
    const list = Array.isArray(skills[key]) ? skills[key].map((s) => String(s || "").trim()).filter(Boolean) : [];
    out[key] = list.length ? list : [...(FALLBACK_SKILLS[key] || [])];
  }
  return out;
}

export function baseResumeFromConfig(cfg, extra = {}) {
  const r = cfg.resume || {};
  const candidate = cfg.candidate || {};
  let experience = (r.experience || []).map(normalizeRole).filter((e) => e.company || e.title);
  if (!experience.length && candidate.current_company) {
    experience = [
      normalizeRole({
        title: r.current_title || "",
        company: candidate.current_company,
        location: candidate.location || "",
        dates: "Present",
        bullets: claimLines(cfg),
      }),
    ];
  }
  if (extra.experience?.length) {
    const seen = new Set(experience.map((e) => `${e.company}|${e.title}`.toLowerCase()));
    for (const row of extra.experience) {
      const role = normalizeRole(row);
      const key = `${role.company}|${role.title}`.toLowerCase();
      if (!role.company || seen.has(key)) continue;
      seen.add(key);
      experience.push(role);
    }
  }

  let projects = (r.projects || []).map(normalizeProject).filter((p) => p.name);
  if (extra.projects?.length) {
    const seen = new Set(projects.map((p) => p.name.toLowerCase()));
    for (const row of extra.projects) {
      const project = normalizeProject(row);
      if (!project.name || seen.has(project.name.toLowerCase())) continue;
      seen.add(project.name.toLowerCase());
      projects.push(project);
    }
  }

  let education = (r.education || []).map(normalizeEdu).filter((e) => e.school);
  if (!education.length) {
    education = (candidate.education || []).map(normalizeEdu).filter((e) => e.school);
  }
  if (extra.education?.length) {
    const seen = new Set(education.map((e) => e.school.toLowerCase()));
    for (const row of extra.education) {
      const edu = normalizeEdu(row);
      if (!edu.school || seen.has(edu.school.toLowerCase())) continue;
      seen.add(edu.school.toLowerCase());
      education.push(edu);
    }
  }

  return {
    experience,
    projects,
    education,
    skills: normalizeSkills(r.skills),
  };
}

export function tailorResumeForJob(base, job, { dropPerRole = 0 } = {}) {
  const tokens = new Set(extractSkillTokens(`${job?.title || ""} ${job?.description || ""} ${job?.company || ""}`));
  const experience = (base.experience || []).map((role) => {
    const scored = (role.bullets || []).map((b, i) => ({ b, s: relevanceScore(b, tokens), i }));
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    const keep = Math.max(1, scored.length - dropPerRole);
    const picked = scored.slice(0, keep).sort((a, b) => a.i - b.i).map((x) => x.b);
    return { ...role, bullets: picked };
  });

  const projects = [...(base.projects || [])]
    .map((p, i) => ({
      ...p,
      _s: relevanceScore(`${p.name} ${p.stack} ${(p.bullets || []).join(" ")}`, tokens),
      _i: i,
    }))
    .sort((a, b) => b._s - a._s || a._i - b._i)
    .map(({ _s, _i, ...p }) => {
      if (!dropPerRole) return p;
      const scored = (p.bullets || []).map((b, i) => ({ b, s: relevanceScore(b, tokens), i }));
      scored.sort((a, b) => b.s - a.s || a.i - b.i);
      const keep = Math.max(1, scored.length - dropPerRole);
      return { ...p, bullets: scored.slice(0, keep).sort((a, b) => a.i - b.i).map((x) => x.b) };
    });

  const skills = {};
  for (const [key, list] of Object.entries(base.skills || {})) {
    const scored = (list || []).map((s, i) => ({ s, n: relevanceScore(s, tokens), i }));
    scored.sort((a, b) => b.n - a.n || a.i - b.i);
    skills[key] = scored.map((x) => x.s);
  }

  return { ...base, experience, projects, skills };
}

export async function rewriteBulletsWithLlm(cfg, job, bullets) {
  if (!llmAvailable(cfg) || !bullets?.length) return bullets;
  try {
    const jdText = String(job.description || "").slice(0, 2800);
    const result = await chat(
      "You rewrite resume bullets. Output ONLY a JSON array of strings. Never invent employers, schools, titles, or metrics.",
      `Rewrite these bullets so they match the job. Keep the same count. Each bullet ≤ 22 words. Use only facts already present.\n\nBullets:\n${bullets.map((b) => `- ${b}`).join("\n")}\n\nJob: ${job.title} at ${job.company}\nJD:\n${jdText}`,
      cfg,
      { temperature: 0.25, maxTokens: 900 }
    );
    const parsed = parseJsonArray(result);
    if (parsed?.length) return parsed.slice(0, bullets.length);
  } catch {
    // keep originals
  }
  return bullets;
}

async function fetchText(url, headers = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, headers = {}, timeoutMs = 8000) {
  const text = await fetchText(url, { Accept: "application/vnd.github+json", ...headers }, timeoutMs);
  return JSON.parse(text);
}

export function parseLinkedInHtml(html) {
  const extra = { experience: [], education: [], projects: [] };
  const blocks = String(html || "").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] || [data];
      for (const node of nodes) {
        const orgs = node.worksFor ? (Array.isArray(node.worksFor) ? node.worksFor : [node.worksFor]) : [];
        for (const o of orgs) {
          if (o?.name) extra.experience.push({ company: String(o.name), title: String(o.jobTitle || ""), location: "", dates: "", bullets: [] });
        }
        const schools = node.alumniOf ? (Array.isArray(node.alumniOf) ? node.alumniOf : [node.alumniOf]) : [];
        for (const s of schools) {
          if (s?.name) extra.education.push({ school: String(s.name), degree: String(s.member || s.description || ""), location: "", dates: "" });
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return extra;
}

async function scrapeGithub(cfg) {
  const login = githubLogin(cfg.candidate?.github);
  if (!login) return { projects: [] };
  const headers = {};
  if (cfg.secrets?.github_token) headers.Authorization = `Bearer ${cfg.secrets.github_token}`;
  const repos = await fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=updated&per_page=8`, headers);
  if (!Array.isArray(repos)) return { projects: [] };
  return {
    projects: repos
      .filter((r) => r && !r.fork && (r.description || r.language))
      .slice(0, 5)
      .map((r) => ({
        name: r.name,
        stack: r.language || "",
        dates: "",
        url: r.html_url || "",
        bullets: r.description ? [String(r.description).trim()] : [],
      })),
  };
}

async function scrapeLinkedIn(cfg) {
  const url = cfg.candidate?.linkedin;
  if (!url || !linkedinSlug(url)) return { experience: [], education: [] };
  const html = await fetchText(url);
  return parseLinkedInHtml(html);
}

function readEnrichCache() {
  if (!existsSync(ENRICH_CACHE)) return null;
  try {
    const data = JSON.parse(readFileSync(ENRICH_CACHE, "utf8"));
    if (!data?.captured_at) return null;
    if (Date.now() - new Date(data.captured_at).getTime() > CACHE_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export async function enrichFromPublicProfiles(cfg) {
  const cached = readEnrichCache();
  if (cached) return cached;
  const extra = { experience: [], education: [], projects: [], captured_at: new Date().toISOString() };
  const tasks = [
    scrapeGithub(cfg).catch((err) => {
      console.warn(`  GitHub enrich skipped: ${err.message}`);
      return { projects: [] };
    }),
    scrapeLinkedIn(cfg).catch((err) => {
      console.warn(`  LinkedIn enrich skipped: ${err.message}`);
      return { experience: [], education: [] };
    }),
  ];
  const [gh, li] = await Promise.all(tasks);
  extra.projects.push(...(gh.projects || []));
  extra.experience.push(...(li.experience || []));
  extra.education.push(...(li.education || []));
  ensureDataDirs();
  mkdirSync(PATHS.tailored, { recursive: true });
  writeFileSync(ENRICH_CACHE, `${JSON.stringify(extra, null, 2)}\n`, "utf8");
  return extra;
}
