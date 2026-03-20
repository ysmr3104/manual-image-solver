//============================================================================
// test_wcs_math.js - wcs_math.js の Node.js 単体テスト
//
// 実行方法: node tests/javascript/test_wcs_math.js
//============================================================================

var wcs = require("../../javascript/wcs_math.js");

var tanProject = wcs.tanProject;
var tanDeproject = wcs.tanDeproject;
var angularSeparation = wcs.angularSeparation;
var solveLinearSystem = wcs.solveLinearSystem;
var solveMinNorm = wcs.solveMinNorm;
var WCSFitter = wcs.WCSFitter;
var skyToPixel = wcs.skyToPixel;

var passed = 0;
var failed = 0;
var testName = "";

function assertEqual(actual, expected, msg, tolerance) {
   if (typeof tolerance === "undefined") tolerance = 0;
   var ok;
   if (tolerance > 0) {
      ok = Math.abs(actual - expected) <= tolerance;
   } else {
      ok = actual === expected;
   }
   if (!ok) {
      console.log("  FAIL: " + msg);
      console.log("    期待値: " + expected + ", 実際: " + actual);
      if (tolerance > 0) console.log("    許容誤差: " + tolerance);
      failed++;
   } else {
      passed++;
   }
}

function assertTrue(val, msg) {
   if (!val) {
      console.log("  FAIL: " + msg);
      failed++;
   } else {
      passed++;
   }
}

function assertFalse(val, msg) {
   if (val) {
      console.log("  FAIL: " + msg);
      failed++;
   } else {
      passed++;
   }
}

function test(name, fn) {
   testName = name;
   console.log("[TEST] " + name);
   try {
      fn();
   } catch (e) {
      console.log("  ERROR: " + e.message);
      console.log("  " + e.stack);
      failed++;
   }
}

//============================================================================
// TAN投影の往復精度テスト
//============================================================================

test("TAN投影: 投影中心での往復", function () {
   var crval = [180.0, 45.0];
   var proj = tanProject(crval, [180.0, 45.0]);
   assertEqual(proj[0], 0.0, "xi = 0", 1e-12);
   assertEqual(proj[1], 0.0, "eta = 0", 1e-12);

   var deproj = tanDeproject(crval, [0.0, 0.0]);
   assertEqual(deproj[0], 180.0, "RA = 180", 1e-10);
   assertEqual(deproj[1], 45.0, "DEC = 45", 1e-10);
});

test("TAN投影: 近傍点の往復精度 (< 1e-10 度)", function () {
   var crval = [83.633, 22.014];  // オリオン座近傍
   var testCoords = [
      [83.822, -5.391],    // ベテルギウスの方向
      [84.053, 21.142],    // 近傍
      [82.500, 23.000],    // 近傍
      [85.000, 20.500],    // 近傍
   ];

   for (var i = 0; i < testCoords.length; i++) {
      var coord = testCoords[i];
      var proj = tanProject(crval, coord);
      assertTrue(proj !== null, "投影成功: [" + coord + "]");
      var deproj = tanDeproject(crval, proj);
      assertEqual(deproj[0], coord[0], "RA 往復 [" + coord + "]", 1e-10);
      assertEqual(deproj[1], coord[1], "DEC 往復 [" + coord + "]", 1e-10);
   }
});

test("TAN投影: RA=0 付近のラップアラウンド", function () {
   var crval = [1.0, 30.0];
   var coord = [359.0, 30.0];
   var proj = tanProject(crval, coord);
   assertTrue(proj !== null, "投影成功");
   var deproj = tanDeproject(crval, proj);
   assertEqual(deproj[0], coord[0], "RA 往復", 1e-10);
   assertEqual(deproj[1], coord[1], "DEC 往復", 1e-10);
});

test("TAN投影: 天の南極付近", function () {
   var crval = [0.0, -89.0];
   var coord = [45.0, -88.5];
   var proj = tanProject(crval, coord);
   assertTrue(proj !== null, "投影成功");
   var deproj = tanDeproject(crval, proj);
   assertEqual(deproj[0], coord[0], "RA 往復", 1e-8);
   assertEqual(deproj[1], coord[1], "DEC 往復", 1e-8);
});

test("TAN投影: 反対半球で null を返す", function () {
   var crval = [0.0, 90.0];  // 天の北極
   var coord = [0.0, -10.0]; // 反対半球
   var proj = tanProject(crval, coord);
   assertTrue(proj === null, "反対半球で null");
});

//============================================================================
// 角距離テスト
//============================================================================

test("角距離: 同一点で 0", function () {
   var sep = angularSeparation([83.822, -5.391], [83.822, -5.391]);
   assertEqual(sep, 0.0, "同一点 = 0", 1e-12);
});

test("角距離: ベテルギウス ↔ リゲル", function () {
   // ベテルギウス: RA 88.793, DEC +7.407
   // リゲル: RA 78.634, DEC -8.202
   var betelgeuse = [88.793, 7.407];
   var rigel = [78.634, -8.202];
   var sep = angularSeparation(betelgeuse, rigel);
   // 文献値: 約 18.5 度
   assertEqual(sep, 18.5, "ベテルギウス↔リゲル ≈ 18.5°", 0.5);
});

test("角距離: 天の極間 = 180°", function () {
   var sep = angularSeparation([0.0, 90.0], [0.0, -90.0]);
   assertEqual(sep, 180.0, "北極↔南極 = 180°", 1e-10);
});

test("角距離: 赤道上90°離れた点", function () {
   var sep = angularSeparation([0.0, 0.0], [90.0, 0.0]);
   assertEqual(sep, 90.0, "赤道上 90° 離れ", 1e-10);
});

//============================================================================
// WCSFitter テスト
//============================================================================

test("WCSFitter: 3星未満でエラー", function () {
   var fitter = new WCSFitter([
      { px: 100, py: 100, ra: 10.0, dec: 20.0 },
      { px: 200, py: 200, ra: 10.1, dec: 20.1 },
   ], 1000, 1000);
   var result = fitter.solve();
   assertFalse(result.success, "2星では失敗");
   assertTrue(result.message.indexOf("3") >= 0, "エラーメッセージに '3' を含む");
});

test("WCSFitter: 不正な RA でエラー", function () {
   var fitter = new WCSFitter([
      { px: 100, py: 100, ra: 400.0, dec: 20.0 },
      { px: 200, py: 200, ra: 10.0, dec: 20.0 },
      { px: 300, py: 300, ra: 10.0, dec: 20.0 },
      { px: 400, py: 400, ra: 10.0, dec: 20.0 },
   ], 1000, 1000);
   var result = fitter.solve();
   assertFalse(result.success, "不正 RA で失敗");
});

test("WCSFitter: 不正な DEC でエラー", function () {
   var fitter = new WCSFitter([
      { px: 100, py: 100, ra: 10.0, dec: 95.0 },
      { px: 200, py: 200, ra: 10.0, dec: 20.0 },
      { px: 300, py: 300, ra: 10.0, dec: 20.0 },
      { px: 400, py: 400, ra: 10.0, dec: 20.0 },
   ], 1000, 1000);
   var result = fitter.solve();
   assertFalse(result.success, "不正 DEC で失敗");
});

test("WCSFitter: 既知WCSからの合成3星（最小構成）で残差 < 1 arcsec", function () {
   var knownCrval = [180.0, 45.0];
   var knownCd = [
      [-4.166667e-4, 0.0],
      [0.0, 4.166667e-4]
   ];
   var imgW = 6000, imgH = 4000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   // 3星: 左上、右上、中央下（三角形配置で十分な分離）
   var testPixels = [
      { px: 500, py: 500 },
      { px: 5500, py: 500 },
      { px: 3000, py: 3500 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "TestStar" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "3星でフィット成功");
   assertTrue(result.rms_arcsec < 1.0, "RMS < 1 arcsec (実際: " + result.rms_arcsec + ")");
});

test("WCSFitter: 既知WCSからの合成4星（最小構成）で残差 < 1 arcsec", function () {
   // 既知の WCS パラメータ（典型的な星野写真）
   // CRVAL = (180.0, 45.0), ピクセルスケール ≈ 1.5 arcsec/px
   var knownCrval = [180.0, 45.0];
   var knownCd = [
      [-4.166667e-4, 0.0],   // -1.5 arcsec/px in RA
      [0.0, 4.166667e-4]     // +1.5 arcsec/px in DEC
   ];
   var imgW = 6000, imgH = 4000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   // 4隅付近にテスト星を配置
   var testPixels = [
      { px: 500, py: 500 },
      { px: 5500, py: 500 },
      { px: 500, py: 3500 },
      { px: 5500, py: 3500 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "TestStar" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.rms_arcsec < 1.0, "RMS < 1 arcsec (実際: " + result.rms_arcsec + ")");
   assertEqual(result.crpix1, crpix1, "CRPIX1 一致", 0.01);
   assertEqual(result.crpix2, crpix2, "CRPIX2 一致", 0.01);
});

test("WCSFitter: 既知WCSからの合成6星で残差 < 0.01 arcsec", function () {
   var knownCrval = [83.633, 22.014];
   var knownCd = [
      [-3.5e-4, 1.0e-5],
      [1.0e-5, 3.5e-4]
   ];
   var imgW = 6024, imgH = 4024;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   var testPixels = [
      { px: 300, py: 300 },
      { px: 3000, py: 300 },
      { px: 5700, py: 300 },
      { px: 300, py: 3700 },
      { px: 3000, py: 3700 },
      { px: 5700, py: 3700 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "TestStar" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.rms_arcsec < 0.01,
      "RMS < 0.01 arcsec (実際: " + result.rms_arcsec + ")");
});

test("WCSFitter: 合成10星で高精度フィット", function () {
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   var imgW = 4000, imgH = 4000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   var testPixels = [
      { px: 200, py: 200 },
      { px: 2000, py: 200 },
      { px: 3800, py: 200 },
      { px: 200, py: 2000 },
      { px: 2000, py: 2000 },
      { px: 3800, py: 2000 },
      { px: 200, py: 3800 },
      { px: 2000, py: 3800 },
      { px: 3800, py: 3800 },
      { px: 1000, py: 1000 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.rms_arcsec < 0.01,
      "RMS < 0.01 arcsec (実際: " + result.rms_arcsec + ")");

   // CD 行列の各要素を検証
   assertEqual(result.cd[0][0], knownCd[0][0], "CD1_1", 1e-8);
   assertEqual(result.cd[0][1], knownCd[0][1], "CD1_2", 1e-8);
   assertEqual(result.cd[1][0], knownCd[1][0], "CD2_1", 1e-8);
   assertEqual(result.cd[1][1], knownCd[1][1], "CD2_2", 1e-8);
});

test("WCSFitter: CRVAL 初期値が 5度ずれても収束", function () {
   // 正しい WCS
   var knownCrval = [120.0, 10.0];
   var knownCd = [
      [-5.0e-4, 0.0],
      [0.0, 5.0e-4]
   ];
   var imgW = 4000, imgH = 3000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   var testPixels = [
      { px: 200, py: 200 },
      { px: 3800, py: 200 },
      { px: 200, py: 2800 },
      { px: 3800, py: 2800 },
      { px: 2000, py: 1500 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.rms_arcsec < 0.1,
      "RMS < 0.1 arcsec (実際: " + result.rms_arcsec + ")");
   // CRVAL が元の値に近いことを確認
   assertEqual(result.crval1, knownCrval[0], "CRVAL1 収束", 0.01);
   assertEqual(result.crval2, knownCrval[1], "CRVAL2 収束", 0.01);
});

test("WCSFitter: 回転した CD 行列のフィット", function () {
   // 30度回転した WCS
   var angle = 30.0 * Math.PI / 180.0;
   var scale = 3.0e-4; // 度/px
   var knownCrval = [45.0, 60.0];
   var knownCd = [
      [-scale * Math.cos(angle), scale * Math.sin(angle)],
      [-scale * Math.sin(angle), -scale * Math.cos(angle)]
   ];
   var imgW = 5000, imgH = 3000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   var testPixels = [
      { px: 500, py: 500 },
      { px: 4500, py: 500 },
      { px: 500, py: 2500 },
      { px: 4500, py: 2500 },
      { px: 2500, py: 1500 },
      { px: 1500, py: 1000 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.rms_arcsec < 0.01,
      "RMS < 0.01 arcsec (実際: " + result.rms_arcsec + ")");
   assertEqual(result.cd[0][0], knownCd[0][0], "CD1_1", 1e-7);
   assertEqual(result.cd[0][1], knownCd[0][1], "CD1_2", 1e-7);
   assertEqual(result.cd[1][0], knownCd[1][0], "CD2_1", 1e-7);
   assertEqual(result.cd[1][1], knownCd[1][1], "CD2_2", 1e-7);
});

test("WCSFitter: ピクセルスケールの検証", function () {
   var scale = 2.0e-4; // 0.72 arcsec/px
   var knownCrval = [0.0, 0.0];
   var knownCd = [
      [-scale, 0.0],
      [0.0, scale]
   ];
   var imgW = 2000, imgH = 2000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   var testPixels = [
      { px: 200, py: 200 },
      { px: 1800, py: 200 },
      { px: 200, py: 1800 },
      { px: 1800, py: 1800 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi  = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   // ピクセルスケール = scale * 3600 = 0.72 arcsec/px
   assertEqual(result.pixelScale_arcsec, scale * 3600.0, "ピクセルスケール", 0.01);
});

//============================================================================
// 線形代数ユーティリティテスト
//============================================================================

test("solveLinearSystem: 3×3 既知連立方程式", function () {
   // 2x + y - z = 8
   // -3x - y + 2z = -11
   // -2x + y + 2z = -3
   // 解: x=2, y=3, z=-1
   var A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
   var b = [8, -11, -3];
   var x = solveLinearSystem(A, b);
   assertTrue(x !== null, "解が存在する");
   assertEqual(x[0], 2.0, "x1 = 2", 1e-10);
   assertEqual(x[1], 3.0, "x2 = 3", 1e-10);
   assertEqual(x[2], -1.0, "x3 = -1", 1e-10);
});

test("solveLinearSystem: 特異行列で null", function () {
   var A = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
   var b = [1, 2, 3];
   var x = solveLinearSystem(A, b);
   assertTrue(x === null, "特異行列で null を返す");
});

test("solveLinearSystem: 元の行列が変更されないこと", function () {
   var A = [[2, 1], [1, 3]];
   var b = [5, 7];
   var origA00 = A[0][0];
   solveLinearSystem(A, b);
   assertEqual(A[0][0], origA00, "A[0][0] 変更なし");
});

//============================================================================
// distortionVectors / hasDistortion 削除確認テスト
//============================================================================

test("WCSFitter: 戻り値に distortionVectors / hasDistortion が存在しない", function () {
   var stars = [
      { px: 100, py: 100, ra: 180.1, dec: 45.1, name: "S1" },
      { px: 900, py: 100, ra: 179.9, dec: 45.1, name: "S2" },
      { px: 100, py: 700, ra: 180.1, dec: 44.9, name: "S3" },
      { px: 900, py: 700, ra: 179.9, dec: 44.9, name: "S4" },
      { px: 500, py: 400, ra: 180.0, dec: 45.0, name: "S5" }
   ];
   var fitter = new WCSFitter(stars, 1000, 800);
   var result = fitter.solve();
   assertTrue(result.success, "フィット成功");
   assertTrue(typeof result.distortionVectors === "undefined", "distortionVectors 削除済み");
   assertTrue(typeof result.hasDistortion === "undefined", "hasDistortion 削除済み");
});

test("WCSFitter: CRVAL 収束 — RMS < 1 arcsec", function () {
   // 広視野データ（約 1.0deg 視野）: CRVAL 収束テスト
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   var imgW = 4000, imgH = 4000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   var testPixels = [
      { px: 200, py: 200 },
      { px: 2000, py: 200 },
      { px: 3800, py: 200 },
      { px: 200, py: 2000 },
      { px: 2000, py: 2000 },
      { px: 3800, py: 2000 },
      { px: 200, py: 3800 },
      { px: 2000, py: 3800 },
      { px: 3800, py: 3800 }
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var xi = knownCd[0][0] * u + knownCd[0][1] * v;
      var eta = knownCd[1][0] * u + knownCd[1][1] * v;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();
   assertTrue(result.success, "フィット成功");
   assertTrue(result.rms_arcsec < 1.0, "RMS < 1 arcsec (実際: " + result.rms_arcsec.toFixed(4) + " arcsec)");
});

test("WCSFitter: sip/sipMode プロパティが返されない", function () {
   var stars = [
      { px: 100, py: 100, ra: 180.1, dec: 45.1, name: "S1" },
      { px: 900, py: 100, ra: 179.9, dec: 45.1, name: "S2" },
      { px: 100, py: 700, ra: 180.1, dec: 44.9, name: "S3" },
      { px: 900, py: 700, ra: 179.9, dec: 44.9, name: "S4" }
   ];
   var fitter = new WCSFitter(stars, 1000, 800);
   var result = fitter.solve();
   assertTrue(result.success, "フィット成功");
   assertTrue(typeof result.sip === "undefined", "sip プロパティが存在しない");
   assertTrue(typeof result.sipMode === "undefined", "sipMode プロパティが存在しない");
});

//============================================================================
// skyToPixel テスト
//============================================================================

test("skyToPixel: ラウンドトリップ（ピクセル→天球→ピクセル）", function () {
   // 合成WCS: 画像中心がRA=180, DEC=45, ピクセルスケール≈1"/px
   var wcsResult = {
      crval1: 180.0,
      crval2: 45.0,
      crpix1: 500.5,
      crpix2: 400.5,
      cd: [
         [2.778e-4, 0],
         [0, 2.778e-4]
      ]
   };
   var imageHeight = 800;

   // テストピクセル座標（0-based PixInsight）
   var testPixels = [
      { px: 100, py: 200 },
      { px: 499.5, py: 399.5 },  // 画像中心付近
      { px: 0, py: 0 },          // 左上
      { px: 799, py: 599 }       // 右下付近
   ];

   for (var i = 0; i < testPixels.length; i++) {
      var tp = testPixels[i];
      // ピクセル→天球座標（pixelToRaDec相当）
      var u = (tp.px + 1.0) - wcsResult.crpix1;
      var v = (imageHeight - tp.py) - wcsResult.crpix2;
      var xi  = wcsResult.cd[0][0] * u + wcsResult.cd[0][1] * v;
      var eta = wcsResult.cd[1][0] * u + wcsResult.cd[1][1] * v;
      var skyCoord = tanDeproject([wcsResult.crval1, wcsResult.crval2], [xi, eta]);

      // 天球→ピクセル座標（skyToPixel）
      var result = skyToPixel(skyCoord[0], skyCoord[1], wcsResult, imageHeight);
      assertTrue(result !== null, "skyToPixel should not return null for pixel (" + tp.px + ", " + tp.py + ")");
      assertEqual(result.px, tp.px, "px round-trip for (" + tp.px + ", " + tp.py + ")", 1e-6);
      assertEqual(result.py, tp.py, "py round-trip for (" + tp.px + ", " + tp.py + ")", 1e-6);
   }
});

test("skyToPixel: 反対半球で null を返す", function () {
   var wcsResult = {
      crval1: 0.0,
      crval2: 45.0,
      crpix1: 500.5,
      crpix2: 400.5,
      cd: [
         [2.778e-4, 0],
         [0, 2.778e-4]
      ]
   };
   // RA=180, DEC=-45 は反対半球
   var result = skyToPixel(180.0, -45.0, wcsResult, 800);
   assertTrue(result === null, "skyToPixel should return null for opposite hemisphere");
});

test("skyToPixel: 回転したCD行列でのラウンドトリップ", function () {
   // 45度回転したCD行列
   var scale = 2.778e-4;
   var cos45 = Math.cos(Math.PI / 4);
   var sin45 = Math.sin(Math.PI / 4);
   var wcsResult = {
      crval1: 90.0,
      crval2: 30.0,
      crpix1: 300.5,
      crpix2: 300.5,
      cd: [
         [scale * cos45, -scale * sin45],
         [scale * sin45, scale * cos45]
      ]
   };
   var imageHeight = 600;

   var px = 150, py = 250;
   var u = (px + 1.0) - wcsResult.crpix1;
   var v = (imageHeight - py) - wcsResult.crpix2;
   var xi  = wcsResult.cd[0][0] * u + wcsResult.cd[0][1] * v;
   var eta = wcsResult.cd[1][0] * u + wcsResult.cd[1][1] * v;
   var skyCoord = tanDeproject([wcsResult.crval1, wcsResult.crval2], [xi, eta]);

   var result = skyToPixel(skyCoord[0], skyCoord[1], wcsResult, imageHeight);
   assertTrue(result !== null, "skyToPixel should not return null");
   assertEqual(result.px, px, "px round-trip with rotated CD", 1e-6);
   assertEqual(result.py, py, "py round-trip with rotated CD", 1e-6);
});

test("skyToPixel: WCSFitterの結果でラウンドトリップ", function () {
   // WCSFitterで合成データからsolve→skyToPixelで検証
   var imageWidth = 1000;
   var imageHeight = 800;
   var stars = [
      { px: 100, py: 100, ra: 180.1, dec: 45.1, name: "S1" },
      { px: 900, py: 100, ra: 179.9, dec: 45.1, name: "S2" },
      { px: 100, py: 700, ra: 180.1, dec: 44.9, name: "S3" },
      { px: 900, py: 700, ra: 179.9, dec: 44.9, name: "S4" },
      { px: 500, py: 400, ra: 180.0, dec: 45.0, name: "S5" }
   ];

   var fitter = new WCSFitter(stars, imageWidth, imageHeight);
   var wcsResult = fitter.solve();
   assertTrue(wcsResult.success, "WCSFitter should succeed");

   for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var result = skyToPixel(s.ra, s.dec, wcsResult, imageHeight);
      assertTrue(result !== null, "skyToPixel should not return null for star " + s.name);
      // WCSフィッティングの精度内で一致（1px以内）
      assertEqual(result.px, s.px, "px for " + s.name, 1.0);
      assertEqual(result.py, s.py, "py for " + s.name, 1.0);
   }
});

//============================================================================
// 結果サマリー
//============================================================================

console.log("\n========================================");
console.log("結果: " + passed + " passed, " + failed + " failed");
console.log("========================================");

if (failed > 0) {
   process.exit(1);
}
