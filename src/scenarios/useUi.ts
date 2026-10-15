import { useState } from 'react';
import type { Session } from './types';

/** session.ui 에 값을 보관하면서 React 상태로도 쓰는 훅 (defaultRun 이 같은 값을 읽을 수 있게) */
export function useUi<T>(s: Session, key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    if (!(key in s.ui)) s.ui[key] = init;
    return s.ui[key] as T;
  });
  return [
    v,
    (nv: T) => {
      s.ui[key] = nv;
      setV(nv);
    },
  ];
}

let seq = 0;
export const uid = (prefix: string) => `${prefix}${++seq}`;
