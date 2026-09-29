#!/usr/bin/env python3
"""Push a single file update to GitHub via the Git Data API (no local git needed)."""
import base64, json, sys, urllib.request
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

ALLOWED = ["api.github.com"]
API = "https://api.github.com"
OWNER, REPO = "Kayforkind", "NavigatorsLab-PDF-Studio"

def api(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    if data: req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/vnd.github+json")
    add_surrogate_to_request(req, "custom.github", entry_name="access_token", allowed_hosts=ALLOWED)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return read_json_response(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: HTTP {e.code}: {e.read().decode()[:400]}")

def main():
    local_path, repo_path, message = sys.argv[1], sys.argv[2], sys.argv[3]
    base = f"/repos/{OWNER}/{REPO}"
    ref = api("GET", f"{base}/git/ref/heads/main")
    head_sha = ref["object"]["sha"]
    commit = api("GET", f"{base}/git/commits/{head_sha}")
    base_tree = commit["tree"]["sha"]
    with open(local_path, "rb") as f:
        content = base64.b64encode(f.read()).decode()
    blob = api("POST", f"{base}/git/blobs", {"content": content, "encoding": "base64"})
    tree = api("POST", f"{base}/git/trees", {
        "base_tree": base_tree,
        "tree": [{"path": repo_path, "mode": "100644", "type": "blob", "sha": blob["sha"]}],
    })
    new_commit = api("POST", f"{base}/git/commits", {
        "message": message, "tree": tree["sha"], "parents": [head_sha],
    })
    api("PATCH", f"{base}/git/refs/heads/main", {"sha": new_commit["sha"]})
    print("pushed:", new_commit["sha"])

if __name__ == "__main__":
    main()
