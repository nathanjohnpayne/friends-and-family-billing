/**
 * MembersTab — full CRUD for family members.
 * Port of renderFamilyMembers() from main.js:1116.
 */
import { useState } from 'react';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import { isLinkedToAnyone } from '../../../lib/calculations.js';
import { getHouseholdName } from '../../../lib/household.js';
import { getInitials } from '../../../lib/formatting.js';
import EmptyState from '../../components/EmptyState.jsx';
import ActionMenu, { ActionMenuItem } from '../../components/ActionMenu.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Dialog from '../../components/Dialog.jsx';

export default function MembersTab() {
    const { familyMembers, activeYear, loading, service } = useBillingData();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);

    // Composer state
    const [composerOpen, setComposerOpen] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [composerError, setComposerError] = useState('');

    // Inline edit state
    const [editingId, setEditingId] = useState(null);
    const [editField, setEditField] = useState(null);
    const [editValue, setEditValue] = useState('');

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Household link management
    const [linkTarget, setLinkTarget] = useState(null);
    const [linkSelections, setLinkSelections] = useState([]);

    if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>;

    function handleAdd(e) {
        e.preventDefault();
        setComposerError('');
        try {
            const member = service.addMember({ name, email, phone });
            setName(''); setEmail(''); setPhone('');
            setComposerOpen(false);
            showToast('Member added: ' + member.name);
        } catch (err) {
            setComposerError(err.message);
        }
    }

    function startEdit(memberId, field, currentValue) {
        setEditingId(memberId);
        setEditField(field);
        setEditValue(currentValue || '');
    }

    function saveEdit() {
        if (editingId === null) return;
        try {
            service.updateMember(editingId, { [editField]: editValue });
            showToast('Member updated');
        } catch (err) {
            showToast(err.message, { kind: 'failure' });
        }
        setEditingId(null);
        setEditField(null);
    }

    function cancelEdit() {
        setEditingId(null);
        setEditField(null);
    }

    function handleEditKeyDown(e) {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEdit();
    }

    function confirmDelete(member) {
        setDeleteTarget(member);
    }

    function executeDelete() {
        if (!deleteTarget) return;
        try {
            service.removeMember(deleteTarget.id);
            showToast('Member removed: ' + deleteTarget.name);
        } catch (err) {
            showToast(err.message, { kind: 'failure' });
        }
        setDeleteTarget(null);
    }

    async function makeHouseholdContact(member) {
        try {
            const result = await service.changeHouseholdContact(member.id);
            showToast(result.shareDocsRebuilt === null
                ? member.name + ' is now the household contact. Share links will refresh within the hour.'
                : member.name + ' is now the household contact');
        } catch (err) {
            showToast(err.message, { kind: 'failure' });
        }
    }

    function openLinkManager(member) {
        // Available: individuals, plus members already in this member's household
        setLinkTarget(member);
        setLinkSelections([...(member.linkedMembers || [])]);
    }

    function toggleLinkSelection(memberId) {
        setLinkSelections(prev =>
            prev.includes(memberId)
                ? prev.filter(id => id !== memberId)
                : [...prev, memberId]
        );
    }

    function saveLinkSelections() {
        if (!linkTarget) return;
        try {
            service.updateMember(linkTarget.id, { linkedMembers: linkSelections });
            showToast('Household updated for ' + linkTarget.name);
        } catch (err) {
            showToast(err.message, { kind: 'failure' });
        }
        setLinkTarget(null);
        setLinkSelections([]);
    }

    function getAvailableForLinking(contactId) {
        // Mirrors legacy manageLinkMembers (main.js:1028): members already in THIS
        // contact's household, plus individuals (no household of their own, not in one).
        return familyMembers.filter(m =>
            m.id !== contactId &&
            (m.linkedMembers || []).length === 0 &&
            (!isLinkedToAnyone(familyMembers, m.id) || (familyMembers.find(p => p.id === contactId)?.linkedMembers || []).includes(m.id))
        );
    }

    return (
        <div className="members-tab">
            <div className="tab-header">
                <h3>Members ({familyMembers.length})</h3>
                {!readOnly && (
                    <button
                        className="btn btn-sm btn-ink"
                        onClick={() => setComposerOpen(!composerOpen)}
                    >
                        {composerOpen ? '− Cancel' : '+ Add Member'}
                    </button>
                )}
            </div>

            {composerOpen && !readOnly && (
                <form className="composer-card" onSubmit={handleAdd}>
                    <div className="composer-fields">
                        <input
                            className="composer-input"
                            placeholder="Name *"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            autoFocus
                        />
                        <input
                            className="composer-input"
                            placeholder="Email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                        <input
                            className="composer-input"
                            placeholder="Phone (E.164, e.g. +14155551212)"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                        />
                    </div>
                    {composerError && <p className="composer-error">{composerError}</p>}
                    <button type="submit" className="btn btn-sm btn-ink">Add Member</button>
                </form>
            )}

            {familyMembers.length === 0 ? (
                <EmptyState
                    title="No family members yet"
                    message="Add members to start splitting bills."
                />
            ) : (
                <div className="member-list">
                    {familyMembers.map(member => (
                        <MemberCard
                            key={member.id}
                            member={member}
                            familyMembers={familyMembers}
                            readOnly={readOnly}
                            editingId={editingId}
                            editField={editField}
                            editValue={editValue}
                            setEditValue={setEditValue}
                            onStartEdit={startEdit}
                            onSaveEdit={saveEdit}
                            onCancelEdit={cancelEdit}
                            onEditKeyDown={handleEditKeyDown}
                            onDelete={confirmDelete}
                            onLinkHousehold={openLinkManager}
                            onMakeContact={makeHouseholdContact}
                        />
                    ))}
                </div>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title="Remove Member"
                message={deleteTarget
                    ? 'Remove ' + deleteTarget.name + ' from family members? This will also remove them from all bills and unlink any linked members.'
                    : ''}
                confirmLabel="Remove"
                destructive
                onConfirm={executeDelete}
                onCancel={() => setDeleteTarget(null)}
            />

            {linkTarget && (
                <Dialog
                    onClose={() => { setLinkTarget(null); setLinkSelections([]); }}
                    title={<>Manage Household for {linkTarget.name}</>}
                    footer={(
                        <>
                            <button className="btn btn-sm btn-header-secondary" onClick={() => { setLinkTarget(null); setLinkSelections([]); }}>Cancel</button>
                            <button className="btn btn-sm btn-ink" onClick={saveLinkSelections}>Save Household</button>
                        </>
                    )}
                >
                    <p className="link-manager-hint">
                        Choose who shares a household with {linkTarget.name}.
                        Each member can belong to one household.
                    </p>
                    <div className="link-manager-list">
                        {getAvailableForLinking(linkTarget.id).length === 0 ? (
                            <p className="link-manager-empty">No one else is available. Each member can belong to one household.</p>
                        ) : (
                            getAvailableForLinking(linkTarget.id).map(m => (
                                <div key={m.id} className="checkbox-item">
                                    <input
                                        type="checkbox"
                                        id={'link-' + linkTarget.id + '-' + m.id}
                                        checked={linkSelections.includes(m.id)}
                                        onChange={() => toggleLinkSelection(m.id)}
                                    />
                                    <label htmlFor={'link-' + linkTarget.id + '-' + m.id}>{m.name}</label>
                                </div>
                            ))
                        )}
                    </div>
                </Dialog>
            )}
        </div>
    );
}

function MemberCard({
    member, familyMembers, readOnly,
    editingId, editField, editValue, setEditValue,
    onStartEdit, onSaveEdit, onCancelEdit: _onCancelEdit, onEditKeyDown,
    onDelete, onLinkHousehold, onMakeContact
}) {
    const isChild = isLinkedToAnyone(familyMembers, member.id);
    const linkedNames = (member.linkedMembers || [])
        .map(id => familyMembers.find(m => m.id === id))
        .filter(Boolean)
        .map(m => m.name);
    const householdName = linkedNames.length > 0 ? getHouseholdName(member, familyMembers) : '';

    function renderField(field, value, placeholder) {
        if (editingId === member.id && editField === field) {
            return (
                <input
                    className="inline-edit-input"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={onSaveEdit}
                    onKeyDown={onEditKeyDown}
                    autoFocus
                />
            );
        }
        const display = value || placeholder;
        const isEmpty = !value;
        if (readOnly) {
            return <span className={isEmpty ? 'placeholder-text' : ''}>{display}</span>;
        }
        return (
            <span
                className={'editable' + (isEmpty ? ' placeholder-text' : '')}
                onClick={() => onStartEdit(member.id, field, value)}
                title={'Click to edit ' + field}
            >
                {display}
            </span>
        );
    }

    return (
        <div className={'member-card' + (isChild ? ' member-card--child' : '')}>
            <div className="member-avatar">
                {member.avatar
                    ? <img src={member.avatar} alt={member.name} className="member-avatar-img" />
                    : <span className="member-avatar-initials">{getInitials(member.name)}</span>
                }
            </div>
            <div className="member-info">
                <div className="member-name">{renderField('name', member.name, 'Name')}</div>
                <div className="member-email">{renderField('email', member.email, 'Email not provided')}</div>
                <div className="member-phone">{renderField('phone', member.phone, 'Phone not provided')}</div>
                {linkedNames.length > 0 && (
                    <div className="linked-member-group">
                        <span className="linked-member-group-label">
                            {householdName ? householdName + ' household' : 'Household'}
                        </span>
                        <span className="household-contact-tag">Household contact</span>
                        <div className="linked-member-pill-list">
                            {linkedNames.map(n => (
                                <span key={n} className="linked-member-pill">{n}</span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            {!readOnly && (
                <div className="member-actions-col">
                    <ActionMenu label={'Actions for ' + member.name}>
                        {!isChild && (
                            <ActionMenuItem onClick={() => onLinkHousehold(member)}>
                                {(member.linkedMembers || []).length > 0 ? 'Edit Household' : 'Link Household'}
                            </ActionMenuItem>
                        )}
                        {isChild && onMakeContact && (
                            <ActionMenuItem onClick={() => onMakeContact(member)}>
                                Make household contact
                            </ActionMenuItem>
                        )}
                        <ActionMenuItem onClick={() => onDelete(member)} danger>
                            Delete Member
                        </ActionMenuItem>
                    </ActionMenu>
                </div>
            )}
        </div>
    );
}
