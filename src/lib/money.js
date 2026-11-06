// Unused frontend ESM entrypoint for the same exact-money implementation that
// Functions requires. This seam introduces no production financial caller.
export {
    MoneyIntegrityError,
    rational,
    exactNumber,
    multiplyExact,
    divideExact,
    sumExact,
    quantizeDollarsToCents,
    allocateCents,
} from '../../functions/money.mjs';
