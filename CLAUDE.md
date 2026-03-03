# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Manual Image Solver は手動プレートソルブツール。PixInsight の PJSR ネイティブ Dialog 内で全操作が完結する:

1. **ManualImageSolver.js** (PJSR): メインスクリプト。画像表示、星クリック選択、セントロイド計算、WCS フィッティング、WCS 適用を全て PJSR Dialog 内で実行
2. **wcs_math.js**: TAN投影、WCSFitter、セントロイド計算の数学ライブラリ（PJSR + Node.js 両対応）
3. **WCSApplier.js** (PJSR): スタンドアロン JSON → WCS 適用（独立ツールとして維持）

```
PixInsight
┌─────────────────────────────────────────────┐
│ 1. 画像を開く                                │
│ 2. Script > Utilities > ManualImageSolver    │
│ 3. Dialog 内で画像表示 + 星クリック + 座標入力  │
│ 4. Solve（WCS フィッティング）                │
│ 5. Apply to Image（WCS キーワード適用）       │
│ 6. 完了                                      │
└─────────────────────────────────────────────┘
```

## コマンド

```bash
# Node.js 単体テスト実行（WCS 数学関数）
node tests/javascript/test_wcs_math.js

# Node.js 単体テスト実行（座標パース + MTF）
node tests/javascript/test_parse_coords.js

# PJSR 統合テストは PixInsight コンソールで実行
# Script > Run Script File... > tests/javascript/ManualSolverTest.js
```

## アーキテクチャ

### PJSR ネイティブ構成（JavaScript のみ）

- **`javascript/wcs_math.js`**: WCS 数学ライブラリ。`#include` で ManualImageSolver.js に取り込み。**PJSR と Node.js の両方**で動作する純粋 JavaScript。`var` 宣言・ES5 スタイルが必須（PJSR は `let`/`const`/アロー関数を未サポート）。
- **`javascript/ManualImageSolver.js`**: メインスクリプト。全 UI を PJSR Dialog で構築。
  - `ImagePreviewControl` (ScrollBox): ストレッチ済み Bitmap 表示、ズーム/パン/クリック
  - `StarEditDialog` (Dialog): 天体名入力 + Sesame 検索 + RA/DEC 入力
  - `ManualSolverDialog` (Dialog): メイン UI（ツールバー + 画像 + 星テーブル + ボタン）
- **`javascript/WCSApplier.js`**: スタンドアロン JSON → WCS 適用

### WCS フィッティングの数学

- **TAN（gnomonic）投影**: `tanProject()` / `tanDeproject()` で天球座標 ↔ 標準座標を変換
- **CD行列フィット**: 2つの独立した2変数線形回帰をクレーメルの公式で直接解く
- **CRVAL 決定**: 星の天球座標のベクトル平均を初期値とし、残差重心で反復更新（5回）
- **座標系**: ピクセル座標は 0-based（PixInsight: y=0 が画像上端）、FITS は 1-based（y=1 が画像下端）。フィット時に X は `px + 1`、Y は `height - py` で変換
- 詳細は `docs/specs.md` 参照

### 実装上の重要な注意点

- **ピクセル→FITS 座標変換**: PixInsight のピクセル座標は 0-based で y=0 が画像上端。標準 FITS 座標系は 1-based で y=1 が画像下端。`WCSFitter` 内で `u = (px + 1) - CRPIX1`、`v = (height - py) - CRPIX2` として変換。X は +1 のみ、Y は上下反転が必要。
- **RA のラップアラウンド**: RA の平均値計算はベクトル平均（cos/sin）を使用。
- **オートストレッチ**: median + MAD ベースの STF パラメータ → MTF（中間調転送関数）で Bitmap 生成。大画像は MAX_BITMAP_EDGE (2048px) に縮小。
- **座標パース**: `parseRAInput()` は HMS (スペース/コロン区切り) と度数の両方を受け付け。`parseDECInput()` は ±DMS と度数の両方。
- **SIP 歪み補正**: 現在未実装。広角で精度が必要な場合に追加予定。

## テスト方針

- **Node.js 単体テスト**: WCS 数学関数の精度検証（`test_wcs_math.js`）、座標パース・MTF（`test_parse_coords.js`）
- **PJSR 統合テスト**: WCS キーワード適用、セントロイド計算、Sesame 検索（PixInsight コンソールで実行）
- **E2E テスト（手動）**: 実画像での座標精度確認

## 外部依存

- PixInsight 1.8.9+（PJSR スクリプト用）
- Node.js（テスト実行用、オプション）
