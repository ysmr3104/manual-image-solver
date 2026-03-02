#feature-id    ManualImageSolver : Utilities > ManualImageSolver
#feature-info  Manual plate solver: identify stars on an image to compute \
   a TAN-projection WCS solution.

//----------------------------------------------------------------------------
// ManualImageSolver.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Manual Image Solver: ユーザーが画像上の星を手動で同定し、
// TAN投影 WCS をフィッティングするプレートソルバー。
//
// Copyright (c) 2024-2025 Split Image Solver Project
//----------------------------------------------------------------------------

#define VERSION "1.0.0"

#include <pjsr/DataType.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/UndoFlag.jsh>

#define TITLE   "Manual Image Solver"

//============================================================================
// ユーティリティ関数（SplitImageSolver.js から再利用）
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

// RA入力をパース（HMS "HH MM SS.ss" / "HH:MM:SS.ss" または度数）
function parseRAInput(text) {
   text = text.trim();
   if (text.length === 0) return undefined;
   var parts = text.split(/[\s:]+/);
   if (parts.length >= 3) {
      var h = parseFloat(parts[0]);
      var m = parseFloat(parts[1]);
      var s = parseFloat(parts[2]);
      if (!isNaN(h) && !isNaN(m) && !isNaN(s))
         return (h + m / 60.0 + s / 3600.0) * 15.0;
   }
   var v = parseFloat(text);
   return isNaN(v) ? undefined : v;
}

// DEC入力をパース（DMS "±DD MM SS.ss" / "±DD:MM:SS.ss" または度数）
function parseDECInput(text) {
   text = text.trim();
   if (text.length === 0) return undefined;
   var sign = 1;
   if (text.charAt(0) === '-') { sign = -1; text = text.substring(1); }
   else if (text.charAt(0) === '+') { text = text.substring(1); }
   var parts = text.split(/[\s:]+/);
   if (parts.length >= 3) {
      var d = parseFloat(parts[0]);
      var m = parseFloat(parts[1]);
      var s = parseFloat(parts[2]);
      if (!isNaN(d) && !isNaN(m) && !isNaN(s))
         return sign * (d + m / 60.0 + s / 3600.0);
   }
   var v = parseFloat(text);
   return isNaN(v) ? undefined : sign * v;
}

// バイト配列を文字列に変換
function byteArrayToString(ba) {
   if (!ba || ba.length === 0) return "";
   try {
      var s = "";
      for (var i = 0; i < ba.length; ++i) {
         var c = ba.at(i);
         if (c > 0) s += String.fromCharCode(c);
      }
      return s;
   } catch (e) {
      console.warningln("byteArrayToString failed: " + e.message);
      return "";
   }
}

// 天体名からRA/DECを検索（CDS Sesame name resolver）
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
            if (!isNaN(ra) && !isNaN(dec))
               return { ra: ra, dec: dec };
         }
      }
   }
   return null;
}

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

//============================================================================
// WCS 数学関数（wcs_math.js からインライン）
//============================================================================

// TAN（gnomonic）投影: 天球座標 → 標準座標
function tanProject(crval, coord) {
   var ra0  = crval[0] * Math.PI / 180.0;
   var dec0 = crval[1] * Math.PI / 180.0;
   var ra   = coord[0] * Math.PI / 180.0;
   var dec  = coord[1] * Math.PI / 180.0;

   var cosDec  = Math.cos(dec);
   var sinDec  = Math.sin(dec);
   var cosDec0 = Math.cos(dec0);
   var sinDec0 = Math.sin(dec0);
   var dRA     = ra - ra0;
   var cosDRA  = Math.cos(dRA);

   var D = sinDec0 * sinDec + cosDec0 * cosDec * cosDRA;
   if (D <= 0) return null;

   var xi  = (cosDec * Math.sin(dRA)) / D * (180.0 / Math.PI);
   var eta = (cosDec0 * sinDec - sinDec0 * cosDec * cosDRA) / D * (180.0 / Math.PI);
   return [xi, eta];
}

// TAN 逆投影: 標準座標 → 天球座標
function tanDeproject(crval, standard) {
   var ra0  = crval[0] * Math.PI / 180.0;
   var dec0 = crval[1] * Math.PI / 180.0;
   var xi   = standard[0] * Math.PI / 180.0;
   var eta  = standard[1] * Math.PI / 180.0;

   var rho = Math.sqrt(xi * xi + eta * eta);
   if (rho === 0) return [crval[0], crval[1]];

   var c = Math.atan(rho);
   var cosC = Math.cos(c);
   var sinC = Math.sin(c);
   var cosDec0 = Math.cos(dec0);
   var sinDec0 = Math.sin(dec0);

   var dec = Math.asin(cosC * sinDec0 + eta * sinC * cosDec0 / rho);
   var ra  = ra0 + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);

   var raDeg = ra * 180.0 / Math.PI;
   while (raDeg < 0) raDeg += 360.0;
   while (raDeg >= 360.0) raDeg -= 360.0;
   return [raDeg, dec * 180.0 / Math.PI];
}

// 角距離計算（Vincenty 公式）
function angularSeparation(coord1, coord2) {
   var ra1  = coord1[0] * Math.PI / 180.0;
   var dec1 = coord1[1] * Math.PI / 180.0;
   var ra2  = coord2[0] * Math.PI / 180.0;
   var dec2 = coord2[1] * Math.PI / 180.0;

   var dRA = ra2 - ra1;
   var cosDec1 = Math.cos(dec1);
   var sinDec1 = Math.sin(dec1);
   var cosDec2 = Math.cos(dec2);
   var sinDec2 = Math.sin(dec2);

   var num1 = cosDec2 * Math.sin(dRA);
   var num2 = cosDec1 * sinDec2 - sinDec1 * cosDec2 * Math.cos(dRA);
   var den  = sinDec1 * sinDec2 + cosDec1 * cosDec2 * Math.cos(dRA);
   return Math.atan2(Math.sqrt(num1 * num1 + num2 * num2), den) * 180.0 / Math.PI;
}

//============================================================================
// WCSFitter: 星ペアから TAN 投影 WCS をフィッティング
//============================================================================

function WCSFitter(starPairs, imageWidth, imageHeight) {
   this.stars = starPairs;
   this.width = imageWidth;
   this.height = imageHeight;
   this.crpix1 = imageWidth / 2.0 + 0.5;
   this.crpix2 = imageHeight / 2.0 + 0.5;
}

WCSFitter.prototype.solve = function () {
   var stars = this.stars;
   var nStars = stars.length;

   if (nStars < 4) {
      return {
         success: false,
         message: "最低4つの星ペアが必要です（現在: " + nStars + "）"
      };
   }

   for (var i = 0; i < nStars; i++) {
      if (stars[i].ra < 0 || stars[i].ra >= 360) {
         return { success: false, message: "星 " + (i + 1) + " の RA が範囲外です: " + stars[i].ra };
      }
      if (stars[i].dec < -90 || stars[i].dec > 90) {
         return { success: false, message: "星 " + (i + 1) + " の DEC が範囲外です: " + stars[i].dec };
      }
   }

   var crpix1 = this.crpix1;
   var crpix2 = this.crpix2;

   // CRVAL 初期値 = 星の天球座標重心（RA はベクトル平均）
   var crval1 = 0, crval2 = 0;
   var sumCosRA = 0, sumSinRA = 0;
   for (var i = 0; i < nStars; i++) {
      var raRad = stars[i].ra * Math.PI / 180.0;
      sumCosRA += Math.cos(raRad);
      sumSinRA += Math.sin(raRad);
      crval2 += stars[i].dec;
   }
   crval1 = Math.atan2(sumSinRA, sumCosRA) * 180.0 / Math.PI;
   if (crval1 < 0) crval1 += 360.0;
   crval2 /= nStars;

   // 反復: TAN投影 → CD行列フィット → CRVAL更新
   var cd = [[0, 0], [0, 0]];
   var maxIter = 5;

   for (var iter = 0; iter < maxIter; iter++) {
      var crval = [crval1, crval2];
      var projOk = true;
      var xiArr = [], etaArr = [];
      for (var i = 0; i < nStars; i++) {
         var proj = tanProject(crval, [stars[i].ra, stars[i].dec]);
         if (proj === null) { projOk = false; break; }
         xiArr.push(proj[0]);
         etaArr.push(proj[1]);
      }
      if (!projOk) {
         return { success: false, message: "TAN投影に失敗しました" };
      }

      var uArr = [], vArr = [];
      for (var i = 0; i < nStars; i++) {
         uArr.push((stars[i].px + 1.0) - crpix1);
         vArr.push((stars[i].py + 1.0) - crpix2);
      }

      var sumUU = 0, sumUV = 0, sumVV = 0;
      var sumUXi = 0, sumVXi = 0, sumUEta = 0, sumVEta = 0;
      for (var i = 0; i < nStars; i++) {
         sumUU += uArr[i] * uArr[i];
         sumUV += uArr[i] * vArr[i];
         sumVV += vArr[i] * vArr[i];
         sumUXi  += uArr[i] * xiArr[i];
         sumVXi  += vArr[i] * xiArr[i];
         sumUEta += uArr[i] * etaArr[i];
         sumVEta += vArr[i] * etaArr[i];
      }

      var det = sumUU * sumVV - sumUV * sumUV;
      if (Math.abs(det) < 1e-30) {
         return { success: false, message: "正規方程式の行列式がゼロです" };
      }

      cd[0][0] = (sumUXi * sumVV - sumVXi * sumUV) / det;
      cd[0][1] = (sumUU * sumVXi - sumUV * sumUXi) / det;
      cd[1][0] = (sumUEta * sumVV - sumVEta * sumUV) / det;
      cd[1][1] = (sumUU * sumVEta - sumUV * sumUEta) / det;

      var sumDXi = 0, sumDEta = 0;
      for (var i = 0; i < nStars; i++) {
         var predXi  = cd[0][0] * uArr[i] + cd[0][1] * vArr[i];
         var predEta = cd[1][0] * uArr[i] + cd[1][1] * vArr[i];
         sumDXi  += xiArr[i] - predXi;
         sumDEta += etaArr[i] - predEta;
      }
      var newCrval = tanDeproject([crval1, crval2], [sumDXi / nStars, sumDEta / nStars]);
      crval1 = newCrval[0];
      crval2 = newCrval[1];
   }

   // 残差計算
   var crval = [crval1, crval2];
   var residuals = [];
   var totalResidSq = 0;
   for (var i = 0; i < nStars; i++) {
      var u = (stars[i].px + 1.0) - crpix1;
      var v = (stars[i].py + 1.0) - crpix2;
      var predXi  = cd[0][0] * u + cd[0][1] * v;
      var predEta = cd[1][0] * u + cd[1][1] * v;
      var predCoord = tanDeproject(crval, [predXi, predEta]);
      var resid = angularSeparation([stars[i].ra, stars[i].dec], predCoord);
      var residArcsec = resid * 3600.0;
      residuals.push({ name: stars[i].name || ("Star " + (i + 1)), residual_arcsec: residArcsec });
      totalResidSq += residArcsec * residArcsec;
   }
   var rmsArcsec = Math.sqrt(totalResidSq / nStars);
   var pixelScaleArcsec = Math.sqrt(Math.abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0])) * 3600.0;

   return {
      success: true,
      crval1: crval1, crval2: crval2,
      crpix1: crpix1, crpix2: crpix2,
      cd: cd,
      pixelScale_arcsec: pixelScaleArcsec,
      rms_arcsec: rmsArcsec,
      residuals: residuals,
      message: "WCS フィット成功 (RMS: " + rmsArcsec.toFixed(2) + " arcsec, "
         + "ピクセルスケール: " + pixelScaleArcsec.toFixed(3) + " arcsec/px)"
   };
};

//============================================================================
// セントロイド計算
//============================================================================

function computeCentroid(image, cx, cy, radius) {
   if (typeof radius === "undefined") radius = 10;

   var x0 = Math.max(0, Math.round(cx) - radius);
   var y0 = Math.max(0, Math.round(cy) - radius);
   var x1 = Math.min(image.width - 1, Math.round(cx) + radius);
   var y1 = Math.min(image.height - 1, Math.round(cy) + radius);

   var ch = 0;
   var values = [];
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         values.push(image.sample(x, y, ch));
      }
   }
   if (values.length === 0) return null;

   values.sort(function (a, b) { return a - b; });
   var median = values[Math.floor(values.length / 2)];

   var sumW = 0, sumWX = 0, sumWY = 0;
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         var val = image.sample(x, y, ch) - median;
         if (val > 0) {
            sumW  += val;
            sumWX += val * x;
            sumWY += val * y;
         }
      }
   }

   if (sumW <= 0) return null;
   return { x: sumWX / sumW, y: sumWY / sumW };
}

//============================================================================
// WCS 適用関数
//============================================================================

function applyWCS(window, wcsResult) {
   var existingKw = window.keywords;
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

   window.keywords = cleanedKw;
   window.regenerateAstrometricSolution();
}

//============================================================================
// Settings 管理
//============================================================================

#define SETTINGS_KEY_PREFIX "ManualImageSolver/"

function ManualSolverSettings() {
   this.centroidRadius = 10;
   this.previewZoom = 1.0;

   this.load = function () {
      try {
         var val = Settings.read(SETTINGS_KEY_PREFIX + "centroidRadius", DataType_Int32);
         if (val !== null) this.centroidRadius = val;
      } catch (e) { }
   };

   this.save = function () {
      Settings.write(SETTINGS_KEY_PREFIX + "centroidRadius", DataType_Int32, this.centroidRadius);
   };
}

//============================================================================
// StarEditDialog: 星座標入力ダイアログ
//============================================================================

function StarEditDialog(parent, starIndex, starData) {
   this.__base__ = Dialog;
   this.__base__();

   var dialog = this;
   this.starData = starData || { px: 0, py: 0, ra: undefined, dec: undefined, name: "" };
   this.accepted = false;

   this.windowTitle = "Reference Star #" + starIndex;
   this.minWidth = 400;

   // --- ピクセル座標表示 ---
   var pixelGroup = new GroupBox(this);
   pixelGroup.title = "ピクセル座標";

   var pxLabel = new Label(pixelGroup);
   pxLabel.text = "X:";
   pxLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   pxLabel.setFixedWidth(30);

   this.pxEdit = new Edit(pixelGroup);
   this.pxEdit.text = (this.starData.px !== undefined && this.starData.px !== null) ? this.starData.px.toFixed(2) : "";
   this.pxEdit.setFixedWidth(100);
   this.pxEdit.toolTip = "画像上の X 座標（Readout バーで確認）";

   var pyLabel = new Label(pixelGroup);
   pyLabel.text = "Y:";
   pyLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   pyLabel.setFixedWidth(30);

   this.pyEdit = new Edit(pixelGroup);
   this.pyEdit.text = (this.starData.py !== undefined && this.starData.py !== null) ? this.starData.py.toFixed(2) : "";
   this.pyEdit.setFixedWidth(100);
   this.pyEdit.toolTip = "画像上の Y 座標（Readout バーで確認）";

   var pixelSizer = new HorizontalSizer;
   pixelSizer.spacing = 4;
   pixelSizer.add(pxLabel);
   pixelSizer.add(this.pxEdit);
   pixelSizer.addSpacing(8);
   pixelSizer.add(pyLabel);
   pixelSizer.add(this.pyEdit);
   pixelSizer.addStretch();

   pixelGroup.sizer = new VerticalSizer;
   pixelGroup.sizer.margin = 6;
   pixelGroup.sizer.spacing = 4;
   pixelGroup.sizer.add(pixelSizer);

   // --- 天体名検索 ---
   var nameGroup = new GroupBox(this);
   nameGroup.title = "天体座標";

   var nameLabel = new Label(nameGroup);
   nameLabel.text = "天体名:";
   nameLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   nameLabel.setFixedWidth(60);

   this.nameEdit = new Edit(nameGroup);
   this.nameEdit.text = this.starData.name || "";
   this.nameEdit.toolTip = "天体名を入力して Search をクリック（例: Sirius, Vega, M42）";

   this.searchButton = new PushButton(nameGroup);
   this.searchButton.text = "Search";
   this.searchButton.toolTip = "CDS Sesame で天体名から座標を検索";
   this.searchButton.onClick = function () {
      var name = dialog.nameEdit.text.trim();
      if (name.length === 0) {
         var mb = new MessageBox("天体名を入力してください。", TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      console.writeln("Searching for: " + name + " ...");
      var coords = searchObjectCoordinates(name);
      if (coords !== null) {
         dialog.raEdit.text = raToHMS(coords.ra);
         dialog.decEdit.text = decToDMS(coords.dec);
         dialog.starData.ra = coords.ra;
         dialog.starData.dec = coords.dec;
         dialog.starData.name = name;
         console.writeln("  Found: RA=" + raToHMS(coords.ra) + " DEC=" + decToDMS(coords.dec));
      } else {
         var mb = new MessageBox("'" + name + "' が見つかりませんでした。\nRA/DEC を直接入力してください。",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
      }
   };

   var nameSizer = new HorizontalSizer;
   nameSizer.spacing = 4;
   nameSizer.add(nameLabel);
   nameSizer.add(this.nameEdit, 100);
   nameSizer.add(this.searchButton);

   // --- RA/DEC 入力 ---
   var raLabel = new Label(nameGroup);
   raLabel.text = "RA:";
   raLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   raLabel.setFixedWidth(60);

   this.raEdit = new Edit(nameGroup);
   if (this.starData.ra !== undefined) {
      this.raEdit.text = raToHMS(this.starData.ra);
   }
   this.raEdit.toolTip = "HH MM SS.ss / HH:MM:SS.ss / 度数";

   var raUnitLabel = new Label(nameGroup);
   raUnitLabel.text = "(HH MM SS / degrees)";

   var raSizer = new HorizontalSizer;
   raSizer.spacing = 4;
   raSizer.add(raLabel);
   raSizer.add(this.raEdit, 100);
   raSizer.add(raUnitLabel);

   var decLabel = new Label(nameGroup);
   decLabel.text = "DEC:";
   decLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   decLabel.setFixedWidth(60);

   this.decEdit = new Edit(nameGroup);
   if (this.starData.dec !== undefined) {
      this.decEdit.text = decToDMS(this.starData.dec);
   }
   this.decEdit.toolTip = "+DD MM SS.s / +DD:MM:SS.s / 度数";

   var decUnitLabel = new Label(nameGroup);
   decUnitLabel.text = "(+DD MM SS / degrees)";

   var decSizer = new HorizontalSizer;
   decSizer.spacing = 4;
   decSizer.add(decLabel);
   decSizer.add(this.decEdit, 100);
   decSizer.add(decUnitLabel);

   nameGroup.sizer = new VerticalSizer;
   nameGroup.sizer.margin = 6;
   nameGroup.sizer.spacing = 4;
   nameGroup.sizer.add(nameSizer);
   nameGroup.sizer.add(raSizer);
   nameGroup.sizer.add(decSizer);

   // --- ボタン ---
   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.icon = this.scaledResource(":/icons/ok.png");
   this.okButton.onClick = function () {
      // ピクセル座標の検証
      var px = parseFloat(dialog.pxEdit.text);
      var py = parseFloat(dialog.pyEdit.text);
      if (isNaN(px) || isNaN(py)) {
         var mb = new MessageBox("ピクセル座標 X, Y を入力してください。\n\n" +
            "画像ウィンドウ上で星にマウスを合わせると、\n" +
            "Readout バーに座標が表示されます。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }

      var ra = parseRAInput(dialog.raEdit.text);
      var dec = parseDECInput(dialog.decEdit.text);
      if (ra === undefined || dec === undefined) {
         var mb = new MessageBox("RA と DEC を正しく入力してください。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      if (ra < 0 || ra >= 360) {
         var mb = new MessageBox("RA は 0〜360 度の範囲で入力してください。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      if (dec < -90 || dec > 90) {
         var mb = new MessageBox("DEC は -90〜+90 度の範囲で入力してください。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      dialog.starData.px = px;
      dialog.starData.py = py;
      dialog.starData.ra = ra;
      dialog.starData.dec = dec;
      dialog.starData.name = dialog.nameEdit.text.trim();
      dialog.accepted = true;
      dialog.ok();
   };

   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Cancel";
   this.cancelButton.icon = this.scaledResource(":/icons/cancel.png");
   this.cancelButton.onClick = function () {
      dialog.cancel();
   };

   var buttonSizer = new HorizontalSizer;
   buttonSizer.addStretch();
   buttonSizer.spacing = 8;
   buttonSizer.add(this.okButton);
   buttonSizer.add(this.cancelButton);

   // --- レイアウト ---
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 8;
   this.sizer.add(pixelGroup);
   this.sizer.add(nameGroup);
   this.sizer.addSpacing(4);
   this.sizer.add(buttonSizer);

   this.adjustToContents();
}

StarEditDialog.prototype = new Dialog;

//============================================================================
// ManualSolverDialog: メインダイアログ
//============================================================================

function ManualSolverDialog() {
   this.__base__ = Dialog;
   this.__base__();

   var dialog = this;
   this.windowTitle = TITLE + " v" + VERSION;
   this.minWidth = 600;

   // 星ペアリスト
   this.starPairs = [];  // [{px, py, ra, dec, name}]
   this.wcsResult = null;
   this.settings = new ManualSolverSettings();
   this.settings.load();

   // --- 画像選択 ---
   var imageLabel = new Label(this);
   imageLabel.text = "Image:";
   imageLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;
   imageLabel.setFixedWidth(50);

   this.imageCombo = new ComboBox(this);
   this.imageCombo.toolTip = "プレートソルブする画像を選択";
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      this.imageCombo.addItem(windows[i].mainView.id);
   }
   if (ImageWindow.activeWindow && !ImageWindow.activeWindow.isNull) {
      var activeId = ImageWindow.activeWindow.mainView.id;
      for (var i = 0; i < windows.length; i++) {
         if (windows[i].mainView.id === activeId) {
            this.imageCombo.currentItem = i;
            break;
         }
      }
   }

   this.imageSizeLabel = new Label(this);
   this.imageSizeLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   var imageSizer = new HorizontalSizer;
   imageSizer.spacing = 4;
   imageSizer.add(imageLabel);
   imageSizer.add(this.imageCombo, 100);
   imageSizer.add(this.imageSizeLabel);

   // --- 操作説明 ---
   var helpGroup = new GroupBox(this);
   helpGroup.title = "操作手順";

   var helpLabel = new Label(helpGroup);
   helpLabel.text =
      "1. 画像ウィンドウ上で Readout カーソルを有効にする\n" +
      "2. 星にマウスを合わせて Readout バーの X, Y 座標を読み取る\n" +
      "3. [Add Star] をクリックし、X/Y と天体名（または RA/DEC）を入力\n" +
      "4. 4 星以上登録したら [Solve] → [Apply] で WCS を適用";
   helpLabel.textAlignment = TextAlign_Left;

   helpGroup.sizer = new VerticalSizer;
   helpGroup.sizer.margin = 6;
   helpGroup.sizer.add(helpLabel);

   // --- 星テーブル ---
   var tableGroup = new GroupBox(this);
   tableGroup.title = "Reference Stars (最低 4 星)";

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
   this.starTreeBox.setColumnWidth(1, 80);
   this.starTreeBox.setColumnWidth(2, 80);
   this.starTreeBox.setColumnWidth(3, 100);
   this.starTreeBox.setColumnWidth(4, 200);
   this.starTreeBox.setColumnWidth(5, 100);
   this.starTreeBox.setMinHeight(180);

   // テーブル操作ボタン
   this.addButton = new PushButton(this);
   this.addButton.text = "Add Star...";
   this.addButton.icon = this.scaledResource(":/icons/add.png");
   this.addButton.toolTip = "新しい星を追加（ピクセル座標 + 天球座標を入力）";
   this.addButton.onClick = function () {
      dialog.doAddStar();
   };

   this.editButton = new PushButton(this);
   this.editButton.text = "Edit...";
   this.editButton.toolTip = "選択した星の座標を編集";
   this.editButton.onClick = function () {
      var node = dialog.starTreeBox.currentNode;
      if (!node) return;
      var idx = dialog.starTreeBox.childIndex(node);
      if (idx < 0 || idx >= dialog.starPairs.length) return;

      var starData = {
         px: dialog.starPairs[idx].px,
         py: dialog.starPairs[idx].py,
         ra: dialog.starPairs[idx].ra,
         dec: dialog.starPairs[idx].dec,
         name: dialog.starPairs[idx].name
      };
      var editDlg = new StarEditDialog(dialog, idx + 1, starData);
      if (editDlg.execute()) {
         if (editDlg.accepted) {
            dialog.starPairs[idx] = editDlg.starData;
            dialog.wcsResult = null;
            dialog.refreshStarTable();
         }
      }
   };

   this.removeButton = new PushButton(this);
   this.removeButton.text = "Remove";
   this.removeButton.toolTip = "選択した星を削除";
   this.removeButton.onClick = function () {
      var node = dialog.starTreeBox.currentNode;
      if (!node) return;
      var idx = dialog.starTreeBox.childIndex(node);
      if (idx >= 0 && idx < dialog.starPairs.length) {
         dialog.starPairs.splice(idx, 1);
         dialog.wcsResult = null;
         dialog.refreshStarTable();
         dialog.updateButtons();
      }
   };

   this.clearButton = new PushButton(this);
   this.clearButton.text = "Clear All";
   this.clearButton.toolTip = "全ての星を削除";
   this.clearButton.onClick = function () {
      if (dialog.starPairs.length === 0) return;
      var mb = new MessageBox("全ての星を削除しますか？", TITLE,
         StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         dialog.starPairs = [];
         dialog.wcsResult = null;
         dialog.refreshStarTable();
         dialog.updateButtons();
      }
   };

   var tableButtonSizer = new HorizontalSizer;
   tableButtonSizer.spacing = 4;
   tableButtonSizer.add(this.addButton);
   tableButtonSizer.addSpacing(8);
   tableButtonSizer.add(this.editButton);
   tableButtonSizer.add(this.removeButton);
   tableButtonSizer.add(this.clearButton);
   tableButtonSizer.addStretch();

   tableGroup.sizer = new VerticalSizer;
   tableGroup.sizer.margin = 6;
   tableGroup.sizer.spacing = 4;
   tableGroup.sizer.add(this.starTreeBox, 100);
   tableGroup.sizer.add(tableButtonSizer);

   // --- 結果表示 ---
   this.resultLabel = new Label(this);
   this.resultLabel.text = "";
   this.resultLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   // --- メインボタン ---
   this.solveButton = new PushButton(this);
   this.solveButton.text = "Solve";
   this.solveButton.icon = this.scaledResource(":/icons/execute.png");
   this.solveButton.toolTip = "WCS をフィッティング";
   this.solveButton.enabled = false;
   this.solveButton.onClick = function () {
      dialog.doSolve();
   };

   this.applyButton = new PushButton(this);
   this.applyButton.text = "Apply";
   this.applyButton.icon = this.scaledResource(":/icons/ok.png");
   this.applyButton.toolTip = "WCS を画像に適用";
   this.applyButton.enabled = false;
   this.applyButton.onClick = function () {
      dialog.doApply();
   };

   this.closeButton = new PushButton(this);
   this.closeButton.text = "Close";
   this.closeButton.icon = this.scaledResource(":/icons/cancel.png");
   this.closeButton.onClick = function () {
      dialog.cancel();
   };

   var mainButtonSizer = new HorizontalSizer;
   mainButtonSizer.addStretch();
   mainButtonSizer.spacing = 8;
   mainButtonSizer.add(this.solveButton);
   mainButtonSizer.add(this.applyButton);
   mainButtonSizer.add(this.closeButton);

   // --- レイアウト ---
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(imageSizer);
   this.sizer.add(helpGroup);
   this.sizer.add(tableGroup, 100);
   this.sizer.add(this.resultLabel);
   this.sizer.add(mainButtonSizer);

   // --- 画像変更時のコールバック ---
   this.imageCombo.onItemSelected = function (index) {
      dialog.updateImageInfo();
      dialog.starPairs = [];
      dialog.wcsResult = null;
      dialog.refreshStarTable();
      dialog.updateButtons();
   };

   // 初期画像情報表示
   this.updateImageInfo();
}

ManualSolverDialog.prototype = new Dialog;

//----------------------------------------------------------------------------
// 選択中の ImageWindow を取得
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.getSelectedWindow = function () {
   var windows = ImageWindow.windows;
   var idx = this.imageCombo.currentItem;
   if (idx >= 0 && idx < windows.length) {
      return windows[idx];
   }
   return null;
};

//----------------------------------------------------------------------------
// 画像情報の更新
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.updateImageInfo = function () {
   var window = this.getSelectedWindow();
   if (!window || window.isNull) {
      this.imageSizeLabel.text = "";
      return;
   }
   var image = window.mainView.image;
   this.imageSizeLabel.text = "(" + image.width + " x " + image.height + " px)";
};

//----------------------------------------------------------------------------
// 星追加処理
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.doAddStar = function () {
   var window = this.getSelectedWindow();
   if (!window || window.isNull) {
      var mb = new MessageBox("画像が選択されていません。", TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   var starData = { px: undefined, py: undefined, ra: undefined, dec: undefined, name: "" };
   var editDlg = new StarEditDialog(this, this.starPairs.length + 1, starData);
   if (editDlg.execute()) {
      if (editDlg.accepted) {
         // セントロイドスナップ
         var image = window.mainView.image;
         var px = editDlg.starData.px;
         var py = editDlg.starData.py;
         if (px >= 0 && px < image.width && py >= 0 && py < image.height) {
            var centroid = computeCentroid(image, px, py, this.settings.centroidRadius);
            if (centroid) {
               console.writeln(format("Centroid snap: (%.2f, %.2f) -> (%.2f, %.2f)", px, py, centroid.x, centroid.y));
               editDlg.starData.px = centroid.x;
               editDlg.starData.py = centroid.y;
            }
         }
         this.starPairs.push(editDlg.starData);
         this.wcsResult = null;
         this.refreshStarTable();
         this.updateButtons();
      }
   }
};

//----------------------------------------------------------------------------
// 星テーブルの更新
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.refreshStarTable = function () {
   this.starTreeBox.clear();
   for (var i = 0; i < this.starPairs.length; i++) {
      var star = this.starPairs[i];
      var node = new TreeBoxNode(this.starTreeBox);
      node.setText(0, "" + (i + 1));
      node.setText(1, star.px.toFixed(2));
      node.setText(2, star.py.toFixed(2));
      node.setText(3, star.name || "--");
      if (star.ra !== undefined && star.dec !== undefined) {
         node.setText(4, raToHMS(star.ra) + " / " + decToDMS(star.dec));
      } else {
         node.setText(4, "--");
      }

      // 残差
      if (this.wcsResult && this.wcsResult.success && this.wcsResult.residuals && i < this.wcsResult.residuals.length) {
         node.setText(5, this.wcsResult.residuals[i].residual_arcsec.toFixed(2) + "\"");
      } else {
         node.setText(5, "--");
      }
   }
};

//----------------------------------------------------------------------------
// ボタン状態の更新
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.updateButtons = function () {
   this.solveButton.enabled = this.starPairs.length >= 4;
   this.applyButton.enabled = (this.wcsResult !== null && this.wcsResult.success);
};

//----------------------------------------------------------------------------
// WCS ソルブ実行
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.doSolve = function () {
   var window = this.getSelectedWindow();
   if (!window || window.isNull) {
      var mb = new MessageBox("画像が選択されていません。", TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   var image = window.mainView.image;
   var fitter = new WCSFitter(this.starPairs, image.width, image.height);
   this.wcsResult = fitter.solve();

   if (this.wcsResult.success) {
      console.writeln("");
      console.writeln("<b>WCS Solve 成功:</b>");
      console.writeln("  CRVAL1 = " + this.wcsResult.crval1.toFixed(6) + " (" + raToHMS(this.wcsResult.crval1) + ")");
      console.writeln("  CRVAL2 = " + this.wcsResult.crval2.toFixed(6) + " (" + decToDMS(this.wcsResult.crval2) + ")");
      console.writeln("  CRPIX1 = " + this.wcsResult.crpix1.toFixed(1));
      console.writeln("  CRPIX2 = " + this.wcsResult.crpix2.toFixed(1));
      console.writeln(format("  CD1_1 = %.6e, CD1_2 = %.6e", this.wcsResult.cd[0][0], this.wcsResult.cd[0][1]));
      console.writeln(format("  CD2_1 = %.6e, CD2_2 = %.6e", this.wcsResult.cd[1][0], this.wcsResult.cd[1][1]));
      console.writeln(format("  Pixel scale: %.3f arcsec/px", this.wcsResult.pixelScale_arcsec));
      console.writeln(format("  RMS residual: %.3f arcsec", this.wcsResult.rms_arcsec));
      console.writeln("");
      for (var i = 0; i < this.wcsResult.residuals.length; i++) {
         var r = this.wcsResult.residuals[i];
         console.writeln(format("  Star %d (%s): %.3f arcsec", i + 1, r.name, r.residual_arcsec));
      }

      this.resultLabel.text = this.wcsResult.message;
   } else {
      console.warningln("WCS Solve 失敗: " + this.wcsResult.message);
      this.resultLabel.text = "Solve 失敗: " + this.wcsResult.message;
   }

   this.refreshStarTable();
   this.updateButtons();
};

//----------------------------------------------------------------------------
// WCS 適用
//----------------------------------------------------------------------------
ManualSolverDialog.prototype.doApply = function () {
   if (!this.wcsResult || !this.wcsResult.success) {
      var mb = new MessageBox("先に Solve を実行してください。", TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   var window = this.getSelectedWindow();
   if (!window || window.isNull) {
      var mb = new MessageBox("画像が選択されていません。", TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   // 確認ダイアログ
   var mb = new MessageBox(
      format("WCS を適用しますか？\n\n" +
         "  CRVAL: (%s, %s)\n" +
         "  Pixel scale: %.3f arcsec/px\n" +
         "  RMS: %.3f arcsec",
         raToHMS(this.wcsResult.crval1), decToDMS(this.wcsResult.crval2),
         this.wcsResult.pixelScale_arcsec, this.wcsResult.rms_arcsec),
      TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
   if (mb.execute() !== StdButton_Yes) return;

   console.writeln("<b>WCS を画像に適用中...</b>");
   applyWCS(window, this.wcsResult);
   console.writeln("WCS を適用しました。");

   var mb2 = new MessageBox("WCS を正常に適用しました。", TITLE, StdIcon_Information, StdButton_Ok);
   mb2.execute();
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

   console.show();
   console.writeln("<b>" + TITLE + " v" + VERSION + "</b>");
   console.writeln("---");

   var dlg = new ManualSolverDialog();
   dlg.execute();
}

main();
