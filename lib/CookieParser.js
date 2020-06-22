const fs = require("fs");
const requireFromString = require("require-from-string");
const filename = require.resolve("chrome-devtools-frontend/front_end/sdk/CookieParser.js");
// Inject SDK object as exports, see https://github.com/ChromeDevTools/devtools-frontend/blob/4c46d0969f10f460f2a27116f4896f20f65d0989/front_end/sdk/CookieParser.js
let content = "const SDK = module.exports = {};\n" + fs.readFileSync(filename, "utf8");
module.exports = requireFromString(content, filename);