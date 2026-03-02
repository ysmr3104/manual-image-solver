# Manual Image Solver

PixInsight 用の手動プレートソルブスクリプト。画像上の星をユーザーが手動で同定し、TAN（gnomonic）投影の WCS（World Coordinate System）を算出して画像に適用します。

## 概要

astrometry.net や PixInsight の ImageSolver による自動プレートソルブが失敗する画像に対し、手動で星を同定して WCS を取得するためのツールです。Python 不要、**PJSR のみで完結**する独立スクリプトとして動作します。

### ワークフロー

1. PixInsight で画像を開く
2. ManualImageSolver スクリプトを起動
3. 画像プレビュー上で星をクリック → セントロイド計算でスナップ
4. 各星について天体名（CDS Sesame 検索）または RA/DEC を入力
5. 4星以上揃ったら「Solve」→ TAN 投影 WCS をフィッティング
6. 「Apply」→ WCS キーワードを画像に適用 → アストロメトリック表示を再生成

## インストール

### 前提条件

- [PixInsight](https://pixinsight.com/) 1.8.9 以降

### セットアップ

1. `javascript/ManualImageSolver.js` を PixInsight のスクリプトディレクトリにコピー（または直接パスを指定して実行）
2. PixInsight メニュー: **Script > Utilities > ManualImageSolver**

## 使い方

### 基本操作

1. PixInsight で対象画像を開く
2. **Script > Utilities > ManualImageSolver** を起動
3. 画像プレビュー上で星をクリック（セントロイドで自動スナップ）
4. StarEditDialog で天体名を入力し「Search」でCDS Sesame検索、またはRA/DECを直接入力
5. 4星以上登録したら「Solve」ボタンで WCS フィッティング
6. 残差を確認し、問題なければ「Apply」で画像に適用

### 操作方法

| 操作 | 動作 |
|---|---|
| 左クリック（小移動） | 星を選択 → StarEditDialog |
| 左ドラッグ | パン（画像移動） |
| マウスホイール | ズームイン/アウト |
| ズームボタン | +/−/全体表示 |

### 座標入力フォーマット

| 項目 | フォーマット例 |
|---|---|
| RA（HMS） | `05 14 32.27` / `05:14:32.27` |
| RA（度数） | `78.634` |
| DEC（DMS） | `+07 24 25.4` / `-08:12:05.9` |
| DEC（度数） | `7.407` / `-8.202` |

## プロジェクト構成

```
manual-image-solver/
├── javascript/
│   ├── ManualImageSolver.js   # PJSR メインスクリプト（UI + WCS適用）
│   └── wcs_math.js            # WCS 数学関数（PJSR / Node.js 両対応）
├── tests/
│   └── javascript/
│       ├── test_wcs_math.js       # Node.js 単体テスト
│       └── ManualSolverTest.js    # PJSR 統合テスト
└── docs/
    ├── specs.md               # 技術仕様書
    └── tests.md               # テスト手順書（E2Eテスト含む）
```

## テスト

### Node.js 単体テスト

```bash
node tests/javascript/test_wcs_math.js
```

TAN投影、角距離計算、WCSFitter のフィッティング精度を検証（55テスト）。

### PJSR 統合テスト

PixInsight コンソールで実行:

**Script > Run Script File...** → `tests/javascript/ManualSolverTest.js`

WCS キーワード適用、セントロイド計算、CDS Sesame 検索を検証。

## 技術詳細

- **投影方式**: TAN（gnomonic）投影
- **フィッティング**: CD行列の線形最小二乗法（クレーメルの公式）
- **CRVAL 決定**: 星の天球座標重心から反復更新（5回）
- **セントロイド**: 輝度重心法（バックグラウンド中央値差し引き）
- **座標系**: PJSR ピクセル（0-based）→ FITS CRPIX（1-based）変換

詳細は [docs/specs.md](docs/specs.md) を参照。

## ライセンス

Copyright (c) 2024-2025 Split Image Solver Project
