"use client";

import { useEffect, useMemo, useState } from "react";
import type { SeniorSnapshot } from "../backend/services/careData";
import { readStore, writeStore } from "./localStore";

type Language = "ko-KR" | "en-US" | "ja-JP";

export type CareLinkState = {
  version: 1;
  deviceId: string;
  deviceSecret: string;
  displayName: string;
  lastSyncedAt: number | null;
  linkedCaregiverCount: number;
};

export const CARE_LINK_STORE_KEY = "care-link-v1";

const copy = {
  "ko-KR": {
    eyebrow: "돌봄이와 안전하게 연결",
    title: "연결 코드 받기",
    help: "코드를 돌봄이에게 알려주면 내 건강정보와 최근 대화가 돌봄이 화면에 연결됩니다.",
    name: "돌봄이 화면에 보일 이름",
    placeholder: "예: 김OO 어르신",
    create: "한국어 연결 코드 만들기",
    creating: "코드 만드는 중…",
    codeHelp: "한글 낱말과 숫자를 차례로 읽어 주세요. 이 코드는 10분 동안 한 번만 사용할 수 있어요.",
    linked: "명의 돌봄이와 연결됨",
    synced: "마지막 전달",
    privacy: "로그인은 필요 없어요. 연결 후 이 기기에서 바뀐 정보만 안전하게 전달합니다.",
    failed: "연결 코드를 만들지 못했습니다. 잠시 후 다시 눌러주세요.",
    syncing: "정보 전달 중…",
  },
  "en-US": {
    eyebrow: "Connect securely with a caregiver",
    title: "Get a linking code",
    help: "Give this code to your caregiver to share your health profile and recent chats.",
    name: "Name shown to caregiver",
    placeholder: "Example: Mom",
    create: "Create English linking code",
    creating: "Creating code…",
    codeHelp: "Read the English words and numbers in order. The code works once for 10 minutes.",
    linked: " caregiver(s) connected",
    synced: "Last shared",
    privacy: "No sign-in is needed. Changes made on this device are shared after linking.",
    failed: "Could not create a code. Please try again.",
    syncing: "Sharing updates…",
  },
  "ja-JP": {
    eyebrow: "介護者と安全に連携",
    title: "連携コードを受け取る",
    help: "このコードを介護者に伝えると、健康情報と最近の会話を共有できます。",
    name: "介護者画面に表示する名前",
    placeholder: "例：母",
    create: "日本語の連携コードを作る",
    creating: "コードを作成中…",
    codeHelp: "ひらがなの単語と数字を順番に伝えてください。10分間に1回だけ使えます。",
    linked: "人の介護者と連携中",
    synced: "最終共有",
    privacy: "ログインは不要です。連携後、この端末で変更した情報だけを共有します。",
    failed: "コードを作れませんでした。もう一度お試しください。",
    syncing: "情報を共有中…",
  },
} as const;

export function isCareLinkState(value: unknown): value is CareLinkState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CareLinkState>;
  return Boolean(candidate.deviceId && candidate.deviceSecret);
}

export default function SeniorCareLinkPanel({
  language,
  snapshot,
}: {
  language: Language;
  snapshot: SeniorSnapshot;
}) {
  const activeCopy = copy[language];
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState<CareLinkState | null>(null);
  const [displayName, setDisplayName] = useState("어르신");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState("");
  const serializedSnapshot = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const deviceId = link?.deviceId ?? "";
  const deviceSecret = link?.deviceSecret ?? "";

  useEffect(() => {
    let cancelled = false;
    void readStore<CareLinkState>(CARE_LINK_STORE_KEY).then((stored) => {
      if (cancelled) return;
      if (isCareLinkState(stored)) {
        setLink(stored);
        setDisplayName(stored.displayName || "어르신");
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !deviceId || !deviceSecret) return;
    const timer = window.setTimeout(() => {
      setIsSyncing(true);
      void fetch("/api/senior/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          deviceSecret,
          displayName: displayName.trim().slice(0, 30),
          snapshot: JSON.parse(serializedSnapshot) as SeniorSnapshot,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("SYNC_FAILED");
          return response.json() as Promise<{
            syncedAt: number;
            linkedCaregiverCount: number;
          }>;
        })
        .then((result) => {
          setLink((current) => {
            if (!current) return current;
            const next: CareLinkState = {
              ...current,
              displayName: displayName.trim().slice(0, 30) || "어르신",
              lastSyncedAt: result.syncedAt,
              linkedCaregiverCount: result.linkedCaregiverCount,
            };
            void writeStore(CARE_LINK_STORE_KEY, next);
            return next;
          });
        })
        .catch(() => undefined)
        .finally(() => setIsSyncing(false));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [deviceId, deviceSecret, displayName, ready, serializedSnapshot]);

  useEffect(() => {
    if (!expiresAt) return;
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = window.setTimeout(() => setCode(""), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const createCode = async () => {
    if (isCreating) return;
    setIsCreating(true);
    setError("");
    setCode("");
    try {
      const response = await fetch("/api/senior/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: link?.deviceId,
          deviceSecret: link?.deviceSecret,
          displayName: displayName.trim().slice(0, 30),
          language,
          snapshot,
        }),
      });
      const result = (await response.json()) as {
        deviceId?: string;
        deviceSecret?: string;
        code?: string;
        expiresAt?: number;
        error?: string;
      };
      if (!response.ok || !result.deviceId || !result.deviceSecret || !result.code) {
        throw new Error(result.error || activeCopy.failed);
      }
      const next: CareLinkState = {
        version: 1,
        deviceId: result.deviceId,
        deviceSecret: result.deviceSecret,
        displayName: displayName.trim().slice(0, 30) || "어르신",
        lastSyncedAt: Date.now(),
        linkedCaregiverCount: link?.linkedCaregiverCount ?? 0,
      };
      await writeStore(CARE_LINK_STORE_KEY, next);
      setLink(next);
      setCode(result.code);
      setExpiresAt(result.expiresAt ?? Date.now() + 10 * 60 * 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : activeCopy.failed);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="senior-link-card" aria-labelledby="senior-link-title">
      <div className="senior-link-copy">
        <span>{activeCopy.eyebrow}</span>
        <h2 id="senior-link-title">{activeCopy.title}</h2>
        <p>{activeCopy.help}</p>
        <label htmlFor="senior-link-name">{activeCopy.name}</label>
        <input
          id="senior-link-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value.slice(0, 30))}
          placeholder={activeCopy.placeholder}
          autoComplete="off"
        />
      </div>
      <div className="senior-link-action">
        {code && expiresAt ? (
          <div className="senior-link-code" role="status" aria-live="polite">
            <strong>{code}</strong>
            <small>{activeCopy.codeHelp}</small>
          </div>
        ) : null}
        <button type="button" onClick={() => void createCode()} disabled={!ready || isCreating}>
          {isCreating ? activeCopy.creating : activeCopy.create}
        </button>
        {link && (
          <p className="senior-link-status">
            <strong>{link.linkedCaregiverCount}{activeCopy.linked}</strong>
            {link.lastSyncedAt && (
              <span>
                {isSyncing
                  ? activeCopy.syncing
                  : `${activeCopy.synced}: ${new Date(link.lastSyncedAt).toLocaleString(language)}`}
              </span>
            )}
          </p>
        )}
        {error && <p className="senior-link-error" role="alert">{error}</p>}
        <small className="senior-link-privacy">{activeCopy.privacy}</small>
      </div>
    </section>
  );
}
