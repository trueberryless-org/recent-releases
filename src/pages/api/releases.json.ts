import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { Octokit } from "octokit";

// Definiere dein reduziertes Schema hier direkt oder importiere es
type Release = {
  title: string;
  sha: string;
  commit: string;
  created_at: number;
  version: string;
  package: string;
};

const LIMIT = 300;
const STORAGE_OWNER = "trueberryless-org";
const STORAGE_REPO = "recent-releases";
const STORAGE_PATH = "src/data/releases.json";

const refs = [
  "refs/heads/main",
  "refs/heads/master",
  "refs/heads/latest",
  "refs/heads/stable",
  "refs/heads/release",
  "refs/heads/dev",
];

export const GET: APIRoute = async () => {
  const githubToken = import.meta.env.GITHUB_TOKEN;
  const githubLogin = import.meta.env.PUBLIC_LOGIN || "trueberryless";

  if (!githubToken) {
    return new Response(JSON.stringify({ error: "GITHUB_TOKEN missing" }), {
      status: 500,
    });
  }

  const octokit = new Octokit({ auth: githubToken });

  // 1. Helper: Live Events holen und ins Slim-Format wandeln
  async function fetchLiveReleases(): Promise<Release[]> {
    let gathered: Release[] = [];
    try {
      console.log("🚀 Fetching live events...");
      for (let page = 1; page <= 3; page++) {
        const { data } = await octokit.request("GET /users/{username}/events", {
          username: githubLogin,
          per_page: 100,
          page,
        });

        const pushEvents = data.filter(
          (item) => item.type === "PushEvent" && item.public
        );

        const pageReleases = pushEvents
          .filter((item) => refs.includes((item.payload as any)?.ref))
          .flatMap((item) => {
            const payload: any = item.payload || {};
            const commits = payload.commits || [];

            return commits
              .map((commit: any) => {
                const message = commit?.message || "";
                const title = message.split("\n")[0];

                // Regex Logik
                const versionMatch = title.match(
                  /v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/
                );
                const version = versionMatch ? versionMatch[1] : "";

                const packageMatch =
                  title.match(/(@?[\w-]+\/[\w-]+)[\s@]v?\d+\.\d+\.\d+/) ||
                  title.match(/release\s+(@?[\w-]+)/);
                const packageName = packageMatch ? packageMatch[1] : "";

                // Rückgabe im reduzierten Schema
                return {
                  title,
                  sha: commit?.sha || "",
                  commit: `https://github.com/${item.repo.name}/commit/${commit?.sha}`,
                  created_at: +new Date(item.created_at || 0),
                  version,
                  package: packageName,
                };
              })
              .filter((r: Release) => {
                const hasRelease = r.title.toLowerCase().includes("release");
                const hasVersion = r.version && r.version.length > 0;
                return hasRelease && hasVersion;
              });
          });

        gathered.push(...pageReleases);
      }
      return gathered;
    } catch (e) {
      console.error("Error fetching live events:", e);
      return [];
    }
  }

  try {
    // 2. Bestehende "Datenbank" (JSON) vom Repo lesen
    console.log("📂 Reading existing database...");
    let storedReleases: Release[] = [];
    let fileSha: string | undefined = undefined;

    try {
      const { data: fileData } = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: STORAGE_OWNER,
          repo: STORAGE_REPO,
          path: STORAGE_PATH,
        }
      );

      if (!Array.isArray(fileData) && fileData.content) {
        // Base64 decodieren, um das JSON zu lesen
        const contentString = Buffer.from(fileData.content, "base64").toString(
          "utf-8"
        );
        storedReleases = JSON.parse(contentString);
        fileSha = fileData.sha;
      }
    } catch (error: any) {
      if (error.status !== 404) throw error;
      console.log("⚠️ No database found, starting fresh.");
    }

    // 3. Mergen: Live + Stored
    const liveReleases = await fetchLiveReleases();
    const allReleases = [...liveReleases, ...storedReleases];

    // Deduplizieren basierend auf SHA
    const uniqueMap = new Map<string, Release>();
    allReleases.forEach((item) => {
      // Wenn der SHA schon existiert, überschreiben wir ihn nicht (oder doch, egal da identisch)
      if (item.sha && !uniqueMap.has(item.sha)) {
        uniqueMap.set(item.sha, item);
      }
    });

    const finalInfos = Array.from(uniqueMap.values());

    // Sortieren: Neueste oben
    finalInfos.sort((a, b) => b.created_at - a.created_at);

    // 4. Update schreiben (nur wenn neue Daten erkannt wurden)
    // Wir vergleichen einfach die Länge. (Genauer wäre Vergleich der Top-SHA, aber Länge reicht meist)
    if (finalInfos.length > storedReleases.length) {
      console.log(`💾 Saving ${finalInfos.length} releases to GitHub...`);

      // JSON -> String -> Base64 encodieren für den Transport
      const newContentBase64 = Buffer.from(
        JSON.stringify(finalInfos, null, 2)
      ).toString("base64");

      await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
        owner: STORAGE_OWNER,
        repo: STORAGE_REPO,
        path: STORAGE_PATH,
        message: `chore: update releases database [${new Date().toISOString()}]`,
        content: newContentBase64,
        sha: fileSha, // Nötig für das Update
        committer: {
          name: "Release-Bot",
          email: "bot@trueberryless.org",
        },
      });
      console.log("✅ Database updated.");
    }

    // Response ans Frontend (limitiert auf 300 für Performance)
    const responseInfos = finalInfos.slice(0, LIMIT);

    return new Response(
      JSON.stringify({
        infos: responseInfos,
        lastUpdated: finalInfos.length > 0 ? finalInfos[0].created_at : 0,
        lastFetched: Date.now(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
