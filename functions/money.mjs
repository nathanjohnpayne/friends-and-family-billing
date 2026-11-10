/**
 * Unused ADR 0010 primitives. Exact values are unit-neutral frozen rationals;
 * quantizeDollarsToCents alone converts units. No ledger/domain policy lives here.
 * Failures throw MoneyIntegrityError with a stable code; callers must withhold
 * affected projections rather than substitute a floating-point fallback.
 * Codes: INVALID_NUMBER / INVALID_EXACT / DIVIDE_BY_ZERO / UNSAFE_CENTS /
 * INVALID_ROWS / INVALID_ID / DUPLICATE_ID / INFEASIBLE_TARGET.
 * @typedef {{ numerator: bigint, denominator: bigint }} Rational
 */
export class MoneyIntegrityError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'MoneyIntegrityError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new MoneyIntegrityError(code, message);
}

/** Return a bigint magnitude without changing its unit or converting to Number. */
function absolute(value) {
    return value < 0n ? -value : value;
}

/** Construct a reduced exact rational from bigint coefficients (no units implied). */
export function rational(numerator, denominator = 1n) {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
        fail('INVALID_EXACT', 'Rational coefficients must be bigint');
    }
    if (denominator === 0n) fail('DIVIDE_BY_ZERO', 'Zero rational denominator');
    if (denominator < 0n) {
        numerator = -numerator;
        denominator = -denominator;
    }
    let a = absolute(numerator);
    let b = denominator;
    while (b !== 0n) [a, b] = [b, a % b];
    return Object.freeze({ numerator: numerator / a, denominator: denominator / a });
}

/**
 * Guard bigint coefficients and a strictly positive denominator before arithmetic.
 * Throws INVALID_EXACT for malformed values; does not normalize caller input.
 * @param {Rational} value Unit-neutral exact value to validate.
 */
function validateExact(value) {
    if (!value || typeof value.numerator !== 'bigint'
        || typeof value.denominator !== 'bigint' || value.denominator <= 0n) {
        fail('INVALID_EXACT', 'Expected a bigint rational with positive denominator');
    }
}

/** Parse the finite source Number's decimal toString(), including exponent form. */
export function exactNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail('INVALID_NUMBER', 'Expected a finite source Number');
    }
    const [coefficient, exponent = '0'] = value.toString().toLowerCase().split('e');
    const [whole, fraction = ''] = coefficient.split('.');
    const numerator = BigInt(whole + fraction);
    const scale = fraction.length - Number(exponent);
    return scale >= 0
        ? rational(numerator, 10n ** BigInt(scale))
        : rational(numerator * 10n ** BigInt(-scale));
}

/**
 * Multiply exact values without rounding; operand units are the caller's concern.
 * No implicit dollars/cents conversion occurs. Returns a reduced frozen rational.
 * @param {Rational} left
 * @param {Rational} right
 * @returns {Rational}
 */
export function multiplyExact(left, right) {
    validateExact(left);
    validateExact(right);
    return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

/**
 * Divide exact values without rounding or implicit unit conversion.
 * A zero divisor throws DIVIDE_BY_ZERO; invalid operands throw INVALID_EXACT.
 * @param {Rational} left
 * @param {Rational} right
 * @returns {Rational} Reduced frozen quotient.
 */
export function divideExact(left, right) {
    validateExact(left);
    validateExact(right);
    return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

/**
 * Sum an array of exact values in a caller-chosen common unit before quantizing.
 * Empty input returns exact zero; malformed entries throw INVALID_EXACT.
 * @param {Rational[]} values
 * @returns {Rational} Reduced frozen total, with no dollars/cents conversion.
 */
export function sumExact(values) {
    if (!Array.isArray(values)) fail('INVALID_EXACT', 'Expected an array of exact values');
    let total = rational(0n);
    for (const value of values) {
        validateExact(value);
        total = rational(total.numerator * value.denominator + value.numerator * total.denominator,
            total.denominator * value.denominator);
    }
    return total;
}

/**
 * Convert bigint integer cents to Number only within its safe integer range.
 * Throws UNSAFE_CENTS rather than losing precision; zero converts to positive 0.
 * @param {bigint} value
 * @returns {number}
 */
function safeCents(value) {
    if (absolute(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
        fail('UNSAFE_CENTS', 'Integer cents exceed the safe Number range');
    }
    return Number(value); // bigint zero always converts to positive zero.
}

/** Exact dollars -> safe integer cents; half-cent ties go away from zero. */
export function quantizeDollarsToCents(dollars) {
    validateExact(dollars);
    const magnitude = absolute(dollars.numerator) * 100n;
    let cents = magnitude / dollars.denominator;
    if ((magnitude % dollars.denominator) * 2n >= dollars.denominator) cents += 1n;
    return safeCents(dollars.numerator < 0n ? -cents : cents);
}

/**
 * Canonicalize a nonblank string or safe integer id with String(id), preserving
 * case for ordinal lexicographic comparison. Invalid ids throw INVALID_ID;
 * allocateCents separately rejects collisions between canonical keys.
 * @param {string | number} id
 * @returns {string}
 */
function rowKey(id) {
    if ((typeof id !== 'string' || id.trim().length === 0)
        && (typeof id !== 'number' || !Number.isSafeInteger(id))) {
        fail('INVALID_ID', 'Row ids must be nonblank strings or safe integer numbers');
    }
    return String(id);
}

/**
 * Allocate exact CENT values to an inherited safe integer-cent target.
 * Input: [{ id: nonblank string | safe integer, exactCents: Rational }].
 * Output: fresh [{ id: String(input.id), cents: safe integer }], in input order.
 * String ids are case-preserved; collisions (including 1 and '1') fail closed.
 * Each row receives its floor or ceiling, with ordinal id ties. Exact integer
 * and zero rows never receive an increment. Inputs are never mutated.
 */
export function allocateCents(rows, targetCents) {
    if (!Array.isArray(rows)) fail('INVALID_ROWS', 'Expected an array of rows');
    if (!Number.isSafeInteger(targetCents)) {
        fail('UNSAFE_CENTS', 'Target must be a safe integer number of cents');
    }
    const keys = new Set();
    const projected = Array.from(rows, row => {
        const id = rowKey(row?.id);
        if (keys.has(id)) fail('DUPLICATE_ID', `Ambiguous row id: ${id}`);
        keys.add(id);
        const value = row.exactCents;
        validateExact(value);
        // BigInt division truncates toward zero: adjust negative nonintegers to floor.
        let floor = value.numerator / value.denominator;
        if (value.numerator < 0n && value.numerator % value.denominator !== 0n) floor -= 1n;
        return { id, floor, remainder: value.numerator - floor * value.denominator,
            denominator: value.denominator, increment: 0n };
    });
    const floorSum = projected.reduce((sum, row) => sum + row.floor, 0n);
    const eligible = projected.filter(row => row.remainder > 0n);
    const awards = BigInt(targetCents) - floorSum;
    if (awards < 0n || awards > BigInt(eligible.length)) {
        fail('INFEASIBLE_TARGET', 'Inherited target is outside exact row floor/ceiling bounds');
    }
    eligible.sort((left, right) => {
        const difference = left.remainder * right.denominator - right.remainder * left.denominator;
        if (difference !== 0n) return difference > 0n ? -1 : 1;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    for (let index = 0; index < Number(awards); index += 1) eligible[index].increment = 1n;
    return projected.map(row => ({ id: row.id, cents: safeCents(row.floor + row.increment) }));
}
