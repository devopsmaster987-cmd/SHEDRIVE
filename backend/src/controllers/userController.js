const AppError = require("../utils/AppError");
const serializeUser = require("../utils/serializeUser");
const userRepository = require("../repositories/userRepository");

async function getMe(req, res) {
  res.json({ success: true, data: { user: serializeUser(req.user) }, error: null });
}

async function updateMe(req, res) {
  const updated = await userRepository.updateById(req.user._id, {
    name: req.body.name,
    emergencyContacts: req.body.emergencyContacts,
  });

  if (!updated) {
    throw new AppError("Your account could not be found.", {
      status: 404,
      code: "ACCOUNT_NOT_FOUND",
    });
  }

  res.json({ success: true, data: { user: serializeUser(updated) }, error: null });
}

module.exports = { getMe, updateMe };
