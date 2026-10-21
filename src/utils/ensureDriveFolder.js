import { cleanDrivePath } from "./oneDrivePaths.js";

export function encodeGraphPath(path) {
  return cleanDrivePath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Create each missing folder in an OneDrive path. Existing folders are left
 * alone. This never lists or renames any other folder.
 */
export async function ensureDriveFolder(fetchImpl, { graphEndpoint, token, folderPath }) {
  const segments = cleanDrivePath(folderPath).split("/").filter(Boolean);
  let built = "";
  for (const segment of segments) {
    const next = built ? `${built}/${segment}` : segment;
    const probe = await fetchImpl(`${graphEndpoint}/me/drive/root:/${encodeGraphPath(next)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (probe.ok) {
      const item = await probe.json().catch(() => ({}));
      if (!item.folder) return { ok: false, reason: "path-not-folder" };
      built = next;
      continue;
    }
    if (probe.status !== 404) return { ok: false, reason: "folder-check-failed", status: probe.status };
    const parentUrl = built
      ? `${graphEndpoint}/me/drive/root:/${encodeGraphPath(built)}:/children`
      : `${graphEndpoint}/me/drive/root/children`;
    const create = await fetchImpl(parentUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: segment,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    if (!create.ok && create.status !== 409) {
      return { ok: false, reason: "folder-create-failed", status: create.status };
    }
    built = next;
  }
  return { ok: true, path: built };
}
