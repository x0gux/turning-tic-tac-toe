"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  OnlineState,
  Player,
  ServerMessage,
} from "@/lib/tic-tac-toe";

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "in-room"
  | "reconnecting"
  | "disconnected";

export type SpinEvent = { seq: number; dir: -1 | 1 };

/**
 * 좌석 재접속 토큰. 소켓이 끊겨도 (새로고침 포함) 이 토큰으로
 * 같은 방 같은 자리에 다시 앉는다. 탭 세션 동안만 유지한다.
 */
type Session = { code: string; token: string };

const SESSION_KEY = "tic-tac-toe:online-session";
const MAX_RECONNECT_DELAY_MS = 10_000;

function resolveWsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // 로컬 개발 서버는 /ws, Vercel 배포는 /api/ws (route handler)를 쓴다.
  const path = process.env.NODE_ENV === "production" ? "/api/ws" : "/ws";
  return `${protocol}//${window.location.host}${path}`;
}

function loadSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return typeof parsed.code === "string" && typeof parsed.token === "string" && parsed.token
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 저장소를 쓸 수 없는 환경에서는 세션 복구만 포기한다
  }
}

type OpenMode = { kind: "create" } | { kind: "join"; code: string } | { kind: "resume" };

export function useOnlineGame() {
  const wsRef = useRef<WebSocket | null>(null);
  const phaseRef = useRef<ConnectionPhase>("idle");
  const sessionRef = useRef<Session | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [code, setCode] = useState("");
  const [you, setYou] = useState<Player | null>(null);
  const [state, setState] = useState<OnlineState | null>(null);
  const [spin, setSpin] = useState<SpinEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPhaseSafe = useCallback((next: ConnectionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current === null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const sendMessage = useCallback((message: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(message));
  }, []);

  const openSocket = useCallback(
    (mode: OpenMode, onOpen: () => void) => {
      clearReconnectTimer();

      // 이전 소켓을 먼저 떼어낸다 — 닫히는 이벤트가 재접속을 유발하지 않게
      const previous = wsRef.current;
      wsRef.current = null;
      previous?.close();

      const ws = new WebSocket(resolveWsUrl());
      wsRef.current = ws;
      setPhaseSafe("connecting");
      setError(null);
      setState(null);
      setYou(null);
      setCode("");
      setSpin(null);

      ws.onopen = () => onOpen();

      ws.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        switch (message.type) {
          case "welcome":
            setCode(message.code);
            setYou(message.you);
            attemptRef.current = 0;
            if (message.token) {
              const session = { code: message.code, token: message.token };
              sessionRef.current = session;
              saveSession(session);
            } else {
              // 관전자는 재접속 세션이 없다
              sessionRef.current = null;
              saveSession(null);
            }
            break;
          case "state":
            setState(message.state);
            setYou(message.you);
            if (message.event === "rotated" && message.state.lastDir) {
              setSpin({
                seq: message.state.rotations,
                dir: message.state.lastDir,
              });
            }
            break;
          case "notice":
            showNotice(message.text);
            break;
          case "error":
            if (phaseRef.current === "in-room") {
              showNotice(message.message);
            } else if (phaseRef.current === "reconnecting") {
              // 재접속이 거부됐다(방 소멸, 토큰 만료) — 포기하고 로비로
              sessionRef.current = null;
              saveSession(null);
              clearReconnectTimer();
              setPhaseSafe("idle");
              setError(message.message);
            } else {
              setError(message.message);
            }
            break;
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // 새 소켓으로 교체된 이전 소켓
        wsRef.current = null;

        if (intentionalCloseRef.current) {
          intentionalCloseRef.current = false;
          return;
        }

        if (sessionRef.current) {
          scheduleReconnectRef.current();
          return;
        }
        if (phaseRef.current === "connecting") {
          setPhaseSafe("idle");
          setError("서버에 연결할 수 없어요");
          return;
        }
        setPhaseSafe("disconnected");
        showNotice("서버와의 연결이 끊겼어요");
      };
    },
    [clearReconnectTimer, setPhaseSafe, showNotice],
  );

  /** Vercel에서는 함수 최대 실행 시간에 연결이 끊긴다 — 끊김은 예정된 일이다 */
  const scheduleReconnect = useCallback(() => {
    setPhaseSafe("reconnecting");
    showNotice("연결이 잠시 끊겨 다시 접속하는 중…");

    const delay = Math.min(1000 * 2 ** attemptRef.current, MAX_RECONNECT_DELAY_MS);
    attemptRef.current += 1;

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (wsRef.current || !sessionRef.current) return;
      openSocket({ kind: "resume" }, () => {
        const session = sessionRef.current;
        if (session) sendMessage({ type: "resume", code: session.code, token: session.token });
      });
    }, delay);
  }, [openSocket, sendMessage, setPhaseSafe, showNotice]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  const createRoom = useCallback(() => {
    openSocket({ kind: "create" }, () => sendMessage({ type: "create" }));
  }, [openSocket, sendMessage]);

  const joinRoom = useCallback(
    (rawCode: string) => {
      const normalized = rawCode.trim().toUpperCase();
      openSocket({ kind: "join", code: normalized }, () =>
        sendMessage({ type: "join", code: normalized }),
      );
    },
    [openSocket, sendMessage],
  );

  const play = useCallback(
    (index: number) => {
      sendMessage({ type: "move", index });
    },
    [sendMessage],
  );

  const requestRematch = useCallback(() => {
    sendMessage({ type: "rematch" });
  }, [sendMessage]);

  const leave = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "leave" } satisfies ClientMessage));
    }
    ws?.close();

    sessionRef.current = null;
    saveSession(null);
    attemptRef.current = 0;
    setPhaseSafe("idle");
    setState(null);
    setYou(null);
    setCode("");
    setSpin(null);
    setNotice(null);
    setError(null);
  }, [clearReconnectTimer, setPhaseSafe]);

  // 소켓이 열리고 첫 메시지를 받으면 in-room 상태로 전환한다.
  useEffect(() => {
    if (
      (phase === "connecting" || phase === "reconnecting") &&
      state !== null
    ) {
      setPhaseSafe("in-room");
    }
  }, [phase, state, setPhaseSafe]);

  // 새로고침 등으로 세션이 남아 있으면 자동으로 방에 다시 앉는다.
  useEffect(() => {
    const stored = loadSession();
    if (!stored) return;
    sessionRef.current = stored;
    openSocket({ kind: "resume" }, () => {
      const session = sessionRef.current;
      if (session) sendMessage({ type: "resume", code: session.code, token: session.token });
    });
  }, [openSocket, sendMessage]);

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      clearReconnectTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [clearReconnectTimer]);

  return {
    phase,
    code,
    you,
    state,
    spin,
    notice,
    error,
    createRoom,
    joinRoom,
    play,
    requestRematch,
    leave,
  };
}
