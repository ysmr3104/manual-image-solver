//============================================================================
// wcs_math.js - WCS 数学関数ライブラリ
//
// TAN（gnomonic）投影、CD行列フィッティング、セントロイド計算を提供。
// PJSR と Node.js の両方で動作する純粋 JavaScript。
//
// Copyright (c) 2024-2025 Split Image Solver Project
//============================================================================

// PJSR 環境では Math は標準で利用可能。Node.js でも同様。

//----------------------------------------------------------------------------
// TAN（gnomonic）投影: 天球座標 → 標準座標
//   crval: [ra0, dec0] 度
//   coord: [ra, dec] 度
//   戻り値: [xi, eta] 度
//----------------------------------------------------------------------------
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
   if (D <= 0) {
      return null; // 投影不可（反対半球）
   }

   var xi  = (cosDec * Math.sin(dRA)) / D * (180.0 / Math.PI);
   var eta = (cosDec0 * sinDec - sinDec0 * cosDec * cosDRA) / D * (180.0 / Math.PI);

   return [xi, eta];
}

//----------------------------------------------------------------------------
// TAN 逆投影: 標準座標 → 天球座標
//   crval: [ra0, dec0] 度
//   standard: [xi, eta] 度
//   戻り値: [ra, dec] 度
//----------------------------------------------------------------------------
function tanDeproject(crval, standard) {
   var ra0  = crval[0] * Math.PI / 180.0;
   var dec0 = crval[1] * Math.PI / 180.0;
   var xi   = standard[0] * Math.PI / 180.0;
   var eta  = standard[1] * Math.PI / 180.0;

   var rho = Math.sqrt(xi * xi + eta * eta);

   if (rho === 0) {
      return [crval[0], crval[1]];
   }

   var c = Math.atan(rho);
   var cosC = Math.cos(c);
   var sinC = Math.sin(c);
   var cosDec0 = Math.cos(dec0);
   var sinDec0 = Math.sin(dec0);

   var dec = Math.asin(cosC * sinDec0 + eta * sinC * cosDec0 / rho);
   var ra  = ra0 + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);

   // RA を 0-360 に正規化
   var raDeg = ra * 180.0 / Math.PI;
   while (raDeg < 0) raDeg += 360.0;
   while (raDeg >= 360.0) raDeg -= 360.0;

   return [raDeg, dec * 180.0 / Math.PI];
}

//----------------------------------------------------------------------------
// 角距離計算（Vincenty 公式）
//   coord1, coord2: [ra, dec] 度
//   戻り値: 角距離（度）
//----------------------------------------------------------------------------
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

//----------------------------------------------------------------------------
// WCSFitter: 星ペアから TAN 投影 WCS をフィッティング
//
//   starPairs: [{px, py, ra, dec, name}] の配列（4つ以上必要）
//   imageWidth, imageHeight: 画像サイズ（ピクセル）
//----------------------------------------------------------------------------
function WCSFitter(starPairs, imageWidth, imageHeight) {
   this.stars = starPairs;
   this.width = imageWidth;
   this.height = imageHeight;
   // CRPIX は画像中心（FITS 1-based）
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

   // RA/DEC の範囲チェック
   for (var i = 0; i < nStars; i++) {
      if (stars[i].ra < 0 || stars[i].ra >= 360) {
         return {
            success: false,
            message: "星 " + (i + 1) + " の RA が範囲外です: " + stars[i].ra
         };
      }
      if (stars[i].dec < -90 || stars[i].dec > 90) {
         return {
            success: false,
            message: "星 " + (i + 1) + " の DEC が範囲外です: " + stars[i].dec
         };
      }
   }

   var crpix1 = this.crpix1;
   var crpix2 = this.crpix2;

   // --- 1. CRVAL 初期値 = 星の天球座標重心 ---
   var crval1 = 0;
   var crval2 = 0;

   // RA はラップアラウンドを考慮して平均（ベクトル平均）
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

   // --- 2-4. 反復: TAN投影 → CD行列フィット → CRVAL更新 ---
   var cd = [[0, 0], [0, 0]];
   var maxIter = 5;

   for (var iter = 0; iter < maxIter; iter++) {
      var crval = [crval1, crval2];

      // TAN投影で標準座標計算
      var projOk = true;
      var xiArr = [];
      var etaArr = [];
      for (var i = 0; i < nStars; i++) {
         var proj = tanProject(crval, [stars[i].ra, stars[i].dec]);
         if (proj === null) {
            projOk = false;
            break;
         }
         xiArr.push(proj[0]);
         etaArr.push(proj[1]);
      }

      if (!projOk) {
         return {
            success: false,
            message: "TAN投影に失敗しました（星が反対半球にある可能性）"
         };
      }

      // ピクセルオフセット u, v（CRPIX 基準）
      // X: px は 0-based 左起点、FITS も左起点 → fits_x = px + 1
      // Y: py は 0-based 上起点、FITS は下起点 → fits_y = height - py
      var uArr = [];
      var vArr = [];
      for (var i = 0; i < nStars; i++) {
         uArr.push((stars[i].px + 1.0) - crpix1);
         vArr.push((this.height - stars[i].py) - crpix2);
      }

      // 正規方程式の各項を計算
      var sumUU = 0, sumUV = 0, sumVV = 0;
      var sumUXi = 0, sumVXi = 0;
      var sumUEta = 0, sumVEta = 0;
      for (var i = 0; i < nStars; i++) {
         sumUU += uArr[i] * uArr[i];
         sumUV += uArr[i] * vArr[i];
         sumVV += vArr[i] * vArr[i];
         sumUXi  += uArr[i] * xiArr[i];
         sumVXi  += vArr[i] * xiArr[i];
         sumUEta += uArr[i] * etaArr[i];
         sumVEta += vArr[i] * etaArr[i];
      }

      // クレーメルの公式で CD 行列を解く
      var det = sumUU * sumVV - sumUV * sumUV;
      if (Math.abs(det) < 1e-30) {
         return {
            success: false,
            message: "正規方程式の行列式がゼロです（星が一直線上にある可能性）"
         };
      }

      cd[0][0] = (sumUXi * sumVV - sumVXi * sumUV) / det;   // CD1_1
      cd[0][1] = (sumUU * sumVXi - sumUV * sumUXi) / det;   // CD1_2
      cd[1][0] = (sumUEta * sumVV - sumVEta * sumUV) / det;  // CD2_1
      cd[1][1] = (sumUU * sumVEta - sumUV * sumUEta) / det;  // CD2_2

      // CRVAL 更新: CRPIX(画像中心) → 天球座標を逆変換
      // CRPIX でのオフセットは (0, 0) なので標準座標も (0, 0)
      // → CRVAL は変わらない。ただし CRPIX がピクセル座標の中心からずれている場合は更新。
      // ここでは CRPIX を固定して CRVAL を微調整する方式:
      // 全星の残差の重心で CRVAL を補正
      var sumDXi = 0, sumDEta = 0;
      for (var i = 0; i < nStars; i++) {
         var predXi  = cd[0][0] * uArr[i] + cd[0][1] * vArr[i];
         var predEta = cd[1][0] * uArr[i] + cd[1][1] * vArr[i];
         sumDXi  += xiArr[i] - predXi;
         sumDEta += etaArr[i] - predEta;
      }
      var meanDXi  = sumDXi / nStars;
      var meanDEta = sumDEta / nStars;

      // 残差重心を天球座標に逆変換して CRVAL を更新
      var newCrval = tanDeproject([crval1, crval2], [meanDXi, meanDEta]);
      crval1 = newCrval[0];
      crval2 = newCrval[1];
   }

   // --- 5. 残差計算 ---
   var crval = [crval1, crval2];
   var residuals = [];
   var totalResidSq = 0;

   for (var i = 0; i < nStars; i++) {
      var u = (stars[i].px + 1.0) - crpix1;
      var v = (this.height - stars[i].py) - crpix2;

      // CD 行列で予測した標準座標
      var predXi  = cd[0][0] * u + cd[0][1] * v;
      var predEta = cd[1][0] * u + cd[1][1] * v;

      // 予測標準座標 → 天球座標に逆変換
      var predCoord = tanDeproject(crval, [predXi, predEta]);

      // 入力座標との角距離
      var resid = angularSeparation([stars[i].ra, stars[i].dec], predCoord);
      var residArcsec = resid * 3600.0;
      residuals.push({
         name: stars[i].name || ("Star " + (i + 1)),
         residual_arcsec: residArcsec
      });
      totalResidSq += residArcsec * residArcsec;
   }

   var rmsArcsec = Math.sqrt(totalResidSq / nStars);

   // ピクセルスケール計算（CD行列の特異値から）
   var pixelScaleArcsec = Math.sqrt(Math.abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0])) * 3600.0;

   return {
      success: true,
      crval1: crval1,
      crval2: crval2,
      crpix1: crpix1,
      crpix2: crpix2,
      cd: cd,
      pixelScale_arcsec: pixelScaleArcsec,
      rms_arcsec: rmsArcsec,
      residuals: residuals,
      message: "WCS フィット成功 (RMS: " + rmsArcsec.toFixed(2) + " arcsec, "
         + "ピクセルスケール: " + pixelScaleArcsec.toFixed(3) + " arcsec/px)"
   };
};

//----------------------------------------------------------------------------
// セントロイド計算（輝度重心法）
//
// PJSR 環境では Image.sample(x, y, channel) を使用。
// この関数は PJSR 専用。
//
//   image: PixInsight Image オブジェクト
//   cx, cy: クリック位置（0-based ピクセル座標）
//   radius: 検索半径（ピクセル、デフォルト 10）
//   戻り値: {x, y} サブピクセル精度の星中心、または失敗時 null
//----------------------------------------------------------------------------
function computeCentroid(image, cx, cy, radius) {
   if (typeof radius === "undefined") radius = 10;

   var x0 = Math.max(0, Math.round(cx) - radius);
   var y0 = Math.max(0, Math.round(cy) - radius);
   var x1 = Math.min(image.width - 1, Math.round(cx) + radius);
   var y1 = Math.min(image.height - 1, Math.round(cy) + radius);

   // チャンネル 0 を使用（モノクロまたは R チャンネル）
   var ch = 0;

   // 窓内のピクセル値を収集してバックグラウンド推定（中央値）
   var values = [];
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         values.push(image.sample(x, y, ch));
      }
   }

   if (values.length === 0) return null;

   // 中央値をバックグラウンドとして使用
   values.sort(function (a, b) { return a - b; });
   var median = values[Math.floor(values.length / 2)];

   // 輝度重心計算（バックグラウンド差し引き）
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

   return {
      x: sumWX / sumW,
      y: sumWY / sumW
   };
}

// Node.js 環境での export（PJSR では無視される）
if (typeof module !== "undefined") {
   module.exports = {
      tanProject: tanProject,
      tanDeproject: tanDeproject,
      angularSeparation: angularSeparation,
      WCSFitter: WCSFitter,
      computeCentroid: computeCentroid
   };
}
