#!/usr/bin/env bash

set -euo pipefail

branch="${DEPLOY_BRANCH:-master}"
commit_message="${1:-upd}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

echo "==> Building PWA"
(cd web && npm ci && npm run build)

if [ -n "$(git status --porcelain)" ]; then
    echo "==> Committing release"
    git add -A
    git commit -m "$commit_message"
fi

echo "==> Pushing to origin/${branch}"
git push origin "$branch"

git fetch origin "$branch"
local_revision="$(git rev-parse HEAD)"
remote_revision="$(git rev-parse "origin/${branch}")"
if [ "$local_revision" != "$remote_revision" ]; then
    echo "ERROR: Local HEAD is not the version published to origin/${branch}."
    exit 1
fi

echo "==> Cloudflare Pages automatically deploys this commit"
echo "    https://dash.cloudflare.com/d3c8fb69e1cf31f9557c3862056856b7/pages/view/weact-power-monitor/deployments"
