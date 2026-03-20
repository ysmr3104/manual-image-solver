#feature-id    ManualImageSolver : Astrometry > ManualImageSolver
#feature-info  Manual plate solver: interactively identify stars in a PJSR dialog \
   and compute a TAN-projection WCS solution, then apply it to the active image.

//----------------------------------------------------------------------------
// ManualImageSolver.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Manual Image Solver: Manually identify stars in a native PJSR Dialog,
// compute a TAN-projection WCS, and apply it to the active image.
//
// Copyright (c) 2026 Manual Image Solver Project
//----------------------------------------------------------------------------

#define VERSION "1.4.0"

#include <pjsr/DataType.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdCursor.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/Color.jsh>
#include <pjsr/PropertyType.jsh>
#include <pjsr/PropertyAttribute.jsh>

#include "wcs_math.js"
#include "wcs_keywords.js"
#include "catalog_data.js"

#define TITLE "Manual Image Solver"

// Maximum bitmap edge size (memory optimization)
#define MAX_BITMAP_EDGE 2048

//============================================================================
// Coordinate formatting and display functions
//============================================================================

// Convert RA (degrees) to "HH MM SS.ss" format
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

// Convert DEC (degrees) to "+DD MM SS.s" format
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

// Convert pixel coordinates to celestial coordinates (using WCS parameters)
function pixelToRaDec(wcs, px, py, imageHeight) {
   var u = (px + 1.0) - wcs.crpix1;
   var v = (imageHeight - py) - wcs.crpix2;
   var xi  = wcs.cd1_1 * u + wcs.cd1_2 * v;
   var eta = wcs.cd2_1 * u + wcs.cd2_2 * v;
   return tanDeproject([wcs.crval1, wcs.crval2], [xi, eta]);
}

// Display coordinates of image corners and center to the console
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

// Display star pair information to the console
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
// Coordinate parsing functions (ported from Python star_dialog.py)
//============================================================================

// Parse RA input (HMS "HH MM SS.ss" / "HH:MM:SS.ss" or degrees)
// On success: degrees (0-360), on failure: null
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

// Parse DEC input (DMS "+/-DD MM SS.ss" / "+/-DD:MM:SS.ss" or degrees)
// On success: degrees (-90 to +90), on failure: null
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
// WCS application function
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

   // Write image center RA/DEC as OBJCTRA/OBJCTDEC
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

   // Write PCL:AstrometricSolution properties required by SPFC and other tools.
   var view = targetWindow.mainView;
   var attrs = PropertyAttribute_Storable | PropertyAttribute_Permanent;

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
   var refCelestial = new Vector([wcsResult.crval1, wcsResult.crval2]);
   view.setPropertyValue("PCL:AstrometricSolution:ReferenceCelestialCoordinates", refCelestial, PropertyType_F64Vector, attrs);

   // Reference image coordinates (I-coordinates: 0-based x, bottom-up y)
   var refImgX = wcsResult.crpix1 - 1;
   var refImgY = wcsResult.crpix2;
   var refImage = new Vector([refImgX, refImgY]);
   view.setPropertyValue("PCL:AstrometricSolution:ReferenceImageCoordinates", refImage, PropertyType_F64Vector, attrs);

   // Linear transformation matrix (CD matrix)
   var ltMatrix = new Matrix(2, 2);
   ltMatrix.at(0, 0, wcsResult.cd[0][0]);
   ltMatrix.at(0, 1, wcsResult.cd[0][1]);
   ltMatrix.at(1, 0, wcsResult.cd[1][0]);
   ltMatrix.at(1, 1, wcsResult.cd[1][1]);
   view.setPropertyValue("PCL:AstrometricSolution:LinearTransformationMatrix", ltMatrix, PropertyType_F64Matrix, attrs);

   // Native coordinates of the reference point (TAN: 0, 90)
   var refNative = new Vector([0, 90]);
   view.setPropertyValue("PCL:AstrometricSolution:ReferenceNativeCoordinates", refNative, PropertyType_F64Vector, attrs);

   // Celestial pole native coordinates
   var plon = (wcsResult.crval2 < 90) ? 180 : 0;
   var celestialPole = new Vector([plon, 90]);
   view.setPropertyValue("PCL:AstrometricSolution:CelestialPoleNativeCoordinates", celestialPole, PropertyType_F64Vector, attrs);

   // Observation center coordinates
   view.setPropertyValue("Observation:Center:RA", imgCenter[0], PropertyType_Float64, attrs);
   view.setPropertyValue("Observation:Center:Dec", imgCenter[1], PropertyType_Float64, attrs);
   view.setPropertyValue("Observation:CelestialReferenceSystem", "ICRS", PropertyType_String8, attrs);
   view.setPropertyValue("Observation:Equinox", 2000.0, PropertyType_Float64, attrs);

   // Creation metadata
   view.setPropertyValue("PCL:AstrometricSolution:CreationTime", (new Date).toISOString(), PropertyType_TimePoint, attrs);
   var creatorApp = format("PixInsight %s%d.%d.%d",
      CoreApplication.versionLE ? "LE " : "",
      CoreApplication.versionMajor,
      CoreApplication.versionMinor,
      CoreApplication.versionRelease);
   view.setPropertyValue("PCL:AstrometricSolution:CreatorApplication", creatorApp, PropertyType_String, attrs);
   view.setPropertyValue("PCL:AstrometricSolution:CreatorModule", "ManualImageSolver " + VERSION, PropertyType_String, attrs);

   // NOTE: Do NOT call regenerateAstrometricSolution() here.
   // The caller (doApply) writes spline control points first, then regenerates.
}

//----------------------------------------------------------------------------
// 制御点直接設定（星点のみ方式）
//
// WCSFitter は FITS 座標系 (y-up) で CD 行列を計算するが、PixInsight の
// regenerateAstrometricSolution() は CD 行列を PixInsight 座標系 (y-down) で
// そのまま適用するため、画像が上下反転する場合がある。
// 制御点を直接書き込むことで、PixInsight ピクセル座標 → gnomonic 座標の
// 正しいマッピングを保証し、regenerateAstrometricSolution() の Y 軸解釈に
// 依存しない。
//
// 旧版 ManualImageSolver（Andrés del Pozo版）と同様に星点のみを制御点として使用。
// smoothness: SplineWorldTransformation の平滑化係数 (0 = 完全補間)
//----------------------------------------------------------------------------
function setCustomControlPoints(window, wcsResult, starPairs, imageWidth, imageHeight, smoothness) {
   if (typeof smoothness === "undefined" || smoothness === null) smoothness = 0;

   var view = window.mainView;
   var crval = [wcsResult.crval1, wcsResult.crval2];

   var starPoints = [];
   for (var i = 0; i < starPairs.length; i++) {
      var proj = tanProject(crval, [starPairs[i].ra, starPairs[i].dec]);
      if (proj) {
         starPoints.push({ px: starPairs[i].px, py: starPairs[i].py,
                           xi: proj[0], eta: proj[1] });
      }
   }

   var nTotal = starPoints.length;
   var cI = new Vector(nTotal * 2);
   var cW = new Vector(nTotal * 2);
   for (var i = 0; i < nTotal; i++) {
      cI.at(i * 2,     starPoints[i].px);
      cI.at(i * 2 + 1, starPoints[i].py);
      cW.at(i * 2,     starPoints[i].xi);
      cW.at(i * 2 + 1, starPoints[i].eta);
   }

   var attrs = PropertyAttribute_Storable | PropertyAttribute_Permanent;
   var prefix = "PCL:AstrometricSolution:SplineWorldTransformation:";
   view.setPropertyValue(prefix + "RBFType", "ThinPlateSpline", PropertyType_String8, attrs);
   view.setPropertyValue(prefix + "SplineOrder", 2, PropertyType_Int32, attrs);
   view.setPropertyValue(prefix + "SplineSmoothness", smoothness, PropertyType_Float32, attrs);
   view.setPropertyValue(prefix + "MaxSplinePoints", nTotal, PropertyType_Int32, attrs);
   view.setPropertyValue(prefix + "UseSimplifiers", false, PropertyType_Boolean, attrs);
   view.setPropertyValue(prefix + "SimplifierRejectFraction", 0.10, PropertyType_Float32, attrs);
   view.setPropertyValue(prefix + "ControlPoints:Image", cI, PropertyType_F64Vector, attrs);
   view.setPropertyValue(prefix + "ControlPoints:World", cW, PropertyType_F64Vector, attrs);

   console.writeln("  SplineWT control points: " + nTotal + " stars (smoothness=" + smoothness.toFixed(4) + ")");
}

//============================================================================
// Sesame object name search (ExternalProcess + curl)
//============================================================================

function searchObjectCoordinates(objectName) {
   var encoded = objectName.replace(/ /g, "+");
   var url = "http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?" + encoded;
   var tmpFile = File.systemTempDirectory + "/sesame_query.txt";

   var P = new ExternalProcess;
   P.start("curl", ["-s", "-o", tmpFile, "-m", "10", url]);
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
// Auto stretch (MTF-based) + Bitmap generation
//============================================================================

// PixInsight STF method: median + MAD based MTF parameter computation
// channel: channel number for statistics (default 0)
function computeAutoSTF(image, channel) {
   if (typeof channel === "undefined") channel = 0;
   // Get statistics for the specified channel (using selectedChannel)
   var savedChannel = image.selectedChannel;
   image.selectedChannel = channel;
   var median = image.median();

   // Get MAD (may not be implemented in some PJSR versions)
   var mad;
   try {
      mad = image.MAD();
   } catch (e) {
      // Approximate MAD with avgDev * 1.4826 if MAD is not implemented
      mad = image.avgDev() * 1.4826;
   }
   image.selectedChannel = savedChannel;

   // Fallback for uniform images where MAD is 0
   if (mad === 0 || mad < 1e-15) {
      return { shadowClip: 0.0, midtone: 0.5 };
   }

   // STF parameters (PixInsight defaults)
   var targetMedian = 0.25;    // Target median
   var shadowClipK = -2.8;     // Shadow clipping coefficient

   var shadow = median + shadowClipK * mad;
   if (shadow < 0) shadow = 0;

   // Midtone function parameter: map median to targetMedian after stretch
   var normalizedMedian = (median - shadow) / (1.0 - shadow);
   if (normalizedMedian <= 0) normalizedMedian = 1e-6;
   if (normalizedMedian >= 1) normalizedMedian = 1 - 1e-6;

   // Compute MTF parameter m: MTF(m, normalizedMedian) = targetMedian
   // m = (targetMedian - 1) * normalizedMedian / ((2*targetMedian - 1) * normalizedMedian - targetMedian)
   var m = (targetMedian - 1.0) * normalizedMedian /
           ((2.0 * targetMedian - 1.0) * normalizedMedian - targetMedian);
   if (m < 0) m = 0;
   if (m > 1) m = 1;

   return { shadowClip: shadow, midtone: m };
}

// Midtones Transfer Function (MTF)
function midtonesTransferFunction(m, x) {
   if (x <= 0) return 0;
   if (x >= 1) return 1;
   if (m === 0) return 0;
   if (m === 1) return 1;
   if (m === 0.5) return x;
   return ((m - 1.0) * x) / ((2.0 * m - 1.0) * x - m);
}

// Generate a stretched Bitmap from the image
// maxEdge: maximum edge size (0 = no limit)
// stretchMode: "none" / "linked" / "unlinked" (default "linked")
function createStretchedBitmap(image, maxEdge, stretchMode) {
   if (typeof maxEdge === "undefined") maxEdge = MAX_BITMAP_EDGE;
   if (typeof stretchMode === "undefined") stretchMode = "linked";

   var w = image.width;
   var h = image.height;

   // Compute scale factor
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

   // Compute STF parameters (per mode)
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
      // For monochrome, same as linked
      stfR = computeAutoSTF(image, 0);
      stfG = stfR;
      stfB = stfR;
   }
   // When stretchMode === "none", STF is not needed

   // Build bitmap directly
   var bmp = new Bitmap(bmpW, bmpH);

   for (var by = 0; by < bmpH; by++) {
      for (var bx = 0; bx < bmpW; bx++) {
         // Bitmap coordinates -> original image coordinates
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
            // Linear mapping: directly convert to 0-255
            r = Math.max(0, Math.min(1, r));
            g = Math.max(0, Math.min(1, g));
            b = Math.max(0, Math.min(1, b));
         } else {
            // Shadow clip + normalize + MTF (per-channel STF)
            r = (r - stfR.shadowClip) / (1.0 - stfR.shadowClip);
            g = (g - stfG.shadowClip) / (1.0 - stfG.shadowClip);
            b = (b - stfB.shadowClip) / (1.0 - stfB.shadowClip);

            r = midtonesTransferFunction(stfR.midtone, Math.max(0, Math.min(1, r)));
            g = midtonesTransferFunction(stfG.midtone, Math.max(0, Math.min(1, g)));
            b = midtonesTransferFunction(stfB.midtone, Math.max(0, Math.min(1, b)));
         }

         // Convert to 8-bit and set bitmap pixel
         var ri = Math.round(r * 255);
         var gi = Math.round(g * 255);
         var bi = Math.round(b * 255);
         // ARGB format: 0xAARRGGBB
         bmp.setPixel(bx, by, 0xFF000000 | (ri << 16) | (gi << 8) | bi);
      }
   }

   return { bitmap: bmp, scale: scale, width: bmpW, height: bmpH };
}

// Rotate a Bitmap by 0/90/180/270 degrees CW
function rotateBitmap(bitmap, angle) {
   if (angle === 0 || angle === undefined) return bitmap;

   var w = bitmap.width;
   var h = bitmap.height;
   var rotBmp;

   if (angle === 90) {
      rotBmp = new Bitmap(h, w);
      for (var y = 0; y < h; y++)
         for (var x = 0; x < w; x++)
            rotBmp.setPixel(h - 1 - y, x, bitmap.pixel(x, y));
   } else if (angle === 180) {
      rotBmp = new Bitmap(w, h);
      for (var y = 0; y < h; y++)
         for (var x = 0; x < w; x++)
            rotBmp.setPixel(w - 1 - x, h - 1 - y, bitmap.pixel(x, y));
   } else if (angle === 270) {
      rotBmp = new Bitmap(h, w);
      for (var y = 0; y < h; y++)
         for (var x = 0; x < w; x++)
            rotBmp.setPixel(y, w - 1 - x, bitmap.pixel(x, y));
   } else {
      return bitmap;
   }

   return rotBmp;
}

//============================================================================
// ImagePreviewControl: Image display + zoom/pan/click
//
// Manages scroll state internally rather than relying on ScrollBox.
// - this.scrollX / this.scrollY: content offset (manually managed)
// - Scrollbars set explicitly via setHorizontalScrollRange / setVerticalScrollRange
// - onPaint draws with offset applied
//============================================================================

function ImagePreviewControl(parent) {
   this.__base__ = ScrollBox;
   this.__base__(parent);

   this.bitmap = null;        // Stretched bitmap (original, unrotated)
   this.displayBitmap = null; // Rotated bitmap for display
   this.rotationAngle = 0;   // Display rotation: 0, 90, 180, 270 (CW)
   this.bitmapScale = 1.0;    // Original image -> bitmap scale factor
   this.zoomLevel = 1.0;      // Display zoom level
   this.starMarkers = [];     // [{imgX, imgY, index}]
   this.selectedIndex = -1;   // Currently selected marker index
   this.pendingMarker = null; // {imgX, imgY} for pending catalog selection
   this.onImageClick = null;  // Callback: function(imgX, imgY)

   // Manual scroll management
   this.scrollX = 0;
   this.scrollY = 0;
   this.maxScrollX = 0;
   this.maxScrollY = 0;

   // Drag/click detection
   this.isDragging = false;    // Mouse button is held down
   this.hasMoved = false;      // Whether drag threshold has been exceeded
   this.dragStartX = 0;
   this.dragStartY = 0;
   this.panScrollX = 0;
   this.panScrollY = 0;

   // Available zoom levels
   this.zoomLevels = [
      0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 0.75,
      1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0
   ];
   this.zoomIndex = 9; // Initial = 1.0

   this.autoScrolls = false; // Disabled in favor of manual management

   var self = this;

   this.viewport.cursor = new Cursor(StdCursor_Arrow);

   // --- Scrollbar events ---
   this.onHorizontalScrollPosUpdated = function (pos) {
      self.scrollX = pos;
      self.viewport.update();
   };
   this.onVerticalScrollPosUpdated = function (pos) {
      self.scrollY = pos;
      self.viewport.update();
   };

   // --- Paint ---
   this.viewport.onPaint = function () {
      var g = new Graphics(this);
      g.fillRect(this.boundsRect, new Brush(0xFF202020));

      var dbmp = self.displayBitmap || self.bitmap;
      if (dbmp) {
         var dispW = Math.round(dbmp.width * self.zoomLevel);
         var dispH = Math.round(dbmp.height * self.zoomLevel);

         // Draw with scroll offset
         g.drawScaledBitmap(
            new Rect(-self.scrollX, -self.scrollY,
                     dispW - self.scrollX, dispH - self.scrollY),
            dbmp);

         // Draw candidate star markers (orange crosses, drawn before registered markers)
         if (self.candidateMarkers) {
            var viewW = this.width;
            var viewH = this.height;
            for (var ci = 0; ci < self.candidateMarkers.length; ci++) {
               var cm = self.candidateMarkers[ci];
               var dp = self.imageToDisplay(cm.px, cm.py);
               var cvx = dp.x * self.zoomLevel - self.scrollX;
               var cvy = dp.y * self.zoomLevel - self.scrollY;
               if (cvx < -20 || cvy < -20 || cvx > viewW + 20 || cvy > viewH + 20) continue;
               g.pen = new Pen(0xCCFF8C00, 1.0);
               var cr = 6;
               g.drawLine(cvx - cr, cvy, cvx + cr, cvy);
               g.drawLine(cvx, cvy - cr, cvx, cvy + cr);
               g.pen = new Pen(0xAAFF8C00);
               g.font = new Font("Helvetica", 8);
               g.drawText(cvx + 8, cvy - 2, cm.label);
            }
         }

         // Draw markers
         for (var i = 0; i < self.starMarkers.length; i++) {
            var mk = self.starMarkers[i];
            // Image coords -> rotated display coords -> screen coords
            var rp = self.imageToDisplay(mk.imgX, mk.imgY);
            var vx = rp.x * self.zoomLevel - self.scrollX;
            var vy = rp.y * self.zoomLevel - self.scrollY;

            var isSelected = (i === self.selectedIndex);
            var circleR = isSelected ? 14 : 12;
            var crossR = isSelected ? 8 : 6;

            // Green circle
            g.pen = new Pen(isSelected ? 0xFFFFFF00 : 0xB300FF00, isSelected ? 2 : 1.5);
            g.drawCircle(vx, vy, circleR);

            // Red crosshair
            g.pen = new Pen(0xCCFF0000, 1.5);
            g.drawLine(vx - crossR, vy, vx + crossR, vy);
            g.drawLine(vx, vy - crossR, vx, vy + crossR);

            // Number label
            g.pen = new Pen(0xE6FFFF00);
            g.font = new Font("Helvetica", 9);
            g.drawText(vx + circleR + 2, vy - circleR + 2, "" + (i + 1));
         }

         // Draw pending click marker (cyan dashed circle)
         if (self.pendingMarker) {
            var pp = self.imageToDisplay(self.pendingMarker.imgX, self.pendingMarker.imgY);
            var pvx = pp.x * self.zoomLevel - self.scrollX;
            var pvy = pp.y * self.zoomLevel - self.scrollY;

            g.pen = new Pen(0xFF00FFFF, 2);  // Cyan
            g.drawCircle(pvx, pvy, 16);

            // Crosshair
            g.pen = new Pen(0xCC00FFFF, 1.5);
            g.drawLine(pvx - 10, pvy, pvx + 10, pvy);
            g.drawLine(pvx, pvy - 10, pvx, pvy + 10);

            g.pen = new Pen(0xE600FFFF);
            g.font = new Font("Helvetica", 9);
            g.drawText(pvx + 18, pvy - 14, "?");
         }
      }

      g.end();
   };

   // --- Mouse events ---
   // Left click = star selection, left drag = pan, middle button drag = pan
   #define DRAG_THRESHOLD 4

   this.viewport.onMousePress = function (x, y, button, buttonState, modifiers) {
      if (!self.bitmap) return;

      if (button === 1 || button === 4) {
         self.isDragging = true;
         self.hasMoved = false;
         self.dragStartX = x;
         self.dragStartY = y;
         self.panScrollX = self.scrollX;
         self.panScrollY = self.scrollY;
      }
   };

   this.viewport.onMouseMove = function (x, y, buttonState, modifiers) {
      if (!self.isDragging) return;

      var dx = x - self.dragStartX;
      var dy = y - self.dragStartY;

      // Start drag (pan) once threshold is exceeded
      if (!self.hasMoved) {
         if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
            self.hasMoved = true;
            self.viewport.cursor = new Cursor(StdCursor_ClosedHand);
         }
      }

      if (self.hasMoved) {
         self.setScroll(self.panScrollX - dx, self.panScrollY - dy);
      }
   };

   this.viewport.onMouseRelease = function (x, y, button, buttonState, modifiers) {
      if (!self.isDragging) return;

      if (!self.hasMoved && button === 1) {
         // Click (no movement) -> star selection
         // Screen coords -> rotated bitmap coords -> original image coords
         var rx = (x + self.scrollX) / self.zoomLevel;
         var ry = (y + self.scrollY) / self.zoomLevel;
         var imgCoord = self.displayToImage(rx, ry);
         var imgX = imgCoord.x;
         var imgY = imgCoord.y;

         if (self.onImageClick) {
            self.onImageClick(imgX, imgY);
         }
      }

      self.isDragging = false;
      self.hasMoved = false;
      self.viewport.cursor = new Cursor(StdCursor_Arrow);
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

      // Zoom centered on mouse position
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

// Convert original image coords to rotated display bitmap coords (continuous)
ImagePreviewControl.prototype.imageToDisplay = function (imgX, imgY) {
   var bx = imgX * this.bitmapScale;
   var by = imgY * this.bitmapScale;
   var bmpW = this.bitmap.width;
   var bmpH = this.bitmap.height;
   switch (this.rotationAngle) {
      case 90:  return { x: bmpH - by, y: bx };
      case 180: return { x: bmpW - bx, y: bmpH - by };
      case 270: return { x: by, y: bmpW - bx };
      default:  return { x: bx, y: by };
   }
};

// Convert rotated display bitmap coords to original image coords (continuous)
ImagePreviewControl.prototype.displayToImage = function (rx, ry) {
   var bx, by;
   var bmpW = this.bitmap.width;
   var bmpH = this.bitmap.height;
   switch (this.rotationAngle) {
      case 90:  bx = ry; by = bmpH - rx; break;
      case 180: bx = bmpW - rx; by = bmpH - ry; break;
      case 270: bx = bmpW - ry; by = rx; break;
      default:  bx = rx; by = ry; break;
   }
   return { x: bx / this.bitmapScale, y: by / this.bitmapScale };
};

// Set display rotation (0, 90, 180, 270) and rebuild display bitmap
ImagePreviewControl.prototype.setRotation = function (angle) {
   this.rotationAngle = angle % 360;
   if (this.bitmap) {
      this.displayBitmap = rotateBitmap(this.bitmap, this.rotationAngle);
      this.scrollX = 0;
      this.scrollY = 0;
      this.updateViewport();
   }
};

// Clamp scroll position, sync scrollbars, and repaint
ImagePreviewControl.prototype.setScroll = function (x, y) {
   this.scrollX = Math.max(0, Math.min(this.maxScrollX, Math.round(x)));
   this.scrollY = Math.max(0, Math.min(this.maxScrollY, Math.round(y)));
   // Sync scrollbars
   this.horizontalScrollPosition = this.scrollX;
   this.verticalScrollPosition = this.scrollY;
   this.viewport.update();
};

ImagePreviewControl.prototype.setBitmap = function (bitmapResult) {
   this.bitmap = bitmapResult.bitmap;
   this.bitmapScale = bitmapResult.scale;
   this.displayBitmap = rotateBitmap(this.bitmap, this.rotationAngle);
   this.scrollX = 0;
   this.scrollY = 0;
   this.updateViewport();
};

ImagePreviewControl.prototype.updateViewport = function () {
   var dbmp = this.displayBitmap || this.bitmap;
   if (!dbmp) return;
   var dispW = Math.round(dbmp.width * this.zoomLevel);
   var dispH = Math.round(dbmp.height * this.zoomLevel);

   // Visible area size
   var viewW = this.viewport.width;
   var viewH = this.viewport.height;
   if (viewW <= 0) viewW = this.width;
   if (viewH <= 0) viewH = this.height;

   // Scroll range
   this.maxScrollX = Math.max(0, dispW - viewW);
   this.maxScrollY = Math.max(0, dispH - viewH);

   // Clamp
   this.scrollX = Math.max(0, Math.min(this.maxScrollX, this.scrollX));
   this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY));

   // Scrollbar setup
   this.setHorizontalScrollRange(0, this.maxScrollX);
   this.setVerticalScrollRange(0, this.maxScrollY);
   this.horizontalScrollPosition = this.scrollX;
   this.verticalScrollPosition = this.scrollY;

   this.viewport.update();
};

ImagePreviewControl.prototype.fitToWindow = function () {
   var dbmp = this.displayBitmap || this.bitmap;
   if (!dbmp) return;
   var viewW = this.viewport.width;
   var viewH = this.viewport.height;
   if (viewW <= 0) viewW = this.width;
   if (viewH <= 0) viewH = this.height;
   if (viewW <= 0 || viewH <= 0) return;

   var zx = viewW / dbmp.width;
   var zy = viewH / dbmp.height;
   var fitZoom = Math.min(zx, zy);

   this.zoomLevel = fitZoom;
   this.zoomIndex = this.findNearestZoomIndex(fitZoom);
   this.scrollX = 0;
   this.scrollY = 0;
   this.updateViewport();
};

// Return the zoomIndex nearest to the specified zoom level
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

// Zoom centered on the viewport center
ImagePreviewControl.prototype.zoomAroundCenter = function (newZoom) {
   var oldZoom = this.zoomLevel;
   if (Math.abs(oldZoom - newZoom) < 1e-9) return;

   var viewW = this.viewport.width;
   var viewH = this.viewport.height;
   if (viewW <= 0) viewW = this.width;
   if (viewH <= 0) viewH = this.height;

   // Content coordinates of the current display center
   var centerX = this.scrollX + viewW / 2.0;
   var centerY = this.scrollY + viewH / 2.0;

   // Center coordinates at the new zoom level
   var factor = newZoom / oldZoom;
   this.scrollX = Math.round(centerX * factor - viewW / 2.0);
   this.scrollY = Math.round(centerY * factor - viewH / 2.0);

   this.zoomLevel = newZoom;
   this.updateViewport(); // Clamp + scrollbar update + repaint
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

//============================================================================
// StarEditDialog: Star coordinate entry sub-dialog
//============================================================================

function StarEditDialog(parent, starIndex, starData) {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;
   this.starData = starData || { px: 0, py: 0, ra: null, dec: null, name: "" };

   this.windowTitle = "Reference Star #" + starIndex;
   this.minWidth = 440;

   // --- Pixel coordinate display ---
   var pixelLabel = new Label(this);
   pixelLabel.text = "Pixel:  X = " + this.starData.px.toFixed(2)
                   + "    Y = " + this.starData.py.toFixed(2);
   pixelLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   // --- Object name + search ---
   var nameLabel = new Label(this);
   nameLabel.text = "Name:";
   nameLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   nameLabel.setFixedWidth(60);

   this.nameEdit = new Edit(this);
   this.nameEdit.text = this.starData.name || "";
   this.nameEdit.toolTip = "Enter object name and Search (e.g., Sirius, Vega, M42)";

   this.searchButton = new PushButton(this);
   this.searchButton.text = "Search";
   this.searchButton.toolTip = "Search coordinates by name via CDS Sesame";
   this.searchButton.onClick = function () {
      var name = self.nameEdit.text.trim();
      if (name.length === 0) {
         var mb = new MessageBox("Please enter an object name.",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      console.writeln("Sesame search: " + name + " ...");
      console.flush();
      var result = searchObjectCoordinates(name);
      if (result) {
         self.raEdit.text = raToHMS(result.ra);
         self.decEdit.text = decToDMS(result.dec);
         console.writeln("  → RA=" + result.ra.toFixed(4) + ", DEC=" + result.dec.toFixed(4));
      } else {
         var mb = new MessageBox(
            "'" + name + "' not found.\nPlease enter RA/DEC manually.",
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
   this.raEdit.toolTip = "HH MM SS.ss / HH:MM:SS.ss / degrees";
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
   this.decEdit.toolTip = "+DD MM SS.s / +DD:MM:SS.s / degrees";
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
      // Validation
      var ra = parseRAInput(self.raEdit.text);
      var dec = parseDECInput(self.decEdit.text);

      if (ra === null || dec === null) {
         var mb = new MessageBox("Please enter valid RA and DEC values.",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      if (ra < 0 || ra >= 360) {
         var mb = new MessageBox("RA must be in the range 0 to 360 degrees.",
            TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      if (dec < -90 || dec > 90) {
         var mb = new MessageBox("DEC must be in the range -90 to +90 degrees.",
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
// ManualSolverDialog: Main dialog
//============================================================================

function ManualSolverDialog(targetWindow) {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;
   this.targetWindow = targetWindow;
   this.image = targetWindow.mainView.image;
   this.starPairs = [];      // [{px, py, ra, dec, name}]
   this.wcsResult = null;    // Result of WCSFitter.solve()
   this.stretchMode = "linked"; // "none" / "linked" / "unlinked"
   this.pendingClick = null;  // {px, py} awaiting catalog selection

   this.windowTitle = TITLE + " v" + VERSION;
   this.minWidth = 800;
   this.minHeight = 600;

   // --- Bitmap generation ---
   console.writeln("Generating stretched bitmap...");
   console.flush();
   var bmpResult = createStretchedBitmap(this.image, MAX_BITMAP_EDGE, this.stretchMode);
   console.writeln("  Bitmap: " + bmpResult.width + " x " + bmpResult.height
      + " (scale=" + bmpResult.scale.toFixed(3) + ")");

   // --- Toolbar ---
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
   this.zoomOutButton.text = "\u2212"; // Minus sign (U+2212)
   this.zoomOutButton.toolTip = "Zoom Out";
   this.zoomOutButton.onClick = function () {
      self.preview.zoomOut();
   };

   this.rotateCWButton = new PushButton(this);
   this.rotateCWButton.text = "\u21BB"; // Clockwise arrow (U+21BB)
   this.rotateCWButton.toolTip = "Rotate Display 90\u00B0 CW";
   this.rotateCWButton.onClick = function () {
      var newAngle = (self.preview.rotationAngle + 90) % 360;
      self.preview.setRotation(newAngle);
      self.preview.fitToWindow();
   };

   this.rotateCCWButton = new PushButton(this);
   this.rotateCCWButton.text = "\u21BA"; // Counter-clockwise arrow (U+21BA)
   this.rotateCCWButton.toolTip = "Rotate Display 90\u00B0 CCW";
   this.rotateCCWButton.onClick = function () {
      var newAngle = (self.preview.rotationAngle + 270) % 360;
      self.preview.setRotation(newAngle);
      self.preview.fitToWindow();
   };

   var stretchLabel = new Label(this);
   stretchLabel.text = "STF:";
   stretchLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.stretchNoneButton = new PushButton(this);
   this.stretchNoneButton.text = "None";
   this.stretchNoneButton.toolTip = "No stretch (linear)";
   this.stretchNoneButton.onClick = function () {
      if (self.stretchMode !== "none") {
         self.stretchMode = "none";
         self.updateStretchButtons();
         self.rebuildBitmap();
      }
   };

   this.stretchLinkedButton = new PushButton(this);
   this.stretchLinkedButton.text = "\u25B6Linked";  // Default: active
   this.stretchLinkedButton.toolTip = "Same stretch for all channels";
   this.stretchLinkedButton.onClick = function () {
      if (self.stretchMode !== "linked") {
         self.stretchMode = "linked";
         self.updateStretchButtons();
         self.rebuildBitmap();
      }
   };

   this.stretchUnlinkedButton = new PushButton(this);
   this.stretchUnlinkedButton.text = "Unlinked";
   this.stretchUnlinkedButton.toolTip = "Independent stretch per channel";
   this.stretchUnlinkedButton.onClick = function () {
      if (self.stretchMode !== "unlinked") {
         self.stretchMode = "unlinked";
         self.updateStretchButtons();
         self.rebuildBitmap();
      }
   };

   var toolbarSizer = new HorizontalSizer;
   toolbarSizer.spacing = 4;
   toolbarSizer.add(this.fitButton);
   toolbarSizer.add(this.zoom11Button);
   toolbarSizer.add(this.zoomInButton);
   toolbarSizer.add(this.zoomOutButton);
   toolbarSizer.addSpacing(8);
   toolbarSizer.add(this.rotateCCWButton);
   toolbarSizer.add(this.rotateCWButton);
   toolbarSizer.addSpacing(12);
   toolbarSizer.add(stretchLabel);
   toolbarSizer.add(this.stretchNoneButton);
   toolbarSizer.add(this.stretchLinkedButton);
   toolbarSizer.add(this.stretchUnlinkedButton);
   toolbarSizer.addStretch();

   // Catalog toggle button removed: catalog panel is always visible

   // --- ImagePreviewControl ---
   this.preview = new ImagePreviewControl(this);
   this.preview.setMinSize(400, 300);
   this.preview.setBitmap(bmpResult);

   this.preview.onImageClick = function (imgX, imgY) {
      self.onImageClicked(imgX, imgY);
   };

   // --- Catalog panel ---
   this.catalogPanel = new Control(this);
   this.catalogPanel.setMinWidth(250);

   var catCategoryLabel = new Label(this.catalogPanel);
   catCategoryLabel.text = "Category:";
   catCategoryLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.catalogCategoryCombo = new ComboBox(this.catalogPanel);
   this.catalogCategoryCombo.addItem("Navigation Stars");
   this.catalogCategoryCombo.addItem("Messier Objects");
   // Add each constellation sorted by abbreviation
   var conKeys = [];
   for (var k in CONSTELLATION_LINES) {
      if (CONSTELLATION_LINES.hasOwnProperty(k)) conKeys.push(k);
   }
   conKeys.sort();
   for (var ci = 0; ci < conKeys.length; ci++) {
      var ck = conKeys[ci];
      var conLabel = ck + " - " + CONSTELLATION_LINES[ck].name;
      if (CONSTELLATION_LINES[ck].nameJa) conLabel += " (" + CONSTELLATION_LINES[ck].nameJa + ")";
      this.catalogCategoryCombo.addItem(conLabel);
   }
   this.catalogCategoryCombo.onItemSelected = function () {
      self.buildCatalogList();
   };

   var catSearchLabel = new Label(this.catalogPanel);
   catSearchLabel.text = "Search:";
   catSearchLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.catalogSearchEdit = new Edit(this.catalogPanel);
   this.catalogSearchEdit.toolTip = "Filter by name (incremental search)";
   this.catalogSearchEdit.onTextUpdated = function () {
      self.buildCatalogList();
   };

   this.catalogTreeBox = new TreeBox(this.catalogPanel);
   this.catalogTreeBox.alternateRowColor = true;
   this.catalogTreeBox.headerVisible = true;
   this.catalogTreeBox.headerSorting = true;
   this.catalogTreeBox.numberOfColumns = 6;
   this.catalogTreeBox.setHeaderText(0, "#");
   this.catalogTreeBox.setHeaderText(1, "Name");
   this.catalogTreeBox.setHeaderText(2, "RA");
   this.catalogTreeBox.setHeaderText(3, "DEC");
   this.catalogTreeBox.setHeaderText(4, "Mag");
   this.catalogTreeBox.setHeaderText(5, "Category");
   this.catalogTreeBox.setColumnWidth(0, 55);
   this.catalogTreeBox.setColumnWidth(1, 100);
   this.catalogTreeBox.setColumnWidth(2, 48);
   this.catalogTreeBox.setColumnWidth(3, 52);
   this.catalogTreeBox.setColumnWidth(4, 48);
   this.catalogTreeBox.sort(0, true); // # ascending by default

   // Double-click catalog entry -> pair with pending click
   this.catalogTreeBox.onNodeDoubleClicked = function (node) {
      self.pairWithCatalogEntry(node);
   };

   var catCategorySizer = new HorizontalSizer;
   catCategorySizer.spacing = 4;
   catCategorySizer.add(catCategoryLabel);
   catCategorySizer.add(this.catalogCategoryCombo, 100);

   var catSearchSizer = new HorizontalSizer;
   catSearchSizer.spacing = 4;
   catSearchSizer.add(catSearchLabel);
   catSearchSizer.add(this.catalogSearchEdit, 100);

   this.manualEntryButton = new PushButton(this.catalogPanel);
   this.manualEntryButton.text = "Manual...";
   this.manualEntryButton.toolTip = "Open manual RA/DEC entry dialog for the pending star click";
   this.manualEntryButton.onClick = function () {
      self.manualEntryForPending();
   };

   var catButtonSizer = new HorizontalSizer;
   catButtonSizer.addStretch();
   catButtonSizer.add(this.manualEntryButton);

   // --- Candidate suggestion controls ---
   this.suggestCheckBox = new CheckBox(this.catalogPanel);
   this.suggestCheckBox.text = "Suggest";
   this.suggestCheckBox.checked = true;
   this.suggestCheckBox.toolTip = "Show candidate star markers on the image after solving";
   this.suggestCheckBox.onCheck = function () {
      self.updateCandidateStars();
   };

   var magLimitLabel = new Label(this.catalogPanel);
   magLimitLabel.text = "Mag \u2264";
   magLimitLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.magLimitSpinBox = new SpinBox(this.catalogPanel);
   this.magLimitSpinBox.minValue = 0;
   this.magLimitSpinBox.maxValue = 80;
   this.magLimitSpinBox.value = 30;
   this.magLimitSpinBox.toolTip = "Magnitude limit for candidate stars (x10, e.g. 30 = mag 3.0)";
   this.magLimitSpinBox.onValueUpdated = function () {
      self.updateCandidateStars();
   };

   var candidateSizer = new HorizontalSizer;
   candidateSizer.spacing = 4;
   candidateSizer.add(this.suggestCheckBox);
   candidateSizer.addSpacing(8);
   candidateSizer.add(magLimitLabel);
   candidateSizer.add(this.magLimitSpinBox);
   candidateSizer.addStretch();

   var catSizer = new VerticalSizer;
   catSizer.margin = 4;
   catSizer.spacing = 4;
   catSizer.add(catCategorySizer);
   catSizer.add(catSearchSizer);
   catSizer.add(candidateSizer);
   catSizer.add(this.catalogTreeBox, 100);
   catSizer.add(catButtonSizer);
   this.catalogPanel.sizer = catSizer;

   // --- Preview + Catalog horizontal layout ---
   // Preview gets stretch 100, catalog gets stretch 30
   // User can resize the dialog to give more space to catalog
   var previewAreaSizer = new HorizontalSizer;
   previewAreaSizer.spacing = 4;
   previewAreaSizer.add(this.preview, 100);
   previewAreaSizer.add(this.catalogPanel, 40);

   // --- Star table (TreeBox) ---
   var starTableLabel = new Label(this);
   starTableLabel.text = "Reference Stars (minimum 3):";

   var greekLegend = new Label(this);
   greekLegend.text = "\u03b1:Alp  \u03b2:Bet  \u03b3:Gam  \u03b4:Del  \u03b5:Eps  \u03b6:Zet  \u03b7:Eta  \u03b8:The  \u03b9:Iot  \u03ba:Kap  \u03bb:Lam  \u03bc:Mu  \u03bd:Nu  \u03be:Xi  \u03bf:Omi  \u03c0:Pi  \u03c1:Rho  \u03c3:Sig  \u03c4:Tau  \u03c5:Ups  \u03c6:Phi  \u03c7:Chi  \u03c8:Psi  \u03c9:Ome";
   greekLegend.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.starTreeBox = new TreeBox(this);
   this.starTreeBox.alternateRowColor = true;
   this.starTreeBox.headerVisible = true;
   this.starTreeBox.headerSorting = true;
   this.starTreeBox.numberOfColumns = 7;
   this.starTreeBox.setHeaderText(0, "#");
   this.starTreeBox.setHeaderText(1, "X");
   this.starTreeBox.setHeaderText(2, "Y");
   this.starTreeBox.setHeaderText(3, "Name");
   this.starTreeBox.setHeaderText(4, "RA");
   this.starTreeBox.setHeaderText(5, "DEC");
   this.starTreeBox.setHeaderText(6, "Residual");
   this.starTreeBox.setHeaderAlignment(0, TextAlign_Left | TextAlign_VertCenter);
   this.starTreeBox.setColumnWidth(0, 45);
   this.starTreeBox.setColumnWidth(1, 65);
   this.starTreeBox.setColumnWidth(2, 65);
   this.starTreeBox.setColumnWidth(3, 110);
   this.starTreeBox.setColumnWidth(4, 110);
   this.starTreeBox.setColumnWidth(5, 110);
   this.starTreeBox.setColumnWidth(6, 70);
   this.starTreeBox.setMinHeight(150);

   // TreeBox selection change -> highlight marker
   // After sorting, childIndex no longer matches starPairs index.
   // Use the "#" column (1-based original index) to resolve.
   this.starTreeBox.onCurrentNodeUpdated = function (node) {
      if (node) {
         self.preview.selectedIndex = parseInt(node.text(0), 10) - 1;
      } else {
         self.preview.selectedIndex = -1;
      }
      self.preview.viewport.update();
   };

   // TreeBox double-click -> edit
   this.starTreeBox.onNodeDoubleClicked = function (node, col) {
      var idx = parseInt(node.text(0), 10) - 1;
      if (idx >= 0 && idx < self.starPairs.length) {
         self.editStar(idx);
      }
   };

   // --- Star table buttons ---
   this.editStarButton = new PushButton(this);
   this.editStarButton.text = "Edit...";
   this.editStarButton.toolTip = "Edit selected star";
   this.editStarButton.onClick = function () {
      var node = self.starTreeBox.currentNode;
      if (!node) return;
      var idx = parseInt(node.text(0), 10) - 1;
      if (idx >= 0 && idx < self.starPairs.length) {
         self.editStar(idx);
      }
   };

   this.removeStarButton = new PushButton(this);
   this.removeStarButton.text = "Remove";
   this.removeStarButton.toolTip = "Remove selected star";
   this.removeStarButton.onClick = function () {
      var node = self.starTreeBox.currentNode;
      if (!node) return;
      var idx = parseInt(node.text(0), 10) - 1;
      if (idx >= 0 && idx < self.starPairs.length) {
         self.starPairs.splice(idx, 1);
         self.wcsResult = null;
         self.refreshAll();
      }
   };

   this.clearStarsButton = new PushButton(this);
   this.clearStarsButton.text = "Clear All";
   this.clearStarsButton.toolTip = "Remove all stars";
   this.clearStarsButton.onClick = function () {
      if (self.starPairs.length === 0) return;
      var mb = new MessageBox("Remove all stars?",
         TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         self.starPairs = [];
         self.wcsResult = null;
         self.refreshAll();
      }
   };

   this.exportButton = new PushButton(this);
   this.exportButton.text = "Export...";
   this.exportButton.toolTip = "Export star pair data to JSON file";
   this.exportButton.onClick = function () {
      self.doExport();
   };

   this.importButton = new PushButton(this);
   this.importButton.text = "Import...";
   this.importButton.toolTip = "Import star pair data from JSON file";
   this.importButton.onClick = function () {
      self.doImport();
   };

   var starButtonSizer = new HorizontalSizer;
   starButtonSizer.spacing = 4;
   starButtonSizer.add(this.editStarButton);
   starButtonSizer.add(this.removeStarButton);
   starButtonSizer.add(this.clearStarsButton);
   starButtonSizer.addSpacing(12);
   starButtonSizer.add(this.exportButton);
   starButtonSizer.add(this.importButton);
   starButtonSizer.addStretch();

   // --- Status label ---
   this.statusLabel = new Label(this);
   this.statusLabel.text = "Click on stars in the image to register them.";
   this.statusLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   // --- Main buttons ---
   this.solveButton = new PushButton(this);
   this.solveButton.text = "Solve";
   this.solveButton.icon = this.scaledResource(":/icons/ok.png");
   this.solveButton.toolTip = "Run WCS fitting (requires 4+ stars)";
   this.solveButton.onClick = function () {
      self.doSolve();
   };

   this.applyButton = new PushButton(this);
   this.applyButton.text = "Apply to Image";
   this.applyButton.icon = this.scaledResource(":/icons/execute.png");
   this.applyButton.toolTip = "Apply WCS to image";
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

   this.smoothnessControl = new NumericControl(this);
   this.smoothnessControl.label.text = "Smoothness:";
   this.smoothnessControl.label.minWidth = 80;
   this.smoothnessControl.setRange(0.0, 0.05);
   this.smoothnessControl.slider.setRange(0, 500);
   this.smoothnessControl.setPrecision(4);
   this.smoothnessControl.setValue(0.01);
   this.smoothnessControl.toolTip =
      "SplineWorldTransformation の平滑化係数。\n"
      + "0: 星点を完全補間（過適合リスクあり）。\n"
      + "0.01 〜 0.05: 誤差を吸収してなめらかな変換（推奨）。";

   this.smoothnessResetButton = new ToolButton(this);
   this.smoothnessResetButton.icon = this.scaledResource(":/process-interface/reset.png");
   this.smoothnessResetButton.setScaledFixedSize(24, 24);
   this.smoothnessResetButton.toolTip = "Smoothness をデフォルト値（0.01）に戻す";
   this.smoothnessResetButton.onClick = function() {
      self.smoothnessControl.setValue(0.01);
      self.suggestCheckBox.checked = true;
      self.magLimitSpinBox.value = 30;
   };

   var mainButtonSizer = new HorizontalSizer;
   mainButtonSizer.add(this.smoothnessControl);
   mainButtonSizer.addStretch();
   mainButtonSizer.spacing = 8;
   mainButtonSizer.add(this.solveButton);
   mainButtonSizer.add(this.applyButton);
   mainButtonSizer.add(this.closeButton);
   mainButtonSizer.addSpacing(8);
   mainButtonSizer.add(this.smoothnessResetButton);

   // --- Overall layout ---
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(toolbarSizer);
   this.sizer.add(previewAreaSizer, 100);
   this.sizer.add(starTableLabel);
   this.sizer.add(greekLegend);
   this.sizer.add(this.starTreeBox, 50);
   this.sizer.add(starButtonSizer);
   this.sizer.add(this.statusLabel);
   this.sizer.addSpacing(4);
   this.sizer.add(mainButtonSizer);

   this.userResizable = true;
   this.resize(1220, 800);

   // Initial display: fit to window (deferred execution)
   this.onShow = function () {
      self.preview.fitToWindow();
      self.buildCatalogList();
   };
}

ManualSolverDialog.prototype = new Dialog;

//----------------------------------------------------------------------------
// Image click handler
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.onImageClicked = function (imgX, imgY) {
   // Centroid computation
   var centroid = computeCentroid(this.image, imgX, imgY, 10);
   var cx = centroid ? centroid.x : imgX;
   var cy = centroid ? centroid.y : imgY;

   // Out-of-bounds check
   if (cx < 0 || cx >= this.image.width || cy < 0 || cy >= this.image.height) return;

   // Enter pending click state (select from catalog or use Manual... button)
   this.pendingClick = { px: cx, py: cy };
   this.preview.pendingMarker = { imgX: cx, imgY: cy };
   this.preview.viewport.update();
   this.statusLabel.text = "Star clicked (" + cx.toFixed(1) + ", " + cy.toFixed(1)
      + "). Select from catalog or click [Manual] for manual entry.";

   // Highlight nearest candidates in catalog
   this.highlightNearestCandidates(cx, cy);
};

//----------------------------------------------------------------------------
// Edit star
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
// Catalog pairing: pair pending click with catalog entry
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.pairWithCatalogEntry = function (node) {
   if (!this.pendingClick) {
      this.statusLabel.text = "Click a star in the image first, then select from catalog.";
      return;
   }

   // Parse RA/DEC from catalog node text (compact format HH:MM / +DD:MM)
   // Re-lookup from catalog data for full precision
   var label = node.text(1);
   var ra = null, dec = null, name = label;

   // Extract HIP number from disambiguated labels like "Pi Ori (HIP 22509)"
   var hipMatch = label.match(/\(HIP (\d+)\)$/);
   // Search in catalog stars
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      if (hipMatch) {
         // Match by HIP number for disambiguated labels
         if (s.hip === parseInt(hipMatch[1], 10)) {
            ra = s.ra;
            dec = s.dec;
            name = label;
            break;
         }
      } else {
         var sLabel = s.name || s.bayer;
         if (sLabel === label) {
            ra = s.ra;
            dec = s.dec;
            name = label;
            break;
         }
      }
   }
   // Search in Messier objects
   if (ra === null) {
      for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
         var m = MESSIER_OBJECTS[i];
         var mLabel = m.id;
         if (m.name) mLabel += " " + m.name;
         if (mLabel === label) {
            ra = m.ra;
            dec = m.dec;
            name = m.id;
            break;
         }
      }
   }

   if (ra === null || dec === null) {
      this.statusLabel.text = "Could not resolve catalog entry coordinates.";
      return;
   }

   this.starPairs.push({
      px: this.pendingClick.px,
      py: this.pendingClick.py,
      ra: ra, dec: dec,
      name: name
   });
   this.wcsResult = null;
   this.candidateRanking = null;
   this.clearPendingClick();
   this.updateCandidateStars();
   this.refreshAll();
};

ManualSolverDialog.prototype.clearPendingClick = function () {
   this.pendingClick = null;
   this.preview.pendingMarker = null;
   this.preview.viewport.update();
};

ManualSolverDialog.prototype.manualEntryForPending = function () {
   if (!this.pendingClick) {
      this.statusLabel.text = "No pending star click. Click a star in the image first.";
      return;
   }

   var starIndex = this.starPairs.length + 1;
   var starData = { px: this.pendingClick.px, py: this.pendingClick.py, ra: null, dec: null, name: "" };

   var dlg = new StarEditDialog(this, starIndex, starData);
   if (dlg.execute()) {
      this.starPairs.push(dlg.starData);
      this.wcsResult = null;
      this.clearPendingClick();
      this.refreshAll();
   }
};

//----------------------------------------------------------------------------
// UI update
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.refreshAll = function () {
   // Update TreeBox
   this.starTreeBox.clear();
   for (var i = 0; i < this.starPairs.length; i++) {
      var s = this.starPairs[i];
      var node = new TreeBoxNode(this.starTreeBox);
      var num = i + 1;
      node.setText(0, (num < 10 ? "0" : "") + num);
      node.setAlignment(0, TextAlign_Left | TextAlign_VertCenter);
      node.setText(1, s.px.toFixed(1));
      node.setText(2, s.py.toFixed(1));
      node.setText(3, s.name || "");
      node.setText(4, raToHMS(s.ra));
      node.setText(5, decToDMS(s.dec));

      // Residual: show "-" when residual is always zero by definition
      // (exact fit with 3 stars)
      if (this.wcsResult && this.wcsResult.residuals && this.wcsResult.residuals[i]) {
         var alwaysZero = this.starPairs.length <= 3;
         if (alwaysZero) {
            node.setText(6, "-");
         } else {
            node.setText(6, this.wcsResult.residuals[i].residual_arcsec.toFixed(2) + "\"");
         }
      } else {
         node.setText(6, "");
      }
   }

   // Update markers
   this.preview.starMarkers = [];
   for (var i = 0; i < this.starPairs.length; i++) {
      this.preview.starMarkers.push({
         imgX: this.starPairs[i].px,
         imgY: this.starPairs[i].py,
         index: i
      });
   }
   this.preview.viewport.update();

   // Update status
   var nStars = this.starPairs.length;
   var statusText = nStars + " star" + (nStars !== 1 ? "s" : "") + " registered";
   if (this.wcsResult && this.wcsResult.success) {
      statusText += " | RMS " + this.wcsResult.rms_arcsec.toFixed(2) + "\"";
      statusText += " (SplineWT)";
      statusText += " | Scale " + this.wcsResult.pixelScale_arcsec.toFixed(2) + "\"/px";
   }
   this.statusLabel.text = statusText;

   // Button state
   this.applyButton.enabled = (this.wcsResult !== null && this.wcsResult.success);

   // Clear candidate markers if WCS is invalidated
   if (!this.wcsResult || !this.wcsResult.success) {
      this.candidateStars = [];
      this.preview.candidateMarkers = null;
   }

   // Update catalog panel paired status
   this.updateCatalogPairedStatus();
};

//----------------------------------------------------------------------------
// Catalog panel: build list based on category and search filter
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.buildCatalogList = function () {
   this.catalogTreeBox.clear();
   var catIdx = this.catalogCategoryCombo.currentItem;
   var searchText = this.catalogSearchEdit.text.trim().toLowerCase();
   var items = [];

   if (catIdx === 0) {
      // Navigation Stars — sort by magnitude (brightest first)
      var navStars = [];
      for (var i = 0; i < CATALOG_STARS.length; i++) {
         var s = CATALOG_STARS[i];
         if (NAVIGATION_STAR_HIPS.indexOf(s.hip) >= 0) {
            navStars.push(s);
         }
      }
      navStars.sort(function (a, b) { return a.mag - b.mag; });
      for (var i = 0; i < navStars.length; i++) {
         var s = navStars[i];
         items.push({
            seq: i + 1,
            label: s.name || s.bayer,
            ra: s.ra, dec: s.dec, mag: s.mag,
            category: s.con || "",
            searchKey: (s.name + " " + s.bayer).toLowerCase()
         });
      }
   } else if (catIdx === 1) {
      // Messier Objects — seq = Messier number (1-110)
      for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
         var m = MESSIER_OBJECTS[i];
         var label = m.id;
         if (m.name) label += " " + m.name;
         items.push({
            seq: i + 1,
            label: label,
            ra: m.ra, dec: m.dec, mag: m.mag,
            category: m.con || "",
            searchKey: (m.id + " " + m.name).toLowerCase()
         });
      }
   } else {
      // Constellation: index 2..89 maps to conKeys[catIdx-2]
      var conKeys = [];
      for (var k in CONSTELLATION_LINES) {
         if (CONSTELLATION_LINES.hasOwnProperty(k)) conKeys.push(k);
      }
      conKeys.sort();
      var conAbbr = conKeys[catIdx - 2];
      // Build HIP set for this constellation's lines
      var conHips = {};
      var lineData = CONSTELLATION_LINES[conAbbr].lines;
      for (var li = 0; li < lineData.length; li++) {
         for (var pi = 0; pi < lineData[li].length; pi++) {
            conHips[lineData[li][pi]] = true;
         }
      }
      var conStars = [];
      for (var i = 0; i < CATALOG_STARS.length; i++) {
         var s = CATALOG_STARS[i];
         if (conHips[s.hip]) {
            conStars.push(s);
         }
      }
      conStars.sort(function (a, b) { return a.mag - b.mag; });
      // Build labels, disambiguating duplicates with HIP number
      var conLabels = [];
      for (var i = 0; i < conStars.length; i++) {
         var s = conStars[i];
         var bayer = s.bayer && s.bayer.trim() !== s.con ? s.bayer : "";
         conLabels.push(s.name || bayer || ("HIP " + s.hip));
      }
      // Detect duplicate labels and append HIP to disambiguate
      var labelCount = {};
      for (var i = 0; i < conLabels.length; i++) {
         labelCount[conLabels[i]] = (labelCount[conLabels[i]] || 0) + 1;
      }
      for (var i = 0; i < conStars.length; i++) {
         var s = conStars[i];
         var lbl = conLabels[i];
         if (labelCount[lbl] > 1) {
            lbl += " (HIP " + s.hip + ")";
         }
         items.push({
            seq: i + 1,
            label: lbl,
            ra: s.ra, dec: s.dec, mag: s.mag,
            category: conAbbr,
            searchKey: (s.name + " " + s.bayer + " HIP " + s.hip).toLowerCase()
         });
      }
   }

   // Apply search filter
   if (searchText.length > 0) {
      var filtered = [];
      for (var i = 0; i < items.length; i++) {
         if (items[i].searchKey.indexOf(searchText) >= 0) {
            filtered.push(items[i]);
         }
      }
      items = filtered;
   }

   // No pre-sort needed; items already in natural order with seq numbers.
   // TreeBox headerSorting on column 0 (#) will sort by zero-padded seq.

   // Populate TreeBox
   for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var node = new TreeBoxNode(this.catalogTreeBox);
      // Column 0: # (zero-padded for correct string sort)
      var seqStr = it.seq < 10 ? "00" + it.seq : it.seq < 100 ? "0" + it.seq : "" + it.seq;
      node.setText(0, seqStr);
      node.setText(1, it.label);
      // Compact RA/DEC: HH:MM / +DD:MM
      var raH = it.ra / 15.0;
      var raHH = Math.floor(raH);
      var raMM = Math.floor((raH - raHH) * 60);
      node.setText(2, (raHH < 10 ? "0" : "") + raHH + ":" + (raMM < 10 ? "0" : "") + raMM);
      var decSign = it.dec >= 0 ? "+" : "-";
      var decAbs = Math.abs(it.dec);
      var decDD = Math.floor(decAbs);
      var decMM = Math.floor((decAbs - decDD) * 60);
      node.setText(3, decSign + (decDD < 10 ? "0" : "") + decDD + ":" + (decMM < 10 ? "0" : "") + decMM);
      node.setText(4, it.mag.toFixed(1));
      node.setText(5, it.category || "");
   }

   this.updateCatalogPairedStatus();
   this.updateCatalogCandidateHighlight();
};

//----------------------------------------------------------------------------
// Catalog panel: highlight candidate stars (nearest to clicked position)
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.updateCatalogCandidateHighlight = function () {
   if (!this.candidateRanking || this.candidateRanking.length === 0) return;

   // Build lookup: label -> rank (0=nearest)
   var rankMap = {};
   for (var i = 0; i < this.candidateRanking.length; i++) {
      rankMap[this.candidateRanking[i].label.toLowerCase()] = i;
   }

   for (var i = 0; i < this.catalogTreeBox.numberOfChildren; i++) {
      var node = this.catalogTreeBox.child(i);
      var nodeLabel = node.text(1).toLowerCase();
      var rank = -1;

      // Check direct match or prefix match
      if (rankMap.hasOwnProperty(nodeLabel)) {
         rank = rankMap[nodeLabel];
      } else {
         for (var rl in rankMap) {
            if (rankMap.hasOwnProperty(rl)) {
               if (nodeLabel.indexOf(rl + " ") === 0 || rl.indexOf(nodeLabel) === 0) {
                  rank = rankMap[rl];
                  break;
               }
            }
         }
      }

      if (rank === 0) {
         for (var c = 0; c < 6; c++) {
            node.setBackgroundColor(c, 0x40FF8C00);
         }
      } else if (rank > 0 && rank < 5) {
         for (var c = 0; c < 6; c++) {
            node.setBackgroundColor(c, 0x20FF8C00);
         }
      }
   }
};

//----------------------------------------------------------------------------
// Catalog panel: update paired status (gray out already-paired entries)
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.updateCatalogPairedStatus = function () {
   // Build set of paired object names (lowercase)
   var pairedNames = {};
   for (var i = 0; i < this.starPairs.length; i++) {
      if (this.starPairs[i].name) {
         pairedNames[this.starPairs[i].name.toLowerCase()] = true;
      }
   }

   // Gray out paired entries in catalog TreeBox
   for (var i = 0; i < this.catalogTreeBox.numberOfChildren; i++) {
      var node = this.catalogTreeBox.child(i);
      var label = node.text(1).toLowerCase();
      // Exact match, or catalog label starts with paired name + space
      // (e.g. paired "m16" matches catalog "m16 eagle nebula")
      var isPaired = pairedNames.hasOwnProperty(label);
      if (!isPaired) {
         for (var pn in pairedNames) {
            if (pairedNames.hasOwnProperty(pn) && label.indexOf(pn + " ") === 0) {
               isPaired = true;
               break;
            }
         }
      }
      for (var c = 0; c < 6; c++) {
         node.setTextColor(c, isPaired ? 0xff888888 : 0xff000000);
      }
   }
};

//----------------------------------------------------------------------------
// Candidate star suggestion: compute and display candidate markers
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.updateCandidateStars = function () {
   this.candidateStars = [];
   this.preview.candidateMarkers = null;

   if (!this.suggestCheckBox.checked || !this.wcsResult || !this.wcsResult.success) {
      this.preview.viewport.update();
      return;
   }

   var magLimit = this.magLimitSpinBox.value / 10.0;
   var imageWidth = this.image.width;
   var imageHeight = this.image.height;

   // Build set of paired object names (lowercase) to exclude
   var pairedNames = {};
   for (var i = 0; i < this.starPairs.length; i++) {
      if (this.starPairs[i].name) {
         pairedNames[this.starPairs[i].name.toLowerCase()] = true;
      }
   }

   var candidates = [];

   // Scan CATALOG_STARS
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      if (s.mag > magLimit) continue;
      var label = s.name || s.bayer || ("HIP " + s.hip);
      if (pairedNames[label.toLowerCase()]) continue;
      var pix = skyToPixel(s.ra, s.dec, this.wcsResult, imageHeight);
      if (!pix) continue;
      if (pix.px < 0 || pix.px >= imageWidth || pix.py < 0 || pix.py >= imageHeight) continue;
      candidates.push({ px: pix.px, py: pix.py, ra: s.ra, dec: s.dec, name: label, label: label, mag: s.mag, con: s.con, hip: s.hip, type: "star" });
   }

   // Scan MESSIER_OBJECTS
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var m = MESSIER_OBJECTS[i];
      if (m.mag > magLimit) continue;
      var label = m.id;
      if (m.name) label += " " + m.name;
      if (pairedNames[m.id.toLowerCase()] || pairedNames[label.toLowerCase()]) continue;
      var pix = skyToPixel(m.ra, m.dec, this.wcsResult, imageHeight);
      if (!pix) continue;
      if (pix.px < 0 || pix.px >= imageWidth || pix.py < 0 || pix.py >= imageHeight) continue;
      candidates.push({ px: pix.px, py: pix.py, ra: m.ra, dec: m.dec, name: m.id, label: m.id, mag: m.mag, type: "messier" });
   }

   // Sort by magnitude (brightest first)
   candidates.sort(function (a, b) { return a.mag - b.mag; });

   this.candidateStars = candidates;
   this.preview.candidateMarkers = candidates;
   this.preview.viewport.update();
};

//----------------------------------------------------------------------------
// Highlight nearest candidates in catalog list when image is clicked
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.highlightNearestCandidates = function (px, py) {
   if (!this.candidateStars || this.candidateStars.length === 0) return;

   // Compute distance to each candidate
   var ranked = [];
   for (var i = 0; i < this.candidateStars.length; i++) {
      var c = this.candidateStars[i];
      var dx = c.px - px;
      var dy = c.py - py;
      ranked.push({ dist: Math.sqrt(dx * dx + dy * dy), candidate: c });
   }
   ranked.sort(function (a, b) { return a.dist - b.dist; });

   // Keep top 5
   this.candidateRanking = [];
   for (var i = 0; i < Math.min(5, ranked.length); i++) {
      this.candidateRanking.push({
         dist: ranked[i].dist,
         name: ranked[i].candidate.name,
         label: ranked[i].candidate.label
      });
   }

   // Auto-switch category to match the nearest candidate
   var top = ranked[0].candidate;
   if (top.type === "messier") {
      this.catalogCategoryCombo.currentItem = 1;
   } else if (top.type === "star" && top.con) {
      // Check if it's a navigation star first
      var isNavStar = top.hip && NAVIGATION_STAR_HIPS.indexOf(top.hip) >= 0;
      if (isNavStar) {
         this.catalogCategoryCombo.currentItem = 0;
      } else {
         // Find constellation index: sorted conKeys, offset by 2
         var conKeys = [];
         for (var k in CONSTELLATION_LINES) {
            if (CONSTELLATION_LINES.hasOwnProperty(k)) conKeys.push(k);
         }
         conKeys.sort();
         for (var ci = 0; ci < conKeys.length; ci++) {
            if (conKeys[ci] === top.con) {
               this.catalogCategoryCombo.currentItem = ci + 2;
               break;
            }
         }
      }
   }

   // Clear search text to avoid filtering out the candidate
   this.catalogSearchEdit.text = "";

   // Rebuild catalog list to apply highlight colors
   this.buildCatalogList();

   // Auto-scroll to the nearest candidate in catalog TreeBox
   if (this.candidateRanking.length > 0) {
      var topLabel = this.candidateRanking[0].label.toLowerCase();
      for (var i = 0; i < this.catalogTreeBox.numberOfChildren; i++) {
         var node = this.catalogTreeBox.child(i);
         var nodeLabel = node.text(1).toLowerCase();
         if (nodeLabel === topLabel
             || nodeLabel.indexOf(topLabel + " ") === 0
             || topLabel.indexOf(nodeLabel) === 0) {
            this.catalogTreeBox.currentNode = node;
            break;
         }
      }
   }
};

//----------------------------------------------------------------------------
// Rebuild bitmap (on stretch mode change)
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.updateStretchButtons = function () {
   this.stretchNoneButton.text = (this.stretchMode === "none") ? "\u25B6None" : "None";
   this.stretchLinkedButton.text = (this.stretchMode === "linked") ? "\u25B6Linked" : "Linked";
   this.stretchUnlinkedButton.text = (this.stretchMode === "unlinked") ? "\u25B6Unlinked" : "Unlinked";
};

ManualSolverDialog.prototype.rebuildBitmap = function () {
   this.cursor = new Cursor(StdCursor_Wait);
   processEvents();
   console.writeln("Rebuilding bitmap (" + this.stretchMode + ")...");
   console.flush();
   var bmpResult = createStretchedBitmap(this.image, MAX_BITMAP_EDGE, this.stretchMode);
   // setBitmap automatically applies current rotation
   this.preview.setBitmap(bmpResult);
   this.preview.fitToWindow();
   console.writeln("  Done.");
   this.cursor = new Cursor(StdCursor_Arrow);
};

//----------------------------------------------------------------------------
// Solve
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.doSolve = function () {
   if (this.starPairs.length < 3) {
      var mb = new MessageBox(
         "At least 3 star pairs required (current: " + this.starPairs.length + ").",
         TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }

   var fitter = new WCSFitter(this.starPairs, this.image.width, this.image.height);
   this.wcsResult = fitter.solve();

   if (!this.wcsResult.success) {
      var mb = new MessageBox("WCS fitting failed:\n" + this.wcsResult.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      this.refreshAll();
      return;
   }

   console.writeln("");
   console.writeln("<b>WCS Fitting Result:</b>");
   console.writeln("  RMS: " + this.wcsResult.rms_arcsec.toFixed(3) + " arcsec");
   console.writeln("  Pixel scale: " + this.wcsResult.pixelScale_arcsec.toFixed(3) + " arcsec/px");
   console.writeln("  Stars: " + this.starPairs.length);

   this.updateCandidateStars();
   this.refreshAll();
};

//----------------------------------------------------------------------------
// Apply to Image
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.doApply = function () {
   if (!this.wcsResult || !this.wcsResult.success) return;

   console.writeln("");
   console.writeln("<b>Applying WCS to image...</b>");

   applyWCSToImage(this.targetWindow, this.wcsResult, this.image.width, this.image.height);

   // 制御点を直接書き込み（regenerateAstrometricSolution の Y 軸解釈に依存しない）
   var smoothness = this.smoothnessControl.value;
   setCustomControlPoints(this.targetWindow, this.wcsResult,
      this.starPairs, this.image.width, this.image.height,
      smoothness);

   // Rebuild internal astrometric solution after all properties are written
   this.targetWindow.regenerateAstrometricSolution();

   // Console output
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
   console.writeln("<b>WCS applied successfully.</b>");

   // Save session on successful Apply
   this.saveSessionData();

   var mb = new MessageBox(
      "WCS applied successfully.\n\n"
      + "RMS: " + this.wcsResult.rms_arcsec.toFixed(3) + " arcsec\n"
      + "Pixel scale: " + this.wcsResult.pixelScale_arcsec.toFixed(3) + " arcsec/px\n"
      + "Stars: " + this.starPairs.length,
      TITLE, StdIcon_Information, StdButton_Ok);
   mb.execute();
};

//============================================================================
// Session save/restore
//============================================================================

#define SETTINGS_KEY "ManualImageSolver/sessionData"

// Save session data to Settings
function saveSession(imageId, imageWidth, imageHeight, stretchMode, starPairs, rotationAngle, smoothness, suggestEnabled, magLimit) {
   var data = {
      imageId: imageId,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      stretchMode: stretchMode,
      rotationAngle: rotationAngle || 0,
      smoothness: typeof smoothness === "number" ? smoothness : 0.01,
      suggestEnabled: suggestEnabled !== false,
      magLimit: typeof magLimit === "number" ? magLimit : 30,
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
   // Escape non-ASCII characters to \uXXXX for safe storage in Settings API
   var jsonStr = JSON.stringify(data).replace(/[\u0080-\uffff]/g, function (ch) {
      return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4);
   });
   Settings.write(SETTINGS_KEY, DataType_String, jsonStr);
}

// Load session data from Settings
// On success: parsed object, on failure: null
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
// Save session on dialog close
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.saveSessionData = function () {
   if (this.starPairs.length > 0) {
      saveSession(
         this.targetWindow.mainView.id,
         this.image.width,
         this.image.height,
         this.stretchMode,
         this.starPairs,
         this.preview.rotationAngle,
         this.smoothnessControl.value,
         this.suggestCheckBox.checked,
         this.magLimitSpinBox.value
      );
      console.writeln("Session data saved (" + this.starPairs.length + " stars).");
   }
};

//----------------------------------------------------------------------------
// Export: Write star pair data to JSON file
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.doExport = function () {
   if (this.starPairs.length === 0) {
      var mb = new MessageBox("No star pairs to export.",
         TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }

   var sfd = new SaveFileDialog;
   sfd.caption = "Export Star Pair Data";
   sfd.filters = [["JSON files", "*.json"]];
   sfd.selectedFileExtension = ".json";

   if (!sfd.execute()) return;

   var data = {
      imageId: this.targetWindow.mainView.id,
      imageWidth: this.image.width,
      imageHeight: this.image.height,
      stretchMode: this.stretchMode,
      starPairs: []
   };
   for (var i = 0; i < this.starPairs.length; i++) {
      var s = this.starPairs[i];
      data.starPairs.push({
         px: s.px, py: s.py,
         ra: s.ra, dec: s.dec,
         name: s.name || ""
      });
   }

   var json = JSON.stringify(data, null, 2);
   try {
      var f = new File;
      f.createForWriting(sfd.fileName);
      f.write(ByteArray.stringToUTF8(json));
      f.close();
      console.writeln("Star pair data exported: " + sfd.fileName);
      var mb = new MessageBox("Star pair data exported (" + this.starPairs.length + " stars).",
         TITLE, StdIcon_Information, StdButton_Ok);
      mb.execute();
   } catch (e) {
      var mb = new MessageBox("Failed to write file:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
   }
};

//----------------------------------------------------------------------------
// Import: Read star pair data from JSON file
//----------------------------------------------------------------------------

ManualSolverDialog.prototype.doImport = function () {
   var ofd = new OpenFileDialog;
   ofd.caption = "Import Star Pair Data";
   ofd.filters = [["JSON files", "*.json"]];

   if (!ofd.execute()) return;

   try {
      var f = new File;
      f.openForReading(ofd.fileName);
      var buf = f.read(DataType_ByteArray, f.size);
      f.close();
      var json = buf.utf8ToString();
      var data = JSON.parse(json);
   } catch (e) {
      var mb = new MessageBox("Failed to read file:\n" + e.message,
         TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
      return;
   }

   if (!data || !data.starPairs || data.starPairs.length === 0) {
      var mb = new MessageBox("No valid star pair data found.",
         TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }

   // Image size check
   if (data.imageWidth && data.imageHeight) {
      if (data.imageWidth !== this.image.width || data.imageHeight !== this.image.height) {
         var mb = new MessageBox(
            "Image size mismatch.\n"
            + "File: " + data.imageWidth + " x " + data.imageHeight + "\n"
            + "Current image: " + this.image.width + " x " + this.image.height + "\n\n"
            + "Import anyway?",
            TITLE, StdIcon_Warning, StdButton_Yes, StdButton_No);
         if (mb.execute() !== StdButton_Yes) return;
      }
   }

   // Confirm if existing star pairs are present
   if (this.starPairs.length > 0) {
      var mb = new MessageBox(
         "Replace current star pairs (" + this.starPairs.length + ")?\nSelect 'No' to append instead.",
         TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         this.starPairs = [];
      }
   }

   // Add star pairs
   for (var i = 0; i < data.starPairs.length; i++) {
      var s = data.starPairs[i];
      if (typeof s.px === "number" && typeof s.py === "number"
         && typeof s.ra === "number" && typeof s.dec === "number") {
         this.starPairs.push({
            px: s.px, py: s.py,
            ra: s.ra, dec: s.dec,
            name: s.name || ""
         });
      }
   }

   // Restore stretch mode
   if (data.stretchMode && data.stretchMode !== this.stretchMode) {
      var modes = ["none", "linked", "unlinked"];
      if (modes.indexOf(data.stretchMode) >= 0) {
         this.stretchMode = data.stretchMode;
         this.updateStretchButtons();
         this.rebuildBitmap();
      }
   }

   this.wcsResult = null;
   this.refreshAll();

   console.writeln("Star pair data imported: " + ofd.fileName
      + " (" + data.starPairs.length + " stars)");
};

//============================================================================
// Main execution
//============================================================================

function main() {
   if (ImageWindow.activeWindow.isNull) {
      var mb = new MessageBox(
         "No image is open.\nPlease open an image before running this script.",
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

   // Check for session restore
   var restoredStarPairs = null;
   var restoredStretchMode = null;
   var restoredRotationAngle = 0;
   var restoredSmoothness = 0.01;
   var restoredSuggestEnabled = true;
   var restoredMagLimit = 30;
   var sessionData = loadSession();
   if (sessionData
       && sessionData.imageWidth === image.width
       && sessionData.imageHeight === image.height) {
      var msg = "Previous session data found.\n\n"
         + "Image: " + (sessionData.imageId || "(unknown)") + "\n"
         + "Star pairs: " + sessionData.starPairs.length + "\n\n"
         + "Restore?";
      var mb = new MessageBox(msg, TITLE, StdIcon_Question, StdButton_Yes, StdButton_No);
      if (mb.execute() === StdButton_Yes) {
         restoredStarPairs = sessionData.starPairs;
         restoredStretchMode = sessionData.stretchMode || "linked";
         restoredRotationAngle = sessionData.rotationAngle || 0;
         restoredSmoothness = typeof sessionData.smoothness === "number" ? sessionData.smoothness : 0.01;
         restoredSuggestEnabled = sessionData.hasOwnProperty("suggestEnabled") ? sessionData.suggestEnabled !== false : true;
         restoredMagLimit = sessionData.hasOwnProperty("magLimit") && typeof sessionData.magLimit === "number" ? sessionData.magLimit : 30;
         console.writeln("Restoring session (" + restoredStarPairs.length + " stars).");
      }
   }

   var dlg = new ManualSolverDialog(targetWindow);

   // Session restore: apply star pairs, stretch mode, and rotation
   if (restoredStarPairs) {
      dlg.starPairs = restoredStarPairs;
      dlg.smoothnessControl.setValue(restoredSmoothness);
      if (restoredStretchMode && restoredStretchMode !== dlg.stretchMode) {
         dlg.stretchMode = restoredStretchMode;
         dlg.updateStretchButtons();
         dlg.rebuildBitmap();
      }
      if (restoredRotationAngle && restoredRotationAngle !== 0) {
         dlg.preview.setRotation(restoredRotationAngle);
      }
      dlg.suggestCheckBox.checked = restoredSuggestEnabled;
      dlg.magLimitSpinBox.value = restoredMagLimit;
      dlg.refreshAll();
   }

   dlg.execute();

   // Save session on dialog close
   dlg.saveSessionData();

   console.writeln("");
   console.writeln(TITLE + " finished.");
}

main();
