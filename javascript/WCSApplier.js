#feature-id    WCSApplier : Utilities > WCSApplier
#feature-info  Apply WCS from a JSON file to the active image.

//----------------------------------------------------------------------------
// WCSApplier.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Read a WCS JSON file and apply WCS keywords to the active image.
//
// Copyright (c) 2024-2026 Manual Image Solver Project
//----------------------------------------------------------------------------

#define VERSION "1.1.0"

#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>

#define TITLE "WCS Applier"

// WCS関連のFITSキーワードかどうかを判定
function isWCSKeyword(name) {
   var wcsNames = [
      "CRVAL1", "CRVAL2", "CRPIX1", "CRPIX2",
      "CD1_1", "CD1_2", "CD2_1", "CD2_2",
      "CDELT1", "CDELT2", "CROTA1", "CROTA2",
      "CTYPE1", "CTYPE2", "CUNIT1", "CUNIT2",
      "RADESYS", "EQUINOX",
      "A_ORDER", "B_ORDER", "AP_ORDER", "BP_ORDER",
      "PLTSOLVD"
   ];
   for (var i = 0; i < wcsNames.length; i++) {
      if (name === wcsNames[i]) return true;
   }
   if (/^[AB]P?_\d+_\d+$/.test(name)) return true;
   return false;
}

// FITSKeywordの型を値から判定して適切なFITSKeywordオブジェクトを生成
function makeFITSKeyword(name, value) {
   var strVal = value.toString();
   if (strVal === "T" || strVal === "true") {
      return new FITSKeyword(name, "T", "");
   }
   if (strVal === "F" || strVal === "false") {
      return new FITSKeyword(name, "F", "");
   }
   var stringKeys = ["CTYPE1", "CTYPE2", "CUNIT1", "CUNIT2", "RADESYS", "PLTSOLVD"];
   for (var i = 0; i < stringKeys.length; i++) {
      if (name === stringKeys[i]) {
         return new FITSKeyword(name, "'" + strVal + "'", "");
      }
   }
   return new FITSKeyword(name, strVal, "");
}

// WCS キーワードを画像に適用
function applyWCS(window, wcsData) {
   var existingKw = window.keywords;
   var cleanedKw = [];
   for (var i = 0; i < existingKw.length; i++) {
      if (!isWCSKeyword(existingKw[i].name))
         cleanedKw.push(existingKw[i]);
   }

   var wcs = wcsData.wcs;
   cleanedKw.push(makeFITSKeyword("CTYPE1", wcs.ctype1 || "RA---TAN"));
   cleanedKw.push(makeFITSKeyword("CTYPE2", wcs.ctype2 || "DEC--TAN"));
   cleanedKw.push(makeFITSKeyword("CRVAL1", wcs.crval1));
   cleanedKw.push(makeFITSKeyword("CRVAL2", wcs.crval2));
   cleanedKw.push(makeFITSKeyword("CRPIX1", wcs.crpix1));
   cleanedKw.push(makeFITSKeyword("CRPIX2", wcs.crpix2));
   cleanedKw.push(makeFITSKeyword("CD1_1", wcs.cd1_1));
   cleanedKw.push(makeFITSKeyword("CD1_2", wcs.cd1_2));
   cleanedKw.push(makeFITSKeyword("CD2_1", wcs.cd2_1));
   cleanedKw.push(makeFITSKeyword("CD2_2", wcs.cd2_2));
   cleanedKw.push(makeFITSKeyword("CUNIT1", "deg"));
   cleanedKw.push(makeFITSKeyword("CUNIT2", "deg"));
   cleanedKw.push(makeFITSKeyword("RADESYS", "ICRS"));
   cleanedKw.push(makeFITSKeyword("EQUINOX", 2000.0));
   cleanedKw.push(makeFITSKeyword("PLTSOLVD", "T"));

   window.keywords = cleanedKw;
   window.regenerateAstrometricSolution();
}

// メイン処理
function main() {
   // 画像チェック
   if (ImageWindow.activeWindow.isNull) {
      var mb = new MessageBox(
         "画像が開かれていません。\n先に画像を開いてからスクリプトを実行してください。",
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   var window = ImageWindow.activeWindow;
   var image = window.mainView.image;

   console.writeln("<b>" + TITLE + " v" + VERSION + "</b>");
   console.writeln("---");

   // JSONファイル選択
   var ofd = new OpenFileDialog;
   ofd.caption = "WCS JSON ファイルを選択";
   ofd.filters = [
      ["JSON Files", "*.json"],
      ["All Files", "*"]
   ];
   if (!ofd.execute()) return;

   var jsonPath = ofd.fileName;
   console.writeln("JSON ファイル: " + jsonPath);

   // JSON読み込み
   var jsonText;
   try {
      jsonText = File.readTextFile(jsonPath);
   } catch (e) {
      var mb = new MessageBox("ファイルの読み込みに失敗しました:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   var wcsData;
   try {
      wcsData = JSON.parse(jsonText);
   } catch (e) {
      var mb = new MessageBox("JSON の解析に失敗しました:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   // バージョンチェック
   if (!wcsData.version || !wcsData.version.match(/^1\./)) {
      var mb = new MessageBox("未対応の WCS JSON バージョンです: " + (wcsData.version || "不明"),
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   // WCSデータ検証
   if (!wcsData.wcs || wcsData.wcs.crval1 === undefined) {
      var mb = new MessageBox("WCS データが見つかりません。",
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   // 画像サイズ照合（警告のみ）
   if (wcsData.image) {
      var jsonW = wcsData.image.width;
      var jsonH = wcsData.image.height;
      if (jsonW && jsonH) {
         if (jsonW !== image.width || jsonH !== image.height) {
            var mb = new MessageBox(
               "画像サイズが一致しません:\n" +
               "  JSON: " + jsonW + " x " + jsonH + "\n" +
               "  画像: " + image.width + " x " + image.height + "\n\n" +
               "続行しますか？",
               TITLE, StdIcon_Warning, StdButton_Yes, StdButton_No);
            if (mb.execute() !== StdButton_Yes) return;
         }
      }
   }

   // フィット品質情報を表示
   if (wcsData.fit_quality) {
      var fq = wcsData.fit_quality;
      console.writeln("フィット品質:");
      if (fq.rms_arcsec !== undefined)
         console.writeln("  RMS: " + fq.rms_arcsec.toFixed(3) + " arcsec");
      if (fq.pixel_scale_arcsec !== undefined)
         console.writeln("  Pixel scale: " + fq.pixel_scale_arcsec.toFixed(3) + " arcsec/px");
      if (fq.num_stars !== undefined)
         console.writeln("  Stars: " + fq.num_stars);
   }

   // 確認ダイアログ
   var wcs = wcsData.wcs;
   var confirmMsg = "WCS を適用しますか？\n\n" +
      "  CRVAL1: " + wcs.crval1 + "\n" +
      "  CRVAL2: " + wcs.crval2 + "\n" +
      "  CRPIX1: " + wcs.crpix1 + "\n" +
      "  CRPIX2: " + wcs.crpix2;
   if (wcsData.fit_quality && wcsData.fit_quality.rms_arcsec !== undefined) {
      confirmMsg += "\n  RMS: " + wcsData.fit_quality.rms_arcsec.toFixed(3) + " arcsec";
   }

   var mb = new MessageBox(confirmMsg, TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
   if (mb.execute() !== StdButton_Yes) return;

   // WCS適用
   console.writeln("WCS を適用中...");
   applyWCS(window, wcsData);
   console.writeln("<b>WCS を正常に適用しました。</b>");

   var mb2 = new MessageBox("WCS を正常に適用しました。\n\n" +
      "画像の座標表示が更新されました。",
      TITLE, StdIcon_Information, StdButton_Ok);
   mb2.execute();
}

main();
