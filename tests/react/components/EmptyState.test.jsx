import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '@/app/components/EmptyState.jsx';

describe('EmptyState', () => {
    it('renders title and message', () => {
        render(<EmptyState title="No items" message="Add some items to get started." />);
        expect(screen.getByText('No items')).toBeInTheDocument();
        expect(screen.getByText('Add some items to get started.')).toBeInTheDocument();
    });

    it('renders icon when provided', () => {
        render(<EmptyState icon="📦" title="Empty" />);
        expect(screen.getByText('📦')).toBeInTheDocument();
    });

    it('renders action slot', () => {
        render(<EmptyState title="No data" action={<button>Add New</button>} />);
        expect(screen.getByText('Add New')).toBeInTheDocument();
    });

    it('omits optional sections when not provided', () => {
        render(<EmptyState title="Bare" />);
        // Only title rendered, no message or action button
        expect(screen.getByText('Bare')).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
