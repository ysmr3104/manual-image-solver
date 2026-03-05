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
| Manual Image Solver                       v1.1.1   |
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

## 7. SIP 歪み補正（Phase 3 実装済み）

### 7.1 概要

SIP（Simple Imaging Polynomial）は TAN 投影の残差を高次多項式で補正する FITS 標準拡張。広角画像（FOV > 数度）で CD 行列のみでは吸収できない非線形歪みを補正する。

### 7.2 SIP 多項式

ピクセルオフセット (u, v) = (x - CRPIX1, y - CRPIX2) に対し:

```
u' = u + A(u, v) = u + Σ A_p_q × u^p × v^q  (p+q = 2..A_ORDER)
v' = v + B(u, v) = v + Σ B_p_q × u^p × v^q  (p+q = 2..B_ORDER)
```

補正後の (u', v') に CD 行列を適用して標準座標 (ξ, η) を得る:
```
ξ  = CD1_1 × u' + CD1_2 × v'
η  = CD2_1 × u' + CD2_2 × v'
```

### 7.3 SIP 次数の決定

手動プレートソルブでは星数が限られるため、過剰フィットを避ける保守的な閾値:

| 星数 | SIP 次数 | 多項式項数（各軸） | 必要最小自由度 |
|---|---|---|---|
| < 6 | 0（SIP なし） | — | — |
| 6〜9 | 2 | 3 | 3 |
| ≥ 10 | 3 | 7 | 3 |

### 7.4 フィッティングアルゴリズム

1. **TAN-only フィット**: 従来の CD 行列 + CRVAL 反復フィット（§2.2〜2.3）
2. **反復 CD+SIP 精密化**（最大 10 回）:
   a. CD 逆行列で天球座標→理想ピクセルを計算し、実測ピクセルとの差を SIP ターゲットとする
   b. 座標正規化（`coordScale = max(|u|, |v|)`）で数値安定化
   c. 設計行列 `u^p × v^q` (p+q = 2..N) の各項を構築
   d. 正規方程式 (M^T M) x = M^T b をガウス消去法（部分ピボット付き）で解く
   e. SIP 補正済みピクセル座標で CD 行列と CRVAL を再フィット
3. **採用判定**: SIP 後の RMS が TAN-only RMS より 5% 以上改善 **かつ** 絶対改善量 > 0.1 arcsec の場合のみ採用。それ以外は TAN-only にフォールバック
4. **逆 SIP 計算**: 50×50 グリッドで順 SIP を評価し、逆方向の多項式 (AP, BP) を最小二乗法で計算

### 7.5 FITS キーワード

SIP 適用時に追加されるキーワード:

| キーワード | 型 | 値 |
|---|---|---|
| CTYPE1 | 文字列 | `RA---TAN-SIP` |
| CTYPE2 | 文字列 | `DEC--TAN-SIP` |
| A_ORDER | 整数 | SIP 次数 (2 or 3) |
| B_ORDER | 整数 | SIP 次数 (2 or 3) |
| A_p_q | 浮動小数点 | 順方向 SIP 係数 |
| B_p_q | 浮動小数点 | 順方向 SIP 係数 |
| AP_ORDER | 整数 | 逆 SIP 次数 |
| BP_ORDER | 整数 | 逆 SIP 次数 |
| AP_p_q | 浮動小数点 | 逆方向 SIP 係数 |
| BP_p_q | 浮動小数点 | 逆方向 SIP 係数 |

SIP 非適用時は従来通り `RA---TAN` / `DEC--TAN` を使用。

### 7.6 精度の目安

| 状況 | 予想精度 |
|---|---|
| 狭角（< 5°）, TAN のみ | < 1 arcsec |
| 中角（5°〜30°）, TAN のみ | 1〜10 arcsec |
| 広角（> 30°）, TAN + SIP | 1〜5 arcsec |
| 広角（> 30°）, TAN のみ | > 10 arcsec（歪みが残る） |

### 7.7 補間モード（広角画像対応）

#### 背景

TAN 投影は FOV が 90° に近づくと発散するため、通常の SIP 多項式（最小二乗近似、最大次数 3）では広角画像の歪みを補正しきれない。ユーザーの要望「座標指定している部分を完全に固定した状態でそれ以外の箇所を近似させる」に対応するため、補間モードを導入。

#### 原理

SIP の項数を星数以上に設定し、劣決定系の最小ノルム解を使用することで、全制御点を正確に通る補間を実現する。

- **近似モード（approx）**: 項数 ≤ 星数。正規方程式 (M^T M)x = M^T b の最小二乗解。星の位置では残差が残る
- **補間モード（interp）**: 項数 > 星数。設計行列 D の最小ノルム解 x = D^T (D D^T)^{-1} b。指定した星の位置で残差 ≈ 0

#### モード自動判定

TAN-only フィットの RMS がピクセルスケールの 5 倍以上の場合に補間モードを自動選択:

```
tanRmsPixel = tanRmsArcsec / pixelScaleArcsec
sipMode = (tanRmsPixel >= 5.0) ? "interp" : "approx"
```

#### 補間モードの SIP 次数

| 星数 | SIP 次数 | 多項式項数 | 自由度（項数 − 星数） |
|---|---|---|---|
| ≤ 3 | 0（SIP なし） | — | — |
| 4〜7 | 3 | 7 | 0〜3 |
| 8〜12 | 4 | 12 | 0〜4 |
| 13〜18 | 5 | 18 | 0〜5 |
| 19〜25 | 6 | 25 | 0〜6 |
| ≥ 26 | 7 | 33 | 7+ |

#### 最小ノルム解

劣決定系 Dx = b（m < n）の最小ノルム解:

```
x = D^T * (D * D^T)^{-1} * b
```

G = D D^T（m×m）を計算し、Gy = b をガウス消去法で解き、x = D^T y を求める。数値安定性のため、G が特異に近い場合は Tikhonov 正則化（G + εI, ε = max(diag(G)) × 10^{-10}）をフォールバックとして適用。

#### P-norm 境界エネルギー抑制（外挿暴走防止）

補間モードでは高次多項式を少数の星で厳密に補間するため、星がカバーしていない画像端で多項式が暴走する（Runge 現象）。これにより FOV が異常値（例: 178°）になり、逆 SIP（AP, BP）も壊れる。

**解決策**: P-norm 最小化 + 複合アンカーポイント。星での厳密補間を保ちつつ、画像全域での多項式エネルギーを最小化する。

1. **SIP 次数の決定**: 境界エネルギー抑制に十分な自由度を確保
   - 目標: 自由度（= 項数 − 星数）≥ 25
   - 次数 K → 項数 = (K+1)(K+2)/2 − 3
   - 例: 10星 → 次数 8（42項, 自由度 32）

2. **複合アンカーポイント**: 境界 + グリッドの2層構造
   - **境界アンカー**（36点, 重み W=10）: 各辺10点。FOV を正確に制御
   - **グリッドアンカー**（49点, 重み W=1）: 7×7 内部格子。内部振動を抑制
   - 各点のターゲット: du = dv = 0（SIP 補正なし = TAN 投影に漸近）

3. **P-norm 最小化**: x = P^{-1} D^T (D P^{-1} D^T)^{-1} b
   - P = M_anchor^T W M_anchor + εI（重み付きアンカーエネルギー行列）
   - D = 星位置での基底関数行列
   - b = 星での SIP 補正量（厳密制約）
   - 正則化: ε = max(diag(P)) × 10^{-10}
   - 星での補間は厳密（残差 = 0）、自由度はアンカーエネルギー最小化に使用

4. **効果**:
   - 星の残差は厳密ゼロ（P-norm は制約付き最適化）
   - 画像四隅の SIP 補正量を ~100 px 以内に抑制（例: 90° FOV で最大 131 px）
   - FOV 表示が正確（例: 89° × 40°, 暴走前は 178° と誤表示）

5. **逆 SIP 直接計算**（補間モード）:
   - forward SIP の多項式振動（Runge 現象）を回避するため、星の正確な位置データから直接計算
   - 各星: (RA, Dec) → TAN 投影 → CD⁻¹ → (u', v') → 補正量 = (u−u', v−v')
   - 線形項（order 1: AP_1_0, AP_0_1 等）を基底に含めることで CRVAL 近傍での感度を改善
   - P-norm 方式: 星位置（W=10⁶）で正確に補間しつつ、摂動アンカー（W=1）で滑らかさを保証
   - 逆 SIP 次数: nBasis ≥ nStars + 5 を満たす最小次数（通常 order 4-6）
   - 効果: 90° FOV でも逆 SIP MAX < 10 px（改善前: ~1800 px）
   - 狭角～中角画像の近似モードでは従来のグリッドベース逆 SIP を使用

#### 受理条件

- **補間モード**: 数値的に解けていれば常に採用（閾値なし）
- **近似モード**: 従来通り、TAN-only RMS の 5% 以上改善かつ絶対改善量 > 0.1 arcsec

#### 表示

- コンソール: `SIP order: N (補間)` と表示
- ステータス: `(SIPNi)` と表示（i = interpolation）
- 結果オブジェクトに `sipMode: "interp"` or `"approx"` を追加

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
