# Manual Image Solver

手動プレートソルブツール。画像上の星をユーザーが手動で同定し、TAN（gnomonic）投影の WCS（World Coordinate System）を算出して画像に適用します。

## 概要

astrometry.net や PixInsight の ImageSolver による自動プレートソルブが失敗する画像に対し、手動で星を同定して WCS を取得するためのツールです。

**PixInsight 完結ワークフロー**: PixInsight のスクリプトメニューから起動するだけで、Python GUI による星の手動選択から WCS 適用まで一気通貫で完了します。

```
PixInsight                           Python GUI（自動起動）
┌──────────────┐                    ┌──────────────────┐
│ 1. 画像を開く  │                    │                  │
│ 2. Script >   │                    │                  │
│    Run Script │                    │                  │
│    > Manual.. │ ── temp.fits ──→  │ 3. 画像表示       │
│              │                    │ 4. 星クリック+入力 │
│              │                    │ 5. Solve          │
│ 7. WCS 自動適用│ ←── .wcs.json ── │ 6. Apply & Close  │
│ 8. 完了表示   │                    │                  │
└──────────────┘                    └──────────────────┘
```

## インストール

### 前提条件

- Python 3.12 以降
- [PixInsight](https://pixinsight.com/) 1.8.9 以降（WCS 適用時のみ）

### Python GUI セットアップ

```bash
cd manual-image-solver

# 仮想環境作成
python3 -m venv .venv
source .venv/bin/activate

# 依存パッケージインストール
pip install -r requirements.txt
```

## 使い方

### PixInsight 完結ワークフロー（推奨）

1. PixInsight で対象画像を開く
2. **Script > Run Script File...** → `javascript/ManualImageSolver.js`
3. 初回のみ: Python パスと manual-image-solver ディレクトリを設定（次回以降は自動読み込み）
4. Python GUI が自動起動 → 画像が表示される
5. 画像上の星をクリック → セントロイドで自動スナップ → 座標入力ダイアログ
6. 天体名を入力して **Search**（CDS Sesame 検索）、または RA/DEC を直接入力
7. 4 星以上登録したら **Solve** → WCS フィッティング
8. **Apply & Close** → PixInsight に自動的に WCS が適用される

### Python GUI 単体利用

```bash
# GUI 起動（スタンドアロン）
.venv/bin/python python/main.py

# 画像ファイルを指定して起動
.venv/bin/python python/main.py --input /path/to/image.fits
```

スタンドアロンモードでは **Export JSON** / **Write FITS** ボタンが表示されます。

#### 操作方法

| 操作 | 動作 |
|---|---|
| 左クリック | 星を選択 → StarEditDialog |
| matplotlib ツールバー ズーム | ドラッグでズーム |
| matplotlib ツールバー パン | ドラッグでパン |

#### 座標入力フォーマット

| 項目 | フォーマット例 |
|---|---|
| RA（HMS） | `05 14 32.27` / `05:14:32.27` |
| RA（度数） | `78.634` |
| DEC（DMS） | `+07 24 25.4` / `-08:12:05.9` |
| DEC（度数） | `7.407` / `-8.202` |

### WCSApplier.js（手動 JSON 適用）

スタンドアロンで JSON ファイルから WCS を適用する場合:
1. PixInsight で対象画像を開く
2. **Script > Run Script File...** → `javascript/WCSApplier.js`
3. JSON ファイルを選択 → WCS が画像に適用される

## プロジェクト構成

```
manual-image-solver/
├── python/
│   ├── main.py                    # CLI エントリーポイント（--input, --output 対応）
│   ├── gui/
│   │   ├── main_window.py         # PyQt6 QMainWindow
│   │   ├── image_viewer.py        # matplotlib 画像ビューア
│   │   ├── star_table.py          # 星テーブル（QTableWidget）
│   │   └── star_dialog.py         # 星座標入力ダイアログ
│   ├── core/
│   │   ├── wcs_math.py            # TAN投影、WCSFitter
│   │   ├── centroid.py            # セントロイド計算
│   │   ├── image_loader.py        # FITS/XISF 読み込み
│   │   ├── auto_stretch.py        # ZScale+AsinhStretch
│   │   └── sesame_resolver.py     # CDS Sesame 天体名検索
│   └── wcs_io/
│       └── wcs_json.py            # PJSR互換 JSON 入出力
├── javascript/
│   ├── ManualImageSolver.js       # PJSR メイン（ExternalProcess で Python GUI 起動 → WCS 自動適用）
│   ├── WCSApplier.js              # スタンドアロン JSON → WCS 適用
│   └── wcs_math.js                # WCS 数学関数（JS版）
├── tests/
│   ├── python/
│   │   ├── test_wcs_math.py       # WCS 数学テスト（36テスト）
│   │   ├── test_centroid.py       # セントロイドテスト
│   │   ├── test_image_loader.py   # 画像読み込みテスト
│   │   └── test_wcs_json.py       # JSON 入出力テスト
│   └── javascript/
│       ├── test_wcs_math.js       # Node.js 単体テスト（55テスト）
│       └── ManualSolverTest.js    # PJSR 統合テスト
├── docs/
│   ├── specs.md                   # 技術仕様書
│   └── tests.md                   # テスト手順書
├── requirements.txt
└── .gitignore
```

## テスト

### Python テスト

```bash
# 全テスト実行
PYTHONPATH="python" .venv/bin/pytest tests/python -v

# WCS 数学テストのみ
PYTHONPATH="python" .venv/bin/pytest tests/python/test_wcs_math.py -v
```

### Node.js テスト

```bash
node tests/javascript/test_wcs_math.js
```

### PJSR 統合テスト

PixInsight コンソールで: **Script > Run Script File...** → `tests/javascript/ManualSolverTest.js`

## 技術詳細

- **投影方式**: TAN（gnomonic）投影
- **フィッティング**: CD行列の線形最小二乗法（クレーメルの公式）
- **CRVAL 決定**: 星の天球座標重心から反復更新（5回）
- **セントロイド**: 輝度重心法（バックグラウンド中央値差し引き）
- **座標系**: ピクセル（0-based）→ FITS CRPIX（1-based）変換
- **オートストレッチ**: astropy ZScale + AsinhStretch

詳細は [docs/specs.md](docs/specs.md) を参照。

## ライセンス

Copyright (c) 2024-2025 Split Image Solver Project
