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
    location: String(row?.location || row?.school_location || "").trim(),
    dates: String(row?.dates || row?.graduation || "").trim(),
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

/** Keep the JD-relevant subset so Jake stays one page with a full profile source. */
export function pickRelevantBullets(bullets, tokens, { maxKeep = 4 } = {}) {
  const list = (bullets || []).map((b) => String(b || "").trim()).filter(Boolean);
  if (!list.length) return [];
  if (list.length <= maxKeep) return list;
  const scored = list.map((b, i) => ({ b, s: relevanceScore(b, tokens), i }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, maxKeep).sort((a, b) => a.i - b.i).map((x) => x.b);
}

export function baseResumeFromConfig(cfg, extra = {}) {
  const r = cfg.resume || {};
  const candidate = cfg.candidate || {};
  let experience = (r.experience || []).map(normalizeRole).filter((e) => e.company || e.title);
  if (!experience.length && candidate.current_company) {
    const claims = claimLines(cfg);
    if (claims.length) {
      experience = [
        normalizeRole({
          title: r.current_title || candidate.current_title || "",
          company: candidate.current_company,
          location: candidate.location || "",
          dates: "Present",
          bullets: claims,
        }),
      ];
    }
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

  // Prefer loadConfig's merged education (candidate.school + resume.education).
  let education = (candidate.education?.length ? candidate.education : r.education || [])
    .map(normalizeEdu)
    .filter((e) => e.school);
  if (!education.length && candidate.school) {
    education = [
      normalizeEdu({
        school: candidate.school,
        degree: candidate.degree,
        location: candidate.school_location,
        dates: candidate.graduation,
      }),
    ];
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

export function tailorResumeForJob(base, job, { dropPerRole = 0, maxBulletsPerRole = 4, maxProjects = 3, maxRoles = 4 } = {}) {
  const tokens = new Set(extractSkillTokens(`${job?.title || ""} ${job?.description || ""} ${job?.company || ""}`));
  const keepBudget = Math.max(1, maxBulletsPerRole - dropPerRole);

  const experience = [...(base.experience || [])]
    .map((role, i) => ({
      role,
      _s: relevanceScore(`${role.title} ${role.company} ${(role.bullets || []).join(" ")}`, tokens),
      _i: i,
    }))
    .sort((a, b) => b._s - a._s || a._i - b._i)
    .slice(0, Math.max(1, maxRoles))
    .sort((a, b) => a._i - b._i)
    .map(({ role }) => ({
      ...role,
      bullets: pickRelevantBullets(role.bullets, tokens, { maxKeep: keepBudget }),
    }));

  const projects = [...(base.projects || [])]
    .map((p, i) => ({
      ...p,
      _s: relevanceScore(`${p.name} ${p.stack} ${(p.bullets || []).join(" ")}`, tokens),
      _i: i,
    }))
    .sort((a, b) => b._s - a._s || a._i - b._i)
    .slice(0, Math.max(1, maxProjects))
    .map(({ _s, _i, ...p }) => ({
      ...p,
      bullets: pickRelevantBullets(p.bullets, tokens, { maxKeep: Math.max(1, keepBudget - 1) }),
    }));

  const skills = {};
  for (const [key, list] of Object.entries(base.skills || {})) {
    const scored = (list || []).map((s, i) => ({ s, n: relevanceScore(s, tokens), i }));
    scored.sort((a, b) => b.n - a.n || a.i - b.i);
    skills[key] = scored.map((x) => x.s);
  }

  return { ...base, experience, projects, skills };
}

export function parseBulletLines(text, expected) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•\d)+.\s]+/, "").trim())
    .filter((l) => l.length > 12 && !/^```/.test(l) && !/^\[/.test(l));
  if (!lines.length) return null;
  return lines.slice(0, expected || lines.length);
}

export async function rewriteBulletsWithLlm(cfg, job, bullets) {
  if (!llmAvailable(cfg) || !bullets?.length) return bullets;
  const jdText = String(job.description || job.title || "").slice(0, 3200);
  const system =
    "You rewrite resume bullets for one job posting. Reply with ONLY a JSON array of strings — no markdown fences, no commentary. "
    + "Never invent employers, schools, titles, metrics, or tools not already present in the input bullets. "
    + "Keep the same array length. Each bullet ≤ 28 words. Emphasize overlap with the job.";
  const user =
    `Job: ${job.title} at ${job.company}\nJD:\n${jdText}\n\n`
    + `Bullets (${bullets.length}):\n${JSON.stringify(bullets)}\n\n`
    + `Return a JSON array of exactly ${bullets.length} rewritten strings.`;

  try {
    // Short JSON rewrite — disable thinking so reasoning_budget does not eat max_tokens.
    const result = await chat(system, user, cfg, { temperature: 0.25, maxTokens: 1800, thinking: false });
    let parsed = parseJsonArray(result);
    if (!parsed?.length) parsed = parseBulletLines(result, bullets.length);
    if (parsed?.length) {
      const out = parsed.slice(0, bullets.length);
      while (out.length < bullets.length) out.push(bullets[out.length]);
      // If the model collapsed distinct bullets into copies, restore originals for those slots.
      for (let i = 0; i < out.length; i += 1) {
        if (!out[i] || (i > 0 && out[i] === out[i - 1] && bullets[i] !== bullets[i - 1])) {
          out[i] = bullets[i];
        }
      }
      return out;
    }
    console.warn("  bullet rewrite returned no JSON array — keeping originals");
  } catch (err) {
    console.warn(`  bullet rewrite skipped: ${err.message}`);
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
