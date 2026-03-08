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
var evalSipPolynomial = wcs.evalSipPolynomial;
var determineSipOrder = wcs.determineSipOrder;
var fitPolynomial2D = wcs.fitPolynomial2D;
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
// SIP ユーティリティ関数テスト
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

test("evalSipPolynomial: 既知係数での計算", function () {
   // f(u,v) = 1e-6 * u^2 + 2e-6 * u*v + 3e-6 * v^2
   var coeffs = [[2, 0, 1e-6], [1, 1, 2e-6], [0, 2, 3e-6]];
   var result = evalSipPolynomial(coeffs, 100, 200);
   // = 1e-6 * 10000 + 2e-6 * 20000 + 3e-6 * 40000
   // = 0.01 + 0.04 + 0.12 = 0.17
   assertEqual(result, 0.17, "計算結果", 1e-10);
});

test("evalSipPolynomial: 空の係数で 0", function () {
   assertEqual(evalSipPolynomial([], 100, 200), 0, "空 = 0");
});

test("determineSipOrder: 星数と SIP 次数の対応", function () {
   assertEqual(determineSipOrder(3), 0, "3星 → 0");
   assertEqual(determineSipOrder(5), 0, "5星 → 0");
   assertEqual(determineSipOrder(6), 2, "6星 → 2");
   assertEqual(determineSipOrder(9), 2, "9星 → 2");
   assertEqual(determineSipOrder(10), 3, "10星 → 3");
   assertEqual(determineSipOrder(20), 3, "20星 → 3");
});

//============================================================================
// SIP 統合フィッティングテスト
//============================================================================

test("WCSFitter: SIP 歪みを持つ合成10星で SIP フィッティング", function () {
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   // 既知の SIP 係数（order 3）
   var knownA = [[2, 0, 1e-7], [1, 1, 5e-8], [0, 2, 2e-7],
                 [3, 0, 1e-11], [2, 1, 5e-12], [1, 2, 3e-12], [0, 3, 1e-11]];
   var knownB = [[2, 0, 2e-7], [1, 1, -3e-8], [0, 2, 1e-7],
                 [3, 0, 5e-12], [2, 1, -2e-12], [1, 2, 4e-12], [0, 3, 8e-12]];

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
      // Apply SIP distortion: u' = u + A(u,v), v' = v + B(u,v)
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      // Apply CD matrix to get standard coordinates
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
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
   assertTrue(result.sip !== null && result.sip !== undefined, "SIP が適用された");
   assertEqual(result.sip.order, 3, "SIP 次数 = 3");
   assertTrue(result.rms_arcsec < 0.1,
      "SIP RMS < 0.1 arcsec (実際: " + result.rms_arcsec + ")");
   assertTrue(result.rms_arcsec < result.rms_arcsec_tan,
      "SIP RMS (" + result.rms_arcsec.toFixed(4) + ") < TAN-only RMS (" + result.rms_arcsec_tan.toFixed(4) + ")");
   assertTrue(result.rms_arcsec_tan !== undefined, "rms_arcsec_tan が存在する");
});

test("WCSFitter: SIP 逆変換 (AP, BP) の精度", function () {
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   var knownA = [[2, 0, 1e-7], [1, 1, 5e-8], [0, 2, 2e-7],
                 [3, 0, 1e-11], [2, 1, 5e-12], [1, 2, 3e-12], [0, 3, 1e-11]];
   var knownB = [[2, 0, 2e-7], [1, 1, -3e-8], [0, 2, 1e-7],
                 [3, 0, 5e-12], [2, 1, -2e-12], [1, 2, 4e-12], [0, 3, 8e-12]];

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
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sip !== null, "SIP あり");
   assertTrue(result.sip.ap !== undefined, "AP が計算された");
   assertTrue(result.sip.bp !== undefined, "BP が計算された");

   // AP/BP の逆変換精度を検証: u + A(u,v) → u' → u' + AP(u',v') ≈ u
   var maxErr = 0;
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var up = u + evalSipPolynomial(result.sip.a, u, v);
      var vp = v + evalSipPolynomial(result.sip.b, u, v);
      var uRecov = up + evalSipPolynomial(result.sip.ap, up, vp);
      var vRecov = vp + evalSipPolynomial(result.sip.bp, up, vp);
      var err = Math.sqrt((uRecov - u) * (uRecov - u) + (vRecov - v) * (vRecov - v));
      if (err > maxErr) maxErr = err;
   }
   assertTrue(maxErr < 0.01,
      "逆変換精度 < 0.01 px (実際: " + maxErr.toFixed(6) + " px)");
});

test("WCSFitter: 歪みなし10星で SIP 非適用（フォールバック）", function () {
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
      // 純粋線形（SIP 歪みなし）
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
   assertTrue(!result.sip, "SIP 非適用（TAN-only で十分）");
   assertTrue(result.rms_arcsec < 0.01,
      "RMS < 0.01 arcsec (実際: " + result.rms_arcsec + ")");
});

test("WCSFitter: 5星で SIP 非適用（星数不足）", function () {
   var knownCrval = [120.0, 10.0];
   var knownCd = [
      [-5.0e-4, 0.0],
      [0.0, 5.0e-4]
   ];
   var imgW = 4000, imgH = 3000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   // SIP 歪みを持つが星が5つだけ → SIP は適用されない
   var knownA = [[2, 0, 1e-7], [1, 1, 5e-8], [0, 2, 2e-7]];
   var knownB = [[2, 0, 2e-7], [1, 1, -3e-8], [0, 2, 1e-7]];
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
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(!result.sip, "SIP 非適用（5星では不足）");
});

test("WCSFitter: SIP order 2（6星）での歪みフィッティング", function () {
   var knownCrval = [83.633, 22.014];
   var knownCd = [
      [-3.5e-4, 1.0e-5],
      [1.0e-5, 3.5e-4]
   ];
   // SIP order 2 のみ
   var knownA = [[2, 0, 2e-7], [1, 1, 1e-7], [0, 2, 3e-7]];
   var knownB = [[2, 0, 1e-7], [1, 1, -2e-7], [0, 2, 2e-7]];

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
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sip !== null && result.sip !== undefined, "SIP が適用された");
   assertEqual(result.sip.order, 2, "SIP 次数 = 2");
   assertTrue(result.rms_arcsec < 0.1,
      "SIP RMS < 0.1 arcsec (実際: " + result.rms_arcsec + ")");
   assertTrue(result.rms_arcsec < result.rms_arcsec_tan,
      "SIP RMS < TAN-only RMS");
});

//============================================================================
// solveMinNorm テスト
//============================================================================

test("solveMinNorm: 2×3 劣決定系の最小ノルム解", function () {
   // D = [[1, 0, 1], [0, 1, 1]], b = [2, 3]
   // 最小ノルム解: x = D^T (D D^T)^{-1} b
   // D D^T = [[2, 1], [1, 2]], inv = [[2/3, -1/3], [-1/3, 2/3]]
   // y = [1/3, 4/3], x = D^T y = [1/3, 4/3, 5/3]
   var D = [[1, 0, 1], [0, 1, 1]];
   var b = [2, 3];
   var x = solveMinNorm(D, b);
   assertTrue(x !== null, "解が存在する");
   assertEqual(x.length, 3, "解の長さ = 3");
   assertEqual(x[0], 1.0/3, "x[0] = 1/3", 1e-10);
   assertEqual(x[1], 4.0/3, "x[1] = 4/3", 1e-10);
   assertEqual(x[2], 5.0/3, "x[2] = 5/3", 1e-10);
   // 解が制約を満たすことを確認: D*x = b
   var check0 = D[0][0]*x[0] + D[0][1]*x[1] + D[0][2]*x[2];
   var check1 = D[1][0]*x[0] + D[1][1]*x[1] + D[1][2]*x[2];
   assertEqual(check0, b[0], "D*x = b (行1)", 1e-10);
   assertEqual(check1, b[1], "D*x = b (行2)", 1e-10);
});

test("solveMinNorm: 3×3 正方系は solveLinearSystem と同結果", function () {
   var A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
   var b = [8, -11, -3];
   var xLS = solveLinearSystem(A, b);
   var xMN = solveMinNorm(A, b);
   assertTrue(xMN !== null, "解が存在する");
   assertEqual(xMN[0], xLS[0], "x[0] 一致", 1e-10);
   assertEqual(xMN[1], xLS[1], "x[1] 一致", 1e-10);
   assertEqual(xMN[2], xLS[2], "x[2] 一致", 1e-10);
});

test("solveMinNorm: 特異行列でも正則化で解を返す", function () {
   // 行が線形従属: row2 = 2*row1, b[1] = 2*b[0] → 整合系
   var D = [[1, 2, 3], [2, 4, 6]];
   var b = [1, 2];
   var x = solveMinNorm(D, b);
   // 正則化により解を返す（D*x ≈ b を満たす）
   assertTrue(x !== null, "正則化により解を返す");
   if (x !== null) {
      var check = D[0][0]*x[0] + D[0][1]*x[1] + D[0][2]*x[2];
      assertEqual(check, b[0], "D*x ≈ b (行1)", 0.01);
   }
});

//============================================================================
// determineSipOrder 補間モードテスト
//============================================================================

test("determineSipOrder: 補間モードの次数選択（自由度≥25 目標）", function () {
   assertEqual(determineSipOrder(3, "interp"), 0, "3星 → 0（補間不可）");
   // P-norm 境界エネルギー抑制のため、自由度(=項数-星数)≥25 を目標に次数を引き上げ
   // 次数K → 項数 = (K+1)(K+2)/2 - 3: 3→7, 4→12, 5→18, 6→25, 7→33, 8→42, 9→52
   assertEqual(determineSipOrder(4, "interp"), 7, "4星 → 7（33-4=29≥25）");
   assertEqual(determineSipOrder(5, "interp"), 7, "5星 → 7（33-5=28≥25）");
   assertEqual(determineSipOrder(7, "interp"), 7, "7星 → 7（33-7=26≥25）");
   assertEqual(determineSipOrder(8, "interp"), 7, "8星 → 7（33-8=25≥25）");
   assertEqual(determineSipOrder(12, "interp"), 8, "12星 → 8（42-12=30≥25）");
   assertEqual(determineSipOrder(13, "interp"), 8, "13星 → 8（42-13=29≥25）");
   assertEqual(determineSipOrder(18, "interp"), 9, "18星 → 9（52-18=34≥25）");
   assertEqual(determineSipOrder(19, "interp"), 9, "19星 → 9（52-19=33≥25）");
   assertEqual(determineSipOrder(25, "interp"), 9, "25星 → 9（52-25=27≥25）");
   assertEqual(determineSipOrder(26, "interp"), 9, "26星 → 9（52-26=26≥25）");
});

test("determineSipOrder: 近似モード（既存互換）", function () {
   assertEqual(determineSipOrder(5, "approx"), 0, "5星 → 0");
   assertEqual(determineSipOrder(6, "approx"), 2, "6星 → 2");
   assertEqual(determineSipOrder(10, "approx"), 3, "10星 → 3");
   // デフォルト（mode 省略）も近似モード
   assertEqual(determineSipOrder(5), 0, "5星 デフォルト → 0");
   assertEqual(determineSipOrder(10), 3, "10星 デフォルト → 3");
});

//============================================================================
// 広角画像 補間モード統合テスト
//============================================================================

test("WCSFitter: 大歪み合成10星で補間モード自動選択、全星残差が小さい", function () {
   // 大きな SIP 歪みを持つ合成データ（TAN-only RMS >> 5 ピクセル → 補間モード）
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   // 大きな SIP 歪み: 端で ~40px の歪み → tanRmsPixel >> 5
   var knownA = [[2, 0, 1e-5], [1, 1, 5e-6], [0, 2, 2e-5],
                 [3, 0, 1e-9], [2, 1, 5e-10], [1, 2, 3e-10], [0, 3, 1e-9]];
   var knownB = [[2, 0, 2e-5], [1, 1, -3e-6], [0, 2, 1e-5],
                 [3, 0, 5e-10], [2, 1, -2e-10], [1, 2, 4e-10], [0, 3, 8e-10]];

   var imgW = 4000, imgH = 4000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   // 注: グリッドパターン回避（高次基底の縮退を防ぐ）、画像中心回避
   var testPixels = [
      { px: 150, py: 250 },
      { px: 1800, py: 350 },
      { px: 3600, py: 150 },
      { px: 300, py: 1900 },
      { px: 1100, py: 1300 },
      { px: 3700, py: 2100 },
      { px: 250, py: 3500 },
      { px: 2200, py: 3700 },
      { px: 3500, py: 3600 },
      { px: 2800, py: 2800 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px,
         py: testPixels[i].py,
         ra: coord[0],
         dec: coord[1],
         name: "WFStar" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sip !== null, "SIP が適用された");
   assertTrue(result.sipMode === "interp", "補間モードが選択された (実際: " + result.sipMode + ")");
   // 重み付き最小二乗のため厳密ゼロではないが、高重み比により十分小さい
   assertTrue(result.rms_arcsec < 1.0,
      "補間モード RMS < 1.0 arcsec (実際: " + result.rms_arcsec.toFixed(6) + ")");
   assertTrue(result.rms_arcsec < result.rms_arcsec_tan,
      "SIP RMS (" + result.rms_arcsec.toFixed(4) + ") < TAN-only RMS (" + result.rms_arcsec_tan.toFixed(4) + ")");

   // 各星の残差が十分小さいことを確認
   for (var i = 0; i < result.residuals.length; i++) {
      assertTrue(result.residuals[i].residual_arcsec < 1.0,
         result.residuals[i].name + " 残差 < 1.0\" (実際: " +
         result.residuals[i].residual_arcsec.toFixed(6) + "\")");
   }
});

test("WCSFitter: 狭角画像で近似モードが選択される（補間モード非適用）", function () {
   // 既存の狭角テストと同様のセットアップ
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   var knownA = [[2, 0, 1e-7], [1, 1, 5e-8], [0, 2, 2e-7],
                 [3, 0, 1e-11], [2, 1, 5e-12], [1, 2, 3e-12], [0, 3, 1e-11]];
   var knownB = [[2, 0, 2e-7], [1, 1, -3e-8], [0, 2, 1e-7],
                 [3, 0, 5e-12], [2, 1, -2e-12], [1, 2, 4e-12], [0, 3, 8e-12]];

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
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "Star" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sip !== null, "SIP が適用された");
   assertTrue(result.sipMode === "approx",
      "近似モードが選択された (実際: " + result.sipMode + ")");
});

//============================================================================
// 境界暴走抑制テスト（アンカーポイントの効果検証）
//============================================================================

test("WCSFitter: 補間モードで画像四隅の SIP 補正量が発散しない", function () {
   // 大歪みデータ（補間モード）でフィットし、画像四隅の SIP 補正量が有限であることを確認
   var knownCrval = [200.0, -30.0];
   var knownCd = [
      [-2.778e-4, 0.0],
      [0.0, 2.778e-4]
   ];
   var knownA = [[2, 0, 1e-5], [1, 1, 5e-6], [0, 2, 2e-5],
                 [3, 0, 1e-9], [2, 1, 5e-10], [1, 2, 3e-10], [0, 3, 1e-9]];
   var knownB = [[2, 0, 2e-5], [1, 1, -3e-6], [0, 2, 1e-5],
                 [3, 0, 5e-10], [2, 1, -2e-10], [1, 2, 4e-10], [0, 3, 8e-10]];

   var imgW = 4000, imgH = 4000;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   // 中央付近に星を集中配置（端にはない）→ 旧実装だと端で多項式が暴走
   var testPixels = [
      { px: 500, py: 500 },
      { px: 1800, py: 600 },
      { px: 3200, py: 400 },
      { px: 400, py: 2000 },
      { px: 1200, py: 1500 },
      { px: 3300, py: 2200 },
      { px: 600, py: 3200 },
      { px: 2100, py: 3400 },
      { px: 3100, py: 3300 },
      { px: 2500, py: 2600 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "BndStar" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sip !== null, "SIP が適用された");
   assertTrue(result.sipMode === "interp", "補間モードが選択された");

   // 画像四隅で SIP 補正量を評価: |du|, |dv| < 2 * max(width, height)
   var maxDim = Math.max(imgW, imgH);
   var corners = [
      [1 - crpix1, 1 - crpix2],                      // 左下
      [imgW - crpix1, 1 - crpix2],                    // 右下
      [1 - crpix1, imgH - crpix2],                    // 左上
      [imgW - crpix1, imgH - crpix2],                 // 右上
   ];
   var cornerNames = ["左下", "右下", "左上", "右上"];
   var boundLimit = 2 * maxDim;

   for (var i = 0; i < corners.length; i++) {
      var cu = corners[i][0], cv = corners[i][1];
      var sipDu = evalSipPolynomial(result.sip.a, cu, cv);
      var sipDv = evalSipPolynomial(result.sip.b, cu, cv);
      assertTrue(Math.abs(sipDu) < boundLimit,
         cornerNames[i] + " |du| < " + boundLimit + " (実際: " + Math.abs(sipDu).toFixed(1) + ")");
      assertTrue(Math.abs(sipDv) < boundLimit,
         cornerNames[i] + " |dv| < " + boundLimit + " (実際: " + Math.abs(sipDv).toFixed(1) + ")");
   }
});

//============================================================================
// 広角画像（90° FOV相当）実データ相当テスト
//============================================================================

test("WCSFitter: 広角90° FOV 4480×6720画像で FOV が妥当かつ境界安定", function () {
   // 実ユースケース相当: 広角レンズ（~90° FOV）で撮影した 4480×6720 画像
   // ピクセルスケール ≈ 48 arcsec/px (0.01333 deg/px)
   var knownCrval = [83.0, 22.0]; // オリオン座方向
   var pixScale = 0.01333; // deg/px
   var knownCd = [
      [-pixScale, 0.0],
      [0.0, pixScale]
   ];
   // 広角レンズ特有の大きな歪み
   var knownA = [[2, 0, 3e-5], [1, 1, 1e-5], [0, 2, 4e-5],
                 [3, 0, 5e-9], [2, 1, 2e-9], [1, 2, 1e-9], [0, 3, 3e-9]];
   var knownB = [[2, 0, 4e-5], [1, 1, -2e-5], [0, 2, 3e-5],
                 [3, 0, 2e-9], [2, 1, -1e-9], [1, 2, 3e-9], [0, 3, 4e-9]];

   var imgW = 4480, imgH = 6720;
   var crpix1 = imgW / 2.0 + 0.5;
   var crpix2 = imgH / 2.0 + 0.5;

   // 10星を画像中央〜やや外側に配置（端には配置しない → 外挿領域が存在）
   // py 範囲: 330〜3853 付近（上端・下端はカバーしない）
   var testPixels = [
      { px: 800, py: 1200 },
      { px: 2200, py: 800 },
      { px: 3800, py: 1500 },
      { px: 600, py: 2800 },
      { px: 2000, py: 2200 },
      { px: 3600, py: 3000 },
      { px: 900, py: 4500 },
      { px: 2500, py: 5000 },
      { px: 3500, py: 4800 },
      { px: 1800, py: 3800 },
   ];

   var starPairs = [];
   for (var i = 0; i < testPixels.length; i++) {
      var u = (testPixels[i].px + 1.0) - crpix1;
      var v = (imgH - testPixels[i].py) - crpix2;
      var up = u + evalSipPolynomial(knownA, u, v);
      var vp = v + evalSipPolynomial(knownB, u, v);
      var xi = knownCd[0][0] * up + knownCd[0][1] * vp;
      var eta = knownCd[1][0] * up + knownCd[1][1] * vp;
      var coord = tanDeproject(knownCrval, [xi, eta]);
      if (coord === null) {
         console.log("  WARNING: 星 " + (i+1) + " の投影が失敗");
         continue;
      }
      starPairs.push({
         px: testPixels[i].px, py: testPixels[i].py,
         ra: coord[0], dec: coord[1], name: "WAStar" + (i + 1)
      });
   }

   var fitter = new WCSFitter(starPairs, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sip !== null, "SIP が適用された");
   assertTrue(result.sipMode === "interp",
      "補間モードが選択された (実際: " + result.sipMode + ")");

   // 全星残差チェック: 90° FOV では TAN 投影の非線形性が大きいため
   // SIP order 4 でも完全には補正しきれない。ピクセルスケール ~48"/px に対し
   // RMS < 1px 相当 = 48" であれば実用的
   assertTrue(result.rms_arcsec < 60.0,
      "RMS < 60 arcsec (実際: " + result.rms_arcsec.toFixed(2) + ")");
   assertTrue(result.rms_arcsec < result.rms_arcsec_tan,
      "SIP RMS (" + result.rms_arcsec.toFixed(2) + ") < TAN-only RMS (" +
      result.rms_arcsec_tan.toFixed(2) + ")");
   for (var i = 0; i < result.residuals.length; i++) {
      assertTrue(result.residuals[i].residual_arcsec < 120.0,
         result.residuals[i].name + " 残差 < 120\" (実際: " +
         result.residuals[i].residual_arcsec.toFixed(2) + "\")");
   }

   // FOV 検証: 画像四隅の天球座標を計算し、対角 FOV が妥当か確認
   var cd = result.cd;
   var crval = [result.crval1, result.crval2];
   var cornerPixels = [
      { px: 0, py: 0 },
      { px: imgW - 1, py: 0 },
      { px: 0, py: imgH - 1 },
      { px: imgW - 1, py: imgH - 1 }
   ];
   var cornerCoords = [];
   var allCornersOk = true;
   for (var i = 0; i < cornerPixels.length; i++) {
      var u = (cornerPixels[i].px + 1.0) - result.crpix1;
      var v = (imgH - cornerPixels[i].py) - result.crpix2;
      if (result.sip) {
         u = u + evalSipPolynomial(result.sip.a, u, v);
         v = v + evalSipPolynomial(result.sip.b,
            (cornerPixels[i].px + 1.0) - result.crpix1,
            (imgH - cornerPixels[i].py) - result.crpix2);
      }
      var xi = cd[0][0] * u + cd[0][1] * v;
      var eta = cd[1][0] * u + cd[1][1] * v;
      var coord = tanDeproject(crval, [xi, eta]);
      if (coord === null) { allCornersOk = false; break; }
      cornerCoords.push(coord);
   }

   if (allCornersOk && cornerCoords.length === 4) {
      // 対角 FOV を計算
      var diag1 = angularSeparation(cornerCoords[0], cornerCoords[3]);
      var diag2 = angularSeparation(cornerCoords[1], cornerCoords[2]);
      var maxFov = Math.max(diag1, diag2);
      assertTrue(maxFov > 60 && maxFov < 150,
         "FOV が妥当 (60°-150°, 実際: " + maxFov.toFixed(1) + "°)");
   } else {
      assertTrue(allCornersOk, "四隅の投影が成功（暴走していない）");
   }

   // 画像四隅の SIP 補正量が有限であることを確認
   var maxDim = Math.max(imgW, imgH);
   var boundLimit = 2 * maxDim;
   var uCorners = [1 - crpix1, imgW - crpix1];
   var vCorners = [1 - crpix2, imgH - crpix2];
   for (var ui = 0; ui < uCorners.length; ui++) {
      for (var vi = 0; vi < vCorners.length; vi++) {
         var sipDu = evalSipPolynomial(result.sip.a, uCorners[ui], vCorners[vi]);
         var sipDv = evalSipPolynomial(result.sip.b, uCorners[ui], vCorners[vi]);
         assertTrue(Math.abs(sipDu) < boundLimit,
            "隅(" + ui + "," + vi + ") |du| < " + boundLimit + " (実際: " + Math.abs(sipDu).toFixed(1) + ")");
         assertTrue(Math.abs(sipDv) < boundLimit,
            "隅(" + ui + "," + vi + ") |dv| < " + boundLimit + " (実際: " + Math.abs(sipDv).toFixed(1) + ")");
      }
   }
});

test("WCSFitter: 広角90° FOV 実データで逆SIP(sky→pixel)が正確", function () {
   // 実ユースケースの 10 星データ (4480×6720, ~90° FOV)
   // AnnotateImage の正確な動作に逆 SIP の精度が必要
   var realStars = [
      { name: "deneb",    px: 2080.8, py: 2091.8, ra: 310.358,  dec: 45.2803 },
      { name: "vega",     px: 928.5,  py: 1910.1, ra: 279.2348, dec: 38.7837 },
      { name: "altair",   px: 1688.4, py: 330.6,  ra: 297.6958, dec: 8.8683  },
      { name: "sadr",     px: 1938.3, py: 1827.1, ra: 305.5571, dec: 40.2567 },
      { name: "eps_del",  px: 2269.1, py: 471.1,  ra: 308.3032, dec: 11.3033 },
      { name: "eps_peg",  px: 3250.9, py: 667.2,  ra: 326.0465, dec: 9.875   },
      { name: "M31",      px: 3897.9, py: 3114.7, ra: 10.6847,  dec: 41.2688 },
      { name: "bet_and",  px: 4251.1, py: 3226.3, ra: 17.433,   dec: 35.6206 },
      { name: "gam_and",  px: 4098.7, py: 3852.8, ra: 30.9748,  dec: 42.3297 },
      { name: "del_sct",  px: 3049.3, py: 3357.0, ra: 280.5685, dec: -9.0525 }
   ];
   var imgW = 4480, imgH = 6720;

   var fitter = new WCSFitter(realStars, imgW, imgH);
   var result = fitter.solve();

   assertTrue(result.success, "フィット成功");
   assertTrue(result.sipMode === "interp", "補間モード");
   assertTrue(result.sip.ap !== undefined && result.sip.bp !== undefined, "逆SIPあり");
   assertTrue(result.sip.invOrder !== undefined, "invOrder が設定されている");

   // 逆SIPに線形項（order 1）が含まれることを確認
   var hasLinearAP = false;
   for (var i = 0; i < result.sip.ap.length; i++) {
      if (result.sip.ap[i][0] + result.sip.ap[i][1] === 1) {
         hasLinearAP = true;
         break;
      }
   }
   assertTrue(hasLinearAP, "逆SIPに線形項(order 1)が含まれる");

   // 各星で逆SIP精度を検証: (RA, Dec) → TAN → CD⁻¹ → AP/BP → (u, v)
   var cd = result.cd;
   var crval = [result.crval1, result.crval2];
   var detCD = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
   var cdInv = [
      [cd[1][1] / detCD, -cd[0][1] / detCD],
      [-cd[1][0] / detCD, cd[0][0] / detCD]
   ];

   var maxInvErr = 0;
   for (var i = 0; i < realStars.length; i++) {
      var u = (realStars[i].px + 1) - result.crpix1;
      var v = (imgH - realStars[i].py) - result.crpix2;
      var tp = tanProject(crval, [realStars[i].ra, realStars[i].dec]);
      assertTrue(tp !== null, realStars[i].name + " TAN投影成功");
      var up = cdInv[0][0] * tp[0] + cdInv[0][1] * tp[1];
      var vp = cdInv[1][0] * tp[0] + cdInv[1][1] * tp[1];
      var uBack = up + evalSipPolynomial(result.sip.ap, up, vp);
      var vBack = vp + evalSipPolynomial(result.sip.bp, up, vp);
      var err = Math.sqrt((uBack - u) * (uBack - u) + (vBack - v) * (vBack - v));
      if (err > maxInvErr) maxInvErr = err;
      // 各星で 50 px 以内（90° FOV での逆SIP精度上限）
      assertTrue(err < 50,
         realStars[i].name + " 逆SIP誤差 < 50 px (実際: " + err.toFixed(1) + " px)");
   }
   // 全星の最大誤差が 50 px 以内
   assertTrue(maxInvErr < 50,
      "逆SIP MAX < 50 px (実際: " + maxInvErr.toFixed(1) + " px)");
});

//============================================================================
// fitPolynomial2D テスト
//============================================================================

(function () {
   testName = "fitPolynomial2D: order 2 の既知多項式フィット";

   // f(u,v) = 3*u^2 - 2*u*v + v^2
   var uArr = [], vArr = [], tArr = [];
   for (var i = 0; i < 10; i++) {
      var u = (i - 5) * 0.1;
      var v = (i - 3) * 0.15;
      uArr.push(u);
      vArr.push(v);
      tArr.push(3 * u * u - 2 * u * v + v * v);
   }

   var result = fitPolynomial2D(uArr, vArr, tArr, 2);
   assertTrue(result !== null, "result should not be null");
   assertEqual(result.length, 3, "order 2 should have 3 terms");

   // 係数を辞書的に取得
   var coeffMap = {};
   for (var i = 0; i < result.length; i++) {
      coeffMap[result[i][0] + "," + result[i][1]] = result[i][2];
   }
   assertEqual(coeffMap["2,0"], 3.0, "u^2 coeff = 3", 1e-10);
   assertEqual(coeffMap["1,1"], -2.0, "uv coeff = -2", 1e-10);
   assertEqual(coeffMap["0,2"], 1.0, "v^2 coeff = 1", 1e-10);
})();

(function () {
   testName = "fitPolynomial2D: order 3 フィット";

   // f(u,v) = u^2 + 0.5*u^3 - 0.3*u*v^2
   // 2Dグリッドでデータ生成（線形依存を回避）
   var uArr = [], vArr = [], tArr = [];
   for (var iy = 0; iy < 5; iy++) {
      for (var ix = 0; ix < 5; ix++) {
         var u = (ix - 2) * 0.1;
         var v = (iy - 2) * 0.1;
         uArr.push(u);
         vArr.push(v);
         tArr.push(u * u + 0.5 * u * u * u - 0.3 * u * v * v);
      }
   }

   var result = fitPolynomial2D(uArr, vArr, tArr, 3);
   assertTrue(result !== null, "result should not be null");
   assertEqual(result.length, 7, "order 3 should have 7 terms");

   var coeffMap = {};
   for (var i = 0; i < result.length; i++) {
      coeffMap[result[i][0] + "," + result[i][1]] = result[i][2];
   }
   assertEqual(coeffMap["2,0"], 1.0, "u^2 coeff = 1", 1e-8);
   assertEqual(coeffMap["3,0"], 0.5, "u^3 coeff = 0.5", 1e-8);
   assertEqual(coeffMap["1,2"], -0.3, "uv^2 coeff = -0.3", 1e-8);
   assertEqual(coeffMap["1,1"], 0.0, "uv coeff = 0", 1e-8);
   assertEqual(coeffMap["0,2"], 0.0, "v^2 coeff = 0", 1e-8);
})();

(function () {
   testName = "fitPolynomial2D: 星数不足で null";

   var result = fitPolynomial2D([0.1, 0.2], [0.3, 0.4], [0.01, 0.02], 2);
   assertTrue(result === null, "should return null when nData < nTerms");
})();

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
