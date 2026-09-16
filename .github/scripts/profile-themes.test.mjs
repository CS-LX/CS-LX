import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { gameThemes, profileThemes, themeTrophySource } from "./profile-themes.mjs";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path), "utf8");
const readme = await read("README.md");
const { games } = JSON.parse(await read(".github/data/games.json"));
const textContent = (svg) => [...svg.matchAll(/<(?:text|title|desc)\b[^>]*>(.*?)<\/(?:text|title|desc)>/gs)].map((match) => match[1]);
const embeddedTrophies = (svg) => Buffer.from(svg.match(/data:image\/svg\+xml;base64,([^"]+)/)[1], "base64").toString("utf8");

function attribute(tag, name) {
  return tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1].replaceAll("&amp;", "&");
}

function remotePictures(markup) {
  return [...markup.matchAll(/<picture\b[^>]*>(.*?)<\/picture>/gs)].flatMap((match) => {
    const img = match[1].match(/<img\b[^>]*>/)?.[0];
    if (!img) return [];
    const fallback = new URL(attribute(img, "data-canonical-src") ?? attribute(img, "src"), "https://github.com");
    if (!["skillicons.dev", "capsule-render.vercel.app"].includes(fallback.hostname)) return [];
    const sources = [...match[1].matchAll(/<source\b[^>]*>/g)].map(([tag]) => ({
      media: attribute(tag, "media"),
      url: new URL(attribute(tag, "data-canonical-src") ?? attribute(tag, "srcset")),
    }));
    return [{ fallback, sources }];
  });
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels.reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}

test("light and dark text colors have at least 4.5:1 contrast", () => {
  for (const themes of [gameThemes, profileThemes]) {
    for (const [theme, colors] of Object.entries(themes)) {
      for (const key of ["title", "text", "muted", "accent", "strong", "secondary"]) {
        if (!colors[key]) continue;
        const pair = [luminance(colors.background), luminance(colors[key])].sort((a, b) => b - a);
        assert.ok((pair[0] + 0.05) / (pair[1] + 0.05) >= 4.5, theme + ": " + key);
      }
    }
  }
});

test("every generated pair keeps identical dimensions and information", async () => {
  const pairs = new Set(["stats", "streak", "languages", "activity", "trophies"]);
  for (const match of readme.matchAll(/src="\.\/profile\/(projects\/[^"]+)-light\.svg"/g)) pairs.add(match[1]);
  for (const game of games) {
    for (const variant of ["desktop", "tablet", "mobile"]) pairs.add("games/" + game.id + "-" + variant);
  }
  assert.equal(pairs.size, 9 + games.length * 3);
  for (const name of pairs) {
    const [dark, light] = await Promise.all([read("profile/" + name + ".svg"), read("profile/" + name + "-light.svg")]);
    assert.deepEqual(textContent(light), textContent(dark), name + ": text changed between themes");
    assert.equal(light.match(/viewBox="[^"]+"/)[0], dark.match(/viewBox="[^"]+"/)[0], name + ": layout changed");
    if (name === "trophies") {
      assert.equal(embeddedTrophies(light), themeTrophySource(embeddedTrophies(dark), "light"));
      assert.deepEqual(textContent(embeddedTrophies(light)), textContent(embeddedTrophies(dark)));
    }
  }
});

test("trophy recoloring leaves medal artwork and scores untouched", () => {
  const source = '<circle fill="#FFFFFF"/><text fill="#7289DA">Stars</text><text fill="#FFFFFF">560pt</text><text fill="#000000">S</text>';
  const light = themeTrophySource(source, "light");
  assert.ok(light.includes('<circle fill="#FFFFFF"/>'));
  assert.ok(light.includes('<text fill="#000000">S</text>'));
  assert.deepEqual(textContent(light), textContent(source));
  assert.equal(themeTrophySource(source, "dark"), source);
});

test("responsive game artwork and all original links share one frame", () => {
  const section = readme.split("<!-- games:start -->")[1].split("<!-- games:end -->")[0];
  const tables = [...section.matchAll(/<table\b[^>]*>.*?<\/table>/gs)].map((match) => match[0]);
  assert.equal(tables.length, games.length);
  for (const [i, game] of games.entries()) {
    const table = tables[i];
    assert.equal([...table.matchAll(/<td\b/g)].length, 1);
    const cell = table.match(/<td\b[^>]*>(.*?)<\/td>/s)[1];
    // Never combine width and theme media: GitHub overwrites media conditions
    // in manual theme mode, losing the max-width and always picking mobile.
    assert.ok(!cell.includes("prefers-color-scheme"));
    for (const theme of ["dark", "light"]) {
      const suffix = theme === "dark" ? "" : "-light";
      const anchor = [...cell.matchAll(/<a href="([^"]+)">(.*?)<\/a>/gs)].find((match) => match[1].endsWith("#gh-" + theme + "-mode-only"));
      assert.ok(anchor, game.id + ": missing theme selector");
      for (const [variant, width] of [["mobile", 520], ["tablet", 900]]) {
        assert.ok(anchor[2].includes('media="(max-width: ' + width + 'px)"'));
        assert.ok(anchor[2].includes(game.id + "-" + variant + suffix + ".svg"));
      }
      assert.ok(anchor[2].includes(game.id + "-desktop" + suffix + ".svg"));
    }
    const footer = cell.match(/<p>(.*?)<\/p>/s)[1];
    const links = [...footer.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((match) => ({ url: match[1], label: match[2] }));
    assert.deepEqual(links, game.links, game.id + ": footer links changed");
  }
});

test("all local README image variants exist", async () => {
  const paths = new Set();
  for (const match of readme.matchAll(/(?:src|srcset)="(?:\.\/|https:\/\/raw\.githubusercontent\.com\/CS-LX\/CS-LX\/main\/)(profile\/[^"]+)"/g)) paths.add(match[1]);
  for (const path of paths) await access(resolve(root, path));
});

test("single-image srcsets encode commas in URL parameters", () => {
  for (const [tag] of readme.matchAll(/<source\b[^>]*>/g)) {
    const url = attribute(tag, "srcset");
    // GitHub's image proxy splits raw commas into separate image candidates.
    assert.ok(!url.includes(","), "Encode URL commas as %2C: " + url);
  }
});

test("both skill-icon themes retain every icon and layout parameter", () => {
  const pictures = remotePictures(readme).filter(({ fallback }) => fallback.hostname === "skillicons.dev");
  assert.equal(pictures.length, 2);
  const expected = ["cs,cpp,c,python,lua", "unity,git,github,blender,visualstudio,rider,stackoverflow,figma,ps,sentry"];
  for (const [index, { fallback, sources }] of pictures.entries()) {
    assert.equal(sources.length, 2);
    assert.equal(fallback.searchParams.get("i"), expected[index]);
    for (const theme of ["dark", "light"]) {
      const source = sources.find(({ media }) => media === "(prefers-color-scheme: " + theme + ")");
      assert.ok(source, "Missing " + theme + " skill icons");
      assert.equal(source.url.searchParams.get("theme"), theme);
      assert.equal(source.url.searchParams.get("i"), expected[index]);
      assert.equal(source.url.searchParams.get("perline"), "8");
    }
  }
});

test("Thanks footer preserves its text, animation and theme-specific colors", () => {
  const pictures = remotePictures(readme).filter(({ fallback }) => fallback.hostname === "capsule-render.vercel.app");
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].sources.length, 2);
  for (const [theme, fontColor, color] of [
    ["dark", "c9d1d9", "0:0d1117,100:1f6feb"],
    ["light", "1f2328", "0:ffffff,100:80baff"],
  ]) {
    const source = pictures[0].sources.find(({ media }) => media === "(prefers-color-scheme: " + theme + ")");
    assert.ok(source, "Missing " + theme + " footer");
    const params = source.url.searchParams;
    for (const [key, value] of Object.entries({
      type: "waving", color, height: "100", section: "footer",
      text: "Thanks for visiting!", fontSize: "24", fontColor, animation: "twinkling",
    })) assert.equal(params.get(key), value, theme + " footer: " + key);
  }
});

test("GitHub rendering keeps themed remote sources inside their pictures with complete URLs", {
  skip: !process.env.VERIFY_GITHUB_MARKDOWN,
}, async () => {
  // Optional locally, enabled in CI: source-only tests cannot detect GitHub's
  // srcset proxy truncation or Markdown splitting a picture after <br/>.
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  assert.ok(token, "Markdown rendering check needs a GitHub token");
  const response = await fetch("https://api.github.com/markdown", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ text: readme, mode: "gfm", context: "CS-LX/CS-LX" }),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, "GitHub Markdown API returned " + response.status);
  const expected = remotePictures(readme);
  const actual = remotePictures(await response.text());
  assert.equal(actual.length, expected.length, "A themed picture lost its fallback image");
  for (const [index, picture] of actual.entries()) {
    assert.equal(picture.fallback.href, expected[index].fallback.href);
    assert.deepEqual(
      picture.sources.map(({ media, url }) => [media, url.href]),
      expected[index].sources.map(({ media, url }) => [media, url.href]),
      "GitHub split the picture or truncated a source URL",
    );
  }
});
