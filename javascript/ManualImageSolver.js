#feature-id    ManualImageSolver : Utilities > ManualImageSolver
#feature-info  Manual plate solver: launch Python GUI to identify stars \
   and compute a TAN-projection WCS solution, then apply it to the active image.

//----------------------------------------------------------------------------
// ManualImageSolver.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Manual Image Solver: Python GUI を起動して手動で星を同定し、
// TAN投影 WCS を算出してアクティブ画像に適用する。
//
// Copyright (c) 2024-2025 Split Image Solver Project
//----------------------------------------------------------------------------

#define VERSION "1.0.0"

#include <pjsr/DataType.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/Sizer.jsh>

#include "wcs_math.js"

#define TITLE "Manual Image Solver"

//============================================================================
// ユーティリティ関数
//============================================================================

// パス内のスペースをシェル用にエスケープ
function quotePath(path) {
   return "'" + path.replace(/'/g, "'\\''") + "'";
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
      "PLTSOLVD",
      "OBJCTRA", "OBJCTDEC"
   ];
   for (var i = 0; i < wcsNames.length; i++) {
      if (name === wcsNames[i]) return true;
   }
   // SIP係数: A_i_j, B_i_j, AP_i_j, BP_i_j
   if (/^[AB]P?_\d+_\d+$/.test(name)) return true;
   return false;
}

// FITSKeywordの型を値から判定して適切なFITSKeywordオブジェクトを生成
function makeFITSKeyword(name, value) {
   var strVal = value.toString();
   // 論理値
   if (strVal === "T" || strVal === "true") {
      return new FITSKeyword(name, "T", "");
   }
   if (strVal === "F" || strVal === "false") {
      return new FITSKeyword(name, "F", "");
   }
   // 文字列型
   var stringKeys = ["CTYPE1", "CTYPE2", "CUNIT1", "CUNIT2", "RADESYS", "PLTSOLVD",
      "OBJCTRA", "OBJCTDEC"];
   for (var i = 0; i < stringKeys.length; i++) {
      if (name === stringKeys[i]) {
         return new FITSKeyword(name, "'" + strVal + "'", "");
      }
   }
   // 数値
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

// ピクセル座標 → 天球座標変換（WCS JSON の wcs オブジェクト使用）
// 標準 FITS 座標系: y=1 が画像下端。fits_y = imageHeight - py。
function pixelToRaDec(wcs, px, py, imageHeight) {
   var u = (px + 1.0) - wcs.crpix1;
   var v = (imageHeight - py) - wcs.crpix2;
   var xi  = wcs.cd1_1 * u + wcs.cd1_2 * v;
   var eta = wcs.cd2_1 * u + wcs.cd2_2 * v;
   return tanDeproject([wcs.crval1, wcs.crval2], [xi, eta]);
}

// 画像四隅・中央の座標をコンソールに表示
function displayImageCoordinates(wcsData, imageWidth, imageHeight) {
   var wcs = wcsData.wcs;
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

   // FOV 計算
   var widthFov = angularSeparation(tl, tr);
   var heightFov = angularSeparation(tl, bl);
   console.writeln("  Field of view . " + widthFov.toFixed(2) + " x " + heightFov.toFixed(2) + " deg");
   if (wcsData.fit_quality && wcsData.fit_quality.pixel_scale_arcsec)
      console.writeln("  Pixel scale ... " + wcsData.fit_quality.pixel_scale_arcsec.toFixed(2) + " arcsec/px");

   // 回転角度計算（CD行列から）
   var rotationDeg = Math.atan2(-wcs.cd1_2, wcs.cd2_2) * 180.0 / Math.PI;
   console.writeln("  Rotation ...... " + rotationDeg.toFixed(2) + " deg");
}

// 星ペア情報をコンソールに表示
function displayStarPairs(wcsData) {
   if (!wcsData.star_pairs || wcsData.star_pairs.length === 0) return;
   console.writeln("");
   console.writeln("<b>Star pairs:</b>");
   for (var i = 0; i < wcsData.star_pairs.length; i++) {
      var s = wcsData.star_pairs[i];
      var line = "  " + (i + 1) + ". " + (s.name || "Star " + (i + 1));
      line += "  px(" + s.px.toFixed(1) + ", " + s.py.toFixed(1) + ")";
      line += "  RA: " + raToHMS(s.ra) + "  Dec: " + decToDMS(s.dec);
      if (s.residual_arcsec !== undefined)
         line += "  residual: " + s.residual_arcsec.toFixed(2) + "\"";
      console.writeln(line);
   }
}

//============================================================================
// WCS 適用関数（JSON フォーマットから読み込み）
//============================================================================

function applyWCSFromJSON(window, wcsData) {
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

   // 画像中心の RA/DEC を OBJCTRA/OBJCTDEC として書き込み（ImageSolver 互換）
   var imgCenter = pixelToRaDec(wcs,
      wcsData.image.width / 2.0, wcsData.image.height / 2.0, wcsData.image.height);
   cleanedKw.push(makeFITSKeyword("OBJCTRA", raToHMS(imgCenter[0])));
   cleanedKw.push(makeFITSKeyword("OBJCTDEC", decToDMS(imgCenter[1])));

   window.keywords = cleanedKw;
   window.regenerateAstrometricSolution();
}

//============================================================================
// Settings 管理
//============================================================================

#define SETTINGS_KEY_PREFIX "ManualImageSolver/"
#define KEY_PYTHON_PATH     SETTINGS_KEY_PREFIX + "pythonPath"
#define KEY_SCRIPT_DIR      SETTINGS_KEY_PREFIX + "scriptDir"
#define KEY_LAST_WCS_JSON   SETTINGS_KEY_PREFIX + "lastWcsJson"

function ManualSolverParameters() {
   this.pythonPath = "";
   this.scriptDir = "";
   this.lastWcsJson = "";

   this.load = function () {
      var val;
      try {
         val = Settings.read(KEY_PYTHON_PATH, DataType_String);
         if (val !== null) this.pythonPath = val;
      } catch (e) { }
      try {
         val = Settings.read(KEY_SCRIPT_DIR, DataType_String);
         if (val !== null) this.scriptDir = val;
      } catch (e) { }
      try {
         val = Settings.read(KEY_LAST_WCS_JSON, DataType_String);
         if (val !== null) this.lastWcsJson = val;
      } catch (e) { }
   };

   this.save = function () {
      Settings.write(KEY_PYTHON_PATH, DataType_String, this.pythonPath);
      Settings.write(KEY_SCRIPT_DIR, DataType_String, this.scriptDir);
      Settings.write(KEY_LAST_WCS_JSON, DataType_String, this.lastWcsJson);
   };

   this.isConfigured = function () {
      return this.pythonPath.length > 0 && this.scriptDir.length > 0;
   };
}

//============================================================================
// SettingsDialog: Python パスとスクリプトディレクトリの設定
//============================================================================

function SettingsDialog(params) {
   this.__base__ = Dialog;
   this.__base__();

   this.params = params;

   this.windowTitle = TITLE + " - 設定";
   this.minWidth = 500;

   // --- Python path ---
   var pythonLabel = new Label(this);
   pythonLabel.text = "Python executable:";
   pythonLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.pythonEdit = new Edit(this);
   this.pythonEdit.text = params.pythonPath;
   this.pythonEdit.toolTip = "Python 実行ファイルのパス（例: /path/to/.venv/bin/python）";
   this.pythonEdit.onTextUpdated = function () {
      params.pythonPath = this.dialog.pythonEdit.text.trim();
   };

   var pythonBrowse = new ToolButton(this);
   pythonBrowse.icon = this.scaledResource(":/icons/select-file.png");
   pythonBrowse.setScaledFixedSize(22, 22);
   pythonBrowse.toolTip = "Python 実行ファイルを選択";
   pythonBrowse.onClick = function () {
      var fd = new OpenFileDialog;
      fd.caption = "Python 実行ファイルを選択";
      if (fd.execute()) {
         this.dialog.pythonEdit.text = fd.fileName;
         params.pythonPath = fd.fileName;
      }
   };

   var pythonSizer = new HorizontalSizer;
   pythonSizer.spacing = 4;
   pythonSizer.add(pythonLabel);
   pythonSizer.add(this.pythonEdit, 100);
   pythonSizer.add(pythonBrowse);

   // --- Script directory ---
   var scriptDirLabel = new Label(this);
   scriptDirLabel.text = "Script directory:";
   scriptDirLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.scriptDirEdit = new Edit(this);
   this.scriptDirEdit.text = params.scriptDir;
   this.scriptDirEdit.toolTip = "manual-image-solver ディレクトリのパス";
   this.scriptDirEdit.onTextUpdated = function () {
      params.scriptDir = this.dialog.scriptDirEdit.text.trim();
   };

   var scriptDirBrowse = new ToolButton(this);
   scriptDirBrowse.icon = this.scaledResource(":/icons/select-file.png");
   scriptDirBrowse.setScaledFixedSize(22, 22);
   scriptDirBrowse.toolTip = "manual-image-solver ディレクトリを選択";
   scriptDirBrowse.onClick = function () {
      var gdd = new GetDirectoryDialog;
      gdd.caption = "manual-image-solver ディレクトリを選択";
      if (gdd.execute()) {
         this.dialog.scriptDirEdit.text = gdd.directory;
         params.scriptDir = gdd.directory;
      }
   };

   var scriptDirSizer = new HorizontalSizer;
   scriptDirSizer.spacing = 4;
   scriptDirSizer.add(scriptDirLabel);
   scriptDirSizer.add(this.scriptDirEdit, 100);
   scriptDirSizer.add(scriptDirBrowse);

   // --- Buttons ---
   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.icon = this.scaledResource(":/icons/ok.png");
   this.okButton.onClick = function () {
      if (params.pythonPath.length === 0) {
         var mb = new MessageBox(
            "Python 実行ファイルのパスを指定してください。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      if (!File.exists(params.pythonPath)) {
         var mb = new MessageBox(
            "指定された Python 実行ファイルが見つかりません:\n" + params.pythonPath,
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      if (params.scriptDir.length === 0) {
         var mb = new MessageBox(
            "スクリプトディレクトリを指定してください。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      // python/main.py の存在チェック
      var mainPy = params.scriptDir + "/python/main.py";
      if (!File.exists(mainPy)) {
         var mb = new MessageBox(
            "指定されたディレクトリに python/main.py が見つかりません:\n" +
            mainPy + "\n\n" +
            "manual-image-solver のルートディレクトリを指定してください。",
            TITLE, StdIcon_Error, StdButton_Ok);
         mb.execute();
         return;
      }
      this.dialog.ok();
   };

   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Cancel";
   this.cancelButton.icon = this.scaledResource(":/icons/cancel.png");
   this.cancelButton.onClick = function () {
      this.dialog.cancel();
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
   this.sizer.add(pythonSizer);
   this.sizer.add(scriptDirSizer);
   this.sizer.addSpacing(8);
   this.sizer.add(buttonSizer);

   this.adjustToContents();
}

SettingsDialog.prototype = new Dialog;

//============================================================================
// 一時 FITS 保存
//============================================================================

function saveImageToFits(window, filepath) {
   var fitsFormat = new FileFormat("FITS", false/*toRead*/, true/*toWrite*/);
   var writer = new FileFormatInstance(fitsFormat);
   if (!writer.create(filepath))
      throw new Error("一時 FITS ファイルの作成に失敗: " + filepath);

   // FITSキーワードをコピー（メタデータ保持）
   writer.keywords = window.keywords;

   var imgDesc = new ImageDescription;
   imgDesc.bitsPerSample = 32;
   imgDesc.ieeefpSampleFormat = true;
   if (!writer.setOptions(imgDesc))
      throw new Error("画像オプション設定に失敗");
   if (!writer.writeImage(window.mainView.image))
      throw new Error("画像データの書き込みに失敗");
   writer.close();
}

//============================================================================
// メイン実行
//============================================================================

function main() {
   // 1. アクティブ画像チェック
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
   console.writeln("Image: " + window.mainView.id +
      " (" + image.width + " x " + image.height + " px)");

   // 2. 設定ロード + 検証
   var params = new ManualSolverParameters();
   params.load();

   // 未設定、またはパスが無効な場合はダイアログ表示
   var needSettings = !params.isConfigured();
   if (!needSettings) {
      // 保存済み設定の検証
      var mainPy = params.scriptDir + "/python/main.py";
      if (!File.exists(params.pythonPath) || !File.exists(mainPy)) {
         console.warningln("保存済みの設定パスが無効です。設定ダイアログを表示します。");
         needSettings = true;
      }
   }

   if (needSettings) {
      console.writeln("Python パスとスクリプトディレクトリを設定してください。");
      var settingsDlg = new SettingsDialog(params);
      if (!settingsDlg.execute()) {
         console.writeln("設定がキャンセルされました。");
         return;
      }
      params.save();
   }

   console.writeln("Python: " + params.pythonPath);
   console.writeln("Script: " + params.scriptDir);

   // 3. アクティブ画像を一時 FITS に保存
   var tempInput = File.systemTempDirectory + "/manual_solver_input.fits";
   var tempOutput = File.systemTempDirectory + "/manual_solver_output.wcs.json";

   // 既存の一時ファイルを削除
   if (File.exists(tempInput)) {
      try { File.remove(tempInput); } catch (e) {}
   }
   if (File.exists(tempOutput)) {
      try { File.remove(tempOutput); } catch (e) {}
   }

   console.writeln("一時 FITS に保存中...");
   try {
      saveImageToFits(window, tempInput);
   } catch (e) {
      var mb = new MessageBox("一時ファイル保存に失敗:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }
   console.writeln("保存完了: " + tempInput);

   // 4. Python GUI 起動（ExternalProcess）
   var scriptPath = params.scriptDir + "/python/main.py";
   var pythonDir = File.extractDirectory(params.pythonPath);
   var pathPrefix = "export PATH="
      + quotePath(pythonDir)
      + ":/opt/homebrew/bin:/usr/local/bin:$PATH; ";

   // PYTHONPATH をスクリプトの python/ ディレクトリに設定
   var pythonPathEnv = "export PYTHONPATH="
      + quotePath(params.scriptDir + "/python")
      + ":$PYTHONPATH; ";

   var stderrFile = File.systemTempDirectory + "/manual_solver_stderr.log";

   // 前回の JSON が存在するなら --restore オプションを追加
   var restoreJson = params.lastWcsJson;
   var useRestore = false;
   if (restoreJson && restoreJson.length > 0 && File.exists(restoreJson)) {
      var mb = new MessageBox(
         "前回のセッションの星ペア情報があります。\n復元しますか？",
         TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         useRestore = true;
      }
   }

   var shellCmd = pathPrefix + pythonPathEnv
      + quotePath(params.pythonPath) + " "
      + quotePath(scriptPath)
      + " --input " + quotePath(tempInput)
      + " --output " + quotePath(tempOutput);

   if (useRestore) {
      shellCmd += " --restore " + quotePath(restoreJson);
   }

   shellCmd += " 2> " + quotePath(stderrFile);

   console.writeln("Python GUI を起動中...");
   console.writeln("Command: " + shellCmd);

   var P = new ExternalProcess;
   P.workingDirectory = params.scriptDir;
   P.start("/bin/sh", ["-c", shellCmd]);

   // 5. ポーリングループで完了待ち
   console.abortEnabled = true;
   console.writeln("");
   console.writeln("<b>Python GUI で星の選択と Solve を行ってください。</b>");
   console.writeln("Process Console の <b>Abort</b> ボタンでキャンセルできます。");
   console.flush();

   var timeoutMs = 60 * 60 * 1000; // 1時間（手動操作のため長め）
   var pollIntervalMs = 500;
   var elapsed = 0;
   var aborted = false;
   var lastStderrSize = 0;

   while (elapsed < timeoutMs) {
      if (P.waitForFinished(pollIntervalMs)) {
         break;
      }

      processEvents();

      if (console.abortRequested) {
         console.writeln("");
         console.warningln("<b>ユーザーにより中止されました。プロセスを終了中...</b>");
         P.kill();
         aborted = true;
         break;
      }

      // stderr をリアルタイム表示
      try {
         if (File.exists(stderrFile)) {
            var currentStderr = File.readTextFile(stderrFile);
            if (currentStderr.length > lastStderrSize) {
               var newOutput = currentStderr.substring(lastStderrSize).trim();
               if (newOutput.length > 0) {
                  var newLines = newOutput.split("\n");
                  for (var li = 0; li < newLines.length; li++) {
                     console.writeln("[PYTHON] " + newLines[li]);
                  }
                  console.flush();
               }
               lastStderrSize = currentStderr.length;
            }
         }
      } catch (e) {
         // ファイル読み込み失敗は無視
      }

      elapsed += pollIntervalMs;
   }

   console.abortEnabled = false;

   // Abort 処理
   if (aborted) {
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e) {}
      try { if (File.exists(stderrFile)) File.remove(stderrFile); } catch (e) {}
      console.warningln("処理が中止されました。");
      return;
   }

   // タイムアウト処理
   if (elapsed >= timeoutMs && !P.waitForFinished(0)) {
      P.kill();
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e) {}
      try { if (File.exists(stderrFile)) File.remove(stderrFile); } catch (e) {}
      var mb = new MessageBox("タイムアウトしました（1時間）。",
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   // 残りの stderr を表示
   try {
      if (File.exists(stderrFile)) {
         var finalStderr = File.readTextFile(stderrFile);
         if (finalStderr.length > lastStderrSize) {
            var remaining = finalStderr.substring(lastStderrSize).trim();
            if (remaining.length > 0) {
               var lines = remaining.split("\n");
               for (var i = 0; i < lines.length; i++) {
                  console.writeln("[PYTHON] " + lines[i]);
               }
            }
         }
         File.remove(stderrFile);
      }
   } catch (e) {}

   console.writeln("");
   console.writeln("Python GUI 終了 (exit code: " + P.exitCode + ")");

   // 6. 終了コード判定
   if (P.exitCode !== 0) {
      // ユーザーキャンセル (exit code 1) またはエラー
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e) {}
      if (P.exitCode === 1) {
         console.writeln("ユーザーによりキャンセルされました。");
      } else {
         console.warningln("Python GUI がエラーで終了しました (exit code: " + P.exitCode + ")");
      }
      return;
   }

   // 7. JSON 結果読み込み + WCS 適用
   if (!File.exists(tempOutput)) {
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
      console.warningln("WCS JSON ファイルが見つかりません: " + tempOutput);
      return;
   }

   var jsonText;
   try {
      jsonText = File.readTextFile(tempOutput);
   } catch (e) {
      var mb = new MessageBox("JSON ファイルの読み込みに失敗:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e2) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e2) {}
      return;
   }

   var wcsData;
   try {
      wcsData = JSON.parse(jsonText);
   } catch (e) {
      var mb = new MessageBox("JSON の解析に失敗:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e2) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e2) {}
      return;
   }

   // バージョンチェック
   if (!wcsData.version || !wcsData.version.match(/^1\./)) {
      var mb = new MessageBox("未対応の WCS JSON バージョン: " + (wcsData.version || "不明"),
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e) {}
      return;
   }

   // WCSデータ検証
   if (!wcsData.wcs || wcsData.wcs.crval1 === undefined) {
      var mb = new MessageBox("WCS データが見つかりません。",
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
      try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e) {}
      return;
   }

   // フィット品質情報を表示
   if (wcsData.fit_quality) {
      var fq = wcsData.fit_quality;
      console.writeln("");
      console.writeln("<b>WCS フィット結果:</b>");
      if (fq.rms_arcsec !== undefined)
         console.writeln("  RMS: " + fq.rms_arcsec.toFixed(3) + " arcsec");
      if (fq.pixel_scale_arcsec !== undefined)
         console.writeln("  Pixel scale: " + fq.pixel_scale_arcsec.toFixed(3) + " arcsec/px");
      if (fq.num_stars !== undefined)
         console.writeln("  Stars: " + fq.num_stars);
   }

   // WCS を画像に適用
   console.writeln("");
   console.writeln("<b>WCS を画像に適用中...</b>");
   applyWCSFromJSON(window, wcsData);
   console.writeln("WCS を適用しました。");

   // 星ペア情報と画像座標を表示
   displayStarPairs(wcsData);
   displayImageCoordinates(wcsData, image.width, image.height);

   // 8. JSON を永続パスにコピーして Settings に保存（次回復元用）
   var lastJsonPath = File.systemTempDirectory + "/manual_solver_last.wcs.json";
   try {
      if (File.exists(lastJsonPath)) File.remove(lastJsonPath);
      File.copyFile(lastJsonPath, tempOutput);
      params.lastWcsJson = lastJsonPath;
      params.save();
   } catch (e) {
      // コピー失敗は無視（次回復元が使えないだけ）
   }

   // 9. 一時ファイル削除
   try { if (File.exists(tempInput)) File.remove(tempInput); } catch (e) {}
   try { if (File.exists(tempOutput)) File.remove(tempOutput); } catch (e) {}

   // 成功メッセージ
   var successMsg = "WCS を正常に適用しました。";
   if (wcsData.fit_quality) {
      var fq = wcsData.fit_quality;
      if (fq.rms_arcsec !== undefined)
         successMsg += "\n\nRMS: " + fq.rms_arcsec.toFixed(3) + " arcsec";
      if (fq.pixel_scale_arcsec !== undefined)
         successMsg += "\nPixel scale: " + fq.pixel_scale_arcsec.toFixed(3) + " arcsec/px";
      if (fq.num_stars !== undefined)
         successMsg += "\nStars: " + fq.num_stars;
   }

   console.writeln("");
   console.writeln("<b>" + successMsg.replace(/\n/g, "</b>\n<b>") + "</b>");

   var mb = new MessageBox(successMsg, TITLE, StdIcon_Information, StdButton_Ok);
   mb.execute();
}

main();
