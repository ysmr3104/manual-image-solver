//============================================================================
// test_parse_coords.js - parseRAInput / parseDECInput の Node.js 単体テスト
//
// 実行方法: node tests/javascript/test_parse_coords.js
//
// ManualImageSolver.js から座標パース関数を抽出してテスト。
// PJSR 環境外で動作するため、関数を直接定義。
//============================================================================

var passed = 0;
var failed = 0;

function assertEqual(actual, expected, msg, tolerance) {
   if (typeof tolerance === "undefined") tolerance = 0;
   var ok;
   if (expected === null) {
      ok = actual === null;
   } else if (tolerance > 0) {
      ok = actual !== null && Math.abs(actual - expected) <= tolerance;
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

function test(name, fn) {
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
// 座標パース関数（ManualImageSolver.js から抽出）
//
// 警告: 以下の関数は ManualImageSolver.js の実装をコピーしたものです。
// 本体側を修正した場合はこちらも同期してください。
//   - parseRAInput()    → ManualImageSolver.js 内 parseRAInput
//   - parseDECInput()   → ManualImageSolver.js 内 parseDECInput
//   - midtonesTransferFunction() → wcs_math.js 内 midtonesTransferFunction
//============================================================================

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

function midtonesTransferFunction(m, x) {
   if (x <= 0) return 0;
   if (x >= 1) return 1;
   if (m === 0) return 0;
   if (m === 1) return 1;
   if (m === 0.5) return x;
   return ((m - 1.0) * x) / ((2.0 * m - 1.0) * x - m);
}

//============================================================================
// parseRAInput テスト
//============================================================================

test("parseRAInput: HMS スペース区切り", function () {
   // 05 14 32.27 → (5 + 14/60 + 32.27/3600) * 15
   var expected = (5 + 14/60.0 + 32.27/3600.0) * 15.0;
   assertEqual(parseRAInput("05 14 32.27"), expected, "05 14 32.27", 1e-8);
});

test("parseRAInput: HMS コロン区切り", function () {
   var expected = (5 + 14/60.0 + 32.27/3600.0) * 15.0;
   assertEqual(parseRAInput("05:14:32.27"), expected, "05:14:32.27", 1e-8);
});

test("parseRAInput: HMS ゼロ秒", function () {
   var expected = (12 + 0/60.0 + 0/3600.0) * 15.0;
   assertEqual(parseRAInput("12 00 00.00"), expected, "12 00 00.00 → 180°", 1e-8);
});

test("parseRAInput: 度数直接入力", function () {
   assertEqual(parseRAInput("78.634"), 78.634, "78.634°", 1e-8);
});

test("parseRAInput: 度数 0", function () {
   assertEqual(parseRAInput("0"), 0, "0°", 1e-8);
});

test("parseRAInput: 度数 359.999", function () {
   assertEqual(parseRAInput("359.999"), 359.999, "359.999°", 1e-8);
});

test("parseRAInput: 空文字で null", function () {
   assertEqual(parseRAInput(""), null, "空文字 → null");
});

test("parseRAInput: スペースのみで null", function () {
   assertEqual(parseRAInput("   "), null, "スペースのみ → null");
});

test("parseRAInput: 不正文字列で null", function () {
   assertEqual(parseRAInput("abc"), null, "abc → null");
});

test("parseRAInput: null 入力で null", function () {
   assertEqual(parseRAInput(null), null, "null → null");
});

test("parseRAInput: 前後スペースのトリム", function () {
   assertEqual(parseRAInput("  78.634  "), 78.634, "前後スペース除去", 1e-8);
});

test("parseRAInput: Sirius RA (HMS)", function () {
   // Sirius: RA = 06 45 08.92 → (6 + 45/60 + 8.92/3600) * 15 ≈ 101.2872
   var expected = (6 + 45/60.0 + 8.92/3600.0) * 15.0;
   assertEqual(parseRAInput("06 45 08.92"), expected, "Sirius RA HMS", 1e-6);
});

test("parseRAInput: Vega RA (HMS コロン)", function () {
   // Vega: RA = 18:36:56.34 → (18 + 36/60 + 56.34/3600) * 15 ≈ 279.2348
   var expected = (18 + 36/60.0 + 56.34/3600.0) * 15.0;
   assertEqual(parseRAInput("18:36:56.34"), expected, "Vega RA HMS コロン", 1e-6);
});

//============================================================================
// parseDECInput テスト
//============================================================================

test("parseDECInput: DMS 正（プラス符号あり）", function () {
   // +07 24 25.4 → +(7 + 24/60 + 25.4/3600)
   var expected = 7 + 24/60.0 + 25.4/3600.0;
   assertEqual(parseDECInput("+07 24 25.4"), expected, "+07 24 25.4", 1e-8);
});

test("parseDECInput: DMS 負", function () {
   // -08 12 05.9 → -(8 + 12/60 + 5.9/3600)
   var expected = -(8 + 12/60.0 + 5.9/3600.0);
   assertEqual(parseDECInput("-08 12 05.9"), expected, "-08 12 05.9", 1e-8);
});

test("parseDECInput: DMS コロン区切り 正", function () {
   var expected = 7 + 24/60.0 + 25.4/3600.0;
   assertEqual(parseDECInput("+07:24:25.4"), expected, "+07:24:25.4", 1e-8);
});

test("parseDECInput: DMS コロン区切り 負", function () {
   var expected = -(8 + 12/60.0 + 5.9/3600.0);
   assertEqual(parseDECInput("-08:12:05.9"), expected, "-08:12:05.9", 1e-8);
});

test("parseDECInput: DMS 符号なし（正扱い）", function () {
   var expected = 45 + 30/60.0 + 0/3600.0;
   assertEqual(parseDECInput("45 30 00.0"), expected, "45 30 00.0", 1e-8);
});

test("parseDECInput: 度数直接入力 正", function () {
   assertEqual(parseDECInput("7.407"), 7.407, "7.407°", 1e-8);
});

test("parseDECInput: 度数直接入力 負", function () {
   assertEqual(parseDECInput("-8.202"), -8.202, "-8.202°", 1e-8);
});

test("parseDECInput: 度数 0", function () {
   assertEqual(parseDECInput("0"), 0, "0°", 1e-8);
});

test("parseDECInput: 度数 +90", function () {
   assertEqual(parseDECInput("+90"), 90, "+90°", 1e-8);
});

test("parseDECInput: 度数 -90", function () {
   assertEqual(parseDECInput("-90"), -90, "-90°", 1e-8);
});

test("parseDECInput: 空文字で null", function () {
   assertEqual(parseDECInput(""), null, "空文字 → null");
});

test("parseDECInput: 不正文字列で null", function () {
   assertEqual(parseDECInput("xyz"), null, "xyz → null");
});

test("parseDECInput: null 入力で null", function () {
   assertEqual(parseDECInput(null), null, "null → null");
});

test("parseDECInput: Sirius DEC (DMS)", function () {
   // Sirius: DEC = -16 42 58.0 → -(16 + 42/60 + 58.0/3600) ≈ -16.7161
   var expected = -(16 + 42/60.0 + 58.0/3600.0);
   assertEqual(parseDECInput("-16 42 58.0"), expected, "Sirius DEC DMS", 1e-6);
});

//============================================================================
// MTF テスト
//============================================================================

test("MTF: 境界値テスト", function () {
   assertEqual(midtonesTransferFunction(0.5, 0), 0, "MTF(0.5, 0) = 0", 1e-12);
   assertEqual(midtonesTransferFunction(0.5, 1), 1, "MTF(0.5, 1) = 1", 1e-12);
   assertEqual(midtonesTransferFunction(0.5, 0.5), 0.5, "MTF(0.5, 0.5) = 0.5", 1e-12);
   assertEqual(midtonesTransferFunction(0.5, 0.25), 0.25, "MTF(0.5, 0.25) = 0.25", 1e-12);
});

test("MTF: m=0.5 で恒等関数", function () {
   for (var x = 0; x <= 1.0; x += 0.1) {
      assertEqual(midtonesTransferFunction(0.5, x), x, "MTF(0.5, " + x.toFixed(1) + ")", 1e-10);
   }
});

test("MTF: m < 0.5 で明るくなる（PI の MTF 規約）", function () {
   var result = midtonesTransferFunction(0.25, 0.5);
   assertTrue(result > 0.5, "MTF(0.25, 0.5) > 0.5 (実際: " + result + ")");
});

test("MTF: m > 0.5 で暗くなる（PI の MTF 規約）", function () {
   var result = midtonesTransferFunction(0.75, 0.5);
   assertTrue(result < 0.5, "MTF(0.75, 0.5) < 0.5 (実際: " + result + ")");
});

test("MTF: 単調増加", function () {
   var m = 0.3;
   var prev = 0;
   var monotonic = true;
   for (var x = 0.01; x <= 1.0; x += 0.01) {
      var val = midtonesTransferFunction(m, x);
      if (val < prev) {
         monotonic = false;
         break;
      }
      prev = val;
   }
   assertTrue(monotonic, "MTF(0.3, x) は単調増加");
});

//============================================================================
// parseRAInput ↔ raToHMS 往復テスト
//============================================================================

// raToHMS を定義（ManualImageSolver.js と同一）
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

test("RA 往復: 度数 → HMS → 度数", function () {
   var testValues = [0, 45.0, 78.634, 101.287, 180.0, 270.0, 359.5];
   for (var i = 0; i < testValues.length; i++) {
      var orig = testValues[i];
      var hms = raToHMS(orig);
      var parsed = parseRAInput(hms);
      assertEqual(parsed, orig, "RA 往復 " + orig + "° → '" + hms + "' → " + parsed + "°", 0.01);
   }
});

test("DEC 往復: 度数 → DMS → 度数", function () {
   var testValues = [-90, -45.3, -16.716, 0, 7.407, 45.0, 89.5];
   for (var i = 0; i < testValues.length; i++) {
      var orig = testValues[i];
      var dms = decToDMS(orig);
      var parsed = parseDECInput(dms);
      assertEqual(parsed, orig, "DEC 往復 " + orig + "° → '" + dms + "' → " + parsed + "°", 0.1);
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
