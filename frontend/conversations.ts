export type ConversationTopic = "food" | "medicine" | "health";
export type ConversationRoom<T> = {
  id: string;
  title: string;
  topic: ConversationTopic;
  createdAt: number;
  updatedAt: number;
  turns: T[];
};

export function newConversationId() {
  return `room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function conversationTopic(question: string): ConversationTopic {
  if (/약|복용|알약|medicine|medication|pill|薬/i.test(question)) return "medicine";
  if (/건강|혈압|혈당|당뇨|증상|질환|health|symptom|健康|血圧/i.test(question)) return "health";
  return "food";
}

export function appendConversationTurn<T extends { question: string }>(
  rooms: ConversationRoom<T>[], id: string, turn: T, now = Date.now(),
): ConversationRoom<T>[] {
  const existing = rooms.find((room) => room.id === id);
  const room: ConversationRoom<T> = existing
    ? { ...existing, updatedAt: now, turns: [...existing.turns, turn] }
    : { id, title: turn.question.trim().replace(/\s+/g, " ").slice(0, 48) || "새 대화",
        topic: conversationTopic(turn.question), createdAt: now, updatedAt: now, turns: [turn] };
  return [room, ...rooms.filter((item) => item.id !== id)]
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function restoreConversations<T extends { question: string }>(
  value: unknown, legacyTurns: T[], savedAt: number, sanitize: (value: unknown) => T[],
): ConversationRoom<T>[] {
  const rooms: ConversationRoom<T>[] = [];
  const ids = new Set<string>();
  if (Array.isArray(value)) for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || ids.has(item.id)) continue;
    const turns = sanitize(item.turns);
    if (!turns.length) continue;
    ids.add(item.id);
    rooms.push({ id: item.id,
      title: typeof item.title === "string" ? item.title.slice(0, 80) : turns[0].question.slice(0, 48),
      topic: ["food", "medicine", "health"].includes(item.topic) ? item.topic : conversationTopic(turns[0].question),
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : savedAt,
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : savedAt, turns });
  }
  // Legacy flat records belong to one room; never duplicate records already saved in rooms.
  if (!rooms.length && legacyTurns.length) rooms.push({
    id: `legacy-${savedAt}`, title: legacyTurns[0].question.slice(0, 48) || "이전 대화",
    topic: conversationTopic(legacyTurns[0].question), createdAt: savedAt, updatedAt: savedAt, turns: legacyTurns,
  });
  return rooms.sort((a, b) => b.updatedAt - a.updatedAt);
}
