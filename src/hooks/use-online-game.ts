"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  OnlineEvent,
  OnlineState,
  Player,
  ServerMessage,
} from "@/lib/tic-tac-toe";

export type ConnectionPhase = "idle" | "connecting" | "in-room" | "disconnected";

export type SpinEvent = { seq: number; dir: -1 | 1 };

export function useOnlineGame() {
  const wsRef = useRef<WebSocket | null>(null);
  const phaseRef = useRef<ConnectionPhase>("idle");

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

  const openSocket = useCallback(
    (onOpen: () => void) => {
      wsRef.current?.close();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
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
            if (phaseRef.current === "in-room") showNotice(message.message);
            else setError(message.message);
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (phaseRef.current === "in-room") {
          setPhaseSafe("disconnected");
          showNotice("서버와의 연결이 끊어졌어요");
        } else if (phaseRef.current === "connecting") {
          setPhaseSafe("idle");
          setError("서버에 연결할 수 없어요");
        }
      };
    },
    [setPhaseSafe, showNotice],
  );

  const sendMessage = useCallback((message: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(message));
  }, []);

  const createRoom = useCallback(() => {
    openSocket(() => sendMessage({ type: "create" }));
  }, [openSocket, sendMessage]);

  const joinRoom = useCallback(
    (rawCode: string) => {
      const normalized = rawCode.trim().toUpperCase();
      openSocket(() => sendMessage({ type: "join", code: normalized }));
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
    wsRef.current?.close();
    wsRef.current = null;
    setPhaseSafe("idle");
    setState(null);
    setYou(null);
    setCode("");
    setSpin(null);
    setNotice(null);
    setError(null);
  }, [setPhaseSafe]);

  // 소켓이 열리고 첫 메시지를 받으면 in-room 상태로 전환한다.
  useEffect(() => {
    if (phase === "connecting" && state !== null) setPhaseSafe("in-room");
  }, [phase, state, setPhaseSafe]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

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
