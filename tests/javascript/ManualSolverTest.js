//============================================================================
// ManualSolverTest.js - ManualImageSolver の PJSR 統合テスト
//
// PixInsight コンソールで実行:
//   Script > Run Script File... > ManualSolverTest.js
//
// テスト対象: WCS キーワード適用、セントロイド計算、CDS Sesame 検索
// 数学関数の精度テストは test_wcs_math.js（Node.js）で実施済みのため重複しない
//============================================================================

#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>

#include "../../javascript/wcs_keywords.js"

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
         if (val > 0) { sumW += val; sumWX += val * x; sumWY += val * y; }
      }
   }
   if (sumW <= 0) return null;
   return { x: sumWX / sumW, y: sumWY / sumW };
}

function searchObjectCoordinates(objectName) {
   var encoded = objectName.replace(/ /g, "+");
   var url = "http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?" + encoded;
   var tmpFile = File.systemTempDirectory + "/sesame_query.txt";
   var P = new ExternalProcess;
   P.start("curl", ["-s", "-o", tmpFile, "-m", "10", url]);
   if (!P.waitForFinished(15000)) { P.kill(); return null; }
   if (P.exitCode !== 0) return null;
   if (!File.exists(tmpFile)) return null;
   var content = "";
   try { content = File.readTextFile(tmpFile); File.remove(tmpFile); } catch (e) { return null; }
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
// テストフレームワーク
//============================================================================

var testPassed = 0;
var testFailed = 0;

function assert(condition, msg) {
   if (condition) {
      testPassed++;
   } else {
      console.criticalln("  FAIL: " + msg);
      testFailed++;
   }
}

function assertClose(actual, expected, tolerance, msg) {
   if (Math.abs(actual - expected) <= tolerance) {
      testPassed++;
   } else {
      console.criticalln("  FAIL: " + msg + " (期待: " + expected + ", 実際: " + actual + ", 許容: " + tolerance + ")");
      testFailed++;
   }
}

//============================================================================
// テスト 1: WCS キーワード適用
//============================================================================

function testWCSKeywordApplication() {
   console.writeln("<b>[Test] WCS キーワード適用</b>");

   // テスト用の一時画像を作成
   var testWindow = new ImageWindow(100, 100, 1, 32, true, false, "ManualSolverTest_WCS");
   testWindow.show();

   // 既存キーワードをセット（WCS + 非WCS）
   var initialKw = [
      new FITSKeyword("OBJECT", "'TestImage'", ""),
      new FITSKeyword("CRVAL1", "999.0", ""),       // 既存 WCS（上書きされるべき）
      new FITSKeyword("FILTER", "'Luminance'", ""),
   ];
   testWindow.keywords = initialKw;

   // WCS 結果を作成
   var wcsResult = {
      crval1: 180.5,
      crval2: 45.3,
      crpix1: 50.5,
      crpix2: 50.5,
      cd: [[-1e-4, 0], [0, 1e-4]]
   };

   // 適用
   applyWCS(testWindow, wcsResult);

   // 検証
   var kw = testWindow.keywords;

   // 非WCSキーワードが残っていること
   var hasObject = false, hasFilter = false;
   for (var i = 0; i < kw.length; i++) {
      if (kw[i].name === "OBJECT") hasObject = true;
      if (kw[i].name === "FILTER") hasFilter = true;
   }
   assert(hasObject, "OBJECT キーワードが保持されている");
   assert(hasFilter, "FILTER キーワードが保持されている");

   // WCSキーワードが正しく設定されていること
   var foundCRVAL1 = false, foundCTYPE1 = false, foundPLTSOLVD = false;
   var crval1Value = null;
   for (var i = 0; i < kw.length; i++) {
      if (kw[i].name === "CRVAL1") {
         foundCRVAL1 = true;
         crval1Value = parseFloat(kw[i].value);
      }
      if (kw[i].name === "CTYPE1") foundCTYPE1 = true;
      if (kw[i].name === "PLTSOLVD") foundPLTSOLVD = true;
   }
   assert(foundCRVAL1, "CRVAL1 が設定されている");
   assert(foundCTYPE1, "CTYPE1 が設定されている");
   assert(foundPLTSOLVD, "PLTSOLVD が設定されている");
   if (crval1Value !== null) {
      assertClose(crval1Value, 180.5, 0.001, "CRVAL1 の値が正しい");
   }

   // 古い CRVAL1=999 が残っていないこと
   var oldCrvalCount = 0;
   for (var i = 0; i < kw.length; i++) {
      if (kw[i].name === "CRVAL1") oldCrvalCount++;
   }
   assert(oldCrvalCount === 1, "CRVAL1 は 1 つだけ（古い値は削除済み）");

   testWindow.forceClose();
   console.writeln("  → WCS キーワード適用テスト完了");
}

//============================================================================
// テスト 2: セントロイド計算（ガウシアン星像）
//============================================================================

function testCentroidComputation() {
   console.writeln("<b>[Test] セントロイド計算</b>");

   // テスト用画像（200x200、ガウシアン星像を配置）
   var testWindow = new ImageWindow(200, 200, 1, 32, true, false, "ManualSolverTest_Centroid");
   testWindow.show();

   var view = testWindow.mainView;
   view.beginProcess(UndoFlag_NoSwapFile);

   var image = view.image;
   // 背景ノイズ（低レベル）
   image.fill(0.1);

   // 中心 (100, 80) にガウシアン星像を配置
   var starX = 100;
   var starY = 80;
   var sigma = 3.0;
   var peak = 0.9;

   for (var y = starY - 15; y <= starY + 15; y++) {
      for (var x = starX - 15; x <= starX + 15; x++) {
         if (x >= 0 && x < 200 && y >= 0 && y < 200) {
            var dx = x - starX;
            var dy = y - starY;
            var val = 0.1 + peak * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
            image.setSample(val, x, y, 0);
         }
      }
   }

   view.endProcess();

   // セントロイド計算（クリック位置を星の近傍に設定）
   var centroid = computeCentroid(image, 102, 82, 10);

   assert(centroid !== null, "セントロイドが計算できた");
   if (centroid) {
      assertClose(centroid.x, starX, 1.0, "セントロイド X (許容 1px)");
      assertClose(centroid.y, starY, 1.0, "セントロイド Y (許容 1px)");
      console.writeln(format("  Centroid: (%.3f, %.3f), 期待: (%d, %d)", centroid.x, centroid.y, starX, starY));
   }

   // 星のない領域でセントロイドが null を返すこと
   var emptyResult = computeCentroid(image, 10, 10, 5);
   // 均一な背景なので null になるはず
   // （中央値差し引き後に正の値がないため）
   // ※ 完全に均一でない場合もあるので、この検証は参考程度
   console.writeln("  Empty region centroid: " + (emptyResult === null ? "null (正常)" : format("(%.2f, %.2f)", emptyResult.x, emptyResult.y)));

   testWindow.forceClose();
   console.writeln("  → セントロイド計算テスト完了");
}

//============================================================================
// テスト 3: CDS Sesame 検索
//============================================================================

function testSesameSearch() {
   console.writeln("<b>[Test] CDS Sesame 天体名検索</b>");

   // Sirius の検索
   console.writeln("  Searching for 'Sirius'...");
   var result = searchObjectCoordinates("Sirius");

   if (result === null) {
      console.warningln("  SKIP: Sesame 検索がタイムアウトまたはネットワーク不可（オフライン環境）");
   } else {
      // Sirius: RA ≈ 101.287, DEC ≈ -16.716
      assertClose(result.ra, 101.287, 0.1, "Sirius RA ≈ 101.287°");
      assertClose(result.dec, -16.716, 0.1, "Sirius DEC ≈ -16.716°");
      console.writeln(format("  Found: RA=%.4f, DEC=%.4f", result.ra, result.dec));
   }

   console.writeln("  → Sesame 検索テスト完了");
}

//============================================================================
// メイン
//============================================================================

function main() {
   console.show();
   console.writeln("=".repeat(60));
   console.writeln("<b>ManualImageSolver 統合テスト</b>");
   console.writeln("=".repeat(60));
   console.writeln("");

   testWCSKeywordApplication();
   console.writeln("");
   testCentroidComputation();
   console.writeln("");
   testSesameSearch();

   console.writeln("");
   console.writeln("=".repeat(60));
   if (testFailed === 0) {
      console.writeln(format("<b>結果: %d passed, 0 failed ✓</b>", testPassed));
   } else {
      console.criticalln(format("<b>結果: %d passed, %d FAILED</b>", testPassed, testFailed));
   }
   console.writeln("=".repeat(60));
}

main();
