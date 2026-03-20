# Manual Image Solver プロジェクトガイド

## 1. プロジェクト構成

```
manual-image-solver/
├── javascript/
│   ├── ManualImageSolver.js       # PJSR メイン（ネイティブ Dialog で全操作完結）
│   ├── wcs_math.js                # WCS 数学関数（PJSR + Node.js 両対応）
│   ├── wcs_keywords.js            # FITS WCS キーワードユーティリティ（PJSR 専用）
│   └── catalog_data.js            # 組み込みカタログデータ（PJSR + Node.js 両対応）
├── tests/
│   └── javascript/
│       ├── test_wcs_math.js       # Node.js 単体テスト（WCS 数学関数）
│       ├── test_parse_coords.js   # Node.js 単体テスト（座標パース + MTF）
│       ├── test_catalog_data.js   # Node.js 単体テスト（カタログデータ整合性）
│       └── ManualSolverTest.js    # PJSR 統合テスト
├── docs/
│   ├── setup.md                   # セットアップガイド
│   ├── specs.md                   # 技術仕様書
│   ├── architecture.md            # プロジェクトガイド（本ドキュメント）
│   ├── tests.md                   # テスト手順書
│   └── images/                    # スクリーンショット
├── repository/
│   ├── ManualImageSolver-x.x.x.zip  # PixInsight リポジトリ配布用 ZIP
│   └── updates.xri                  # PixInsight アップデート定義
├── build-release.sh               # リリースビルドスクリプト
└── .gitignore
```

## 2. テスト

### Node.js 単体テスト

```bash
# WCS 数学関数の精度検証
node tests/javascript/test_wcs_math.js

# 座標パース + MTF
node tests/javascript/test_parse_coords.js

# カタログデータ整合性チェック
node tests/javascript/test_catalog_data.js
```

### PJSR 統合テスト

PixInsight コンソールで実行:

**Script > Run Script File...** → `tests/javascript/ManualSolverTest.js`

WCS キーワード適用、セントロイド計算、Sesame 検索の統合テストを実行します。

### テスト方針

- **Node.js 単体テスト**: WCS 数学関数の精度検証、座標パース・MTF、カタログデータ整合性
- **PJSR 統合テスト**: WCS キーワード適用、セントロイド計算、Sesame 検索（PixInsight コンソールで実行）
- **E2E テスト（手動）**: 実画像での座標精度確認

## 3. 外部依存

- PixInsight 1.8.9+（PJSR スクリプト用）
- Node.js（テスト実行用、オプション）

## 4. コーディング規約

- **ES5 スタイル必須**: `var` 宣言、`function` 式。PJSR は `let`/`const`/アロー関数を未サポート
- **コード言語**: 変数名・関数名・コメント・コンソール出力は英語
- **PJSR + Node.js 両対応**: `wcs_math.js` と `catalog_data.js` は `#include` と `require` の両方で動作
- **Node.js エクスポート**: ファイル末尾で `if (typeof module !== "undefined") { module.exports = {...}; }`
