# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

Manual Image Solver は、PixInsight の PJSR（PixInsight JavaScript Runtime）で動作する手動プレートソルブスクリプトです。astrometry.net や ImageSolver の自動ソルブが失敗する画像に対し、ユーザーが手動で星を同定して TAN 投影 WCS を算出・適用します。Python 不要、PJSR のみで完結する独立スクリプトです。

## コマンド

```bash
# Node.js 単体テスト実行
node tests/javascript/test_wcs_math.js

# PJSR 統合テストは PixInsight コンソールで実行
# Script > Run Script File... > tests/javascript/ManualSolverTest.js
```

## アーキテクチャ

### ファイル構成

| ファイル | 用途 |
|---|---|
| `javascript/ManualImageSolver.js` | PJSR メインスクリプト（UI + WCS フィッティング + 適用） |
| `javascript/wcs_math.js` | WCS 数学関数ライブラリ（PJSR / Node.js 両対応） |
| `tests/javascript/test_wcs_math.js` | Node.js 単体テスト（55テスト） |
| `tests/javascript/ManualSolverTest.js` | PJSR 統合テスト（PixInsight 上で実行） |

### 処理フロー

1. ユーザーが画像プレビュー上で星をクリック
2. セントロイド計算（輝度重心法）でサブピクセル精度の星中心を取得
3. StarEditDialog で天体名検索（CDS Sesame）または RA/DEC 直接入力
4. 4星以上揃ったら WCSFitter.solve() で TAN 投影 WCS をフィッティング
5. applyWCS() で FITS キーワードを画像に書き込み、regenerateAstrometricSolution() で表示更新

### WCS フィッティングの数学

- **TAN（gnomonic）投影**: `tanProject()` / `tanDeproject()` で天球座標 ↔ 標準座標を変換
- **CD行列フィット**: 2つの独立した2変数線形回帰をクレーメルの公式で直接解く（行列ライブラリ不要）
- **CRVAL 決定**: 星の天球座標のベクトル平均を初期値とし、残差重心で反復更新（5回）
- **座標系**: PJSR ピクセルは 0-based、FITS CRPIX は 1-based。フィット時に +1 補正が必要

### 主要関数（wcs_math.js）

- `tanProject(crval, coord)` — 天球座標 → 標準座標（TAN投影）
- `tanDeproject(crval, standard)` — 標準座標 → 天球座標（TAN逆投影）
- `angularSeparation(coord1, coord2)` — 角距離計算（Vincenty 公式）
- `WCSFitter(starPairs, imageWidth, imageHeight).solve()` — WCS フィッティング
- `computeCentroid(image, cx, cy, radius)` — セントロイド計算（PJSR 専用）

### ユーティリティ関数（SplitImageSolver.js から再利用）

- `raToHMS()` / `decToDMS()` — 座標表示変換
- `parseRAInput()` / `parseDECInput()` — 座標パース
- `searchObjectCoordinates()` — CDS Sesame 天体名検索
- `isWCSKeyword()` / `makeFITSKeyword()` — FITS キーワード操作

### 実装上の重要な注意点

- **0-based vs 1-based**: PJSR の `Image.sample(x, y)` は 0-based。FITS の CRPIX は 1-based。`WCSFitter` 内で `stars[i].px + 1.0` として補正。
- **RA のラップアラウンド**: RA の平均値計算はベクトル平均（cos/sin）を使用。単純な算術平均では 0°/360° 境界で不正確になる。
- **PJSR 固有 API**: `Image.sample()`, `Image.render()`, `ImageWindow`, `FITSKeyword`, `ExternalProcess` 等は PJSR 専用。`wcs_math.js` はこれらを使わず純粋 JS で記述。
- **SIP 歪み補正**: 現在未実装（Phase 3 予定）。広角で精度が必要な場合に追加。

## テスト方針

- **単体テスト（Node.js）**: 数学関数の精度検証。PixInsight 不要。
- **統合テスト（PJSR）**: WCS キーワード適用、セントロイド計算、Sesame 検索。数学精度の検証は単体テストに委譲し、重複しない。
- **E2E テスト（手動）**: 実画像での座標精度確認。手順は `docs/tests.md` に記載。
