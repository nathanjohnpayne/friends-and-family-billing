import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as api from '../../../src/lib/household-money.js';
import vectors from '../../household-money-vectors.cjs';

vectors(api, { describe, it, assert });
