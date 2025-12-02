import type { APIRoute } from "astro";

import type { ReturnData } from "../types";

const logoOverrides: Record<string, string> = {
  "antfu/vscode-array-index-inlay":
    "https://github.com/antfu/vscode-array-index-inlay/raw/main/res/icon.png?raw=true",
  "antfu/vscode-smart-clicks":
    "https://raw.githubusercontent.com/antfu/vscode-smart-clicks/main/res/icon.png",
  "antfu/vscode-pnpm-catalog-lens":
    "https://raw.githubusercontent.com/antfu/vscode-pnpm-catalog-lens/main/res/icon.png",
};

export const GET: APIRoute = async ({ site }) => {
  const name = import.meta.env.PUBLIC_NAME || "YourName";
  const website = site?.toString() || "https://example.com";

  const data: ReturnData = await fetch(`${website}api/releases.json`)
    .then((res) => res.json())
    .catch(() => ({ infos: [], lastUpdated: 0, lastFetched: 0 }));

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(`${name} is Releasing...`)}</title>
    <description>${escapeXml(`${name}'s recent releases`)}</description>
    <link>${website}</link>
    <atom:link href="${website}feed.xml" rel="self" type="application/rss+xml"/>
    <language>en</language>
    <image>
      <url>${website}favicon.png</url>
      <title>${escapeXml(name)}</title>
      <link>${website}</link>
    </image>
    <copyright>CC BY-NC-SA 4.0 ${new Date().getFullYear()} © ${escapeXml(name)}</copyright>
    ${data.infos
      .map(
        (item) => `
    <item>
      <guid isPermaLink="false">${item.id}</guid>
      <title>${escapeXml(`${item.repo} v${item.version} released`)}</title>
      <link>https://github.com/${item.repo}/releases/tag/v${item.version}</link>
      <pubDate>${new Date(item.created_at).toUTCString()}</pubDate>
      <description>${escapeXml(`<a href="${item.commit}">${item.title}</a>`)}</description>
      <enclosure url="${
        logoOverrides[item.repo] ||
        `https://github.com/${item.repo.split("/")[0]}.png`
      }" type="image/png" length="0"/>
    </item>`
      )
      .join("")}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
};

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
