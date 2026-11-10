// Shared ADR 0010 vectors run through the frontend ESM and Functions CJS entries.
module.exports = function moneyVectors(api, { describe, it, assert }) {
    const { MoneyIntegrityError, rational, exactNumber: n, multiplyExact: mul,
        divideExact: div, sumExact: sum, quantizeDollarsToCents: q, allocateCents } = api;
    const row = (id, value) => ({ id, exactCents: n(value) });
    const hold = (fn, code) => assert.throws(fn,
        error => error instanceof MoneyIntegrityError && error.code === code);
    const byId = rows => Object.fromEntries(rows.map(({ id, cents }) => [id, cents]));

    describe('exact money entrypoint contract', () => {
        it('parses decimal source values and preserves exact arithmetic before quantization', () => {
            assert.deepEqual(sum([n(0.1), n(0.2)]), rational(3n, 10n));
            assert.deepEqual(n(0.30000000000000004), rational(7500000000000001n, 25000000000000000n));
            assert.equal(q(sum([n(0.1), n(0.2)])), 30);
            assert.equal(q(div(n(1.15), n(2))), 58);
            assert.equal(q(div(n(1.13), n(2))), 57);
            assert.equal(q(sum([div(n(0.01), n(2)), div(n(1.14), n(2))])), 58);
            assert.equal(q(div(mul(n(0.01), n(12)), n(8))), 2);
            assert.deepEqual(div(mul(n(1.15), n(3)), n(3)), n(1.15));
            assert.deepEqual(sum([]), rational(0n));
        });

        it('rounds signed half cents away from zero without binary epsilon', () => {
            for (const [dollars, cents] of [[0.005, 1], [-0.005, -1], [1.005, 101],
                [-1.005, -101], [2.675, 268], [-2.675, -268], [0.00499, 0],
                [-0.00499, 0], [0.00501, 1], [-0.00501, -1]]) {
                assert.equal(q(n(dollars)), cents);
            }
            assert.equal(q(div(n(-1.15), n(2))), -58);
        });

        it('parses both exponent signs, extreme finite values, and normalizes zero', () => {
            assert.deepEqual(n(1e-7), rational(1n, 10000000n));
            assert.deepEqual(n(-1.25e-7), rational(-1n, 8000000n));
            assert.deepEqual(n(1.25e21), rational(1250000000000000000000n));
            assert.deepEqual(n(Number.MIN_VALUE), rational(5n, 10n ** 324n));
            assert.deepEqual(n(Number.MAX_VALUE), rational(17976931348623157n * 10n ** 292n));
            assert.deepEqual(n(-0), rational(0n));
            for (const value of [-0, -1e-12, 0, Number.MIN_VALUE]) {
                assert.equal(Object.is(q(n(value)), -0), false);
            }
        });

        it('fails explicitly on invalid values, zero divisors, and unsafe cent output', () => {
            for (const value of [NaN, Infinity, -Infinity, '1', null, undefined]) {
                hold(() => n(value), 'INVALID_NUMBER');
            }
            hold(() => rational(1, 2n), 'INVALID_EXACT');
            hold(() => rational(1n, 0n), 'DIVIDE_BY_ZERO');
            hold(() => div(n(1), n(0)), 'DIVIDE_BY_ZERO');
            hold(() => sum([n(1), undefined]), 'INVALID_EXACT');
            hold(() => sum(Array(1)), 'INVALID_EXACT');
            hold(() => mul({ numerator: 1n, denominator: -1n }, n(1)), 'INVALID_EXACT');
            hold(() => q(n(Number.MAX_VALUE)), 'UNSAFE_CENTS');
            const limit = BigInt(Number.MAX_SAFE_INTEGER);
            for (const sign of [1n, -1n]) {
                assert.equal(q(rational(sign * limit, 100n)), Number(sign * limit));
                hold(() => q(rational(sign * (limit + 1n), 100n)), 'UNSAFE_CENTS');
            }
            assert.deepEqual(rational(2n, -4n), rational(-1n, 2n));
            assert.equal(Object.isFrozen(n(0.1)), true);
        });

        it('allocates signed mixed rows at both exact feasibility endpoints', () => {
            const rows = [row('negative', -1.2), row('positive', 2.8), row('integer', -2), row('zero', 0)];
            assert.deepEqual(byId(allocateCents(rows, -2)), { negative: -2, positive: 2, integer: -2, zero: 0 });
            assert.deepEqual(byId(allocateCents(rows, 0)), { negative: -1, positive: 3, integer: -2, zero: 0 });
            assert.deepEqual(byId(allocateCents(rows, -1)), { negative: -1, positive: 2, integer: -2, zero: 0 });
            hold(() => allocateCents(rows, -3), 'INFEASIBLE_TARGET');
            hold(() => allocateCents(rows, 1), 'INFEASIBLE_TARGET');
            assert.deepEqual(allocateCents([], 0), []);
            hold(() => allocateCents([], 1), 'INFEASIBLE_TARGET');
        });

        it('compares tiny fractional differences exactly and awards each row at most once', () => {
            const rows = [
                { id: 'a', exactCents: rational(1n, 3n) },
                { id: 'b', exactCents: rational(10n ** 30n + 1n, 3n * 10n ** 30n) },
                row('zero', 0), row('integer', 4),
            ];
            assert.deepEqual(byId(allocateCents(rows, 5)), { a: 0, b: 1, zero: 0, integer: 4 });
            assert.deepEqual(byId(allocateCents(rows, 6)), { a: 1, b: 1, zero: 0, integer: 4 });
            hold(() => allocateCents(rows, 7), 'INFEASIBLE_TARGET');
        });

        it('uses case-preserved ordinal string ids, not numeric or locale collation', () => {
            const rows = ['a', '2', 'A', '10', 'Z', 'ä'].map(id => row(id, 0.5));
            assert.deepEqual(byId(allocateCents(rows, 3)), { a: 0, 2: 1, A: 1, 10: 1, Z: 0, ä: 0 });
            assert.deepEqual(allocateCents([row(2, 0.5), row(10, 0.5)], 1), [
                { id: '2', cents: 0 }, { id: '10', cents: 1 },
            ]);
        });

        it('keeps the same id-to-cents map under every permutation without mutating inputs', () => {
            const rows = Object.freeze([Object.freeze(row('b', -0.5)), Object.freeze(row('a', 0.5)),
                Object.freeze(row('zero', 0)), Object.freeze(row('c', 1.25))]);
            const before = rows.map(value => ({ ...value }));
            const permutations = values => values.length === 0 ? [[]] : values.flatMap((value, i) =>
                permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest]));
            for (const permuted of permutations(rows)) {
                const result = allocateCents(permuted, 1);
                assert.deepEqual(byId(result), { a: 1, b: -1, zero: 0, c: 1 });
                assert.equal(result.reduce((total, value) => total + value.cents, 0), 1);
                for (const value of result) {
                    const raw = permuted.find(input => String(input.id) === value.id).exactCents;
                    let floor = raw.numerator / raw.denominator;
                    if (raw.numerator < 0n && raw.numerator % raw.denominator !== 0n) floor -= 1n;
                    const ceiling = floor + (raw.numerator % raw.denominator === 0n ? 0n : 1n);
                    assert.equal(BigInt(value.cents) >= floor && BigInt(value.cents) <= ceiling, true);
                }
            }
            assert.deepEqual(rows, before);
        });

        it('holds impossible inherited targets and preserves exact-zero children', () => {
            hold(() => allocateCents([row('child', 1)], 0), 'INFEASIBLE_TARGET');
            hold(() => allocateCents([row('child', 0)], 1), 'INFEASIBLE_TARGET');
            assert.deepEqual(allocateCents([row('child', -0)], 0), [{ id: 'child', cents: 0 }]);
            const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
            hold(() => allocateCents([{ id: 'large', exactCents: rational(huge) },
                { id: 'negative', exactCents: rational(-huge) }], 0), 'UNSAFE_CENTS');
        });

        it('holds malformed rows, ambiguous ids and invalid targets before returning amounts', () => {
            for (const id of [null, undefined, '', '  ', {}, [], Infinity, NaN, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
                hold(() => allocateCents([row(id, 0)], 0), 'INVALID_ID');
            }
            hold(() => allocateCents([row('a', 0), row('a', 1)], 1), 'DUPLICATE_ID');
            hold(() => allocateCents([row(1, 0), row('1', 0)], 0), 'DUPLICATE_ID');
            hold(() => allocateCents([row(-0, 0), row('0', 0)], 0), 'DUPLICATE_ID');
            hold(() => allocateCents([undefined], 0), 'INVALID_ID');
            hold(() => allocateCents(Array(1), 0), 'INVALID_ID');
            hold(() => allocateCents([{ id: 'a' }], 0), 'INVALID_EXACT');
            hold(() => allocateCents(null, 0), 'INVALID_ROWS');
            for (const target of [NaN, Infinity, 0.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
                hold(() => allocateCents([], target), 'UNSAFE_CENTS');
            }
        });
    });
};
