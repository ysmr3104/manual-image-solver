//============================================================================
// wcs_math.js - WCS Math Library
//
// Provides TAN (gnomonic) projection, CD matrix fitting, and centroid computation.
// Pure JavaScript compatible with both PJSR and Node.js.
//
// Copyright (c) 2024-2025 Split Image Solver Project
//============================================================================

// Math is available by default in both PJSR and Node.js environments.

//----------------------------------------------------------------------------
// TAN (gnomonic) projection: celestial coordinates -> standard coordinates
//   crval: [ra0, dec0] in degrees
//   coord: [ra, dec] in degrees
//   Returns: [xi, eta] in degrees
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
      return null; // Cannot project (opposite hemisphere)
   }

   var xi  = (cosDec * Math.sin(dRA)) / D * (180.0 / Math.PI);
   var eta = (cosDec0 * sinDec - sinDec0 * cosDec * cosDRA) / D * (180.0 / Math.PI);

   return [xi, eta];
}

//----------------------------------------------------------------------------
// TAN inverse projection: standard coordinates -> celestial coordinates
//   crval: [ra0, dec0] in degrees
//   standard: [xi, eta] in degrees
//   Returns: [ra, dec] in degrees
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

   // Normalize RA to 0-360
   var raDeg = ra * 180.0 / Math.PI;
   while (raDeg < 0) raDeg += 360.0;
   while (raDeg >= 360.0) raDeg -= 360.0;

   return [raDeg, dec * 180.0 / Math.PI];
}

//----------------------------------------------------------------------------
// Angular separation (Vincenty formula)
//   coord1, coord2: [ra, dec] in degrees
//   Returns: angular separation in degrees
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
// Linear algebra utilities
//----------------------------------------------------------------------------

// Solve a linear system Ax = b using Gaussian elimination with partial pivoting
// A: n×n 2D array, b: length-n array
// Returns: solution vector, or null if singular
function solveLinearSystem(A, b) {
   var n = b.length;
   // Create augmented matrix [A|b]
   var aug = [];
   for (var i = 0; i < n; i++) {
      aug[i] = [];
      for (var j = 0; j < n; j++) {
         aug[i][j] = A[i][j];
      }
      aug[i][n] = b[i];
   }

   // Forward elimination with partial pivoting
   for (var col = 0; col < n; col++) {
      var maxVal = Math.abs(aug[col][col]);
      var maxRow = col;
      for (var row = col + 1; row < n; row++) {
         if (Math.abs(aug[row][col]) > maxVal) {
            maxVal = Math.abs(aug[row][col]);
            maxRow = row;
         }
      }
      if (maxVal < 1e-15) return null;

      if (maxRow !== col) {
         var tmp = aug[col];
         aug[col] = aug[maxRow];
         aug[maxRow] = tmp;
      }

      for (var row = col + 1; row < n; row++) {
         var factor = aug[row][col] / aug[col][col];
         for (var j = col; j <= n; j++) {
            aug[row][j] -= factor * aug[col][j];
         }
      }
   }

   // Back substitution
   var x = [];
   for (var i = n - 1; i >= 0; i--) {
      if (Math.abs(aug[i][i]) < 1e-15) return null;
      var sum = aug[i][n];
      for (var j = i + 1; j < n; j++) {
         sum -= aug[i][j] * x[j];
      }
      x[i] = sum / aug[i][i];
   }

   return x;
}

// Solve underdetermined system D*x = b (m < n) via minimum-norm solution
// x = D^T * (D * D^T)^{-1} * b
// D: m×n (m < n), b: length-m → returns length-n solution, or null if singular
function solveMinNorm(D, b) {
   var m = D.length;
   var n = D[0].length;

   // Try without regularization, then with Tikhonov regularization as fallback
   var y = null;
   for (var attempt = 0; attempt < 2; attempt++) {
      var G = [];
      for (var i = 0; i < m; i++) {
         G[i] = [];
         for (var j = 0; j < m; j++) {
            var s = 0;
            for (var k = 0; k < n; k++) s += D[i][k] * D[j][k];
            G[i][j] = s;
         }
      }
      if (attempt === 1) {
         var maxDiag = 0;
         for (var i = 0; i < m; i++) {
            if (G[i][i] > maxDiag) maxDiag = G[i][i];
         }
         var eps = maxDiag * 1e-10;
         for (var i = 0; i < m; i++) G[i][i] += eps;
      }
      y = solveLinearSystem(G, b);
      if (y !== null) break;
   }
   if (y === null) return null;

   // x = D^T * y
   var x = [];
   for (var j = 0; j < n; j++) {
      var s = 0;
      for (var i = 0; i < m; i++) s += D[i][j] * y[i];
      x[j] = s;
   }
   return x;
}

//----------------------------------------------------------------------------
// WCSFitter: Fit a TAN projection WCS from star pairs
//
//   starPairs: array of [{px, py, ra, dec, name}] (requires 3 or more)
//   imageWidth, imageHeight: image dimensions in pixels
//----------------------------------------------------------------------------
function WCSFitter(starPairs, imageWidth, imageHeight) {
   this.stars = starPairs;
   this.width = imageWidth;
   this.height = imageHeight;
   // CRPIX is the image center (FITS 1-based)
   this.crpix1 = imageWidth / 2.0 + 0.5;
   this.crpix2 = imageHeight / 2.0 + 0.5;
}

WCSFitter.prototype.solve = function () {
   var stars = this.stars;
   var nStars = stars.length;

   if (nStars < 3) {
      return {
         success: false,
         message: "At least 3 star pairs required (current: " + nStars + ")"
      };
   }

   // RA/DEC range check
   for (var i = 0; i < nStars; i++) {
      if (stars[i].ra < 0 || stars[i].ra >= 360) {
         return {
            success: false,
            message: "Star " + (i + 1) + " RA is out of range: " + stars[i].ra
         };
      }
      if (stars[i].dec < -90 || stars[i].dec > 90) {
         return {
            success: false,
            message: "Star " + (i + 1) + " DEC is out of range: " + stars[i].dec
         };
      }
   }

   var crpix1 = this.crpix1;
   var crpix2 = this.crpix2;

   // --- 1. CRVAL initial value = centroid of star celestial coordinates ---
   // Use 3D unit vector mean on the celestial sphere.
   // This correctly handles circumpolar fields where stars wrap around in RA.
   var sumVX = 0, sumVY = 0, sumVZ = 0;
   for (var i = 0; i < nStars; i++) {
      var raRad = stars[i].ra * Math.PI / 180.0;
      var decRad = stars[i].dec * Math.PI / 180.0;
      sumVX += Math.cos(decRad) * Math.cos(raRad);
      sumVY += Math.cos(decRad) * Math.sin(raRad);
      sumVZ += Math.sin(decRad);
   }
   var crval1 = Math.atan2(sumVY, sumVX) * 180.0 / Math.PI;
   if (crval1 < 0) crval1 += 360.0;
   var rXY = Math.sqrt(sumVX * sumVX + sumVY * sumVY);
   var crval2 = Math.atan2(sumVZ, rXY) * 180.0 / Math.PI;

   // --- 2-4. Iterate: TAN projection -> CD matrix fit -> CRVAL update ---
   var cd = [[0, 0], [0, 0]];
   var maxIter = 15;

   for (var iter = 0; iter < maxIter; iter++) {
      var crval = [crval1, crval2];

      // Compute standard coordinates via TAN projection
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
            message: "TAN projection failed (stars may be in the opposite hemisphere)"
         };
      }

      // Pixel offset u, v (relative to CRPIX)
      // Standard FITS coordinate system: y=1 is at the image bottom. fits_y = height - py.
      var uArr = [];
      var vArr = [];
      for (var i = 0; i < nStars; i++) {
         uArr.push((stars[i].px + 1.0) - crpix1);
         vArr.push((this.height - stars[i].py) - crpix2);
      }

      // Compute terms of the normal equations
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

      // Solve CD matrix using Cramer's rule
      var det = sumUU * sumVV - sumUV * sumUV;
      if (Math.abs(det) < 1e-30) {
         return {
            success: false,
            message: "Normal equation determinant is zero (stars may be collinear)"
         };
      }

      cd[0][0] = (sumUXi * sumVV - sumVXi * sumUV) / det;   // CD1_1
      cd[0][1] = (sumUU * sumVXi - sumUV * sumUXi) / det;   // CD1_2
      cd[1][0] = (sumUEta * sumVV - sumVEta * sumUV) / det;  // CD2_1
      cd[1][1] = (sumUU * sumVEta - sumUV * sumUEta) / det;  // CD2_2

      // Update CRVAL: inverse transform CRPIX (image center) -> celestial coords
      // Since the offset at CRPIX is (0, 0), standard coords are also (0, 0)
      // -> CRVAL doesn't change. But if CRPIX is offset from the pixel center, update it.
      // Here we use a fixed CRPIX with fine-tuned CRVAL:
      // Correct CRVAL using the centroid of all star residuals
      var sumDXi = 0, sumDEta = 0;
      for (var i = 0; i < nStars; i++) {
         var predXi  = cd[0][0] * uArr[i] + cd[0][1] * vArr[i];
         var predEta = cd[1][0] * uArr[i] + cd[1][1] * vArr[i];
         sumDXi  += xiArr[i] - predXi;
         sumDEta += etaArr[i] - predEta;
      }
      var meanDXi  = sumDXi / nStars;
      var meanDEta = sumDEta / nStars;

      // Inverse transform residual centroid to celestial coords and update CRVAL
      var newCrval = tanDeproject([crval1, crval2], [meanDXi, meanDEta]);

      // Verify that updated CRVAL doesn't break TAN projection for any star.
      // For wide-field images, the non-linear TAN projection can cause the
      // CRVAL update to overshoot, pushing edge stars beyond the 90-degree limit.
      var updateOk = true;
      for (var j = 0; j < nStars; j++) {
         if (tanProject(newCrval, [stars[j].ra, stars[j].dec]) === null) {
            updateOk = false;
            break;
         }
      }
      if (updateOk) {
         var crval2Rad = crval2 * Math.PI / 180.0;
         var crvalDelta = Math.sqrt(
            Math.pow((newCrval[0] - crval1) * Math.cos(crval2Rad), 2) +
            Math.pow(newCrval[1] - crval2, 2)
         ) * 3600.0;  // degrees -> arcsec
         crval1 = newCrval[0];
         crval2 = newCrval[1];
         if (crvalDelta < 1e-4) break;  // < 0.0001 arcsec で収束
      }
   }

   // --- 5. Compute TAN-only residuals ---
   var crval = [crval1, crval2];
   var residuals = [];
   var totalResidSq = 0;

   for (var i = 0; i < nStars; i++) {
      var u = (stars[i].px + 1.0) - crpix1;
      var v = (this.height - stars[i].py) - crpix2;

      var predXi  = cd[0][0] * u + cd[0][1] * v;
      var predEta = cd[1][0] * u + cd[1][1] * v;
      var predCoord = tanDeproject(crval, [predXi, predEta]);
      var resid = angularSeparation([stars[i].ra, stars[i].dec], predCoord);
      var residArcsec = resid * 3600.0;
      residuals.push({
         name: stars[i].name || ("Star " + (i + 1)),
         residual_arcsec: residArcsec
      });
      totalResidSq += residArcsec * residArcsec;
   }

   var rmsArcsec = Math.sqrt(totalResidSq / nStars);

   // Pixel scale computation (from CD matrix singular values)
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
      message: "WCS fit succeeded (RMS: " + rmsArcsec.toFixed(2) + " arcsec, "
         + "pixel scale: " + pixelScaleArcsec.toFixed(3) + " arcsec/px)"
   };
};

//----------------------------------------------------------------------------
// Sky to pixel conversion: RA/DEC -> pixel coordinates using WCS result
//   ra, dec: celestial coordinates in degrees
//   wcsResult: object with crval1, crval2, crpix1, crpix2, cd (2x2 matrix)
//   imageHeight: image height in pixels
//   Returns: {px, py} in 0-based PixInsight coordinates, or null if on opposite hemisphere
//----------------------------------------------------------------------------
function skyToPixel(ra, dec, wcsResult, imageHeight) {
   var proj = tanProject([wcsResult.crval1, wcsResult.crval2], [ra, dec]);
   if (!proj) return null;

   var xi = proj[0];
   var eta = proj[1];

   // CD inverse matrix
   var cd = wcsResult.cd;
   var det = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
   if (Math.abs(det) < 1e-30) return null;

   var u = (cd[1][1] * xi - cd[0][1] * eta) / det;
   var v = (-cd[1][0] * xi + cd[0][0] * eta) / det;

   // FITS -> PixInsight coordinate conversion
   var px = u + wcsResult.crpix1 - 1;
   var py = imageHeight - (v + wcsResult.crpix2);

   return { px: px, py: py };
}

//----------------------------------------------------------------------------
// Centroid computation (intensity-weighted center of gravity)
//
// Uses Image.sample(x, y, channel) in the PJSR environment.
// This function is PJSR-only.
//
//   image: PixInsight Image object
//   cx, cy: click position (0-based pixel coordinates)
//   radius: search radius in pixels (default 10)
//   Returns: {x, y} sub-pixel star center, or null on failure
//----------------------------------------------------------------------------
function computeCentroid(image, cx, cy, radius) {
   if (typeof radius === "undefined") radius = 10;

   var x0 = Math.max(0, Math.round(cx) - radius);
   var y0 = Math.max(0, Math.round(cy) - radius);
   var x1 = Math.min(image.width - 1, Math.round(cx) + radius);
   var y1 = Math.min(image.height - 1, Math.round(cy) + radius);

   // Use channel 0 (monochrome or R channel)
   var ch = 0;

   // Collect pixel values within the window for background estimation (median)
   var values = [];
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         values.push(image.sample(x, y, ch));
      }
   }

   if (values.length === 0) return null;

   // Use median as background level
   values.sort(function (a, b) { return a - b; });
   var median = values[Math.floor(values.length / 2)];

   // Intensity-weighted centroid (background subtracted)
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

// Export for Node.js environment (ignored in PJSR)
if (typeof module !== "undefined") {
   module.exports = {
      tanProject: tanProject,
      tanDeproject: tanDeproject,
      angularSeparation: angularSeparation,
      solveLinearSystem: solveLinearSystem,
      solveMinNorm: solveMinNorm,
      WCSFitter: WCSFitter,
      computeCentroid: computeCentroid,
      skyToPixel: skyToPixel
   };
}
