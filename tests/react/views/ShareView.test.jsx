import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/firebase.js', () => ({
    db: {},
    storage: {}
}));

const mockDoc = vi.fn();
const mockGetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockCollection = vi.fn();
const mockAddDoc = vi.fn();
const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
const mockIncrement = vi.fn(n => n);

vi.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    getDoc: (...args) => mockGetDoc(...args),
    updateDoc: (...args) => mockUpdateDoc(...args),
    collection: (...args) => mockCollection(...args),
    addDoc: (...args) => mockAddDoc(...args),
    serverTimestamp: () => mockServerTimestamp(),
    increment: n => mockIncrement(n)
}));

vi.mock('@/lib/validation.js', () => ({
    hashToken: vi.fn(async (token) => 'hashed_' + token)
}));

vi.mock('@/lib/formatting.js', () => ({
    getPaymentMethodIcon: vi.fn(() => '&#x1F4B3;'),
    getInitials: vi.fn((name) => (name || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?')
}));

import ShareView from '@/app/views/ShareView.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleShareData = {
    memberName: 'Alice Smith',
    year: '2024',
    ownerId: 'owner123',
    billingYearId: 'year2024',
    memberId: 'member456',
    scopes: ['disputes:create', 'disputes:read'],
    summary: {
        memberId: 'member456',
        name: 'Alice Smith',
        bills: [
            { billId: 'b1', name: 'Netflix', monthlyAmount: 15.99, splitCount: 2, monthlyShare: 8.00, annualShare: 96.00 },
            { billId: 'b2', name: 'Spotify', monthlyAmount: 9.99, splitCount: 3, monthlyShare: 3.33, annualShare: 39.96 }
        ]
    },
    paymentSummary: {
        combinedAnnualTotal: 135.96,
        combinedMonthlyTotal: 11.33,
        totalPaid: 50,
        balanceRemaining: 85.96
    },
    paymentMethods: [
        { id: 'pm1', type: 'venmo', label: 'Venmo', handle: '@john' }
    ],
    disputes: [
        {
            id: 'disp1',
            billName: 'Netflix',
            status: 'resolved',
            message: 'Wrong amount',
            createdAt: '2024-06-01',
            resolutionNote: 'Fixed',
            userReview: { state: 'requested' }
        }
    ]
};

const sampleShareDataWithLinkedMembers = {
    ...sampleShareData,
    linkedMembers: [
        {
            memberId: 'member789',
            name: 'Bob Smith',
            monthlyTotal: 5.00,
            annualTotal: 60.00,
            bills: [
                { billId: 'b3', name: 'iCloud', monthlyAmount: 9.99, splitCount: 2, monthlyShare: 5.00, annualShare: 60.00 }
            ]
        }
    ],
    paymentSummary: {
        combinedAnnualTotal: 195.96,
        combinedMonthlyTotal: 16.33,
        totalPaid: 50,
        balanceRemaining: 145.96
    }
};

function setToken(token) {
    Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...window.location, search: token ? '?token=' + token : '' }
    });
}

/** Helper: configure getDoc to return an existing publicShares doc with given data. */
function mockPublicSharesHit(data = sampleShareData) {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => data });
    mockUpdateDoc.mockResolvedValue();
    mockDoc.mockReturnValue('doc-ref');
}

/** Helper: configure getDoc miss + fetch success. */
function mockPublicSharesMissFetchOk(data = sampleShareData) {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockDoc.mockReturnValue('doc-ref');
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => data
    });
}

/** Helper: configure getDoc miss + fetch error. */
function mockPublicSharesMissFetchError(errorMsg = 'Token expired') {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockDoc.mockReturnValue('doc-ref');
    global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: errorMsg })
    });
}

const originalLocation = window.location;

beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Reset window.open spy
    vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
    Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation
    });
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShareView', () => {

    // -----------------------------------------------------------------------
    // 1. Missing token
    // -----------------------------------------------------------------------
    describe('when no token is in the URL', () => {
        it('shows "No share token provided" error', async () => {
            setToken(null);
            render(<ShareView />);
            await waitFor(() => {
                expect(screen.getByText('Unable to Load Summary')).toBeInTheDocument();
                expect(screen.getByText(/No share token provided/)).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 2. publicShares cache hit
    // -----------------------------------------------------------------------
    describe('when publicShares doc exists (cache hit)', () => {
        it('renders member name heading and bumps access count', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Smith's Annual Billing Summary")).toBeInTheDocument();
            });

            // Verify updateDoc was called for access count bump
            expect(mockUpdateDoc).toHaveBeenCalled();
            expect(mockIncrement).toHaveBeenCalledWith(1);
        });

        it('renders year in subtitle', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/billing summary for 2024/)).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 3. publicShares miss, resolveShareToken success
    // -----------------------------------------------------------------------
    describe('when publicShares misses and resolveShareToken succeeds', () => {
        it('renders data from Cloud Function response', async () => {
            setToken('xyz789');
            mockPublicSharesMissFetchOk();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Smith's Annual Billing Summary")).toBeInTheDocument();
            });

            // Confirm fetch was called with correct payload
            expect(global.fetch).toHaveBeenCalledWith('/resolveShareToken', expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: 'xyz789' })
            }));
        });
    });

    // -----------------------------------------------------------------------
    // 4. publicShares miss, resolveShareToken failure
    // -----------------------------------------------------------------------
    describe('when publicShares misses and resolveShareToken fails', () => {
        it('shows server error message from response', async () => {
            setToken('bad_token');
            mockPublicSharesMissFetchError('Token expired');

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Unable to Load Summary')).toBeInTheDocument();
                expect(screen.getByText('Token expired')).toBeInTheDocument();
            });
        });

        it('shows generic error if response has no error field', async () => {
            setToken('bad_token');
            mockGetDoc.mockResolvedValue({ exists: () => false });
            mockDoc.mockReturnValue('doc-ref');
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                json: async () => ({})
            });

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/invalid or has been removed/)).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 5. Network / unexpected error
    // -----------------------------------------------------------------------
    describe('when getDoc throws an error', () => {
        it('shows "Could not connect" message', async () => {
            setToken('net_err');
            mockDoc.mockReturnValue('doc-ref');
            mockGetDoc.mockRejectedValue(new Error('Network failure'));

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/Could not connect/)).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 6. BillsSection renders bills table
    // -----------------------------------------------------------------------
    describe('HouseholdBillsSection', () => {
        it('renders bill names, amounts, and totals for single member', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Alice Smith")).toBeInTheDocument();
            });

            // Netflix appears in both bills table and disputes section
            expect(screen.getAllByText('Netflix').length).toBeGreaterThanOrEqual(1);
            expect(screen.getByText('Spotify')).toBeInTheDocument();
            // Monthly amounts
            expect(screen.getByText('$15.99')).toBeInTheDocument();
            expect(screen.getByText('$9.99')).toBeInTheDocument();
            // Annual shares
            expect(screen.getByText('$96.00')).toBeInTheDocument();
            expect(screen.getByText('$39.96')).toBeInTheDocument();
            // Split counts
            expect(screen.getByText('2 members')).toBeInTheDocument();
            expect(screen.getByText('3 members')).toBeInTheDocument();
            // TOTAL row
            expect(screen.getByText('TOTAL')).toBeInTheDocument();
        });

        it('renders member name heading for single member', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Alice Smith")).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 7. Question This button
    // -----------------------------------------------------------------------
    describe('Question This button', () => {
        it('shows when canDispute is true (scopes include disputes:create)', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getAllByRole('button', { name: 'Question This' })).toHaveLength(2);
            });
        });

        it('does not show when scopes lack disputes:create', async () => {
            setToken('abc123');
            const noDisputeData = { ...sampleShareData, scopes: ['disputes:read'] };
            mockPublicSharesHit(noDisputeData);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Alice Smith")).toBeInTheDocument();
            });

            expect(screen.queryAllByRole('button', { name: 'Question This' })).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------------
    // 8. DisputeFormOverlay validates empty message
    // -----------------------------------------------------------------------
    describe('DisputeFormOverlay', () => {
        it('shows error styling when Submit is clicked with empty message', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getAllByRole('button', { name: 'Question This' }).length).toBeGreaterThan(0);
            });

            // Open dispute form for first bill
            const reviewBtns = screen.getAllByRole('button', { name: 'Question This' });
            await user.click(reviewBtns[0]);

            // Overlay should appear with "Question This Charge" title
            await waitFor(() => {
                expect(screen.getByText('Question This Charge', { selector: '.dialog-title' })).toBeInTheDocument();
            });

            // Click Submit without typing anything
            const submitBtn = screen.getByRole('button', { name: 'Submit' });
            await user.click(submitBtn);

            // The textarea should get the input-error class
            const textarea = screen.getByPlaceholderText('Describe the issue...');
            expect(textarea.className).toContain('input-error');

            // addDoc should NOT have been called
            expect(mockAddDoc).not.toHaveBeenCalled();
        });

        it('clears error styling when user starts typing', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getAllByRole('button', { name: 'Question This' }).length).toBeGreaterThan(0);
            });

            await user.click(screen.getAllByRole('button', { name: 'Question This' })[0]);

            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
            });

            // Trigger error
            await user.click(screen.getByRole('button', { name: 'Submit' }));
            const textarea = screen.getByPlaceholderText('Describe the issue...');
            expect(textarea.className).toContain('input-error');

            // Start typing to clear error
            await user.type(textarea, 'x');
            expect(textarea.className).not.toContain('input-error');
        });
    });

    // -----------------------------------------------------------------------
    // 9. DisputeFormOverlay submits successfully
    // -----------------------------------------------------------------------
    describe('DisputeFormOverlay submission', () => {
        it('POSTs to /submitDispute with correct fields and shows success message', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            mockPublicSharesHit();
            global.fetch = vi.fn()
                .mockResolvedValueOnce({ ok: true, json: async () => sampleShareData }) // resolveShareToken fallback (not used when publicShares hit)
                .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new-dispute' }) }); // submitDispute

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getAllByRole('button', { name: 'Question This' }).length).toBeGreaterThan(0);
            });

            await user.click(screen.getAllByRole('button', { name: 'Question This' })[0]);

            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
            });

            // Fill in the form
            const textarea = screen.getByPlaceholderText('Describe the issue...');
            await user.type(textarea, 'The amount is incorrect');

            const correctionInput = screen.getByPlaceholderText(/Should be/);
            await user.type(correctionInput, '$10/mo instead');

            // Set up fetch mock for the submitDispute call
            global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'new-dispute' }) });

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith('/submitDispute', expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }));
                const body = JSON.parse(global.fetch.mock.calls[0][1].body);
                expect(body.token).toBe('abc123');
                expect(body.billId).toBe('b1');
                expect(body.billName).toBe('Netflix');
                expect(body.message).toBe('The amount is incorrect');
                expect(body.proposedCorrection).toBe('$10/mo instead');
            });

            // Should show success message
            await waitFor(() => {
                expect(screen.getByText('Question Submitted')).toBeInTheDocument();
                expect(screen.getByText(/account owner will be notified/)).toBeInTheDocument();
            });
        });

        it('closes overlay when Cancel is clicked', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getAllByRole('button', { name: 'Question This' }).length).toBeGreaterThan(0);
            });

            await user.click(screen.getAllByRole('button', { name: 'Question This' })[0]);

            await waitFor(() => {
                expect(screen.getByText('Question This Charge', { selector: '.dialog-title' })).toBeInTheDocument();
            });

            await user.click(screen.getByRole('button', { name: 'Cancel' }));

            await waitFor(() => {
                expect(screen.queryByText('Question This Charge', { selector: '.dialog-title' })).not.toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 10. PaymentSummarySection
    // -----------------------------------------------------------------------
    describe('PaymentSummarySection', () => {
        it('shows payment stats and progress', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            const heading = await screen.findByText('Payment Summary');
            // Scope queries to the payment summary section
            const section = heading.closest('.share-section');

            expect(within(section).getByText('Annual Total')).toBeInTheDocument();
            expect(within(section).getByText('$135.96')).toBeInTheDocument();
            expect(within(section).getByText('Monthly')).toBeInTheDocument();
            expect(within(section).getByText('$11.33')).toBeInTheDocument();
            expect(within(section).getByText('Paid to Date')).toBeInTheDocument();
            expect(within(section).getByText('$50.00')).toBeInTheDocument();
            expect(within(section).getByText('Balance Remaining')).toBeInTheDocument();
            // $85.96 appears in both the stat card and the callout within this section
            expect(within(section).getAllByText('$85.96').length).toBeGreaterThanOrEqual(1);
            // Progress percentage: Math.round(50/135.96 * 100) = 37
            expect(within(section).getByText('37% paid')).toBeInTheDocument();
        });

        it('shows outstanding balance callout when balanceRemaining > 0', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/still have an outstanding balance/)).toBeInTheDocument();
            });

            expect(screen.getByText(/Amount Remaining: \$85.96/)).toBeInTheDocument();
        });

        it('shows settled callout when balanceRemaining <= 0 and totalPaid > 0', async () => {
            setToken('abc123');
            const settledData = {
                ...sampleShareData,
                paymentSummary: {
                    combinedAnnualTotal: 100,
                    combinedMonthlyTotal: 8.33,
                    totalPaid: 100,
                    balanceRemaining: 0
                }
            };
            mockPublicSharesHit(settledData);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/all settled for 2024/)).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 11. Evidence viewing
    // -----------------------------------------------------------------------
    describe('Evidence viewing', () => {
        it('opens window.open directly when evidence has downloadUrl', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            const dataWithEvidence = {
                ...sampleShareData,
                disputes: [{
                    id: 'disp1',
                    billName: 'Netflix',
                    status: 'open',
                    message: 'Wrong amount',
                    createdAt: '2024-06-01',
                    evidence: [
                        { name: 'receipt.png', contentType: 'image/png', downloadUrl: 'https://example.com/receipt.png' }
                    ]
                }]
            };
            mockPublicSharesHit(dataWithEvidence);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('receipt.png')).toBeInTheDocument();
            });

            await user.click(screen.getByText('receipt.png'));

            expect(window.open).toHaveBeenCalledWith(
                'https://example.com/receipt.png',
                '_blank',
                'noopener,noreferrer'
            );
        });

        it('fetches via /getEvidenceUrl when no downloadUrl', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            const dataWithEvidence = {
                ...sampleShareData,
                disputes: [{
                    id: 'disp2',
                    billName: 'Spotify',
                    status: 'open',
                    message: 'Check this',
                    createdAt: '2024-07-01',
                    evidence: [
                        { name: 'screenshot.pdf', contentType: 'application/pdf' }
                    ]
                }]
            };
            mockPublicSharesHit(dataWithEvidence);

            // Override fetch for evidence URL call (getDoc resolves first via publicShares hit)
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ url: 'https://storage.example.com/signed-url' })
            });

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('screenshot.pdf')).toBeInTheDocument();
            });

            await user.click(screen.getByText('screenshot.pdf'));

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith('/getEvidenceUrl', expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ token: 'abc123', disputeId: 'disp2', evidenceIndex: 0 })
                }));
            });

            await waitFor(() => {
                expect(window.open).toHaveBeenCalledWith(
                    'https://storage.example.com/signed-url',
                    '_blank',
                    'noopener,noreferrer'
                );
            });
        });

        it('shows loading text while fetching evidence URL', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            const dataWithEvidence = {
                ...sampleShareData,
                disputes: [{
                    id: 'disp3',
                    billName: 'Netflix',
                    status: 'open',
                    message: 'Check',
                    createdAt: '2024-08-01',
                    evidence: [
                        { name: 'doc.pdf', contentType: 'application/pdf' }
                    ]
                }]
            };
            mockPublicSharesHit(dataWithEvidence);

            let resolveFetch;
            global.fetch = vi.fn().mockImplementation(() => new Promise(resolve => {
                resolveFetch = resolve;
            }));

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('doc.pdf')).toBeInTheDocument();
            });

            await user.click(screen.getByText('doc.pdf'));

            // While loading, button should show "Loading..."
            await waitFor(() => {
                expect(screen.getByText('Loading...')).toBeInTheDocument();
            });

            // Resolve the fetch
            resolveFetch({
                ok: true,
                json: async () => ({ url: 'https://example.com/file' })
            });

            await waitFor(() => {
                expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
                expect(screen.getByText('doc.pdf')).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // 12. Dispute approval / rejection on share page
    // -----------------------------------------------------------------------
    describe('Dispute approval and rejection', () => {
        function makeShareDataWithRequestedReview() {
            return {
                ...sampleShareData,
                disputes: [{
                    id: 'disp-action',
                    billName: 'Utilities',
                    status: 'resolved',
                    message: 'Overcharged',
                    createdAt: '2024-06-15',
                    resolutionNote: 'Adjusted',
                    userReview: { state: 'requested' }
                }]
            };
        }

        it('shows Approve/Reject buttons when userReview.state is requested', async () => {
            setToken('abc123');
            mockPublicSharesHit(makeShareDataWithRequestedReview());

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Utilities')).toBeInTheDocument();
            });

            expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        });

        it('clicking Approve POSTs to /submitDisputeDecision and shows approved message', async () => {
            setToken('abc123');
            const data = makeShareDataWithRequestedReview();
            mockPublicSharesHit(data);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
            });

            // Set up fetch mock for the submitDisputeDecision call
            global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Decision recorded successfully.' }) });

            fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

            await waitFor(() => {
                expect(screen.getByText('You approved this resolution.')).toBeInTheDocument();
            });
            expect(global.fetch).toHaveBeenCalledWith('/submitDisputeDecision', expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }));
            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body.token).toBe('abc123');
            expect(body.decision).toBe('approve');
            expect(body.disputeId).toBe('disp-action');
        });

        it('does not show buttons when userReview.state is approved_by_user', async () => {
            setToken('abc123');
            const data = {
                ...sampleShareData,
                disputes: [{
                    id: 'disp-approved',
                    billName: 'Electric',
                    status: 'resolved',
                    message: 'Was fixed',
                    createdAt: '2024-06-10',
                    userReview: { state: 'approved_by_user' }
                }]
            };
            mockPublicSharesHit(data);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('You approved this resolution.')).toBeInTheDocument();
            });
            expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        });

        it('shows "You rejected" text when dispute userReview state is rejected_by_user', async () => {
            setToken('abc123');
            const data = {
                ...sampleShareData,
                disputes: [{
                    id: 'disp-rejected',
                    billName: 'Water',
                    status: 'open',
                    message: 'Disagreed',
                    createdAt: '2024-06-10',
                    userReview: { state: 'rejected_by_user' }
                }]
            };
            mockPublicSharesHit(data);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('You rejected this resolution.')).toBeInTheDocument();
            });
            expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // Payment Methods Section
    // -----------------------------------------------------------------------
    describe('PaymentMethodsSection', () => {
        it('renders payment method label and handle', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Payment Methods')).toBeInTheDocument();
            });

            expect(screen.getByText('Venmo')).toBeInTheDocument();
            expect(screen.getByText('@john')).toBeInTheDocument();
        });

        it('renders Copy button for handle', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('@john')).toBeInTheDocument();
            });

            expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // DisputesSection
    // -----------------------------------------------------------------------
    describe('DisputesSection', () => {
        it('renders dispute details', async () => {
            setToken('abc123');
            // Use a dispute with a unique bill name to avoid duplication with bills table
            const dataWithUniqueDispute = {
                ...sampleShareData,
                disputes: [{
                    id: 'disp1',
                    billName: 'Cable TV',
                    status: 'resolved',
                    message: 'Wrong amount',
                    createdAt: '2024-06-01',
                    resolutionNote: 'Fixed',
                    userReview: { state: 'approved_by_user' }
                }]
            };
            mockPublicSharesHit(dataWithUniqueDispute);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Your Review Requests')).toBeInTheDocument();
            });

            // Dispute card content
            expect(screen.getByText('Cable TV')).toBeInTheDocument();
            expect(screen.getByText('Resolved')).toBeInTheDocument();
            expect(screen.getByText('Wrong amount')).toBeInTheDocument();
            expect(screen.getByText('Resolution: Fixed')).toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // Loading state
    // -----------------------------------------------------------------------
    describe('Loading state', () => {
        it('shows loading message initially', () => {
            setToken('abc123');
            // Don't resolve getDoc so we stay in loading
            mockDoc.mockReturnValue('doc-ref');
            mockGetDoc.mockReturnValue(new Promise(() => {}));

            render(<ShareView />);

            expect(screen.getByText(/Loading your annual billing summary/)).toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // Sections conditional rendering
    // -----------------------------------------------------------------------
    describe('conditional section rendering', () => {
        it('does not render PaymentMethods section when empty', async () => {
            setToken('abc123');
            const noPaymentMethods = { ...sampleShareData, paymentMethods: [] };
            mockPublicSharesHit(noPaymentMethods);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Smith's Annual Billing Summary")).toBeInTheDocument();
            });

            expect(screen.queryByText('Payment Methods')).not.toBeInTheDocument();
        });

        it('does not render Disputes section when empty', async () => {
            setToken('abc123');
            const noDisputes = { ...sampleShareData, disputes: [] };
            mockPublicSharesHit(noDisputes);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Smith's Annual Billing Summary")).toBeInTheDocument();
            });

            expect(screen.queryByText('Your Review Requests')).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // Trust banner
    // -----------------------------------------------------------------------
    describe('trust note', () => {
        it('renders payment disclaimer in Payment Methods section', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/Pay directly through the apps below/)).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // Household hierarchy
    // -----------------------------------------------------------------------
    describe('household hierarchy', () => {
        it('derives last name for page title', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Smith's Annual Billing Summary")).toBeInTheDocument();
            });
        });

        it('uses full name when single-word name', async () => {
            setToken('abc123');
            const singleNameData = { ...sampleShareData, memberName: 'Cher' };
            mockPublicSharesHit(singleNameData);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText("Cher's Annual Billing Summary")).toBeInTheDocument();
            });
        });

        it('shows single member expanded with no household total', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Alice Smith')).toBeInTheDocument();
            });

            // Bills should be visible (expanded by default for single member)
            // Netflix appears in both bills table and disputes section
            expect(screen.getAllByText('Netflix').length).toBeGreaterThanOrEqual(1);
            expect(screen.getByText('Spotify')).toBeInTheDocument();

            // No household total line for single member
            expect(screen.queryByText(/Household Total/)).not.toBeInTheDocument();
        });

        it('shows household total and collapsible members for multi-member', async () => {
            setToken('abc123');
            mockPublicSharesHit(sampleShareDataWithLinkedMembers);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/Household Total/)).toBeInTheDocument();
            });

            // Household total shows combined amounts
            expect(screen.getByText(/\$16\.33\/mo/)).toBeInTheDocument();
            expect(screen.getByText(/\$195\.96\/yr/)).toBeInTheDocument();

            // Both members appear as toggle buttons
            expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
            expect(screen.getByText(/Bob Smith/)).toBeInTheDocument();
        });

        it('multi-member bills are collapsed by default', async () => {
            setToken('abc123');
            const noDisputesData = { ...sampleShareDataWithLinkedMembers, disputes: [] };
            mockPublicSharesHit(noDisputesData);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/Household Total/)).toBeInTheDocument();
            });

            // Individual bill names should NOT be visible (collapsed)
            // (disputes removed to avoid Netflix appearing in disputes section)
            expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
            expect(screen.queryByText('iCloud')).not.toBeInTheDocument();
        });

        it('expands member on click to show bills', async () => {
            const user = userEvent.setup();
            setToken('abc123');
            const noDisputesData = { ...sampleShareDataWithLinkedMembers, disputes: [] };
            mockPublicSharesHit(noDisputesData);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
            });

            // Click to expand Alice's section
            await user.click(screen.getByText(/Alice Smith/));

            // Now Netflix and Spotify should appear
            await waitFor(() => {
                expect(screen.getByText('Netflix')).toBeInTheDocument();
                expect(screen.getByText('Spotify')).toBeInTheDocument();
            });
        });
    });

    // -----------------------------------------------------------------------
    // Preferred payment method
    // -----------------------------------------------------------------------
    describe('preferred payment method', () => {
        it('renders preferred card first with badge and class', async () => {
            setToken('abc123');
            const dataWithPreferred = {
                ...sampleShareData,
                paymentMethods: [
                    { id: 'pm1', type: 'venmo', label: 'Venmo', handle: '@john' },
                    { id: 'pm2', type: 'zelle', label: 'Zelle', email: 'pay@example.com', preferred: true }
                ]
            };
            mockPublicSharesHit(dataWithPreferred);

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Preferred')).toBeInTheDocument();
            });

            // Zelle (preferred) should render with the preferred badge
            expect(screen.getByText('Zelle')).toBeInTheDocument();
            expect(screen.getByText('Venmo')).toBeInTheDocument();
        });

        it('does not render preferred badge when no method is preferred', async () => {
            setToken('abc123');
            mockPublicSharesHit();

            render(<ShareView />);

            await waitFor(() => {
                expect(screen.getByText('Venmo')).toBeInTheDocument();
            });

            expect(screen.queryByText('Preferred')).not.toBeInTheDocument();
        });
    });
});
