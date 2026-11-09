import { io } from "socket.io-client";
import { getToken } from "./api.js";

let socket = null;

export function getSocket() {
  const token = getToken();
  if (!token) return null;

  if (!socket) {
    socket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      auth: { token },
      autoConnect: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 700,
      reconnectionDelayMax: 5000,
    });
  }

  return socket;
}

export function joinRide(socketInstance, rideId) {
  if (!socketInstance || !rideId) return;
  socketInstance.emit("ride:join", { rideId }, (response) => {
    if (response && response.ok === false) {
      socketInstance.emit("ride:leave", { rideId });
    }
  });
}

export function leaveRide(socketInstance, rideId) {
  if (socketInstance && rideId) socketInstance.emit("ride:leave", { rideId });
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}
