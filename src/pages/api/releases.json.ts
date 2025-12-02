import type { APIRoute } from "astro";
import { Octokit } from "octokit";

import type { ReleaseInfo, ReturnData } from "../../types";

const LIMIT = 300;

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
  const githubLogin = import.meta.env.PUBLIC_LOGIN || "antfu";

  if (!githubToken) {
    console.warn("⚠️ GITHUB_TOKEN not found. Returning empty release list.");
    return new Response(
      JSON.stringify({
        infos: [],
        lastUpdated: 0,
        lastFetched: Date.now(),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const octokit = new Octokit({
    auth: githubToken,
  });

  let infos: ReleaseInfo[] = [];
  let lastUpdated = 0;

  async function getDataAtPage(page = 1): Promise<ReleaseInfo[]> {
    try {
      console.log(`📡 Fetching page ${page} for user: ${githubLogin}`);
      const { data } = await octokit.request("GET /users/{username}/events", {
        username: githubLogin,
        per_page: 100,
        page,
      });

      console.log(`✅ Received ${data.length} events on page ${page}`);

      const pushEvents = data.filter(
        (item) => item.type === "PushEvent" && item.public
      );
      console.log(`   Found ${pushEvents.length} push events`);

      const releases = pushEvents
        .map((i) => {
          const created_at = +new Date(i.created_at || 0);
          if (lastUpdated < created_at) lastUpdated = created_at;
          return {
            ...i,
            created_at,
          };
        })
        .filter((item) => {
          const ref = (item.payload as any)?.ref;
          return refs.includes(ref);
        })
        .flatMap((item): ReleaseInfo[] => {
          const payload: any = item.payload || {};
          const commits = payload.commits || [];

          return commits
            .map((commit: any) => {
              const message = commit?.message || "";
              const title = message.split("\n")[0];

              // More flexible version matching - matches patterns like:
              // "release v1.0.0", "ci: release @package/name v1.0.0", "chore: release 1.0.0"
              const versionMatch = title.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
              const version = versionMatch ? versionMatch[1] : "";

              // Try to extract package name from patterns like:
              // "@scope/package v1.0.0" or "release @scope/package v1.0.0"
              const packageMatch =
                title.match(/(@?[\w-]+\/[\w-]+)[\s@]v?\d+\.\d+\.\d+/) ||
                title.match(/release\s+(@?[\w-]+)/);
              const packageName = packageMatch ? packageMatch[1] : "";

              return {
                id: item.id,
                type: item.type!,
                repo: item.repo.name,
                isOrg: item.org !== undefined,
                title,
                sha: commit?.sha || "",
                commit: `https://github.com/${item.repo.name}/commit/${commit?.sha}`,
                created_at: item.created_at,
                version,
                package: packageName,
              };
            })
            .filter((item: ReleaseInfo) => {
              // Filter for releases - must have "release" in title AND a valid version
              const hasRelease = item.title.toLowerCase().includes("release");
              const hasVersion = item.version && item.version.length > 0;
              return hasRelease && hasVersion;
            });
        });

      console.log(`   Extracted ${releases.length} releases from commits`);

      return releases;
    } catch (error) {
      console.error(`❌ Error fetching page ${page}:`, error);
      throw error;
    }
  }

  try {
    console.log("🚀 Starting to fetch releases...");

    for (let page = 1; page <= 3; page++) {
      const items = await getDataAtPage(page);
      infos.push(...items);
    }

    console.log(`📊 Total releases found before dedup: ${infos.length}`);

    // Remove duplicates by ID
    const uniqueInfos = Array.from(
      new Map(infos.map((item) => [item.id, item])).values()
    );

    console.log(`📊 Total unique releases: ${uniqueInfos.length}`);

    // Sort from newest to oldest
    uniqueInfos.sort((a, b) => b.created_at - a.created_at);

    // Limit results
    const finalInfos = uniqueInfos.slice(0, LIMIT);

    const result: ReturnData = {
      infos: finalInfos,
      lastUpdated,
      lastFetched: Date.now(),
    };

    console.log("✅ Successfully prepared release data");
    console.log(`   Last updated: ${new Date(lastUpdated).toISOString()}`);
    console.log(`   Total releases in response: ${finalInfos.length}`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("❌ Error fetching releases:", error);
    return new Response(
      JSON.stringify({
        infos: [],
        lastUpdated: 0,
        lastFetched: Date.now(),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};
