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
import { corsOriginDelegate } from '../utils/cors-origin.util';
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
    origin: corsOriginDelegate(APP_CONSTANTS.CORS_ORIGINS),
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

  // Đơn đang THỰC SỰ mở xem (không phải chỉ join để nhận badge) — tối đa 1 đơn/socket tại 1 thời
  // điểm, set khi client đọc tin (markRead, tức đã mở popup chat) hoặc join không đánh dấu passive
  // (DetailPage xem 1 đơn, hoặc bấm mở chat thẳng từ bảng Danh Sách). Dùng RIÊNG để quyết định có
  // bắc cầu Lark DM hay không (maybeBridgeToLark) — KHÔNG suy từ việc socket có ở trong phòng
  // socket.io hay không nữa, vì giờ 1 socket có thể ở NHIỀU phòng cùng lúc (xem dưới).
  private activeChatRequest = new Map<string, string>(); // clientId -> quoteRequestId

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
    this.activeChatRequest.delete(client.id);
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
        // Chỉ access token mới mở được socket — refresh token sống dài hơn nhiều.
        if (payload.type === 'refresh') {
          next(new Error('Unauthorized'));
          return;
        }
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
  // Xử lý sự kiện joinRequest từ client FE: xác thực user, kiểm tra quyền truy cập cuộc trò chuyện,
  // tham gia phòng chat tương ứng (socket.io room — chỉ để NHẬN broadcast, 1 socket có thể ở nhiều
  // phòng cùng lúc, VD bảng Danh Sách join hết các đơn đang hiển thị để nhận badge tin chưa đọc
  // real-time). `passive: true` = join kiểu đó (không tính "đang xem", không reset Lark pending) —
  // mặc định (không truyền hoặc false) = đang THỰC SỰ mở xem đúng đơn này (DetailPage, hoặc bấm mở
  // chat thẳng từ Danh Sách), set activeChatRequest + báo Lark biết user đã tương tác.
  @SubscribeMessage('joinRequest')
  async handleJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { quoteRequestId: string; passive?: boolean },
  ) {
    const userId = client.data.user?.id;
    if (!userId) return;

    try {
      await this.quoteChatService.assertParticipant(
        data.quoteRequestId,
        userId,
      );
      client.join(this.roomName(data.quoteRequestId));
      if (!data.passive) {
        this.activeChatRequest.set(client.id, data.quoteRequestId);
        void this.lark.onRecipientEngaged(data.quoteRequestId, userId);
      }
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
      // Đọc tin = chắc chắn đang mở xem đúng đơn này — cùng tín hiệu với joinRequest không passive.
      this.activeChatRequest.set(client.id, data.quoteRequestId);
      void this.lark.onRecipientEngaged(data.quoteRequestId, userId);
    } catch (err: any) {
      this.logger.warn(
        `Lỗi khi đánh dấu đã đọc tin nhắn (quoteRequestId: ${data.quoteRequestId}, userId: ${userId}): ${err.message}`,
      );
    }
  }

  // Sau khi lưu tin web: nếu người còn lại KHÔNG đang THỰC SỰ mở xem đúng đơn này thì bắc cầu DM
  // sang Lark. Không đặt `private` để test đơn vị gọi trực tiếp. Fire-and-forget: tự nuốt lỗi.
  //
  // Dò qua activeChatRequest (đơn đang mở xem của từng socket) thay vì fetchSockets() trong phòng
  // socket.io — phòng giờ có thể chứa cả socket chỉ join "passive" để nhận badge (bảng Danh Sách),
  // không có nghĩa họ đang thực sự xem đúng đơn này.
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

      const recipientInRoom = [...this.server.sockets.sockets.values()].some(
        (s) =>
          (s as AuthedSocket).data?.user?.id === recipientId &&
          this.activeChatRequest.get(s.id) === quoteRequestId,
      );

      await this.lark.onWebMessage(message, recipientId, recipientInRoom);
    } catch (err: any) {
      this.logger.warn(
        `Cầu Lark DM lỗi (quote ${quoteRequestId}): ${err?.message ?? err}`,
      );
    }
  }
}
