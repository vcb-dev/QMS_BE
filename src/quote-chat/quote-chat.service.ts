import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatMessageDto } from './dto/quote-chat.types';

@Injectable()
export class QuoteChatService {
  constructor(private prisma: PrismaService) {}

  async assertParticipant(quoteRequestId: string, userId: string) {
    const request = await this.prisma.quoteRequest.findUnique({
      where: { id: quoteRequestId },
      select: { requesterId: true, assigneeId: true },
    });

    if (!request) {
      throw new ForbiddenException(
        'Bạn không có quyền xem cuộc trò chuyện này',
      );
    }

    if (request.requesterId !== userId && request.assigneeId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem cuộc trò chuyện này',
      );
    }

    return {
      requesterId: request.requesterId,
      assigneeId: request.assigneeId,
    };
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
    if (trimmedContent && trimmedContent.length > 2000) {
      throw new BadRequestException(
        'Nội dung tin nhắn không được vượt quá 2000 ký tự',
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
