/**
 * 온라인 대전 서버의 공통 타입.
 *
 * 방 상태는 프로세스 메모리가 아니라 "스냅샷"으로 다룬다:
 * - 로컬 개발 서버는 메모리 Map에 스냅샷을 보관하고
 * - Vercel 배포에서는 Redis에 보관해 여러 함수 인스턴스가 같은 방을 본다.
 */
import type { OnlineEvent, OnlineState, Player } from "@/lib/tic-tac-toe";

/** 저장소에 보관되는 방 한 개의 직렬화 가능한 스냅샷 */
export type RoomSnapshot = {
  code: string;
  /** X/O 좌석을 잡고 있는 재접속 토큰. null이면 빈 자리 */
  seats: Record<Player, string | null>;
  /** 소켓이 예기치 않게 끊긴 시각(epoch ms). 유예 시간 판정용 */
  away: Record<Player, number | null>;
  state: OnlineState;
};

/** 인스턴스 간 전파되는 방 상태 갱신 */
export type BroadcastMessage = {
  code: string;
  event: OnlineEvent | null;
  state: OnlineState;
  /** 리매치로 X/O 좌석이 뒤바뀜 — 각 인스턴스가 로컬 연결의 mark를 스왑 */
  swap?: boolean;
};

export type ClaimResult =
  | { kind: "seated"; mark: Player; event: OnlineEvent | null; snapshot: RoomSnapshot }
  | { kind: "spectator"; snapshot: RoomSnapshot }
  | { kind: "missing" };

export type ResumeResult =
  | { kind: "seated"; mark: Player; snapshot: RoomSnapshot }
  | { kind: "missing" }
  | { kind: "invalid" };

export type MoveResult =
  | { kind: "applied"; event: OnlineEvent; snapshot: RoomSnapshot }
  | { kind: "invalid" }
  | { kind: "missing" };

export type RematchResult =
  | { kind: "applied"; event: OnlineEvent | null; snapshot: RoomSnapshot; swap: boolean }
  | { kind: "invalid" }
  | { kind: "missing" };

export type AwayResult =
  | { kind: "away"; snapshot: RoomSnapshot }
  | { kind: "missing" };

export type DepartResult =
  | { kind: "left"; event: OnlineEvent | null; snapshot: RoomSnapshot; empty: boolean }
  | { kind: "missing" };

export type StaleResult =
  | { kind: "changed"; event: OnlineEvent; snapshot: RoomSnapshot }
  | { kind: "unchanged" }
  | { kind: "missing" };

/** 방 상태 저장소. 모든 연산은 원자적이어야 한다 (동시 요청 직렬화) */
export type RoomStore = {
  /** 새 방을 만들고 X 좌석을 token으로 예약한다 */
  create(token: string): Promise<RoomSnapshot>;
  /** 빈 좌석에 앉는다. 둘 다 찼으면 관전자 */
  claim(code: string, token: string): Promise<ClaimResult>;
  /** 토큰으로 끊긴 좌석을 되찾는다 */
  resume(code: string, token: string): Promise<ResumeResult>;
  move(code: string, mark: Player, index: number): Promise<MoveResult>;
  rematch(code: string, mark: Player): Promise<RematchResult>;
  /** 예기치 않은 연결 종료 — 라운드는 유예 시간 동안 유지된다 */
  away(code: string, mark: Player): Promise<AwayResult>;
  /** 의도적 퇴장 — 진행 중이면 라운드를 즉시 종료하고, 아무도 없으면 방을 삭제한다 */
  depart(code: string, mark: Player): Promise<DepartResult>;
  /** 유예 시간이 지난 끊긴 플레이어 정리 */
  checkStale(code: string, awayGraceMs: number): Promise<StaleResult>;
};

/**
 * 브로드캐스트 버스. 한 인스턴스가 방을 갱신하면
 * 그 방에 사람을 둔 모든 인스턴스가 메시지를 받아야 한다.
 * (자기 인스턴스가 발행한 것도 수신된다는 규칙)
 */
export type Bus = {
  publish(message: BroadcastMessage): Promise<void> | void;
  subscribe(handler: (message: BroadcastMessage) => void): Promise<void> | void;
  close?(): Promise<void> | void;
};
