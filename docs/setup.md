# セットアップガイド

Manual Image Solver のインストールと PixInsight への登録手順です。

## 前提条件

| ソフトウェア | バージョン | 用途 |
|---|---|---|
| Python | 3.12 以降 | Python GUI の実行 |
| PixInsight | 1.8.9 以降 | WCS の適用、AnnotateImage 等 |

## 1. リポジトリの取得

```bash
git clone https://github.com/ysmr3104/manual-image-solver.git
cd manual-image-solver
```

## 2. Python 環境のセットアップ

### 仮想環境の作成

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 依存パッケージのインストール

```bash
pip install -r requirements.txt
```

主な依存パッケージ:

| パッケージ | 用途 |
|---|---|
| PyQt6 | GUI フレームワーク |
| matplotlib | 画像表示・操作 |
| astropy | FITS 読み込み、ZScale ストレッチ |
| numpy / scipy | 数値計算 |
| requests | CDS Sesame 天体名検索 |
| xisf | XISF ファイル読み込み |

### 動作確認

```bash
PYTHONPATH="python" .venv/bin/pytest tests/python -v
```

全テストがパスすれば Python 環境は正常です。

## 3. PixInsight へのスクリプト登録

### Feature Scripts への登録（推奨）

メニューに常駐させる方法です。

1. PixInsight のメニューから **Script > Feature Scripts...** を開く
2. **Add** ボタンをクリック
3. `manual-image-solver/javascript/` ディレクトリを選択
4. **Done** で閉じる

これで **Script > Utilities > ManualImageSolver** がメニューに追加されます。PixInsight を再起動しても保持されます。

### Run Script File で実行する場合

登録せずに直接実行する場合:

1. **Script > Run Script File...** を開く
2. `manual-image-solver/javascript/ManualImageSolver.js` を選択

## 4. 初回設定

ManualImageSolver を初めて実行すると、設定ダイアログが表示されます。

| 項目 | 設定内容 | 例 |
|---|---|---|
| Python executable | `.venv/bin/python` のフルパス | `/Users/you/manual-image-solver/.venv/bin/python` |
| Script directory | `manual-image-solver` のルートディレクトリ | `/Users/you/manual-image-solver` |

設定は PixInsight の Settings API で永続化されるため、次回以降は自動読み込みされます。

### 設定の変更

設定を変更したい場合は、PixInsight の設定ファイルから `ManualImageSolver/` プレフィックスのキーを削除するか、`javascript/ManualImageSolver.js` 内の検証チェックでパスが無効になると自動的に設定ダイアログが再表示されます。

## 5. Python GUI 単体利用（PixInsight なし）

PixInsight がない環境でも Python GUI を単体で利用できます。

```bash
# GUI 起動（スタンドアロン）
.venv/bin/python python/main.py

# 画像ファイルを指定して起動
.venv/bin/python python/main.py --input /path/to/image.fits
```

スタンドアロンモードでは以下のボタンが表示されます:

- **Solve** — WCS フィッティング実行
- **Export JSON** — WCS を JSON ファイルに出力
- **Write FITS** — WCS ヘッダー付き FITS ファイルを出力
- **Close** — 終了

## トラブルシューティング

### Python GUI が起動しない

- PixInsight の Process Console に表示されるエラーメッセージを確認してください
- Python パスが正しいか確認: 設定した `.venv/bin/python` が存在するか
- Script directory が正しいか確認: `python/main.py` が存在するディレクトリか
- 依存パッケージが不足していないか確認: `pip install -r requirements.txt` を再実行

### PyQt6 のインストールに失敗する

macOS の場合、Xcode Command Line Tools が必要です:

```bash
xcode-select --install
```

### Sesame 検索が動かない

CDS Sesame サービスへのネットワーク接続が必要です。オフライン環境では天体名検索が使えないため、RA/DEC を直接入力してください。

### 「前回のセッションの星ペア情報があります」と表示される

前回の実行で Apply & Close した星ペア情報が残っています。同じ画像で作業を続ける場合は **Yes** で復元、新しい画像の場合は **No** を選択してください。
