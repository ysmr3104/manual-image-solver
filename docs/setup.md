# セットアップガイド

Manual Image Solver のインストールと PixInsight への登録手順です。

## 前提条件

| ソフトウェア | バージョン | 用途 |
|---|---|---|
| PixInsight | 1.8.9 以降 | スクリプトの実行（必須） |
| Node.js | 任意 | 単体テストの実行（オプション） |

Python は不要です。すべての機能が PJSR（PixInsight JavaScript Runtime）内で完結します。

## 1. リポジトリの取得

```bash
git clone https://github.com/ysmr3104/manual-image-solver.git
```

## 2. PixInsight へのスクリプト登録

### Feature Scripts への登録（推奨）

メニューに常駐させる方法です。

1. PixInsight のメニューから **Script > Feature Scripts...** を開く
2. **Add** ボタンをクリック
3. `manual-image-solver/javascript/` ディレクトリを選択
4. **Done** で閉じる

これで **Script > Astrometry > ManualImageSolver** がメニューに追加されます。PixInsight を再起動しても保持されます。

### Run Script File で実行する場合

登録せずに直接実行する場合:

1. **Script > Run Script File...** を開く
2. `manual-image-solver/javascript/ManualImageSolver.js` を選択

## 3. 使い方

1. PixInsight で星野画像を開く
2. **Script > Astrometry > ManualImageSolver** を起動
3. Dialog 内で画像が表示される
4. 画像上の星をクリックして選択（セントロイドスナップ付き）
5. StarEditDialog で天体名検索または RA/DEC を直接入力
6. 4 星以上登録したら **Solve** で WCS フィッティング
7. **Apply to Image** で WCS キーワードを画像に適用

## セッション復元

前回の実行時の星ペア情報は PixInsight の Settings に自動保存されます。次回起動時に同じサイズの画像を開いている場合、復元するかどうかの確認ダイアログが表示されます。同じ画像で作業を続ける場合は **Yes** で復元、新しい画像の場合は **No** を選択してください。

## トラブルシューティング

### Sesame 検索が動かない

CDS Sesame サービスへのネットワーク接続が必要です。オフライン環境では天体名検索が使えないため、RA/DEC を直接入力してください。

### 「Previous session data found」と表示される

前回の実行で保存された星ペア情報が残っています。同じ画像で作業を続ける場合は **Yes** で復元、新しい画像の場合は **No** を選択してください。
