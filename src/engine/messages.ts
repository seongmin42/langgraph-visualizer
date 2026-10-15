import type { Message } from './types';

export const human = (content: string, id: string): Message => ({ type: 'human', content, id });
export const ai = (content: string, id: string): Message => ({ type: 'ai', content, id });
export const system = (content: string, id: string): Message => ({ type: 'system', content, id });
