// Copie OpenLayers (version complète, comme dans GestReb) dans public/vendor avant le build.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/vendor/ol", { recursive: true });
copyFileSync("node_modules/ol/dist/ol.js", "public/vendor/ol/ol.js");
copyFileSync("node_modules/ol/ol.css", "public/vendor/ol/ol.css");
