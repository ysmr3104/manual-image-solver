#!/bin/bash
#
# build-release.sh - PixInsight リポジトリ配布パッケージのビルドスクリプト
#
# 使い方: bash build-release.sh
#
# 生成物:
#   repository/ManualImageSolver-{VERSION}.zip  - 配布パッケージ
#   repository/updates.xri                       - リポジトリ情報 XML
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="1.1.1"
PACKAGE_NAME="ManualImageSolver"
ZIP_NAME="${PACKAGE_NAME}-${VERSION}.zip"
REPO_DIR="${SCRIPT_DIR}/repository"
TMPDIR_BASE="${SCRIPT_DIR}/.build-tmp"

echo "=== ${PACKAGE_NAME} v${VERSION} リリースビルド ==="

# 1. repository/ ディレクトリ作成
mkdir -p "${REPO_DIR}"

# 2. 一時ディレクトリに PixInsight インストール構造を作成
rm -rf "${TMPDIR_BASE}"
mkdir -p "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}"

# 3. JavaScript ファイルをコピー
cp "${SCRIPT_DIR}/javascript/ManualImageSolver.js" "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/wcs_math.js"           "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/WCSApplier.js"          "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/wcs_keywords.js"        "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"

echo "ファイルをコピーしました:"
ls -la "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"

# 4. zip 作成
cd "${TMPDIR_BASE}"
rm -f "${REPO_DIR}/${ZIP_NAME}"
zip -r "${REPO_DIR}/${ZIP_NAME}" src/
cd "${SCRIPT_DIR}"

echo "zip を作成しました: repository/${ZIP_NAME}"

# 5. SHA1 計算
SHA1=$(shasum "${REPO_DIR}/${ZIP_NAME}" | awk '{print $1}')
echo "SHA1: ${SHA1}"

# 6. 現在日付
RELEASE_DATE=$(date +%Y%m%d)

# 7. updates.xri を生成
cat > "${REPO_DIR}/updates.xri" << XMLEOF
<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <title>Manual Image Solver</title>
      <brief_description>Manual plate solver for PixInsight</brief_description>
   </description>
   <platform os="all" arch="noarch" version="1.8.9:9.9.9">
      <package fileName="${ZIP_NAME}"
               sha1="${SHA1}"
               type="script"
               releaseDate="${RELEASE_DATE}">
         <title>Manual Image Solver</title>
         <description>
            <p>Manual plate solver: interactively identify stars and compute a TAN-projection WCS solution.</p>
         </description>
      </package>
   </platform>
</xri>
XMLEOF

echo "updates.xri を生成しました"

# 8. 一時ディレクトリ削除
rm -rf "${TMPDIR_BASE}"

echo ""
echo "=== ビルド完了 ==="
echo "  ${REPO_DIR}/${ZIP_NAME}"
echo "  ${REPO_DIR}/updates.xri"
echo "  SHA1: ${SHA1}"
