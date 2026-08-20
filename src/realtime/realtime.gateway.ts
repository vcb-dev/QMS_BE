import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { COOKIE_ACCESS } from '../auth/cookie.constants';
import { QuoteChatService } from 'src/quote-chat/quote-chat.service';

interface AuthedSocket extends Socket {
  data: { user?: { id: string; email: string; role: string } };
}

// Gateway dùng chung namespace mặc định "/" cho cả 2 nhóm sự kiện: real-time toàn app
// (statusChanged — broadcast không cần room, mọi socket đã xác thực đều nhận như nhau) và
// chat theo từng yêu cầu báo giá (joinRequest/sendMessage/markRead — có room, gộp về từ
// QuoteChatGateway cũ). 2 client FE (AppShell connect 1 lần lúc đăng nhập, DetailPage connect
// riêng khi mở 1 yêu cầu) cùng nối vào namespace này.
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor( private readonly quoteChatService: QuoteChatService,private readonly jwtService: JwtService) {}

  afterInit(server: Server) {
    server.use(async (socket: AuthedSocket, next) => {
      const handshakeToken = socket.handshake.auth?.token as string | undefined;
      const token =
        handshakeToken ||
        this.extractTokenFromCookie(socket.handshake.headers.cookie);

      if (!token) {
        next(new Error('Unauthorized'));
        return;
      }

      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
        socket.data.user = {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
        };
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  private extractTokenFromCookie(cookieHeader?: string): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_ACCESS}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  broadcastStatusChanged(quoteRequestId: string, status: string) {
    this.server.emit('statusChanged', { quoteRequestId, status });
  }

private roomName(quoteRequestId: string) {
    return `quote-chat:${quoteRequestId}`;
  }

  @SubscribeMessage('joinRequest')
  async handleJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { quoteRequestId: string },
  ) {
    const userId = client.data.user?.id;
    if (!userId) return;

    try {
      await this.quoteChatService.assertParticipant(
        data.quoteRequestId,
        userId,
      );
      client.join(this.roomName(data.quoteRequestId));
    } catch {
      client.emit('error', {
        message: 'Bạn không có quyền xem cuộc trò chuyện này',
      });
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    data: {
      quoteRequestId: string;
      content?: string;
      imageUrl?: string;
      tempId?: string;
    },
  ) {
    const userId = client.data.user?.id;
    if (!userId) return;

    try {
      const message = await this.quoteChatService.saveMessage(
        data.quoteRequestId,
        userId,
        data.content,
        data.imageUrl,
      );
      this.server
        .to(this.roomName(data.quoteRequestId))
        .emit('newMessage', { ...message, tempId: data.tempId });
    } catch (err: any) {
      // Không lộ nội dung lỗi nội bộ (vd chi tiết query Prisma) ra client — chỉ pass qua
      // message của 2 exception nghiệp vụ đã biết, còn lại thay bằng thông báo chung.
      const message =
        err instanceof ForbiddenException || err instanceof BadRequestException
          ? err.message
          : 'Không thể gửi tin nhắn';
      client.emit('error', { message });
    }
  }

  @SubscribeMessage('markRead')
  async handleMarkRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { quoteRequestId: string },
  ) {
    const userId = client.data.user?.id;
    if (!userId) return;

    try {
      await this.quoteChatService.markRead(data.quoteRequestId, userId);
    } catch {
      // Im lặng bỏ qua — markRead không phải thao tác người dùng chủ động thấy kết quả trực tiếp.
    }
  }

}
