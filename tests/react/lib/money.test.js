import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as money from '../../../src/lib/money.js';
import moneyVectors from '../../money-vectors.cjs';

moneyVectors(money, { describe, it, assert });
