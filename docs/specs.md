# Manual Image Solver 技術仕様書

## 目次

1. [概要](#1-概要)
2. [処理フロー概要](#2-処理フロー概要)
3. [WCS フィッティングの数学](#3-wcs-フィッティングの数学)
4. [セントロイド計算](#4-セントロイド計算)
5. [歪み補正（TPS 直接フィッティング）](#5-歪み補正tps-直接フィッティング)
6. [WCS 適用](#6-wcs-適用)
7. [制御点生成と AnnotateImage 連携](#7-制御点生成と-annotateimage-連携)
8. [天体名検索（CDS Sesame）](#8-天体名検索cds-sesame)
9. [UI 設計](#9-ui-設計)
10. [組み込みカタログデータ](#10-組み込みカタログデータ)
11. [候補星サジェスト](#11-候補星サジェスト)

---

## 1. 概要

Manual Image Solver は、PixInsight の PJSR（PixInsight JavaScript Runtime）で動作する手動プレートソルブスクリプトです。ユーザーが画像上の星を手動で同定し、TAN（gnomonic）投影の WCS（World Coordinate System）を算出して画像に適用します。

### 対象ユースケース

- astrometry.net の自動ソルブが失敗する画像
- PixInsight ImageSolver が対応できない画像
- インデックスファイルが不足している FOV の画像
- 極端に歪んだ画像や特殊な光学系の画像

## 2. 処理フロー概要

ユーザーが画像上の星をクリックし天球座標をペアリングしてから、WCS ソリューションが画像に適用されるまでの全体的な流れを示す。

### 2.1 入力

- PixInsight で開かれた画像（FITS / XISF 等）
- 最低 3 組の星ペア（ピクセル座標, 天球座標 RA/DEC）

### 2.2 処理ステップ

```
1. 星の同定（§4, §8, §9, §10）
   ├─ 画像上の星をクリック → セントロイド計算でサブピクセル精度の位置を取得
   └─ 天球座標をペアリング（カタログ選択 or Sesame 検索 or 手入力）

2. TAN-only フィット（§3 詳細）
   ├─ CRVAL 初期値: 星の 3D 単位ベクトル平均
   ├─ CD 行列: 線形最小二乗フィット
   └─ CRVAL 反復更新（5 回）で収束

3. 歪みベクトルの計算（§5 詳細）
   ├─ 星数 < 4 → 歪みなし（TAN-only で完了）
   └─ 星数 ≥ 4 → 各星の歪みベクトル（TAN 投影 − CD 線形予測）を計算

4. WCS 適用（§6 詳細）
   ├─ FITS キーワード書き込み（CRVAL, CD, CTYPE 等）
   ├─ regenerateAstrometricSolution() で AnnotateImage 用スプライン生成
   └─ TPS 制御点の直接設定（Grid モードに応じた生成方式、§7 詳細）
```

### 2.3 Grid モードの役割

WCS 適用の最終段階で、AnnotateImage が使用する TPS 制御点の生成方式を 3 つのモードから選択できる。CD 行列だけでは表現できない歪み（4 星以上で検出）がある場合、Grid モードで制御点の補間方式を制御する。

| モード | 概要 |
|---|---|
| **Off** | 星位置は正確な TAN 投影、グリッド線は CD 線形 |
| **Smooth** (デフォルト) | IDW 補間で星近傍は正確、遠方は CD 線形に漸近 |
| **Linear** | 全制御点を CD 線形で生成、完全な直線グリッド |

詳細は §7 を参照。

## 3. WCS フィッティングの数学

### 3.1 TAN（gnomonic）投影

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

### 3.2 CD 行列の線形最小二乗フィッティング

ピクセルオフセット u_i = (px_i + 1) - CRPIX1, v_i = (height - py_i) - CRPIX2 に対し（座標変換は §3.5 参照）:

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

### 3.3 CRVAL の決定

1. **初期値**: 入力星の天球座標の 3D 単位ベクトル平均（天の極を含む画像にも正しく対応）
2. TAN投影で標準座標を計算 → CD 行列をフィット
3. フィット残差の重心を逆投影して CRVAL を更新（更新後に全星の TAN 投影が失敗する場合はスキップ）
4. 5回反復で収束

3D 単位ベクトル平均:
```
Vx = Σ cos(DEC_i) × cos(RA_i)
Vy = Σ cos(DEC_i) × sin(RA_i)
Vz = Σ sin(DEC_i)
CRVAL1 = atan2(Vy, Vx)
CRVAL2 = atan2(Vz, sqrt(Vx² + Vy²))
```

従来の方法（RA のみ 2D ベクトル平均 + DEC 算術平均）では、天の北極/南極を含む画像で RA が天球を一周する場合に CRVAL が大幅にずれていた。3D ベクトル平均は天球上の真の重心を求めるため、極付近の画像でも正しい投影中心が得られる。

CRVAL 反復更新ガード: 広角画像では TAN 投影の非線形性により CRVAL 更新が振動し、端の星が 90° 限界を超えることがある。更新後に全星の TAN 投影が成功するか検証し、失敗する場合は更新をスキップする。

### 3.4 CRPIX

画像中心に固定（FITS 1-based）:
```
CRPIX1 = imageWidth / 2.0 + 0.5
CRPIX2 = imageHeight / 2.0 + 0.5
```

### 3.5 座標系の変換

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

### 3.6 残差計算

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

### 3.7 角距離（Vincenty 公式）

```
num1 = cos(DEC2) × sin(ΔRA)
num2 = cos(DEC1) × sin(DEC2) - sin(DEC1) × cos(DEC2) × cos(ΔRA)
den  = sin(DEC1) × sin(DEC2) + cos(DEC1) × cos(DEC2) × cos(ΔRA)
separation = atan2(sqrt(num1² + num2²), den)
```

Haversine 公式より数値的に安定。

## 4. セントロイド計算

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

## 5. 歪み補正（TPS 直接フィッティング）

### 5.1 概要

広角画像（FOV > 数度）では CD 行列の線形モデルだけでは TAN 投影の非線形性を吸収できない。v1.4.0 以降、SIP 多項式に代わり **TPS（Thin Plate Spline）制御点の直接生成** で歪み補正を行う。SIP 多項式で発生していた Runge 現象（星間での多項式暴走）を根本的に排除し、AnnotateImage のグリッド表示品質を向上させる。

### 5.2 歪みベクトル

WCSFitter の `solve()` は、TAN-only フィット（§3）の後に各星の **歪みベクトル** を計算する。歪みベクトルは、正確な TAN 投影と CD 行列の線形予測の差分:

```
proj = tanProject(CRVAL, [RA_i, DEC_i])   → (ξ_exact, η_exact)
pred_ξ = CD1_1 × u_i + CD1_2 × v_i
pred_η = CD2_1 × u_i + CD2_2 × v_i
dξ_i = ξ_exact − pred_ξ
dη_i = η_exact − pred_η
```

- 4 星以上の場合に計算（3 星では CD 行列が完全にフィットするため歪みなし）
- いずれかの歪みベクトルの大きさが 0.01 arcsec を超える場合に `hasDistortion = true`
- `solve()` の戻り値に `distortionVectors` 配列と `hasDistortion` フラグを含む

### 5.3 TPS 制御点の生成

歪みベクトルは `setCustomControlPoints()` で TPS 制御点に変換される。Grid モード（§7）に応じて、星の正確な TAN 投影座標とグリッド点の CD 線形予測座標を組み合わせた制御点を生成し、PixInsight の SplineWorldTransformation プロパティに直接書き込む。

### 5.4 FITS キーワード

常に `RA---TAN` / `DEC--TAN` を使用（SIP キーワードは書き込まない）。歪み情報は TPS 制御点として画像プロパティに格納される。

### 5.5 精度の目安

| 状況 | 予想精度 |
|---|---|
| 狭角（< 5°）, TAN のみ | < 1 arcsec |
| 中角（5°〜30°）, TAN + TPS | 1〜10 arcsec（制御点間は IDW で補間） |
| 広角（> 30°）, TAN + TPS | 星位置は正確、星間は Grid モードに依存 |

### 5.6 表示

- ステータスバー: `(TPS)` と表示（`hasDistortion` が true の場合）
- コンソール: `Distortion: TPS (N vectors)` と表示

## 6. WCS 適用

### 6.1 FITS キーワード

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

### 6.2 適用手順

1. 既存の WCS 関連キーワードを全て除去（`isWCSKeyword()` で判定）
2. 新しい WCS キーワードを追加（`makeFITSKeyword()` で型を自動判定）
3. `window.regenerateAstrometricSolution()` でアストロメトリック表示を再生成
4. 制御点の直接設定（Grid モードに応じた生成方式、§7 参照）

## 7. 制御点生成と AnnotateImage 連携

### 7.1 背景と目的

PixInsight の AnnotateImage プロセスは、WCS の FITS キーワード（CD 行列）を直接使用せず、画像プロパティに格納された **制御点** と **RBF スプライン** で sky→pixel 変換を行う。`regenerateAstrometricSolution()` がこの制御点を生成するが、歪みがある場合は制御点を直接上書きして正確な TPS 補間を実現する。

この問題に対処するため、`regenerateAstrometricSolution()` 後に制御点を直接上書きする。制御点の生成方式を **Grid モード** として 3 種類提供し、用途に応じた表示品質のバランスを選択できる。

### 7.2 Grid モードの比較

UI のメインダイアログ下部にある ComboBox で切替（デフォルト: Smooth）。

| モード | グリッド制御点 | 星制御点 | 特徴 |
|---|---|---|---|
| **Off** | CD 線形（星近傍 100px を除外） | 正確な TAN 投影（RA/Dec → gnomonic） | 星位置は正確だが、グリッド線が星近傍で歪む場合がある |
| **Smooth** (デフォルト) | IDW 補正付き CD 線形 | IDW 補正付き CD 線形 | 星近傍で正確、遠方では CD 線形に漸近。バランスの良い表示 |
| **Linear** | CD 線形（5×5 格子） | CD 線形 | 完全な直線グリッド。レンズ歪み分だけ星位置がずれる |

### 7.3 Off モード

グリッド点は 21×31 格子（最大 651 点）で生成。星位置から半径 100px 以内のグリッド点を除外し、CD 線形値と星の正確な TAN 投影値の矛盾を回避する。星制御点には正確な gnomonic 投影座標を使用するため、星の注釈位置は正確だが、除外領域の境界でグリッド線に不連続が生じる場合がある。

### 7.4 Smooth モード（IDW 補間）

CD 行列による線形近似をベースラインとし、各星の残差を IDW（Inverse Distance Weighting）で周囲に配分する。星に近い点ほど正確な TAN 投影に近づき、離れた点ほど CD 線形に漸近するため、滑らかな遷移が実現する。

各グリッド点 (u, v) の gnomonic 座標を以下の手順で計算:

1. CD 行列で線形近似した天球座標を 3D 単位ベクトルに変換（ベースライン）
2. 各星の 3D 残差ベクトル（正確な位置 − CD 線形位置）をガウス重みで加重平均:
   ```
   w_i = exp(−((u − u_i)² + (v − v_i)²) / (2σ²))
   correction = Σ(w_i × residual_i) / Σ(w_i)
   ```
3. ベースライン + correction を正規化して天球座標に逆変換
4. TAN 投影で gnomonic 座標を取得

σ² は星間の平均最近傍距離の二乗。星が 3 個未満の場合は IDW を無効化し CD 線形にフォールバック。

### 7.5 Linear モード

全制御点を CD 行列の線形マッピングのみで生成。高次の歪み補正を一切含まないため、グリッド線は完全な直線になる。レンズ歪みがある画像では星の注釈位置がわずかにずれるが、見た目の整ったグリッド表示が得られる。

### 7.6 適用条件

- 全モードで制御点の直接書き込みを実行
- `hasDistortion` が true の場合、Grid モード設定（Off / Smooth / Linear）に従って制御点を生成
- 歪みなし（3星以下、または線形データ）の場合は常に Off 相当（CD 線形グリッド + 正確な TAN 投影星）で制御点を生成
- Grid モード設定はセッション保存・復元の対象

### 7.7 書き込み先プロパティ

スプライン設定プロパティ（`regenerateAstrometricSolution()` が生成した値を完全に上書き）:

| プロパティキー | 型 | 値 |
|---|---|---|
| `...:SplineWorldTransformation:RBFType` | String8 | `ThinPlateSpline` |
| `...:SplineWorldTransformation:SplineOrder` | Int32 | `2` |
| `...:SplineWorldTransformation:SplineSmoothness` | Float32 | `0`（厳密補間） |
| `...:SplineWorldTransformation:MaxSplinePoints` | Int32 | 制御点の総数 |
| `...:SplineWorldTransformation:UseSimplifiers` | Boolean | `false` |
| `...:SplineWorldTransformation:SimplifierRejectFraction` | Float32 | `0.10` |

制御点プロパティ（プレフィックス: `PCL:AstrometricSolution:`）:

| プロパティキー | 型 | 内容 |
|---|---|---|
| `...:SplineWorldTransformation:ControlPoints:Image` | F64Vector | PixInsight 0-based 座標 (px, py) × N 点（インターリーブ） |
| `...:SplineWorldTransformation:ControlPoints:World` | F64Vector | gnomonic 投影座標 (ξ, η) in degrees × N 点（インターリーブ） |

**注意**: `ControlPoints:Weights` は PixInsight の SplineWorldTransformation の公式プロパティに存在しない。書き込むとバリデーションエラー（`invalid or corrupted control point structures`）が発生する。

## 8. 天体名検索（CDS Sesame）

- URL: `http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?<name>`
- curl でリクエスト（タイムアウト 10秒）
- レスポンスの `%J` 行から RA/DEC（度数）を抽出
- オフライン時は RA/DEC 直接入力で対応

## 9. UI 設計

### 9.1 ManualSolverDialog（メインダイアログ）

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Fit][1:1][+][−] [↺][↻] STF:[▶None][Linked][Unlinked]              │
├────────────────────────────────┬─────────────────────────────────────┤
│                                │ Category: [▼ Navigation Stars    ] │
│   Image Preview                │ Search:   [____________________]   │
│   (ScrollBox + Control)        │ ┌─────────────────────────────────┐│
│                                │ │ Name    │ RA    │ DEC   │ Mag  ││
│ • Click → Star select          │ │ Sirius  │ 06:45 │-16:42 │ -1.4 ││
│ • Drag → Pan                   │ │ Vega    │ 18:36 │+38:47 │  0.0 ││
│ • Wheel → Zoom                 │ │ Rigel   │ 05:14 │-08:12 │  0.2 ││
│ • Green marker = registered    │ │ (gray = already paired)        ││
│ • Cyan marker = pending        │ └─────────────────────────────────┘│
│                                │                        [Manual...] │
├────────────────────────────────┴─────────────────────────────────────┤
│ Reference Stars (minimum 4):                                        │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ # │ X       │ Y       │ Name    │ RA          │ DEC         │Res│ │
│ │01 │ 512.34  │ 1024.12 │ Rigel   │ 05 14 32.27 │ -08 12 05.9 │.23│ │
│ │02 │ 3012.00 │ 2012.50 │ Mintaka │ 05 32 00.40 │ -00 17 56.7 │.15│ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ [Edit...] [Remove] [Clear All]  [Export...] [Import...]              │
│ Star clicked (512.3, 1024.1). Select from catalog or [Manual].      │
│ Grid:[▼ Smooth]                       [Solve] [Apply] [Close]       │
└──────────────────────────────────────────────────────────────────────┘
```

カタログパネル（右側）は常時表示。ダイアログのリサイズに連動してプレビューとカタログパネルが比例して拡縮する（stretch 比率 100:40）。

### 9.2 StarEditDialog（星座標入力）

```
┌────────────────────────────────────────────┐
│ Reference Star #1                          │
├────────────────────────────────────────────┤
│ Pixel:  X = 512.34    Y = 1024.12         │
├────────────────────────────────────────────┤
│ Name: [______________] [Search]            │
│ RA:   [______________] (HH MM SS / deg)    │
│ DEC:  [______________] (+DD MM SS / deg)   │
├────────────────────────────────────────────┤
│                           [OK] [Cancel]    │
└────────────────────────────────────────────┘
```

### 9.3 画像プレビュー

- `ScrollBox` 内に `Control` を配置
- `onPaint`: `Image.render()` で取得した Bitmap を描画 + 星マーカー
- マーカー: 赤十字（Pen 2px）+ 緑円（半径 12px）+ 黄色番号（選択中の星は拡大+白色表示）
- ズーム: 離散ズームレベル（1/16x〜8x の 19 段階）、マウスホイールまたはボタンで操作、表示中心を基準にズーム
- 表示回転: 0°/90°/180°/270°（CW/CCW）の表示回転。縦構図画像でウィンドウ横幅を有効活用。回転は表示のみで、クリック座標は逆回転で元画像座標に変換される。マーカー位置も正しく回転表示される
- 操作: クリックで星選択（セントロイドスナップ）、ドラッグでパン（移動量 4px 以上でパンと判定、未満は星選択）
- STF: None（リニア）/ Linked（全チャネル共通ストレッチ）/ Unlinked（チャネル独立ストレッチ）の 3 モード切替
- 星テーブル: RA と DEC を独立した列で表示。ヘッダクリックでソート可能（ゼロパディング番号でソート順が正確）。ソート後も正しい星が選択・編集・削除されるよう、行番号ベースでインデックスを解決

### 9.4 カタログブラウザパネル

画像プレビュー右側に常時表示されるカタログブラウザ。ダイアログのリサイズに連動して幅が変化する（最小幅 250px）。

- **Category ComboBox**: "Navigation Stars" / "Messier Objects" / 88 星座別（"Ori - Orion" 等）
- **Search Edit**: インクリメンタルテキストフィルタ（名前で部分一致検索）
- **TreeBox**: 天体リスト（Name / RA / DEC / Mag の 4 列）。ヘッダクリックでソート可能、デフォルトは Name 昇順
- **RA/DEC 表示**: 省スペースのため HH:MM / ±DD:MM 形式（ペアリング時はフル精度の座標を使用）
- **ペア済み表示**: 既にペアリングされた天体はテキストをグレー（`0x888888`）で表示
- **Manual... ボタン**: pending 状態で StarEditDialog を開く（従来のフォールバック）

### 9.5 カタログ選択ペアリングフロー

画像クリック後は常にカタログ選択フローに入る:

1. **画像クリック** → セントロイド計算 → pending 状態に遷移
   - ステータスバー: `"Star clicked (X, Y). Select from catalog or click [Manual] for manual entry."`
   - pending 位置にシアン色（`#00FFFF`）のマーカー（円 + 十字 + "?" ラベル）を表示
2. **カタログ選択**: カタログ TreeBox の天体をダブルクリック → pending 位置と選択天体のペアリングが自動的に完了
   - 天体名・RA・DEC がカタログデータから取得され、星テーブルに追加
   - pending 状態がクリアされ、マーカーが通常の緑色に変化
3. **手動入力フォールバック**: [Manual...] ボタンで従来の StarEditDialog を開く（カタログにない天体用）
4. **連続クリック**: pending 中に別の星をクリックすると、前の pending を破棄して新しい位置に更新

## 10. 組み込みカタログデータ

### 10.1 概要

`catalog_data.js` に格納された組み込み天体カタログ。CDS Sesame 検索なしで天体を素早く同定するために使用する。PJSR（`#include`）と Node.js（`require`）の両方で動作する ES5 互換 JavaScript。

### 10.2 データ構造

| 変数名 | 型 | 内容 |
|---|---|---|
| `CATALOG_STARS` | Array | 星座線構成星（691 星）。各要素: `{hip, name, bayer, con, ra, dec, mag}` |
| `CONSTELLATION_LINES` | Object | 88 星座の星座線。キー: IAU 略称。値: `{name, lines}` |
| `NAVIGATION_STAR_HIPS` | Array | 主要ナビゲーション星の HIP 番号（50 星） |
| `MESSIER_OBJECTS` | Array | メシエ天体 M1〜M110（110 天体）。各要素: `{id, name, type, con, ra, dec, mag}` |

### 10.3 座標系

- 座標系: J2000（ICRS）
- RA: 十進度（0〜360）
- DEC: 十進度（-90〜+90）
- 等級: 視等級（apparent visual magnitude）

### 10.4 星座線データ

Stellarium western skyculture に準拠。各星座の `lines` 配列はポリライン（HIP 番号の配列）のリストで、連続する HIP 番号間が線分として接続される。

```
例: Ori (Orion)
lines: [[26727,26311,25930], [29426,28614,27989,...], ...]
→ HIP 26727—26311—25930 の2本の線分 + ...
```

### 10.5 メシエ天体の型略称

| 略称 | 種類 |
|---|---|
| GC | 球状星団 (Globular Cluster) |
| OC | 散開星団 (Open Cluster) |
| PN | 惑星状星雲 (Planetary Nebula) |
| DN | 散光星雲 (Diffuse Nebula) |
| Gx | 銀河 (Galaxy) |
| DS | 二重星 (Double Star) |

### 10.6 データソース

- 恒星座標: [HYG Database](https://github.com/astronexus/HYG-Database)（Hipparcos カタログ由来）
- 星座線: [Stellarium skycultures](https://github.com/Stellarium/stellarium-skycultures)（western skyculture）
- メシエ天体: SEDS Messier Catalog

---

## 11. 候補星サジェスト

### 11.1 概要

3星以上で Solve 実行後、暫定 WCS 結果を使ってカタログ星の画像上の位置を予測し、候補マーカーとして表示する機能。次の星のペアリングを高速化する。

### 11.2 ワークフロー

1. ユーザーが 4 星以上を登録して **Solve** を実行
2. Solve 成功後、`skyToPixel()` で全カタログ星（CATALOG_STARS + MESSIER_OBJECTS）の画像上の位置を計算
3. 等級制限（Mag limit）以下かつ画像範囲内の未ペアリング星を候補として抽出
4. 画像上にオレンジ色の十字マーカー + 名前ラベルを描画
5. ユーザーが画像をクリックすると、最も近い候補 5 件がカタログリストでハイライト表示
6. ハイライトされた候補をダブルクリックでペアリング

### 11.3 skyToPixel() 関数

`wcs_math.js` に追加。WCS 結果（CRVAL, CRPIX, CD行列）から RA/DEC をピクセル座標に変換する。

```
skyToPixel(ra, dec, wcsResult, imageHeight)
  1. tanProject(ra, dec, crval1, crval2) → xi, eta
  2. CD逆行列: det = CD1_1*CD2_2 - CD1_2*CD2_1
     u = (CD2_2*xi - CD1_2*eta) / det
     v = (-CD2_1*xi + CD1_1*eta) / det
  3. FITS→PixInsight座標変換:
     px = u + CRPIX1 - 1
     py = imageHeight - (v + CRPIX2)
  4. return {px, py} or null (反対半球)
```

- TAN-only（CD 線形のみ）: 暫定 Solve での候補表示には十分な精度
- 広角レンズで画像端の候補位置がずれる可能性あり（ガイドとしては許容範囲）

### 11.4 UI 構成

カタログパネルの Search 行の下に候補コントロール行を配置:

- **Suggest チェックボックス**: 候補表示の ON/OFF（デフォルト ON）
- **Mag limit SpinBox**: 等級制限値（×10、デフォルト 30 = 3.0 等級）

### 11.5 マーカー描画

- 色: `0xCCFF8C00`（ダークオレンジ、半透明）
- 形状: 十字線（6px）+ 名前ラベル（8pt）
- 登録済みマーカー（緑円 + 赤十字）の**下**に描画

### 11.6 カタログリストハイライト

画像クリック時に候補との距離を計算し、上位 5 件をカタログリストでハイライト:

- 1 位: 背景色 `0x40FF8C00`（オレンジ濃）
- 2〜5 位: 背景色 `0x20FF8C00`（オレンジ薄）
- 1 位のノードに自動スクロール

### 11.7 セッション保存

`suggestEnabled`（bool）と `magLimit`（int, ×10）をセッションデータに含めて保存・復元。
