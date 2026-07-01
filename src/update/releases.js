export async function latestRelease(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("https://api.github.com/repos/taimoorq/logister-cli/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "logister-cli"
    }
  });
  if (response.status === 404) return { version: null, published: false };
  if (!response.ok) throw new Error(`GitHub release check failed with HTTP ${response.status}`);

  const release = await response.json();
  return {
    version: release.tag_name?.replace(/^v/, "") || null,
    tag: release.tag_name,
    url: release.html_url,
    published_at: release.published_at
  };
}
