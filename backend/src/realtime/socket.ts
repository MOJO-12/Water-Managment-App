import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { corsOrigins } from '../config/env';
import { verifyAccessToken } from '../modules/auth/token.service';

let io: Server | undefined;


export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, { serveClient: false, cors: { origin: corsOrigins } });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.['token'];
      if (typeof token !== 'string') throw new Error('missing token');
      socket.data['auth'] = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data['auth'] as { userId: string; role: string };
    void socket.join(`user:${userId}`);
    if (role === 'ADMIN') void socket.join('admins');
    if (role === 'DRIVER') void socket.join('drivers');
  });
  return io;
}

export const emitToUser = (userId: string, event: string, payload: unknown) => void io?.to(`user:${userId}`).emit(event, payload);
export const emitToAdmins = (event: string, payload: unknown) => void io?.to('admins').emit(event, payload);
export const closeSocket = () => void io?.close();
