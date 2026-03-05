# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Manual Image Solver は手動プレートソルブツール。Python 不要、PixInsight の PJSR ネイティブ Dialog 内で全操作が完結する純粋 JavaScript 実装:

1. **ManualImageSolver.js** (PJSR): メインスクリプト。画像表示、星クリック選択、セントロイド計算、WCS フィッティング、WCS 適用を全て PJSR Dialog 内で実行
2. **wcs_math.js**: TAN投影、WCSFitter、セントロイド計算の数学ライブラリ（PJSR + Node.js 両対応）
3. **WCSApplier.js** (PJSR): スタンドアロン JSON → WCS 適用（独立ツールとして維持）

```
PixInsight（PJSR ネイティブ、外部プロセス不要）
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
- **`javascript/wcs_keywords.js`**: FITS WCS キーワードユーティリティ（`isWCSKeyword`, `makeFITSKeyword`）。ManualImageSolver.js と WCSApplier.js の両方から `#include` で共有。PJSR 専用。
- **`javascript/ManualImageSolver.js`**: メインスクリプト。全 UI を PJSR Dialog で構築。
  - `ImagePreviewControl` (ScrollBox): スクロール状態を手動管理（scrollX/scrollY）、ズーム/パン/クリック
  - `StarEditDialog` (Dialog): 天体名入力 + Sesame 検索 + RA/DEC 入力
  - `ManualSolverDialog` (Dialog): メイン UI（ツールバー + 画像 + 星テーブル + ボタン）
- **`javascript/WCSApplier.js`**: スタンドアロン JSON → WCS 適用

### 主要機能

- **ストレッチモード切替**: None / Linked / Unlinked の3モードを PushButton で切替。median + MAD ベースの STF → MTF で Bitmap 生成
- **セッション保存・復元**: Settings API（キー: `ManualImageSolver/sessionData`）で星ペアデータとストレッチモードを自動保存。再起動時に復元提案
- **Export / Import**: 星ペアデータを JSON ファイルに書き出し・読み込み。他画像や作業引き継ぎに利用可能
- **クリック＝星選択、ドラッグ＝パン**: モード切替不要。4px の DRAG_THRESHOLD でクリックとドラッグを自動判別
- **ズーム**: 1:1 ズームボタン、19段階の細かいズームレベル（1/16x ～ 8x）、画面中心基準ズーム、マウスホイールはカーソル位置基準ズーム

### WCS フィッティングの数学

- **TAN（gnomonic）投影**: `tanProject()` / `tanDeproject()` で天球座標 ↔ 標準座標を変換
- **CD行列フィット**: 2つの独立した2変数線形回帰をクレーメルの公式で直接解く
- **CRVAL 決定**: 星の天球座標のベクトル平均を初期値とし、残差重心で反復更新（5回）
- **座標系**: ピクセル座標は 0-based（PixInsight: y=0 が画像上端）、FITS は 1-based（y=1 が画像下端）。フィット時に X は `px + 1`、Y は `height - py` で変換
- 詳細は `docs/specs.md` 参照

### 実装上の重要な注意点

- **ピクセル→FITS 座標変換**: PixInsight のピクセル座標は 0-based で y=0 が画像上端。標準 FITS 座標系は 1-based で y=1 が画像下端。`WCSFitter` 内で `u = (px + 1) - CRPIX1`、`v = (height - py) - CRPIX2` として変換。X は +1 のみ、Y は上下反転が必要。
- **ScrollBox の手動スクロール管理**: PJSR の ScrollBox は `setScrollPosition()` がビューポートリサイズ後に正しく動作しないため、`scrollX` / `scrollY` でスクロール状態を手動管理。`autoScrolls` は無効化し、`onPaint` で描画オフセットを直接制御。
- **クリック vs ドラッグ判定**: `mouseDown` で開始座標を記録、`mouseMove` で 4px（`DRAG_THRESHOLD`）を超えたらドラッグモードに遷移。超えなければ `mouseUp` でクリック（星選択）として処理。
- **RA のラップアラウンド**: RA の平均値計算はベクトル平均（cos/sin）を使用。
- **オートストレッチ**: median + MAD ベースの STF パラメータ → MTF（中間調転送関数）で Bitmap 生成。大画像は MAX_BITMAP_EDGE (2048px) に縮小。
- **座標パース**: `parseRAInput()` は HMS (スペース/コロン区切り) と度数の両方を受け付け。`parseDECInput()` は ±DMS と度数の両方。
- **SIP 歪み補正**: 近似モード（approx）と補間モード（interp）の2モード。近似モードは 6星以上で SIP order 2、10星以上で order 3。補間モードは TAN-only RMS がピクセルスケールの5倍以上のとき自動選択、項数≥星数の高次 SIP で全制御点を正確に通る最小ノルム解を使用。CD 行列と SIP 係数の反復精密化（最大10回）で収束。逆 SIP (AP, BP) も計算し PixInsight の `regenerateAstrometricSolution()` 対応。

## テスト方針

- **Node.js 単体テスト**: WCS 数学関数の精度検証（`test_wcs_math.js`）、座標パース・MTF（`test_parse_coords.js`）
- **PJSR 統合テスト**: WCS キーワード適用、セントロイド計算、Sesame 検索（PixInsight コンソールで実行）
- **E2E テスト（手動）**: 実画像での座標精度確認

## 外部依存

- PixInsight 1.8.9+（PJSR スクリプト用）
- Node.js（テスト実行用、オプション）
