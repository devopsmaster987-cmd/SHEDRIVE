const AppError = require("../utils/AppError");
const serializeNotification = require("../utils/serializeNotification");
const notificationRepository = require("../repositories/notificationRepository");

async function list(req, res) {
  const [notifications, unread] = await Promise.all([
    notificationRepository.listForUser(req.user._id, { limit: req.query.limit }),
    notificationRepository.countUnread(req.user._id),
  ]);

  res.json({
    success: true,
    data: {
      notifications: notifications.map(serializeNotification),
      unread,
    },
    error: null,
  });
}

async function markRead(req, res) {
  const notification = await notificationRepository.markRead(req.params.id, req.user._id);
  if (!notification) {
    throw new AppError("Notification not found.", {
      status: 404,
      code: "NOTIFICATION_NOT_FOUND",
    });
  }

  res.json({
    success: true,
    data: { notification: serializeNotification(notification) },
    error: null,
  });
}

async function markAllRead(req, res) {
  await notificationRepository.markAllRead(req.user._id);
  res.json({ success: true, data: { unread: 0 }, error: null });
}

module.exports = { list, markRead, markAllRead };
