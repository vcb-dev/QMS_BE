import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatMessageDto } from './dto/quote-chat.types';

@Injectable()
export class QuoteChatService {
  private participantCache = new Map<
    string,
    { requesterId: string; assigneeId: string | null; expiresAt: number }
  >();

  constructor(private prisma: PrismaService) {}

  async assertParticipant(quoteRequestId: string, userId: string) {
    const now = Date.now();
    let cached = this.participantCache.get(quoteRequestId);

    if (!cached || cached.expiresAt < now) {
      const request = await this.prisma.quoteRequest.findUnique({
        where: { id: quoteRequestId },
        select: { requesterId: true, assigneeId: true },
      });

      if (!request) {
        throw new ForbiddenException(
          'Bạn không có quyền xem cuộc trò chuyện này',
        );
      }

      cached = {
        requesterId: request.requesterId,
        assigneeId: request.assigneeId,
        expiresAt: now + 5 * 60 * 1000, // Cache 5 phút
      };
      this.participantCache.set(quoteRequestId, cached);
    }

    if (
      cached.requesterId !== userId &&
      cached.assigneeId !== userId
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền xem cuộc trò chuyện này',
      );
    }

    return { requesterId: cached.requesterId, assigneeId: cached.assigneeId };
  }

  async saveMessage(
    quoteRequestId: string,
    userId: string,
    content?: string,
    imageUrl?: string,
  ): Promise<ChatMessageDto> {
    await this.assertParticipant(quoteRequestId, userId);

    const trimmedContent = content?.trim();
    if (!trimmedContent && !imageUrl) {
      throw new BadRequestException(
        'Tin nhắn phải có nội dung hoặc ảnh đính kèm',
      );
    }

    const created = await this.prisma.quoteChatMessage.create({
      data: {
        quoteRequestId,
        senderId: userId,
        content: trimmedContent || null,
        imageUrl: imageUrl || null,
      },
      include: { sender: { select: { name: true } } },
    });

    return {
      id: created.id,
      quoteRequestId: created.quoteRequestId,
      senderId: created.senderId,
      senderName: created.sender.name,
      content: created.content,
      imageUrl: created.imageUrl,
      createdAt: created.createdAt,
    };
  }

  async getMessages(quoteRequestId: string, userId: string) {
    await this.assertParticipant(quoteRequestId, userId);

    const read = await this.prisma.quoteChatRead.findUnique({
      where: { quoteRequestId_userId: { quoteRequestId, userId } },
    });
    const since = read?.lastReadAt ?? new Date(0);

    const [rows, unreadCount] = await Promise.all([
      this.prisma.quoteChatMessage.findMany({
        where: { quoteRequestId },
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { name: true } } },
      }),
      this.prisma.quoteChatMessage.count({
        where: {
          quoteRequestId,
          createdAt: { gt: since },
          senderId: { not: userId },
        },
      }),
    ]);

    const messages: ChatMessageDto[] = rows.map((m: any) => ({
      id: m.id,
      quoteRequestId: m.quoteRequestId,
      senderId: m.senderId,
      senderName: m.sender.name,
      content: m.content,
      imageUrl: m.imageUrl,
      createdAt: m.createdAt,
    }));

    return { messages, unreadCount };
  }

  async markRead(quoteRequestId: string, userId: string): Promise<void> {
    await this.assertParticipant(quoteRequestId, userId);

    await this.prisma.quoteChatRead.upsert({
      where: { quoteRequestId_userId: { quoteRequestId, userId } },
      create: { quoteRequestId, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
  }
}
