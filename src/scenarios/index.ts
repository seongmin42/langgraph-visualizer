import { s01 } from './s01-state';
import { s02 } from './s02-reducers';
import { s03 } from './s03-communication';
import { s04 } from './s04-conditional';
import { s05 } from './s05-parallel';
import { s06 } from './s06-checkpoint';
import { s07 } from './s07-timetravel';
import { s08 } from './s08-interrupt';
import { s09 } from './s09-send';
import { s10 } from './s10-subgraph';
import { s11 } from './s11-stream';
import type { Scenario } from './types';

export const SCENARIOS: Scenario[] = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11];
