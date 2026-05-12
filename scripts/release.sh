#!/bin/bash
# 用法: bash scripts/release.sh 1.0.4

set -e

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "用法: bash scripts/release.sh <版本号>"
  echo "例如: bash scripts/release.sh 1.0.4"
  exit 1
fi

echo "==> 更新版本号到 $VERSION"

# 更新 package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json

# 更新 Cargo.toml
sed -i "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

# 更新 tauri.conf.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

echo "==> 提交并推送"
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "release: v$VERSION"
git push origin dev

echo "==> 打 tag 触发自动发布"
git tag "v$VERSION"
git push origin "v$VERSION"

echo ""
echo "Done! v$VERSION 已推送，GitHub Actions 正在构建发布。"
echo "查看进度: https://github.com/lyy1010e/ServicePilot/actions"
