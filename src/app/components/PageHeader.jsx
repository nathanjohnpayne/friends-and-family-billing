/**
 * PageHeader — shared branded page intro for top-level authenticated routes.
 */
export default function PageHeader({ kicker, title, description, actions = null, className = '' }) {
    const classes = ['page-header'];
    if (className) classes.push(className);

    return (
        <header className={classes.join(' ')}>
            <div className="page-header-copy">
                {kicker && <p className="section-kicker">{kicker}</p>}
                <h1>{title}</h1>
                {description && <p className="page-header-description">{description}</p>}
            </div>
            {actions ? <div className="page-header-actions">{actions}</div> : null}
        </header>
    );
}
