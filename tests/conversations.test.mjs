import assert from "node:assert/strict";
import test from "node:test";
import { appendConversationTurn, restoreConversations } from "../frontend/conversations.ts";

const sanitize = (value) => Array.isArray(value) ? value.filter((item) => typeof item?.question === "string") : [];
test("separate rooms retain their own context, and continuing a room moves it to the top", () => {
  let rooms = appendConversationTurn([], "food", { question: "새우 음식 추천해줘" }, 10);
  rooms = appendConversationTurn(rooms, "medicine", { question: "약과 함께 먹어도 되나요" }, 20);
  rooms = appendConversationTurn(rooms, "food", { question: "만드는 방법은?" }, 30);
  assert.deepEqual(rooms.map((room) => room.id), ["food", "medicine"]);
  assert.equal(rooms[0].topic, "food");
  assert.equal(rooms[1].topic, "medicine");
  assert.equal(rooms[0].title, "새우 음식 추천해줘");
  assert.equal(rooms[0].turns.length, 2);
  assert.equal(rooms[1].turns.length, 1);
  assert.equal(rooms[0].createdAt, 10);
});
test("legacy history migrates without losing turns or duplicating room snapshots", () => {
  const turns = Array.from({ length: 40 }, (_, i) => ({ question: `혈압 질문 ${i}` }));
  const migrated = restoreConversations(undefined, turns, 100, sanitize);
  assert.equal(migrated[0].turns.length, 40);
  assert.equal(migrated[0].topic, "health");
  assert.deepEqual(restoreConversations(migrated, turns, 100, sanitize), migrated);
});
test("invalid or empty room records are ignored and duplicate ids cannot duplicate rooms", () => {
  const room = appendConversationTurn([], "a", { question: "음식" }, 10)[0];
  assert.equal(restoreConversations([null, {}, room, room, { id: "empty", turns: [] }], [], 20, sanitize).length, 1);
});
