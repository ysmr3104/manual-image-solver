#!/bin/bash
#
# build-release.sh - PixInsight リポジトリ配布パッケージのビルドスクリプト
#
# 使い方: bash build-release.sh
#
# 生成物:
#   repository/ManualImageSolver-{VERSION}.zip  - 配布パッケージ（V8版、1.9.4+）
#   repository/ManualImageSolver-1.4.1.zip       - レガシーパッケージ（SpiderMonkey版、〜1.9.3）
#   repository/updates.xri                       - リポジトリ情報 XML（2 platform ブロック）
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAIN_SCRIPT="${SCRIPT_DIR}/javascript/ManualImageSolver.js"
VERSION=$(grep '#define VERSION' "$MAIN_SCRIPT" | sed 's/.*"\(.*\)".*/\1/')
PACKAGE_NAME="ManualImageSolver"
ZIP_NAME="${PACKAGE_NAME}-${VERSION}.zip"
REPO_DIR="${SCRIPT_DIR}/repository"
TMPDIR_BASE="${SCRIPT_DIR}/.build-tmp"

# Legacy package (PixInsight ≤1.9.3, SpiderMonkey engine)
LEGACY_ZIP_NAME="${PACKAGE_NAME}-1.4.1.zip"
LEGACY_SHA1="47b4b3dc819237e0eefcc1c5d02dc019b120b7f1"
LEGACY_RELEASE_DATE="20260324"
LEGACY_VERSION_RANGE="1.8.9:1.9.3"
# Current package (PixInsight ≥1.9.4, V8 engine)
CURRENT_VERSION_RANGE="1.9.4:9.9.9"

echo "=== ${PACKAGE_NAME} v${VERSION} リリースビルド ==="

# 0. 署名の検査
# 署名は #include を展開したあとのコードにかかり、無効な #ifdef の中の #include も
# 解決される。PixInsight 同梱のファイル（../AdP/、<pjsr/...> など）を取り込むと、
# PixInsight の更新で署名が無効になる（SplitImageSolver 2.0.1 が 1.9.5 で
# "Invalid code signature" になった。pixinsight-handbook の lessons.md）
SIGNATURE="${SCRIPT_DIR}/javascript/ManualImageSolver.xsgn"
# 署名の対象になるファイル（本体と、本体が #include するもの）
SIGNED_SOURCES=(
    "${MAIN_SCRIPT}"
    "${SCRIPT_DIR}/javascript/wcs_math.js"
    "${SCRIPT_DIR}/javascript/wcs_keywords.js"
    "${SCRIPT_DIR}/javascript/catalog_data.js"
)
# 許可するのは同じディレクトリのファイル名だけの #include。それ以外（"../"、絶対パス、
# <...>、サブディレクトリ経由）は PixInsight 同梱ファイルを取り込みうるので止める
if grep -nE '^[[:space:]]*#include' "${SIGNED_SOURCES[@]}" \
        | grep -vE ':[[:space:]]*#include[[:space:]]+"[A-Za-z0-9_]+\.(js|jsh)"'; then
    echo "ERROR: 同じディレクトリ以外のファイルを #include しています（上の行）。署名が PixInsight の版に縛られます" >&2
    exit 1
fi
# 本体が #include するのは上の 3 本だけであること（増えたら SIGNED_SOURCES に足す）
INCLUDED=$( (grep -hE '^[[:space:]]*#include' "${MAIN_SCRIPT}" || true) | sed -E 's/.*"([^"]+)".*/\1/' | sort | tr '\n' ' ')
if [ "${INCLUDED}" != "catalog_data.js wcs_keywords.js wcs_math.js " ]; then
    echo "ERROR: 本体の #include が想定と違う: ${INCLUDED}（SIGNED_SOURCES を見直すこと）" >&2
    exit 1
fi
# include 先がさらに #include すると、そのファイルが新旧の判定から漏れるので止める
if grep -nE '^[[:space:]]*#include' "${SIGNED_SOURCES[@]:1}"; then
    echo "ERROR: include 先がさらに #include しています（上の行）。SIGNED_SOURCES に足してから検査を見直すこと" >&2
    exit 1
fi
if [ ! -f "${SIGNATURE}" ]; then
    echo "ERROR: ${SIGNATURE} がありません。先に署名してください" >&2
    exit 1
fi
for SRC in "${SIGNED_SOURCES[@]}"; do
    if [ "${SIGNATURE}" -ot "${SRC}" ]; then
        echo "ERROR: 署名が $(basename "${SRC}") より古い。署名し直してください" >&2
        exit 1
    fi
done
# mtime の比較は完全ではない（clone 直後など）。最後の砦は配信前の
# Security.getScriptSignature() による検証（pixinsight-handbook/docs/release.md）

# 1. repository/ ディレクトリ作成
mkdir -p "${REPO_DIR}"

# 2. 一時ディレクトリに PixInsight インストール構造を作成
rm -rf "${TMPDIR_BASE}"
mkdir -p "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}"

# 3. JavaScript ファイルをコピー
cp "${SCRIPT_DIR}/javascript/ManualImageSolver.js"   "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/ManualImageSolver.xsgn" "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/wcs_math.js"            "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/wcs_keywords.js"        "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"
cp "${SCRIPT_DIR}/javascript/catalog_data.js"        "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"

echo "ファイルをコピーしました:"
ls -la "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"

# 4. 現バージョン zip を作成（同名ファイルのみ削除して再生成）
rm -f "${REPO_DIR}/${ZIP_NAME}"
cd "${TMPDIR_BASE}"
zip -r "${REPO_DIR}/${ZIP_NAME}" src/
cd "${SCRIPT_DIR}"

echo "zip を作成しました: repository/${ZIP_NAME}"

# 5. SHA1 計算
SHA1=$(shasum "${REPO_DIR}/${ZIP_NAME}" | awk '{print $1}')
echo "SHA1: ${SHA1}"

# 6. Legacy zip を確保（なければ ysmrastro/pixinsight-scripts からダウンロード）
if [[ ! -f "${REPO_DIR}/${LEGACY_ZIP_NAME}" ]]; then
    echo "Legacy zip をダウンロード中: ${LEGACY_ZIP_NAME}"
    DOWNLOAD_URL=$(gh api "repos/ysmrastro/pixinsight-scripts/contents/${LEGACY_ZIP_NAME}" --jq '.download_url')
    curl -fsSL "${DOWNLOAD_URL}" -o "${REPO_DIR}/${LEGACY_ZIP_NAME}"
fi

LEGACY_SHA1_CHECK=$(shasum "${REPO_DIR}/${LEGACY_ZIP_NAME}" | awk '{print $1}')
if [[ "${LEGACY_SHA1_CHECK}" != "${LEGACY_SHA1}" ]]; then
    echo "エラー: ${LEGACY_ZIP_NAME} の SHA1 が一致しません"
    echo "  期待: ${LEGACY_SHA1}"
    echo "  実際: ${LEGACY_SHA1_CHECK}"
    exit 1
fi
echo "Legacy zip 確認済み: ${LEGACY_ZIP_NAME}"

# 7. 現在日付
RELEASE_DATE=$(date +%Y%m%d)

# 8. updates.xri を生成（2 platform ブロック構成）
cat > "${REPO_DIR}/updates.xri" << XMLEOF
<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <title>Manual Image Solver</title>
      <brief_description>Manual plate solver for PixInsight</brief_description>
   </description>
   <platform os="all" arch="noarch" version="${LEGACY_VERSION_RANGE}">
      <package fileName="${LEGACY_ZIP_NAME}"
               sha1="${LEGACY_SHA1}"
               type="script"
               releaseDate="${LEGACY_RELEASE_DATE}">
         <title>Manual Image Solver</title>
         <description>
            <p>Manual plate solver: interactively identify stars and compute a TAN-projection WCS solution.</p>
         </description>
      </package>
   </platform>
   <platform os="all" arch="noarch" version="${CURRENT_VERSION_RANGE}">
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

# 9. 一時ディレクトリ削除
rm -rf "${TMPDIR_BASE}"

echo ""
echo "=== ビルド完了 ==="
echo "  ${REPO_DIR}/${LEGACY_ZIP_NAME} (legacy, ${LEGACY_VERSION_RANGE})"
echo "  ${REPO_DIR}/${ZIP_NAME} (current, ${CURRENT_VERSION_RANGE})"
echo "  ${REPO_DIR}/updates.xri"
echo "  SHA1 (current): ${SHA1}"
