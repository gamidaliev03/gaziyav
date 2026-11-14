// A finished export moved to the folder the user chose: a rename on the same volume; across volumes (an external disk,
// fills up or a cable pulled halfway leaves no cut file under the export's name. The work is modules/export-save.js
// (placeFile); this name stays for the code and tests that knew it. Pure Node, no Electron.
"use strict";
const { placeFile } = require("./export-save");

/** `io`: fs.promises, or a stand-in in the tests (rename / copyFile / rm / open). */
const moveFile = (from, target, io) => placeFile(from, target, io);

module.exports = { moveFile };
