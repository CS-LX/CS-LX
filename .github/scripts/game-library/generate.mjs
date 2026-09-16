import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { gameThemes, themeSuffix } from "../profile-themes.mjs";

// Stable pixels and PNG encoding across local Windows and the Linux CI runner.
sharp.simd(false);

const root = resolve(import.meta.dirname, "../../..");
const check = process.argv.includes("--check");
const variants = ["desktop", "tablet", "mobile"];
const font = "Microsoft YaHei, Noto Sans CJK SC, Noto Sans SC, Segoe UI, sans-serif";
const startMarker = "<!-- games:start -->";
const endMarker = "<!-- games:end -->";
const xml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const dataUri = (buffer, mime) => `data:${mime};base64,${buffer.toString("base64")}`;
const normalize = (value) => value.replace(/\s+/gu, "");

function assetPath(relative) {
  const imageRoot = resolve(root, "Images");
  const result = resolve(root, relative);
  if (!result.startsWith(`${imageRoot}${sep}`)) throw new Error(`Asset must be inside Images/: ${relative}`);
  return result;
}

function validate({ games, heroes }) {
  if (!Array.isArray(games) || games.length === 0) throw new Error("Game list is empty");
  const ids = new Set();
  for (const game of games) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.id) || ids.has(game.id)) throw new Error(`Invalid or duplicate game id: ${game.id}`);
    ids.add(game.id);
    for (const key of ["name", "icon", "roles", "rolesEn", "event"]) {
      if (typeof game[key] !== "string" || !game[key].trim()) throw new Error(`${game.id}: missing ${key}`);
    }
    assetPath(game.icon);
    if (game.hero) {
      if (!heroes?.[game.hero]?.image) throw new Error(`${game.id}: unknown hero ${game.hero}`);
      assetPath(heroes[game.hero].image);
    }
    if (game.narrowEventLines && normalize(game.narrowEventLines.join(" ")) !== normalize(game.event)) {
      throw new Error(`${game.id}: narrow event layout changes its text`);
    }
    if (game.mobileNameLines && normalize(game.mobileNameLines.join(" ")) !== normalize(game.name)) {
      throw new Error(`${game.id}: mobile title layout changes its text`);
    }
    if (!Array.isArray(game.links) || game.links.length === 0) throw new Error(`${game.id}: missing links`);
    for (const link of game.links) {
      if (!link.label?.trim() || new URL(link.url).protocol !== "https:") throw new Error(`${game.id}: invalid link`);
    }
  }
}

function text(x, y, value, size = 20, color = "#c9d1d9", weight = 400) {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="${font}" font-size="${size}" font-weight="${weight}">${xml(value)}</text>`;
}

// Keep every character. Split unusually long words instead of truncating them.
function wrap(value, width, size) {
  const tokens = String(value).match(/[A-Za-z0-9\[\]()-]+|\s+|./gu) ?? [];
  const cost = (word) => [...word].reduce((sum, char) => sum + (/^[\x00-\x7F]$/.test(char) ? 0.54 : 1) * size, 0);
  const words = tokens.flatMap((word) => cost(word) > width ? [...word] : [word]);
  const lines = [];
  let line = "", used = 0;
  for (const word of words) {
    if (used + cost(word) > width && line.trim()) {
      lines.push(line.trim());
      line = "";
      used = 0;
    }
    if (!line && !word.trim()) continue;
    line += word;
    used += cost(word);
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function multiline(x, y, value, width, size = 20, color = "#c9d1d9", weight = 400, lineHeight = 28) {
  const lines = String(value).split("\n").flatMap((line) => wrap(line, width, size));
  return { svg: lines.map((line, i) => text(x, y + i * lineHeight, line, size, color, weight)).join("\n"), height: lines.length * lineHeight };
}

async function averageColor(input) {
  const { data } = await sharp(input).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let alpha = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const weight = data[i + 3] / 255;
    alpha += weight;
    for (let channel = 0; channel < 3; channel++) sum[channel] += data[i + channel] * weight;
  }
  if (alpha === 0) return "#111820";
  return `#${sum.map((channel) => Math.round(channel / alpha).toString(16).padStart(2, "0")).join("")}`;
}

function description(game) {
  return [game.name, game.roles, game.rolesEn, game.event, game.site, game.award, game.eventEn].filter(Boolean).join("；");
}

function card(game, assets, variant, colors) {
  const mobile = variant === "mobile", tablet = variant === "tablet";
  const width = mobile ? 360 : tablet ? 640 : 960;
  const heroHeight = width * 700 / 3840;
  const padding = mobile || tablet ? 20 : 28;
  const iconSize = mobile ? 64 : tablet ? 72 : 84;
  const iconY = heroHeight - 14;
  const nameX = padding + iconSize + 18;
  const nameText = mobile && game.mobileNameLines ? game.mobileNameLines.join("\n") : game.name;
  const title = multiline(nameX, heroHeight + 32, nameText, width - nameX - padding, mobile ? 22 : tablet ? 26 : 30, colors.title, 700, mobile ? 30 : 38);
  const detailY = Math.max(heroHeight + 94, heroHeight + title.height + 52);
  const eventText = (mobile || tablet) && game.narrowEventLines ? game.narrowEventLines.join("\n") : game.event;
  let details = "", y = detailY;
  if (mobile) {
    for (const [value, size, color, weight, lineHeight, gap] of [
      [game.roles, 18, colors.strong, 500, 26, 0],
      [game.rolesEn, 15, colors.muted, 400, 23, 24],
      [eventText, 18, colors.text, 500, 26, 0],
      [game.site, 17, colors.secondary, 400, 25, 0],
      [game.award, 18, colors.accent, 700, 27, 0],
      [game.eventEn, 15, colors.muted, 400, 23, 0],
    ]) {
      if (!value) continue;
      const block = multiline(padding, y, value, width - padding * 2, size, color, weight, lineHeight);
      details += block.svg;
      y += block.height + gap;
    }
  } else {
    const eventX = tablet ? 258 : 366, bodySize = tablet ? 18 : 20, englishSize = tablet ? 15 : 17;
    const role = multiline(padding, detailY, game.roles, tablet ? 204 : 300, bodySize, colors.strong, 500, 26);
    const roleEn = multiline(padding, detailY + role.height, game.rolesEn, tablet ? 204 : 300, englishSize, colors.muted, 400, 24);
    details += role.svg + roleEn.svg;
    const event = multiline(eventX, detailY, eventText, width - eventX - padding, tablet ? 18 : 21, colors.strong, 500, 29);
    details += event.svg;
    y += event.height;
    if (game.site || game.award) {
      const honor = multiline(eventX, y, [game.site, game.award].filter(Boolean).join("  ·  "), width - eventX - padding, bodySize, game.award ? colors.accent : colors.secondary, game.award ? 600 : 400, 27);
      details += honor.svg;
      y += honor.height;
    }
    if (game.eventEn) {
      const english = multiline(eventX, y, game.eventEn, width - eventX - padding, englishSize, colors.muted, 400, 24);
      details += english.svg;
      y += english.height;
    }
    y = Math.max(y, detailY + role.height + roleEn.height + 12);
    details += `<path d="M${eventX - 24} ${detailY - 18}V${y - 9}" stroke="${colors.divider}"/>`;
  }
  const height = Math.ceil(y + 22);
  const background = assets.hero
    ? `<image href="${assets.hero}" width="${width}" height="${heroHeight}" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect width="${width}" height="${heroHeight}" fill="${assets.average}"/><rect width="${width}" height="${heroHeight}" fill="url(#fallback)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(description(game))}">
<title>${xml(game.name)}</title>
<desc>${xml(description(game))}</desc>
<defs>
  <linearGradient id="shade" x2="0" y2="1"><stop offset="0" stop-color="${colors.background}" stop-opacity="0"/><stop offset=".67" stop-color="${colors.background}" stop-opacity="0"/><stop offset="1" stop-color="${colors.background}" stop-opacity=".38"/></linearGradient>
  <linearGradient id="fallback"><stop stop-color="${colors.background}" stop-opacity=".1"/><stop offset="1" stop-color="${colors.background}" stop-opacity=".67"/></linearGradient>
  <clipPath id="icon"><rect x="${padding}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${mobile ? 12 : 16}"/></clipPath>
</defs>
<rect width="${width}" height="${height}" fill="${colors.background}"/>
${background}<rect width="${width}" height="${heroHeight}" fill="url(#shade)"/>
<rect x="${padding - 4}" y="${iconY - 4}" width="${iconSize + 8}" height="${iconSize + 8}" rx="${mobile ? 16 : 20}" fill="${colors.background}"/>
<image href="${assets.icon}" x="${padding}" y="${iconY}" width="${iconSize}" height="${iconSize}" clip-path="url(#icon)"/>
${title.svg}
${details}
</svg>\n`;
}

function readmeSection(games, eol) {
  const lines = [startMarker];
  for (const game of games) {
    const image = `./profile/games/${game.id}`;
    // GitHub rewrites img src, but source srcset can remain relative after sanitizing.
    const rawImage = `https://raw.githubusercontent.com/CS-LX/CS-LX/main/profile/games/${game.id}`;
    // GitHub strips custom CSS. A single native table cell owns the visible frame
    // around both the artwork and real HTML links; links inside an img SVG are inert.
    lines.push(
      `<table width="100%">`,
      `  <tr>`,
      `    <td>`,
      // GitHub's themed-picture element replaces the ENTIRE source media query
      // in manual light/dark mode. Theme anchors keep responsive queries intact.
      ...Object.keys(gameThemes).flatMap((theme) => {
        const suffix = themeSuffix(theme);
        return [
          `      <a href="${image}-desktop${suffix}.svg#gh-${theme}-mode-only">`,
          `        <picture>`,
          `          <source media="(max-width: 520px)" srcset="${rawImage}-mobile${suffix}.svg">`,
          `          <source media="(max-width: 900px)" srcset="${rawImage}-tablet${suffix}.svg">`,
          `          <img src="${image}-desktop${suffix}.svg" alt="${xml(description(game))}" width="100%">`,
          `        </picture>`,
          `      </a>`,
        ];
      }),
      `      <p>${game.links.map(({ label, url }) => `<a href="${xml(url)}">${xml(label)}</a>`).join(" &nbsp;·&nbsp; ")}</p>`,
      `    </td>`,
      `  </tr>`,
      `</table>`,
      "",
    );
  }
  return [...lines, endMarker].join(eol);
}

async function generate() {
  const model = JSON.parse(await readFile(resolve(root, ".github/data/games.json"), "utf8"));
  validate(model);
  const readmePath = resolve(root, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const start = readme.indexOf(startMarker), end = readme.indexOf(endMarker);
  if (start < 0 || end < start || readme.indexOf(startMarker, start + 1) !== -1 || readme.indexOf(endMarker, end + 1) !== -1) {
    throw new Error("README needs exactly one ordered games marker pair");
  }
  const outputs = new Map();
  const heroCache = new Map();
  for (const game of model.games) {
    const input = assetPath(game.icon);
    for (const [theme, colors] of Object.entries(gameThemes)) {
      const assets = {
        icon: dataUri(await sharp(input).resize(112, 112, { fit: "contain", background: colors.background }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer(), "image/png"),
      };
      if (game.hero) {
        const cacheKey = `${game.hero}-${theme}`;
        if (!heroCache.has(cacheKey)) {
          const hero = assetPath(model.heroes[game.hero].image);
          // Keep the entire supplied hero: letterbox if a future image has a different ratio.
          const encoded = await sharp(hero).resize(960, 175, { fit: "contain", background: colors.background }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
          heroCache.set(cacheKey, dataUri(encoded, "image/jpeg"));
        }
        assets.hero = heroCache.get(cacheKey);
      } else {
        assets.average = await averageColor(input);
      }
      for (const variant of variants) outputs.set(resolve(root, "profile/games", `${game.id}-${variant}${themeSuffix(theme)}.svg`), card(game, assets, variant, colors));
    }
  }
  const eol = readme.includes("\r\n") ? "\r\n" : "\n";
  outputs.set(readmePath, readme.slice(0, start) + readmeSection(model.games, eol) + readme.slice(end + endMarker.length));
  let changes = 0;
  // Finish all asset reads and rendering before changing any tracked outputs.
  for (const [file, content] of outputs) {
    let existing;
    try { existing = await readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    // Git may check out CRLF on Windows; line endings do not make an SVG stale.
    if (existing?.replaceAll("\r\n", "\n") === content.replaceAll("\r\n", "\n")) continue;
    changes++;
    if (check) console.error(`Needs generation: ${file}`);
    else {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content, "utf8");
    }
  }
  if (check && changes) throw new Error(`${changes} game library files are out of date; run npm run build`);
  console.log(`${model.games.length} games, ${model.games.length * variants.length * Object.keys(gameThemes).length} SVGs; ${changes} files ${check ? "out of date" : "updated"}.`);
}

await generate();
