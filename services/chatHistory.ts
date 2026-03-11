import { ChatMessage } from '@/lib/types';
import { uid } from '@/lib/utils';

const STORAGE_KEY = 'aw-chat-history';
const MAX_CONVERSATIONS = 50;

export interface SavedConversation {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New conversation';
  return first.content.length > 60
    ? first.content.slice(0, 57) + '...'
    : first.content;
}

function derivePreview(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type !== 'thinking') {
      const content = messages[i].content;
      return content.length > 80 ? content.slice(0, 77) + '...' : content;
    }
  }
  return '';
}

function readStorage(): SavedConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedConversation[];
  } catch {
    return [];
  }
}

function writeStorage(conversations: SavedConversation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function loadHistory(): SavedConversation[] {
  return readStorage().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function saveConversation(
  messages: ChatMessage[],
  existingId?: string | null,
): string | null {
  if (messages.length < 2) return null;

  const conversations = readStorage();
  const now = new Date().toISOString();
  const title = deriveTitle(messages);
  const preview = derivePreview(messages);

  if (existingId) {
    const idx = conversations.findIndex((c) => c.id === existingId);
    if (idx !== -1) {
      conversations[idx] = {
        ...conversations[idx],
        title,
        preview,
        messageCount: messages.length,
        updatedAt: now,
        messages,
      };
      writeStorage(conversations);
      return existingId;
    }
  }

  const id = uid();
  conversations.unshift({
    id,
    title,
    preview,
    messageCount: messages.length,
    createdAt: now,
    updatedAt: now,
    messages,
  });

  // Prune oldest beyond cap
  if (conversations.length > MAX_CONVERSATIONS) {
    conversations.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    conversations.length = MAX_CONVERSATIONS;
  }

  writeStorage(conversations);
  return id;
}

export function getConversation(id: string): SavedConversation | null {
  return readStorage().find((c) => c.id === id) ?? null;
}

export function deleteConversation(id: string): void {
  const conversations = readStorage().filter((c) => c.id !== id);
  writeStorage(conversations);
}
