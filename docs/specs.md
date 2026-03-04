# Manual Image Solver 技術仕様書

## 1. 概要

Manual Image Solver は、PixInsight の PJSR（PixInsight JavaScript Runtime）で動作する手動プレートソルブスクリプトです。ユーザーが画像上の星を手動で同定し、TAN（gnomonic）投影の WCS（World Coordinate System）を算出して画像に適用します。

### 対象ユースケース

- astrometry.net の自動ソルブが失敗する画像
- PixInsight ImageSolver が対応できない画像
- インデックスファイルが不足している FOV の画像
- 極端に歪んだ画像や特殊な光学系の画像

## 2. WCS フィッティングの数学

### 2.1 TAN（gnomonic）投影

天球座標 (RA, DEC) → 標準座標 (ξ, η)（度）:

```
D = sin(CRVAL2)*sin(DEC) + cos(CRVAL2)*cos(DEC)*cos(RA - CRVAL1)
ξ = cos(DEC)*sin(RA - CRVAL1) / D × (180/π)
η = (cos(CRVAL2)*sin(DEC) - sin(CRVAL2)*cos(DEC)*cos(RA - CRVAL1)) / D × (180/π)
```

逆変換（ξ, η → RA, DEC）:

```
ρ = sqrt(ξ² + η²) × (π/180)
c = atan(ρ)
DEC = asin(cos(c)*sin(CRVAL2) + η*(π/180)*sin(c)*cos(CRVAL2)/ρ)
RA = CRVAL1 + atan2(ξ*(π/180)*sin(c), ρ*cos(CRVAL2)*cos(c) - η*(π/180)*sin(CRVAL2)*sin(c))
```

投影が不可能な場合（D ≤ 0、反対半球）は `null` を返す。

### 2.2 CD 行列の線形最小二乗フィッティング

ピクセルオフセット u_i = (px_i + 1) - CRPIX1, v_i = (height - py_i) - CRPIX2 に対し（座標変換は §2.5 参照）:

```
ξ_i = CD1_1 * u_i + CD1_2 * v_i
η_i = CD2_1 * u_i + CD2_2 * v_i
```

これは2つの独立した2変数線形回帰に分離できる。正規方程式:

```
[Σu²   Σuv] [CD1_1]   [Σuξ]
[Σuv   Σv²] [CD1_2] = [Σvξ]
```

2×2 連立方程式をクレーメルの公式で直接解く:

```
det = Σu² × Σv² - (Σuv)²
CD1_1 = (Σuξ × Σv² - Σvξ × Σuv) / det
CD1_2 = (Σu² × Σvξ - Σuv × Σuξ) / det
```

CD2_1, CD2_2 も同様に η を使用して解く。

### 2.3 CRVAL の決定

1. **初期値**: 入力星の天球座標の重心（RA はベクトル平均で計算）
2. TAN投影で標準座標を計算 → CD 行列をフィット
3. フィット残差の重心を逆投影して CRVAL を更新
4. 5回反復で収束

RA のベクトル平均:
```
CRVAL1 = atan2(Σsin(RA_i), Σcos(RA_i))
CRVAL2 = Σ(DEC_i) / N
```

### 2.4 CRPIX

画像中心に固定（FITS 1-based）:
```
CRPIX1 = imageWidth / 2.0 + 0.5
CRPIX2 = imageHeight / 2.0 + 0.5
```

### 2.5 座標系の変換

PixInsight のピクセル座標と標準 FITS 座標系では Y 軸の向きが異なる:

| 座標系 | X 原点 | Y 原点 | Y 方向 |
|---|---|---|---|
| PixInsight (0-based) | 左端 = 0 | **上端 = 0** | 下向きに増加 |
| 標準 FITS (1-based) | 左端 = 1 | **下端 = 1** | 上向きに増加 |

変換式（`WCSFitter` 内で使用）:
```
u = (px + 1) - CRPIX1        ... X: 0-based → 1-based のみ
v = (height - py) - CRPIX2   ... Y: 上下反転 + 1-based 変換
```

- `px=0`（画像左端）→ `fits_x=1`
- `py=0`（画像上端）→ `fits_y=height`（FITS では最上行）
- `py=height-1`（画像下端）→ `fits_y=1`（FITS では最下行）

### 2.6 残差計算

各星について:
1. CD 行列で予測した標準座標を計算
2. 標準座標を天球座標に逆変換
3. 入力座標との角距離（Vincenty 公式）を残差とする

RMS 残差:
```
RMS = sqrt(Σ(residual_i²) / N)
```

ピクセルスケール（CD行列の行列式から）:
```
pixelScale = sqrt(|CD1_1 × CD2_2 - CD1_2 × CD2_1|) × 3600 [arcsec/px]
```

### 2.7 角距離（Vincenty 公式）

```
num1 = cos(DEC2) × sin(ΔRA)
num2 = cos(DEC1) × sin(DEC2) - sin(DEC1) × cos(DEC2) × cos(ΔRA)
den  = sin(DEC1) × sin(DEC2) + cos(DEC1) × cos(DEC2) × cos(ΔRA)
separation = atan2(sqrt(num1² + num2²), den)
```

Haversine 公式より数値的に安定。

## 3. セントロイド計算

### アルゴリズム

1. クリック位置を中心に半径 `radius` px（デフォルト 10）の窓を設定
2. 窓内の全ピクセル値を収集
3. 中央値をバックグラウンドとして差し引き
4. バックグラウンド差し引き後の正の値で輝度重心を計算:
   ```
   x_centroid = Σ(val_i × x_i) / Σ(val_i)
   y_centroid = Σ(val_i × y_i) / Σ(val_i)
   ```
5. 全ピクセルがバックグラウンド以下の場合は `null`（失敗）

### 制限事項

- 飽和星: ピーク値がフラットになるため精度低下
- ノイズの多い画像: セントロイドが不安定になる
- 失敗時はクリック座標をそのまま使用

## 4. UI 設計

### 4.1 ManualSolverDialog（メインダイアログ）

```
+====================================================+
| Manual Image Solver                       v1.1.0   |
+----------------------------------------------------+
| Image: [active_image ▼]  (6024 x 4024 px)         |
+----------------------------------------------------+
| [Fit] [1:1] [+] [−]   STF: [▶None] [Linked] [Unlinked] |
| +--------------------------------------------------+
| | [ScrollBox + Control]                            |
| | - クリックで星選択（セントロイドスナップ）        |
| | - 選択済み星にマーカー（十字+円）表示            |
| | - マウスホイール / ボタンでズーム                |
| | - ドラッグでパン                                |
| +--------------------------------------------------+
+----------------------------------------------------+
| Reference Stars (minimum 4):                       |
| # | X       | Y       | Name   | RA / DEC       | Residual |
| 1 | 512.34  | 1024.12 | Rigel  | 05 14 32 / ... | 0.23"    |
| 2 | 3012.00 | 2012.50 | Mintaka| 05 32 00 / ... | 0.15"    |
+----------------------------------------------------+
| [Edit...] [Remove] [Clear All]  [Export...] [Import...] |
+----------------------------------------------------+
| WCS フィット成功 (RMS: 0.19 arcsec, ...)           |
|                            [Solve] [Apply] [Close] |
+====================================================+
```

### 4.2 StarEditDialog（星座標入力）

```
+============================================+
| Reference Star #1                          |
+--------------------------------------------+
| Pixel:  X = 512.34    Y = 1024.12         |
+--------------------------------------------+
| Name: [______________] [Search]            |
| RA:   [______________] (HH MM SS / deg)    |
| DEC:  [______________] (+DD MM SS / deg)   |
+--------------------------------------------+
|                           [OK] [Cancel]    |
+============================================+
```

### 4.3 画像プレビュー

- `ScrollBox` 内に `Control` を配置
- `onPaint`: `Image.render()` で取得した Bitmap を描画 + 星マーカー
- マーカー: 赤十字（Pen 2px）+ 緑円（半径 12px）+ 黄色番号（選択中の星は拡大+白色表示）
- ズーム: 離散ズームレベル（1/16x〜8x の 19 段階）、マウスホイールまたはボタンで操作、表示中心を基準にズーム
- 操作: クリックで星選択（セントロイドスナップ）、ドラッグでパン（移動量 4px 以上でパンと判定、未満は星選択）
- STF: None（リニア）/ Linked（全チャネル共通ストレッチ）/ Unlinked（チャネル独立ストレッチ）の 3 モード切替

## 5. WCS 適用

### FITS キーワード

| キーワード | 型 | 値 |
|---|---|---|
| CTYPE1 | 文字列 | `RA---TAN` |
| CTYPE2 | 文字列 | `DEC--TAN` |
| CRVAL1 | 浮動小数点 | 投影中心 RA（度） |
| CRVAL2 | 浮動小数点 | 投影中心 DEC（度） |
| CRPIX1 | 浮動小数点 | 基準ピクセル X（1-based） |
| CRPIX2 | 浮動小数点 | 基準ピクセル Y（1-based） |
| CD1_1 | 浮動小数点 | CD行列要素 |
| CD1_2 | 浮動小数点 | CD行列要素 |
| CD2_1 | 浮動小数点 | CD行列要素 |
| CD2_2 | 浮動小数点 | CD行列要素 |
| CUNIT1 | 文字列 | `deg` |
| CUNIT2 | 文字列 | `deg` |
| RADESYS | 文字列 | `ICRS` |
| EQUINOX | 浮動小数点 | `2000.0` |
| PLTSOLVD | 論理値 | `T` |

### 適用手順

1. 既存の WCS 関連キーワードを全て除去（`isWCSKeyword()` で判定）
2. 新しい WCS キーワードを追加（`makeFITSKeyword()` で型を自動判定）
3. `window.regenerateAstrometricSolution()` でアストロメトリック表示を再生成

## 6. 天体名検索（CDS Sesame）

- URL: `http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?<name>`
- curl でリクエスト（タイムアウト 10秒）
- レスポンスの `%J` 行から RA/DEC（度数）を抽出
- オフライン時は RA/DEC 直接入力で対応

## 7. 将来の拡張（Phase 3）

### SIP 歪み補正

- 多項式項 u^p × v^q (p+q ≥ 2) を追加
- SIP 次数 2: 3項追加 → 3×3 正規方程式
- SIP 次数 3: 7項追加 → 7×7 正規方程式
- ガウス消去法で解く（PJSR に Matrix クラスがないため自前実装）

### 精度の限界

| 状況 | 予想精度 |
|---|---|
| 狭角（< 5°）, TAN のみ | < 1 arcsec |
| 中角（5°〜30°）, TAN のみ | 1〜10 arcsec |
| 広角（> 30°）, TAN + SIP | 1〜5 arcsec |
| 広角（> 30°）, TAN のみ | > 10 arcsec（歪みが残る） |

## 8. プロジェクト構成

```
manual-image-solver/
├── javascript/
│   ├── ManualImageSolver.js       # PJSR メイン（ネイティブ Dialog で全操作完結）
│   ├── WCSApplier.js              # スタンドアロン JSON → WCS 適用
│   ├── wcs_math.js                # WCS 数学関数（PJSR + Node.js 両対応）
│   └── wcs_keywords.js            # FITS WCS キーワードユーティリティ（PJSR 専用）
├── tests/
│   └── javascript/
│       ├── test_wcs_math.js       # Node.js 単体テスト（WCS 数学関数）
│       ├── test_parse_coords.js   # Node.js 単体テスト（座標パース + MTF）
│       └── ManualSolverTest.js    # PJSR 統合テスト
├── docs/
│   ├── setup.md                   # セットアップガイド
│   ├── specs.md                   # 技術仕様書（本ドキュメント）
│   ├── tests.md                   # テスト手順書
│   └── images/                    # スクリーンショット
├── repository/
│   ├── ManualImageSolver-x.x.x.zip  # PixInsight リポジトリ配布用 ZIP
│   └── updates.xri                  # PixInsight アップデート定義
├── build-release.sh               # リリースビルドスクリプト
└── .gitignore
```

## 9. テスト

### Node.js 単体テスト

```bash
# WCS 数学関数の精度検証
node tests/javascript/test_wcs_math.js

# 座標パース + MTF
node tests/javascript/test_parse_coords.js
```

### PJSR 統合テスト

PixInsight コンソールで実行:

**Script > Run Script File...** → `tests/javascript/ManualSolverTest.js`

WCS キーワード適用、セントロイド計算、Sesame 検索の統合テストを実行します。
