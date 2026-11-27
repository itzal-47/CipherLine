export interface RecentContextMessage {
  senderNickname: string;
  plaintext: string;
}

export function buildRecentContext(messages: RecentContextMessage[], include: boolean): string {
  if (!include) return '';
  return messages.map((message) => `${message.senderNickname}: ${message.plaintext}`).join('\n');
}
