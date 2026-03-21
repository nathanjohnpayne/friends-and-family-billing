import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge, { getPaymentStatus } from '@/app/components/StatusBadge.jsx';

describe('getPaymentStatus', () => {
    it('returns null when total is 0', () => {
        expect(getPaymentStatus(0, 0)).toBeNull();
    });

    it('returns outstanding when nothing paid', () => {
        expect(getPaymentStatus(100, 0)).toBe('outstanding');
    });

    it('returns partial when partially paid', () => {
        expect(getPaymentStatus(100, 50)).toBe('partial');
    });

    it('returns settled when fully paid', () => {
        expect(getPaymentStatus(100, 100)).toBe('settled');
    });

    it('returns overpaid when paid more than owed', () => {
        expect(getPaymentStatus(100, 150)).toBe('overpaid');
    });
});

describe('StatusBadge', () => {
    it('renders outstanding badge', () => {
        render(<StatusBadge status="outstanding" />);
        expect(screen.getByText('Outstanding')).toBeInTheDocument();
    });

    it('renders settled badge', () => {
        render(<StatusBadge status="settled" />);
        expect(screen.getByText('Settled')).toBeInTheDocument();
    });

    it('renders partial badge', () => {
        render(<StatusBadge status="partial" />);
        expect(screen.getByText('Partial')).toBeInTheDocument();
    });

    it('renders nothing for unknown status', () => {
        const { container } = render(<StatusBadge status="unknown" />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing for null status', () => {
        const { container } = render(<StatusBadge status={null} />);
        expect(container.innerHTML).toBe('');
    });
});
