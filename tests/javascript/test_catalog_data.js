//============================================================================
// test_catalog_data.js - catalog_data.js の Node.js 単体テスト
//
// 実行方法: node tests/javascript/test_catalog_data.js
//============================================================================

var catalog = require("../../javascript/catalog_data.js");

var CATALOG_STARS = catalog.CATALOG_STARS;
var CONSTELLATION_LINES = catalog.CONSTELLATION_LINES;
var NAVIGATION_STAR_HIPS = catalog.NAVIGATION_STAR_HIPS;
var MESSIER_OBJECTS = catalog.MESSIER_OBJECTS;

var passed = 0;
var failed = 0;

function assertEqual(actual, expected, msg) {
   if (actual !== expected) {
      console.log("  FAIL: " + msg);
      console.log("    expected: " + expected + ", actual: " + actual);
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
   console.log("TEST: " + name);
   fn();
}

// Build HIP lookup for fast access
var starByHip = {};
for (var i = 0; i < CATALOG_STARS.length; i++) {
   starByHip[CATALOG_STARS[i].hip] = CATALOG_STARS[i];
}

//============================================================================
// Star data integrity tests
//============================================================================

test("CATALOG_STARS count", function() {
   assertTrue(CATALOG_STARS.length >= 600,
      "Should have at least 600 stars, got " + CATALOG_STARS.length);
   assertTrue(CATALOG_STARS.length <= 800,
      "Should have at most 800 stars, got " + CATALOG_STARS.length);
});

test("Star RA range (0-360)", function() {
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      assertTrue(s.ra >= 0 && s.ra < 360,
         "HIP " + s.hip + " RA=" + s.ra + " out of range [0, 360)");
   }
});

test("Star DEC range (-90 to +90)", function() {
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      assertTrue(s.dec >= -90 && s.dec <= 90,
         "HIP " + s.hip + " DEC=" + s.dec + " out of range [-90, 90]");
   }
});

test("Star magnitude range", function() {
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      assertTrue(s.mag >= -2 && s.mag <= 8,
         "HIP " + s.hip + " mag=" + s.mag + " out of expected range [-2, 8]");
   }
});

test("No duplicate HIP numbers", function() {
   var seen = {};
   var duplicates = [];
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var hip = CATALOG_STARS[i].hip;
      if (seen[hip]) {
         duplicates.push(hip);
      }
      seen[hip] = true;
   }
   assertEqual(duplicates.length, 0,
      "Duplicate HIP numbers: " + duplicates.join(", "));
});

test("All stars have required fields", function() {
   var fields = ["hip", "name", "bayer", "con", "ra", "dec", "mag"];
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      for (var j = 0; j < fields.length; j++) {
         assertTrue(s.hasOwnProperty(fields[j]),
            "HIP " + s.hip + " missing field: " + fields[j]);
      }
   }
});

test("All stars have constellation abbreviation", function() {
   for (var i = 0; i < CATALOG_STARS.length; i++) {
      var s = CATALOG_STARS[i];
      assertTrue(s.con.length >= 2 && s.con.length <= 4,
         "HIP " + s.hip + " invalid constellation: '" + s.con + "'");
   }
});

test("Well-known star coordinates (Sirius)", function() {
   var sirius = starByHip[32349];
   assertTrue(!!sirius, "Sirius (HIP 32349) should exist");
   if (sirius) {
      assertTrue(Math.abs(sirius.ra - 101.287) < 0.01,
         "Sirius RA should be ~101.287, got " + sirius.ra);
      assertTrue(Math.abs(sirius.dec - (-16.716)) < 0.01,
         "Sirius DEC should be ~-16.716, got " + sirius.dec);
      assertTrue(sirius.mag < 0,
         "Sirius mag should be negative, got " + sirius.mag);
   }
});

test("Well-known star coordinates (Vega)", function() {
   var vega = starByHip[91262];
   assertTrue(!!vega, "Vega (HIP 91262) should exist");
   if (vega) {
      assertTrue(Math.abs(vega.ra - 279.235) < 0.01,
         "Vega RA should be ~279.235, got " + vega.ra);
      assertTrue(Math.abs(vega.dec - 38.784) < 0.01,
         "Vega DEC should be ~38.784, got " + vega.dec);
   }
});

test("Well-known star coordinates (Polaris)", function() {
   var polaris = starByHip[11767];
   assertTrue(!!polaris, "Polaris (HIP 11767) should exist");
   if (polaris) {
      assertTrue(polaris.dec > 89,
         "Polaris DEC should be >89, got " + polaris.dec);
   }
});

//============================================================================
// Constellation line integrity tests
//============================================================================

test("All 88 constellations present", function() {
   var count = Object.keys(CONSTELLATION_LINES).length;
   assertEqual(count, 88, "Should have 88 constellations, got " + count);
});

test("Constellation lines reference valid HIP numbers", function() {
   var missingCount = 0;
   var missingExamples = [];
   var cons = Object.keys(CONSTELLATION_LINES);
   for (var ci = 0; ci < cons.length; ci++) {
      var con = cons[ci];
      var data = CONSTELLATION_LINES[con];
      for (var li = 0; li < data.lines.length; li++) {
         var polyline = data.lines[li];
         for (var pi = 0; pi < polyline.length; pi++) {
            var hip = polyline[pi];
            if (!starByHip[hip]) {
               missingCount++;
               if (missingExamples.length < 5) {
                  missingExamples.push(con + ":HIP" + hip);
               }
            }
         }
      }
   }
   assertEqual(missingCount, 0,
      missingCount + " constellation line HIP refs not in CATALOG_STARS: " +
      missingExamples.join(", "));
});

test("Each constellation has full name", function() {
   var cons = Object.keys(CONSTELLATION_LINES);
   for (var i = 0; i < cons.length; i++) {
      var data = CONSTELLATION_LINES[cons[i]];
      assertTrue(data.name && data.name.length > 0,
         cons[i] + " has no full name");
   }
});

test("Each constellation has at least one line", function() {
   var cons = Object.keys(CONSTELLATION_LINES);
   for (var i = 0; i < cons.length; i++) {
      var data = CONSTELLATION_LINES[cons[i]];
      assertTrue(data.lines.length > 0,
         cons[i] + " has no lines");
      for (var j = 0; j < data.lines.length; j++) {
         assertTrue(data.lines[j].length >= 2,
            cons[i] + " polyline " + j + " has fewer than 2 points");
      }
   }
});

//============================================================================
// Navigation stars tests
//============================================================================

test("Navigation stars count", function() {
   assertTrue(NAVIGATION_STAR_HIPS.length >= 40,
      "Should have at least 40 navigation stars, got " + NAVIGATION_STAR_HIPS.length);
});

test("Navigation stars exist in CATALOG_STARS", function() {
   var missing = [];
   for (var i = 0; i < NAVIGATION_STAR_HIPS.length; i++) {
      if (!starByHip[NAVIGATION_STAR_HIPS[i]]) {
         missing.push(NAVIGATION_STAR_HIPS[i]);
      }
   }
   assertEqual(missing.length, 0,
      "Navigation stars not in CATALOG_STARS: " + missing.join(", "));
});

test("Key navigation stars included", function() {
   var key = [32349, 91262, 69673, 27989, 24436, 80763, 65474, 30438, 97649, 102098];
   var names = ["Sirius", "Vega", "Arcturus", "Betelgeuse", "Rigel", "Antares", "Spica", "Canopus", "Altair", "Deneb"];
   for (var i = 0; i < key.length; i++) {
      assertTrue(NAVIGATION_STAR_HIPS.indexOf(key[i]) >= 0,
         names[i] + " (HIP " + key[i] + ") should be a navigation star");
   }
});

//============================================================================
// Messier objects tests
//============================================================================

test("Messier objects count", function() {
   assertEqual(MESSIER_OBJECTS.length, 110,
      "Should have 110 Messier objects, got " + MESSIER_OBJECTS.length);
});

test("Messier object IDs sequential (M1-M110)", function() {
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var expected = "M" + (i + 1);
      assertEqual(MESSIER_OBJECTS[i].id, expected,
         "Object at index " + i + " should be " + expected + ", got " + MESSIER_OBJECTS[i].id);
   }
});

test("Messier RA range (0-360)", function() {
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var m = MESSIER_OBJECTS[i];
      assertTrue(m.ra >= 0 && m.ra < 360,
         m.id + " RA=" + m.ra + " out of range [0, 360)");
   }
});

test("Messier DEC range (-90 to +90)", function() {
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var m = MESSIER_OBJECTS[i];
      assertTrue(m.dec >= -90 && m.dec <= 90,
         m.id + " DEC=" + m.dec + " out of range [-90, 90]");
   }
});

test("Messier object types valid", function() {
   var validTypes = ["GC", "OC", "PN", "DN", "Gx", "DS"];
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var m = MESSIER_OBJECTS[i];
      assertTrue(validTypes.indexOf(m.type) >= 0,
         m.id + " has invalid type: '" + m.type + "'");
   }
});

test("No duplicate Messier IDs", function() {
   var seen = {};
   var duplicates = [];
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var id = MESSIER_OBJECTS[i].id;
      if (seen[id]) {
         duplicates.push(id);
      }
      seen[id] = true;
   }
   assertEqual(duplicates.length, 0,
      "Duplicate Messier IDs: " + duplicates.join(", "));
});

test("Well-known Messier coordinates (M42 Orion Nebula)", function() {
   var m42 = MESSIER_OBJECTS[41]; // M42 is at index 41
   assertEqual(m42.id, "M42", "Index 41 should be M42");
   assertTrue(Math.abs(m42.ra - 83.85) < 0.5,
      "M42 RA should be ~83.85, got " + m42.ra);
   assertTrue(Math.abs(m42.dec - (-5.45)) < 0.5,
      "M42 DEC should be ~-5.45, got " + m42.dec);
});

test("Well-known Messier coordinates (M31 Andromeda)", function() {
   var m31 = MESSIER_OBJECTS[30]; // M31 is at index 30
   assertEqual(m31.id, "M31", "Index 30 should be M31");
   assertTrue(Math.abs(m31.ra - 10.675) < 0.5,
      "M31 RA should be ~10.675, got " + m31.ra);
   assertTrue(Math.abs(m31.dec - 41.267) < 0.5,
      "M31 DEC should be ~41.267, got " + m31.dec);
});

test("All Messier objects have required fields", function() {
   var fields = ["id", "name", "type", "con", "ra", "dec", "mag"];
   for (var i = 0; i < MESSIER_OBJECTS.length; i++) {
      var m = MESSIER_OBJECTS[i];
      for (var j = 0; j < fields.length; j++) {
         assertTrue(m.hasOwnProperty(fields[j]),
            m.id + " missing field: " + fields[j]);
      }
   }
});

//============================================================================
// Summary
//============================================================================

console.log("");
console.log("========================================");
console.log("Results: " + passed + " passed, " + failed + " failed");
console.log("========================================");

if (failed > 0) {
   process.exit(1);
}
