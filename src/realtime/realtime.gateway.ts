import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import {
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';

import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { APP_CONSTANTS } from '../common/constants';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { COOKIE_ACCESS } from '../auth/cookie/cookie.constants';
import { QuoteChatService } from '../quote-chat/quote-chat.service';
import { LarkService } from '../lark/lark.service';
import { ChatMessageDto } from '../quote-chat/dto/quote-chat.types';

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
    origin: APP_CONSTANTS.CORS_ORIGINS,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  // Rate limit gửi tin nhắn: tối đa MAX_MESSAGES tin trong RATE_WINDOW_MS mỗi socket.
  private static readonly RATE_WINDOW_MS = 3000;
  private static readonly MAX_MESSAGES = 5;
  private messageTimestamps = new Map<string, number[]>();

  // Mỗi socket chỉ ở 1 phòng chat tại 1 thời điểm — tránh giữ mapping room thừa khi client
  // chuyển qua lại giữa nhiều yêu cầu báo giá mà không ngắt kết nối socket.
  private currentChatRoom = new Map<string, string>();

  constructor(
    private readonly quoteChatService: QuoteChatService,
    private readonly jwtService: JwtService,
    private readonly lark: LarkService,
  ) {}

  // Reply từ Lark DM -> bắn vào đúng room chat như tin web thường.
  onModuleInit() {
    this.lark.reply$.subscribe((dto) => {
      this.server.to(this.roomName(dto.quoteRequestId)).emit('newMessage', dto);
    });
  }

  handleDisconnect(client: AuthedSocket) {
    this.messageTimestamps.delete(client.id);
    this.currentChatRoom.delete(client.id);
  }
  //Tự động chạy máy chủ Socket và xác thực socket bằng JWT (từ cookie hoặc từ token trong handshake.auth) — nếu không hợp lệ thì từ chối kết nối.
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

  // Trích xuất token JWT từ cookie (nếu có) để xác thực socket — nếu không có token trong handshake.auth thì dùng cookie.
  private extractTokenFromCookie(cookieHeader?: string): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_ACCESS}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Broadcast sự kiện statusChanged cho tất cả socket đã xác thực — không cần room riêng.
  broadcastStatusChanged(quoteRequestId: string, status: string) {
    this.server.emit('statusChanged', { quoteRequestId, status });
  }

  // Tạo tên phòng chat dựa trên quoteRequestId để phân biệt các cuộc trò chuyện khác nhau.
  private roomName(quoteRequestId: string) {
    return `quote-chat:${quoteRequestId}`;
  }
  // Xử lý sự kiện joinRequest từ client FE: xác thực user, kiểm tra quyền truy cập cuộc trò chuyện, tham gia phòng chat tương ứng.
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
      const newRoom = this.roomName(data.quoteRequestId);
      const oldRoom = this.currentChatRoom.get(client.id);
      if (oldRoom && oldRoom !== newRoom) client.leave(oldRoom);
      client.join(newRoom);
      this.currentChatRoom.set(client.id, newRoom);
      void this.lark.onRecipientEngaged(data.quoteRequestId, userId);
    } catch {
      client.emit('error', {
        message: 'Bạn không có quyền xem cuộc trò chuyện này',
      });
    }
  }

  // Xử lý sự kiện sendMessage từ client FE: xác thực user, kiểm tra quyền truy cập cuộc trò chuyện, lưu tin nhắn và phát broadcast cho tất cả socket trong phòng chat.
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

    const now = Date.now();
    const timestamps = (this.messageTimestamps.get(client.id) || []).filter(
      (t) => now - t < RealtimeGateway.RATE_WINDOW_MS,
    );
    if (timestamps.length >= RealtimeGateway.MAX_MESSAGES) {
      client.emit('error', {
        message: 'Bạn đang gửi tin nhắn quá nhanh, vui lòng chờ một chút',
      });
      return;
    }
    timestamps.push(now);
    this.messageTimestamps.set(client.id, timestamps);

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
      void this.maybeBridgeToLark(data.quoteRequestId, userId, message);
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
      void this.lark.onRecipientEngaged(data.quoteRequestId, userId);
    } catch (err: any) {
      this.logger.warn(
        `Lỗi khi đánh dấu đã đọc tin nhắn (quoteRequestId: ${data.quoteRequestId}, userId: ${userId}): ${err.message}`,
      );
    }
  }

  // Sau khi lưu tin web: nếu người còn lại KHÔNG đang mở room này thì bắc cầu DM sang Lark.
  // Không đặt `private` để test đơn vị gọi trực tiếp. Fire-and-forget: tự nuốt lỗi.
  async maybeBridgeToLark(
    quoteRequestId: string,
    senderId: string,
    message: ChatMessageDto,
  ): Promise<void> {
    try {
      const { requesterId, assigneeId } =
        await this.quoteChatService.assertParticipant(quoteRequestId, senderId);
      const recipientId = senderId === requesterId ? assigneeId : requesterId;
      if (!recipientId) return;

      const sockets = await this.server
        .in(this.roomName(quoteRequestId))
        .fetchSockets();
      const recipientInRoom = sockets.some(
        (s) => (s.data as AuthedSocket['data'])?.user?.id === recipientId,
      );

      await this.lark.onWebMessage(message, recipientId, recipientInRoom);
    } catch (err: any) {
      this.logger.warn(
        `Cầu Lark DM lỗi (quote ${quoteRequestId}): ${err?.message ?? err}`,
      );
    }
  }
}
