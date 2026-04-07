import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), setDoc: vi.fn(() => Promise.resolve()), getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
    collection: vi.fn(), query: vi.fn(), where: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: vi.fn()
}));
vi.mock('@/lib/ShareLinkService.js', () => ({
    createAndPruneShareLink: vi.fn(() => Promise.resolve({ url: 'https://example.com/share?token=test', tokenHash: 'hash', rawToken: 'test' }))
}));

import ShareLinkDialog from '@/app/components/ShareLinkDialog.jsx';

const baseProps = {
    open: true,
    memberId: 1,
    memberName: 'Alice',
    userId: 'user-1',
    billingYearId: '2026',
    yearLabel: '2026',
    familyMembers: [{ id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [] }],
    bills: [{ id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }],
    payments: [],
    activeYear: { id: '2026', label: '2026', status: 'open' },
    settings: {},
    onClose: vi.fn(),
    showToast: vi.fn()
};

describe('ShareLinkDialog', () => {
    it('renders generate tab by default', () => {
        render(<ShareLinkDialog {...baseProps} />);
        expect(screen.getByText(/Generate & Copy Link/)).toBeInTheDocument();
    });

    it('opens manage tab when initialTab=manage', async () => {
        render(<ShareLinkDialog {...baseProps} initialTab="manage" />);
        // Manage tab triggers async loadLinks — wait for it
        await screen.findByText(/No share links generated yet|Loading share links/);
    });

    it('shows expiry and scope options on generate tab', () => {
        render(<ShareLinkDialog {...baseProps} />);
        expect(screen.getByText('Link Expiry')).toBeInTheDocument();
        expect(screen.getByLabelText(/Allow member to request bill reviews/)).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        const { container } = render(<ShareLinkDialog {...baseProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('shows both tab buttons', () => {
        render(<ShareLinkDialog {...baseProps} />);
        expect(screen.getByText('New Link')).toBeInTheDocument();
        expect(screen.getByText('Manage Links')).toBeInTheDocument();
    });
});
