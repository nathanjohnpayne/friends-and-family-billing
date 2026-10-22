/**
 * EmptyState — centered placeholder shown when a list has no items.
 *
 * Styled by `.empty-state` in shell.css after the wireframe's `.empty`
 * primitive (plans/ffb-wireframes.html § Visual system): a dashed Stone
 * frame on Paper, the title in the display face, and an action slot that
 * holds the next-step buttons (RD-19).
 */
export default function EmptyState({ icon, title, message, action }) {
    return (
        <div className="empty-state">
            {icon && <span className="empty-state-icon" aria-hidden="true">{icon}</span>}
            <h3 className="empty-state-title type-display">{title}</h3>
            {message && <p className="empty-state-message">{message}</p>}
            {action && <div className="empty-state-action">{action}</div>}
        </div>
    );
}
