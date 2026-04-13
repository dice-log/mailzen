export interface MailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  authResults: string;
}

export interface MailAdapter {
  fetchUnreadMessages(): Promise<MailMessage[]>;
  resolveLabels(labelNames: string[]): Promise<Map<string, string>>;
  addLabel(messageId: string, labelId: string, options?: { markAsRead: boolean }): Promise<void>;
}
