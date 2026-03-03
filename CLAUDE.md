# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

Manual Image Solver は手動プレートソルブツール。PixInsight 内で操作が完結するワークフロー:

1. **ManualImageSolver.js** (PJSR): アクティブ画像を一時 FITS に保存 → Python GUI を ExternalProcess で起動 → JSON 結果を読み込み → WCS を自動適用
2. **Python GUI** (PyQt6 + matplotlib): 画像表示、星クリック選択、セントロイド計算、WCS フィッティング、JSON 出力
3. **WCSApplier.js** (PJSR): スタンドアロン JSON → WCS 適用（手動 JSON 適用用に維持）

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

## コマンド

```bash
# .venv を使用すること
source .venv/bin/activate

# 依存パッケージインストール
.venv/bin/pip install -r requirements.txt

# Python GUI 起動（スタンドアロン）
.venv/bin/python python/main.py [--input image.fits]

# Python GUI 起動（PJSR連携モード: Apply & Close / Cancel ボタン）
.venv/bin/python python/main.py --input image.fits --output /tmp/result.wcs.json

# 全 Python テスト実行
PYTHONPATH="python" .venv/bin/pytest tests/python -v

# 単一テスト実行
PYTHONPATH="python" .venv/bin/pytest tests/python/test_wcs_math.py -v

# Node.js 単体テスト実行（JS 数学関数）
node tests/javascript/test_wcs_math.js

# PJSR 統合テストは PixInsight コンソールで実行
# Script > Run Script File... > tests/javascript/ManualSolverTest.js
```

`python/main.py` が `from core.wcs_math import ...` のような相対インポートを使用するため、`PYTHONPATH="python"` が必須。

## アーキテクチャ

### ファイル構成

| ファイル | 用途 |
|---|---|
| **Python GUI** | |
| `python/main.py` | CLI エントリーポイント（`--input`, `--output` 対応） |
| `python/gui/main_window.py` | QMainWindow（通常モード / PJSR連携モード切替） |
| `python/gui/image_viewer.py` | matplotlib FigureCanvasQTAgg（imshow + クリック + マーカー） |
| `python/gui/star_table.py` | QTableWidget（星テーブル） |
| `python/gui/star_dialog.py` | QDialog（星座標入力 + Sesame 検索） |
| `python/core/wcs_math.py` | TAN 投影、角距離、WCSFitter（wcs_math.js の 1:1 移植） |
| `python/core/centroid.py` | numpy セントロイド計算（輝度重心法） |
| `python/core/image_loader.py` | FITS/XISF 読み込み（astropy + xisf） |
| `python/core/auto_stretch.py` | ZScale + AsinhStretch オートストレッチ |
| `python/core/sesame_resolver.py` | CDS Sesame 天体名検索（requests） |
| `python/wcs_io/wcs_json.py` | PJSR 互換 JSON 入出力 |
| **JavaScript (PJSR)** | |
| `javascript/ManualImageSolver.js` | PJSR メインスクリプト（ExternalProcess で Python GUI 起動 → WCS 自動適用） |
| `javascript/WCSApplier.js` | スタンドアロン JSON → WCS 適用 PJSR スクリプト |
| `javascript/wcs_math.js` | WCS 数学関数ライブラリ（PJSR / Node.js 両対応） |

### 処理フロー（PixInsight 完結ワークフロー）

1. PixInsight で画像を開く
2. Script > Run Script File... > ManualImageSolver.js
3. 初回: Python パスとスクリプトディレクトリを設定（Settings API で永続化）
4. アクティブ画像を一時 FITS に保存 → Python GUI が自動起動（`--output` モード）
5. Python GUI で星をクリック → セントロイド → RA/DEC 入力 → Solve
6. Apply & Close → JSON 出力 → Python GUI 終了（exit code 0）
7. ManualImageSolver.js が JSON を読み込み → WCS をアクティブ画像に自動適用

### Python GUI の動作モード

| モード | 起動方法 | ボタン構成 | 用途 |
|---|---|---|---|
| 通常モード | `--input` のみ | Solve / Export JSON / Write FITS / Close | スタンドアロン利用 |
| PJSR連携モード | `--input` + `--output` | Solve / Apply & Close / Cancel | PixInsight 連携 |

### 終了コード（PJSR連携モード）

| コード | 意味 |
|---|---|
| 0 | 正常終了 + JSON 出力完了 |
| 1 | ユーザーキャンセル |
| 2 | エラー |

### WCS JSON フォーマット（Python → PJSR 受け渡し）

```json
{
  "version": "1.0.0",
  "image": { "filename": "orion.fits", "width": 6024, "height": 4024 },
  "wcs": {
    "ctype1": "RA---TAN", "ctype2": "DEC--TAN",
    "crval1": 83.633212, "crval2": 22.014501,
    "crpix1": 3012.5, "crpix2": 2012.5,
    "cd1_1": -0.00035, "cd1_2": 0.00001,
    "cd2_1": 0.00001, "cd2_2": 0.00035
  },
  "fit_quality": { "rms_arcsec": 0.19, "pixel_scale_arcsec": 1.26, "num_stars": 6 },
  "star_pairs": [
    { "name": "Betelgeuse", "px": 1234.56, "py": 2345.67,
      "ra": 88.793, "dec": 7.407, "residual_arcsec": 0.23 }
  ]
}
```

### WCS フィッティングの数学

- **TAN（gnomonic）投影**: `tan_project()` / `tan_deproject()` で天球座標 ↔ 標準座標を変換
- **CD行列フィット**: 2つの独立した2変数線形回帰をクレーメルの公式で直接解く
- **CRVAL 決定**: 星の天球座標のベクトル平均を初期値とし、残差重心で反復更新（5回）
- **座標系**: ピクセル座標は 0-based、FITS CRPIX は 1-based。フィット時に +1 補正

### 実装上の重要な注意点

- **0-based vs 1-based**: Python/PJSR の ピクセルは 0-based。FITS の CRPIX は 1-based。`WCSFitter` 内で `stars[i]["px"] + 1.0` として補正。
- **RA のラップアラウンド**: RA の平均値計算はベクトル平均（cos/sin）を使用。
- **PJSR JSON 互換**: 科学表記を固定小数点に変換（`_sanitize_floats_for_pjsr()`）。
- **matplotlib toolbar.mode**: `""` のときのみ星選択モード。`"zoom rect"` / `"pan/zoom"` 中はクリック無視。
- **SIP 歪み補正**: 現在未実装。広角で精度が必要な場合に追加予定。

## テスト方針

- **Python 単体テスト（pytest）**: WCS 数学関数の精度検証（JS 55 テストの完全移植）、セントロイド、画像読み込み、JSON 入出力
- **Node.js 単体テスト**: JS 数学関数の精度検証（55 テスト）
- **PJSR 統合テスト**: WCS キーワード適用、セントロイド計算、Sesame 検索
- **E2E テスト（手動）**: 実画像での座標精度確認

## 外部依存

- Python 3.12+, PyQt6, matplotlib, astropy, numpy, scipy, requests, xisf
- PixInsight 1.8.9+（WCSApplier.js 用）
