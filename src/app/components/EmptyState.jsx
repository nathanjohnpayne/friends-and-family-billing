/**
 * EmptyState — centered placeholder shown when a list has no items.
 * Matches the legacy empty-state pattern from main.js card rendering.
 */
export default function EmptyState({ icon, title, message, action }) {
    return (
        <div className="empty-state">
            {icon && <span className="empty-state-icon">{icon}</span>}
            <h3 className="empty-state-title">{title}</h3>
            {message && <p className="empty-state-message">{message}</p>}
            {action && <div className="empty-state-action">{action}</div>}
        </div>
    );
}
