#feature-id    WCSApplier : Utilities > WCSApplier
#feature-info  Apply WCS from a JSON file to the active image.

//----------------------------------------------------------------------------
// WCSApplier.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Read a WCS JSON file and apply WCS keywords to the active image.
//
// Copyright (c) 2026 Manual Image Solver Project
//----------------------------------------------------------------------------

#define VERSION "1.1.1"

#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>

#include "wcs_keywords.js"

#define TITLE "WCS Applier"

// WCS キーワードを画像に適用
function applyWCS(window, wcsData) {
   var existingKw = window.keywords;
   var cleanedKw = [];
   for (var i = 0; i < existingKw.length; i++) {
      if (!isWCSKeyword(existingKw[i].name))
         cleanedKw.push(existingKw[i]);
   }

   var wcs = wcsData.wcs;
   var hasSip = wcs.sip && wcs.sip.order > 0;
   cleanedKw.push(makeFITSKeyword("CTYPE1", hasSip ? "RA---TAN-SIP" : (wcs.ctype1 || "RA---TAN")));
   cleanedKw.push(makeFITSKeyword("CTYPE2", hasSip ? "DEC--TAN-SIP" : (wcs.ctype2 || "DEC--TAN")));
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

   // SIP distortion keywords
   if (hasSip) {
      var sip = wcs.sip;
      cleanedKw.push(makeFITSKeyword("A_ORDER", sip.order));
      cleanedKw.push(makeFITSKeyword("B_ORDER", sip.order));
      if (sip.a) {
         for (var i = 0; i < sip.a.length; i++) {
            cleanedKw.push(makeFITSKeyword("A_" + sip.a[i][0] + "_" + sip.a[i][1], sip.a[i][2]));
         }
      }
      if (sip.b) {
         for (var i = 0; i < sip.b.length; i++) {
            cleanedKw.push(makeFITSKeyword("B_" + sip.b[i][0] + "_" + sip.b[i][1], sip.b[i][2]));
         }
      }
      if (sip.ap && sip.bp) {
         var apOrder = sip.invOrder || sip.order;
         cleanedKw.push(makeFITSKeyword("AP_ORDER", apOrder));
         cleanedKw.push(makeFITSKeyword("BP_ORDER", apOrder));
         for (var i = 0; i < sip.ap.length; i++) {
            cleanedKw.push(makeFITSKeyword("AP_" + sip.ap[i][0] + "_" + sip.ap[i][1], sip.ap[i][2]));
         }
         for (var i = 0; i < sip.bp.length; i++) {
            cleanedKw.push(makeFITSKeyword("BP_" + sip.bp[i][0] + "_" + sip.bp[i][1], sip.bp[i][2]));
         }
      }
   }

   window.keywords = cleanedKw;

   // Write PCL:AstrometricSolution properties required by SPFC and other tools.
   var view = window.mainView;
   var attrs = PropertyAttribute_Storable | PropertyAttribute_Permanent;
   var image = view.image;

   // Remove any existing SplineWorldTransformation properties from previous solutions.
   var existingProps = view.properties;
   for (var pi = 0; pi < existingProps.length; pi++) {
      if (existingProps[pi].indexOf("SplineWorldTransformation") >= 0) {
         view.deleteProperty(existingProps[pi]);
      }
   }
   view.deleteProperty("Transformation_ImageToProjection");
   view.deleteProperty("PCL:AstrometricSolution:Information");

   // Projection system
   view.setPropertyValue("PCL:AstrometricSolution:ProjectionSystem", "Gnomonic", PropertyType_String8, attrs);

   // Reference celestial coordinates (degrees)
   var refCelestial = new Vector([wcs.crval1, wcs.crval2]);
   view.setPropertyValue("PCL:AstrometricSolution:ReferenceCelestialCoordinates", refCelestial, PropertyType_F64Vector, attrs);

   // Reference image coordinates (I-coordinates: 0-based x, bottom-up y)
   var refImgX = wcs.crpix1 - 1;
   var refImgY = wcs.crpix2;
   var refImage = new Vector([refImgX, refImgY]);
   view.setPropertyValue("PCL:AstrometricSolution:ReferenceImageCoordinates", refImage, PropertyType_F64Vector, attrs);

   // Linear transformation matrix (CD matrix)
   var ltMatrix = new Matrix(2, 2);
   ltMatrix.at(0, 0, wcs.cd1_1);
   ltMatrix.at(0, 1, wcs.cd1_2);
   ltMatrix.at(1, 0, wcs.cd2_1);
   ltMatrix.at(1, 1, wcs.cd2_2);
   view.setPropertyValue("PCL:AstrometricSolution:LinearTransformationMatrix", ltMatrix, PropertyType_F64Matrix, attrs);

   // Native coordinates of the reference point (TAN: 0, 90)
   var refNative = new Vector([0, 90]);
   view.setPropertyValue("PCL:AstrometricSolution:ReferenceNativeCoordinates", refNative, PropertyType_F64Vector, attrs);

   // Celestial pole native coordinates
   var plon = (wcs.crval2 < 90) ? 180 : 0;
   var celestialPole = new Vector([plon, 90]);
   view.setPropertyValue("PCL:AstrometricSolution:CelestialPoleNativeCoordinates", celestialPole, PropertyType_F64Vector, attrs);

   // Observation center coordinates (approximate: use CRVAL as center)
   view.setPropertyValue("Observation:Center:RA", wcs.crval1, PropertyType_Float64, attrs);
   view.setPropertyValue("Observation:Center:Dec", wcs.crval2, PropertyType_Float64, attrs);
   view.setPropertyValue("Observation:CelestialReferenceSystem", "ICRS", PropertyType_String8, attrs);
   view.setPropertyValue("Observation:Equinox", 2000.0, PropertyType_Float64, attrs);

   // Creation metadata
   view.setPropertyValue("PCL:AstrometricSolution:CreationTime", (new Date).toISOString(), PropertyType_TimePoint, attrs);
   view.setPropertyValue("PCL:AstrometricSolution:CreatorModule", "WCSApplier " + VERSION, PropertyType_String, attrs);

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
   if (!wcsData.wcs) {
      var mb = new MessageBox("WCS データが見つかりません。",
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }
   var requiredFields = ["crval1", "crval2", "crpix1", "crpix2",
      "cd1_1", "cd1_2", "cd2_1", "cd2_2"];
   for (var fi = 0; fi < requiredFields.length; fi++) {
      var key = requiredFields[fi];
      var val = wcsData.wcs[key];
      if (typeof val !== "number" || !isFinite(val)) {
         var mb = new MessageBox("WCS データが不正です: " + key + " = " + val,
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
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
