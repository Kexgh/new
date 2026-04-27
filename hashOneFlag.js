const crypto = require("crypto");

const flag = "FLAG{you_tried_root}";

const hash = crypto
  .createHash("sha256")
  .update(flag.trim().toLowerCase())
  .digest("hex");

console.log(hash);