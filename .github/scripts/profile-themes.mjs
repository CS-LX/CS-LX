// Existing dark artwork stays unchanged; light assets use the same data/layout.
export const profileThemes = {
  dark: {
    background: "#0d1117", border: "#30363d", divider: "#21262d",
    text: "#c9d1d9", muted: "#8b949e", title: "#f0f6fc",
    accent: "#58a6ff", accentStrong: "#1f6feb", empty: "#161b22",
    activity: ["#0d3152", "#1f6feb", "#388bfd", "#58a6ff"],
  },
  light: {
    background: "#ffffff", border: "#d1d9e0", divider: "#d8dee4",
    text: "#1f2328", muted: "#59636e", title: "#1f2328",
    accent: "#0969da", accentStrong: "#0969da", empty: "#eff2f5",
    activity: ["#d6e9ff", "#80baff", "#388bfd", "#0969da"],
  },
};

export const gameThemes = {
  dark: {
    background: "#111820", title: "#f0f6fc", text: "#c9d1d9",
    strong: "#e0e7ef", muted: "#9baabb", secondary: "#acbbca",
    accent: "#82b9ff", divider: "#28323e",
  },
  light: {
    background: "#ffffff", title: "#1f2328", text: "#1f2328",
    strong: "#1f2328", muted: "#59636e", secondary: "#59636e",
    accent: "#0969da", divider: "#d1d9e0",
  },
};

// Keep existing dark URLs working, including links from older README revisions.
export const themeSuffix = (theme) => theme === "dark" ? "" : "-light";

// Recolor only text: global replacement would also recolor the medal faces.
// One source keeps both themes' scores identical.
export function themeTrophySource(source, theme) {
  if (theme === "dark") return source;
  const colors = profileThemes[theme];
  return source.replace(/<text\b[^>]*>/g, (tag) => tag
    .replace(/fill="#FFFFFF"/gi, 'fill="' + colors.text + '"')
    .replace(/fill="#7289DA"/gi, 'fill="' + colors.accent + '"'));
}
