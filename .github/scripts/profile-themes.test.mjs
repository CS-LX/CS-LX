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
