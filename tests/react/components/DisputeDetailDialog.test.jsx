import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DisputeDetailDialog from '@/app/components/DisputeDetailDialog.jsx';

vi.mock('../../../src/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('firebase/storage', () => ({
    getDownloadURL: vi.fn(),
    ref: vi.fn()
}));
const mockGetDocs = vi.fn(() => Promise.resolve({ docs: [] }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: (...args) => mockGetDocs(...args)
}));
vi.mock('../../../src/lib/sms.js', () => ({
    openSmsComposer: vi.fn()
}));
vi.mock('@/lib/share.js', () => ({
    buildShareUrl: vi.fn((origin, token) => origin + '/share.html?token=' + token)
}));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user' } }))
}));
const mockQueueEmail = vi.fn(() => Promise.resolve({ id: 'test' }));
vi.mock('@/lib/mail.js', () => ({ queueEmail: (...args) => mockQueueEmail(...args) }));

const defaultProps = {
    open: true,
    dispute: {
        id: 'disp1',
        billName: 'Netflix',
        memberName: 'Alice',
        memberId: 'mem1',
        status: 'open',
        message: 'Amount seems wrong',
        proposedCorrection: 'Should be $10',
        createdAt: '2024-06-01',
        evidence: [],
        resolutionNote: ''
    },
    onUpdate: vi.fn().mockResolvedValue(),
    onStatusChange: vi.fn().mockResolvedValue(),
    onUploadEvidence: vi.fn().mockResolvedValue(),
    onRemoveEvidence: vi.fn().mockResolvedValue(),
    onClose: vi.fn(),
    showToast: vi.fn(),
    familyMembers: [{ id: 'mem1', name: 'Alice', email: 'alice@test.com', phone: '+11234567890' }],
    activeYear: { id: 'y2024', label: '2024' }
};

function renderDialog(overrides = {}) {
    const props = { ...defaultProps, ...overrides };
    if (overrides.dispute) props.dispute = { ...defaultProps.dispute, ...overrides.dispute };
    return render(<DisputeDetailDialog {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onUpdate.mockResolvedValue();
    defaultProps.onStatusChange.mockResolvedValue();
    defaultProps.onUploadEvidence.mockResolvedValue();
    defaultProps.onRemoveEvidence.mockResolvedValue();
});

describe('DisputeDetailDialog', () => {
    describe('visibility', () => {
        it('renders nothing when open is false', () => {
            const { container } = renderDialog({ open: false });
            expect(container.innerHTML).toBe('');
        });

        it('renders nothing when dispute is null', () => {
            const { container } = render(
                <DisputeDetailDialog {...defaultProps} dispute={null} />
            );
            expect(container.innerHTML).toBe('');
        });
    });

    describe('open state content', () => {
        it('shows bill name, status label, member name, message, and proposed correction', () => {
            renderDialog();
            expect(screen.getByText('Netflix')).toBeInTheDocument();
            expect(screen.getByText('Open')).toBeInTheDocument();
            expect(screen.getByText(/From Alice/)).toBeInTheDocument();
            expect(screen.getByText('Amount seems wrong')).toBeInTheDocument();
            expect(screen.getByText('Should be $10')).toBeInTheDocument();
        });
    });

    describe('resolve without note', () => {
        it('shows error when clicking Resolve without a resolution note', async () => {
            const user = userEvent.setup();
            renderDialog();
            await user.click(screen.getByRole('button', { name: 'Resolve' }));
            expect(screen.getByText('Please add a resolution note before resolving.')).toBeInTheDocument();
            expect(defaultProps.onStatusChange).not.toHaveBeenCalled();
        });
    });

    describe('reject without note', () => {
        it('shows error when clicking Reject without a resolution note', async () => {
            const user = userEvent.setup();
            renderDialog();
            await user.click(screen.getByRole('button', { name: 'Reject' }));
            expect(screen.getByText('Please add a resolution note before rejecting.')).toBeInTheDocument();
            expect(defaultProps.onStatusChange).not.toHaveBeenCalled();
        });
    });

    describe('resolve with note', () => {
        it('shows confirmation dialog then calls onStatusChange and closes', async () => {
            const user = userEvent.setup();
            renderDialog();

            const textarea = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(textarea, 'Fixed the amount');
            await user.click(screen.getByRole('button', { name: 'Resolve' }));

            // Confirmation dialog should appear
            expect(screen.getByText('Mark this dispute as resolved? The member will be notified.')).toBeInTheDocument();

            // There are now two "Resolve" buttons — the action button and the confirm button.
            // Click the one inside the ConfirmDialog (last one).
            const resolveButtons = screen.getAllByRole('button', { name: 'Resolve' });
            await user.click(resolveButtons[resolveButtons.length - 1]);

            await waitFor(() => {
                expect(defaultProps.onStatusChange).toHaveBeenCalledOnce();
            });

            const args = defaultProps.onStatusChange.mock.calls[0];
            expect(args[0]).toBe('disp1');
            expect(args[1].status).toBe('resolved');
            expect(args[1].resolutionNote).toBe('Fixed the amount');
            expect(args[1].resolvedAt).toBeDefined();
            expect(defaultProps.onClose).toHaveBeenCalled();
        });
    });

    describe('reject with note', () => {
        it('shows confirmation dialog then calls onStatusChange with rejected status and closes', async () => {
            const user = userEvent.setup();
            renderDialog();

            const textarea = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(textarea, 'Not valid');
            await user.click(screen.getByRole('button', { name: 'Reject' }));

            // Confirmation dialog should appear
            expect(screen.getByText('Reject this dispute? The member will be notified.')).toBeInTheDocument();

            // Click the Reject confirm button inside the ConfirmDialog
            const rejectButtons = screen.getAllByRole('button', { name: 'Reject' });
            // The confirm button in ConfirmDialog is the last one rendered
            await user.click(rejectButtons[rejectButtons.length - 1]);

            await waitFor(() => {
                expect(defaultProps.onStatusChange).toHaveBeenCalledOnce();
            });

            const args = defaultProps.onStatusChange.mock.calls[0];
            expect(args[0]).toBe('disp1');
            expect(args[1].status).toBe('rejected');
            expect(args[1].resolutionNote).toBe('Not valid');
            expect(args[1].rejectedAt).toBeDefined();
            expect(defaultProps.onClose).toHaveBeenCalled();
        });
    });

    describe('mark in review', () => {
        it('calls onUpdate and does NOT close the dialog', async () => {
            const user = userEvent.setup();
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'Mark In Review' }));

            await waitFor(() => {
                expect(defaultProps.onUpdate).toHaveBeenCalledOnce();
            });

            const args = defaultProps.onUpdate.mock.calls[0];
            expect(args[0]).toBe('disp1');
            expect(args[1].status).toBe('in_review');
            expect(defaultProps.onClose).not.toHaveBeenCalled();
        });
    });

    describe('user review checkbox', () => {
        it('checking calls onUpdate with userReview requested', async () => {
            const user = userEvent.setup();
            renderDialog();

            const checkbox = screen.getByRole('checkbox', { name: /request user approval/i });
            await user.click(checkbox);

            await waitFor(() => {
                expect(defaultProps.onUpdate).toHaveBeenCalledWith('disp1', { userReview: { state: 'requested' } });
            });
        });

        it('unchecking calls onUpdate with userReview null', async () => {
            const user = userEvent.setup();
            renderDialog({ dispute: { userReview: { state: 'requested' } } });

            const checkbox = screen.getByRole('checkbox', { name: /request user approval/i });
            expect(checkbox).toBeChecked();

            await user.click(checkbox);

            await waitFor(() => {
                expect(defaultProps.onUpdate).toHaveBeenCalledWith('disp1', { userReview: null });
            });
        });
    });

    describe('evidence upload', () => {
        it('calls onUploadEvidence when a file is selected and resets input', async () => {
            renderDialog();

            const fileInput = document.querySelector('input[type="file"]');
            expect(fileInput).toBeTruthy();

            const file = new File(['data'], 'receipt.pdf', { type: 'application/pdf' });
            fireEvent.change(fileInput, { target: { files: [file] } });

            await waitFor(() => {
                expect(defaultProps.onUploadEvidence).toHaveBeenCalledWith('disp1', file);
            });
        });
    });

    describe('evidence remove', () => {
        it('calls onRemoveEvidence with dispute id and index', async () => {
            const user = userEvent.setup();
            renderDialog({
                dispute: {
                    evidence: [
                        { name: 'doc.pdf', size: 1024, downloadUrl: 'https://example.com/doc.pdf' },
                        { name: 'img.png', size: 2048, downloadUrl: 'https://example.com/img.png' }
                    ]
                }
            });

            const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
            await user.click(removeButtons[1]);

            await waitFor(() => {
                expect(defaultProps.onRemoveEvidence).toHaveBeenCalledWith('disp1', 1);
            });
        });
    });

    describe('terminal state (resolved)', () => {
        it('hides action buttons and shows Close button', () => {
            renderDialog({ dispute: { status: 'resolved', resolutionNote: 'Done' } });

            expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Mark In Review' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
        });

        it('shows share actions (Email, Text, Copy) when member has contact info', () => {
            renderDialog({ dispute: { status: 'resolved', resolutionNote: 'Fixed' } });

            expect(screen.getByText('Share Resolution:')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
        });

        it('does not show user review checkbox', () => {
            renderDialog({ dispute: { status: 'resolved', resolutionNote: 'Fixed' } });
            expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        });
    });

    describe('terminal state without contact info', () => {
        it('does not show Email button when member has no email', () => {
            renderDialog({
                dispute: { status: 'resolved', resolutionNote: 'Done' },
                familyMembers: [{ id: 'mem1', name: 'Alice', phone: '+11234567890' }]
            });

            expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
        });

        it('does not show Text button when member has no phone', () => {
            renderDialog({
                dispute: { status: 'resolved', resolutionNote: 'Done' },
                familyMembers: [{ id: 'mem1', name: 'Alice', email: 'alice@test.com' }]
            });

            expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Text' })).not.toBeInTheDocument();
        });

        it('shows neither Email nor Text when member has no contact info', () => {
            renderDialog({
                dispute: { status: 'resolved', resolutionNote: 'Done' },
                familyMembers: [{ id: 'mem1', name: 'Alice' }]
            });

            expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Text' })).not.toBeInTheDocument();
            // Copy should still be present
            expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
        });
    });

    describe('copy button', () => {
        it('calls navigator.clipboard.writeText when Copy is clicked', async () => {
            const user = userEvent.setup();
            const writeText = vi.fn().mockResolvedValue();
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText },
                writable: true,
                configurable: true
            });

            renderDialog({ dispute: { status: 'resolved', resolutionNote: 'All good' } });

            await user.click(screen.getByRole('button', { name: 'Copy' }));

            await waitFor(() => {
                expect(writeText).toHaveBeenCalledOnce();
            });

            const copiedText = writeText.mock.calls[0][0];
            expect(copiedText).toContain('All good');
            expect(copiedText).toContain('Netflix');
        });
    });

    describe('upload button hidden in terminal state', () => {
        it('does not show Upload Evidence button when resolved', () => {
            renderDialog({ dispute: { status: 'resolved', resolutionNote: 'Done' } });
            expect(screen.queryByRole('button', { name: /upload evidence/i })).not.toBeInTheDocument();
        });

        it('does not show Upload Evidence button when rejected', () => {
            renderDialog({ dispute: { status: 'rejected', resolutionNote: 'No' } });
            expect(screen.queryByRole('button', { name: /upload evidence/i })).not.toBeInTheDocument();
        });
    });

    describe('resolution note disabled in terminal state', () => {
        it('textarea is disabled when status is resolved', () => {
            renderDialog({ dispute: { status: 'resolved', resolutionNote: 'Done' } });
            const textarea = screen.getByPlaceholderText('Add a resolution note...');
            expect(textarea).toBeDisabled();
        });

        it('textarea is disabled when status is rejected', () => {
            renderDialog({ dispute: { status: 'rejected', resolutionNote: 'No' } });
            const textarea = screen.getByPlaceholderText('Add a resolution note...');
            expect(textarea).toBeDisabled();
        });
    });

    describe('evidence view with storagePath', () => {
        it('resolves storagePath to downloadUrl via getDownloadURL on view click', async () => {
            const { getDownloadURL, ref } = await import('firebase/storage');
            getDownloadURL.mockResolvedValue('https://storage.example.com/file.pdf');
            ref.mockReturnValue('mock-ref');

            const user = userEvent.setup();
            const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => {});

            renderDialog({
                dispute: {
                    evidence: [
                        { name: 'receipt.pdf', size: 500, storagePath: 'disputes/disp1/receipt.pdf' }
                    ]
                }
            });

            await user.click(screen.getByRole('button', { name: 'View' }));

            await waitFor(() => {
                expect(getDownloadURL).toHaveBeenCalled();
                expect(windowOpen).toHaveBeenCalledWith(
                    'https://storage.example.com/file.pdf',
                    '_blank',
                    'noopener,noreferrer'
                );
            });

            windowOpen.mockRestore();
        });
    });

    describe('note error clears on typing', () => {
        it('clears the error message when user starts typing in the resolution note', async () => {
            const user = userEvent.setup();
            renderDialog();

            // Trigger error by resolving without note
            await user.click(screen.getByRole('button', { name: 'Resolve' }));
            expect(screen.getByText('Please add a resolution note before resolving.')).toBeInTheDocument();

            // Start typing — error should clear
            const textarea = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(textarea, 'a');
            expect(screen.queryByText('Please add a resolution note before resolving.')).not.toBeInTheDocument();
        });
    });

    describe('mark in review button visibility', () => {
        it('shows Mark In Review only for open disputes', () => {
            renderDialog({ dispute: { status: 'open' } });
            expect(screen.getByRole('button', { name: 'Mark In Review' })).toBeInTheDocument();
        });

        it('does not show Mark In Review for in_review disputes', () => {
            renderDialog({ dispute: { status: 'in_review' } });
            expect(screen.queryByRole('button', { name: 'Mark In Review' })).not.toBeInTheDocument();
            // But Resolve and Reject should still be available
            expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        });
    });

    describe('confirmation dialog cancel', () => {
        it('cancelling the confirmation dialog does not call onStatusChange', async () => {
            const user = userEvent.setup();
            renderDialog();

            const textarea = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(textarea, 'Some note');
            await user.click(screen.getByRole('button', { name: 'Resolve' }));

            // Confirmation dialog visible
            expect(screen.getByText('Mark this dispute as resolved? The member will be notified.')).toBeInTheDocument();

            // Cancel
            await user.click(screen.getByRole('button', { name: 'Cancel' }));

            expect(defaultProps.onStatusChange).not.toHaveBeenCalled();
            expect(defaultProps.onClose).not.toHaveBeenCalled();
        });
    });

    describe('auto-notification on status change (Notification 2)', () => {
        it('sends email with "resolved" when resolving', async () => {
            const user = userEvent.setup();
            renderDialog({ dispute: { status: 'open', resolutionNote: '', evidence: [] } });

            const noteInput = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(noteInput, 'Fixed the amount');
            await user.click(screen.getAllByRole('button', { name: 'Resolve' })[0]);
            // Confirm dialog
            await waitFor(() => expect(screen.getByText(/Mark this dispute as resolved/)).toBeInTheDocument());
            const confirmBtns = screen.getAllByRole('button', { name: 'Resolve' });
            await user.click(confirmBtns[confirmBtns.length - 1]);

            await waitFor(() => {
                expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
                    to: 'alice@test.com'
                }));
                const call = mockQueueEmail.mock.calls[0][0];
                expect(call.body).toContain('resolved');
                expect(call.body).toContain('Fixed the amount');
            });
        });

        it('sends email with "rejected" when rejecting', async () => {
            const user = userEvent.setup();
            renderDialog({ dispute: { status: 'open', resolutionNote: '', evidence: [] } });

            const noteInput = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(noteInput, 'Charges are correct');
            await user.click(screen.getAllByRole('button', { name: 'Reject' })[0]);
            // Confirm dialog
            await waitFor(() => expect(screen.getByText(/Reject this dispute/)).toBeInTheDocument());
            const confirmBtns = screen.getAllByRole('button', { name: 'Reject' });
            await user.click(confirmBtns[confirmBtns.length - 1]);

            await waitFor(() => {
                expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
                    to: 'alice@test.com'
                }));
                const call = mockQueueEmail.mock.calls[0][0];
                expect(call.body).toContain('rejected');
            });
        });

        it('sends email with "under review" when marking In Review', async () => {
            const user = userEvent.setup();
            renderDialog({ dispute: { status: 'open', resolutionNote: '', evidence: [] } });

            await user.click(screen.getByRole('button', { name: 'Mark In Review' }));

            await waitFor(() => {
                expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
                    to: 'alice@test.com'
                }));
                const call = mockQueueEmail.mock.calls[0][0];
                expect(call.body).toContain('under review');
            });
        });

        it('does not send email when member has no email', async () => {
            const user = userEvent.setup();
            renderDialog({
                dispute: { status: 'open', resolutionNote: '', evidence: [] },
                familyMembers: [{ id: 'mem1', name: 'Alice' }] // no email
            });

            await user.click(screen.getByRole('button', { name: 'Mark In Review' }));

            await waitFor(() => {
                expect(defaultProps.onUpdate).toHaveBeenCalled();
            });
            expect(mockQueueEmail).not.toHaveBeenCalled();
        });

        it('email failure does not block the status change', async () => {
            mockQueueEmail.mockRejectedValueOnce(new Error('Email delivery failed'));
            const user = userEvent.setup();
            renderDialog({ dispute: { status: 'open', resolutionNote: '', evidence: [] } });

            const noteInput = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(noteInput, 'Resolved');
            await user.click(screen.getAllByRole('button', { name: 'Resolve' })[0]);
            await waitFor(() => expect(screen.getByText(/Mark this dispute as resolved/)).toBeInTheDocument());
            const confirmBtns = screen.getAllByRole('button', { name: 'Resolve' });
            await user.click(confirmBtns[confirmBtns.length - 1]);

            await waitFor(() => {
                expect(defaultProps.onStatusChange).toHaveBeenCalled();
                expect(defaultProps.onClose).toHaveBeenCalled();
            });
        });
    });

    describe('dedup UI (resolutionNotificationSentAt)', () => {
        it('shows "Re-send Email" when auto-notification was sent', () => {
            renderDialog({
                dispute: {
                    status: 'resolved',
                    resolutionNote: 'Fixed',
                    evidence: [],
                    resolutionNotificationSentAt: '2026-04-01T12:00:00Z'
                }
            });
            expect(screen.getByRole('button', { name: 'Re-send Email' })).toBeInTheDocument();
            expect(screen.getByText(/Auto-notified/)).toBeInTheDocument();
        });

        it('shows "Email" when no auto-notification was sent', () => {
            renderDialog({
                dispute: {
                    status: 'resolved',
                    resolutionNote: 'Fixed',
                    evidence: []
                }
            });
            expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
            expect(screen.queryByText(/Auto-notified/)).toBeNull();
        });
    });

    describe('share-link CTA in notification emails (issue #136)', () => {
        it('includes share link in CTA when userReview is requested and token exists', async () => {
            // Mock getDocs to return an active share token
            mockGetDocs.mockResolvedValueOnce({
                docs: [{
                    data: () => ({
                        rawToken: 'abc123token',
                        billingYearId: 'y2024',
                        scopes: ['disputes:read'],
                        revoked: false,
                        expiresAt: null
                    })
                }]
            });

            const user = userEvent.setup();
            renderDialog({
                dispute: {
                    status: 'open',
                    resolutionNote: '',
                    evidence: [],
                    userReview: { state: 'requested' }
                }
            });

            const noteInput = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(noteInput, 'Fixed');
            await user.click(screen.getAllByRole('button', { name: 'Resolve' })[0]);
            await waitFor(() => expect(screen.getByText(/Mark this dispute as resolved/)).toBeInTheDocument());
            const confirmBtns = screen.getAllByRole('button', { name: 'Resolve' });
            await user.click(confirmBtns[confirmBtns.length - 1]);

            await waitFor(() => {
                expect(mockQueueEmail).toHaveBeenCalled();
                const call = mockQueueEmail.mock.calls[0][0];
                expect(call.body).toContain('[Review & Respond]');
                expect(call.body).toContain('abc123token');
            });
        });

        it('uses fallback text when no share token exists', async () => {
            // Mock getDocs to return empty (no tokens)
            mockGetDocs.mockResolvedValueOnce({ docs: [] });

            const user = userEvent.setup();
            renderDialog({
                dispute: {
                    status: 'open',
                    resolutionNote: '',
                    evidence: [],
                    userReview: { state: 'requested' }
                }
            });

            const noteInput = screen.getByPlaceholderText('Add a resolution note...');
            await user.type(noteInput, 'Fixed');
            await user.click(screen.getAllByRole('button', { name: 'Resolve' })[0]);
            await waitFor(() => expect(screen.getByText(/Mark this dispute as resolved/)).toBeInTheDocument());
            const confirmBtns = screen.getAllByRole('button', { name: 'Resolve' });
            await user.click(confirmBtns[confirmBtns.length - 1]);

            await waitFor(() => {
                expect(mockQueueEmail).toHaveBeenCalled();
                const call = mockQueueEmail.mock.calls[0][0];
                expect(call.body).toContain('using your billing share link');
                expect(call.body).not.toContain('[Review & Respond]');
            });
        });
    });
});
