const jwt = require("jsonwebtoken");
const config = require("../config/env");

const ISSUER = "shedrive-api";
const AUDIENCE = "shedrive-web";

function signAccessToken(user) {
  return jwt.sign(
    { role: user.role },
    config.jwt.secret,
    {
      subject: String(user._id || user.id),
      expiresIn: config.jwt.expiresIn,
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

module.exports = { signAccessToken, verifyAccessToken };
