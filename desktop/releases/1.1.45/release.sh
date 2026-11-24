#!/usr/bin/env bash
set -euo pipefail
tag=v1.1.45
dir=desktop/releases/1.1.45
name=PERRY-Update-1.1.45.exe
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$dir"
cp "$name" "$tmp/PERRY-Setup.exe"
latest=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)
if [[ "$latest" != v1.1.44 && "$latest" != "$tag" ]]; then
  echo "Il canale è già avanzato a un'altra release"; exit 1
fi
test "$(sha256sum "$name" | cut -d' ' -f1)" = "76c8fbfbf2b46efb7ef14f136f3a28f64590eae46ede77bd4e5369e07c6fd949"
if gh release view "$tag" --json isDraft >"$tmp/state.json" 2>/dev/null; then
  echo "Verifico gli asset presenti nella release esistente."
else
  gh release create "$tag" "$name" "$name.blockmap" latest.yml "$tmp/PERRY-Setup.exe" \
    --draft --target "$GITHUB_SHA" --title 'PERRY 1.1.45' \
    --notes-file NOTE.md
fi
mkdir "$tmp/check"
gh release download "$tag" --dir "$tmp/check" --pattern "$name" --pattern "$name.blockmap" --pattern latest.yml --pattern PERRY-Setup.exe
cmp latest.yml "$tmp/check/latest.yml"
cmp "$name" "$tmp/check/$name"
cmp "$name.blockmap" "$tmp/check/$name.blockmap"
cmp "$name" "$tmp/check/PERRY-Setup.exe"
if [[ $(gh release view "$tag" --json isDraft --jq .isDraft) == true ]]; then
  test "$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)" = v1.1.44
  gh release edit "$tag" --draft=false --latest
fi
test "$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)" = "$tag"
for i in {1..12}; do
  if curl --silent --show-error --fail --location --proto '=https' "https://github.com/$GITHUB_REPOSITORY/releases/latest/download/latest.yml?verify=$GITHUB_RUN_ID-$i" -o "$tmp/public.yml" && cmp --silent latest.yml "$tmp/public.yml"; then
    echo 'Il canale pubblico serve il manifest della 1.1.45.'; exit 0
  fi
  sleep 5
done
echo 'Manifest pubblico non verificato'; exit 1
