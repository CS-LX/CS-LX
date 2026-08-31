import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const login = "CS-LX";
const root = resolve(import.meta.dirname, "..", "..");
const profileDir = resolve(root, "profile");
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

const colors = {
  background: "#0d1117",
  border: "#30363d",
  divider: "#21262d",
  text: "#c9d1d9",
  muted: "#8b949e",
  title: "#f0f6fc",
  accent: "#58a6ff",
  accentStrong: "#1f6feb",
  accentDim: "#0d3152",
  empty: "#161b22",
};

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "CS-LX-profile-generator",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function isoDate(value) {
  return `${dateOnly(value)}T00:00:00Z`;
}

function addDays(value, days) {
  const copy = new Date(value);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function shortDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

async function request(url, options = {}) {
  const isGitHubApi = new URL(url).hostname === "api.github.com";
  const requestOptions = {
    ...options,
    headers: {
      ...(isGitHubApi ? headers : { "User-Agent": "CS-LX-profile-generator" }),
      ...options.headers,
    },
  };
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, requestOptions);
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
      }
      lastError = new Error(`${response.status} ${response.statusText}: ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError;
}

async function getJson(path) {
  return (await request(`https://api.github.com${path}`)).json();
}

async function getGraphql(query, variables) {
  const response = await request("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(({ message }) => message).join("; "));
  }
  return payload.data;
}

async function getRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await getJson(`/users/${login}/repos?per_page=100&sort=updated&page=${page}`);
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

async function getContributionHistory(createdAt) {
  const query = `
    query ContributionHistory($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
  `;

  const totals = { commits: 0, issues: 0, pullRequests: 0, reviews: 0 };
  const days = new Map();
  const lastDay = new Date();
  lastDay.setUTCHours(0, 0, 0, 0);
  let from = new Date(createdAt);
  from.setUTCHours(0, 0, 0, 0);

  while (from <= lastDay) {
    const to = new Date(Math.min(addDays(from, 364).getTime(), lastDay.getTime()));
    const data = await getGraphql(query, { login, from: isoDate(from), to: isoDate(to) });
    const collection = data.user.contributionsCollection;
    totals.commits += collection.totalCommitContributions;
    totals.issues += collection.totalIssueContributions;
    totals.pullRequests += collection.totalPullRequestContributions;
    totals.reviews += collection.totalPullRequestReviewContributions;

    const lowerBound = dateOnly(from);
    const upperBound = dateOnly(to);
    for (const week of collection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        if (day.date >= lowerBound && day.date <= upperBound) {
          days.set(day.date, day.contributionCount);
        }
      }
    }
    from = addDays(to, 1);
  }

  return { days, totals };
}

function getStreaks(days) {
  const entries = [...days.entries()].sort(([left], [right]) => left.localeCompare(right));
  let longest = { length: 0, start: null, end: null };
  let running = { length: 0, start: null, end: null };

  for (const [date, count] of entries) {
    if (count > 0) {
      if (running.length === 0) running.start = date;
      running.length += 1;
      running.end = date;
      if (running.length > longest.length) longest = { ...running };
    } else {
      running = { length: 0, start: null, end: null };
    }
  }

  const last = entries.at(-1)?.[0] ?? dateOnly(new Date());
  const current = running.end === last ? running : { length: 0, start: last, end: last };
  return { current, longest };
}

function card(title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="${escapeXml(title)}">
  <rect width="495" height="195" rx="8" fill="${colors.background}"/>
  <rect x="0.5" y="0.5" width="494" height="194" rx="7.5" fill="none" stroke="${colors.border}"/>
  <path d="M8 8h3v27H8z" fill="${colors.accent}"/>
  <text x="24" y="29" fill="${colors.title}" font-family="Segoe UI, Noto Sans, Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(title)}</text>
  <line x1="16" y1="43.5" x2="479" y2="43.5" stroke="${colors.divider}"/>
${body}
</svg>`;
}

function textLine(x, y, text, options = {}) {
  const { fill = colors.text, size = 12, weight = 400, anchor = "start" } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Segoe UI, Noto Sans, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

function renderStats({ stars, totals }) {
  const metrics = [
    ["Total Stars Earned", stars],
    ["Total Commits", totals.commits],
    ["Total PRs", totals.pullRequests],
    ["Total Issues", totals.issues],
  ];
  const positions = [
    [24, 79], [262, 79], [24, 143], [262, 143],
  ];
  const content = metrics.map(([label, value], index) => {
    const [x, y] = positions[index];
    return `${textLine(x, y, compactNumber(value), { fill: colors.accent, size: 23, weight: 700 })}
    ${textLine(x, y + 20, label, { fill: colors.muted, size: 11 })}`;
  }).join("\n");
  return card("GitHub Stats", content);
}

function rangeText(streak) {
  if (!streak.start || !streak.end) return "";
  return streak.start === streak.end ? shortDate(streak.start) : `${shortDate(streak.start)} – ${shortDate(streak.end)}`;
}

function renderStreak(days, streaks) {
  const total = [...days.values()].reduce((sum, value) => sum + value, 0);
  const columns = [
    [82.5, compactNumber(total), "Total Contributions", ""],
    [247.5, compactNumber(streaks.current.length), "Current Streak", rangeText(streaks.current)],
    [412.5, compactNumber(streaks.longest.length), "Longest Streak", rangeText(streaks.longest)],
  ];
  const dividers = `<line x1="165" y1="61" x2="165" y2="171" stroke="${colors.divider}"/>
  <line x1="330" y1="61" x2="330" y2="171" stroke="${colors.divider}"/>`;
  const content = `${dividers}\n${columns.map(([x, value, label, range]) => `
    ${textLine(x, 95, value, { fill: colors.accent, size: 28, weight: 700, anchor: "middle" })}
    ${textLine(x, 121, label, { fill: colors.text, size: 12, anchor: "middle" })}
    ${textLine(x, 147, range, { fill: colors.muted, size: 10, anchor: "middle" })}`).join("\n")}`;
  return card("GitHub Streak", content);
}

function renderLanguages(languages) {
  const total = languages.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
  const rows = languages.slice(0, 8).map(([name, bytes], index) => {
    const y = 62 + index * 16;
    const percent = (bytes / total) * 100;
    return `${textLine(24, y, name, { size: 11 })}
    <rect x="160" y="${y - 9}" width="250" height="7" rx="3.5" fill="${colors.empty}"/>
    <rect x="160" y="${y - 9}" width="${Math.max(3, 250 * percent / 100).toFixed(1)}" height="7" rx="3.5" fill="${colors.accentStrong}"/>
    ${textLine(468, y, `${percent.toFixed(1)}%`, { fill: colors.muted, size: 10, anchor: "end" })}`;
  }).join("\n");
  return card("Top Languages", rows);
}

function renderActivity(days) {
  const latest = new Date(`${[...days.keys()].sort().at(-1)}T00:00:00Z`);
  const sunday = addDays(latest, -latest.getUTCDay());
  const weekStarts = Array.from({ length: 53 }, (_, index) => addDays(sunday, -7 * (52 - index)));
  const values = weekStarts.flatMap((week) => Array.from({ length: 7 }, (_, day) => days.get(dateOnly(addDays(week, day))) ?? 0));
  const nonZero = values.filter((value) => value > 0);
  const max = Math.max(...nonZero, 1);
  const shade = (value) => {
    if (value === 0) return colors.empty;
    const ratio = value / max;
    if (ratio <= 0.25) return colors.accentDim;
    if (ratio <= 0.5) return colors.accentStrong;
    if (ratio <= 0.75) return "#388bfd";
    return colors.accent;
  };
  const monthLabels = weekStarts.map((week, index) => {
    const previous = index === 0 ? null : weekStarts[index - 1];
    if (index !== 0 && week.getUTCMonth() === previous.getUTCMonth()) return "";
    return textLine(60 + index * 17, 59, new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(week), { fill: colors.muted, size: 10 });
  }).join("\n");
  const cells = weekStarts.flatMap((week, weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => {
    const value = days.get(dateOnly(addDays(week, dayIndex))) ?? 0;
    return `<rect x="${60 + weekIndex * 17}" y="${68 + dayIndex * 17}" width="12" height="12" rx="2" fill="${shade(value)}"><title>${escapeXml(`${dateOnly(addDays(week, dayIndex))}: ${value} contributions`)}</title></rect>`;
  })).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="205" viewBox="0 0 1000 205" role="img" aria-label="Activity Graph">
  <rect width="1000" height="205" rx="8" fill="${colors.background}"/>
  <rect x="0.5" y="0.5" width="999" height="204" rx="7.5" fill="none" stroke="${colors.border}"/>
  <path d="M8 8h3v27H8z" fill="${colors.accent}"/>
  ${textLine(24, 29, "Activity Graph", { fill: colors.title, size: 14, weight: 700 })}
  <line x1="16" y1="43.5" x2="984" y2="43.5" stroke="${colors.divider}"/>
  ${monthLabels}
  ${cells}
</svg>`;
}

function wrapText(value, maxLength, maxLines) {
  if (!value) return [];
  const words = value.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxLength || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.join(" ").length < value.length) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, Math.max(0, maxLength - 1))}…`;
  }
  return lines;
}

function renderProject(repository) {
  const nameLines = wrapText(repository.name, 38, 2);
  const descriptionLines = wrapText(repository.description, 55, 2);
  const name = nameLines.map((line, index) => textLine(24, 72 + index * 20, line, { fill: colors.title, size: 16, weight: 700 })).join("\n");
  const descriptionY = 72 + nameLines.length * 20 + 8;
  const description = descriptionLines.map((line, index) => textLine(24, descriptionY + index * 16, line, { fill: colors.text, size: 11 })).join("\n");
  const meta = [
    `★ ${compactNumber(repository.stargazers_count)}`,
    `⑂ ${compactNumber(repository.forks_count)}`,
    repository.language,
  ].filter(Boolean).join("   ");
  return card(repository.name, `${name}\n${description}\n${textLine(24, 173, meta, { fill: colors.muted, size: 11 })}`);
}

function renderTrophies(source) {
  const dimensions = source.match(/<svg\s+[^>]*width="(\d+)"\s+height="(\d+)"[^>]*>/s);
  if (!dimensions) throw new Error("Unable to read trophy SVG dimensions");
  const [width, height] = dimensions.slice(1).map(Number);
  const scale = Math.min(451 / width, 135 / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const x = (495 - renderedWidth) / 2;
  const y = 50 + (135 - renderedHeight) / 2;
  const encoded = Buffer.from(source).toString("base64");
  return card("GitHub Trophy", `<image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${renderedWidth.toFixed(1)}" height="${renderedHeight.toFixed(1)}" href="data:image/svg+xml;base64,${encoded}"/>`);
}

async function writeSvg(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content}\n`, "utf8");
}

async function getTrophySource() {
  try {
    return await request(`https://github-profile-trophy-gamma.vercel.app/?username=${login}&theme=discord&no-frame=true&no-bg=true&margin-w=4&column=6`).then((response) => response.text());
  } catch (error) {
    console.warn(`Trophy refresh skipped: ${error.message}`);
    return null;
  }
}

async function main() {
  const [user, repositories] = await Promise.all([
    getJson(`/users/${login}`),
    getRepositories(),
  ]);
  const ownedRepositories = repositories.filter((repository) => !repository.fork);
  const [history, languageResults, trophySource] = await Promise.all([
    getContributionHistory(user.created_at),
    Promise.all(ownedRepositories.map(async (repository) => [repository.name, await getJson(`/repos/${login}/${repository.name}/languages`)])),
    getTrophySource(),
  ]);

  const languageBytes = new Map();
  for (const [, languages] of languageResults) {
    for (const [name, bytes] of Object.entries(languages)) {
      languageBytes.set(name, (languageBytes.get(name) ?? 0) + bytes);
    }
  }
  const languages = [...languageBytes.entries()].sort(([, left], [, right]) => right - left);
  const stars = ownedRepositories.reduce((sum, repository) => sum + repository.stargazers_count, 0);
  const streaks = getStreaks(history.days);
  const selected = ["PowerfulWindSlickedBackHair_Winform", "Inhuman", "RecipaediaEX", "SCEngine"];

  await Promise.all([
    writeSvg(resolve(profileDir, "stats.svg"), renderStats({ stars, totals: history.totals })),
    writeSvg(resolve(profileDir, "streak.svg"), renderStreak(history.days, streaks)),
    writeSvg(resolve(profileDir, "languages.svg"), renderLanguages(languages)),
    ...(trophySource ? [writeSvg(resolve(profileDir, "trophies.svg"), renderTrophies(trophySource))] : []),
    writeSvg(resolve(profileDir, "activity.svg"), renderActivity(history.days)),
    ...selected.map((name) => {
      const repository = ownedRepositories.find((entry) => entry.name === name);
      if (!repository) throw new Error(`Selected repository not found: ${name}`);
      return writeSvg(resolve(profileDir, "projects", `${name}.svg`), renderProject(repository));
    }),
  ]);
}

await main();
