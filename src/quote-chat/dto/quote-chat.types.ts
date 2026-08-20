export interface ChatMessageDto {
  id: string;
  quoteRequestId: string;
  senderId: string;
  senderName: string;
  content: string | null;
  imageUrl: string | null;
  createdAt: Date;
  tempId?: string;
}
