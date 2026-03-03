#feature-id    ManualImageSolver : Utilities > ManualImageSolver
#feature-info  Manual plate solver: interactively identify stars in a PJSR dialog \
   and compute a TAN-projection WCS solution, then apply it to the active image.

//----------------------------------------------------------------------------
// ManualImageSolver.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Manual Image Solver: PJSR ネイティブ Dialog で星を手動同定し、
// TAN投影 WCS を算出してアクティブ画像に適用する。
//
// Copyright (c) 2024-2026 Manual Image Solver Project
//----------------------------------------------------------------------------

#define VERSION "2.0.0"

#include <pjsr/DataType.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdCursor.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/Color.jsh>

#include "wcs_math.js"

#define TITLE "Manual Image Solver"

// Bitmap 最大辺（メモリ対策）
#define MAX_BITMAP_EDGE 2048

//============================================================================
// ユーティリティ関数（既存から再利用）
//============================================================================

// WCS関連のFITSキーワードかどうかを判定
function isWCSKeyword(name) {
   var wcsNames = [
      "CRVAL1", "CRVAL2", "CRPIX1", "CRPIX2",
      "CD1_1", "CD1_2", "CD2_1", "CD2_2",
      "CDELT1", "CDELT2", "CROTA1", "CROTA2",
      "CTYPE1", "CTYPE2", "CUNIT1", "CUNIT2",
      "RADESYS", "EQUINOX",
      "A_ORDER", "B_ORDER", "AP_ORDER", "BP_ORDER",
      "PLTSOLVD",
      "OBJCTRA", "OBJCTDEC"
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
   var stringKeys = ["CTYPE1", "CTYPE2", "CUNIT1", "CUNIT2", "RADESYS", "PLTSOLVD",
      "OBJCTRA", "OBJCTDEC"];
   for (var i = 0; i < stringKeys.length; i++) {
      if (name === stringKeys[i]) {
         return new FITSKeyword(name, "'" + strVal + "'", "");
      }
   }
   return new FITSKeyword(name, strVal, "");
}

//============================================================================
// 座標フォーマット・表示関数
//============================================================================

// RA (度) → "HH MM SS.ss" 形式に変換
function raToHMS(raDeg) {
   var ra = raDeg;
   while (ra < 0) ra += 360.0;
   while (ra >= 360) ra -= 360.0;
   var totalSec = ra / 15.0 * 3600.0;
   var h = Math.floor(totalSec / 3600.0);
   totalSec -= h * 3600.0;
   var m = Math.floor(totalSec / 60.0);
   var s = totalSec - m * 60.0;
   var hStr = (h < 10 ? "0" : "") + h;
   var mStr = (m < 10 ? "0" : "") + m;
   var sStr = (s < 10 ? "0" : "") + s.toFixed(2);
   return hStr + " " + mStr + " " + sStr;
}

// DEC (度) → "+DD MM SS.s" 形式に変換
function decToDMS(decDeg) {
   var sign = decDeg >= 0 ? "+" : "-";
   var dec = Math.abs(decDeg);
   var totalSec = dec * 3600.0;
   var d = Math.floor(totalSec / 3600.0);
   totalSec -= d * 3600.0;
   var m = Math.floor(totalSec / 60.0);
   var s = totalSec - m * 60.0;
   var dStr = (d < 10 ? "0" : "") + d;
   var mStr = (m < 10 ? "0" : "") + m;
   var sStr = (s < 10 ? "0" : "") + s.toFixed(1);
   return sign + dStr + " " + mStr + " " + sStr;
}

// ピクセル座標 → 天球座標変換（WCS パラメータ使用）
function pixelToRaDec(wcs, px, py, imageHeight) {
   var u = (px + 1.0) - wcs.crpix1;
   var v = (imageHeight - py) - wcs.crpix2;
   var xi  = wcs.cd1_1 * u + wcs.cd1_2 * v;
   var eta = wcs.cd2_1 * u + wcs.cd2_2 * v;
   return tanDeproject([wcs.crval1, wcs.crval2], [xi, eta]);
}

// 画像四隅・中央の座標をコンソールに表示
function displayImageCoordinates(wcs, imageWidth, imageHeight) {
   var center = pixelToRaDec(wcs, imageWidth / 2.0, imageHeight / 2.0, imageHeight);
   var tl = pixelToRaDec(wcs, 0, 0, imageHeight);
   var tr = pixelToRaDec(wcs, imageWidth - 1, 0, imageHeight);
   var bl = pixelToRaDec(wcs, 0, imageHeight - 1, imageHeight);
   var br = pixelToRaDec(wcs, imageWidth - 1, imageHeight - 1, imageHeight);

   console.writeln("");
   console.writeln("<b>Image coordinates:</b>");
   console.writeln("  Center ........ RA: " + raToHMS(center[0]) + "  Dec: " + decToDMS(center[1]));
   console.writeln("  Top-Left ...... RA: " + raToHMS(tl[0]) + "  Dec: " + decToDMS(tl[1]));
   console.writeln("  Top-Right ..... RA: " + raToHMS(tr[0]) + "  Dec: " + decToDMS(tr[1]));
   console.writeln("  Bottom-Left ... RA: " + raToHMS(bl[0]) + "  Dec: " + decToDMS(bl[1]));
   console.writeln("  Bottom-Right .. RA: " + raToHMS(br[0]) + "  Dec: " + decToDMS(br[1]));

   var widthFov = angularSeparation(tl, tr);
   var heightFov = angularSeparation(tl, bl);
   console.writeln("  Field of view . " + widthFov.toFixed(2) + " x " + heightFov.toFixed(2) + " deg");

   var rotationDeg = Math.atan2(-wcs.cd1_2, wcs.cd2_2) * 180.0 / Math.PI;
   console.writeln("  Rotation ...... " + rotationDeg.toFixed(2) + " deg");
}

// 星ペア情報をコンソールに表示
function displayStarPairs(starPairs, residuals) {
   if (!starPairs || starPairs.length === 0) return;
   console.writeln("");
   console.writeln("<b>Star pairs:</b>");
   for (var i = 0; i < starPairs.length; i++) {
      var s = starPairs[i];
      var line = "  " + (i + 1) + ". " + (s.name || "Star " + (i + 1));
      line += "  px(" + s.px.toFixed(1) + ", " + s.py.toFixed(1) + ")";
      line += "  RA: " + raToHMS(s.ra) + "  Dec: " + decToDMS(s.dec);
      if (residuals && residuals[i] && residuals[i].residual_arcsec !== undefined)
         line += "  residual: " + residuals[i].residual_arcsec.toFixed(2) + "\"";
      console.writeln(line);
   }
}

//============================================================================
// 座標パース関数（Python star_dialog.py から移植）
//============================================================================

// RA入力をパース（HMS "HH MM SS.ss" / "HH:MM:SS.ss" または度数）
// 成功時: 度数 (0-360)、失敗時: null
function parseRAInput(text) {
   if (typeof text !== "string") return null;
   text = text.trim();
   if (text.length === 0) return null;

   var parts = text.split(/[\s:]+/);
   if (parts.length >= 3) {
      var h = parseFloat(parts[0]);
      var m = parseFloat(parts[1]);
      var s = parseFloat(parts[2]);
      if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
         return (h + m / 60.0 + s / 3600.0) * 15.0;
      }
   }

   var val = parseFloat(text);
   if (!isNaN(val)) return val;
   return null;
}

// DEC入力をパース（DMS "±DD MM SS.ss" / "±DD:MM:SS.ss" または度数）
// 成功時: 度数 (-90〜+90)、失敗時: null
function parseDECInput(text) {
   if (typeof text !== "string") return null;
   text = text.trim();
   if (text.length === 0) return null;

   var sign = 1;
   if (text.charAt(0) === "-") {
      sign = -1;
      text = text.substring(1);
   } else if (text.charAt(0) === "+") {
      text = text.substring(1);
   }

   var parts = text.split(/[\s:]+/);
   if (parts.length >= 3) {
      var d = parseFloat(parts[0]);
      var m = parseFloat(parts[1]);
      var s = parseFloat(parts[2]);
      if (!isNaN(d) && !isNaN(m) && !isNaN(s)) {
         return sign * (d + m / 60.0 + s / 3600.0);
      }
   }

   var val = parseFloat(text);
   if (!isNaN(val)) return sign * val;
   return null;
}

//============================================================================
// WCS 適用関数
//============================================================================

function applyWCSToImage(targetWindow, wcsResult, imageWidth, imageHeight) {
   var existingKw = targetWindow.keywords;
   var cleanedKw = [];
   for (var i = 0; i < existingKw.length; i++) {
      if (!isWCSKeyword(existingKw[i].name))
         cleanedKw.push(existingKw[i]);
   }

   cleanedKw.push(makeFITSKeyword("CTYPE1", "RA---TAN"));
   cleanedKw.push(makeFITSKeyword("CTYPE2", "DEC--TAN"));
   cleanedKw.push(makeFITSKeyword("CRVAL1", wcsResult.crval1));
   cleanedKw.push(makeFITSKeyword("CRVAL2", wcsResult.crval2));
   cleanedKw.push(makeFITSKeyword("CRPIX1", wcsResult.crpix1));
   cleanedKw.push(makeFITSKeyword("CRPIX2", wcsResult.crpix2));
   cleanedKw.push(makeFITSKeyword("CD1_1", wcsResult.cd[0][0]));
   cleanedKw.push(makeFITSKeyword("CD1_2", wcsResult.cd[0][1]));
   cleanedKw.push(makeFITSKeyword("CD2_1", wcsResult.cd[1][0]));
   cleanedKw.push(makeFITSKeyword("CD2_2", wcsResult.cd[1][1]));
   cleanedKw.push(makeFITSKeyword("CUNIT1", "deg"));
   cleanedKw.push(makeFITSKeyword("CUNIT2", "deg"));
   cleanedKw.push(makeFITSKeyword("RADESYS", "ICRS"));
   cleanedKw.push(makeFITSKeyword("EQUINOX", 2000.0));
   cleanedKw.push(makeFITSKeyword("PLTSOLVD", "T"));

   // 画像中心の RA/DEC を OBJCTRA/OBJCTDEC として書き込み
   var wcsObj = {
      crval1: wcsResult.crval1, crval2: wcsResult.crval2,
      crpix1: wcsResult.crpix1, crpix2: wcsResult.crpix2,
      cd1_1: wcsResult.cd[0][0], cd1_2: wcsResult.cd[0][1],
      cd2_1: wcsResult.cd[1][0], cd2_2: wcsResult.cd[1][1]
   };
   var imgCenter = pixelToRaDec(wcsObj, imageWidth / 2.0, imageHeight / 2.0, imageHeight);
   cleanedKw.push(makeFITSKeyword("OBJCTRA", raToHMS(imgCenter[0])));
   cleanedKw.push(makeFITSKeyword("OBJCTDEC", decToDMS(imgCenter[1])));

   targetWindow.keywords = cleanedKw;
   targetWindow.regenerateAstrometricSolution();
}

//============================================================================
// Sesame 天体名検索（ExternalProcess + curl）
//============================================================================

function searchObjectCoordinates(objectName) {
   var encoded = objectName.replace(/ /g, "+");
   var url = "http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?" + encoded;
   var tmpFile = File.systemTempDirectory + "/sesame_query.txt";

   var P = new ExternalProcess;
   P.start("/usr/bin/curl", ["-s", "-o", tmpFile, "-m", "10", url]);
   if (!P.waitForFinished(15000)) {
      P.kill();
      return null;
   }
   if (P.exitCode !== 0) return null;
   if (!File.exists(tmpFile)) return null;

   var content = "";
   try {
      content = File.readTextFile(tmpFile);
      File.remove(tmpFile);
   } catch (e) {
      return null;
   }

   var lines = content.split("\n");
   for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("%J") === 0) {
         var coords = line.substring(2).trim();
         var eqIdx = coords.indexOf("=");
         if (eqIdx > 0) coords = coords.substring(0, eqIdx).trim();
         var parts = coords.split(/\s+/);
         if (parts.length >= 2) {
            var ra = parseFloat(parts[0]);
            var dec = parseFloat(parts[1]);
            if (!isNaN(ra) && !isNaN(dec)) return { ra: ra, dec: dec };
         }
      }
   }
   return null;
}

//============================================================================
// オートストレッチ（MTF ベース）+ Bitmap 生成
//============================================================================

// PixInsight STF 方式: median + MAD ベースの MTF パラメータ計算
// channel: 統計量を取得するチャンネル番号（デフォルト 0）
function computeAutoSTF(image, channel) {
   if (typeof channel === "undefined") channel = 0;
   // 指定チャンネルの統計量を取得（selectedChannel でチャンネル指定）
   var savedChannel = image.selectedChannel;
   image.selectedChannel = channel;
   var median = image.median();

   // MAD を取得（PJSR バージョンによっては未実装の可能性）
   var mad;
   try {
      mad = image.MAD();
   } catch (e) {
      // MAD が未実装の場合は avgDev * 1.4826 で近似
      mad = image.avgDev() * 1.4826;
   }
   image.selectedChannel = savedChannel;

   // MAD が 0 の場合（一様画像）のフォールバック
   if (mad === 0 || mad < 1e-15) {
      return { shadowClip: 0.0, midtone: 0.5 };
   }

   // STF パラメータ（PixInsight デフォルト）
   var targetMedian = 0.25;    // 目標中央値
   var shadowClipK = -2.8;     // シャドウクリッピング係数

   var shadow = median + shadowClipK * mad;
   if (shadow < 0) shadow = 0;

   // 中間調関数のパラメータ: median をストレッチ後 targetMedian にマッピング
   var normalizedMedian = (median - shadow) / (1.0 - shadow);
   if (normalizedMedian <= 0) normalizedMedian = 1e-6;
   if (normalizedMedian >= 1) normalizedMedian = 1 - 1e-6;

   // MTF パラメータ m を計算: MTF(m, normalizedMedian) = targetMedian
   // m = (targetMedian - 1) * normalizedMedian / ((2*targetMedian - 1) * normalizedMedian - targetMedian)
   var m = (targetMedian - 1.0) * normalizedMedian /
           ((2.0 * targetMedian - 1.0) * normalizedMedian - targetMedian);
   if (m < 0) m = 0;
   if (m > 1) m = 1;

   return { shadowClip: shadow, midtone: m };
}

// 中間調転送関数 (MTF)
function midtonesTransferFunction(m, x) {
   if (x <= 0) return 0;
   if (x >= 1) return 1;
   if (m === 0) return 0;
   if (m === 1) return 1;
   if (m === 0.5) return x;
   return ((m - 1.0) * x) / ((2.0 * m - 1.0) * x - m);
}

// 画像からストレッチ済み Bitmap を生成
// maxEdge: 最大辺サイズ（0 = 制限なし）
// stretchMode: "none" / "linked" / "unlinked"（デフォルト "linked"）
function createStretchedBitmap(image, maxEdge, stretchMode) {
   if (typeof maxEdge === "undefined") maxEdge = MAX_BITMAP_EDGE;
   if (typeof stretchMode === "undefined") stretchMode = "linked";

   var w = image.width;
   var h = image.height;

   // 縮小率の計算
   var scale = 1.0;
   if (maxEdge > 0) {
      var maxDim = Math.max(w, h);
      if (maxDim > maxEdge) {
         scale = maxEdge / maxDim;
      }
   }

   var bmpW = Math.round(w * scale);
   var bmpH = Math.round(h * scale);

   var isColor = image.numberOfChannels >= 3;

   // STF パラメータ計算（モード別）
   var stfR, stfG, stfB;
   if (stretchMode === "linked") {
      stfR = computeAutoSTF(image, 0);
      stfG = stfR;
      stfB = stfR;
   } else if (stretchMode === "unlinked" && isColor) {
      stfR = computeAutoSTF(image, 0);
      stfG = computeAutoSTF(image, 1);
      stfB = computeAutoSTF(image, 2);
   } else if (stretchMode === "unlinked") {
      // モノクロの場合は linked と同じ
      stfR = computeAutoSTF(image, 0);
      stfG = stfR;
      stfB = stfR;
   }
   // stretchMode === "none" の場合は stf 不要

   // Bitmap を直接構築
   var bmp = new Bitmap(bmpW, bmpH);

   for (var by = 0; by < bmpH; by++) {
      for (var bx = 0; bx < bmpW; bx++) {
         // Bitmap 座標 → 元画像座標
         var ix = Math.min(Math.floor(bx / scale), w - 1);
         var iy = Math.min(Math.floor(by / scale), h - 1);

         var r, g, b;
         if (isColor) {
            r = image.sample(ix, iy, 0);
            g = image.sample(ix, iy, 1);
            b = image.sample(ix, iy, 2);
         } else {
            r = g = b = image.sample(ix, iy, 0);
         }

         if (stretchMode === "none") {
            // リニアマッピング: そのまま 0-255 に変換
            r = Math.max(0, Math.min(1, r));
            g = Math.max(0, Math.min(1, g));
            b = Math.max(0, Math.min(1, b));
         } else {
            // シャドウクリップ + 正規化 + MTF（チャンネル別 STF）
            r = (r - stfR.shadowClip) / (1.0 - stfR.shadowClip);
            g = (g - stfG.shadowClip) / (1.0 - stfG.shadowClip);
            b = (b - stfB.shadowClip) / (1.0 - stfB.shadowClip);

            r = midtonesTransferFunction(stfR.midtone, Math.max(0, Math.min(1, r)));
            g = midtonesTransferFunction(stfG.midtone, Math.max(0, Math.min(1, g)));
            b = midtonesTransferFunction(stfB.midtone, Math.max(0, Math.min(1, b)));
         }

         // 8bit 変換して Bitmap にセット
         var ri = Math.round(r * 255);
         var gi = Math.round(g * 255);
         var bi = Math.round(b * 255);
         // ARGB フォーマット: 0xAARRGGBB
         bmp.setPixel(bx, by, 0xFF000000 | (ri << 16) | (gi << 8) | bi);
      }
   }

   return { bitmap: bmp, scale: scale, width: bmpW, height: bmpH };
}

//============================================================================
// ImagePreviewControl: 画像表示 + ズーム/パン/クリック
//
// ScrollBox のスクロール管理に依存せず、スクロール状態を自前で管理する。
// - this.scrollX / this.scrollY: コンテンツオフセット（手動管理）
// - スクロールバーは setHorizontalScrollRange / setVerticalScrollRange で明示設定
// - onPaint ではオフセット付きで描画
//============================================================================

function ImagePreviewControl(parent) {
   this.__base__ = ScrollBox;
   this.__base__(parent);

   this.bitmap = null;        // ストレッチ済み Bitmap
   this.bitmapScale = 1.0;    // 元画像→Bitmap の縮小率
   this.zoomLevel = 1.0;      // 表示ズーム倍率
   this.starMarkers = [];     // [{imgX, imgY, index}]
   this.selectedIndex = -1;   // 選択中のマーカーindex
   this.mode = "select";      // "select" or "pan"
   this.onImageClick = null;  // コールバック: function(imgX, imgY)

   // 手動スクロール管理
   this.scrollX = 0;
   this.scrollY = 0;
   this.maxScrollX = 0;
   this.maxScrollY = 0;

   // パン用
   this.isPanning = false;
   this.panStartX = 0;
   this.panStartY = 0;
   this.panScrollX = 0;
   this.panScrollY = 0;

   // ズームレベル候補
   this.zoomLevels = [
      0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 0.75,
      1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0
   ];
   this.zoomIndex = 9; // 初期 = 1.0

   this.autoScrolls = false; // 自前管理のため無効化

   var self = this;

   this.viewport.cursor = new Cursor(StdCursor_Arrow);

   // --- スクロールバーイベント ---
   this.onHorizontalScrollPosUpdated = function (pos) {
      self.scrollX = pos;
      self.viewport.update();
   };
   this.onVerticalScrollPosUpdated = function (pos) {
      self.scrollY = pos;
      self.viewport.update();
   };

   // --- 描画 ---
   this.viewport.onPaint = function () {
      var g = new Graphics(this);
      g.fillRect(this.boundsRect, new Brush(0xFF202020));

      if (self.bitmap) {
         var dispW = Math.round(self.bitmap.width * self.zoomLevel);
         var dispH = Math.round(self.bitmap.height * self.zoomLevel);

         // スクロールオフセット付きで描画
         g.drawScaledBitmap(
            new Rect(-self.scrollX, -self.scrollY,
                     dispW - self.scrollX, dispH - self.scrollY),
            self.bitmap);

         // マーカー描画
         for (var i = 0; i < self.starMarkers.length; i++) {
            var mk = self.starMarkers[i];
            // 画像座標 → コンテンツ座標 → 表示座標（スクロール差し引き）
            var vx = (mk.imgX * self.bitmapScale) * self.zoomLevel - self.scrollX;
            var vy = (mk.imgY * self.bitmapScale) * self.zoomLevel - self.scrollY;

            var isSelected = (i === self.selectedIndex);
            var circleR = isSelected ? 14 : 12;
            var crossR = isSelected ? 8 : 6;

            // 緑の円
            g.pen = new Pen(isSelected ? 0xFFFFFF00 : 0xB300FF00, isSelected ? 2 : 1.5);
            g.drawCircle(vx, vy, circleR);

            // 赤の十字
            g.pen = new Pen(0xCCFF0000, 1.5);
            g.drawLine(vx - crossR, vy, vx + crossR, vy);
            g.drawLine(vx, vy - crossR, vx, vy + crossR);

            // 番号
            g.pen = new Pen(0xE6FFFF00);
            g.font = new Font("Helvetica", 9);
            g.drawText(vx + circleR + 2, vy - circleR + 2, "" + (i + 1));
         }
      }

      g.end();
   };

   // --- マウスイベント ---
   this.viewport.onMousePress = function (x, y, button, buttonState, modifiers) {
      if (!self.bitmap) return;

      // 中ボタンまたは Pan モードの左ボタンでパン開始
      if (button === 4 || (button === 1 && self.mode === "pan")) {
         self.isPanning = true;
         self.panStartX = x;
         self.panStartY = y;
         self.panScrollX = self.scrollX;
         self.panScrollY = self.scrollY;
         self.viewport.cursor = new Cursor(StdCursor_ClosedHand);
         return;
      }

      // Select モードの左クリック
      if (button === 1 && self.mode === "select") {
         // 表示座標 → 画像座標
         var imgX = (x + self.scrollX) / (self.bitmapScale * self.zoomLevel);
         var imgY = (y + self.scrollY) / (self.bitmapScale * self.zoomLevel);

         if (self.onImageClick) {
            self.onImageClick(imgX, imgY);
         }
      }
   };

   this.viewport.onMouseMove = function (x, y, buttonState, modifiers) {
      if (self.isPanning) {
         var dx = x - self.panStartX;
         var dy = y - self.panStartY;
         self.setScroll(self.panScrollX - dx, self.panScrollY - dy);
      }
   };

   this.viewport.onMouseRelease = function (x, y, button, buttonState, modifiers) {
      if (self.isPanning) {
         self.isPanning = false;
         if (self.mode === "pan") {
            self.viewport.cursor = new Cursor(StdCursor_OpenHand);
         } else {
            self.viewport.cursor = new Cursor(StdCursor_Arrow);
         }
      }
   };

   this.viewport.onMouseWheel = function (x, y, delta, buttonState, modifiers) {
      if (!self.bitmap) return;

      var oldZoom = self.zoomLevel;

      if (delta > 0) {
         var found = false;
         for (var i = 0; i < self.zoomLevels.length; i++) {
            if (self.zoomLevels[i] > oldZoom + 1e-6) {
               self.zoomIndex = i;
               found = true;
               break;
            }
         }
         if (!found) return;
      } else {
         var found = false;
         for (var i = self.zoomLevels.length - 1; i >= 0; i--) {
            if (self.zoomLevels[i] < oldZoom - 1e-6) {
               self.zoomIndex = i;
               found = true;
               break;
            }
         }
         if (!found) return;
      }

      // マウス位置基準でズーム
      var newZoom = self.zoomLevels[self.zoomIndex];
      var factor = newZoom / oldZoom;
      var newScrollX = Math.round((self.scrollX + x) * factor - x);
      var newScrollY = Math.round((self.scrollY + y) * factor - y);

      self.zoomLevel = newZoom;
      self.scrollX = newScrollX;
      self.scrollY = newScrollY;
      self.updateViewport();
   };
}

ImagePreviewControl.prototype = new ScrollBox;

// スクロール位置をクランプして設定 + スクロールバー同期 + 再描画
ImagePreviewControl.prototype.setScroll = function (x, y) {
   this.scrollX = Math.max(0, Math.min(this.maxScrollX, Math.round(x)));
   this.scrollY = Math.max(0, Math.min(this.maxScrollY, Math.round(y)));
   // スクロールバーを同期
   this.horizontalScrollPosition = this.scrollX;
   this.verticalScrollPosition = this.scrollY;
   this.viewport.update();
};

ImagePreviewControl.prototype.setBitmap = function (bitmapResult) {
   this.bitmap = bitmapResult.bitmap;
   this.bitmapScale = bitmapResult.scale;
   this.scrollX = 0;
   this.scrollY = 0;
   this.updateViewport();
};

ImagePreviewControl.prototype.updateViewport = function () {
   if (!this.bitmap) return;
   var dispW = Math.round(this.bitmap.width * this.zoomLevel);
   var dispH = Math.round(this.bitmap.height * this.zoomLevel);

   // 表示領域サイズ
   var viewW = this.viewport.width;
   var viewH = this.viewport.height;
   if (viewW <= 0) viewW = this.width;
   if (viewH <= 0) viewH = this.height;

   // スクロール範囲
   this.maxScrollX = Math.max(0, dispW - viewW);
   this.maxScrollY = Math.max(0, dispH - viewH);

   // クランプ
   this.scrollX = Math.max(0, Math.min(this.maxScrollX, this.scrollX));
   this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY));

   // スクロールバー設定
   this.setHorizontalScrollRange(0, this.maxScrollX);
   this.setVerticalScrollRange(0, this.maxScrollY);
   this.horizontalScrollPosition = this.scrollX;
   this.verticalScrollPosition = this.scrollY;

   this.viewport.update();
};

ImagePreviewControl.prototype.fitToWindow = function () {
   if (!this.bitmap) return;
   var viewW = this.viewport.width;
   var viewH = this.viewport.height;
   if (viewW <= 0) viewW = this.width;
   if (viewH <= 0) viewH = this.height;
   if (viewW <= 0 || viewH <= 0) return;

   var zx = viewW / this.bitmap.width;
   var zy = viewH / this.bitmap.height;
   var fitZoom = Math.min(zx, zy);

   this.zoomLevel = fitZoom;
   this.zoomIndex = this.findNearestZoomIndex(fitZoom);
   this.scrollX = 0;
   this.scrollY = 0;
   this.updateViewport();
};

// 指定倍率に最も近い zoomIndex を返す
ImagePreviewControl.prototype.findNearestZoomIndex = function (zoom) {
   var bestIdx = 0;
   var bestDiff = Math.abs(this.zoomLevels[0] - zoom);
   for (var i = 1; i < this.zoomLevels.length; i++) {
      var diff = Math.abs(this.zoomLevels[i] - zoom);
      if (diff < bestDiff) {
         bestDiff = diff;
         bestIdx = i;
      }
   }
   return bestIdx;
};

// ビューポート中央を基準にズーム変更
ImagePreviewControl.prototype.zoomAroundCenter = function (newZoom) {
   var oldZoom = this.zoomLevel;
   if (Math.abs(oldZoom - newZoom) < 1e-9) return;

   var viewW = this.viewport.width;
   var viewH = this.viewport.height;
   if (viewW <= 0) viewW = this.width;
   if (viewH <= 0) viewH = this.height;

   // 現在の表示中央のコンテンツ座標
   var centerX = this.scrollX + viewW / 2.0;
   var centerY = this.scrollY + viewH / 2.0;

   // 新しいズームでの中央座標
   var factor = newZoom / oldZoom;
   this.scrollX = Math.round(centerX * factor - viewW / 2.0);
   this.scrollY = Math.round(centerY * factor - viewH / 2.0);

   this.zoomLevel = newZoom;
   this.updateViewport(); // クランプ + スクロールバー更新 + 再描画
};

ImagePreviewControl.prototype.zoom11 = function () {
   this.zoomIndex = this.findNearestZoomIndex(1.0);
   this.zoomAroundCenter(this.zoomLevels[this.zoomIndex]);
};

ImagePreviewControl.prototype.zoomIn = function () {
   var newIdx = -1;
   for (var i = 0; i < this.zoomLevels.length; i++) {
      if (this.zoomLevels[i] > this.zoomLevel + 1e-6) {
         newIdx = i;
         break;
      }
   }
   if (newIdx >= 0) {
      this.zoomIndex = newIdx;
      this.zoomAroundCenter(this.zoomLevels[this.zoomIndex]);
   }
};

ImagePreviewControl.prototype.zoomOut = function () {
   var newIdx = -1;
   for (var i = this.zoomLevels.length - 1; i >= 0; i--) {
      if (this.zoomLevels[i] < this.zoomLevel - 1e-6) {
         newIdx = i;
         break;
      }
   }
   if (newIdx >= 0) {
      this.zoomIndex = newIdx;
      this.zoomAroundCenter(this.zoomLevels[this.zoomIndex]);
   }
};

ImagePreviewControl.prototype.setMode = function (mode) {
   this.mode = mode;
   if (mode === "pan") {
      this.viewport.cursor = new Cursor(StdCursor_OpenHand);
   } else {
      this.viewport.cursor = new Cursor(StdCursor_Arrow);
   }
};

//============================================================================
// StarEditDialog: 星座標入力サブダイアログ
//============================================================================

function StarEditDialog(parent, starIndex, starData) {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;
   this.starData = starData || { px: 0, py: 0, ra: null, dec: null, name: "" };

   this.windowTitle = "Reference Star #" + starIndex;
   this.minWidth = 440;

   // --- ピクセル座標表示 ---
   var pixelLabel = new Label(this);
   pixelLabel.text = "Pixel:  X = " + this.starData.px.toFixed(2)
                   + "    Y = " + this.starData.py.toFixed(2);
   pixelLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   // --- 天体名 + 検索 ---
   var nameLabel = new Label(this);
   nameLabel.text = "天体名:";
   nameLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   nameLabel.setFixedWidth(60);

   this.nameEdit = new Edit(this);
   this.nameEdit.text = this.starData.name || "";
   this.nameEdit.toolTip = "天体名を入力して Search（例: Sirius, Vega, M42）";

   this.searchButton = new PushButton(this);
   this.searchButton.text = "Search";
   this.searchButton.toolTip = "CDS Sesame で天体名から座標を検索";
   this.searchButton.onClick = function () {
      var name = self.nameEdit.text.trim();
      if (name.length === 0) {
         var mb = new MessageBox("天体名を入力してください。",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      console.writeln("Sesame 検索: " + name + " ...");
      console.flush();
      var result = searchObjectCoordinates(name);
      if (result) {
         self.raEdit.text = raToHMS(result.ra);
         self.decEdit.text = decToDMS(result.dec);
         console.writeln("  → RA=" + result.ra.toFixed(4) + ", DEC=" + result.dec.toFixed(4));
      } else {
         var mb = new MessageBox(
            "'" + name + "' が見つかりませんでした。\nRA/DEC を直接入力してください。",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
      }
   };

   var nameSizer = new HorizontalSizer;
   nameSizer.spacing = 4;
   nameSizer.add(nameLabel);
   nameSizer.add(this.nameEdit, 100);
   nameSizer.add(this.searchButton);

   // --- RA ---
   var raLabel = new Label(this);
   raLabel.text = "RA:";
   raLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   raLabel.setFixedWidth(60);

   this.raEdit = new Edit(this);
   this.raEdit.toolTip = "HH MM SS.ss / HH:MM:SS.ss / 度数";
   if (this.starData.ra !== null && this.starData.ra !== undefined) {
      this.raEdit.text = raToHMS(this.starData.ra);
   }

   var raHintLabel = new Label(this);
   raHintLabel.text = "(HH MM SS / deg)";

   var raSizer = new HorizontalSizer;
   raSizer.spacing = 4;
   raSizer.add(raLabel);
   raSizer.add(this.raEdit, 100);
   raSizer.add(raHintLabel);

   // --- DEC ---
   var decLabel = new Label(this);
   decLabel.text = "DEC:";
   decLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   decLabel.setFixedWidth(60);

   this.decEdit = new Edit(this);
   this.decEdit.toolTip = "+DD MM SS.s / +DD:MM:SS.s / 度数";
   if (this.starData.dec !== null && this.starData.dec !== undefined) {
      this.decEdit.text = decToDMS(this.starData.dec);
   }

   var decHintLabel = new Label(this);
   decHintLabel.text = "(+DD MM SS / deg)";

   var decSizer = new HorizontalSizer;
   decSizer.spacing = 4;
   decSizer.add(decLabel);
   decSizer.add(this.decEdit, 100);
   decSizer.add(decHintLabel);

   // --- OK / Cancel ---
   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.icon = this.scaledResource(":/icons/ok.png");
   this.okButton.onClick = function () {
      // バリデーション
      var ra = parseRAInput(self.raEdit.text);
      var dec = parseDECInput(self.decEdit.text);

      if (ra === null || dec === null) {
         var mb = new MessageBox("RA と DEC を正しく入力してください。",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      if (ra < 0 || ra >= 360) {
         var mb = new MessageBox("RA は 0〜360 度の範囲で入力してください。",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      if (dec < -90 || dec > 90) {
         var mb = new MessageBox("DEC は -90〜+90 度の範囲で入力してください。",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }

      self.starData.ra = ra;
      self.starData.dec = dec;
      self.starData.name = self.nameEdit.text.trim();
      self.ok();
   };

   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Cancel";
   this.cancelButton.icon = this.scaledResource(":/icons/cancel.png");
   this.cancelButton.onClick = function () {
      self.cancel();
   };

   var buttonSizer = new HorizontalSizer;
   buttonSizer.addStretch();
   buttonSizer.spacing = 8;
   buttonSizer.add(this.okButton);
   buttonSizer.add(this.cancelButton);

   // --- Layout ---
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 8;
   this.sizer.add(pixelLabel);
   this.sizer.addSpacing(4);
   this.sizer.add(nameSizer);
   this.sizer.add(raSizer);
   this.sizer.add(decSizer);
   this.sizer.addSpacing(8);
   this.sizer.add(buttonSizer);

   this.adjustToContents();
}

StarEditDialog.prototype = new Dialog;

//============================================================================
// ManualSolverDialog: メインダイアログ
//============================================================================

function ManualSolverDialog(targetWindow) {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;
   this.targetWindow = targetWindow;
   this.image = targetWindow.mainView.image;
   this.starPairs = [];      // [{px, py, ra, dec, name}]
   this.wcsResult = null;    // WCSFitter.solve() の結果
   this.stretchMode = "linked"; // "none" / "linked" / "unlinked"

   this.windowTitle = TITLE + " v" + VERSION;
   this.minWidth = 800;
   this.minHeight = 600;

   // --- Bitmap 生成 ---
   console.writeln("ストレッチ済み Bitmap を生成中...");
   console.flush();
   var bmpResult = createStretchedBitmap(this.image, MAX_BITMAP_EDGE, this.stretchMode);
   console.writeln("  Bitmap: " + bmpResult.width + " x " + bmpResult.height
      + " (scale=" + bmpResult.scale.toFixed(3) + ")");

   // --- ツールバー ---
   this.fitButton = new PushButton(this);
   this.fitButton.text = "Fit";
   this.fitButton.toolTip = "Fit to Window";
   this.fitButton.onClick = function () {
      self.preview.fitToWindow();
   };

   this.zoom11Button = new PushButton(this);
   this.zoom11Button.text = "1:1";
   this.zoom11Button.toolTip = "Zoom 1:1";
   this.zoom11Button.onClick = function () {
      self.preview.zoom11();
   };

   this.zoomInButton = new PushButton(this);
   this.zoomInButton.text = "+";
   this.zoomInButton.toolTip = "Zoom In";
   this.zoomInButton.onClick = function () {
      self.preview.zoomIn();
   };

   this.zoomOutButton = new PushButton(this);
   this.zoomOutButton.text = "\u2212"; // マイナス記号（U+2212）
   this.zoomOutButton.toolTip = "Zoom Out";
   this.zoomOutButton.onClick = function () {
      self.preview.zoomOut();
   };

   this.selectRadio = new RadioButton(this);
   this.selectRadio.text = "Select";
   this.selectRadio.checked = true;
   this.selectRadio.toolTip = "クリックで星を選択";
   this.selectRadio.onCheck = function (checked) {
      if (checked) self.preview.setMode("select");
   };

   this.panRadio = new RadioButton(this);
   this.panRadio.text = "Pan";
   this.panRadio.toolTip = "ドラッグで画像をパン";
   this.panRadio.onCheck = function (checked) {
      if (checked) self.preview.setMode("pan");
   };

   var stretchLabel = new Label(this);
   stretchLabel.text = "Stretch:";
   stretchLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.stretchComboBox = new ComboBox(this);
   this.stretchComboBox.addItem("No Stretch");
   this.stretchComboBox.addItem("Linked");
   this.stretchComboBox.addItem("Unlinked");
   this.stretchComboBox.currentItem = 1; // Linked がデフォルト
   this.stretchComboBox.toolTip = "オートストレッチモード";
   this.stretchComboBox.onItemSelected = function (index) {
      var modes = ["none", "linked", "unlinked"];
      self.stretchMode = modes[index];
      self.rebuildBitmap();
   };

   var toolbarSizer = new HorizontalSizer;
   toolbarSizer.spacing = 4;
   toolbarSizer.add(this.fitButton);
   toolbarSizer.add(this.zoom11Button);
   toolbarSizer.add(this.zoomInButton);
   toolbarSizer.add(this.zoomOutButton);
   toolbarSizer.addSpacing(12);
   toolbarSizer.add(this.selectRadio);
   toolbarSizer.add(this.panRadio);
   toolbarSizer.addSpacing(12);
   toolbarSizer.add(stretchLabel);
   toolbarSizer.add(this.stretchComboBox);
   toolbarSizer.addStretch();

   // --- ImagePreviewControl ---
   this.preview = new ImagePreviewControl(this);
   this.preview.setMinSize(400, 300);
   this.preview.setBitmap(bmpResult);

   this.preview.onImageClick = function (imgX, imgY) {
      self.onImageClicked(imgX, imgY);
   };

   // --- 星テーブル（TreeBox） ---
   var starTableLabel = new Label(this);
   starTableLabel.text = "Reference Stars (minimum 4):";

   this.starTreeBox = new TreeBox(this);
   this.starTreeBox.alternateRowColor = true;
   this.starTreeBox.headerVisible = true;
   this.starTreeBox.numberOfColumns = 6;
   this.starTreeBox.setHeaderText(0, "#");
   this.starTreeBox.setHeaderText(1, "X");
   this.starTreeBox.setHeaderText(2, "Y");
   this.starTreeBox.setHeaderText(3, "Name");
   this.starTreeBox.setHeaderText(4, "RA / DEC");
   this.starTreeBox.setHeaderText(5, "Residual");
   this.starTreeBox.setColumnWidth(0, 30);
   this.starTreeBox.setColumnWidth(1, 70);
   this.starTreeBox.setColumnWidth(2, 70);
   this.starTreeBox.setColumnWidth(3, 120);
   this.starTreeBox.setColumnWidth(4, 200);
   this.starTreeBox.setColumnWidth(5, 80);
   this.starTreeBox.setMinHeight(120);

   // TreeBox 選択変更 → マーカーハイライト
   this.starTreeBox.onCurrentNodeUpdated = function (node) {
      if (node) {
         self.preview.selectedIndex = self.starTreeBox.childIndex(node);
      } else {
         self.preview.selectedIndex = -1;
      }
      self.preview.viewport.update();
   };

   // TreeBox ダブルクリック → 編集
   this.starTreeBox.onNodeDoubleClicked = function (node, col) {
      var idx = self.starTreeBox.childIndex(node);
      if (idx >= 0 && idx < self.starPairs.length) {
         self.editStar(idx);
      }
   };

   // --- 星テーブルのボタン ---
   this.editStarButton = new PushButton(this);
   this.editStarButton.text = "Edit...";
   this.editStarButton.toolTip = "選択した星を編集";
   this.editStarButton.onClick = function () {
      var node = self.starTreeBox.currentNode;
      if (!node) return;
      var idx = self.starTreeBox.childIndex(node);
      if (idx >= 0 && idx < self.starPairs.length) {
         self.editStar(idx);
      }
   };

   this.removeStarButton = new PushButton(this);
   this.removeStarButton.text = "Remove";
   this.removeStarButton.toolTip = "選択した星を削除";
   this.removeStarButton.onClick = function () {
      var node = self.starTreeBox.currentNode;
      if (!node) return;
      var idx = self.starTreeBox.childIndex(node);
      if (idx >= 0 && idx < self.starPairs.length) {
         self.starPairs.splice(idx, 1);
         self.wcsResult = null;
         self.refreshAll();
      }
   };

   this.clearStarsButton = new PushButton(this);
   this.clearStarsButton.text = "Clear All";
   this.clearStarsButton.toolTip = "全ての星を削除";
   this.clearStarsButton.onClick = function () {
      if (self.starPairs.length === 0) return;
      var mb = new MessageBox("全ての星を削除しますか？",
         TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         self.starPairs = [];
         self.wcsResult = null;
         self.refreshAll();
      }
   };

   var starButtonSizer = new HorizontalSizer;
   starButtonSizer.spacing = 4;
   starButtonSizer.add(this.editStarButton);
   starButtonSizer.add(this.removeStarButton);
   starButtonSizer.add(this.clearStarsButton);
   starButtonSizer.addStretch();

   // --- ステータスラベル ---
   this.statusLabel = new Label(this);
   this.statusLabel.text = "星を画像上でクリックして登録してください。";
   this.statusLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   // --- メインボタン ---
   this.solveButton = new PushButton(this);
   this.solveButton.text = "Solve";
   this.solveButton.icon = this.scaledResource(":/icons/ok.png");
   this.solveButton.toolTip = "WCS フィッティングを実行（4星以上必要）";
   this.solveButton.onClick = function () {
      self.doSolve();
   };

   this.applyButton = new PushButton(this);
   this.applyButton.text = "Apply to Image";
   this.applyButton.icon = this.scaledResource(":/icons/execute.png");
   this.applyButton.toolTip = "WCS を画像に適用";
   this.applyButton.enabled = false;
   this.applyButton.onClick = function () {
      self.doApply();
   };

   this.closeButton = new PushButton(this);
   this.closeButton.text = "Close";
   this.closeButton.icon = this.scaledResource(":/icons/cancel.png");
   this.closeButton.onClick = function () {
      self.cancel();
   };

   var mainButtonSizer = new HorizontalSizer;
   mainButtonSizer.addStretch();
   mainButtonSizer.spacing = 8;
   mainButtonSizer.add(this.solveButton);
   mainButtonSizer.add(this.applyButton);
   mainButtonSizer.add(this.closeButton);

   // --- 全体レイアウト ---
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(toolbarSizer);
   this.sizer.add(this.preview, 100);
   this.sizer.add(starTableLabel);
   this.sizer.add(this.starTreeBox, 30);
   this.sizer.add(starButtonSizer);
   this.sizer.add(this.statusLabel);
   this.sizer.addSpacing(4);
   this.sizer.add(mainButtonSizer);

   this.resize(900, 700);

   // 初期表示: fit to window（遅延実行）
   this.onShow = function () {
      self.preview.fitToWindow();
   };
}

ManualSolverDialog.prototype = new Dialog;

//----------------------------------------------------------------------------
// 画像クリック処理
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.onImageClicked = function (imgX, imgY) {
   // セントロイド計算
   var centroid = computeCentroid(this.image, imgX, imgY, 10);
   var cx = centroid ? centroid.x : imgX;
   var cy = centroid ? centroid.y : imgY;

   // 画像範囲外チェック
   if (cx < 0 || cx >= this.image.width || cy < 0 || cy >= this.image.height) return;

   var starIndex = this.starPairs.length + 1;
   var starData = { px: cx, py: cy, ra: null, dec: null, name: "" };

   var dlg = new StarEditDialog(this, starIndex, starData);
   if (dlg.execute()) {
      this.starPairs.push(dlg.starData);
      this.wcsResult = null;
      this.refreshAll();
   }
};

//----------------------------------------------------------------------------
// 星の編集
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.editStar = function (index) {
   var existing = this.starPairs[index];
   var starData = { px: existing.px, py: existing.py, ra: existing.ra, dec: existing.dec, name: existing.name };

   var dlg = new StarEditDialog(this, index + 1, starData);
   if (dlg.execute()) {
      this.starPairs[index] = dlg.starData;
      this.wcsResult = null;
      this.refreshAll();
   }
};

//----------------------------------------------------------------------------
// UI 更新
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.refreshAll = function () {
   // TreeBox 更新
   this.starTreeBox.clear();
   for (var i = 0; i < this.starPairs.length; i++) {
      var s = this.starPairs[i];
      var node = new TreeBoxNode(this.starTreeBox);
      node.setText(0, "" + (i + 1));
      node.setText(1, s.px.toFixed(1));
      node.setText(2, s.py.toFixed(1));
      node.setText(3, s.name || "");
      node.setText(4, raToHMS(s.ra) + " / " + decToDMS(s.dec));

      // 残差
      if (this.wcsResult && this.wcsResult.residuals && this.wcsResult.residuals[i]) {
         node.setText(5, this.wcsResult.residuals[i].residual_arcsec.toFixed(2) + "\"");
      } else {
         node.setText(5, "");
      }
   }

   // マーカー更新
   this.preview.starMarkers = [];
   for (var i = 0; i < this.starPairs.length; i++) {
      this.preview.starMarkers.push({
         imgX: this.starPairs[i].px,
         imgY: this.starPairs[i].py,
         index: i
      });
   }
   this.preview.viewport.update();

   // ステータス更新
   var nStars = this.starPairs.length;
   var statusText = nStars + " star" + (nStars !== 1 ? "s" : "") + " registered";
   if (this.wcsResult && this.wcsResult.success) {
      statusText += " | RMS " + this.wcsResult.rms_arcsec.toFixed(2) + "\""
         + " | Scale " + this.wcsResult.pixelScale_arcsec.toFixed(2) + "\"/px";
   }
   this.statusLabel.text = statusText;

   // ボタン状態
   this.applyButton.enabled = (this.wcsResult !== null && this.wcsResult.success);
};

//----------------------------------------------------------------------------
// Bitmap 再生成（ストレッチモード変更時）
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.rebuildBitmap = function () {
   console.writeln("Bitmap を再生成中（" + this.stretchMode + "）...");
   console.flush();
   var bmpResult = createStretchedBitmap(this.image, MAX_BITMAP_EDGE, this.stretchMode);
   this.preview.setBitmap(bmpResult);
   console.writeln("  完了。");
};

//----------------------------------------------------------------------------
// Solve
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.doSolve = function () {
   if (this.starPairs.length < 4) {
      var mb = new MessageBox(
         "最低4つの星ペアが必要です（現在: " + this.starPairs.length + "）。",
         TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }

   var fitter = new WCSFitter(this.starPairs, this.image.width, this.image.height);
   this.wcsResult = fitter.solve();

   if (!this.wcsResult.success) {
      var mb = new MessageBox("WCS フィットに失敗しました:\n" + this.wcsResult.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      this.refreshAll();
      return;
   }

   console.writeln("");
   console.writeln("<b>WCS フィット結果:</b>");
   console.writeln("  RMS: " + this.wcsResult.rms_arcsec.toFixed(3) + " arcsec");
   console.writeln("  Pixel scale: " + this.wcsResult.pixelScale_arcsec.toFixed(3) + " arcsec/px");
   console.writeln("  Stars: " + this.starPairs.length);

   this.refreshAll();
};

//----------------------------------------------------------------------------
// Apply to Image
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.doApply = function () {
   if (!this.wcsResult || !this.wcsResult.success) return;

   console.writeln("");
   console.writeln("<b>WCS を画像に適用中...</b>");

   applyWCSToImage(this.targetWindow, this.wcsResult, this.image.width, this.image.height);

   // コンソール表示
   var wcsObj = {
      crval1: this.wcsResult.crval1, crval2: this.wcsResult.crval2,
      crpix1: this.wcsResult.crpix1, crpix2: this.wcsResult.crpix2,
      cd1_1: this.wcsResult.cd[0][0], cd1_2: this.wcsResult.cd[0][1],
      cd2_1: this.wcsResult.cd[1][0], cd2_2: this.wcsResult.cd[1][1]
   };
   console.writeln("  Pixel scale: " + this.wcsResult.pixelScale_arcsec.toFixed(3) + " arcsec/px");
   displayStarPairs(this.starPairs, this.wcsResult.residuals);
   displayImageCoordinates(wcsObj, this.image.width, this.image.height);

   console.writeln("");
   console.writeln("<b>WCS を正常に適用しました。</b>");

   // Apply 成功時にセッション保存
   this.saveSessionData();

   var mb = new MessageBox(
      "WCS を正常に適用しました。\n\n"
      + "RMS: " + this.wcsResult.rms_arcsec.toFixed(3) + " arcsec\n"
      + "Pixel scale: " + this.wcsResult.pixelScale_arcsec.toFixed(3) + " arcsec/px\n"
      + "Stars: " + this.starPairs.length,
      TITLE, StdIcon_Information, StdButton_Ok);
   mb.execute();
};

//============================================================================
// セッション保存/復元
//============================================================================

#define SETTINGS_KEY "ManualImageSolver/sessionData"

// セッションデータを Settings に保存
function saveSession(imageId, imageWidth, imageHeight, stretchMode, starPairs) {
   var data = {
      imageId: imageId,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      stretchMode: stretchMode,
      starPairs: []
   };
   for (var i = 0; i < starPairs.length; i++) {
      var s = starPairs[i];
      data.starPairs.push({
         px: s.px, py: s.py,
         ra: s.ra, dec: s.dec,
         name: s.name || ""
      });
   }
   Settings.write(SETTINGS_KEY, DataType_String, JSON.stringify(data));
}

// Settings からセッションデータを読み込み
// 成功時: パース済みオブジェクト、失敗時: null
function loadSession() {
   var raw = Settings.read(SETTINGS_KEY, DataType_String);
   if (!raw || raw.length === 0) return null;
   try {
      var data = JSON.parse(raw);
      if (!data || !data.starPairs || data.starPairs.length === 0) return null;
      return data;
   } catch (e) {
      return null;
   }
}

//----------------------------------------------------------------------------
// ダイアログ Close 時にセッション保存
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.saveSessionData = function () {
   if (this.starPairs.length > 0) {
      saveSession(
         this.targetWindow.mainView.id,
         this.image.width,
         this.image.height,
         this.stretchMode,
         this.starPairs
      );
      console.writeln("セッションデータを保存しました（星 " + this.starPairs.length + " 個）。");
   }
};

//============================================================================
// メイン実行
//============================================================================

function main() {
   if (ImageWindow.activeWindow.isNull) {
      var mb = new MessageBox(
         "画像が開かれていません。\n先に画像を開いてからスクリプトを実行してください。",
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   var targetWindow = ImageWindow.activeWindow;
   var image = targetWindow.mainView.image;

   console.writeln("<b>" + TITLE + " v" + VERSION + "</b>");
   console.writeln("---");
   console.writeln("Image: " + targetWindow.mainView.id
      + " (" + image.width + " x " + image.height + " px)");

   // セッション復元チェック
   var restoredStarPairs = null;
   var restoredStretchMode = null;
   var sessionData = loadSession();
   if (sessionData
       && sessionData.imageWidth === image.width
       && sessionData.imageHeight === image.height) {
      var msg = "前回のセッションデータが見つかりました。\n\n"
         + "画像: " + (sessionData.imageId || "(不明)") + "\n"
         + "星ペア: " + sessionData.starPairs.length + " 個\n\n"
         + "復元しますか？";
      var mb = new MessageBox(msg, TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         restoredStarPairs = sessionData.starPairs;
         restoredStretchMode = sessionData.stretchMode || "linked";
         console.writeln("セッションを復元します（星 " + restoredStarPairs.length + " 個）。");
      }
   }

   var dlg = new ManualSolverDialog(targetWindow);

   // セッション復元: 星ペアとストレッチモードを適用
   if (restoredStarPairs) {
      dlg.starPairs = restoredStarPairs;
      if (restoredStretchMode && restoredStretchMode !== dlg.stretchMode) {
         dlg.stretchMode = restoredStretchMode;
         var modeIndex = { "none": 0, "linked": 1, "unlinked": 2 };
         if (typeof modeIndex[restoredStretchMode] !== "undefined") {
            dlg.stretchComboBox.currentItem = modeIndex[restoredStretchMode];
         }
         dlg.rebuildBitmap();
      }
      dlg.refreshAll();
   }

   dlg.execute();

   // ダイアログ Close 時にセッション保存
   dlg.saveSessionData();

   console.writeln("");
   console.writeln(TITLE + " を終了しました。");
}

main();
