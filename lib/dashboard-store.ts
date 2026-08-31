'use client';
/**
 * Client-side view of what the reader has done this session.
 *
 * The components were built against an in-memory store; this keeps that
 * interface and writes through to the server actions behind it. The local copy
 * updates first so a click feels immediate, and the action reconciles it — a
 * failed write rolls the entry back rather than leaving the UI asserting
 * something the database does not hold.
 *
 * Server-rendered pages already know the committed state, so this only has to
 * carry the delta since the page loaded.
 */
import { useSyncExternalStore } from 'react';
import type { AccountStatus } from './accounts';
import type { Disposition, Reason as DismissReason } from './dispositions';
import * as server from '../app/actions';

export type PathReviewStatus = 'unreviewed' | 'usable' | 'needs_verifying' | 'not_usable' | 'not_sure';

export interface DispositionRecord {
  disposition: Disposition;
  at: string;
  reason?: DismissReason | undefined;
  note?: string | undefined;
  owner?: string | undefined;
  nextAction?: string | undefined;
  dueDate?: string | undefined;
}

type State = {
  dispositions: Record<string, DispositionRecord>;
  accountStatus: Record<string, AccountStatus>;
  pathReviews: Record<string, { status: PathReviewStatus; by: string; at: string }>;
  droppedFromMonitoring: Record<string, string>;
};

let state: State = {
  dispositions: {},
  accountStatus: {},
  pathReviews: {},
  droppedFromMonitoring: {},
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const today = () => new Date().toISOString().slice(0, 10);
const numericId = (id: string) => Number(id);

export const actions = {
  setDisposition(companyId: string, record: Omit<DispositionRecord, 'at'>) {
    const previous = state.dispositions[companyId];
    state = {
      ...state,
      dispositions: { ...state.dispositions, [companyId]: { ...record, at: today() } },
    };
    emit();

    void server
      .setDisposition({
        companyId: numericId(companyId),
        disposition: record.disposition,
        reason: record.reason ?? null,
        note: record.note ?? null,
      })
      .then((res) => {
        if (res.ok) return;
        const next = { ...state.dispositions };
        if (previous) next[companyId] = previous;
        else delete next[companyId];
        state = { ...state, dispositions: next };
        emit();
      });
  },

  clearDisposition(companyId: string) {
    const previous = state.dispositions[companyId];
    const next = { ...state.dispositions };
    delete next[companyId];
    state = { ...state, dispositions: next };
    emit();

    void server.clearDisposition(numericId(companyId)).then((res) => {
      if (res.ok || !previous) return;
      state = { ...state, dispositions: { ...state.dispositions, [companyId]: previous } };
      emit();
    });
  },

  setAccountStatus(companyId: string, status: AccountStatus) {
    const previous = state.accountStatus[companyId];
    state = { ...state, accountStatus: { ...state.accountStatus, [companyId]: status } };
    emit();

    void server.setAccountStatus(numericId(companyId), status).then((res) => {
      if (res.ok) return;
      const next = { ...state.accountStatus };
      if (previous) next[companyId] = previous;
      else delete next[companyId];
      state = { ...state, accountStatus: next };
      emit();
    });
  },

  /** Path reviews are session-local until path_reviews writes are wired. */
  reviewPath(pathId: string, status: PathReviewStatus) {
    state = {
      ...state,
      pathReviews: { ...state.pathReviews, [pathId]: { status, by: 'You', at: today() } },
    };
    emit();
  },

  dropFromMonitoring(companyId: string) {
    state = {
      ...state,
      droppedFromMonitoring: { ...state.droppedFromMonitoring, [companyId]: today() },
    };
    emit();

    void server.dropFromMonitoring(numericId(companyId)).then((res) => {
      if (res.ok) return;
      const next = { ...state.droppedFromMonitoring };
      delete next[companyId];
      state = { ...state, droppedFromMonitoring: next };
      emit();
    });
  },
};

const serverSnapshot = state;

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(serverSnapshot),
  );
}

export const useDisposition = (id: string) => useStore((s) => s.dispositions[id]);
export const usePathReview = (id: string) => useStore((s) => s.pathReviews[id]);
export const useDropped = (id: string) => useStore((s) => s.droppedFromMonitoring[id]);
