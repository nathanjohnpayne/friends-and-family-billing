// ADR 0010 source-domain vectors, shared verbatim by frontend ESM and Node24 CJS.
module.exports = function householdMoneyVectors(api, { describe, it, assert }) {
    const { projectHouseholdMoney: project, projectHouseholdsMoney: all,
        buildCarryMoneySnapshot: carry, projectHouseholdPreviewMoney: preview,
        toExactCents: cents, snapshotExactCredit: snapshot } = api;
    const member = { id: 1, linkedMembers: [] };
    const state = overrides => ({ familyMembers: [member, { id: 2, linkedMembers: [] }],
        bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], ...overrides });
    const bill = (amount, members = [1, 2], id = 'bill', billingFrequency = 'annual') =>
        ({ id, amount, members, billingFrequency });
    const owed = (id, amount, kind = 'carry_opening', status = 'carried_in', memberId = 1) =>
        ({ id, amount, kind, status, memberId });
    const payment = (id, amount, extra = {}) => ({ id, amount, memberId: 1, ...extra });
    const refund = (id, amount, extra = {}) => ({ id, amount, memberId: 1, status: 'recorded', type: 'refund', ...extra });
    const sc = (id, amount, reason = id) => ({ ...owed(id, amount, 'service_credit', 'active'), billId: 'bill', reason });
    const assess = source => {
        const result = project(source, source.familyMembers[0]);
        assert.equal(result.ok, true, JSON.stringify(result));
        return result;
    };
    const held = (result, code) => {
        assert.equal(result.ok, false);
        if (code) assert.equal(result.holds.some(hold => hold.code === code), true, JSON.stringify(result));
        assert.equal('owed' in result, false);
        assert.equal('rows' in result, false);
        return result.holds;
    };
    const map = rows => Object.fromEntries(rows.map(row => [row.id, row.cents]));
    const freeze = value => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        return value;
    };

    describe('unused household source authority', () => {
        it('uses exact annual bill inputs, component aggregation and half-away ties', () => {
            for (const [amount, expected] of [[1.15, 58], [1.13, 57]]) {
                assert.equal(assess(state({ bills: [bill(amount)] })).G, expected);
            }
            const combined = assess(state({ bills: [bill(0.01, [1, 2], 'a'), bill(1.14, [1, 2], 'b')] }));
            assert.equal(combined.G, 58);
            assert.equal(combined.rows.bills.reduce((total, row) => total + row.cents, 0), 58);
            const monthly = assess(state({ bills: [bill(0.01, [1, 2, 3, 4, 5, 6, 7, 8], 'm', 'monthly')],
                owedAdjustments: [owed('opening', 0.01)] }));
            assert.equal(monthly.G, 2); assert.equal(monthly.owed, 3);
        });

        it('preserves bill denominator, absent/repeated assignments and household iteration', () => {
            const source = state({ bills: [bill(1, [1, 1, 99])] });
            assert.equal(assess(source).G, 67);
            source.familyMembers[0] = { ...member, linkedMembers: [2] };
            source.bills = [bill(100, [1, 2, 99])];
            assert.equal(assess(source).G, 6667);
            source.bills = [bill('bad', [])];
            assert.equal(assess(source).G, 0);
            assert.equal(assess(state({ bills: [bill('bad', [99])] })).G, 0);
        });

        it('composes opening +/- cents and exact settled/outstanding boundaries', () => {
            for (const [opening, expected] of [[0.01, 59], [-0.01, 57]]) {
                assert.equal(assess(state({ bills: [bill(1.15)], owedAdjustments: [owed('o', opening)] })).owed, expected);
            }
            for (const [paid, balance] of [[0.58, 0], [0.57, 1]]) {
                assert.equal(assess(state({ bills: [bill(1.15)], payments: [payment('p', paid)] })).balance, balance);
            }
        });

        it('retains #620 component authority and the independent member-display boundary', () => {
            const source = state({ familyMembers: [{ ...member, linkedMembers: [2] }, { id: 2, linkedMembers: [] }],
                bills: [bill(100, [1, 2, 3])], payments: [payment('p', 0.002)],
                owedAdjustments: [owed('o', 0.001), sc('s', 0.004)] });
            const result = assess(source);
            assert.deepEqual([result.G, result.S, result.O, result.P, result.owed, result.balance], [6667, 0, 0, 0, 6667, 6667]);
            // Two member lines can remain 3333 each; they are not the authority input.
            assert.notEqual(3333 + 3333, result.G);
        });

        it('keeps net opening, service excess, U, and billed charges separate', () => {
            const source = state({ familyMembers: [{ ...member, linkedMembers: [2] }, { id: 2 }],
                bills: [bill(100, [1, 2, 3])], owedAdjustments: [owed('o', -100)] });
            assert.deepEqual([assess(source).G, assess(source).owed, assess(source).U], [6667, 0, 3333]);
            source.owedAdjustments[0].amount = -20;
            assert.equal(assess(source).owed, 4667);
            source.owedAdjustments = [sc('s', 200), owed('a', 10), owed('b', -10)];
            const net = assess(source);
            assert.deepEqual([net.O, net.owed, net.U, net.credit], [0, 0, 0, 0]);
            source.bills = [bill(60, [1])];
            source.owedAdjustments = [owed('o', -132), owed('billed', 50, 'usage_charge', 'billed')];
            assert.deepEqual([assess(source).owed, assess(source).U, assess(source).credit], [5000, 7200, 0]);
        });

        it('allocates service groups by constituent minimum id and preserves membership', () => {
            const source = state({ bills: [bill(1, [1])], owedAdjustments: [sc('b', 0.005), sc('a', 0.005)] });
            const result = assess(source);
            assert.equal(result.S, 1); assert.equal(result.owed, 99);
            assert.deepEqual(map(result.rows.service), { '["b"]': 0, '["a"]': 1 });
            source.owedAdjustments.push(sc('c', 0.005, 'a'));
            const group = assess(source).rows.service.find(row => row.id === '["a","c"]');
            assert.deepEqual(group.sourceIds, ['a', 'c']);
            assert.equal(group.children.reduce((total, row) => total + row.cents, 0), group.cents);
        });

        it('keeps exact original/reversal pairs opposite before allocating live rows', () => {
            const source = state({ payments: [payment('a', 0.005, { reversed: true }),
                payment('r', -0.005, { type: 'reversal', reversesPaymentId: 'a' }), payment('live', 0.005)] });
            const result = assess(source);
            assert.equal(result.P, 1);
            assert.deepEqual(map(result.rows.payments), { a: 1, r: -1, live: 1 });
            assert.deepEqual(result.rows.payments.filter(row => row.publicVisible).map(row => row.id), ['live']);
            source.payments[0].amount = 0.30000000000000004;
            source.payments[1].amount = -0.3;
            held(project(source, member), 'INVALID_REVERSAL');
        });

        it('holds malformed reversal links, unmatched flags, collisions and provenance', () => {
            for (const payments of [[payment('r', -1, { type: 'reversal', reversesPaymentId: 'missing' })],
                [payment('a', 1, { reversed: true })], [payment('a', 1), payment('a', 1)],
                [payment('a', 1), payment('r', -1, { type: 'reversal', reversesPaymentId: 'a' })],
                [payment('a', 1, { reversed: true }), payment('r', -1, { type: 'reversal', reversesPaymentId: 'a', memberId: 2 })]]) {
                held(project(state({ payments }), member));
            }
        });

        it('holds malformed truthy reversal claims and names the claiming source record', () => {
            for (const reversed of ['false', 1, {}, []]) {
                const source = state({ payments: [payment('claimed', 1, { reversed }), payment('sibling', 1, { memberId: 2 })] });
                const results = all(source);
                const [cause] = held(results[0], 'INVALID_REVERSAL');
                assert.deepEqual([cause.householdId, cause.recordId, cause.component, cause.field, cause.observedType],
                    [1, 'claimed', 'P', 'reversed', typeof reversed]);
                assert.equal(results[1].P, 100);
            }
            for (const reversed of [undefined, false, 0, null, '']) {
                const result = assess(state({ payments: [payment('live', 1, { reversed })] }));
                assert.equal(result.rows.payments[0].publicVisible, true);
            }
            for (const target of [undefined, null, 'unknown']) {
                const [cause] = held(project(state({ payments: [payment('reversal-source', -1,
                    { type: 'reversal', reversesPaymentId: target })] }), member), 'INVALID_REVERSAL');
                assert.deepEqual([cause.recordId, cause.component, cause.field, cause.observedType],
                    ['reversal-source', 'P', 'reversesPaymentId', target === null ? 'null' : typeof target]);
            }
        });

        it('recomputes complete candidate aggregates for caps and permits overpayment', () => {
            const source = state({ payments: [payment('p', 0.01)], creditAdjustments: [refund('old', 0.012)] });
            const before = assess(source);
            const candidate = state({ ...source, creditAdjustments: [...source.creditAdjustments, refund('new', 0.004)] });
            assert.equal(cents(0.004), 0);
            assert.equal(before.R, 1); assert.equal(assess(candidate).R, 2);
            assert.equal(assess(candidate).balance, 1); // cap must reject this candidate.
            assert.equal(assess(state({ bills: [bill(1, [1])], payments: [payment('p', 1000)] })).credit, 99900);
            assert.equal(source.creditAdjustments.length, 1);
        });

        it('retains cancellation, statuses, reopened eligibility and record presence', () => {
            const source = state({ payments: [payment('p', 1)], creditAdjustments: [refund('r', 0.5), refund('cancelled', 'bad', { status: 'cancelled' })],
                owedAdjustments: [owed('void', 'bad', 'carry_opening', 'voided'), owed('ignored', 'bad', 'usage_charge', 'voided')] });
            assert.equal(assess(source).R, 50);
            assert.equal(project(source, member, { reopenedAdjustmentIds: new Set(['r']) }).R, 0);
            source.creditAdjustments[0].amount = 'bad';
            held(project(source, member), 'INVALID_NUMBER');
            assert.equal(source.creditAdjustments.some(row => row.type === 'refund' && row.status !== 'cancelled'), true);
        });

        it('collects every invalid source type across components and nested money fields', () => {
            const invalid = ['1', '10abc', NaN, Infinity, -Infinity, null, undefined, true, false];
            for (const value of invalid) {
                const seed = { ...owed('seed', value), items: [{ sourceId: 'item', kind: 'credit', amount: value,
                    detail: [{ sourceId: 'detail', amount: value }] }] };
                const source = state({ bills: [bill(value, [1])], payments: [payment('pay', value)], creditAdjustments: [refund('ref', value)],
                    owedAdjustments: [sc('sc', value), seed, owed('b', value, 'usage_charge', 'billed'), owed('d', value, 'usage_charge', 'deferred')] });
                const holds = held(project(source, member), 'INVALID_NUMBER');
                assert.deepEqual(new Set(holds.map(row => row.component)), new Set(['G', 'S', 'O', 'P', 'R', 'B', 'deferred']));
                assert.equal(holds.length, 9);
                holds.forEach(row => {
                    assert.equal(row.householdId, 1); assert.equal(row.field, 'amount');
                    assert.equal(row.observedType, value === null ? 'null' : typeof value);
                    assert.equal(typeof row.recordId, 'string');
                    assert.equal('value' in row, false);
                });
            }
        });

        it('holds legacy S/B nonpositive silent drops but preserves signed and zero money elsewhere', () => {
            for (const amount of [-1, 0, -0]) {
                for (const record of [sc('sc', amount), owed('b', amount, 'usage_charge', 'billed')]) {
                    held(project(state({ owedAdjustments: [record] }), member), 'INVALID_DOMAIN');
                }
            }
            const result = assess(state({ bills: [bill(-0, [1])], payments: [payment('p', -0)],
                creditAdjustments: [refund('r', -0)], owedAdjustments: [owed('o', -0), owed('d', -0, 'usage_charge', 'deferred')] }));
            for (const field of ['G', 'O', 'P', 'R', 'N', 'owed', 'balance', 'credit', 'U']) assert.equal(Object.is(result[field], -0), false);
            assert.equal(assess(state({ bills: [bill(-1, [1])], creditAdjustments: [refund('r', -1)],
                owedAdjustments: [owed('o', -1), owed('d', -1, 'usage_charge', 'deferred')] })).R, -100);
        });

        it('isolates a held household and never emits a partial carry aggregate', () => {
            const source = state({ payments: [payment('bad', '1'), payment('good', 1, { memberId: 2 })] });
            const results = all(source);
            held(results[0]); assert.equal(results[1].P, 100);
            const carried = carry(source, { fromYearLabel: '2026', nextYearLabel: '2027' });
            assert.equal(carried.ok, false); assert.equal('totalOpeningBalanceCents' in carried, false);
            assert.equal(carried.households[1].seed.amount, -1);
        });

        it('uses bigint composition near the safe-cent boundary, including cancellation', () => {
            const large = 60000000000000;
            const result = assess(state({ bills: [bill(large, [1])],
                owedAdjustments: [sc('s', large), owed('o', large)] }));
            assert.equal(result.owed, 6000000000000000);
            const overflow = state({ bills: [bill(large, [1])], owedAdjustments: [owed('o', large)] });
            held(project(overflow, member), 'UNSAFE_CENTS');
            held(project(state({ payments: [payment('p', large)], creditAdjustments: [refund('r', -large)] }), member), 'UNSAFE_CENTS');
            held(project(state({ bills: [bill(Number.MAX_VALUE, [1])] }), member), 'UNSAFE_CENTS');
            const limit = 90071992547409.9;
            const clamped = assess(state({ owedAdjustments: [sc('s', limit), owed('o', -limit)] }));
            assert.deepEqual([clamped.invoice, clamped.owed, clamped.A, clamped.U], [0, 0, 0, 9007199254740990]);
            const cancelled = assess(state({ bills: [bill(limit, [1])],
                owedAdjustments: [sc('s', limit), owed('o', limit)] }));
            assert.equal(cancelled.owed, 9007199254740990);
        });
    });

    describe('opening hierarchy and carry snapshots', () => {
        const seed = (id, amount, items) => ({ ...owed(id, amount), ...(items === undefined ? {} : { items }) });
        const item = (sourceId, amount, detail) => ({ sourceId, amount, kind: detail ? 'credit' : 'usage_charge', ...(detail ? { detail } : {}) });
        it('accepts canonical-cent binary residue, legacy seeds and signed endpoint allocations', () => {
            const result = assess(state({ owedAdjustments: [seed('a', 0.30000000000000004, [item('x', 0.1), item('y', 0.2)]), seed('legacy', -0.01)] }));
            assert.equal(result.O, 29);
            assert.deepEqual(map(result.rows.opening[0].items), { x: 10, y: 20 });
            assert.equal(result.rows.opening[1].opaque, true);
            const mixed = assess(state({ owedAdjustments: [seed('m', 0, [item('a', -0.005), item('b', 0.005), item('z', 0)])] }));
            assert.deepEqual(map(mixed.rows.opening[0].items), { a: 0, b: 0, z: 0 });
        });

        it('holds canonical mismatches and infeasible inherited floor/ceiling targets', () => {
            for (const [amount, child] of [[0.006, 0.01], [0.004, 0]]) {
                const source = state({ owedAdjustments: [seed('A', amount, [item('a', child)]), seed('B', amount, [item('b', child)])] });
                held(project(source, member), 'INFEASIBLE_TARGET');
            }
            held(project(state({ owedAdjustments: [seed('a', 0.02, [item('x', 0.01)])] }), member), 'PARENT_MISMATCH');
            held(project(state({ owedAdjustments: [seed('a', -0.02, [item('x', -0.02, [{ sourceId: 'd', amount: -0.01 }])])] }), member), 'PARENT_MISMATCH');
        });

        it('allocates non-additive detail and projection-only groups from validated constituents', () => {
            const source = state({ owedAdjustments: [seed('seed', -0.01, [item('credit', -0.01,
                [{ sourceId: 'b', amount: -0.005 }, { sourceId: 'a', amount: -0.005 }])])] });
            const result = project(source, member, { detailGroups: [{ seedId: 'seed', itemSourceId: 'credit', groups: [['b', 'a']] }] });
            assert.equal(result.ok, true);
            const groups = result.rows.opening[0].items[0].detail;
            assert.equal(groups[0].id, '["a","b"]'); assert.equal(groups[0].cents, -1);
            assert.equal(groups[0].children.reduce((total, row) => total + row.cents, 0), -1);
            assert.equal(result.O, -1);
            for (const groups of [[['a']], [['a'], ['a', 'b']], [['foreign', 'b']], [[]]]) {
                held(project(source, member, { detailGroups: [{ seedId: 'seed', itemSourceId: 'credit', groups }] }), 'INVALID_PROVENANCE');
            }
            assert.equal('sourceIds' in source.owedAdjustments[0].items[0].detail[0], false);
        });

        it('supports deterministic explanatory ids and holds missing/duplicate/foreign provenance', () => {
            const source = state({ owedAdjustments: [seed('s', -1, [item('c', -1,
                [{ kind: 'unused', amount: -1 }])])] });
            assert.equal(assess(source).rows.opening[0].items[0].detail[0].id, '["s","c","unused"]');
            for (const detail of [[{ amount: -1 }], [{ kind: 'unused', amount: -0.5 }, { kind: 'unused', amount: -0.5 }],
                [{ sourceId: 'd', amount: -1, memberId: 99 }]]) {
                source.owedAdjustments[0].items[0].detail = detail;
                held(project(source, member));
            }
        });

        it('holds malformed nested shapes without suppressing a valid sibling', () => {
            for (const items of [[null], [undefined], [true], [{ sourceId: 'c', amount: -1, kind: 'credit', detail: [null] }],
                [{ sourceId: 'c', amount: -1, kind: 'credit', detail: [undefined] }], 'bad']) {
                const source = state({ owedAdjustments: [seed('s', -1, items)], payments: [payment('good', 1, { memberId: 2 })] });
                const results = all(source);
                held(results[0]); assert.equal(results[1].P, 100);
                assert.equal(results[0].holds.every(row => row.householdId === 1 && row.component === 'O'), true);
            }
        });

        it('preserves null-reopened carry amount, supplied-set marking and old-year settlement', () => {
            const source = state({ bills: [bill(100, [1])], payments: [payment('p', 140)], creditAdjustments: [refund('r', 30)] });
            const reopening = new Set(['r']);
            assert.equal(project(source, member, { reopenedAdjustmentIds: reopening }).credit, 4000);
            const result = carry(source, { fromYearLabel: '2026', nextYearLabel: '2027', reopenedAdjustmentIds: reopening });
            const h = result.households[0];
            assert.equal(h.credit, 1000); assert.equal(h.seed.amount, -10); assert.deepEqual(h.creditAdjustmentIds, []);
            const after = assess({ ...source, creditAdjustments: [...source.creditAdjustments, refund('carry', h.credit / 100, { type: 'carry_forward' })] });
            assert.equal(after.credit, 0); assert.equal(after.balance, 0);
            assert.equal(project({ ...source, creditAdjustments: [...source.creditAdjustments, refund('carry', 10)] }, member,
                { reopenedAdjustmentIds: reopening }).credit, 3000);
        });

        it('conserves U through empty-year chains, never disposing it or refunding service excess', () => {
            let source = state({ owedAdjustments: [owed('incoming', -132)], bills: [bill(60, [1])] });
            for (let year = 2026; year < 2032; year++) {
                const result = carry(freeze(source), { fromYearLabel: String(year), nextYearLabel: String(year + 1), carryUnusedOpeningCredit: true });
                const h = result.households[0];
                assert.equal(h.credit, 0); assert.equal(h.unusedOpeningCreditCents, 7200);
                assert.equal(h.seed.amount, -72);
                assert.equal(h.seed.items[0].sourceId, source.owedAdjustments[0].id);
                source = state({ owedAdjustments: [h.seed] });
            }
            const noMoney = carry(state({ bills: [bill(100, [1])], owedAdjustments: [sc('s', 200)] }),
                { carryUnusedOpeningCredit: true, fromYearLabel: '2026', nextYearLabel: '2027' });
            assert.equal(noMoney.households[0].seed, null);
        });

        it('retains zero-net seeds and detached calc/detail snapshots with exact conservation', () => {
            const charge = { ...owed('d', 0.005, 'usage_charge', 'deferred'), calc: { coveredBy: [] } };
            const source = state({ payments: [payment('p', 0.01)], owedAdjustments: [charge, sc('s', 0.005)] });
            const result = carry(freeze(source), { fromYearLabel: '2026', nextYearLabel: '2027', reviewServiceCredits: [source.owedAdjustments[1]] });
            const h = result.households[0];
            assert.equal(h.openingBalanceCents, 0); assert.equal(h.seed.amount, 0);
            assert.deepEqual(h.seed.items.map(row => row.amount), [0.01, -0.01]);
            h.seed.items[0].calc.coveredBy.push('detached');
            assert.deepEqual(source.owedAdjustments[0].calc.coveredBy, []);
            const projected = assess(state({ owedAdjustments: [h.seed] }));
            assert.equal(projected.O, 0);
        });

        it('reconstructs carry only from admitted records, ignoring null unadmitted entries', () => {
            const deferred = { ...owed('d', 1, 'usage_charge', 'deferred'), description: 'One charge' };
            const service = sc('s', 0.25, 'One credit');
            const source = state({ payments: [payment('p', 1)], owedAdjustments: [null, deferred, service] });
            const result = carry(source, { fromYearLabel: '2026', nextYearLabel: '2027', reviewServiceCredits: [service] });
            assert.equal(result.ok, true);
            const h = result.households[0];
            assert.deepEqual(h.deferredChargeIds, ['d']);
            assert.equal(h.seed.items[0].description, 'One charge');
            assert.equal(h.seed.items[1].detail[0].description, 'One credit');
            assert.equal(assess(state({ owedAdjustments: [h.seed] })).O, h.openingBalanceCents);
        });

        it('binds carry metadata to the household and component when source ids collide elsewhere', () => {
            const deferred = { ...owed('shared', 1, 'usage_charge', 'deferred'), description: 'One charge', calc: { household: 1 } };
            const service = sc('shared', 0.25, 'One credit');
            const otherDeferred = { ...deferred, memberId: 3, amount: 999, description: 'Other charge', calc: { household: 3 } };
            const otherService = { ...service, memberId: 3, amount: 999, reason: 'Other credit' };
            const source = state({ familyMembers: [member, { id: 3, linkedMembers: [] }], payments: [payment('p', 1)],
                owedAdjustments: [otherDeferred, otherService, owed('shared', 0), service, deferred] });
            const result = carry(source, { fromYearLabel: '2026', nextYearLabel: '2027', reviewServiceCredits: [otherService, service] });
            assert.equal(result.ok, true);
            const h = result.households[0];
            assert.deepEqual(h.deferredChargeIds, ['shared']);
            const [charge, credit] = h.seed.items;
            assert.deepEqual([charge.memberId, charge.amount, charge.description, charge.calc.household], [1, 1, 'One charge', 1]);
            assert.deepEqual([credit.detail[0].memberId, credit.detail[0].amount, credit.detail[0].description], [1, -0.25, 'One credit']);
            const next = assess(state({ owedAdjustments: [h.seed] }));
            assert.equal(next.O, 0);
            assert.equal(next.rows.opening[0].items.reduce((total, row) => total + row.cents, 0), h.openingBalanceCents);
            assert.equal(source.owedAdjustments[0].description, 'Other charge');
        });

        it('retains positive aggregate carry eligibility without dropping signed audit rows', () => {
            const options = { fromYearLabel: '2026', nextYearLabel: '2027', carryUnusedOpeningCredit: true };
            for (const amounts of [[-5], [5, -5], [0], [0.001]]) {
                const source = state({ creditAdjustments: [refund('past', 0)],
                    owedAdjustments: amounts.map((amount, index) => owed('d' + index, amount, 'usage_charge', 'deferred')) });
                const h = carry(source, options).households[0];
                assert.equal(h.seed, null); assert.equal(h.openingBalanceCents, 0);
                assert.deepEqual(h.deferredChargeIds, []); assert.deepEqual(h.creditAdjustmentIds, []);
                assert.deepEqual(h.openingSeedIds, []); assert.equal(h.rows.deferred.length, amounts.length);
            }
            const positiveFeed = state({ payments: [payment('p', 5)],
                owedAdjustments: [owed('d', -2, 'usage_charge', 'deferred')] });
            const h = carry(positiveFeed, options).households[0];
            assert.equal(h.seed.amount, -7);
            assert.deepEqual(h.deferredChargeIds, ['d']);
            assert.deepEqual(h.seed.items.map(row => row.amount), [-2, -5]);
            const invalid = state({ owedAdjustments: [owed('bad', '0', 'usage_charge', 'deferred')] });
            held(carry(invalid, options).households[0], 'INVALID_NUMBER');
        });

        it('holds unrepresentable dollar snapshots and unsafe totals while keeping siblings assessable', () => {
            const source = state({ payments: [payment('large', 90071992547409.9), payment('cent', 0.01),
                payment('sibling', 1, { memberId: 2 })] });
            assert.equal(assess(source).credit, Number.MAX_SAFE_INTEGER);
            const result = carry(source, { fromYearLabel: '2026', nextYearLabel: '2027' });
            held(result.households[0], 'UNSAFE_CENTS');
            assert.equal(result.households[1].seed.amount, -1);
            assert.equal('totalOpeningBalanceCents' in result, false);
            const total = carry(state({ payments: [payment('a', 60000000000000), payment('b', 60000000000000, { memberId: 2 })] }),
                { fromYearLabel: '2026', nextYearLabel: '2027' });
            assert.equal(total.ok, false);
            assert.equal(total.households.every(row => row.ok), true);
            assert.equal(total.holds[0].code, 'UNSAFE_CENTS');
            assert.equal('totalOpeningBalanceCents' in total, false);
        });

        it('keeps identical id-to-cent allocations across mixed signed row permutations', () => {
            const source = state({ bills: [bill(0.01, [1, 2], 'b'), bill(0.01, [1, 2], 'a')],
                payments: [payment('b', 0.005), payment('a', 0.005)],
                creditAdjustments: [refund('b', 0.005), refund('a', 0.005)],
                owedAdjustments: [sc('sB', 0.005), sc('sA', 0.005), seed('z', 0), seed('b', -0.005), seed('a', 0.005)] });
            const first = assess(source);
            const second = assess({ ...source, bills: [...source.bills].reverse(), payments: [...source.payments].reverse(),
                creditAdjustments: [...source.creditAdjustments].reverse(), owedAdjustments: [...source.owedAdjustments].reverse() });
            for (const component of ['bills', 'service', 'opening', 'payments', 'dispositions']) {
                assert.deepEqual(map(first.rows[component]), map(second.rows[component]));
            }
            for (const component of ['G', 'S', 'O', 'P', 'R', 'B', 'N', 'owed', 'balance', 'credit', 'U']) {
                assert.equal(first[component], second[component]);
            }
        });

        it('property: permutations, item/detail sums, money conservation and closed-year balances', () => {
            let random = 633;
            const next = limit => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % limit; };
            for (let run = 0; run < 100; run++) {
                const price = next(10000) / 100;
                const incoming = -next(20000) / 100;
                const paid = next(20000) / 100;
                const source = state({ bills: [bill(price, [1])], payments: [payment('p', paid)],
                    owedAdjustments: [owed('o', incoming), owed('d', next(10000) / 100, 'usage_charge', 'deferred'), sc('s', (1 + next(10000)) / 100)] });
                const result = carry(source, { fromYearLabel: '2026', nextYearLabel: '2027', carryUnusedOpeningCredit: true, reviewServiceCredits: [source.owedAdjustments[2]] });
                assert.equal(result.ok, true);
                const h = result.households[0];
                assert.equal(h.openingBalanceCents, h.deferredCents - h.credit - h.U);
                assert.equal(h.seed.items.reduce((total, row) => total + cents(row.amount), 0), h.openingBalanceCents);
                h.seed.items.filter(row => row.kind === 'credit').forEach(row =>
                    assert.equal(row.detail.reduce((total, d) => total + cents(d.amount), 0), cents(row.amount)));
                assert.deepEqual(assess({ ...source, owedAdjustments: [...source.owedAdjustments].reverse() }), assess(source));
                const after = assess({ ...source, creditAdjustments: h.credit > 0 ? [refund('carry', h.credit / 100)] : [] });
                assert.equal(after.credit, 0);
                assert.equal(after.balance, h.credit > 0 ? 0 : h.balance);
            }
        });

        it('projects exact preview money from raw bills and a validated carry seed', () => {
            const source = state({ bills: [bill(1.15)] });
            const result = preview(source, member, [bill(1.13)], seed('s', -0.01, [item('x', -0.01)]));
            assert.deepEqual([result.sourceBillTotalCents, result.nextBillTotalCents, result.subscriptionDeltaCents,
                result.carriedTotalCents, result.firstInvoiceTotalCents, result.remainingCreditCents], [58, 57, -1, -1, 56, 0]);
            const credit = preview(state({ bills: [] }), member, [], seed('s', -1));
            assert.equal(credit.remainingCreditCents, 100);
            held(preview(state({ bills: [bill(-60000000000000, [1])] }), member,
                [bill(60000000000000, [1])]), 'UNSAFE_CENTS');
        });

        it('review exact snapshot keeps binding fields and rejects coercion', () => {
            const record = { memberId: 1, amount: 0.0049999999999999, reason: 'same', status: 'active', incurredDate: '2026-01-01', createdAt: 'fixed' };
            const { amount: _amount, ...binding } = record;
            assert.deepEqual(snapshot(record), { ...binding, amountCents: 0 });
            for (const amount of ['1', null, undefined, NaN, Infinity]) assert.throws(() => snapshot({ ...record, amount }));
        });
    });
};
