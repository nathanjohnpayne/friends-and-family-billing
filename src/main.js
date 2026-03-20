import { auth, db, storage, analytics, FieldValue, Timestamp } from './platform/firebase.js';

// Data storage
let familyMembers = []; // Array of {id, name, email, avatar, paymentReceived, linkedMembers: [memberIds]}
let bills = []; // Array of {id, name, amount, billingFrequency, logo, website, members: [memberIds]}
let payments = []; // Append-only ledger: [{id, memberId, amount, receivedAt, note, method}]
let billingEvents = []; // Append-only event ledger for audit trail
let settings = {
    emailMessage: 'Your annual billing summary for %billing_year% is ready. Your annual amount due is %annual_total%. Thank you for your prompt payment via any of the payment methods below.',
    paymentLinks: [],
    paymentMethods: []
};

let currentUser = null;
let currentBillingYear = null;
let billingYears = [];

// UI state
let _activeWorkspaceTab = 'bills';
let _summaryFilter = 'all';
let _expandedSettlementIds = new Set();
let _memberComposerOpen = false;
let _billComposerOpen = false;
let _testAutoConfirmDialogs = false;

const CURRENT_MIGRATION_VERSION = 1;

const PAYMENT_METHOD_LABELS = {
    cash: 'Cash',
    check: 'Check',
    venmo: 'Venmo',
    zelle: 'Zelle',
    paypal: 'PayPal',
    cashapp: 'Cash App',
    apple_cash: 'Apple Cash',
    bank_transfer: 'Bank Transfer',
    other: 'Other'
};

function getPaymentMethodLabel(method) {
    if (!method) return 'Other';
    return PAYMENT_METHOD_LABELS[method] || method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' ');
}

// Version checking — polls version.json to detect deploys while the page is open
let _knownVersion = null;
let _updateCheckInterval = null;

async function checkForUpdate() {
    try {
        const resp = await fetch('version.json?_=' + Date.now());
        if (!resp.ok) return;
        const data = await resp.json();
        if (_knownVersion && data.version !== _knownVersion) {
            showUpdateToast();
        }
        _knownVersion = data.version;
    } catch (_) {
        // Network errors are fine — user may be offline
    }
}

function showUpdateToast() {
    const toast = document.getElementById('update-toast');
    if (toast) toast.classList.add('visible');
    if (_updateCheckInterval) {
        clearInterval(_updateCheckInterval);
        _updateCheckInterval = null;
    }
}

function dismissUpdateToast() {
    const toast = document.getElementById('update-toast');
    if (toast) toast.classList.remove('visible');
}

var _changeToastTimer = null;
function showChangeToast(message) {
    var el = document.getElementById('change-toast');
    if (!el) {
        try {
            el = document.createElement('div');
            el.id = 'change-toast';
            el.className = 'change-toast';
            document.body.appendChild(el);
        } catch (e) { return; }
    }
    if (!el || !el.classList) return;
    el.textContent = message;
    el.classList.add('visible');
    if (_changeToastTimer) clearTimeout(_changeToastTimer);
    _changeToastTimer = setTimeout(function() {
        if (el && el.classList) el.classList.remove('visible');
        _changeToastTimer = null;
    }, 3000);
}

function startUpdateChecker() {
    checkForUpdate();
    _updateCheckInterval = setInterval(checkForUpdate, 60000);
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    auth.onAuthStateChanged(async user => {
        if (!user) {
            // User is not logged in, redirect to login page
            window.location.href = 'login.html';
        } else {
            // User is logged in
            currentUser = user;
            document.getElementById('user-email').textContent = user.email;

            // Load user's data FIRST, then render
            await loadData();
            debugDataIntegrity(); // Debug function to check data
            renderBillingYearSelector();
            renderArchivedBanner();
            renderWorkspaceTabs();
            renderFamilyMembers();
            renderBills();
            updateSummary();
            renderEmailSettings();
            renderPaymentMethodsSettings();
            loadDisputes();
            updateComposerVisibility();
            startUpdateChecker();

            var billAmountInput = document.getElementById('billAmount');
            if (billAmountInput) {
                billAmountInput.addEventListener('input', updateBillAmountPreview);
            }
        }
    });
});

// Load data from Firestore
async function loadData() {
    if (!currentUser) return;

    try {
        const userDocRef = db.collection('users').doc(currentUser.uid);
        const userDoc = await userDocRef.get();
        let activeYearId;

        if (userDoc.exists) {
            const userData = userDoc.data();

            if (!userData.activeBillingYear) {
                activeYearId = await migrateLegacyData(userDocRef, userData);
            } else {
                activeYearId = userData.activeBillingYear;
                if (!userData.migrationVersion || userData.migrationVersion < CURRENT_MIGRATION_VERSION) {
                    await userDocRef.set({ migrationVersion: CURRENT_MIGRATION_VERSION }, { merge: true });
                }
            }
        } else {
            activeYearId = String(new Date().getFullYear());
            await userDocRef.set({ activeBillingYear: activeYearId });
            const yearDocRef = userDocRef.collection('billingYears').doc(activeYearId);
            await yearDocRef.set({
                label: activeYearId,
                status: 'open',
                createdAt: FieldValue.serverTimestamp(),
                archivedAt: null,
                familyMembers: [],
                bills: [],
                payments: [],
                settings: settings,
                updatedAt: FieldValue.serverTimestamp()
            });
        }

        await loadBillingYearsList();
        await loadBillingYearData(activeYearId);

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Error loading your data. Please refresh the page.');
    }
}

// Debug function to check data integrity
function debugDataIntegrity() {
    console.log('=== DATA INTEGRITY CHECK ===');
    console.log('Family Members:', familyMembers.length);
    console.log('Member IDs:', familyMembers.map(m => m.id));
    console.log('Member Names:', familyMembers.map(m => m.name));

    bills.forEach(bill => {
        console.log(`Bill: ${bill.name}`);
        console.log(`  - Member IDs in bill:`, bill.members);
        console.log(`  - Number of members: ${bill.members.length}`);

        // Check for invalid member IDs
        const invalidIds = bill.members.filter(id => !familyMembers.some(m => m.id === id));
        if (invalidIds.length > 0) {
            console.warn(`  - WARNING: Invalid member IDs found:`, invalidIds);
        }
    });
    console.log('=== END CHECK ===');
}

// Repair duplicate member IDs and invalid bill references
function repairDuplicateIds() {
    const seenIds = new Set();
    const needsRepair = familyMembers.some(m => {
        if (seenIds.has(m.id)) {
            return true;
        }
        seenIds.add(m.id);
        return false;
    });

    if (needsRepair) {
        console.log('Repairing duplicate member IDs...');
        const idMap = {}; // Map old ID to new ID
        let baseId = Date.now();

        familyMembers.forEach((member, index) => {
            const oldId = member.id;
            const newId = baseId + index;
            member.id = newId;
            idMap[oldId] = newId;
        });

        // Update bills to reference new member IDs
        bills.forEach(bill => {
            bill.members = bill.members.map(memberId => idMap[memberId] || memberId);
        });

        saveData();
        console.log('Repair complete. Member IDs fixed.');
    }

    // Also clean up any invalid member references in bills
    cleanupInvalidBillMembers();
}

// Remove invalid member IDs from bills
function cleanupInvalidBillMembers() {
    const validMemberIds = new Set(familyMembers.map(m => m.id));
    let cleanedAny = false;

    bills.forEach(bill => {
        const originalLength = bill.members.length;
        bill.members = bill.members.filter(memberId => validMemberIds.has(memberId));

        if (bill.members.length !== originalLength) {
            console.log(`Cleaned invalid members from ${bill.name}: ${originalLength} -> ${bill.members.length}`);
            cleanedAny = true;
        }
    });

    if (cleanedAny) {
        saveData();
        console.log('Invalid bill member references cleaned up.');
    }
}

// Serialized write queue — each saveData() chains onto the previous write
// so concurrent calls never overwrite each other out of order.
let _saveChain = Promise.resolve();

function saveData() {
    if (!currentUser || !currentBillingYear) return Promise.resolve();
    if (isYearReadOnly()) {
        console.warn('Cannot save: billing year is ' + (currentBillingYear ? currentBillingYear.status : 'locked'));
        return Promise.resolve();
    }

    _saveChain = _saveChain.then(async () => {
        try {
            const yearDocRef = db.collection('users').doc(currentUser.uid)
                .collection('billingYears').doc(currentBillingYear.id);
            const settingsForSave = Object.assign({}, settings);
            if (settingsForSave.paymentMethods) {
                settingsForSave.paymentMethods = settingsForSave.paymentMethods.map(m => {
                    if (m.qrCode) {
                        const copy = Object.assign({}, m);
                        copy.hasQrCode = true;
                        delete copy.qrCode;
                        return copy;
                    }
                    return m;
                });
            }
            await yearDocRef.set({
                label: currentBillingYear.label,
                status: currentBillingYear.status,
                createdAt: currentBillingYear.createdAt || FieldValue.serverTimestamp(),
                archivedAt: currentBillingYear.archivedAt || null,
                familyMembers: familyMembers,
                bills: bills,
                payments: payments,
                billingEvents: billingEvents,
                settings: settingsForSave,
                updatedAt: FieldValue.serverTimestamp()
            });
            console.log('Data saved successfully');
            refreshPublicShares();
        } catch (error) {
            console.error('Error saving data:', error);
            alert('Error saving your data. Please try again.');
        }
    });
    return _saveChain;
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        auth.signOut().then(() => {
            window.location.href = 'login.html';
        }).catch(error => {
            console.error('Logout error:', error);
            alert('Error logging out. Please try again.');
        });
    }
}

// ──────────────── Billing Year Functions ────────────────

function isArchivedYear() {
    return currentBillingYear != null && currentBillingYear.status === 'archived';
}

function isClosedYear() {
    return currentBillingYear != null && currentBillingYear.status === 'closed';
}

function isSettlingYear() {
    return currentBillingYear != null && currentBillingYear.status === 'settling';
}

function isYearReadOnly() {
    return isClosedYear() || isArchivedYear();
}

function yearReadOnlyMessage() {
    if (isArchivedYear()) return 'This billing year is archived and read-only.';
    if (isClosedYear()) return 'This billing year is closed. All balances are settled.';
    return '';
}

const BILLING_YEAR_STATUSES = {
    open:     { label: 'Open',     order: 0, color: 'primary' },
    settling: { label: 'Settling', order: 1, color: 'warning' },
    closed:   { label: 'Closed',   order: 2, color: 'success' },
    archived: { label: 'Archived', order: 3, color: 'muted' }
};

function getBillingYearStatusLabel(status) {
    return (BILLING_YEAR_STATUSES[status] || BILLING_YEAR_STATUSES.open).label;
}

async function setBillingYearStatus(newStatus) {
    if (!currentBillingYear || !currentUser) return;
    if (currentBillingYear.status === newStatus) return;

    var previousStatus = currentBillingYear.status;
    const updates = { status: newStatus };
    if (newStatus === 'closed') updates.closedAt = FieldValue.serverTimestamp();
    if (newStatus === 'archived') updates.archivedAt = FieldValue.serverTimestamp();

    emitBillingEvent('YEAR_STATUS_CHANGED', {
        previousStatus: previousStatus, newStatus: newStatus,
        yearLabel: currentBillingYear.label
    });
    updates.billingEvents = billingEvents;

    try {
        const yearDocRef = db.collection('users').doc(currentUser.uid)
            .collection('billingYears').doc(currentBillingYear.id);

        await yearDocRef.set(updates, { merge: true });

        currentBillingYear.status = newStatus;
        if (newStatus === 'closed') currentBillingYear.closedAt = new Date();
        if (newStatus === 'archived') currentBillingYear.archivedAt = new Date();

        const yearInList = billingYears.find(y => y.id === currentBillingYear.id);
        if (yearInList) yearInList.status = newStatus;

        _loadedDisputes = [];
        renderBillingYearSelector();
        renderStatusBanner();
        renderWorkspaceTabs();
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();
        renderPaymentMethodsSettings();
        renderDisputeFilterBar([]);
        renderDisputes([]);
        renderDashboardStatus();
        loadDisputes();
        updateComposerVisibility();
    } catch (error) {
        console.error('Error updating billing year status:', error);
        alert('Error updating billing year status. Please try again.');
    }
}

async function migrateLegacyData(userDocRef, userData) {
    const yearId = String(new Date().getFullYear());
    const yearDocRef = userDocRef.collection('billingYears').doc(yearId);

    const existingYearDoc = await yearDocRef.get();
    if (!existingYearDoc.exists) {
        const yearData = {
            label: yearId,
            status: 'open',
            createdAt: FieldValue.serverTimestamp(),
            archivedAt: null,
            familyMembers: userData.familyMembers || [],
            bills: userData.bills || [],
            payments: userData.payments || [],
            settings: userData.settings || settings,
            updatedAt: FieldValue.serverTimestamp()
        };

        await yearDocRef.set(yearData);
    }

    await userDocRef.set({
        activeBillingYear: yearId,
        migrationVersion: CURRENT_MIGRATION_VERSION
    }, { merge: true });

    console.log('Migration v' + CURRENT_MIGRATION_VERSION + ' complete — data in billing year ' + yearId);
    return yearId;
}

async function loadBillingYearsList() {
    if (!currentUser) return;
    const userDocRef = db.collection('users').doc(currentUser.uid);
    const snapshot = await userDocRef.collection('billingYears').get();

    billingYears = [];
    snapshot.docs.forEach(function(doc) {
        const data = doc.data();
        billingYears.push({
            id: doc.id,
            label: data.label || doc.id,
            status: data.status || 'open',
        });
    });

    billingYears.sort(function(a, b) { return b.label.localeCompare(a.label); });
}

async function loadBillingYearData(yearId) {
    if (!currentUser) return;
    const userDocRef = db.collection('users').doc(currentUser.uid);
    const yearDocRef = userDocRef.collection('billingYears').doc(yearId);
    const yearDoc = await yearDocRef.get();

    if (yearDoc.exists) {
        const yearData = yearDoc.data();
        currentBillingYear = {
            id: yearId,
            label: yearData.label || yearId,
            status: yearData.status || 'open',
            createdAt: yearData.createdAt,
            archivedAt: yearData.archivedAt || null,
        };

        familyMembers = (yearData.familyMembers || []).map(m => {
            if (!m.email) m.email = '';
            if (!m.phone) m.phone = '';
            if (!m.avatar) m.avatar = '';
            if (m.paymentReceived === undefined) m.paymentReceived = 0;
            if (!m.linkedMembers) m.linkedMembers = [];
            return m;
        });

        bills = (yearData.bills || []).map(b => {
            if (!b.logo) b.logo = '';
            if (!b.website) b.website = '';
            if (!b.members) b.members = [];
            if (!b.billingFrequency) b.billingFrequency = 'monthly';
            return b;
        });

        payments = yearData.payments || [];
        billingEvents = yearData.billingEvents || [];

        if (yearData.settings) {
            settings = yearData.settings;
            if (!settings.paymentLinks) settings.paymentLinks = [];
            if (!settings.paymentMethods) {
                settings.paymentMethods = migratePaymentLinksToMethods(settings.paymentLinks);
            }
        }

        await loadQrCodesFromFirestore();

        if (!isYearReadOnly() && familyMembers.length > 0) {
            repairDuplicateIds();
        }

        migratePaymentReceivedToLedger();
    } else {
        currentBillingYear = { id: yearId, label: yearId, status: 'open', createdAt: null, archivedAt: null };
        familyMembers = [];
        bills = [];
        payments = [];
    }
}

async function switchBillingYear(yearId) {
    if (!currentUser) return;

    try {
        const userDocRef = db.collection('users').doc(currentUser.uid);
        await userDocRef.set({ activeBillingYear: yearId }, { merge: true });

        await loadBillingYearData(yearId);

        _loadedDisputes = [];
        renderBillingYearSelector();
        renderArchivedBanner();
        renderWorkspaceTabs();
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();
        renderPaymentMethodsSettings();
        renderDisputeFilterBar([]);
        renderDisputes([]);
        renderDashboardStatus();
        loadDisputes();
        updateComposerVisibility();
    } catch (error) {
        console.error('Error switching billing year:', error);
        alert('Error switching billing year. Please try again.');
    }
}

async function archiveCurrentYear() {
    if (!currentBillingYear || isArchivedYear()) return;

    const msg = 'Archive billing year ' + currentBillingYear.label + '?\n\n'
        + 'This will make all records read-only.\n'
        + 'You can still view historical data later.';

    if (!confirm(msg)) return;

    await setBillingYearStatus('archived');

    if (confirm('Year archived successfully. Would you like to start a new billing year?')) {
        await startNewYear();
    }
}

async function startNewYear() {
    const curLabel = currentBillingYear ? parseInt(currentBillingYear.label) : NaN;
    const nextYear = !isNaN(curLabel) ? Math.max(new Date().getFullYear(), curLabel + 1) : new Date().getFullYear();
    const defaultLabel = String(nextYear);

    const label = prompt('Enter label for the new billing year:', defaultLabel);
    if (!label || !label.trim()) return;

    const yearId = label.trim();

    if (billingYears.some(y => y.id === yearId)) {
        alert('Billing year "' + yearId + '" already exists.');
        return;
    }

    try {
        const userDocRef = db.collection('users').doc(currentUser.uid);

        const clonedMembers = familyMembers.map(m => ({
            id: m.id,
            name: m.name,
            email: m.email,
            phone: m.phone || '',
            avatar: m.avatar,
            paymentReceived: 0,
            linkedMembers: m.linkedMembers ? m.linkedMembers.slice() : []
        }));
        const clonedBills = bills.map(b => ({
            id: b.id,
            name: b.name,
            amount: b.amount,
            billingFrequency: b.billingFrequency || 'monthly',
            logo: b.logo,
            website: b.website,
            members: b.members ? b.members.slice() : []
        }));

        const yearData = {
            label: yearId,
            status: 'open',
            createdAt: FieldValue.serverTimestamp(),
            archivedAt: null,
            familyMembers: clonedMembers,
            bills: clonedBills,
            payments: [],
            billingEvents: [],
            settings: {
                emailMessage: settings.emailMessage,
                paymentLinks: (settings.paymentLinks || []).map(l => ({...l})),
                paymentMethods: (settings.paymentMethods || []).map(m => ({...m}))
            },
            updatedAt: FieldValue.serverTimestamp()
        };

        await userDocRef.collection('billingYears').doc(yearId).set(yearData);
        await userDocRef.set({ activeBillingYear: yearId }, { merge: true });

        await loadBillingYearsList();
        await loadBillingYearData(yearId);

        _loadedDisputes = [];
        renderBillingYearSelector();
        renderArchivedBanner();
        renderWorkspaceTabs();
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();
        renderPaymentMethodsSettings();
        renderDisputeFilterBar([]);
        renderDisputes([]);
        renderDashboardStatus();
        loadDisputes();
        updateComposerVisibility();

        alert('Billing year ' + yearId + ' created successfully!');
    } catch (error) {
        console.error('Error creating new year:', error);
        alert('Error creating new billing year. Please try again.');
    }
}

function confirmStartSettlement() {
    const yearLabel = currentBillingYear ? currentBillingYear.label : '';
    showConfirmationDialog(
        'Start Settlement',
        'This will move billing year ' + yearLabel + ' into the Settling phase. Members can no longer be added or removed, and invoices can be sent. Continue?',
        'Start Settlement',
        function() { setBillingYearStatus('settling'); },
        false
    );
}

function confirmBackToOpen() {
    const yearLabel = currentBillingYear ? currentBillingYear.label : '';
    showConfirmationDialog(
        'Reopen Billing Year',
        'This will move billing year ' + yearLabel + ' back to Open. Settlement progress will be preserved, but the year will no longer be in settling mode. Continue?',
        'Back to Open',
        function() { setBillingYearStatus('open'); },
        true
    );
}

function confirmCloseYear() {
    closeCurrentYear();
}

function confirmArchiveYear() {
    const yearLabel = currentBillingYear ? currentBillingYear.label : '';
    showConfirmationDialog(
        'Archive Billing Year',
        'This will archive billing year ' + yearLabel + '. Archived years are permanently read-only. Continue?',
        'Archive Year',
        function() { archiveCurrentYear(); },
        true
    );
}

function confirmReopenToSettling() {
    const yearLabel = currentBillingYear ? currentBillingYear.label : '';
    showConfirmationDialog(
        'Reopen to Settling',
        'This will move billing year ' + yearLabel + ' back to the Settling phase. Continue?',
        'Reopen to Settling',
        function() { setBillingYearStatus('settling'); },
        false
    );
}

function confirmStartNewYear() {
    startNewYear();
}

function renderBillingYearSelector() {
    const container = document.getElementById('billingYearControls');
    if (!container || !currentBillingYear) return;

    const options = billingYears.map(y => {
        const statusLabel = getBillingYearStatusLabel(y.status);
        const selected = y.id === currentBillingYear.id ? 'selected' : '';
        return '<option value="' + escapeHtml(y.id) + '" ' + selected + '>' + escapeHtml(y.label) + ' (' + statusLabel + ')</option>';
    }).join('');

    const status = currentBillingYear.status || 'open';
    const actions = [];

    if (status === 'open') {
        actions.push('<button onclick="confirmStartSettlement()" class="btn btn-header-secondary btn-sm">Start Settlement</button>');
    } else if (status === 'settling') {
        actions.push('<button onclick="confirmCloseYear()" class="btn btn-header-secondary btn-sm">Close Year</button>');
        actions.push('<button onclick="confirmBackToOpen()" class="btn btn-header-tertiary">Back to Open</button>');
    } else if (status === 'closed') {
        actions.push('<button onclick="confirmArchiveYear()" class="btn btn-header-secondary btn-sm">Archive Year</button>');
        actions.push('<button onclick="confirmReopenToSettling()" class="btn btn-header-tertiary">Reopen to Settling</button>');
    }

    if (status !== 'archived') {
        actions.push('<button onclick="confirmStartNewYear()" class="btn btn-primary btn-sm">Start New Year</button>');
    }

    container.innerHTML =
        '<div class="billing-year-command-card">'
        + '<div class="billing-year-command-head">'
        + '<span class="billing-year-command-kicker">Billing Controls</span>'
        + '<span class="billing-year-command-note">Switch years or move this one through settlement.</span>'
        + '</div>'
        + '<div class="billing-year-select-wrap">'
        + '<span class="billing-year-control-label">Active Year</span>'
        + '<select id="billingYearSelect" onchange="switchBillingYear(this.value)">' + options + '</select>'
        + '</div>'
        + (actions.length
            ? '<div class="billing-year-action-group">' + actions.join('') + '</div>'
            : '')
        + '</div>';
}

function renderStatusBanner() {
    const banner = document.getElementById('archivedBanner');
    if (!banner) return;

    if (!currentBillingYear || currentBillingYear.status !== 'archived') {
        banner.style.display = 'none';
        banner.className = 'archived-banner';
        return;
    }

    banner.style.display = 'block';
    banner.className = 'archived-banner';
    banner.innerHTML = 'This billing year is archived. Records are preserved and cannot be modified.';
}

function renderArchivedBanner() {
    renderStatusBanner();
}

async function closeCurrentYear() {
    if (!currentBillingYear) return;

    const summary = calculateAnnualSummary();
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(m.id));
    let totalOutstanding = 0;
    mainMembers.forEach(member => {
        let combinedTotal = summary[member.id] ? summary[member.id].total : 0;
        (member.linkedMembers || []).forEach(id => {
            if (summary[id]) combinedTotal += summary[id].total;
        });
        const payment = getPaymentTotalForMember(member.id) +
            (member.linkedMembers || []).reduce((s, id) => s + getPaymentTotalForMember(id), 0);
        const balance = combinedTotal - payment;
        if (balance > 0) totalOutstanding += balance;
    });

    let msg = 'Close billing year ' + currentBillingYear.label + '.';
    if (totalOutstanding > 0) {
        msg += ' $' + totalOutstanding.toFixed(2) + ' is still outstanding. Closing will prevent further payments.';
    }
    msg += ' You can archive it later for permanent read-only storage.';

    showConfirmationDialog(
        'Close Billing Year',
        msg,
        'Close Year',
        function() { setBillingYearStatus('closed'); },
        true
    );
}

// Escape user-controlled strings before interpolating into HTML
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Only allow data: image URIs (produced by the Canvas compression pipeline).
// Rejects external URLs, javascript: schemes, and malformed values.
function sanitizeImageSrc(src) {
    if (!src) return '';
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(src)) return src;
    return '';
}

// Validate E.164 phone format: + followed by 1-15 digits
function isValidE164(phone) {
    return /^\+[1-9]\d{1,14}$/.test(phone);
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function generateAvatar(member) {
    const safeSrc = sanitizeImageSrc(member.avatar);
    if (safeSrc) {
        return `<img src="${safeSrc}" alt="${escapeHtml(member.name)}" class="avatar" />`;
    }
    return `<div class="avatar avatar-initials">${escapeHtml(getInitials(member.name))}</div>`;
}

function generateLogo(bill) {
    const safeSrc = sanitizeImageSrc(bill.logo);
    if (safeSrc) {
        return `<img src="${safeSrc}" alt="${escapeHtml(bill.name)}" class="logo" />`;
    }
    return `<div class="logo logo-text">${escapeHtml(bill.name)}</div>`;
}

// Helper: Upload image and convert to base64 (with compression)
function uploadImage(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/jpg';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Create an image element to compress the file
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (event) => {
                img.onload = () => {
                    // Create canvas for compression
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Set max dimensions (for avatars/logos we don't need huge images)
                    const maxWidth = 200;
                    const maxHeight = 200;
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions while maintaining aspect ratio
                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    // Fill with white background for JPEG (in case of transparency)
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);

                    // Draw image
                    ctx.drawImage(img, 0, 0, width, height);

                    // Use PNG format to preserve transparency (slightly larger but no black backgrounds)
                    const compressedBase64 = canvas.toDataURL('image/png');
                    callback(compressedBase64);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

function uploadQrCode(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/jpg';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const img = new Image();
            const reader = new FileReader();
            reader.onload = (event) => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxDim = 600;
                    let width = img.width;
                    let height = img.height;
                    if (width > height) {
                        if (width > maxDim) { height *= maxDim / width; width = maxDim; }
                    } else {
                        if (height > maxDim) { width *= maxDim / height; height = maxDim; }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.imageSmoothingEnabled = false;
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    const imageData = ctx.getImageData(0, 0, width, height);
                    const px = imageData.data;
                    for (let i = 0; i < px.length; i += 4) {
                        const avg = (px[i] + px[i + 1] + px[i + 2]) / 3;
                        if (avg > 210) {
                            px[i] = px[i + 1] = px[i + 2] = 255;
                        } else if (avg < 45) {
                            px[i] = px[i + 1] = px[i + 2] = 0;
                        } else {
                            px[i] = Math.round(px[i] / 51) * 51;
                            px[i + 1] = Math.round(px[i + 1] / 51) * 51;
                            px[i + 2] = Math.round(px[i + 2] / 51) * 51;
                        }
                    }
                    ctx.putImageData(imageData, 0, 0);
                    callback(canvas.toDataURL('image/png'));
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

// Helper: Generate unique ID for members
function generateUniqueId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const existingIds = familyMembers.map(m => m.id);
    let newId = timestamp + random;

    // Ensure uniqueness
    while (existingIds.includes(newId)) {
        newId++;
    }

    return newId;
}

// Helper: Generate unique ID for bills
function generateUniqueBillId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const existingIds = bills.map(b => b.id);
    let newId = timestamp + random;

    // Ensure uniqueness
    while (existingIds.includes(newId)) {
        newId++;
    }

    return newId;
}

// Add family member
function addFamilyMember() {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const input = document.getElementById('memberName');
    const emailInput = document.getElementById('memberEmail');
    const name = input.value.trim();
    const email = emailInput.value.trim();

    if (!name) {
        alert('Please enter a family member name');
        return;
    }

    if (familyMembers.some(m => m.name === name)) {
        alert('This family member already exists');
        return;
    }

    const phoneInput = document.getElementById('memberPhone');
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (phone && !isValidE164(phone)) {
        alert('Please enter a valid phone number in E.164 format (e.g. +14155551212) or leave blank.');
        return;
    }

    const member = {
        id: generateUniqueId(),
        name: name,
        email: email,
        phone: phone,
        avatar: '',
        paymentReceived: 0,
        linkedMembers: []
    };

    familyMembers.push(member);
    input.value = '';
    emailInput.value = '';
    if (phoneInput) phoneInput.value = '';

    // Collapse composer after successful add
    _memberComposerOpen = false;
    const composerPanel = document.getElementById('memberComposerPanel');
    const composerBtn = document.getElementById('memberComposerBtn');
    if (composerPanel) composerPanel.style.display = 'none';
    if (composerBtn) composerBtn.textContent = '+ Add Member';

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();
    showChangeToast('Member added: ' + name);

    // Analytics: Track family member added
    if (analytics) {
        analytics.logEvent('family_member_added', {
            has_email: !!email,
            total_members: familyMembers.length
        });
    }
}

// Edit family member
function editFamilyMember(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    const newName = prompt('Enter new name:', member.name);
    if (!newName || newName.trim() === '') return;

    const trimmedName = newName.trim();
    if (trimmedName === member.name) return;

    if (familyMembers.some(m => m.name === trimmedName && m.id !== id)) {
        alert('This family member name already exists');
        return;
    }

    member.name = trimmedName;

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();
}

// Edit family member email
function editMemberEmail(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    const newEmail = prompt('Enter email address:', member.email);
    if (newEmail === null) return;

    member.email = newEmail.trim();

    saveData();
    renderFamilyMembers();
}

// Edit family member phone
function editMemberPhone(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    const newPhone = prompt('Enter phone number (E.164 format, e.g. +14155551212):', member.phone);
    if (newPhone === null) return;

    const trimmed = newPhone.trim();
    if (trimmed && !isValidE164(trimmed)) {
        alert('Invalid phone number. Use E.164 format (e.g. +14155551212) or leave blank to clear.');
        return;
    }

    member.phone = trimmed;

    saveData();
    renderFamilyMembers();
}

// Upload avatar
function uploadAvatar(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    uploadImage((base64) => {
        const member = familyMembers.find(m => m.id === id);
        if (member) {
            member.avatar = base64;
            saveData();
            renderFamilyMembers();
        }
    });
}

// Remove avatar
function removeAvatar(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === id);
    if (member) {
        member.avatar = '';
        saveData();
        renderFamilyMembers();
    }
}

function manageLinkMembers(parentId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const parent = familyMembers.find(m => m.id === parentId);
    if (!parent) return;

    // Include members already linked to THIS parent, plus unlinked non-parents
    const availableMembers = familyMembers.filter(m =>
        m.id !== parentId &&
        m.linkedMembers.length === 0 &&
        (!isLinkedToAnyone(m.id) || parent.linkedMembers.includes(m.id))
    );

    if (availableMembers.length === 0) {
        alert('No available members to link. Members can only be linked to one parent.');
        return;
    }

    let message = `Select members to link to ${parent.name}:\n\n`;
    message += 'Enter the numbers separated by commas (e.g., 1,3,4) or "0" to clear all links:\n\n';

    availableMembers.forEach((m, index) => {
        const isCurrentlyLinked = parent.linkedMembers.includes(m.id);
        message += `${index + 1}. ${m.name}${isCurrentlyLinked ? ' [LINKED]' : ''}\n`;
    });

    const input = prompt(message);
    if (input === null) return;

    if (input.trim() === '0') {
        parent.linkedMembers = [];
    } else {
        const selections = input.split(',').map(s => parseInt(s.trim()) - 1);
        parent.linkedMembers = selections
            .filter(i => i >= 0 && i < availableMembers.length)
            .map(i => availableMembers[i].id);
    }

    saveData();
    renderFamilyMembers();
    updateSummary();
}

// Check if a member is linked to anyone
function isLinkedToAnyone(memberId) {
    return familyMembers.some(m => m.linkedMembers.includes(memberId));
}

// Get parent of a member (if any)
function getParentMember(memberId) {
    return familyMembers.find(m => m.linkedMembers.includes(memberId));
}

// Remove family member
function removeFamilyMember(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    if (!confirm(`Remove ${member.name} from family members? This will also remove them from all bills and unlink any linked members.`)) {
        return;
    }

    // Remove from other members' linked lists
    familyMembers.forEach(m => {
        m.linkedMembers = m.linkedMembers.filter(linkedId => linkedId !== id);
    });

    familyMembers = familyMembers.filter(m => m.id !== id);

    payments = payments.filter(p => p.memberId !== id);

    // Remove from all bills
    bills.forEach(bill => {
        bill.members = bill.members.filter(memberId => memberId !== id);
    });

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();
    showChangeToast('Member removed: ' + member.name);
}

// Render family members
function renderLinkedHouseholdPills(member) {
    const linkedNames = (member.linkedMembers || [])
        .map(id => {
            const linked = familyMembers.find(m => m.id === id);
            return linked ? escapeHtml(linked.name) : null;
        })
        .filter(name => name);

    if (linkedNames.length === 0) return '';

    return '<div class="linked-member-group">'
        + '<span class="linked-member-group-label">Household</span>'
        + '<div class="linked-member-pill-list">'
        + linkedNames.map(name => '<span class="linked-member-pill">' + name + '</span>').join('')
        + '</div>'
        + '</div>';
}

function renderFamilyMembers() {
    const container = document.getElementById('familyMembersList');
    const archived = isYearReadOnly();

    const addMemberSection = document.querySelector('.family-members-input');
    if (addMemberSection) {
        addMemberSection.style.display = archived ? 'none' : '';
    }

    if (familyMembers.length === 0) {
        container.innerHTML = '<p class="empty-state">No family members added yet</p>';
        return;
    }

    container.innerHTML = familyMembers.map(member => {
        const householdActionLabel = (member.linkedMembers || []).length > 0 ? 'Edit Household' : 'Link Household';
        return `
        <div class="member-card" data-member-id="${member.id}">
            ${archived
                ? `<div class="member-avatar-container">${generateAvatar(member)}</div>`
                : `<button type="button" class="member-avatar-container member-avatar-button member-avatar-action" onclick="uploadAvatar(${member.id})" title="${member.avatar ? 'Change avatar photo' : 'Add avatar photo'}" aria-label="${member.avatar ? 'Change photo for ' : 'Add photo for '}${escapeHtml(member.name)}">${generateAvatar(member)}</button>`}
            <div class="member-info">
                <div class="member-name" ${archived ? '' : `onclick="editFamilyMember(${member.id})" title="Click to edit name"`}>${escapeHtml(member.name)}</div>
                <div class="member-email" ${archived ? '' : `onclick="editMemberEmail(${member.id})" title="Click to edit email"`}>
                    ${escapeHtml(member.email) || '<span class="placeholder-text">Email not provided</span>'}
                </div>
                <div class="member-phone" ${archived ? '' : `onclick="editMemberPhone(${member.id})" title="Click to edit phone"`}>
                    ${escapeHtml(member.phone) || '<span class="placeholder-text">Phone not provided</span>'}
                </div>
                ${renderLinkedHouseholdPills(member)}
            </div>
            ${archived ? '' : `<div class="member-actions">
                <button class="member-household-btn" onclick="manageLinkMembers(${member.id})" title="Link dependents or household members to this primary member">${householdActionLabel}</button>
                <div class="member-actions-dropdown">
                    <button type="button" class="member-menu-button" onclick="toggleMemberActionsMenu(event, ${member.id})" aria-label="More actions for ${escapeHtml(member.name)}" aria-expanded="false" aria-controls="member-actions-menu-${member.id}">•••</button>
                    <div class="member-actions-menu" id="member-actions-menu-${member.id}" aria-label="More actions for ${escapeHtml(member.name)}">
                        <button type="button" onclick="uploadAvatar(${member.id})">${member.avatar ? 'Change Photo' : 'Add Photo'}</button>
                        ${member.avatar ? `<button type="button" onclick="removeAvatar(${member.id})">Remove Photo</button>` : ''}
                        <button type="button" class="danger" onclick="removeFamilyMember(${member.id})">Delete Member</button>
                    </div>
                </div>
            </div>`}
        </div>
    `}).join('');
}

function closeActionMenus() {
    var openMenus = document.querySelectorAll('.bill-actions-menu.open, .member-actions-menu.open');
    openMenus.forEach(function(menu) {
        menu.classList.remove('open');
        var toggle = document.querySelector('[aria-controls="' + menu.id + '"]');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
}

function toggleMemberActionsMenu(event, memberId) {
    event.stopPropagation();
    var button = event.currentTarget;
    var menu = document.getElementById('member-actions-menu-' + memberId);
    if (!menu) return;
    var shouldOpen = !menu.classList.contains('open');
    closeActionMenus();
    if (!shouldOpen) return;
    menu.classList.add('open');
    if (button) button.setAttribute('aria-expanded', 'true');
    var firstAction = menu.querySelector('button');
    if (firstAction) firstAction.focus();
}

// ──────────────── Money Integrity Layer — Event Ledger ─────────────────────

function generateEventId() {
    return 'evt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

function emitBillingEvent(eventType, payload, note, source) {
    var event = {
        id: generateEventId(),
        timestamp: new Date().toISOString(),
        actor: {
            type: 'admin',
            userId: currentUser ? currentUser.uid : null
        },
        eventType: eventType,
        payload: payload || {},
        note: note || '',
        source: source || 'ui'
    };
    billingEvents.push(event);
    return event;
}

function getBillingEventsForBill(billId) {
    return billingEvents.filter(function(e) {
        return e.payload && e.payload.billId === billId;
    }).sort(function(a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });
}

function getBillingEventsForMember(memberId) {
    return billingEvents.filter(function(e) {
        return e.payload && e.payload.memberId === memberId;
    }).sort(function(a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });
}

function getBillingEventsForPayment(paymentId) {
    return billingEvents.filter(function(e) {
        return e.payload && (e.payload.paymentId === paymentId || e.payload.reversesPaymentId === paymentId);
    });
}

var BILLING_EVENT_LABELS = {
    BILL_CREATED: 'Bill created',
    BILL_UPDATED: 'Bill updated',
    BILL_DELETED: 'Bill removed',
    MEMBER_ADDED_TO_BILL: 'Member added',
    MEMBER_REMOVED_FROM_BILL: 'Member removed',
    PAYMENT_RECORDED: 'Payment recorded',
    PAYMENT_REVERSED: 'Payment reversed',
    YEAR_STATUS_CHANGED: 'Year status changed'
};

// ──────────────── Billing Frequency Helpers ─────────────────────

function getBillAnnualAmount(bill) {
    if (bill.billingFrequency === 'annual') return bill.amount;
    return bill.amount * 12;
}

function getBillMonthlyAmount(bill) {
    if (bill.billingFrequency === 'annual') return bill.amount / 12;
    return bill.amount;
}

function getBillFrequencyLabel(bill) {
    return bill.billingFrequency === 'annual' ? ' / year' : ' / month';
}

function setAddBillFrequency(frequency) {
    var toggle = document.getElementById('billFrequencyToggle');
    if (!toggle) return;
    var buttons = toggle.querySelectorAll('.frequency-option');
    buttons.forEach(function(btn) {
        if (btn.getAttribute('data-frequency') === frequency) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    var label = document.getElementById('billAmountLabel');
    if (label) {
        label.textContent = frequency === 'annual' ? 'Annual Amount ($)' : 'Monthly Amount ($)';
    }
    updateBillAmountPreview();
}

function getAddBillFrequency() {
    var toggle = document.getElementById('billFrequencyToggle');
    if (!toggle) return 'monthly';
    var active = toggle.querySelector('.frequency-option.active');
    return active ? active.getAttribute('data-frequency') : 'monthly';
}

function updateBillAmountPreview() {
    var preview = document.getElementById('billAmountPreview');
    if (!preview) return;
    var amountEl = document.getElementById('billAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value);
    if (!amount || amount <= 0 || isNaN(amount)) {
        preview.textContent = '';
        return;
    }
    var frequency = getAddBillFrequency();
    if (frequency === 'monthly') {
        preview.textContent = '\u2248 $' + (amount * 12).toFixed(2) + ' per year';
    } else {
        preview.textContent = '\u2248 $' + (amount / 12).toFixed(2) + ' per month';
    }
}

// Add bill
function addBill() {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const nameInput = document.getElementById('billName');
    const amountInput = document.getElementById('billAmount');
    const websiteInput = document.getElementById('billWebsite');

    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const website = websiteInput.value.trim();

    if (!name) {
        alert('Please enter a bill name');
        return;
    }

    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    if (website && !/^https?:\/\//i.test(website)) {
        alert('Please enter a website URL starting with http:// or https://');
        return;
    }

    if (familyMembers.length === 0) {
        alert('Please add family members first');
        return;
    }

    const billingFrequency = getAddBillFrequency();

    const bill = {
        id: generateUniqueBillId(),
        name: name,
        amount: amount,
        billingFrequency: billingFrequency,
        logo: '',
        website: website,
        members: []
    };

    bills.push(bill);
    emitBillingEvent('BILL_CREATED', {
        billId: bill.id, billName: name, amount: amount,
        billingFrequency: billingFrequency, website: website
    });

    nameInput.value = '';
    amountInput.value = '';
    websiteInput.value = '';
    setAddBillFrequency('monthly');
    var preview = document.getElementById('billAmountPreview');
    if (preview) preview.textContent = '';

    // Collapse composer after successful add
    _billComposerOpen = false;
    const billComposerPanel = document.getElementById('billComposerPanel');
    const billComposerBtn = document.getElementById('billComposerBtn');
    if (billComposerPanel) billComposerPanel.style.display = 'none';
    if (billComposerBtn) billComposerBtn.textContent = '+ Add Bill';

    saveData();
    renderBills();
    updateSummary();
    const freqLabel = billingFrequency === 'annual' ? ' / year' : ' / month';
    showChangeToast('Bill added: ' + name + ' ($' + amount.toFixed(2) + freqLabel + '). All totals recalculated.');

    // Analytics: Track bill added
    if (analytics) {
        analytics.logEvent('bill_added', {
            has_website: !!website,
            amount: amount,
            billing_frequency: billingFrequency,
            total_bills: bills.length
        });
    }
}

// Edit bill name
function editBillName(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newName = prompt('Enter new bill name:', bill.name);
    if (!newName || newName.trim() === '') return;

    const previousName = bill.name;
    bill.name = newName.trim();
    emitBillingEvent('BILL_UPDATED', {
        billId: id, field: 'name',
        previousValue: previousName, newValue: bill.name
    });

    saveData();
    renderBills();
}

// Edit bill amount
function editBillAmount(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const freqLabel = bill.billingFrequency === 'annual' ? 'annual' : 'monthly';
    const newAmount = prompt('Enter new ' + freqLabel + ' amount:', bill.amount);
    if (!newAmount || newAmount.trim() === '') return;

    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    const previousAmount = bill.amount;
    bill.amount = amount;
    emitBillingEvent('BILL_UPDATED', {
        billId: id, billName: bill.name, field: 'amount',
        previousValue: previousAmount, newValue: amount,
        billingFrequency: bill.billingFrequency
    });

    saveData();
    renderBills();
    updateSummary();
    showChangeToast('Bill updated: ' + bill.name + ' now $' + amount.toFixed(2) + getBillFrequencyLabel(bill) + '. All totals recalculated.');
}

// Toggle bill billing frequency between monthly and annual
function toggleBillFrequency(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const currentFreq = bill.billingFrequency || 'monthly';
    const targetFreq = currentFreq === 'annual' ? 'monthly' : 'annual';
    const newAmount = currentFreq === 'annual'
        ? Math.round((bill.amount / 12) * 100) / 100
        : Math.round((bill.amount * 12) * 100) / 100;

    var msg = 'Convert ' + bill.name + ' from ' + currentFreq + ' to ' + targetFreq + ' billing. '
        + 'The stored amount will change from $' + bill.amount.toFixed(2) + ' to $' + newAmount.toFixed(2) + '. '
        + 'All totals will be recalculated.';

    showConfirmationDialog(
        'Convert Billing Frequency',
        msg,
        'Convert to ' + targetFreq,
        function() {
            var previousFrequency = bill.billingFrequency || 'monthly';
            var previousAmount = bill.amount;
            bill.amount = newAmount;
            bill.billingFrequency = targetFreq;

            emitBillingEvent('BILL_UPDATED', {
                billId: id, billName: bill.name, field: 'billingFrequency',
                previousValue: previousFrequency, newValue: bill.billingFrequency,
                previousAmount: previousAmount, newAmount: bill.amount
            });

            saveData();
            renderBills();
            updateSummary();
            showChangeToast('Bill updated: ' + bill.name + ' now $' + bill.amount.toFixed(2) + getBillFrequencyLabel(bill) + '. All totals recalculated.');
        },
        false
    );
}

function editBillWebsite(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newWebsite = prompt('Enter website URL:', bill.website);
    if (newWebsite === null) return;

    const trimmed = newWebsite.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        alert('Please enter a URL starting with http:// or https://');
        return;
    }

    const previousWebsite = bill.website;
    bill.website = trimmed;
    emitBillingEvent('BILL_UPDATED', {
        billId: id, billName: bill.name, field: 'website',
        previousValue: previousWebsite, newValue: trimmed
    });

    saveData();
    renderBills();
}

// Show audit history for a bill
function showBillAuditHistory(billId) {
    var bill = bills.find(function(b) { return b.id === billId; });
    var billName = bill ? escapeHtml(bill.name) : 'Deleted bill';

    ensureDialogContainer();
    var overlay = document.getElementById('payment-dialog-overlay');
    var dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    var events = getBillingEventsForBill(billId);

    var rows = events.length > 0
        ? events.map(function(evt) {
            var date = new Date(evt.timestamp).toLocaleString();
            var label = BILLING_EVENT_LABELS[evt.eventType] || evt.eventType;
            var detail = '';
            if (evt.payload) {
                if (evt.eventType === 'BILL_CREATED') {
                    var freq = evt.payload.billingFrequency === 'annual' ? ' / year' : ' / month';
                    detail = '$' + (evt.payload.amount || 0).toFixed(2) + freq;
                } else if (evt.eventType === 'BILL_UPDATED' && evt.payload.field === 'amount') {
                    detail = '$' + (evt.payload.previousValue || 0).toFixed(2) + ' → $' + (evt.payload.newValue || 0).toFixed(2);
                } else if (evt.eventType === 'BILL_UPDATED' && evt.payload.field === 'name') {
                    detail = escapeHtml(evt.payload.previousValue || '') + ' → ' + escapeHtml(evt.payload.newValue || '');
                } else if (evt.eventType === 'BILL_UPDATED' && evt.payload.field === 'billingFrequency') {
                    detail = (evt.payload.previousValue || '') + ' → ' + (evt.payload.newValue || '');
                } else if (evt.eventType === 'MEMBER_ADDED_TO_BILL') {
                    detail = escapeHtml(evt.payload.memberName || '') + ' joined';
                } else if (evt.eventType === 'MEMBER_REMOVED_FROM_BILL') {
                    detail = escapeHtml(evt.payload.memberName || '') + ' left';
                } else if (evt.eventType === 'BILL_DELETED') {
                    detail = 'Bill removed';
                }
            }
            return '<div class="audit-event-item">'
                + '<div class="audit-event-header">'
                + '<span class="audit-event-label">' + label + '</span>'
                + '<span class="audit-event-date">' + escapeHtml(date) + '</span>'
                + '</div>'
                + (detail ? '<div class="audit-event-detail">' + detail + '</div>' : '')
                + (evt.note ? '<div class="audit-event-note">' + escapeHtml(evt.note) + '</div>' : '')
                + '</div>';
        }).join('')
        : '<p class="empty-state-compact">No history recorded yet</p>';

    dialog.innerHTML = '<div class="dialog-header">'
        + '<h3>History: ' + billName + '</h3>'
        + '<button class="dialog-close" onclick="closePaymentDialog()">&times;</button>'
        + '</div>'
        + '<div class="dialog-body">'
        + '<div class="audit-event-list">' + rows + '</div>'
        + '</div>'
        + '<div class="dialog-footer">'
        + '<button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>'
        + '</div>';

    overlay.classList.add('visible');
}

// Upload logo
function uploadLogo(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    uploadImage((base64) => {
        const bill = bills.find(b => b.id === id);
        if (bill) {
            bill.logo = base64;
            saveData();
            renderBills();
        }
    });
}

// Remove logo
function removeLogo(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const bill = bills.find(b => b.id === id);
    if (bill) {
        bill.logo = '';
        saveData();
        renderBills();
    }
}

// Remove bill
function removeBill(id) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    var bill = bills.find(function(b) { return b.id === id; });
    var billName = bill ? bill.name : '';
    if (!confirm('Remove this bill?')) return;

    emitBillingEvent('BILL_DELETED', {
        billId: id, billName: billName,
        amount: bill ? bill.amount : 0,
        billingFrequency: bill ? bill.billingFrequency : 'monthly',
        memberCount: bill ? bill.members.length : 0
    });
    bills = bills.filter(b => b.id !== id);

    saveData();
    renderBills();
    updateSummary();
    if (billName) showChangeToast('Bill removed: ' + billName + '. All totals recalculated.');
}

// Toggle member for a bill
function toggleMember(billId, memberId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;

    const memberObj = familyMembers.find(m => m.id === memberId);
    const index = bill.members.indexOf(memberId);

    if (index === -1) {
        bill.members.push(memberId);
        emitBillingEvent('MEMBER_ADDED_TO_BILL', {
            billId: billId, billName: bill.name,
            memberId: memberId, memberName: memberObj ? memberObj.name : '',
            newMemberCount: bill.members.length
        });
    } else {
        bill.members.splice(index, 1);
        emitBillingEvent('MEMBER_REMOVED_FROM_BILL', {
            billId: billId, billName: bill.name,
            memberId: memberId, memberName: memberObj ? memberObj.name : '',
            newMemberCount: bill.members.length
        });
    }

    saveData();
    updateSummary();
    var action = index === -1 ? 'added to' : 'removed from';
    showChangeToast((memberObj ? memberObj.name : 'Member') + ' ' + action + ' ' + bill.name + '. Totals recalculated.');
}

// Render bills
function renderBills() {
    const container = document.getElementById('billsList');
    const archived = isYearReadOnly();

    const addBillSection = document.querySelector('.bill-input-section');
    if (addBillSection) {
        addBillSection.style.display = archived ? 'none' : '';
    }

    if (bills.length === 0) {
        container.innerHTML = '<p class="empty-state">No bills added yet</p>';
        return;
    }

    container.innerHTML = bills.map(bill => {
        const annualAmount = getBillAnnualAmount(bill);
        const memberCount = bill.members.length;
        const isAnnual = bill.billingFrequency === 'annual';
        const billTierClass = annualAmount >= 1000
            ? ' bill-item-major'
            : annualAmount >= 300
                ? ' bill-item-medium'
                : ' bill-item-light';
        const perPersonDisplay = memberCount > 0
            ? (isAnnual
                ? '$' + (annualAmount / memberCount).toFixed(2) + ' per person annually'
                : '$' + (annualAmount / memberCount / 12).toFixed(2) + ' per person monthly')
            : 'No members assigned yet';
        const cadenceSummary = isAnnual
            ? 'Billed annually \u00b7 Monthly equivalent \u2248 $' + getBillMonthlyAmount(bill).toFixed(2)
            : 'Billed monthly \u00b7 Annualized \u2248 $' + getBillAnnualAmount(bill).toFixed(2);
        const safeWebsite = (bill.website && /^https?:\/\//i.test(bill.website)) ? escapeHtml(bill.website) : '';
        const freqLabel = getBillFrequencyLabel(bill);
        const cadenceActionLabel = isAnnual ? 'Convert to monthly billing' : 'Convert to annual billing';
        const splitSummary = memberCount > 0
            ? memberCount + ' member' + (memberCount !== 1 ? 's' : '') + ' \u00b7 ' + perPersonDisplay
            : perPersonDisplay;

        return `
            <div class="bill-item${billTierClass}" data-bill-id="${bill.id}">
                <div class="bill-header-main">
                    <div class="bill-logo-container">
                        ${generateLogo(bill)}
                    </div>
                    <div class="bill-header">
                        <div class="bill-header-left">
                            <div class="bill-title${archived ? '' : ' editable'}" ${archived ? '' : `onclick="editBillName(${bill.id})" title="Click to edit name"`}>${escapeHtml(bill.name)}</div>
                        </div>
                        <div class="bill-header-right">
                            <span class="bill-amount${archived ? '' : ' editable'}" ${archived ? '' : `onclick="editBillAmount(${bill.id})" title="Click to edit amount"`}>$${bill.amount.toFixed(2)}${freqLabel}</span>
                            <div class="bill-derived-amount">${cadenceSummary}</div>
                        </div>
                    </div>
                </div>

                <div class="bill-split-section">
                    <div class="bill-split-collapsed" id="bill-split-collapsed-${bill.id}">
                        <span class="split-summary-text">${splitSummary}</span>
                        ${archived ? '' : `<button class="btn-link" onclick="toggleBillSplit(${bill.id})">Edit split</button>`}
                    </div>
                    <div class="bill-split-expanded" id="bill-split-expanded-${bill.id}" style="display:none;">
                        <div class="split-header-row">
                            <span class="split-header">Split with:</span>
                            <button class="btn-link" onclick="toggleBillSplit(${bill.id})">Collapse</button>
                        </div>
                        <div class="member-checkboxes">
                            ${familyMembers.map(member => `
                                <div class="checkbox-item">
                                    <input
                                        type="checkbox"
                                        id="bill-${bill.id}-${member.id}"
                                        ${bill.members.includes(member.id) ? 'checked' : ''}
                                        ${archived ? 'disabled' : `onchange="toggleMember(${bill.id}, ${member.id})"`}
                                    />
                                    <label for="bill-${bill.id}-${member.id}">${escapeHtml(member.name)}</label>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="bill-actions">
                    ${archived
                        ? `<button class="btn btn-secondary btn-sm" onclick="showBillAuditHistory(${bill.id})">History</button>`
                        : `<div class="bill-actions-dropdown">
                            <button type="button" class="btn btn-secondary btn-sm bill-menu-button" onclick="toggleBillActionsMenu(event, ${bill.id})" aria-expanded="false" aria-controls="bill-actions-menu-${bill.id}">More ▾</button>
                            <div class="bill-actions-menu" id="bill-actions-menu-${bill.id}" aria-label="More actions for ${escapeHtml(bill.name)}">
                                <button type="button" onclick="showBillAuditHistory(${bill.id})">History</button>
                                <button type="button" onclick="toggleBillFrequency(${bill.id})">${cadenceActionLabel}</button>
                                ${safeWebsite ? `<button type="button" onclick="openBillWebsite(${bill.id})">Open Website</button>` : ''}
                                <button type="button" onclick="editBillWebsite(${bill.id})">Edit Website</button>
                                <button type="button" onclick="uploadLogo(${bill.id})">Upload Logo</button>
                                ${bill.logo ? `<button type="button" onclick="removeLogo(${bill.id})">Remove Logo</button>` : ''}
                                <button type="button" class="danger" onclick="removeBill(${bill.id})">Remove Bill</button>
                            </div>
                        </div>`}
                </div>
            </div>
        `;
    }).join('');
}

function toggleBillSplit(billId) {
    var collapsed = document.getElementById('bill-split-collapsed-' + billId);
    var expanded = document.getElementById('bill-split-expanded-' + billId);
    if (!collapsed || !expanded) return;
    if (expanded.style.display === 'none') {
        expanded.style.display = 'block';
        collapsed.style.display = 'none';
    } else {
        expanded.style.display = 'none';
        collapsed.style.display = 'flex';
    }
}

function toggleBillActionsMenu(event, billId) {
    event.stopPropagation();
    var button = event.currentTarget;
    var menu = document.getElementById('bill-actions-menu-' + billId);
    if (!menu) return;
    var shouldOpen = !menu.classList.contains('open');
    closeActionMenus();
    if (!shouldOpen) return;
    menu.classList.add('open');
    if (button) button.setAttribute('aria-expanded', 'true');
    var firstAction = menu.querySelector('button');
    if (firstAction) firstAction.focus();
}

function openBillWebsite(billId) {
    var bill = bills.find(function(b) { return b.id === billId; });
    if (!bill || !bill.website || !/^https?:\/\//i.test(bill.website)) return;
    window.open(bill.website, '_blank', 'noopener,noreferrer');
}

document.addEventListener('click', function() {
    closeActionMenus();
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeActionMenus();
    }
});

document.addEventListener('focusin', function(event) {
    if (!event.target.closest('.bill-actions-dropdown, .member-actions-dropdown')) {
        closeActionMenus();
    }
});

// Calculate annual summary
function calculateAnnualSummary() {
    const summary = {};

    // Initialize all family members with 0
    familyMembers.forEach(member => {
        summary[member.id] = {
            member: member,
            total: 0,
            bills: []
        };
    });

    // Calculate each member's share using canonical amounts
    bills.forEach(bill => {
        if (bill.members.length > 0) {
            const annualTotal = getBillAnnualAmount(bill);
            const annualPerPerson = annualTotal / bill.members.length;
            const monthlyPerPerson = annualPerPerson / 12;

            bill.members.forEach(memberId => {
                if (summary[memberId]) {
                    summary[memberId].total += annualPerPerson;
                    summary[memberId].bills.push({
                        bill: bill,
                        monthlyShare: monthlyPerPerson,
                        annualShare: annualPerPerson
                    });
                }
            });
        }
    });

    return summary;
}

function getCalculationBreakdown(memberSummary) {
    if (!memberSummary || !memberSummary.bills || memberSummary.bills.length === 0) return '';
    var lines = memberSummary.bills.map(function(b) {
        var billName = escapeHtml(b.bill.name);
        var amount = '$' + b.bill.amount.toFixed(2);
        var splitCount = b.bill.members.length;
        var isAnnual = b.bill.billingFrequency === 'annual';
        var formula;
        if (isAnnual) {
            formula = amount + ' / year &divide; ' + splitCount + ' = $' + b.annualShare.toFixed(2);
        } else {
            formula = amount + ' / month &times; 12 &divide; ' + splitCount + ' = $' + b.annualShare.toFixed(2);
        }
        return '<div class="calc-breakdown-line">'
            + '<span class="calc-breakdown-name">' + billName + '</span>'
            + '<span class="calc-breakdown-math">' + formula + '</span>'
            + '</div>';
    });
    return '<div class="calc-breakdown">' + lines.join('') + '</div>';
}

function toggleCalcBreakdown(memberId) {
    var el = document.getElementById('calc-breakdown-' + memberId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function getPaymentStatusBadge(total, payment) {
    if (total <= 0) return '';
    if (payment <= 0) return '<span class="payment-status-badge outstanding">Outstanding</span>';
    if (payment >= total) return '<span class="payment-status-badge paid">Settled</span>';
    return '<span class="payment-status-badge partial">Partial</span>';
}

function calculateSettlementMetrics() {
    const summary = calculateAnnualSummary();
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(m.id));

    let totalAnnual = 0;
    let totalPayments = 0;
    let paidCount = 0;

    mainMembers.forEach(member => {
        let combinedTotal = summary[member.id] ? summary[member.id].total : 0;
        (member.linkedMembers || []).forEach(id => {
            if (summary[id]) combinedTotal += summary[id].total;
        });
        const payment = getPaymentTotalForMember(member.id) +
            (member.linkedMembers || []).reduce((s, id) => s + getPaymentTotalForMember(id), 0);
        totalAnnual += combinedTotal;
        totalPayments += payment;
        if (combinedTotal > 0 && payment >= combinedTotal) paidCount++;
    });

    const totalOutstanding = Math.max(0, totalAnnual - totalPayments);
    const percentage = totalAnnual > 0 ? Math.min(100, Math.round((totalPayments / totalAnnual) * 100)) : 0;

    return {
        totalAnnual: totalAnnual,
        totalPayments: totalPayments,
        totalOutstanding: totalOutstanding,
        paidCount: paidCount,
        totalMembers: mainMembers.length,
        percentage: percentage
    };
}

function toggleActionMenu(event) {
    event.stopPropagation();
    const trigger = event.currentTarget;
    const menu = event.currentTarget.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    closeAllActionMenus();
    if (!wasOpen) {
        menu.classList.add('open');
        const settlementRow = trigger.closest('.settlement-row-card');
        if (settlementRow) settlementRow.classList.add('settlement-row-card-menu-open');
    }
}

function closeAllActionMenus() {
    document.querySelectorAll('.actions-dropdown-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.settlement-row-card-menu-open').forEach(card => card.classList.remove('settlement-row-card-menu-open'));
}

document.addEventListener('click', closeAllActionMenus);

// ──────────────── Settlement Board State ────────────────

function setSummaryFilter(filter) {
    _summaryFilter = filter;
    updateSummary();
}

function toggleSettlementDetail(memberId) {
    if (_expandedSettlementIds.has(memberId)) {
        _expandedSettlementIds.delete(memberId);
    } else {
        _expandedSettlementIds.add(memberId);
    }
    updateSummary();
}

// ──────────────── Workspace Tabs ────────────────

function switchWorkspaceTab(tabId) {
    _activeWorkspaceTab = tabId;
    document.querySelectorAll('.workspace-panel').forEach(p => {
        p.style.display = p.id === 'panel-' + tabId ? '' : 'none';
    });
    document.querySelectorAll('.workspace-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
    });
}

function renderWorkspaceTabs() {
    const bar = document.getElementById('workspaceTabs');
    if (!bar) return;
    const tabs = [
        { id: 'members', label: 'Members' },
        { id: 'bills', label: 'Bills' },
        { id: 'invoicing', label: 'Invoicing' },
        { id: 'reviews', label: 'Review Requests' }
    ];
    bar.innerHTML = tabs.map(t =>
        '<button class="workspace-tab' + (_activeWorkspaceTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '" onclick="switchWorkspaceTab(\'' + t.id + '\')">' + escapeHtml(t.label) + '</button>'
    ).join('');
    // Ensure correct panel visibility
    switchWorkspaceTab(_activeWorkspaceTab);

    // Add sticky shadow when tab bar is stuck to top
    if (typeof IntersectionObserver !== 'undefined' && !bar._stickyObserverAttached) {
        const sentinel = document.createElement('div');
        sentinel.className = 'workspace-tab-sentinel';
        sentinel.style.height = '1px';
        sentinel.style.marginBottom = '-1px';
        bar.parentNode.insertBefore(sentinel, bar);
        const observer = new IntersectionObserver(
            ([entry]) => { bar.classList.toggle('stuck', !entry.isIntersecting); },
            { threshold: 0 }
        );
        observer.observe(sentinel);
        bar._stickyObserverAttached = true;
    }
}

// ──────────────── Composer Panels ────────────────

function toggleMemberComposer() {
    if (isYearReadOnly()) return;
    _memberComposerOpen = !_memberComposerOpen;
    const panel = document.getElementById('memberComposerPanel');
    const btn = document.getElementById('memberComposerBtn');
    if (panel) panel.style.display = _memberComposerOpen ? '' : 'none';
    if (btn) btn.textContent = _memberComposerOpen ? '− Cancel' : '+ Add Member';
}

function toggleBillComposer() {
    if (isYearReadOnly()) return;
    _billComposerOpen = !_billComposerOpen;
    const panel = document.getElementById('billComposerPanel');
    const btn = document.getElementById('billComposerBtn');
    if (panel) panel.style.display = _billComposerOpen ? '' : 'none';
    if (btn) btn.textContent = _billComposerOpen ? '− Cancel' : '+ Add Bill';
}

function updateComposerVisibility() {
    const readOnly = isYearReadOnly();
    const memberToggle = document.getElementById('memberComposerToggle');
    const billToggle = document.getElementById('billComposerToggle');
    if (memberToggle) memberToggle.style.display = readOnly ? 'none' : '';
    if (billToggle) billToggle.style.display = readOnly ? 'none' : '';
    // Close composers when switching to read-only year
    if (readOnly) {
        _memberComposerOpen = false;
        _billComposerOpen = false;
        const mp = document.getElementById('memberComposerPanel');
        const bp = document.getElementById('billComposerPanel');
        if (mp) mp.style.display = 'none';
        if (bp) bp.style.display = 'none';
    }
}

// Update summary display
function updateSummary() {
    const container = document.getElementById('annualSummary');
    const summary = calculateAnnualSummary();
    const archived = isYearReadOnly();

    if (familyMembers.length === 0) {
        container.innerHTML = '<p class="empty-state">Add family members and bills to see the annual summary.</p>';
        return;
    }

    let totalAnnual = 0;
    Object.values(summary).forEach(data => {
        totalAnnual += data.total;
    });

    let totalPayments = 0;

    // Only show parent members and independent members in main rows
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(m.id));

    // Build member data with computed fields for sorting/filtering
    const memberRows = mainMembers.map(member => {
        const data = summary[member.id];
        if (!data) return null;

        let combinedTotal = data.total;
        const linkedData = [];

        member.linkedMembers.forEach(linkedId => {
            const linkedSummary = summary[linkedId];
            if (linkedSummary) {
                combinedTotal += linkedSummary.total;
                linkedData.push(linkedSummary);
            }
        });

        const payment = getPaymentTotalForMember(member.id) +
            member.linkedMembers.reduce((sum, id) => sum + getPaymentTotalForMember(id), 0);

        const balance = combinedTotal - payment;
        totalPayments += payment;

        let status = 'outstanding';
        if (balance <= 0) status = 'settled';
        else if (payment > 0) status = 'partial';

        return { member, data, combinedTotal, linkedData, payment, balance, status };
    }).filter(Boolean);

    // Sort by urgency: outstanding > partial > settled
    const sortOrder = { outstanding: 0, partial: 1, settled: 2 };
    memberRows.sort((a, b) => sortOrder[a.status] - sortOrder[b.status]);

    const linkedGroupCount = memberRows.filter(r => r.member.linkedMembers.length > 0).length;
    const collectionRate = totalAnnual > 0 ? Math.min(100, Math.round((totalPayments / totalAnnual) * 100)) : 0;

    // Apply filter
    const filtered = _summaryFilter === 'all'
        ? memberRows
        : _summaryFilter === 'linked'
            ? memberRows.filter(r => r.member.linkedMembers.length > 0)
            : memberRows.filter(r => r.status === _summaryFilter);

    // Filter chip counts
    const counts = { all: memberRows.length, outstanding: 0, partial: 0, settled: 0, linked: linkedGroupCount };
    memberRows.forEach(r => counts[r.status]++);

    const filterChips = [
        { key: 'all', label: 'All' },
        { key: 'outstanding', label: 'Outstanding' },
        { key: 'partial', label: 'Partial' },
        { key: 'settled', label: 'Settled' },
        { key: 'linked', label: 'Linked Groups' }
    ].map(f =>
        '<button class="settlement-filter-chip' + (_summaryFilter === f.key ? ' active' : '') + '" onclick="setSummaryFilter(\'' + f.key + '\')">' + escapeHtml(f.label) + ' <span class="settlement-filter-count">' + counts[f.key] + '</span></button>'
    ).join('');

    // Build row-cards
    const cards = filtered.map(row => {
        const { member, data, combinedTotal, linkedData, payment, balance, status } = row;
        const statusBadge = getPaymentStatusBadge(combinedTotal, payment);
        const isExpanded = _expandedSettlementIds.has(member.id);
        const linkedMemberCount = member.linkedMembers.length;
        const hasLinkedMembers = linkedMemberCount > 0;
        const householdMeta = hasLinkedMembers
            ? 'Household includes ' + linkedMemberCount + ' linked member' + (linkedMemberCount === 1 ? '' : 's')
            : 'Standalone household';
        const showPaymentAction = !archived && balance > 0;

        // Build expanded detail section
        let detailHtml = '';
        if (isExpanded) {
            const breakdownHtml = getCalculationBreakdown(data);
            let linkedHtml = '';
            linkedData.forEach(ls => {
                const childPayment = getPaymentTotalForMember(ls.member.id);
                const childBalance = ls.total - childPayment;
                const childBadge = getPaymentStatusBadge(ls.total, childPayment);
                const childBreakdown = getCalculationBreakdown(ls);
                linkedHtml += '<div class="settlement-linked-row">'
                    + '<div class="settlement-linked-summary">'
                    + '<div class="settlement-linked-member">'
                    + '<span class="child-indicator">\u21B3</span>'
                    + generateAvatar(ls.member)
                    + '<div class="settlement-linked-copy">'
                    + '<strong>' + escapeHtml(ls.member.name) + '</strong>'
                    + '<span class="settlement-linked-meta">Linked member settlement</span>'
                    + '</div>'
                    + '</div>'
                    + '<div class="settlement-linked-amounts">'
                    + '<div class="settlement-linked-metric"><span class="settlement-linked-label">Annual</span><strong>$' + ls.total.toFixed(2) + '</strong></div>'
                    + '<div class="settlement-linked-metric"><span class="settlement-linked-label">Paid</span><strong>$' + childPayment.toFixed(2) + '</strong></div>'
                    + '<div class="settlement-linked-metric"><span class="settlement-linked-label">Balance</span><strong class="' + (childBalance > 0 ? 'balance-owed' : 'balance-paid') + '">$' + childBalance.toFixed(2) + '</strong></div>'
                    + '</div>'
                    + '<div class="settlement-linked-side">'
                    + '<div class="settlement-linked-status">' + childBadge + '</div>'
                    + '<button class="btn btn-tertiary btn-sm settlement-linked-history" onclick="showPaymentHistory(' + ls.member.id + ')">History</button>'
                    + '</div>'
                    + '</div>'
                    + (childBreakdown ? '<div class="settlement-breakdown settlement-linked-breakdown">' + childBreakdown + '</div>' : '')
                    + '</div>';
            });

            detailHtml = '<div class="settlement-row-detail">'
                + (breakdownHtml
                    ? '<div class="settlement-detail-panel">'
                        + '<div class="settlement-detail-heading">'
                        + '<div class="settlement-detail-title">Primary member calculation</div>'
                        + '<p class="settlement-detail-copy">Each bill shows the billing frequency and split formula for this household.</p>'
                        + '</div>'
                        + '<div class="settlement-breakdown settlement-breakdown-primary">' + breakdownHtml + '</div>'
                    + '</div>'
                    : '')
                + (linkedHtml
                    ? '<div class="settlement-detail-panel">'
                        + '<div class="settlement-detail-heading">'
                        + '<div class="settlement-detail-title">Linked members</div>'
                        + '<p class="settlement-detail-copy">Linked members keep their own totals and payment history inside the household view.</p>'
                        + '</div>'
                        + '<div class="settlement-linked-list">' + linkedHtml + '</div>'
                    + '</div>'
                    : '')
                + '<div class="settlement-detail-actions">'
                + '<button class="btn btn-tertiary btn-sm" onclick="showPaymentHistory(' + data.member.id + ')">Payment History</button>'
                + '<button class="btn btn-tertiary btn-sm" onclick="generateShareLink(' + data.member.id + ')">New Share Link</button>'
                + '<button class="btn btn-tertiary btn-sm" onclick="showShareLinks(' + data.member.id + ')">Manage Share Links</button>'
                + '</div>'
                + '</div>';
        }

        const overflowActions = [
            !showPaymentAction ? '' : '<button onclick="showPaymentHistory(' + data.member.id + ')">Payment History</button>',
            data.member.phone ? '<button onclick="showTextInvoiceDialog(' + data.member.id + ')">Text Invoice</button>' : '',
            '<button onclick="generateShareLink(' + data.member.id + ')">Generate Share Link</button>',
            '<button onclick="showShareLinks(' + data.member.id + ')">Manage Share Links</button>'
        ].filter(Boolean).join('');

        return '<div class="settlement-row-card settlement-' + status + (isExpanded ? ' settlement-row-card-expanded' : '') + '">'
            + '<div class="settlement-row-primary" onclick="toggleSettlementDetail(' + member.id + ')">'
            + '<div class="settlement-row-member">'
            + generateAvatar(data.member)
            + '<div class="settlement-row-identity">'
            + '<div class="settlement-row-name">'
            + '<strong>' + escapeHtml(data.member.name) + '</strong>'
            + (member.linkedMembers.length > 0 ? '<span class="member-count-badge">+' + member.linkedMembers.length + '</span>' : '')
            + '</div>'
            + '<div class="settlement-row-meta">' + householdMeta + '</div>'
            + '</div>'
            + '</div>'
            + '<div class="settlement-row-amounts">'
            + '<div class="settlement-amount-group"><span class="settlement-amount-label">Annual</span><span class="settlement-amount-value">$' + combinedTotal.toFixed(2) + '</span></div>'
            + '<div class="settlement-amount-group"><span class="settlement-amount-label">Paid</span><span class="settlement-amount-value">$' + payment.toFixed(2) + '</span></div>'
            + '<div class="settlement-amount-group"><span class="settlement-amount-label">Balance</span><span class="settlement-amount-value ' + (balance > 0 ? 'balance-owed' : 'balance-paid') + '">$' + balance.toFixed(2) + '</span></div>'
            + '</div>'
            + '<div class="settlement-row-side">'
            + '<div class="settlement-row-status">' + statusBadge + '</div>'
            + '<div class="settlement-row-actions" onclick="event.stopPropagation()">'
            + (showPaymentAction
                ? '<button class="btn btn-primary btn-sm" onclick="showAddPaymentDialog(' + data.member.id + ')">Record Payment</button>'
                : '<button class="btn btn-tertiary btn-sm settlement-history-action" onclick="showPaymentHistory(' + data.member.id + ')">Payment History</button>')
            + (balance <= 0 && status === 'settled'
                ? '<button class="btn btn-secondary btn-sm" disabled title="No balance due \u2014 nothing to invoice">Email Invoice</button>'
                : '<button class="btn btn-secondary btn-sm" onclick="showEmailInvoiceDialog(' + data.member.id + ')">Email Invoice</button>')
            + '<div class="actions-dropdown settlement-actions-dropdown">'
            + '<button class="settlement-more-btn" onclick="toggleActionMenu(event)" aria-label="More actions">\u22EF</button>'
            + '<div class="actions-dropdown-menu settlement-actions-menu">' + overflowActions + '</div>'
            + '</div>'
            + '</div>'
            + '<span class="settlement-expand-icon">' + (isExpanded ? 'Hide details \u25B2' : 'Details \u25BC') + '</span>'
            + '</div>'
            + '</div>'
            + detailHtml
            + '</div>';
    }).join('');

    const totalBalance = totalAnnual - totalPayments;

    const yearLabel = currentBillingYear ? (currentBillingYear.label || currentBillingYear.id) : '';
    const completionBanner = (totalBalance <= 0 && totalAnnual > 0 && mainMembers.length > 0)
        ? '<div class="settlement-complete-banner">Annual settlement complete. All shared bills for ' + escapeHtml(yearLabel) + ' have been resolved.</div>'
        : '';

    let payViaStrip = '';
    const enabledMethods = getEnabledPaymentMethods();
    if (enabledMethods.length > 0) {
        const icons = enabledMethods.map(m =>
            '<span class="payment-strip-icon" title="' + escapeHtml(m.label || getPaymentMethodLabel(m.type)) + '">' + getPaymentMethodStripIcon(m.type) + '</span>'
        ).join('');
        payViaStrip = '<div class="payment-methods-strip"><span class="payment-strip-label">Pay via</span><div class="payment-strip-icons">' + icons + '</div></div><p class="payment-strip-note">These enabled payment methods appear on annual invoices and shared billing summaries.</p>';
    } else {
        payViaStrip = '<div class="payment-methods-strip payment-methods-strip--empty"><span class="payment-strip-label">Pay via</span><span class="payment-strip-empty">No payment methods configured yet</span></div><p class="payment-strip-note">Add payment methods in the Invoicing tab to show them on invoices and share links.</p>';
    }

    const totalsFooter = '<div class="settlement-totals-grid">'
        + '<div class="settlement-total-card"><span class="settlement-total-label">Total Annual</span><strong class="settlement-total-value">$' + totalAnnual.toFixed(2) + '</strong></div>'
        + '<div class="settlement-total-card"><span class="settlement-total-label">Total Paid</span><strong class="settlement-total-value">$' + totalPayments.toFixed(2) + '</strong></div>'
        + '<div class="settlement-total-card"><span class="settlement-total-label">Remaining</span><strong class="settlement-total-value ' + (totalBalance > 0 ? 'balance-owed' : 'balance-paid') + '">$' + totalBalance.toFixed(2) + '</strong></div>'
        + '</div>';

    const boardHtml = filtered.length
        ? '<div class="settlement-board">' + cards + '</div>'
        : '<div class="settlement-board-empty"><strong>No households match this filter.</strong><span>Switch filters to review the rest of the settlement board.</span></div>';

    container.innerHTML = completionBanner
        + '<div class="settlement-summary-shell">'
        + '<div class="settlement-overview">'
        + '<div class="settlement-overview-main">' + payViaStrip + '</div>'
        + '<div class="settlement-overview-stats">'
        + '<div class="settlement-overview-card"><span class="settlement-overview-label">Households</span><strong class="settlement-overview-value">' + counts.all + '</strong></div>'
        + '<div class="settlement-overview-card"><span class="settlement-overview-label">Linked Groups</span><strong class="settlement-overview-value">' + linkedGroupCount + '</strong></div>'
        + '<div class="settlement-overview-card"><span class="settlement-overview-label">Collected</span><strong class="settlement-overview-value">' + collectionRate + '%</strong></div>'
        + '<div class="settlement-overview-card"><span class="settlement-overview-label">Remaining</span><strong class="settlement-overview-value ' + (totalBalance > 0 ? 'balance-owed' : 'balance-paid') + '">$' + totalBalance.toFixed(2) + '</strong></div>'
        + '</div>'
        + '</div>'
        + '<div class="settlement-filter-bar">' + filterChips + '</div>'
        + boardHtml
        + totalsFooter
        + '</div>';

    renderDashboardStatus();
}

function renderDashboardStatus() {
    const container = document.getElementById('dashboardStatus');
    if (!container) return;

    if (!currentBillingYear || familyMembers.length === 0) {
        container.innerHTML = '';
        return;
    }

    const metrics = calculateSettlementMetrics();
    const yearLabel = currentBillingYear.label || currentBillingYear.id;

    const currentStatus = currentBillingYear.status || 'open';
    const currentOrder = (BILLING_YEAR_STATUSES[currentStatus] || BILLING_YEAR_STATUSES.open).order;
    const remaining = metrics.totalMembers - metrics.paidCount;

    // When settling and all members are paid, show "Ready to Close" instead of "Settling"
    const isReadyToClose = currentStatus === 'settling' && remaining === 0 && metrics.totalMembers > 0;

    const lifecycleSteps = ['open', 'settling', 'closed', 'archived'].map(s => {
        const meta = BILLING_YEAR_STATUSES[s];
        const isActive = s === currentStatus && !isReadyToClose;
        const isComplete = meta.order < currentOrder || (isReadyToClose && s === 'settling');
        const isNext = isReadyToClose && s === 'closed';
        let cls = 'lifecycle-step';
        if (isActive) cls += ' lifecycle-active lifecycle-' + meta.color;
        else if (isComplete) cls += ' lifecycle-complete';
        if (isNext) cls += ' lifecycle-next';
        return '<span class="' + cls + '">' + meta.label + '</span>';
    }).join('<span class="lifecycle-arrow">\u2192</span>');

    let settlementMessage = '';
    if (currentStatus === 'archived') {
        settlementMessage = 'Archived year. Records are preserved for reference and cannot be modified.';
    } else if (currentStatus === 'closed') {
        settlementMessage = metrics.totalOutstanding > 0
            ? 'This billing year is closed and read-only with $' + metrics.totalOutstanding.toFixed(2) + ' still outstanding.'
            : 'All balances settled. ' + escapeHtml(yearLabel) + ' is complete and now read-only.';
    } else if (currentStatus === 'settling') {
        if (metrics.percentage === 0) {
            settlementMessage = 'Invoices are out. No payments have been recorded yet.';
        } else if (remaining > 0) {
            settlementMessage = metrics.paidCount + ' of ' + metrics.totalMembers + ' members are settled. ' + remaining + ' still need follow-up.';
        } else {
            settlementMessage = 'Everyone is settled for ' + escapeHtml(yearLabel) + '. Close the year when you are ready.';
        }
    } else if (metrics.totalAnnual > 0) {
        settlementMessage = 'Review totals, confirm assignments, and move this year into settling when you are ready to invoice.';
    } else {
        settlementMessage = 'Add members and bills to start building this billing year.';
    }

    let adminReminder = '';
    if (remaining > 0 && currentStatus === 'settling') {
        adminReminder = '<div class="settlement-admin-hint">' + remaining + ' member' + (remaining === 1 ? '' : 's') + ' still outstanding. Send reminders via share links.</div>';
    }

    const openReviews = _loadedDisputes.filter(d => d.status === 'open' || d.status === 'in_review').length;
    const statusLabel = isReadyToClose ? 'Ready to Close' : (BILLING_YEAR_STATUSES[currentStatus] || BILLING_YEAR_STATUSES.open).label;
    const statusClass = isReadyToClose
        ? 'dashboard-state-badge dashboard-state-badge--ready'
        : 'dashboard-state-badge dashboard-state-badge--' + currentStatus;
    const statusHeadline = isReadyToClose
        ? 'Settlement complete'
        : currentStatus === 'open'
            ? 'Planning in progress'
            : currentStatus === 'settling'
                ? 'Settlement in progress'
                : currentStatus === 'closed'
                    ? 'Year closed'
                    : 'Archive view';

    container.innerHTML = `
        <div class="dashboard-status-shell">
            <div class="dashboard-status-meta">
                <span class="dashboard-year-pill">Billing Year ${escapeHtml(yearLabel)}</span>
                <span class="${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="lifecycle-bar">${lifecycleSteps}</div>
            <div class="dashboard-kpi-grid">
                <div class="kpi-card">
                    <span class="kpi-card-label">Outstanding</span>
                    <span class="kpi-card-value ${metrics.totalOutstanding > 0 ? 'outstanding' : 'all-clear'}">$${metrics.totalOutstanding.toFixed(2)}</span>
                </div>
                <div class="kpi-card">
                    <span class="kpi-card-label">Settled</span>
                    <span class="kpi-card-value">${metrics.paidCount} / ${metrics.totalMembers}</span>
                </div>
                <div class="kpi-card${openReviews > 0 ? ' kpi-card--clickable' : ''}"${openReviews > 0 ? ' onclick="switchWorkspaceTab(\'reviews\'); setDisputeFilter(\'actionable\')"' : ''}>
                    <span class="kpi-card-label">Open Reviews</span>
                    <span class="kpi-card-value">${openReviews}</span>
                </div>
                <div class="kpi-card">
                    <span class="kpi-card-label">Status</span>
                    <span class="kpi-card-value">${escapeHtml(statusLabel)}</span>
                </div>
            </div>
            <div class="dashboard-progress-block">
                <div class="settlement-progress-header">
                    <span class="settlement-progress-title">${statusHeadline}</span>
                    <span class="settlement-progress-figure">${metrics.percentage}% settled</span>
                </div>
                <div class="settlement-progress">
                    <div class="settlement-progress-bar" style="width: ${metrics.percentage}%"></div>
                </div>
                ${settlementMessage ? '<p class="settlement-message">' + settlementMessage + '</p>' : ''}
            </div>
            ${adminReminder}
        </div>
    `;
    const contextBanner = document.getElementById('dashboardContextBanner');
    if (contextBanner) {
        contextBanner.textContent = '';
        contextBanner.style.display = 'none';
    }

    const headerLogo = document.getElementById('headerLogo');
    if (headerLogo) {
        headerLogo.className = 'header-logo';
        if (currentStatus === 'settling') headerLogo.classList.add('header-logo--settling');
        else if (currentStatus === 'closed') headerLogo.classList.add('header-logo--closed');
        else if (currentStatus === 'archived') headerLogo.classList.add('header-logo--archived');
    }
}

// Record a payment in the ledger for a member (or distributed across linked members)
function recordPayment(memberId, amount, method, note, distribute) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    const validAmount = Math.max(0, parseFloat(amount) || 0);
    if (validAmount <= 0) return;

    const now = new Date().toISOString();

    if (distribute && member.linkedMembers && member.linkedMembers.length > 0) {
        const summary = calculateAnnualSummary();
        let combinedTotal = summary[memberId] ? summary[memberId].total : 0;
        member.linkedMembers.forEach(id => {
            if (summary[id]) combinedTotal += summary[id].total;
        });

        const parentTotal = summary[memberId] ? summary[memberId].total : 0;
        const parentShare = combinedTotal > 0
            ? Math.round(validAmount * parentTotal / combinedTotal * 100) / 100
            : validAmount;

        var parentPaymentEntry = {
            id: generateUniquePaymentId(),
            memberId: memberId,
            amount: parentShare,
            receivedAt: now,
            note: note || 'Distributed payment',
            method: method || 'other'
        };
        payments.push(parentPaymentEntry);
        emitBillingEvent('PAYMENT_RECORDED', {
            paymentId: parentPaymentEntry.id, memberId: memberId,
            memberName: member.name, amount: parentShare,
            method: method || 'other', distributed: true
        });

        let distributed = parentShare;
        const linked = member.linkedMembers.slice();
        linked.forEach((linkedId, i) => {
            const linkedTotal = summary[linkedId] ? summary[linkedId].total : 0;
            let childShare;
            if (i === linked.length - 1) {
                childShare = Math.round((validAmount - distributed) * 100) / 100;
            } else {
                childShare = combinedTotal > 0
                    ? Math.round(validAmount * linkedTotal / combinedTotal * 100) / 100
                    : 0;
                distributed += childShare;
            }
            if (childShare > 0) {
                var childMember = familyMembers.find(m => m.id === linkedId);
                var childPaymentEntry = {
                    id: generateUniquePaymentId(),
                    memberId: linkedId,
                    amount: childShare,
                    receivedAt: now,
                    note: note || 'Distributed from ' + member.name,
                    method: method || 'other'
                };
                payments.push(childPaymentEntry);
                emitBillingEvent('PAYMENT_RECORDED', {
                    paymentId: childPaymentEntry.id, memberId: linkedId,
                    memberName: childMember ? childMember.name : '', amount: childShare,
                    method: method || 'other', distributed: true,
                    distributedFrom: memberId
                });
            }
        });
    } else {
        var paymentEntry = {
            id: generateUniquePaymentId(),
            memberId: memberId,
            amount: validAmount,
            receivedAt: now,
            note: note || '',
            method: method || 'other'
        };
        payments.push(paymentEntry);
        emitBillingEvent('PAYMENT_RECORDED', {
            paymentId: paymentEntry.id, memberId: memberId,
            memberName: member.name, amount: validAmount,
            method: method || 'other', distributed: false
        });
    }

    saveData();
    updateSummary();
}

// Render email settings
const EMAIL_TEMPLATE_FIELDS = [
    { token: '%billing_year%', label: 'Billing Year' },
    { token: '%annual_total%', label: 'Household Total' },
    { token: '%payment_methods%', label: 'Payment Methods' }
];

const EMAIL_TEMPLATE_TOKEN_LABELS = {
    '%billing_year%': 'Billing Year',
    '%annual_total%': 'Household Total',
    '%total%': 'Household Total',
    '%payment_methods%': 'Payment Methods'
};

const EMAIL_TEMPLATE_TOKEN_PATTERN = /(%billing_year%|%annual_total%|%total%|%payment_methods%)/g;

// Detect when a template contains both the %payment_methods% token AND hardcoded
// payment provider text, which would cause payment info to render twice.
const PAYMENT_PROVIDER_PATTERN = /\b(venmo|zelle|paypal|cash\s*app|apple\s*cash|bank\s*transfer)\b/i;

function detectDuplicatePaymentText(template) {
    if (!template) return false;
    const hasToken = template.indexOf('%payment_methods%') !== -1;
    if (!hasToken) return false;
    // Strip the token itself so we only check the surrounding literal text
    const withoutToken = template.replace(/%payment_methods%/g, '');
    return PAYMENT_PROVIDER_PATTERN.test(withoutToken);
}

function createEmailTemplateTokenNode(token) {
    const chip = document.createElement('span');
    chip.className = 'template-editor-token';
    chip.contentEditable = 'false';
    chip.dataset.token = token;
    chip.textContent = EMAIL_TEMPLATE_TOKEN_LABELS[token] || token;
    return chip;
}

function renderEmailTemplateInlineHTML(text) {
    return String(text || '').split(EMAIL_TEMPLATE_TOKEN_PATTERN).map(segment => {
        if (EMAIL_TEMPLATE_TOKEN_LABELS[segment]) {
            return '<span class="template-editor-token" contenteditable="false" data-token="' + segment + '">'
                + escapeHtml(EMAIL_TEMPLATE_TOKEN_LABELS[segment])
                + '</span>';
        }
        return escapeHtml(segment);
    }).join('');
}

function buildEmailTemplateEditorHTML(template) {
    const lines = String(template || '').split('\n');
    return lines.map(line => '<div class="template-editor-line">' + (renderEmailTemplateInlineHTML(line) || '<br>') + '</div>').join('');
}

function getEmailTemplateValue() {
    const editor = document.getElementById('emailMessageEditor');
    if (editor && typeof editor.cloneNode === 'function') {
        const clone = editor.cloneNode(true);
        clone.querySelectorAll('.template-editor-token').forEach(function(tokenEl) {
            tokenEl.replaceWith(document.createTextNode(tokenEl.dataset.token || ''));
        });

        const html = clone.innerHTML
            .replace(/<(div|p|li|blockquote|h[1-6])\b[^>]*>/gi, '\n')
            .replace(/<\/(div|p|li|blockquote|h[1-6])>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/&nbsp;/gi, ' ');

        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        return (tmp.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\n+|\n+$/g, '');
    }

    const input = document.getElementById('emailMessageInput');
    return input ? input.value : (settings.emailMessage || '');
}

function getInvoiceTemplatePreviewContext() {
    const billingYearLabel = currentBillingYear ? (currentBillingYear.label || currentBillingYear.id) : String(new Date().getFullYear());
    const sampleMember = familyMembers.find(m => !isLinkedToAnyone(m.id)) || familyMembers[0] || null;
    const sampleHousehold = sampleMember ? getInvoiceSummaryContext(sampleMember.id) : null;
    if (sampleHousehold) {
        return Object.assign({}, sampleHousehold, {
            currentYear: billingYearLabel,
            previewRecipient: sampleMember.email || sampleMember.name
        });
    }

    return {
        member: { name: 'Example household' },
        firstName: 'Friend',
        combinedTotal: 0,
        payment: 0,
        balance: 0,
        amountStr: '$0.00',
        amountLabel: 'total',
        currentYear: billingYearLabel,
        linkedMembersData: [],
        memberData: null,
        numMembers: 1,
        previewRecipient: 'Example household'
    };
}

function buildInvoiceTemplatePreviewText(template, ctx) {
    return String(template || '')
        .replace(/%billing_year%/g, ctx.billingYear)
        .replace(/%annual_total%/g, ctx.annualTotal)
        .replace(/%total%/g, ctx.annualTotal)
        .replace(/%total\b/g, ctx.annualTotal);
}

function buildConfiguredInvoiceMessage(ctx, templateOverride) {
    const template = templateOverride !== undefined ? templateOverride : (settings.emailMessage || '');
    return buildInvoiceTemplatePreviewText(template, {
        billingYear: ctx.currentYear,
        annualTotal: '$' + ctx.combinedTotal.toFixed(2)
    }).replace(/%payment_methods%/g, formatPaymentOptionsText()).trim();
}

function renderInvoicePreviewTextBlocks(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    return trimmed.split(/\n{2,}/).map(block =>
        '<p class="invoice-preview-paragraph">' + escapeHtml(block).replace(/\n/g, '<br>') + '</p>'
    ).join('');
}

function buildInvoiceTemplatePreviewHTML(template, ctx) {
    const previewBody = buildInvoiceBody(ctx, 'text-only', '', 'email', template);
    const bodyHtml = renderInvoicePreviewTextBlocks(previewBody) || '<p class="placeholder-text">Your invoice preview will appear here.</p>';
    const subject = buildInvoiceSubject(ctx.currentYear, ctx.member);
    return '<div class="invoice-preview-shell">'
        + '<div class="invoice-preview-meta"><span class="invoice-preview-meta-label">To</span><span>' + escapeHtml(ctx.previewRecipient) + '</span></div>'
        + '<div class="invoice-preview-meta"><span class="invoice-preview-meta-label">Subject</span><span>' + escapeHtml(subject) + '</span></div>'
        + '<div class="invoice-preview-message">' + bodyHtml + '</div>'
        + '</div>';
}

function renderEmailTemplatePreview() {
    const preview = document.getElementById('emailTemplatePreview');
    if (!preview) return;

    const ctx = getInvoiceTemplatePreviewContext();
    const templateValue = getEmailTemplateValue();
    preview.innerHTML = buildInvoiceTemplatePreviewHTML(templateValue, ctx);

    const sample = document.getElementById('emailTemplatePreviewSample');
    if (sample) {
        sample.textContent = 'Previewing the default email invoice for ' + ctx.member.name + ' in ' + ctx.currentYear;
    }
}

function emailTemplateEditorShowsRawTokens(editor) {
    if (!editor) return false;
    const visibleText = editor.textContent || '';
    return Object.keys(EMAIL_TEMPLATE_TOKEN_LABELS).some(function(token) {
        return visibleText.indexOf(token) !== -1;
    });
}

function placeCaretAtEnd(element) {
    if (!element || !window.getSelection || !document.createRange) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

function normalizeEmailTemplateEditor(moveCaretToEnd) {
    const editor = document.getElementById('emailMessageEditor');
    if (!editor) return;
    editor.innerHTML = buildEmailTemplateEditorHTML(getEmailTemplateValue());
    if (moveCaretToEnd && editor.getAttribute('contenteditable') !== 'false') {
        editor.focus();
        placeCaretAtEnd(editor);
    }
}

function handleEmailTemplateEditorInput() {
    const editor = document.getElementById('emailMessageEditor');
    if (emailTemplateEditorShowsRawTokens(editor)) {
        normalizeEmailTemplateEditor(true);
    }
    renderEmailTemplatePreview();
}

function handleEmailTemplateEditorPaste(event) {
    if (!event) return;
    event.preventDefault();
    const clipboard = event.clipboardData || window.clipboardData;
    const text = clipboard ? clipboard.getData('text/plain') : '';
    if (document.execCommand) {
        document.execCommand('insertHTML', false, escapeHtml(text).replace(/\n/g, '<br>'));
    }
    normalizeEmailTemplateEditor(true);
    renderEmailTemplatePreview();
}

function insertEmailTemplateToken(token) {
    const editor = document.getElementById('emailMessageEditor');
    if (!editor || editor.getAttribute('contenteditable') === 'false') return;

    const tokenNode = createEmailTemplateTokenNode(token);
    const spacer = document.createTextNode(' ');
    editor.focus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        let targetLine = editor.lastElementChild;
        if (!targetLine || !targetLine.classList || !targetLine.classList.contains('template-editor-line')) {
            targetLine = document.createElement('div');
            targetLine.className = 'template-editor-line';
            editor.appendChild(targetLine);
        }
        if (targetLine.innerHTML === '<br>') {
            targetLine.innerHTML = '';
        }
        targetLine.appendChild(tokenNode);
        targetLine.appendChild(spacer);
    } else {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(spacer);
        range.insertNode(tokenNode);
        range.setStartAfter(spacer);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    renderEmailTemplatePreview();
}

function renderEmailSettings() {
    const container = document.getElementById('emailSettings');
    const archived = isYearReadOnly();
    const tokenButtons = EMAIL_TEMPLATE_FIELDS.map(field =>
        '<button type="button" class="template-token-chip" onclick="insertEmailTemplateToken(\'' + field.token + '\')">' + escapeHtml(field.label) + '</button>'
    ).join('');

    const hasDuplicate = detectDuplicatePaymentText(settings.emailMessage);
    const duplicationWarning = hasDuplicate
        ? '<div class="template-duplication-warning">'
            + '<strong>Duplicate payment info detected.</strong> '
            + 'Your template contains the Payment Methods field <em>and</em> hardcoded payment text. '
            + 'This will show payment methods twice in sent invoices. '
            + 'Remove the hardcoded text and rely on the Payment Methods field alone.'
            + '</div>'
        : '';

    container.innerHTML = `
        <div class="form-group">
            <label id="emailTemplateEditorLabel">Email Message (sent with annual invoices)</label>
            <p class="section-desc">
                Build one message for the full billing year. Use the field chips to insert live billing data into the message without typing placeholders by hand.
            </p>
            ${duplicationWarning}
            <div class="template-token-bar">
                <span class="template-token-label">Insert fields</span>
                <div class="template-token-list">${tokenButtons}</div>
            </div>
            <div id="emailMessageEditor" class="template-editor" contenteditable="${archived ? 'false' : 'true'}" role="textbox" tabindex="0" aria-labelledby="emailTemplateEditorLabel" aria-multiline="true" oninput="handleEmailTemplateEditorInput()" onpaste="handleEmailTemplateEditorPaste(event)">${buildEmailTemplateEditorHTML(settings.emailMessage)}</div>
            <div class="invoice-template-preview">
                <div class="invoice-template-preview-head">
                    <span class="invoice-template-preview-label">Live Preview</span>
                    <span id="emailTemplatePreviewSample" class="invoice-template-preview-sample"></span>
                </div>
                <div id="emailTemplatePreview" class="invoice-template-preview-body"></div>
            </div>
            ${archived ? '' : '<button class="btn btn-primary mt-2" onclick="saveEmailMessage()">Save Template</button>'}
        </div>
    `;
    renderEmailTemplatePreview();
}

// Save email message
function saveEmailMessage() {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const templateValue = getEmailTemplateValue();
    if (detectDuplicatePaymentText(templateValue)) {
        if (!confirm('Your template contains both the Payment Methods field and hardcoded payment text. This will show payment methods twice in sent invoices. Save anyway?')) {
            return;
        }
    }
    settings.emailMessage = templateValue;
    saveData();
    normalizeEmailTemplateEditor(false);
    renderEmailTemplatePreview();
    renderEmailSettings();
    showChangeToast('Invoice template saved.');
}

// ──────────────── Payment Methods Migration ────────────────

function migratePaymentLinksToMethods(paymentLinks) {
    if (!paymentLinks || paymentLinks.length === 0) return [];
    return paymentLinks.map(link => {
        const lower = (link.name || '').toLowerCase();
        let type = 'other';
        if (lower.includes('venmo')) type = 'venmo';
        else if (lower.includes('zelle')) type = 'zelle';
        else if (lower.includes('paypal')) type = 'paypal';
        else if (lower.includes('cash app') || lower.includes('cashapp')) type = 'cashapp';
        else if (lower.includes('apple')) type = 'apple_cash';

        return {
            id: link.id || ('pm_' + Date.now() + '_' + Math.floor(Math.random() * 10000)),
            type: type,
            label: link.name,
            enabled: true,
            url: link.url || '',
            email: '',
            phone: '',
            handle: '',
            instructions: ''
        };
    });
}

// ──────────────── Payment Method Icons ────────────────────

const PAYMENT_METHOD_ICONS = {
    zelle: '<svg viewBox="18 15 70 70" fill="currentColor" fill-rule="evenodd"><path d="M30.78 84.24C28.57 83.69 27.19 83.08 25.4 81.84C23.27 80.36 22.68 79.79 21.45 77.94C18.36 73.31 18.45 74.14 18.46 50.31C18.46 33.51 18.54 29.64 18.89 28.14C19.96 23.6 23.23 19.63 27.7 17.45L30.34 16.16L51.76 16.07C67.28 16 73.63 16.07 74.8 16.32C79.97 17.41 84.78 21.79 86.47 26.95C87.12 28.93 87.12 29.02 87.12 50.43C87.12 71.32 87.1 71.96 86.52 73.49C85.41 76.43 84.52 77.83 82.5 79.87C80.18 82.21 77.21 83.86 74.37 84.37C71.62 84.86 32.86 84.75 30.78 84.24ZM57.03 76.11C57.37 75.62 57.48 74.69 57.48 72.44V69.42H62.61C67.37 69.42 67.75 69.38 68.04 68.85C68.2 68.54 68.34 66.95 68.34 65.31C68.34 63.68 68.2 62.08 68.04 61.77C67.75 61.23 67.33 61.21 59.09 61.21C53.5 61.21 50.44 61.1 50.44 60.91C50.44 60.75 53.77 56.36 57.83 51.15C61.9 45.95 65.93 40.79 66.78 39.68L68.34 37.67V34.78C68.34 30.89 68.49 30.98 62.26 30.98H57.48V28.03C57.48 23.82 57.6 23.94 53.39 23.94C51.47 23.94 49.69 24.02 49.44 24.12C49.05 24.26 48.97 24.86 48.97 27.64V30.98H44.08C37.84 30.98 38.11 30.78 38.11 35.26C38.11 37.88 38.21 38.66 38.58 39.03C38.97 39.43 40.16 39.49 47.09 39.49C51.51 39.49 55.13 39.59 55.13 39.71C55.13 39.83 54.29 40.99 53.27 42.28C52.25 43.57 48.21 48.71 44.3 53.7L37.18 62.78L37.28 65.78C37.34 67.44 37.49 68.9 37.62 69.03C37.76 69.17 40.33 69.34 43.35 69.42L48.83 69.57L48.91 72.78C48.96 74.54 49.14 76.16 49.31 76.37C49.54 76.65 50.6 76.76 53.1 76.76C56.35 76.76 56.6 76.72 57.03 76.11Z"/></svg>',
    cashapp: '<svg viewBox="100 15 70 70" fill="currentColor" fill-rule="evenodd"><path d="M145.69 16.24C152.59 16.24 156.04 16.24 159.81 17.43C163.86 18.91 167.06 22.1 168.54 26.15C169.73 29.93 169.73 33.37 169.73 40.28V61.15C169.73 68.07 169.73 71.54 168.54 75.27C167.06 79.32 163.86 82.52 159.81 84C156.04 85.21 152.59 85.21 145.69 85.21H124.79C117.87 85.21 114.4 85.21 110.67 84.02C106.62 82.54 103.43 79.35 101.94 75.29C100.76 71.52 100.76 68.07 100.76 61.17V40.27C100.76 33.35 100.76 29.88 101.94 26.15C103.43 22.1 106.62 18.91 110.67 17.43C114.44 16.24 117.89 16.24 124.79 16.24H145.69Z"/><path d="M146.52 41.89C147.06 42.43 147.96 42.43 148.46 41.89L151.16 39.09C151.73 38.55 151.7 37.58 151.09 37C148.98 35.15 146.52 33.74 143.85 32.86L144.7 28.76C144.89 27.87 144.22 27.03 143.32 27.03H138.11C137.78 27.03 137.47 27.15 137.22 27.35C136.97 27.56 136.79 27.85 136.73 28.17L135.97 31.81C129.03 32.17 123.15 35.69 123.15 42.91C123.15 49.16 128.01 51.84 133.15 53.69C138.01 55.54 140.59 56.23 140.59 58.84C140.59 61.52 138.02 63.09 134.23 63.09C130.78 63.09 127.16 61.94 124.36 59.13C124.1 58.87 123.74 58.72 123.37 58.72C122.99 58.72 122.64 58.87 122.38 59.13L119.47 62.04C119.19 62.31 119.04 62.69 119.04 63.07C119.04 63.46 119.19 63.83 119.47 64.11C121.73 66.34 124.6 67.95 127.86 68.85L127.06 72.7C126.88 73.59 127.54 74.42 128.43 74.43L133.66 74.47C133.99 74.48 134.31 74.36 134.57 74.15C134.82 73.95 134.99 73.66 135.06 73.33L135.82 69.68C144.16 69.12 149.25 64.52 149.25 57.8C149.25 51.62 144.19 49.01 138.04 46.89C134.53 45.58 131.49 44.69 131.49 42.01C131.49 39.4 134.33 38.36 137.17 38.36C140.79 38.36 144.27 39.86 146.55 41.91L146.52 41.89Z" fill="var(--color-surface)"/></svg>',
    venmo: '<svg viewBox="20 96 71 71" fill="currentColor" fill-rule="evenodd"><path d="M26.59 166.38C23.66 165.66 21.52 163.45 20.85 160.45C20.7 159.81 20.69 157.03 20.69 131.76C20.69 106.49 20.7 103.71 20.85 103.07C21.27 101.16 22.28 99.58 23.8 98.45C24.74 97.75 25.34 97.48 26.64 97.15C27.36 96.97 28.22 96.96 55.47 96.96C80.55 96.96 83.64 96.97 84.28 97.11C84.67 97.2 85.08 97.31 85.19 97.36C85.3 97.4 85.61 97.54 85.88 97.66C86.49 97.92 87.75 98.8 88.18 99.25C88.35 99.44 88.69 99.89 88.95 100.26C89.35 100.86 89.5 101.14 89.9 102.06C89.94 102.17 90.05 102.56 90.14 102.93C90.28 103.53 90.3 106.4 90.3 131.76C90.3 157.13 90.28 160 90.14 160.6C90.05 160.96 89.94 161.35 89.9 161.46C89.5 162.38 89.35 162.67 88.95 163.26C88.03 164.61 86.99 165.43 85.29 166.12C84.3 166.52 85.74 166.51 55.74 166.53C29.15 166.55 27.24 166.54 26.59 166.38Z"/><path d="M59.59 151.17C61.13 149.19 63.84 145.32 65.57 142.62C66.53 141.12 66.96 140.44 67.03 140.29C67.07 140.21 67.15 140.05 67.22 139.94C68.37 138.05 68.7 137.46 69.6 135.73C69.87 135.21 70.15 134.67 70.22 134.54C70.49 134.05 71.85 131.09 71.85 131.01C71.85 130.97 71.92 130.81 71.99 130.64C72.26 130.04 72.9 128.34 73.09 127.75C73.19 127.42 73.3 127.06 73.34 126.95C73.61 126.21 74.06 124.33 74.33 122.84C74.75 120.54 74.65 117.14 74.12 115.15C73.74 113.76 72.78 111.58 72.49 111.47C72.41 111.44 72.02 111.48 71.63 111.57C70.96 111.72 69.15 112.09 68.58 112.19C68.44 112.22 68.04 112.3 67.69 112.37C67.33 112.45 66.78 112.56 66.45 112.62C66.12 112.69 65.56 112.8 65.21 112.88C64.85 112.95 64.3 113.06 63.97 113.13C63.64 113.19 63.11 113.3 62.78 113.37C62.06 113.53 60.09 113.91 60 113.91C59.9 113.91 59.98 114.23 60.32 115.2C61.24 117.83 61.41 121.03 60.78 124.03C60.6 124.9 60.4 125.71 60.26 126.14C59.87 127.36 59.33 128.97 59.26 129.13C59.22 129.24 58.97 129.83 58.72 130.45C57.99 132.24 56.69 134.97 55.87 136.42C55.71 136.72 55.43 137.21 55.27 137.51C55.1 137.81 54.87 138.21 54.75 138.4C54.64 138.6 54.46 138.92 54.35 139.12C54.13 139.54 53.93 139.6 53.86 139.27C53.8 139.04 53.57 137.13 53.4 135.63C53.35 135.17 53.29 134.68 53.26 134.56C53.23 134.43 53.16 133.92 53.11 133.42C53.06 132.92 52.95 131.97 52.86 131.32C52.77 130.66 52.66 129.79 52.62 129.38C52.4 127.52 52.32 126.8 52.23 126.16C52.17 125.78 52.06 124.86 51.97 124.13C51.88 123.39 51.77 122.5 51.72 122.14C51.61 121.38 51.44 120 51.33 118.97C51.28 118.56 51.17 117.67 51.08 116.99C50.99 116.31 50.88 115.41 50.84 115C50.74 114.08 50.52 112.52 50.47 112.34C50.45 112.27 50.37 112.23 50.3 112.26C50.23 112.29 49.64 112.36 48.99 112.42C48.34 112.48 47.38 112.57 46.87 112.63C44.88 112.83 43.71 112.94 42.7 113.02C42.13 113.07 40.95 113.19 40.07 113.27C39.2 113.36 38.1 113.47 37.63 113.5C37.15 113.54 36.74 113.6 36.7 113.63C36.64 113.7 36.72 114.33 37 116C37.09 116.51 37.2 117.18 37.25 117.48C37.29 117.78 37.47 118.83 37.64 119.81C37.81 120.79 37.99 121.87 38.04 122.19C38.09 122.52 38.2 123.19 38.29 123.68C38.37 124.17 38.48 124.84 38.53 125.17C38.58 125.49 38.66 125.99 38.72 126.26C38.77 126.53 38.86 127.04 38.92 127.4C39.22 129.31 39.35 130.07 39.43 130.52C39.48 130.79 39.59 131.46 39.68 132.01C39.77 132.55 39.9 133.34 39.97 133.74C40.04 134.15 40.15 134.8 40.21 135.18C40.27 135.56 40.37 136.14 40.43 136.47C40.49 136.8 40.58 137.31 40.62 137.61C40.74 138.44 40.91 139.49 41.01 140.04C41.11 140.55 41.34 141.9 41.53 143.07C41.58 143.42 41.67 143.93 41.73 144.21C41.78 144.48 41.86 144.97 41.91 145.3C41.96 145.62 42.07 146.32 42.16 146.83C42.25 147.35 42.34 147.91 42.37 148.07C42.39 148.24 42.48 148.77 42.56 149.26C42.84 150.92 42.89 151.24 42.95 151.62L43.01 151.99H50.98H58.95L59.59 151.17Z" fill="var(--color-surface)"/></svg>',
    paypal: '<svg viewBox="102 97 70 70" fill="currentColor" fill-rule="evenodd"><path d="M107.86 166.42C105.37 165.89 103.19 163.8 102.52 161.3L102.36 160.7V132.22V103.74L102.52 103.14C103.19 100.61 105.38 98.53 107.91 98.02C108.53 97.89 109.4 97.88 136.88 97.9L165.21 97.92L165.77 98.08C168.29 98.78 170.35 100.96 170.86 103.47C170.99 104.09 171 104.96 170.98 132.44L170.96 160.77L170.8 161.33C170.08 163.86 167.93 165.9 165.43 166.42C164.82 166.55 163.83 166.55 136.63 166.55C109.8 166.54 108.43 166.54 107.86 166.42ZM134.15 157.86C134.29 157.82 134.56 157.69 134.74 157.57C135.38 157.14 135.39 157.12 136.46 152.49C136.99 150.18 137.47 148.14 137.53 147.95C137.67 147.49 137.99 147.11 138.44 146.89C138.77 146.72 138.91 146.7 140.37 146.61C143.31 146.43 145.46 145.97 147.84 145.03C152.74 143.08 156.67 139.29 158.55 134.71C159.74 131.77 160.1 128.36 159.5 125.51C159.2 124.06 158.53 122.49 157.78 121.46L157.44 121L157.39 122.67C157.34 124.75 157.1 126.38 156.55 128.42C155.15 133.68 152.35 137.5 148.17 139.85C146.53 140.78 144.48 141.5 142.3 141.92C140.63 142.24 139.58 142.33 136.87 142.37C134.69 142.41 134.28 142.43 134.1 142.53C133.81 142.69 133.67 142.86 133.54 143.22C133.48 143.4 133.13 145.41 132.77 147.7C132.4 150 132.04 152.09 131.96 152.36C131.61 153.56 131.01 154.41 130.26 154.78C129.35 155.23 128.86 155.29 125.96 155.32L123.36 155.35L123.31 156.19C123.26 157.01 123.26 157.03 123.45 157.34C123.81 157.96 123.53 157.93 129.06 157.93C132.14 157.93 133.99 157.91 134.15 157.86ZM127.6 152.28C128.02 152.05 128.44 151.59 128.59 151.18C128.67 150.98 129.09 148.48 129.55 145.6C130.1 142.09 130.41 140.28 130.5 140.07C130.68 139.66 131 139.33 131.44 139.1L131.79 138.91L135.47 138.87C139.3 138.82 139.98 138.78 141.64 138.46C147.94 137.24 151.87 133.26 153.4 126.54C153.8 124.78 153.92 123.72 153.93 122.06C153.93 120.36 153.84 119.65 153.44 118.44C152.29 114.91 149.24 112.68 144.65 112.01C143.15 111.79 141.89 111.76 134.1 111.76C125.09 111.76 125.77 111.71 125.1 112.38C124.88 112.6 124.66 112.89 124.62 113.03C124.57 113.18 123.18 121.85 121.53 132.32C119.1 147.71 118.53 151.39 118.59 151.58C118.68 151.92 118.91 152.19 119.24 152.34C119.51 152.46 119.75 152.47 123.42 152.45C127.3 152.43 127.31 152.43 127.6 152.28ZM131.9 129.05C131.9 129.01 132.23 127.27 132.64 125.18C133.14 122.63 133.42 121.34 133.5 121.22C133.57 121.12 133.73 120.98 133.87 120.9C134.08 120.78 134.25 120.76 135.53 120.74C138.13 120.7 140 120.93 141.03 121.42C141.54 121.67 142.07 122.19 142.27 122.64C142.86 123.99 142.35 126.37 141.23 127.5C140.87 127.86 139.93 128.43 139.43 128.6C138.86 128.79 137.67 128.99 136.7 129.07C135.36 129.17 131.9 129.16 131.9 129.05Z"/></svg>',
    apple_cash: '<svg viewBox="0 0 100 100" fill="currentColor"><rect width="100" height="100" rx="18"/><path transform="translate(23,19) scale(0.068)" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" fill="var(--color-surface, #fff)"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 7H3C1.9 7 1 7.9 1 9V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V9C23 7.9 22.1 7 21 7ZM21 19H3V13H21V19ZM21 11H3V9H21V11ZM1 5H23V3H1V5Z"/></svg>'
};

const PAYMENT_METHOD_STRIP_ICONS = {
    apple_cash: '<svg viewBox="0 0 100 100" fill="currentColor"><rect width="100" height="100" rx="18"/><path transform="translate(22.32,16) scale(0.068)" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" fill="var(--color-surface, #fff)"/></svg>'
};

function getPaymentMethodIcon(type) {
    return PAYMENT_METHOD_ICONS[type] || PAYMENT_METHOD_ICONS.other;
}

function getPaymentMethodStripIcon(type) {
    return PAYMENT_METHOD_STRIP_ICONS[type] || getPaymentMethodIcon(type);
}

// ──────────────── Payment Methods Settings ────────────────

const PAYMENT_METHOD_TYPES = {
    venmo: { label: 'Venmo', fields: ['handle', 'url', 'instructions'] },
    zelle: { label: 'Zelle', fields: ['email', 'phone', 'instructions'] },
    cashapp: { label: 'Cash App', fields: ['handle', 'url', 'instructions'] },
    paypal: { label: 'PayPal', fields: ['handle', 'url', 'instructions'] },
    apple_cash: { label: 'Apple Cash', fields: ['email', 'phone', 'instructions'] },
    other: { label: 'Other', fields: ['url', 'instructions'] }
};

function renderPaymentMethodsSettings() {
    const container = document.getElementById('paymentLinksSettings');
    if (!container) return;
    const archived = isYearReadOnly();
    const methods = settings.paymentMethods || [];

    let html = '';

    if (methods.length > 0) {
        html += '<div class="payment-methods-list">';
        methods.forEach(method => {
            const typeInfo = PAYMENT_METHOD_TYPES[method.type] || PAYMENT_METHOD_TYPES.other;
            const detail = getPaymentMethodDetail(method);
            const safeId = escapeHtml(method.id);
            html += `<div class="payment-method-item${method.enabled ? '' : ' disabled'}">
                <div class="payment-method-header">
                    <span class="payment-method-icon">${getPaymentMethodIcon(method.type)}</span>
                    <div class="payment-method-info">
                        <strong>${escapeHtml(method.label || typeInfo.label)}</strong>${method.qrCode ? '<span class="pm-qr-badge" title="QR code uploaded"><img src="qr-code.svg" alt="QR" class="pm-qr-icon" /></span>' : ''}
                        ${detail ? `<span class="payment-method-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>` : ''}
                    </div>
                    <div class="payment-method-actions">
                        ${archived ? '' : `<label class="toggle-label" title="${method.enabled ? 'Disable' : 'Enable'}">
                            <input type="checkbox" ${method.enabled ? 'checked' : ''} onchange="togglePaymentMethodEnabled('${safeId}')" />
                            <span class="toggle-slider"></span>
                        </label>
                        <span class="pm-actions-divider"></span>
                        <button class="btn btn-secondary btn-sm btn-pm-edit" onclick="editPaymentMethod('${safeId}')" title="Edit">Edit</button>
                        <button class="btn btn-sm btn-pm-remove" onclick="removePaymentMethod('${safeId}')" title="Remove">Remove</button>`}
                    </div>
                </div>
            </div>`;
        });
        html += '</div>';
    } else {
        html += '<p class="empty-state-compact">No payment methods configured yet</p>';
    }

    if (!archived) {
        let typeOptions = Object.entries(PAYMENT_METHOD_TYPES)
            .map(([value, info]) => `<option value="${value}">${escapeHtml(info.label)}</option>`)
            .join('');

        html += `<div class="payment-method-add mt-3">
            <div class="form-inline">
                <div class="form-group mb-0">
                    <label for="newPaymentMethodType">Add Payment Method</label>
                    <select id="newPaymentMethodType">
                        ${typeOptions}
                    </select>
                </div>
                <button class="btn btn-primary" onclick="addPaymentMethod()">Add</button>
            </div>
        </div>`;
    }

    container.innerHTML = html;
    renderEmailTemplatePreview();
}

function getPaymentMethodDetail(method) {
    const parts = [];
    if (method.email) parts.push(method.email);
    if (method.phone) parts.push(method.phone);
    if (method.handle) parts.push(method.handle);
    if (method.url) parts.push(method.url);
    return parts.join(' · ');
}

function addPaymentMethod() {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const typeSelect = document.getElementById('newPaymentMethodType');
    const type = typeSelect ? typeSelect.value : 'other';
    const typeInfo = PAYMENT_METHOD_TYPES[type] || PAYMENT_METHOD_TYPES.other;

    if (!settings.paymentMethods) settings.paymentMethods = [];

    const newMethod = {
        id: 'pm_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        type: type,
        label: typeInfo.label,
        enabled: true,
        email: '',
        phone: '',
        handle: '',
        url: '',
        instructions: '',
        qrCode: ''
    };

    settings.paymentMethods.push(newMethod);
    saveData();
    renderPaymentMethodsSettings();

    setTimeout(() => editPaymentMethod(newMethod.id), 100);
}

function editPaymentMethod(methodId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const method = (settings.paymentMethods || []).find(m => m.id === methodId);
    if (!method) return;
    const typeInfo = PAYMENT_METHOD_TYPES[method.type] || PAYMENT_METHOD_TYPES.other;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    let fieldsHTML = '';
    if (typeInfo.fields.includes('email')) {
        fieldsHTML += `<div class="form-group">
            <label for="pmEditEmail">Email</label>
            <input type="email" id="pmEditEmail" value="${escapeHtml(method.email || '')}" placeholder="e.g., name@email.com" />
        </div>`;
    }
    if (typeInfo.fields.includes('phone')) {
        fieldsHTML += `<div class="form-group">
            <label for="pmEditPhone">Phone</label>
            <input type="tel" id="pmEditPhone" value="${escapeHtml(method.phone || '')}" placeholder="e.g., +14155551212" />
        </div>`;
    }
    if (typeInfo.fields.includes('handle')) {
        fieldsHTML += `<div class="form-group">
            <label for="pmEditHandle">Handle / Username</label>
            <input type="text" id="pmEditHandle" value="${escapeHtml(method.handle || '')}" placeholder="e.g., @YourHandle" />
        </div>`;
    }
    if (typeInfo.fields.includes('url')) {
        fieldsHTML += `<div class="form-group">
            <label for="pmEditUrl">URL (optional)</label>
            <input type="url" id="pmEditUrl" value="${escapeHtml(method.url || '')}" placeholder="e.g., https://venmo.com/YourHandle" />
        </div>`;
    }
    if (typeInfo.fields.includes('instructions')) {
        fieldsHTML += `<div class="form-group">
            <label for="pmEditInstructions">Instructions (optional)</label>
            <input type="text" id="pmEditInstructions" value="${escapeHtml(method.instructions || '')}" placeholder="e.g., Include your name in the memo" />
        </div>`;
    }

    let qrHtml = '<div class="form-group"><label>QR Code (optional)</label><div id="pmQrCodeSection">';
    if (method.qrCode) {
        qrHtml += `<div class="pm-qr-preview"><img src="${sanitizeImageSrc(method.qrCode)}" alt="QR Code" style="max-width:150px;max-height:150px;border:1px solid #ddd;border-radius:6px;" /></div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="btn btn-secondary btn-sm" type="button" onclick="uploadPaymentMethodQr('${escapeHtml(methodId)}')">Replace</button>
                <button class="btn btn-sm btn-pm-remove" type="button" onclick="removePaymentMethodQr('${escapeHtml(methodId)}')">Remove</button>
            </div>`;
    } else {
        qrHtml += `<button class="btn btn-secondary btn-sm" type="button" onclick="uploadPaymentMethodQr('${escapeHtml(methodId)}')">Upload QR Code</button>`;
    }
    qrHtml += '</div></div>';

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Edit ${escapeHtml(typeInfo.label)} Payment Method</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <div class="form-group">
                <label for="pmEditLabel">Display Name</label>
                <input type="text" id="pmEditLabel" value="${escapeHtml(method.label || '')}" placeholder="${escapeHtml(typeInfo.label)}" />
            </div>
            ${fieldsHTML}
            ${qrHtml}
        </div>
        <div class="dialog-footer">
            <button class="btn btn-tertiary" onclick="closePaymentDialog()">Cancel</button>
            <button class="btn btn-primary" onclick="savePaymentMethodEdit('${escapeHtml(methodId)}')">Save</button>
        </div>
    `;

    overlay.classList.add('visible');
}

function uploadPaymentMethodQr(methodId) {
    const method = (settings.paymentMethods || []).find(m => m.id === methodId);
    if (!method) return;
    uploadQrCode((base64) => {
        method.qrCode = base64;
        method.hasQrCode = true;
        if (currentUser && db) {
            const docId = currentUser.uid + '_' + methodId;
            db.collection('publicQrCodes').doc(docId).set({
                ownerId: currentUser.uid,
                methodId: methodId,
                qrCode: base64,
                updatedAt: FieldValue.serverTimestamp()
            }).catch(err => console.error('Error writing QR code:', err));
        }
        saveData();
        editPaymentMethod(methodId);
    });
}

function removePaymentMethodQr(methodId) {
    const method = (settings.paymentMethods || []).find(m => m.id === methodId);
    if (!method) return;
    method.qrCode = '';
    method.hasQrCode = false;
    if (currentUser && db) {
        const docId = currentUser.uid + '_' + methodId;
        db.collection('publicQrCodes').doc(docId).delete()
            .catch(err => console.error('Error removing QR code:', err));
    }
    saveData();
    editPaymentMethod(methodId);
}

function savePaymentMethodEdit(methodId) {
    const method = (settings.paymentMethods || []).find(m => m.id === methodId);
    if (!method) return;

    const labelEl = document.getElementById('pmEditLabel');
    const emailEl = document.getElementById('pmEditEmail');
    const phoneEl = document.getElementById('pmEditPhone');
    const handleEl = document.getElementById('pmEditHandle');
    const urlEl = document.getElementById('pmEditUrl');
    const instructionsEl = document.getElementById('pmEditInstructions');

    if (labelEl) method.label = labelEl.value.trim() || (PAYMENT_METHOD_TYPES[method.type] || PAYMENT_METHOD_TYPES.other).label;
    if (emailEl) method.email = emailEl.value.trim();
    if (phoneEl) {
        const phone = phoneEl.value.trim();
        if (phone && !isValidE164(phone)) {
            alert('Phone must be in E.164 format (e.g., +14155551212)');
            return;
        }
        method.phone = phone;
    }
    if (handleEl) method.handle = handleEl.value.trim();
    if (urlEl) {
        const url = urlEl.value.trim();
        if (url && !url.match(/^https?:\/\//i)) {
            alert('URL must start with http:// or https://');
            return;
        }
        method.url = url;
    }
    if (instructionsEl) method.instructions = instructionsEl.value.trim();

    saveData();
    renderPaymentMethodsSettings();
    closePaymentDialog();
}

function togglePaymentMethodEnabled(methodId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const method = (settings.paymentMethods || []).find(m => m.id === methodId);
    if (!method) return;

    method.enabled = !method.enabled;
    saveData();
    renderPaymentMethodsSettings();
}

function removePaymentMethod(methodId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    if (!confirm('Remove this payment method?')) return;

    settings.paymentMethods = (settings.paymentMethods || []).filter(m => m.id !== methodId);
    saveData();
    renderPaymentMethodsSettings();
}

// ──────────────── Payment Options Formatters ────────────────

function getEnabledPaymentMethods() {
    return (settings.paymentMethods || []).filter(m => m.enabled);
}

function formatPaymentOptionsHTML() {
    const methods = getEnabledPaymentMethods();
    if (methods.length === 0) return '';

    let html = '<div class="payment-options-section" style="margin-top: 30px; page-break-inside: avoid;">';
    html += '<h2 style="color: #5B6475;">Payment Options</h2>';
    html += '<div style="display: grid; gap: 16px;">';

    methods.forEach(method => {
        html += '<div style="padding: 16px; background: #F7F8FB; border-radius: 8px; border: 1px solid #e0e0e0;">';
        html += `<strong style="font-size: 1.05em;">${escapeHtml(method.label)}</strong>`;

        if (method.type === 'zelle') {
            const contacts = [method.email, method.phone].filter(Boolean);
            if (contacts.length > 0) {
                html += `<p style="margin: 8px 0 0; color: #555;">Send via Zelle to: <strong>${escapeHtml(contacts.join(' or '))}</strong></p>`;
            }
        } else if (method.type === 'apple_cash') {
            const contacts = [method.phone, method.email].filter(Boolean);
            if (contacts.length > 0) {
                html += `<p style="margin: 8px 0 0; color: #555;">Send via Messages or Wallet to: <strong>${escapeHtml(contacts.join(' or '))}</strong></p>`;
            }
        } else {
            if (method.handle) {
                html += `<p style="margin: 8px 0 0; color: #555;">${escapeHtml(method.handle)}</p>`;
            }
            if (method.url) {
                html += `<p style="margin: 4px 0 0;"><a href="${escapeHtml(method.url)}" style="color: #6E78D6;">${escapeHtml(method.url)}</a></p>`;
            }
        }

        if (method.instructions) {
            html += `<p style="margin: 8px 0 0; color: #888; font-size: 0.9em; font-style: italic;">${escapeHtml(method.instructions)}</p>`;
        }

        html += '</div>';
    });

    html += '</div></div>';
    return html;
}

function formatPaymentOptionsText() {
    const methods = getEnabledPaymentMethods();
    if (methods.length === 0) return '';

    let text = '\nPayment methods:\n';

    methods.forEach(method => {
        text += `\n${method.label}\n`;

        if (method.type === 'zelle') {
            const contacts = [method.email, method.phone].filter(Boolean);
            if (contacts.length > 0) {
                text += `Send via Zelle to: ${contacts.join(' or ')}\n`;
            }
        } else if (method.type === 'apple_cash') {
            const contacts = [method.phone, method.email].filter(Boolean);
            if (contacts.length > 0) {
                text += `Send via Messages or Wallet to: ${contacts.join(' or ')}\n`;
            }
        } else {
            if (method.handle) text += `${method.handle}\n`;
            if (method.url) text += `${method.url}\n`;
        }

        if (method.instructions) {
            text += `Note: ${method.instructions}\n`;
        }
    });

    return text.trimEnd();
}

// ──────────────── Review Requests (Disputes) ────────────────

let _loadedDisputes = [];
let _disputeStatusFilter = 'actionable';

const DISPUTE_STATUS_LABELS = {
    open: 'Open',
    in_review: 'In Review',
    resolved: 'Resolved',
    rejected: 'Rejected'
};

function normalizeDisputeStatus(status) {
    if (status === 'pending') return 'open';
    if (status === 'reviewed') return 'in_review';
    return status || 'open';
}

function disputeStatusClass(status) {
    return 'dispute-' + status.replace('_', '-');
}

function setDisputeFilter(status) {
    _disputeStatusFilter = status;
    const filterBar = document.getElementById('disputeFilterBar');
    if (filterBar) {
        filterBar.querySelectorAll('.dispute-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.status === status);
        });
    }
    renderDisputes(_loadedDisputes);
}

async function loadDisputes() {
    const container = document.getElementById('disputesList');
    if (!container || !currentUser || !currentBillingYear) return;

    try {
        const snapshot = await db
            .collection('users')
            .doc(currentUser.uid)
            .collection('billingYears')
            .doc(currentBillingYear.id)
            .collection('disputes')
            .get();

        const disputes = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            data.status = normalizeDisputeStatus(data.status);
            disputes.push({ id: doc.id, ...data });
        });

        disputes.sort((a, b) => {
            const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
            const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
            return bTime - aTime;
        });

        _loadedDisputes = disputes;
        renderDisputeFilterBar(disputes);
        renderDisputes(disputes);
        renderDashboardStatus();
    } catch (error) {
        console.error('Error loading disputes:', error);
        container.innerHTML = '<p class="text-error">Error loading review requests.</p>';
    }
}

function renderDisputeFilterBar(disputes) {
    const bar = document.getElementById('disputeFilterBar');
    if (!bar) return;

    if (!disputes.length) {
        bar.innerHTML = '';
        return;
    }

    const counts = { all: disputes.length, actionable: 0, open: 0, in_review: 0, resolved: 0, rejected: 0 };
    disputes.forEach(d => {
        if (counts[d.status] !== undefined) counts[d.status]++;
        if (d.status === 'open' || d.status === 'in_review') counts.actionable++;
    });

    let filters;
    if (disputes.length <= 3) {
        if (_disputeStatusFilter !== 'actionable' && _disputeStatusFilter !== 'all') {
            _disputeStatusFilter = 'all';
        }
        filters = [
            { key: 'actionable', label: 'Actionable' },
            { key: 'all', label: 'All Requests' }
        ];
        bar.innerHTML = '<div class="dispute-filter-compact">'
            + '<span class="dispute-filter-summary">' + disputes.length + ' request' + (disputes.length === 1 ? '' : 's') + ' on file</span>'
            + '<div class="dispute-filter-compact-actions">'
            + filters.map(f =>
                `<button class="dispute-filter-btn${_disputeStatusFilter === f.key ? ' active' : ''}" data-status="${f.key}" onclick="setDisputeFilter('${f.key}')">${escapeHtml(f.label)} <span class="dispute-filter-count">${counts[f.key] || 0}</span></button>`
            ).join('')
            + '</div>'
            + '</div>';
        return;
    }

    filters = [
        { key: 'actionable', label: 'Actionable' },
        { key: 'all', label: 'All' },
        { key: 'open', label: 'Open' },
        { key: 'in_review', label: 'In Review' },
        { key: 'resolved', label: 'Resolved' },
        { key: 'rejected', label: 'Rejected' }
    ];

    bar.innerHTML = filters.map(f =>
        `<button class="dispute-filter-btn${_disputeStatusFilter === f.key ? ' active' : ''}" data-status="${f.key}" onclick="setDisputeFilter('${f.key}')">${escapeHtml(f.label)} <span class="dispute-filter-count">${counts[f.key]}</span></button>`
    ).join('');
}

function renderDisputes(disputes) {
    const container = document.getElementById('disputesList');
    if (!container) return;

    let filtered;
    if (_disputeStatusFilter === 'all') {
        filtered = disputes;
    } else if (_disputeStatusFilter === 'actionable') {
        filtered = disputes.filter(d => d.status === 'open' || d.status === 'in_review');
    } else {
        filtered = disputes.filter(d => d.status === _disputeStatusFilter);
    }

    // Sort: open first, then in_review, then resolved, then rejected
    const disputeSortOrder = { open: 0, in_review: 1, resolved: 2, rejected: 3 };
    filtered.sort((a, b) => (disputeSortOrder[a.status] ?? 9) - (disputeSortOrder[b.status] ?? 9));

    if (filtered.length === 0) {
        if (_disputeStatusFilter === 'all') {
            container.innerHTML = '<div class="empty-state">'
                + '<p>No review requests yet.</p>'
                + '<p class="empty-state-hint">Requests appear here when members flag bills during annual review.</p>'
                + '</div>';
        } else if (_disputeStatusFilter === 'actionable' && disputes.length > 0) {
            container.innerHTML = '<div class="empty-state review-empty-state">'
                + '<p>No open review requests.</p>'
                + '<button class="btn btn-secondary btn-sm empty-state-action" onclick="setDisputeFilter(\'all\')">Show all requests (' + disputes.length + ')</button>'
                + '</div>';
        } else {
            const statusLabel = (DISPUTE_STATUS_LABELS[_disputeStatusFilter] || _disputeStatusFilter).toLowerCase();
            container.innerHTML = '<p class="empty-state">No ' + escapeHtml(statusLabel) + ' review requests.</p>';
        }
        return;
    }

    let html = '<div class="disputes-list">';
    filtered.forEach(d => {
        const created = d.createdAt
            ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt)).toLocaleDateString()
            : 'Unknown';

        const sClass = disputeStatusClass(d.status);
        const statusLabel = DISPUTE_STATUS_LABELS[d.status] || d.status;
        const evidenceCount = (d.evidence || []).length;
        const userReviewState = d.userReview ? d.userReview.state : null;

        html += `<div class="dispute-item ${sClass}" onclick="showDisputeDetail('${escapeHtml(d.id)}')">
            <div class="dispute-item-header">
                <strong>${escapeHtml(d.billName)}</strong>
                <div class="dispute-item-badges">
                    ${evidenceCount > 0 ? `<span class="dispute-evidence-badge" title="${evidenceCount} attachment${evidenceCount !== 1 ? 's' : ''}">${evidenceCount} file${evidenceCount !== 1 ? 's' : ''}</span>` : ''}
                    ${userReviewState ? `<span class="dispute-user-review-badge dispute-ur-${escapeHtml(userReviewState)}">${escapeHtml(userReviewState === 'requested' ? 'Awaiting User' : userReviewState === 'approved_by_user' ? 'User Approved' : userReviewState === 'rejected_by_user' ? 'User Rejected' : userReviewState)}</span>` : ''}
                    <span class="dispute-status-badge ${sClass}">${escapeHtml(statusLabel)}</span>
                </div>
            </div>
            <div class="dispute-item-meta">
                From <strong>${escapeHtml(d.memberName)}</strong> &middot; ${escapeHtml(created)}
            </div>
            <div class="dispute-item-message">${escapeHtml(d.message)}</div>
            ${d.proposedCorrection ? `<div class="dispute-item-correction">Suggested: ${escapeHtml(d.proposedCorrection)}</div>` : ''}
            ${d.resolutionNote ? `<div class="dispute-item-resolution">Resolution: ${escapeHtml(d.resolutionNote)}</div>` : ''}
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

function getDisputeRef(disputeId) {
    return db
        .collection('users')
        .doc(currentUser.uid)
        .collection('billingYears')
        .doc(currentBillingYear.id)
        .collection('disputes')
        .doc(disputeId);
}

async function updateDispute(disputeId, updates) {
    if (!currentUser || !currentBillingYear) return;
    if (isYearReadOnly()) {
        alert(yearReadOnlyMessage());
        return;
    }

    try {
        await getDisputeRef(disputeId).update(updates);
        await loadDisputes();
    } catch (error) {
        console.error('Error updating dispute:', error);
        alert('Error updating review request. Please try again.');
    }
}

function showDisputeDetail(disputeId) {
    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d) return;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    const created = d.createdAt
        ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt)).toLocaleDateString()
        : 'Unknown';
    const sClass = disputeStatusClass(d.status);
    const statusLabel = DISPUTE_STATUS_LABELS[d.status] || d.status;
    const isTerminal = d.status === 'resolved' || d.status === 'rejected';

    const member = familyMembers.find(m => m.id === d.memberId);
    const bill = bills.find(b => b.id === d.billId);

    let jumpLinks = '<div class="dispute-detail-links">';
    if (bill) jumpLinks += `<a href="#" onclick="closePaymentDialog(); scrollToBill(${d.billId}); return false;">View Bill: ${escapeHtml(bill.name)}</a>`;
    if (member) jumpLinks += `<a href="#" onclick="closePaymentDialog(); scrollToMember(${d.memberId}); return false;">View Member: ${escapeHtml(member.name)}</a>`;
    jumpLinks += '</div>';

    let statusActions = '';
    if (!isTerminal) {
        statusActions = '<div class="dispute-detail-actions">';
        if (d.status === 'open') {
            statusActions += `<button class="btn btn-sm btn-secondary" onclick="doDisputeAction('${escapeHtml(d.id)}', 'in_review')">Mark In Review</button>`;
        }
        statusActions += `<button class="btn btn-sm btn-success" onclick="doDisputeAction('${escapeHtml(d.id)}', 'resolved')">Resolve</button>`;
        statusActions += `<button class="btn btn-sm btn-danger" onclick="doDisputeAction('${escapeHtml(d.id)}', 'rejected')">Reject</button>`;
        statusActions += '</div>';
    }

    const userReviewState = d.userReview ? d.userReview.state : null;
    let userReviewSection = '';
    if (!isTerminal) {
        userReviewSection = `<div class="form-group mt-2">
            <label class="checkbox-label">
                <input type="checkbox" id="disputeUserReview" ${userReviewState === 'requested' ? 'checked' : ''} onchange="toggleUserReview('${escapeHtml(d.id)}', this.checked)" />
                Request user approval
            </label>
            <p class="text-help">Sends approve/reject decision to the member via their share link.</p>
        </div>`;
    } else if (userReviewState) {
        const urLabel = userReviewState === 'approved_by_user' ? 'Approved by user'
            : userReviewState === 'rejected_by_user' ? 'Rejected by user'
            : userReviewState;
        userReviewSection = `<div class="dispute-detail-user-review"><strong>User Decision:</strong> ${escapeHtml(urLabel)}${d.userReview.rejectionNote ? '—' + escapeHtml(d.userReview.rejectionNote) : ''}</div>`;
    }

    const evidenceList = (d.evidence || []);
    let evidenceHtml = '<div class="dispute-evidence-section"><h4>Evidence</h4>';
    if (evidenceList.length > 0) {
        evidenceHtml += '<div class="dispute-evidence-list">';
        evidenceList.forEach((ev, idx) => {
            const isImage = ev.contentType && ev.contentType.startsWith('image/');
            evidenceHtml += `<div class="dispute-evidence-item">
                <span class="dispute-evidence-icon">${isImage ? '&#128247;' : '&#128196;'}</span>
                <span class="dispute-evidence-name">${escapeHtml(ev.name)}</span>
                <span class="dispute-evidence-size">${formatFileSize(ev.size || 0)}</span>
                <button class="btn-icon" onclick="viewEvidence('${escapeHtml(d.id)}', ${idx})" title="View">&#128065;</button>
                <button class="btn-icon remove" onclick="removeEvidence('${escapeHtml(d.id)}', ${idx})" title="Remove">&times;</button>
            </div>`;
        });
        evidenceHtml += '</div>';
    } else {
        evidenceHtml += '<p class="text-muted">No evidence attached.</p>';
    }
    if (!isTerminal && evidenceList.length < 10) {
        evidenceHtml += `<button class="btn btn-sm btn-secondary mt-2" onclick="uploadEvidence('${escapeHtml(d.id)}')">Upload Evidence</button>`;
    }
    evidenceHtml += '</div>';

    let resolvedInfo = '';
    if (d.resolvedAt) {
        const resolvedDate = (d.resolvedAt.toDate ? d.resolvedAt.toDate() : new Date(d.resolvedAt)).toLocaleDateString();
        resolvedInfo = `<div class="dispute-detail-timestamp">Resolved: ${escapeHtml(resolvedDate)}</div>`;
    }
    if (d.rejectedAt) {
        const rejectedDate = (d.rejectedAt.toDate ? d.rejectedAt.toDate() : new Date(d.rejectedAt)).toLocaleDateString();
        resolvedInfo = `<div class="dispute-detail-timestamp">Rejected: ${escapeHtml(rejectedDate)}</div>`;
    }

    let shareActions = '';
    if (isTerminal && d.resolutionNote && member) {
        shareActions = `<div class="dispute-share-actions">
            <span class="dispute-share-label">Share Resolution:</span>
            ${member.email ? `<button class="btn btn-sm btn-secondary" onclick="emailDisputeResolution('${escapeHtml(d.id)}')">Email</button>` : ''}
            ${member.phone ? `<button class="btn btn-sm btn-secondary" onclick="textDisputeResolution('${escapeHtml(d.id)}')">Text</button>` : ''}
            <button class="btn btn-sm btn-secondary" onclick="copyDisputeResolution('${escapeHtml(d.id)}')">Copy</button>
        </div>`;
    }

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>${escapeHtml(d.billName)} <span class="dispute-status-badge ${sClass}">${escapeHtml(statusLabel)}</span></h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <div class="dispute-detail-meta">
                From <strong>${escapeHtml(d.memberName)}</strong> &middot; ${escapeHtml(created)}
                ${resolvedInfo}
            </div>
            ${jumpLinks}
            <div class="dispute-detail-message">
                <h4>Message</h4>
                <p>${escapeHtml(d.message)}</p>
            </div>
            ${d.proposedCorrection ? `<div class="dispute-detail-correction"><h4>Suggested Correction</h4><p>${escapeHtml(d.proposedCorrection)}</p></div>` : ''}
            <div class="form-group mt-3">
                <label for="disputeResolutionNote">Resolution Note</label>
                <textarea id="disputeResolutionNote" rows="3" placeholder="Add a resolution note..." ${isTerminal ? 'disabled' : ''}>${escapeHtml(d.resolutionNote || '')}</textarea>
            </div>
            ${userReviewSection}
            ${evidenceHtml}
            ${statusActions}
            ${shareActions}
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>
        </div>
    `;

    overlay.classList.add('visible');
}

function buildDisputeResolutionText(d, shareUrl) {
    const member = familyMembers.find(m => m.id === d.memberId);
    const year = currentBillingYear ? (currentBillingYear.label || currentBillingYear.id) : '';
    const statusWord = d.status === 'resolved' ? 'resolved' : 'reviewed';
    let text = `Hi ${member ? member.name : 'there'},\n\n`;
    text += `Your review request for ${d.billName} (${year}) has been ${statusWord}.\n\n`;
    text += `Resolution: ${d.resolutionNote}\n`;
    if (d.proposedCorrection) {
        text += `Your suggestion: ${d.proposedCorrection}\n`;
    }
    text += `\nIf you have questions, please reach out.\n\nThanks!`;
    if (shareUrl) {
        text += `\n\n${shareUrl}`;
    }
    return text;
}

async function generateResolutionShareLink(memberId) {
    const rawToken = generateRawToken();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const scopes = ['summary:read', 'paymentMethods:read', 'disputes:read'];

    const member = familyMembers.find(m => m.id === memberId);
    const tokenDoc = {
        ownerId: currentUser.uid,
        memberId: memberId,
        billingYearId: currentBillingYear.id,
        scopes: scopes,
        revoked: false,
        expiresAt: Timestamp.fromDate(expiresAt),
        createdAt: FieldValue.serverTimestamp(),
        lastAccessedAt: null,
        accessCount: 0,
        memberName: member ? member.name : '',
        rawToken: rawToken
    };

    await db.collection('shareTokens').doc(tokenHash).set(tokenDoc);

    const publicData = buildPublicShareData(memberId, scopes);
    if (publicData) {
        publicData.disputes = buildDisputesForShare(memberId, scopes);
        await db.collection('publicShares').doc(tokenHash).set(publicData);
    }

    return window.location.origin + '/share.html?token=' + rawToken;
}

async function emailDisputeResolution(disputeId) {
    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d) return;
    const member = familyMembers.find(m => m.id === d.memberId);
    if (!member || !member.email) return;

    showChangeToast('Generating share link\u2026');
    try {
        const shareUrl = await generateResolutionShareLink(d.memberId);
        const year = currentBillingYear ? (currentBillingYear.label || currentBillingYear.id) : '';
        const subject = `Review Request Update\u2014${d.billName} (${year})`;
        const body = buildDisputeResolutionText(d, shareUrl);
        const mailto = 'mailto:' + encodeURIComponent(member.email)
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(body);
        window.open(mailto, '_blank');
    } catch (err) {
        console.error('Error generating resolution link:', err);
        alert('Could not generate share link. Please try again.');
    }
}

async function textDisputeResolution(disputeId) {
    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d) return;
    const member = familyMembers.find(m => m.id === d.memberId);
    if (!member || !member.phone) return;

    showChangeToast('Generating share link\u2026');
    try {
        const shareUrl = await generateResolutionShareLink(d.memberId);
        const body = buildDisputeResolutionText(d, shareUrl);
        openSmsComposer(member.phone, body);
    } catch (err) {
        console.error('Error generating resolution link:', err);
        alert('Could not generate share link. Please try again.');
    }
}

async function copyDisputeResolution(disputeId) {
    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d) return;

    showChangeToast('Generating share link\u2026');
    try {
        const shareUrl = await generateResolutionShareLink(d.memberId);
        const text = buildDisputeResolutionText(d, shareUrl);
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            showChangeToast('Resolution with link copied');
        }
    } catch (err) {
        console.error('Error generating resolution link:', err);
        alert('Could not generate share link. Please try again.');
    }
}

function doDisputeAction(disputeId, newStatus) {
    const noteEl = document.getElementById('disputeResolutionNote');
    const note = noteEl ? noteEl.value.trim() : '';

    if ((newStatus === 'resolved' || newStatus === 'rejected') && !note) {
        alert('Please add a resolution note before ' + (newStatus === 'resolved' ? 'resolving' : 'rejecting') + '.');
        if (noteEl) noteEl.focus();
        return;
    }

    const updates = { status: newStatus };
    if (note) updates.resolutionNote = note;
    if (newStatus === 'resolved') updates.resolvedAt = FieldValue.serverTimestamp();
    if (newStatus === 'rejected') updates.rejectedAt = FieldValue.serverTimestamp();

    updateDispute(disputeId, updates).then(() => {
        closePaymentDialog();
    });
}

async function toggleUserReview(disputeId, checked) {
    const updates = checked
        ? { 'userReview.state': 'requested' }
        : { userReview: FieldValue.delete() };
    await updateDispute(disputeId, updates);
    showDisputeDetail(disputeId);
}

function scrollToBill(billId) {
    const el = document.querySelector(`#bill-${billId}, [data-bill-id="${billId}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '3px solid #6E78D6'; setTimeout(() => { el.style.outline = ''; }, 2000); }
}

function scrollToMember(memberId) {
    const el = document.querySelector(`[data-member-id="${memberId}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '3px solid #6E78D6'; setTimeout(() => { el.style.outline = ''; }, 2000); }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const EVIDENCE_MAX_SIZE = 20 * 1024 * 1024;
const EVIDENCE_MAX_COUNT = 10;
const EVIDENCE_ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

async function backfillEvidenceUrls() {
    const toFix = [];
    _loadedDisputes.forEach(d => {
        (d.evidence || []).forEach(ev => {
            if (ev.storagePath && !ev.downloadUrl) {
                toFix.push({ dispute: d, ev: ev });
            }
        });
    });
    if (toFix.length === 0) return;
    await Promise.all(toFix.map(async ({ dispute, ev }) => {
        try {
            ev.downloadUrl = await storage.ref(ev.storagePath).getDownloadURL();
            await getDisputeRef(dispute.id).update({ evidence: dispute.evidence });
        } catch (_) {}
    }));
}

function uploadEvidence(disputeId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    if (!storage) { alert('Storage is not available.'); return; }
    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d) return;

    const existing = (d.evidence || []).length;
    if (existing >= EVIDENCE_MAX_COUNT) {
        alert('Maximum ' + EVIDENCE_MAX_COUNT + ' attachments per dispute.');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = EVIDENCE_ALLOWED_TYPES.join(',');
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!EVIDENCE_ALLOWED_TYPES.includes(file.type)) {
            alert('Only PDF, PNG, and JPEG files are allowed.');
            return;
        }
        if (file.size > EVIDENCE_MAX_SIZE) {
            alert('File is too large. Maximum size is 20 MB.');
            return;
        }

        const storagePath = 'users/' + currentUser.uid + '/disputes/' + disputeId + '/' + Date.now() + '_' + file.name;
        const ref = storage.ref(storagePath);
        const uploadTask = ref.put(file);

        const progressEl = document.createElement('div');
        progressEl.className = 'dispute-evidence-progress';
        progressEl.innerHTML = '<div class="dispute-evidence-progress-bar"><div class="dispute-evidence-progress-fill" style="width:0%"></div></div><p class="text-help mt-2">Uploading ' + escapeHtml(file.name) + '...</p>';
        const section = document.querySelector('.dispute-evidence-section');
        if (section) section.appendChild(progressEl);

        uploadTask.on('state_changed',
            (snapshot) => {
                const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                const fill = progressEl.querySelector('.dispute-evidence-progress-fill');
                if (fill) fill.style.width = pct + '%';
            },
            (error) => {
                console.error('Evidence upload error:', error);
                alert('Upload failed. Please try again.');
                if (progressEl.parentNode) progressEl.parentNode.removeChild(progressEl);
            },
            async () => {
                if (progressEl.parentNode) progressEl.parentNode.removeChild(progressEl);

                let downloadUrl = '';
                try { downloadUrl = await ref.getDownloadURL(); } catch (_) {}

                const evidenceEntry = {
                    name: file.name,
                    storagePath: storagePath,
                    contentType: file.type,
                    size: file.size,
                    uploadedAt: new Date().toISOString(),
                    downloadUrl: downloadUrl
                };

                try {
                    await getDisputeRef(disputeId).update({
                        evidence: FieldValue.arrayUnion(evidenceEntry)
                    });
                    await loadDisputes();
                    showDisputeDetail(disputeId);
                } catch (err) {
                    console.error('Error saving evidence metadata:', err);
                    alert('File uploaded but metadata save failed. Please try again.');
                }
            }
        );
    };
    input.click();
}

async function viewEvidence(disputeId, index) {
    if (!storage) return;
    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d || !d.evidence || !d.evidence[index]) return;

    const ev = d.evidence[index];
    try {
        const url = await storage.ref(ev.storagePath).getDownloadURL();
        const isImage = /^image\//i.test(ev.contentType || '');
        const isPdf = /^application\/pdf$/i.test(ev.contentType || '');
        showEvidenceModal(url, ev.name, isImage, isPdf);
    } catch (error) {
        console.error('Error getting evidence URL:', error);
        alert('Could not load evidence. It may have been deleted.');
    }
}

function showEvidenceModal(url, name, isImage, isPdf) {
    let existing = document.getElementById('evidenceModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'evidenceModalOverlay';
    overlay.className = 'evidence-modal-overlay';

    let contentHtml;
    if (isImage) {
        contentHtml = '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(name) + '" />';
    } else if (isPdf) {
        contentHtml = '<iframe src="' + escapeHtml(url) + '" title="' + escapeHtml(name) + '"></iframe>';
    } else {
        contentHtml = '<p>This file type cannot be previewed.</p>'
            + '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Download File</a>';
    }

    overlay.innerHTML = '<div class="evidence-modal">'
        + '<div class="evidence-modal-header">'
        + '<h3>' + escapeHtml(name) + '</h3>'
        + '<button class="dialog-close" onclick="closeEvidenceModal()">&times;</button>'
        + '</div>'
        + '<div class="evidence-modal-body">' + contentHtml + '</div>'
        + '<div class="evidence-modal-footer">'
        + '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open in New Tab</a>'
        + '<button class="btn btn-primary btn-sm" onclick="closeEvidenceModal()">Close</button>'
        + '</div>'
        + '</div>';

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeEvidenceModal();
    });
    document.body.appendChild(overlay);
}

function closeEvidenceModal() {
    const overlay = document.getElementById('evidenceModalOverlay');
    if (overlay) overlay.remove();
}

async function removeEvidence(disputeId, index) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    if (!storage) return;
    if (!confirm('Remove this evidence file?')) return;

    const d = _loadedDisputes.find(x => x.id === disputeId);
    if (!d || !d.evidence || !d.evidence[index]) return;

    const ev = d.evidence[index];

    try {
        await storage.ref(ev.storagePath).delete();
    } catch (err) {
        console.warn('Could not delete storage file (may already be gone):', err);
    }

    try {
        await getDisputeRef(disputeId).update({
            evidence: FieldValue.arrayRemove(ev)
        });
        await loadDisputes();
        showDisputeDetail(disputeId);
    } catch (err) {
        console.error('Error removing evidence metadata:', err);
        alert('Error removing evidence. Please try again.');
    }
}

// ──────────────── Share Link Functions ────────────────

function computeMemberSummaryForShare(targetMemberId) {
    const member = familyMembers.find(m => m.id === targetMemberId);
    if (!member) return null;
    const memberBills = [];
    let total = 0;
    bills.forEach(bill => {
        if (bill.members && bill.members.includes(targetMemberId) && bill.members.length > 0) {
            const annualTotal = getBillAnnualAmount(bill);
            const annualShare = annualTotal / bill.members.length;
            const monthlyShare = annualShare / 12;
            total += annualShare;
            memberBills.push({
                billId: bill.id,
                name: bill.name,
                monthlyAmount: getBillMonthlyAmount(bill),
                billingFrequency: bill.billingFrequency || 'monthly',
                canonicalAmount: bill.amount,
                splitCount: bill.members.length,
                monthlyShare: Math.round(monthlyShare * 100) / 100,
                annualShare: Math.round(annualShare * 100) / 100,
            });
        }
    });
    return {
        name: member.name,
        memberId: targetMemberId,
        monthlyTotal: Math.round((total / 12) * 100) / 100,
        annualTotal: Math.round(total * 100) / 100,
        bills: memberBills,
    };
}

function buildPublicShareData(memberId, scopes) {
    const primarySummary = computeMemberSummaryForShare(memberId);
    if (!primarySummary) return null;

    const member = familyMembers.find(m => m.id === memberId);
    const linkedIds = (member && member.linkedMembers) || [];
    const linkedSummaries = linkedIds
        .map(id => computeMemberSummaryForShare(id))
        .filter(Boolean);

    const paymentTotal = payments
        .filter(p => p.memberId === memberId)
        .reduce((sum, p) => sum + (p.amount || 0), 0);
    let combinedAnnual = primarySummary.annualTotal;
    let combinedPayment = paymentTotal;
    linkedSummaries.forEach(ls => {
        combinedAnnual += ls.annualTotal;
        combinedPayment += payments
            .filter(p => p.memberId === ls.memberId)
            .reduce((sum, p) => sum + (p.amount || 0), 0);
    });

    const enabledMethods = getEnabledPaymentMethods();

    const data = {
        memberName: primarySummary.name,
        memberId: memberId,
        billingYearId: currentBillingYear ? currentBillingYear.id : '',
        year: currentBillingYear ? (currentBillingYear.label || currentBillingYear.id) : '',
        scopes: scopes,
        ownerId: currentUser ? currentUser.uid : '',
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (scopes.includes('summary:read')) {
        data.summary = primarySummary;
        data.linkedMembers = linkedSummaries;
        data.paymentSummary = {
            combinedAnnualTotal: Math.round(combinedAnnual * 100) / 100,
            combinedMonthlyTotal: Math.round((combinedAnnual / 12) * 100) / 100,
            totalPaid: Math.round(combinedPayment * 100) / 100,
            balanceRemaining: Math.round((combinedAnnual - combinedPayment) * 100) / 100,
        };
    }

    if (scopes.includes('paymentMethods:read')) {
        data.paymentMethods = enabledMethods.map(m => {
            const copy = Object.assign({}, m);
            if (copy.qrCode) {
                copy.hasQrCode = true;
                delete copy.qrCode;
            }
            return copy;
        });
    }

    return data;
}

function buildDisputesForShare(memberId, scopes) {
    if (!scopes.includes('disputes:read')) return [];
    return _loadedDisputes
        .filter(d => d.memberId === memberId)
        .map(d => ({
            id: d.id,
            billId: d.billId,
            billName: d.billName,
            message: d.message,
            proposedCorrection: d.proposedCorrection || null,
            status: normalizeDisputeStatus(d.status),
            resolutionNote: d.resolutionNote || null,
            createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : null,
            resolvedAt: d.resolvedAt ? (d.resolvedAt.toDate ? d.resolvedAt.toDate().toISOString() : new Date(d.resolvedAt).toISOString()) : null,
            rejectedAt: d.rejectedAt ? (d.rejectedAt.toDate ? d.rejectedAt.toDate().toISOString() : new Date(d.rejectedAt).toISOString()) : null,
            evidence: (d.evidence || []).map((ev, idx) => ({
                index: idx,
                name: ev.name,
                contentType: ev.contentType,
                size: ev.size,
                downloadUrl: ev.downloadUrl || null,
            })),
            userReview: d.userReview || null,
        }));
}

async function loadQrCodesFromFirestore() {
    if (!currentUser || !db || !settings.paymentMethods) return;
    const methodsWithQr = settings.paymentMethods.filter(m => m.hasQrCode && !m.qrCode);
    if (methodsWithQr.length === 0) return;
    try {
        await Promise.all(methodsWithQr.map(async (m) => {
            const docId = currentUser.uid + '_' + m.id;
            const doc = await db.collection('publicQrCodes').doc(docId).get();
            if (doc.exists && doc.data().qrCode) {
                m.qrCode = doc.data().qrCode;
            }
        }));
    } catch (err) {
        console.error('Error loading QR codes:', err);
    }
}

async function writePublicQrCodes() {
    if (!currentUser || !db) return;
    const methods = (settings.paymentMethods || []).filter(m => m.qrCode);
    if (methods.length === 0) return;
    try {
        const batch = db.batch();
        methods.forEach(m => {
            const docId = currentUser.uid + '_' + m.id;
            batch.set(db.collection('publicQrCodes').doc(docId), {
                ownerId: currentUser.uid,
                methodId: m.id,
                qrCode: m.qrCode,
                updatedAt: FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
    } catch (err) {
        console.error('Error writing public QR codes:', err);
    }
}

async function refreshPublicShares() {
    if (!currentUser || !db || !currentBillingYear) return;
    if (typeof db.batch !== 'function') return;
    try {
        const snapshot = await db.collection('shareTokens')
            .where('ownerId', '==', currentUser.uid)
            .where('billingYearId', '==', currentBillingYear.id)
            .get();
        const MAX_BATCH_OPS = 490;
        let batch = db.batch();
        let opCount = 0;

        async function flushBatch() {
            if (opCount > 0) {
                await batch.commit();
                batch = db.batch();
                opCount = 0;
            }
        }

        const hasDisputeScopes = snapshot.docs.some(d => {
            const td = d.data();
            return !td.revoked && (td.scopes || []).includes('disputes:read');
        });
        if (hasDisputeScopes && _loadedDisputes.length === 0) {
            try {
                const dSnap = await db.collection('users').doc(currentUser.uid)
                    .collection('billingYears').doc(currentBillingYear.id)
                    .collection('disputes').get();
                dSnap.docs.forEach(d => {
                    const dd = d.data();
                    dd.status = normalizeDisputeStatus(dd.status);
                    _loadedDisputes.push({ id: d.id, ...dd });
                });
            } catch (_) {}
        }
        if (hasDisputeScopes && storage) {
            await backfillEvidenceUrls();
        }

        const now = new Date();
        for (const doc of snapshot.docs) {
            const tokenData = doc.data();
            const isStale = tokenData.revoked || (tokenData.expiresAt && (
                (tokenData.expiresAt.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt)) < now
            ));

            if (isStale) {
                batch.delete(db.collection('publicShares').doc(doc.id));
                opCount++;
            } else {
                const scopes = tokenData.scopes || ['summary:read', 'paymentMethods:read'];
                const shareData = buildPublicShareData(tokenData.memberId, scopes);
                if (shareData) {
                    shareData.disputes = buildDisputesForShare(tokenData.memberId, scopes);
                    batch.set(db.collection('publicShares').doc(doc.id), shareData);
                    opCount++;
                }
            }

            if (opCount >= MAX_BATCH_OPS) await flushBatch();
        }
        await flushBatch();
        writePublicQrCodes();
    } catch (err) {
        console.error('Error refreshing public shares:', err);
    }
}

async function hashToken(rawToken) {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateRawToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateShareLink(memberId) {
    if (!currentUser || !currentBillingYear) return;

    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    const yearLabel = currentBillingYear.label;

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Generate Share Link</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <p>Create a shareable link for <strong>${escapeHtml(member.name)}</strong> to view their ${escapeHtml(yearLabel)} billing summary.</p>
            <div class="form-group mt-3">
                <label for="shareLinkExpiry">Link Expiry (optional)</label>
                <select id="shareLinkExpiry">
                    <option value="">No expiry</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                </select>
            </div>
            <div class="form-group mt-2">
                <label class="checkbox-label">
                    <input type="checkbox" id="shareLinkDisputes" />
                    Allow member to request bill reviews
                </label>
                <p class="text-help">
                    Adds <code>disputes:create</code> scope so the member can flag bill line items for review.
                </p>
            </div>
            <div class="form-group mt-2">
                <label class="checkbox-label">
                    <input type="checkbox" id="shareLinkDisputesRead" />
                    Allow member to view review requests &amp; evidence
                </label>
                <p class="text-help">
                    Adds <code>disputes:read</code> scope so the member can see their disputes, evidence, and approve/reject resolutions.
                </p>
            </div>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-tertiary" onclick="closePaymentDialog()">Cancel</button>
            <button class="btn btn-primary" id="generateShareBtn" onclick="doGenerateShareLink(${memberId})">Generate &amp; Copy Link</button>
        </div>
    `;

    overlay.classList.add('visible');
}

async function doGenerateShareLink(memberId) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member || !currentUser || !currentBillingYear) return;

    const btn = document.getElementById('generateShareBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    try {
        const rawToken = generateRawToken();
        const tokenHash = await hashToken(rawToken);

        const expirySelect = document.getElementById('shareLinkExpiry');
        const expiryDays = expirySelect ? parseInt(expirySelect.value) : 0;
        let expiresAt = null;
        if (expiryDays > 0) {
            const d = new Date();
            d.setDate(d.getDate() + expiryDays);
            expiresAt = d;
        }

        const disputeCheckbox = document.getElementById('shareLinkDisputes');
        const disputeReadCheckbox = document.getElementById('shareLinkDisputesRead');
        const scopes = ['summary:read', 'paymentMethods:read'];
        if (disputeCheckbox && disputeCheckbox.checked) {
            scopes.push('disputes:create');
        }
        if (disputeReadCheckbox && disputeReadCheckbox.checked) {
            scopes.push('disputes:read');
        }

        const tokenDoc = {
            ownerId: currentUser.uid,
            memberId: memberId,
            billingYearId: currentBillingYear.id,
            scopes: scopes,
            revoked: false,
            expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
            createdAt: FieldValue.serverTimestamp(),
            lastAccessedAt: null,
            accessCount: 0,
            memberName: member.name,
            rawToken: rawToken
        };

        await db.collection('shareTokens').doc(tokenHash).set(tokenDoc);

        const publicData = buildPublicShareData(memberId, scopes);
        if (publicData) {
            await db.collection('publicShares').doc(tokenHash).set(publicData);
        }
        writePublicQrCodes();

        const shareUrl = window.location.origin + '/share.html?token=' + rawToken;

        let copied = false;
        try {
            await navigator.clipboard.writeText(shareUrl);
            copied = true;
        } catch (_) {}

        showShareLinkSuccess(shareUrl, member.name, copied);

        if (analytics) {
            analytics.logEvent('share_link_generated', {
                has_expiry: !!expiresAt,
                billing_year: currentBillingYear.label
            });
        }
    } catch (error) {
        console.error('Error generating share link:', error);
        alert('Error generating share link. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Generate & Copy Link'; }
    }
}

function showShareLinkSuccess(shareUrl, memberName, autoCopied) {
    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Share Link Created</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <p style="margin-bottom:12px;">${autoCopied ? '&#10003; Link copied to clipboard! ' : ''}${escapeHtml(memberName)} can open this link to view their billing summary without logging in.</p>
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="text" id="shareLinkUrlInput" value="${escapeHtml(shareUrl)}" readonly
                    style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;background:#f9fafb;color:#333;font-family:monospace;" />
                <button class="btn btn-primary" id="copyShareLinkBtn" onclick="copyShareLinkUrl()">Copy</button>
            </div>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Done</button>
        </div>
    `;

    overlay.classList.add('visible');

    const input = document.getElementById('shareLinkUrlInput');
    if (input) { input.focus(); input.select(); }
}

function copyShareLinkUrl() {
    const input = document.getElementById('shareLinkUrlInput');
    const btn = document.getElementById('copyShareLinkBtn');
    if (!input) return;

    input.select();
    input.setSelectionRange(0, 99999);

    if (navigator.clipboard) {
        navigator.clipboard.writeText(input.value).then(() => {
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
        }).catch(() => {
            try { document.execCommand('copy'); } catch (_) {}
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
        });
    } else {
        try { document.execCommand('copy'); } catch (_) {}
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
    }
}

async function showShareLinks(memberId) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member || !currentUser) return;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Share Links: ${escapeHtml(member.name)}</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <p class="text-muted">Loading share links...</p>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>
        </div>
    `;
    overlay.classList.add('visible');

    try {
        const snapshot = await db.collection('shareTokens')
            .where('ownerId', '==', currentUser.uid)
            .where('memberId', '==', memberId)
            .get();

        const links = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            links.push({ id: doc.id, ...data });
        });

        const activeHashes = links.filter(l => !l.revoked).map(l => l.id);
        const accessCounts = {};
        await Promise.all(activeHashes.map(async hash => {
            try {
                const psDoc = await db.collection('publicShares').doc(hash).get();
                if (psDoc.exists) {
                    const psData = psDoc.data();
                    accessCounts[hash] = psData.accessCount || 0;
                }
            } catch (_) {}
        }));

        links.sort((a, b) => {
            const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
            const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
            return bTime - aTime;
        });

        let html = '';
        if (links.length === 0) {
            html = '<p class="empty-state-compact">No share links generated yet for this member.</p>';
        } else {
            html = '<div class="share-links-list">';
            links.forEach(link => {
                const created = link.createdAt
                    ? (link.createdAt.toDate ? link.createdAt.toDate() : new Date(link.createdAt)).toLocaleDateString()
                    : 'Unknown';
                const yearLabel = link.billingYearId || '';

                let statusClass = 'active';
                let statusLabel = 'Active';
                if (link.revoked) {
                    statusClass = 'revoked';
                    statusLabel = 'Revoked';
                } else if (link.expiresAt) {
                    const exp = link.expiresAt.toDate ? link.expiresAt.toDate() : new Date(link.expiresAt);
                    if (exp < new Date()) {
                        statusClass = 'expired';
                        statusLabel = 'Expired';
                    } else {
                        statusLabel = 'Expires ' + exp.toLocaleDateString();
                    }
                }

                const count = accessCounts[link.id] !== undefined ? accessCounts[link.id] : (link.accessCount || 0);
                const accessInfo = count > 0
                    ? count + ' view' + (count !== 1 ? 's' : '')
                    : 'Never viewed';

                let linkUrlHtml = '';
                const isActive = !link.revoked && !(link.expiresAt && ((link.expiresAt.toDate ? link.expiresAt.toDate() : new Date(link.expiresAt)) < new Date()));
                if (isActive && link.rawToken) {
                    const url = window.location.origin + '/share.html?token=' + link.rawToken;
                    const displayUrl = url.replace(/^https?:\/\//, '');
                    const truncated = displayUrl.length > 40 ? displayUrl.substring(0, 37) + '...' : displayUrl;
                    linkUrlHtml = `<div class="share-link-url-row"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="share-link-url-text" title="${escapeHtml(displayUrl)}">${escapeHtml(truncated)}</a><button class="btn btn-sm share-link-copy-btn" onclick="navigator.clipboard.writeText('${escapeHtml(url)}').then(function(){showChangeToast('Link copied')})">Copy</button></div>`;
                }

                html += `<div class="share-link-item">
                    <div class="share-link-meta">
                        <span>Year: <strong>${escapeHtml(yearLabel)}</strong></span>
                        <span class="share-link-date">Created: ${escapeHtml(created)}</span>
                        <span class="share-link-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                        <span class="share-link-access">${escapeHtml(accessInfo)}</span>
                        ${linkUrlHtml}
                    </div>
                    <div class="share-link-actions">
                        ${!link.revoked ? `<button class="btn btn-danger btn-sm" onclick="revokeShareLink('${escapeHtml(link.id)}', ${memberId})">Revoke</button>` : ''}
                    </div>
                </div>`;
            });
            html += '</div>';
        }

        const body = dialog.querySelector('.dialog-body');
        if (body) body.innerHTML = html;

    } catch (error) {
        console.error('Error loading share links:', error);
        const body = dialog.querySelector('.dialog-body');
        if (body) body.innerHTML = '<p class="text-error">Error loading share links.</p>';
    }
}

async function revokeShareLink(tokenHash, memberId) {
    if (!confirm('Revoke this share link? Anyone with this link will no longer be able to view the billing summary.')) return;

    try {
        await db.collection('shareTokens').doc(tokenHash).update({ revoked: true });
        try {
            await db.collection('publicShares').doc(tokenHash).delete();
        } catch (_) {}
        showShareLinks(memberId);
    } catch (error) {
        console.error('Error revoking share link:', error);
        alert('Error revoking link. Please try again.');
    }
}

// Generate printable invoice (full)
function generateInvoice() {
    const summary = calculateAnnualSummary();

    if (familyMembers.length === 0 || bills.length === 0) {
        alert('Please add family members and bills first');
        return;
    }

    const currentYear = currentBillingYear ? currentBillingYear.label : new Date().getFullYear();
    const invoiceHTML = generateInvoiceHTML(summary, currentYear);

    // Open in new window
    const invoiceWindow = window.open('', '_blank');
    invoiceWindow.document.write(invoiceHTML);
    invoiceWindow.document.close();
}

// ──────────────── Invoice Composer Helpers ────────────────

var _invoiceDialogState = {};

function getInvoiceSummaryContext(memberId) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return null;

    const summary = calculateAnnualSummary();
    const memberData = summary[memberId];
    const linkedMembersData = member.linkedMembers.map(id => summary[id]).filter(d => d);

    let combinedTotal = memberData ? memberData.total : 0;
    linkedMembersData.forEach(d => { combinedTotal += d.total; });

    let payment = getPaymentTotalForMember(memberId);
    member.linkedMembers.forEach(id => { payment += getPaymentTotalForMember(id); });
    const balance = combinedTotal - payment;

    const currentYear = currentBillingYear ? currentBillingYear.label : new Date().getFullYear();
    const firstName = member.name.split(' ')[0];
    const amountStr = balance > 0 ? '$' + balance.toFixed(2) : '$' + combinedTotal.toFixed(2);
    const amountLabel = balance > 0 && payment > 0 ? 'remaining balance' : 'total';
    const numMembers = 1 + member.linkedMembers.length;

    return { member, firstName, combinedTotal, payment, balance, amountStr, amountLabel, currentYear, linkedMembersData, memberData, numMembers };
}

function buildInvoiceSubject(year, member) {
    return 'Annual Billing Summary ' + year + '\u2014' + member.name;
}

function buildInvoiceBody(ctx, variant, shareUrl, channel, templateOverride) {
    const { firstName, amountStr, amountLabel, currentYear } = ctx;
    const isEmail = channel === 'email';
    const configuredMessage = buildConfiguredInvoiceMessage(ctx, templateOverride);

    if (variant === 'text-only') {
        if (isEmail && configuredMessage) {
            return 'Hello ' + firstName + ',\n\n' + configuredMessage;
        }
        const greeting = isEmail ? 'Hello' : 'Hey';
        return greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '. Thanks!';
    }

    if (variant === 'full') {
        return buildFullInvoiceText(ctx, shareUrl, templateOverride);
    }

    if (isEmail && configuredMessage) {
        let msg = 'Hello ' + firstName + ',\n\n' + configuredMessage;
        if (shareUrl) {
            msg += '\n\nView your billing summary:\n' + shareUrl;
        }
        return msg;
    }

    // Default: text-link
    const greeting = isEmail ? 'Hello' : 'Hey';
    let msg = greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '.\n\nThanks!';
    if (shareUrl) {
        msg += '\n\n' + shareUrl;
    }
    return msg;
}

function buildFullInvoiceText(ctx, shareUrl, templateOverride) {
    const { member, firstName, combinedTotal, payment, balance, currentYear, linkedMembersData, memberData, numMembers } = ctx;
    const paymentPerPerson = numMembers > 0 ? payment / numMembers : 0;

    const emailMessage = buildConfiguredInvoiceMessage(ctx, templateOverride);
    let text = 'Hello ' + firstName + ',\n\n' + emailMessage + '\n\n';
    if (shareUrl) {
        text += 'View your billing summary & pay online:\n' + shareUrl + '\n\n';
    }
    text += '======================================\n';
    text += 'ANNUAL BILLING SUMMARY - ' + currentYear + '\n';
    text += '======================================\n\n';
    text += 'Primary: ' + member.name + '\n';

    if (linkedMembersData.length > 0) {
        text += 'Linked Members: ' + linkedMembersData.map(d => d.member.name).join(', ') + '\n';
    }
    text += 'Invoice Date: ' + new Date().toLocaleDateString() + '\n\n';

    if (memberData && memberData.bills.length > 0) {
        text += member.name.toUpperCase() + "'S BILLS:\n";
        text += '='.repeat(80) + '\n';
        text += 'Bill'.padEnd(25) + ' ' + 'Amount'.padEnd(14) + ' ' + 'Split'.padEnd(8) + ' ' + 'Your Share'.padEnd(14) + ' ' + 'Annual' + '\n';
        text += '-'.repeat(80) + '\n';

        let monthlyTotal = 0;
        memberData.bills.forEach(billData => {
            const billName = billData.bill.name.padEnd(25).substring(0, 25);
            const isAnnual = billData.bill.billingFrequency === 'annual';
            const billAmount = isAnnual
                ? ('$' + billData.bill.amount.toFixed(2) + ' / year').padEnd(18)
                : ('$' + billData.bill.amount.toFixed(2) + ' / month').padEnd(18);
            const splitWith = (billData.bill.members.length + ' ppl').padEnd(8);
            const yourShare = ('$' + billData.monthlyShare.toFixed(2) + ' / month').padEnd(18);
            const annual = '$' + billData.annualShare.toFixed(2);
            text += billName + ' ' + billAmount + ' ' + splitWith + ' ' + yourShare + ' ' + annual + '\n';
            monthlyTotal += billData.monthlyShare;
        });

        text += '-'.repeat(80) + '\n';
        text += 'SUBTOTAL: $' + monthlyTotal.toFixed(2) + ' / month = $' + memberData.total.toFixed(2) + ' / year\n';
        text += '='.repeat(80) + '\n\n';
    }

    linkedMembersData.forEach(linkedData => {
        if (linkedData.bills.length > 0) {
            text += linkedData.member.name.toUpperCase() + "'S BILLS:\n";
            text += '='.repeat(80) + '\n';
            text += 'Bill'.padEnd(25) + ' ' + 'Amount'.padEnd(14) + ' ' + 'Split'.padEnd(8) + ' ' + 'Their Share'.padEnd(14) + ' ' + 'Annual' + '\n';
            text += '-'.repeat(80) + '\n';

            let monthlyTotal = 0;
            linkedData.bills.forEach(billData => {
                const billName = billData.bill.name.padEnd(25).substring(0, 25);
                const isAnnual = billData.bill.billingFrequency === 'annual';
                const billAmount = isAnnual
                    ? ('$' + billData.bill.amount.toFixed(2) + ' / year').padEnd(18)
                    : ('$' + billData.bill.amount.toFixed(2) + ' / month').padEnd(18);
                const splitWith = (billData.bill.members.length + ' ppl').padEnd(8);
                const theirShare = ('$' + billData.monthlyShare.toFixed(2) + ' / month').padEnd(18);
                const annual = '$' + billData.annualShare.toFixed(2);
                text += billName + ' ' + billAmount + ' ' + splitWith + ' ' + theirShare + ' ' + annual + '\n';
                monthlyTotal += billData.monthlyShare;
            });

            text += '-'.repeat(80) + '\n';
            text += 'SUBTOTAL: $' + monthlyTotal.toFixed(2) + ' / month = $' + linkedData.total.toFixed(2) + ' / year\n';
            text += '='.repeat(80) + '\n\n';
        }
    });

    text += 'ANNUAL PAYMENT SUMMARY:\n';
    text += '='.repeat(80) + '\n';
    text += '  Combined Annual Total:         $' + combinedTotal.toFixed(2) + '\n';
    if (payment > 0) {
        text += '  Payment Received:              $' + payment.toFixed(2) + '\n';
        text += '  Payment Per Person (' + numMembers + ' members):   $' + paymentPerPerson.toFixed(2) + '\n';
        text += '  Balance Remaining:             $' + balance.toFixed(2) + '\n';
    } else {
        text += '  Payment Received:              $0.00\n';
        text += '  Balance Remaining:             $' + balance.toFixed(2) + '\n';
    }
    text += '='.repeat(80) + '\n';

    const paymentOptionsText = formatPaymentOptionsText();
    if (paymentOptionsText) {
        text += paymentOptionsText;
    }

    text += '\n\nThank you for your prompt payment!\n';
    return text;
}

function buildSmsDeepLink(phone, body) {
    const encodedBody = encodeURIComponent(body);
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const recipient = phone || '';
    if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return 'sms:' + recipient + '&body=' + encodedBody;
    if (/Android/.test(ua)) return 'sms:' + recipient + '?body=' + encodedBody;
    return null;
}

function openSmsComposer(phone, body) {
    const link = buildSmsDeepLink(phone, body);
    if (link) {
        window.location.href = link;
    } else {
        navigator.clipboard.writeText(body).then(function() {
            showChangeToast('Message copied\u2014paste into your messaging app');
        });
    }
}

function updateInvoiceVariant(variant, channel) {
    const state = _invoiceDialogState;
    if (!state.ctx) return;
    state.variant = variant;
    const body = buildInvoiceBody(state.ctx, variant, state.shareUrl, channel);
    const textareaId = channel === 'email' ? 'emailInvoiceMessage' : 'textInvoiceMessage';
    const textarea = document.getElementById(textareaId);
    if (textarea) textarea.value = body;
}

// ──────────────── Invoice Dialogs ────────────────

// Opens the mail client with subject/body from the Email Invoice dialog
function sendIndividualInvoice(memberId) {
    const ctx = getInvoiceSummaryContext(memberId);
    if (!ctx || !ctx.member.email) return;

    const subjectInput = document.getElementById('emailInvoiceSubject');
    const bodyTextarea = document.getElementById('emailInvoiceMessage');
    if (!subjectInput || !bodyTextarea) return;

    const subject = subjectInput.value;
    const body = bodyTextarea.value;
    const mailtoLink = `mailto:${ctx.member.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;

    if (analytics) {
        analytics.logEvent('invoice_sent', {
            has_linked_members: ctx.linkedMembersData.length > 0,
            num_linked_members: ctx.linkedMembersData.length,
            total_amount: ctx.combinedTotal,
            has_payment: ctx.payment > 0
        });
    }
}

async function showTextInvoiceDialog(memberId, shareUrl) {
    const ctx = getInvoiceSummaryContext(memberId);
    if (!ctx) return;

    if (!shareUrl) shareUrl = '';
    const defaultVariant = shareUrl ? 'text-link' : 'text-only';
    const defaultMsg = buildInvoiceBody(ctx, defaultVariant, shareUrl, 'sms');

    _invoiceDialogState = { ctx: ctx, shareUrl: shareUrl, memberId: memberId, variant: defaultVariant };

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    let shareLinkHtml;
    if (shareUrl) {
        shareLinkHtml = `<div class="text-invoice-stat"><span class="label">Share Link</span><span class="value text-invoice-link">${escapeHtml(shareUrl)}</span></div>`;
    } else {
        shareLinkHtml = `<div class="text-invoice-stat" id="textInvoiceShareRow"><span class="label">Share Link</span><span class="value text-muted">None—<a href="#" id="textInvoiceGenerateLink" data-member-id="${memberId}">generate one</a></span></div>`;
    }

    const variants = [
        { value: 'text-only', label: 'Text only' },
        { value: 'text-link', label: 'Text + link' },
    ];
    let variantHtml = '<div class="invoice-variant-selector">';
    variants.forEach(opt => {
        const checked = opt.value === defaultVariant ? ' checked' : '';
        variantHtml += `<label class="invoice-variant-option${opt.value === defaultVariant ? ' active' : ''}"><input type="radio" name="textInvoiceVariant" value="${opt.value}"${checked} onchange="updateInvoiceVariant('${opt.value}', 'sms'); this.closest('.invoice-variant-selector').querySelectorAll('.invoice-variant-option').forEach(l => l.classList.remove('active')); this.closest('.invoice-variant-option').classList.add('active');">${escapeHtml(opt.label)}</label>`;
    });
    variantHtml += '</div>';

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Text Invoice: ${escapeHtml(ctx.member.name)}</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <div class="text-invoice-summary">
                <div class="text-invoice-stat"><span class="label">Recipient</span><span class="value">${escapeHtml(ctx.member.name)}</span></div>
                <div class="text-invoice-stat"><span class="label">Annual Total</span><span class="value">$${ctx.combinedTotal.toFixed(2)}</span></div>
                ${ctx.payment > 0 ? `<div class="text-invoice-stat"><span class="label">Balance</span><span class="value">$${ctx.balance.toFixed(2)}</span></div>` : ''}
                ${shareLinkHtml}
            </div>
            <div class="form-group mt-3">
                <label>Message format</label>
                ${variantHtml}
            </div>
            <div class="form-group mt-3">
                <label for="textInvoiceMessage">Message</label>
                <textarea id="textInvoiceMessage" rows="5" style="width:100%;font-size:0.95rem;">${escapeHtml(defaultMsg)}</textarea>
            </div>
        </div>
        <div class="dialog-footer" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="copyTextInvoiceMessage()">Copy Message</button>
            ${shareUrl ? `<button class="btn btn-secondary" onclick="copyTextInvoiceLink('${escapeHtml(shareUrl)}')">Copy Link</button>` : ''}
            <button class="btn btn-secondary" onclick="openSmsComposer('${escapeHtml(ctx.member.phone || '')}', document.getElementById('textInvoiceMessage').value)">Open Messages</button>
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>
        </div>
    `;
    overlay.classList.add('visible');

    const genLink = document.getElementById('textInvoiceGenerateLink');
    if (genLink) {
        genLink.addEventListener('click', function(e) {
            e.preventDefault();
            generateShareLinkForInvoiceDialog(memberId, showTextInvoiceDialog);
        });
    }
}

async function generateShareLinkForInvoiceDialog(memberId, dialogFn) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member || !currentUser || !currentBillingYear) return;

    const yearLabel = currentBillingYear.label;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    window._invoiceDialogFn = dialogFn;
    window._invoiceDialogMemberId = memberId;

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Generate Share Link</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <p>Create a shareable link for <strong>${escapeHtml(member.name)}</strong> to view their ${escapeHtml(yearLabel)} billing summary.</p>
            <div class="form-group mt-3">
                <label for="shareLinkExpiry">Link Expiry (optional)</label>
                <select id="shareLinkExpiry">
                    <option value="">No expiry</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                </select>
            </div>
            <div class="form-group mt-2">
                <label class="checkbox-label">
                    <input type="checkbox" id="shareLinkDisputes" />
                    Allow member to request bill reviews
                </label>
                <p class="text-help">
                    Adds <code>disputes:create</code> scope so the member can flag bill line items for review.
                </p>
            </div>
            <div class="form-group mt-2">
                <label class="checkbox-label">
                    <input type="checkbox" id="shareLinkDisputesRead" />
                    Allow member to view review requests &amp; evidence
                </label>
                <p class="text-help">
                    Adds <code>disputes:read</code> scope so the member can see their disputes, evidence, and approve/reject resolutions.
                </p>
            </div>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-tertiary" onclick="closePaymentDialog()">Cancel</button>
            <button class="btn btn-primary" id="generateShareBtn" onclick="doGenerateShareLinkForInvoice()">Generate &amp; Copy Link</button>
        </div>
    `;

    overlay.classList.add('visible');
}

async function doGenerateShareLinkForInvoice() {
    const memberId = window._invoiceDialogMemberId;
    const dialogFn = window._invoiceDialogFn;
    const member = familyMembers.find(m => m.id === memberId);
    if (!member || !currentUser || !currentBillingYear) return;

    const btn = document.getElementById('generateShareBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    try {
        const rawToken = generateRawToken();
        const tokenHash = await hashToken(rawToken);

        const expirySelect = document.getElementById('shareLinkExpiry');
        const expiryDays = expirySelect ? parseInt(expirySelect.value) : 0;
        let expiresAt = null;
        if (expiryDays > 0) {
            const d = new Date();
            d.setDate(d.getDate() + expiryDays);
            expiresAt = d;
        }

        const disputeCheckbox = document.getElementById('shareLinkDisputes');
        const disputeReadCheckbox = document.getElementById('shareLinkDisputesRead');
        const scopes = ['summary:read', 'paymentMethods:read'];
        if (disputeCheckbox && disputeCheckbox.checked) {
            scopes.push('disputes:create');
        }
        if (disputeReadCheckbox && disputeReadCheckbox.checked) {
            scopes.push('disputes:read');
        }

        const tokenDoc = {
            ownerId: currentUser.uid,
            memberId: memberId,
            billingYearId: currentBillingYear.id,
            scopes: scopes,
            revoked: false,
            expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
            createdAt: FieldValue.serverTimestamp(),
            lastAccessedAt: null,
            accessCount: 0,
            memberName: member.name
        };

        await db.collection('shareTokens').doc(tokenHash).set(tokenDoc);

        const publicData = buildPublicShareData(memberId, scopes);
        if (publicData) {
            await db.collection('publicShares').doc(tokenHash).set(publicData);
        }

        const shareUrl = window.location.origin + '/share?token=' + rawToken;

        if (analytics) {
            analytics.logEvent('share_link_generated', {
                has_expiry: !!expiresAt,
                billing_year: currentBillingYear.label,
                source: 'invoice_dialog'
            });
        }

        dialogFn(memberId, shareUrl);
    } catch (error) {
        console.error('Error generating share link for invoice:', error);
        if (btn) { btn.disabled = false; btn.textContent = 'Generate & Copy Link'; }
        alert('Error generating share link. Please try again.');
    }
}

function copyTextInvoiceMessage() {
    const textarea = document.getElementById('textInvoiceMessage');
    if (!textarea) return;
    navigator.clipboard.writeText(textarea.value).then(function() {
        showChangeToast('Message copied to clipboard');
    });
}

function copyTextInvoiceLink(url) {
    navigator.clipboard.writeText(url).then(function() {
        showChangeToast('Share link copied to clipboard');
    });
}

async function showEmailInvoiceDialog(memberId, shareUrl) {
    const ctx = getInvoiceSummaryContext(memberId);
    if (!ctx) return;

    if (!ctx.member.email) {
        alert(ctx.member.name + ' does not have an email address set. Please add one first.');
        return;
    }

    if (ctx.combinedTotal === 0) {
        alert(ctx.member.name + ' has no bills to invoice.');
        return;
    }

    if (!shareUrl) shareUrl = '';
    const defaultVariant = shareUrl ? 'text-link' : 'text-only';
    const defaultBody = buildInvoiceBody(ctx, defaultVariant, shareUrl, 'email');
    const defaultSubject = buildInvoiceSubject(ctx.currentYear, ctx.member);

    _invoiceDialogState = { ctx: ctx, shareUrl: shareUrl, memberId: memberId, variant: defaultVariant };

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    let shareLinkHtml;
    if (shareUrl) {
        shareLinkHtml = `<div class="text-invoice-stat"><span class="label">Share Link</span><span class="value text-invoice-link">${escapeHtml(shareUrl)}</span></div>`;
    } else {
        shareLinkHtml = `<div class="text-invoice-stat" id="emailInvoiceShareRow"><span class="label">Share Link</span><span class="value text-muted">None—<a href="#" id="emailInvoiceGenerateLink" data-member-id="${memberId}">generate one</a></span></div>`;
    }

    const variants = [
        { value: 'text-only', label: 'Text only' },
        { value: 'text-link', label: 'Text + link' },
        { value: 'full', label: 'Full invoice' },
    ];
    let variantHtml = '<div class="invoice-variant-selector">';
    variants.forEach(opt => {
        const checked = opt.value === defaultVariant ? ' checked' : '';
        variantHtml += `<label class="invoice-variant-option${opt.value === defaultVariant ? ' active' : ''}"><input type="radio" name="emailInvoiceVariant" value="${opt.value}"${checked} onchange="updateInvoiceVariant('${opt.value}', 'email'); this.closest('.invoice-variant-selector').querySelectorAll('.invoice-variant-option').forEach(l => l.classList.remove('active')); this.closest('.invoice-variant-option').classList.add('active');">${escapeHtml(opt.label)}</label>`;
    });
    variantHtml += '</div>';

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Email Invoice: ${escapeHtml(ctx.member.name)}</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <div class="text-invoice-summary">
                <div class="text-invoice-stat"><span class="label">Recipient</span><span class="value">${escapeHtml(ctx.member.name)}</span></div>
                <div class="text-invoice-stat"><span class="label">Email</span><span class="value">${escapeHtml(ctx.member.email)}</span></div>
                <div class="text-invoice-stat"><span class="label">Annual Total</span><span class="value">$${ctx.combinedTotal.toFixed(2)}</span></div>
                ${ctx.payment > 0 ? `<div class="text-invoice-stat"><span class="label">Balance</span><span class="value">$${ctx.balance.toFixed(2)}</span></div>` : ''}
                ${shareLinkHtml}
            </div>
            <div class="form-group mt-3">
                <label>Message format</label>
                ${variantHtml}
            </div>
            <div class="form-group mt-3">
                <label for="emailInvoiceSubject">Subject</label>
                <input type="text" id="emailInvoiceSubject" class="invoice-subject-input" value="${escapeHtml(defaultSubject)}">
            </div>
            <div class="form-group mt-3">
                <label for="emailInvoiceMessage">Body</label>
                <textarea id="emailInvoiceMessage" rows="8" style="width:100%;font-size:0.95rem;">${escapeHtml(defaultBody)}</textarea>
            </div>
        </div>
        <div class="dialog-footer" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="copyEmailInvoiceMessage()">Copy Email</button>
            <button class="btn btn-secondary" onclick="sendIndividualInvoice(${memberId})">Open Mail App</button>
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>
        </div>
    `;
    overlay.classList.add('visible');

    const genLink = document.getElementById('emailInvoiceGenerateLink');
    if (genLink) {
        genLink.addEventListener('click', function(e) {
            e.preventDefault();
            generateShareLinkForInvoiceDialog(memberId, showEmailInvoiceDialog);
        });
    }
}

function copyEmailInvoiceMessage() {
    const textarea = document.getElementById('emailInvoiceMessage');
    if (!textarea) return;
    navigator.clipboard.writeText(textarea.value).then(function() {
        showChangeToast('Email body copied to clipboard');
    });
}

function generateInvoiceHTML(summary, currentYear) {
    let totalAnnual = 0;
    Object.values(summary).forEach(data => {
        totalAnnual += data.total;
    });

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Annual Billing Summary - ${currentYear}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 40px auto;
                    padding: 20px;
                }
                h1 {
                    color: #1F2430;
                    border-bottom: 3px solid #6E78D6;
                    padding-bottom: 10px;
                }
                h2 {
                    color: #5B6475;
                    margin-top: 30px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 20px 0;
                }
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #ddd;
                }
                th {
                    background: #F7F8FB;
                    font-weight: bold;
                }
                .total-row {
                    font-weight: bold;
                    background: #E6E8EE;
                    font-size: 1.1em;
                }
                .member-section {
                    page-break-inside: avoid;
                    margin-bottom: 40px;
                }
                .avatar {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    object-fit: cover;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                .avatar-initials {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: #6E78D6;
                    color: white;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    font-weight: bold;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                .logo {
                    width: 40px;
                    height: 30px;
                    object-fit: contain;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                .logo-text {
                    display: inline-block;
                    padding: 4px 8px;
                    background: #E6E8EE;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    color: #1F2430;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                @media print {
                    .no-print {
                        display: none;
                    }
                }
            </style>
        </head>
        <body>
            <h1>Annual Billing Summary - ${currentYear}</h1>
            <p>Billing Year: ${currentYear} &middot; Generated on: ${new Date().toLocaleDateString()}</p>

            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; background: #6E78D6; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 20px 0;">Print Summary</button>

            <h2>Annual Summary</h2>
            <table>
                <thead>
                    <tr>
                        <th>Family Member</th>
                        <th>Monthly Total</th>
                        <th>Annual Total</th>
                    </tr>
                </thead>
                <tbody>
    `;

    Object.values(summary).forEach(data => {
        const safeName = escapeHtml(data.member.name);
        const safeAvatarSrc = sanitizeImageSrc(data.member.avatar);
        const avatarHTML = safeAvatarSrc
            ? `<img src="${safeAvatarSrc}" class="avatar" alt="${safeName}" />`
            : `<div class="avatar-initials">${escapeHtml(getInitials(data.member.name))}</div>`;

        html += `
                    <tr>
                        <td>${avatarHTML}${safeName}</td>
                        <td>$${(data.total / 12).toFixed(2)}</td>
                        <td><strong>$${data.total.toFixed(2)}</strong></td>
                    </tr>
        `;
    });

    html += `
                    <tr class="total-row">
                        <td>TOTAL</td>
                        <td>$${(totalAnnual / 12).toFixed(2)}</td>
                        <td><strong>$${totalAnnual.toFixed(2)}</strong></td>
                    </tr>
                </tbody>
            </table>
    `;

    Object.values(summary).forEach(data => {
        if (data.total === 0) return;

        const safeName = escapeHtml(data.member.name);
        const safeAvatarSrc = sanitizeImageSrc(data.member.avatar);
        const avatarHTML = safeAvatarSrc
            ? `<img src="${safeAvatarSrc}" class="avatar" alt="${safeName}" />`
            : `<div class="avatar-initials">${escapeHtml(getInitials(data.member.name))}</div>`;

        html += `
            <div class="member-section">
                <h2>${avatarHTML}${safeName}'s Bill Breakdown</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Bill</th>
                            <th>Bill Amount</th>
                            <th>Split With</th>
                            <th>Your Monthly Share</th>
                            <th>Annual Total</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.bills.forEach(billData => {
            const safeBillName = escapeHtml(billData.bill.name);
            const safeLogoSrc = sanitizeImageSrc(billData.bill.logo);
            const logoHTML = safeLogoSrc
                ? `<img src="${safeLogoSrc}" class="logo" alt="${safeBillName}" />`
                : `<div class="logo-text">${safeBillName}</div>`;
            const isAnnual = billData.bill.billingFrequency === 'annual';
            const billAmountDisplay = `$${billData.bill.amount.toFixed(2)}${isAnnual ? ' / year' : ' / month'}`;

            html += `
                        <tr>
                            <td>${logoHTML}${safeBillName}</td>
                            <td>${billAmountDisplay}</td>
                            <td>${billData.bill.members.length} members</td>
                            <td>$${billData.monthlyShare.toFixed(2)}</td>
                            <td>$${billData.annualShare.toFixed(2)}</td>
                        </tr>
            `;
        });

        html += `
                        <tr class="total-row">
                            <td colspan="3">TOTAL</td>
                            <td>$${(data.total / 12).toFixed(2)}</td>
                            <td><strong>$${data.total.toFixed(2)}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    });

    html += formatPaymentOptionsHTML();

    html += `
        </body>
        </html>
    `;

    return html;
}

// ──────────────── Payment Ledger Functions ─────────────────────

function generateUniquePaymentId() {
    return 'pay_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

function getPaymentTotalForMember(memberId) {
    return payments
        .filter(p => p.memberId === memberId)
        .reduce((sum, p) => sum + p.amount, 0);
}

function getMemberPayments(memberId) {
    return payments
        .filter(p => p.memberId === memberId)
        .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

function migratePaymentReceivedToLedger() {
    if (payments.length > 0) return;

    let migrated = false;

    familyMembers.forEach(member => {
        if (!member.paymentReceived || member.paymentReceived <= 0) return;

        if (isLinkedToAnyone(member.id)) {
            payments.push({
                id: generateUniquePaymentId(),
                memberId: member.id,
                amount: member.paymentReceived,
                receivedAt: new Date().toISOString(),
                note: 'Migrated from legacy payment record',
                method: 'other'
            });
            member.paymentReceived = 0;
            migrated = true;
        } else if (member.linkedMembers && member.linkedMembers.length > 0) {
            let childTotal = 0;
            member.linkedMembers.forEach(childId => {
                const child = familyMembers.find(m => m.id === childId);
                if (child) childTotal += (child.paymentReceived || 0);
            });
            const parentShare = member.paymentReceived - childTotal;
            if (parentShare > 0) {
                payments.push({
                    id: generateUniquePaymentId(),
                    memberId: member.id,
                    amount: parentShare,
                    receivedAt: new Date().toISOString(),
                    note: 'Migrated from legacy payment record',
                    method: 'other'
                });
            }
            member.paymentReceived = 0;
            migrated = true;
        } else {
            payments.push({
                id: generateUniquePaymentId(),
                memberId: member.id,
                amount: member.paymentReceived,
                receivedAt: new Date().toISOString(),
                note: 'Migrated from legacy payment record',
                method: 'other'
            });
            member.paymentReceived = 0;
            migrated = true;
        }
    });

    if (migrated) {
        saveData();
    }
}

// ──────────────── Payment Dialog UI ───────────────────────────

function ensureDialogContainer() {
    if (!document.getElementById('payment-dialog-overlay')) {
        if (typeof document.body === 'undefined' || !document.body) return;
        var overlay = document.createElement('div');
        overlay.id = 'payment-dialog-overlay';
        overlay.className = 'dialog-overlay';
        overlay.onclick = function(e) {
            if (e.target === overlay) closePaymentDialog();
        };
        var dialog = document.createElement('div');
        dialog.id = 'payment-dialog';
        dialog.className = 'dialog';
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }
}

function showConfirmationDialog(title, message, confirmLabel, onConfirm, destructive) {
    // Test hook: auto-confirm when flag is set
    if (_testAutoConfirmDialogs) {
        onConfirm();
        return;
    }
    var overlayId = 'confirmation-dialog-overlay';
    var overlay = document.getElementById(overlayId);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.className = 'dialog-overlay';
        overlay.onclick = function(e) {
            if (e.target === overlay) closeConfirmationDialog();
        };
        var dialog = document.createElement('div');
        dialog.id = 'confirmation-dialog';
        dialog.className = 'dialog confirmation-dialog';
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }
    var dialog = document.getElementById('confirmation-dialog');
    dialog.innerHTML =
        '<div class="dialog-header"><h3>' + escapeHtml(title) + '</h3></div>'
        + '<div class="dialog-body"><p class="confirmation-message">' + escapeHtml(message) + '</p></div>'
        + '<div class="dialog-footer">'
        + '<button class="btn btn-secondary" onclick="closeConfirmationDialog()">Cancel</button>'
        + '<button class="btn ' + (destructive ? 'btn-destructive' : 'btn-primary') + '" id="confirmation-confirm-btn">' + escapeHtml(confirmLabel) + '</button>'
        + '</div>';
    var confirmBtn = document.getElementById('confirmation-confirm-btn');
    confirmBtn.onclick = function() {
        closeConfirmationDialog();
        onConfirm();
    };
    overlay.classList.add('visible');
}

function closeConfirmationDialog() {
    var overlay = document.getElementById('confirmation-dialog-overlay');
    if (overlay) overlay.classList.remove('visible');
}

function showAddPaymentDialog(memberId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    const hasLinked = member.linkedMembers && member.linkedMembers.length > 0;

    let distributeSection = '';
    if (hasLinked) {
        const summary = calculateAnnualSummary();
        let totalOwed = summary[member.id] ? summary[member.id].total : 0;
        const linkedInfo = member.linkedMembers.map(id => {
            const m = familyMembers.find(fm => fm.id === id);
            const owed = summary[id] ? summary[id].total : 0;
            totalOwed += owed;
            return { name: m ? m.name : 'Unknown', owed: owed };
        });
        const parentOwed = summary[member.id] ? summary[member.id].total : 0;

        distributeSection = `
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="distributePayment" checked onchange="toggleDistributePreview(); updatePaymentPreview(${member.id});" />
                    Distribute proportionally to linked members
                </label>
                <div id="distributePreview" class="distribute-preview">
                    <small>Based on annual totals (combined: $${totalOwed.toFixed(2)}):</small>
                    <ul>
                        <li>${escapeHtml(member.name)}: $${parentOwed.toFixed(2)} owed (${totalOwed > 0 ? ((parentOwed / totalOwed) * 100).toFixed(0) : 0}%)</li>
                        ${linkedInfo.map(l => '<li>' + escapeHtml(l.name) + ': $' + l.owed.toFixed(2) + ' owed (' + (totalOwed > 0 ? ((l.owed / totalOwed) * 100).toFixed(0) : 0) + '%)</li>').join('')}
                    </ul>
                </div>
            </div>
        `;
    }

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>Record Annual Payment</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <p>For: <strong>${escapeHtml(member.name)}</strong></p>
            <p class="text-muted" style="margin-bottom: 14px;">Payments apply toward this billing year's balance.</p>
            <div class="form-group">
                <label for="paymentAmount">Amount ($)</label>
                <input type="number" id="paymentAmount" step="0.01" min="0.01" placeholder="0.00" oninput="updatePaymentPreview(${member.id})" />
            </div>
            <div class="form-group">
                <label for="paymentMethod">Method</label>
                <select id="paymentMethod" onchange="updatePaymentPreview(${member.id})">
                    <option value="cash">\u{1F4B5} Cash</option>
                    <option value="check">\u{1F4DD} Check</option>
                    <option value="venmo">\u{1F4F1} Venmo</option>
                    <option value="zelle">\u{1F4F2} Zelle</option>
                    <option value="paypal">\u{1F17F}\uFE0F PayPal</option>
                    <option value="cashapp">\u{1F7E9} Cash App</option>
                    <option value="apple_cash">\u{1F34E} Apple Cash</option>
                    <option value="bank_transfer">\u{1F3E6} Bank Transfer</option>
                    <option value="other">\u{2709}\uFE0F Other</option>
                </select>
            </div>
            ${distributeSection}
            <div class="form-group">
                <label for="paymentNote">Note (optional)</label>
                <input type="text" id="paymentNote" placeholder="e.g., Q1 payment" />
            </div>
            <div id="paymentPreview" class="payment-preview"></div>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-tertiary" onclick="closePaymentDialog()">Cancel</button>
            <button class="btn btn-primary" onclick="submitPayment(${member.id})">Save Payment</button>
        </div>
    `;

    overlay.classList.add('visible');
    var amountInput = document.getElementById('paymentAmount');
    if (amountInput && amountInput.focus) amountInput.focus();
}

function updatePaymentPreview(memberId) {
    var previewEl = document.getElementById('paymentPreview');
    if (!previewEl) return;

    var amountEl = document.getElementById('paymentAmount');
    var methodEl = document.getElementById('paymentMethod');
    var distributeEl = document.getElementById('distributePayment');

    var amount = parseFloat(amountEl ? amountEl.value : '');
    if (!amount || amount <= 0) {
        previewEl.innerHTML = '';
        return;
    }

    var method = methodEl ? methodEl.value : 'other';
    var methodLabel = getPaymentMethodLabel(method);
    var distribute = distributeEl ? distributeEl.checked : false;

    var member = familyMembers.find(function(m) { return m.id === memberId; });
    if (!member) return;

    var html = '<div class="payment-preview-header">You are recording:</div>';
    html += '<div class="payment-preview-amount">$' + amount.toFixed(2) + ' via ' + escapeHtml(methodLabel) + '</div>';

    var hasLinked = member.linkedMembers && member.linkedMembers.length > 0;
    if (hasLinked && distribute) {
        var summary = calculateAnnualSummary();
        var parentTotal = summary[member.id] ? summary[member.id].total : 0;
        var combinedTotal = parentTotal;
        var linkedItems = [];

        member.linkedMembers.forEach(function(id) {
            var lm = familyMembers.find(function(fm) { return fm.id === id; });
            var owed = summary[id] ? summary[id].total : 0;
            combinedTotal += owed;
            linkedItems.push({ name: lm ? lm.name : 'Unknown', owed: owed });
        });

        html += '<div class="payment-preview-dist-label">Distribution:</div><ul class="payment-preview-dist">';
        if (combinedTotal > 0) {
            var parentShare = Math.round((amount * (parentTotal / combinedTotal)) * 100) / 100;
            html += '<li>' + escapeHtml(member.name) + '—$' + parentShare.toFixed(2) + '</li>';
            var allocated = parentShare;
            linkedItems.forEach(function(item, i) {
                var share;
                if (i === linkedItems.length - 1) {
                    share = Math.round((amount - allocated) * 100) / 100;
                } else {
                    share = Math.round((amount * (item.owed / combinedTotal)) * 100) / 100;
                    allocated += share;
                }
                html += '<li>' + escapeHtml(item.name) + '—$' + share.toFixed(2) + '</li>';
            });
        }
        html += '</ul>';
    }

    previewEl.innerHTML = html;
}

function toggleDistributePreview() {
    var preview = document.getElementById('distributePreview');
    var checkbox = document.getElementById('distributePayment');
    if (preview) {
        preview.style.display = checkbox && checkbox.checked ? 'block' : 'none';
    }
}

function submitPayment(memberId) {
    var amountEl = document.getElementById('paymentAmount');
    var methodEl = document.getElementById('paymentMethod');
    var noteEl = document.getElementById('paymentNote');
    var distributeEl = document.getElementById('distributePayment');

    var amount = parseFloat(amountEl ? amountEl.value : '');
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount greater than zero.');
        return;
    }

    var method = methodEl ? methodEl.value : 'other';
    var note = noteEl ? noteEl.value.trim() : '';
    var distribute = distributeEl ? distributeEl.checked : false;

    recordPayment(memberId, amount, method, note, distribute);

    var dialog = document.getElementById('payment-dialog');
    if (dialog) {
        var metrics = calculateSettlementMetrics();
        dialog.innerHTML =
            '<div class="payment-confirmation">'
            + '<div class="payment-confirmation-icon">&#10003;</div>'
            + '<div class="payment-confirmation-text">Payment recorded successfully.</div>'
            + '<div class="payment-confirmation-progress-label">Settlement Progress: ' + metrics.percentage + '% Complete</div>'
            + '<div class="settlement-progress"><div class="settlement-progress-bar" style="width:' + metrics.percentage + '%"></div></div>'
            + '</div>';
        setTimeout(function() { closePaymentDialog(); }, 2000);
    } else {
        closePaymentDialog();
    }
}

function closePaymentDialog() {
    var overlay = document.getElementById('payment-dialog-overlay');
    if (overlay && overlay.classList) overlay.classList.remove('visible');
}

function showPaymentHistory(memberId) {
    var member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    ensureDialogContainer();
    var overlay = document.getElementById('payment-dialog-overlay');
    var dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    var memberPayments = getMemberPayments(memberId);
    var total = getPaymentTotalForMember(memberId);
    var archived = isYearReadOnly();

    var paymentRows = memberPayments.length > 0
        ? memberPayments.map(function(p) {
            var date = new Date(p.receivedAt).toLocaleDateString();
            var methodLabel = getPaymentMethodLabel(p.method);
            var isReversed = p.reversed === true;
            var isReversal = p.type === 'reversal';
            var itemClass = 'payment-history-item';
            if (isReversed) itemClass += ' payment-reversed';
            if (isReversal) itemClass += ' payment-reversal';
            var amountDisplay = isReversal
                ? '-$' + Math.abs(p.amount).toFixed(2)
                : '$' + p.amount.toFixed(2);
            var statusTag = '';
            if (isReversed) statusTag = '<span class="payment-status-tag reversed">Reversed</span>';
            if (isReversal) statusTag = '<span class="payment-status-tag reversal">Reversal</span>';
            var canReverse = !archived && !isReversed && !isReversal;
            return '<div class="' + itemClass + '">'
                + '<div class="payment-history-details">'
                + '<span class="payment-history-date">' + escapeHtml(date) + '</span>'
                + '<span class="payment-history-amount">' + amountDisplay + '</span>'
                + '<span class="payment-history-method">' + escapeHtml(methodLabel) + '</span>'
                + statusTag
                + '</div>'
                + (p.note ? '<div class="payment-history-note">' + escapeHtml(p.note) + '</div>' : '')
                + (canReverse ? '<button class="btn-icon remove" onclick="deletePaymentEntry(\'' + escapeHtml(p.id) + '\', ' + memberId + ')" title="Reverse payment">&times;</button>' : '')
                + '</div>';
        }).join('')
        : '<p class="empty-state-compact">No payments recorded</p>';

    var summaryData = calculateAnnualSummary();
    var memberAnnual = summaryData[memberId] ? summaryData[memberId].total : 0;
    var remainingBalance = Math.max(0, memberAnnual - total);

    dialog.innerHTML = '<div class="dialog-header">'
        + '<h3>Payment History: ' + escapeHtml(member.name) + '</h3>'
        + '<button class="dialog-close" onclick="closePaymentDialog()">&times;</button>'
        + '</div>'
        + '<div class="dialog-body">'
        + '<div class="payment-history-summary">'
        + '<div class="payment-history-total">Total Paid: <strong>$' + total.toFixed(2) + '</strong></div>'
        + '<div class="payment-history-remaining">Remaining Balance: <strong class="' + (remainingBalance > 0 ? 'balance-owed' : 'balance-paid') + '">$' + remainingBalance.toFixed(2) + '</strong></div>'
        + '</div>'
        + '<div class="payment-history-list payment-timeline">' + paymentRows + '</div>'
        + '</div>'
        + '<div class="dialog-footer">'
        + '<button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>'
        + '</div>';

    overlay.classList.add('visible');
}

function deletePaymentEntry(paymentId, memberId) {
    if (isYearReadOnly()) { alert(yearReadOnlyMessage()); return; }
    if (!confirm('Reverse this payment? A reversal entry will be created to maintain the audit trail.')) return;

    var original = payments.find(function(p) { return p.id === paymentId; });
    if (!original) return;

    original.reversed = true;

    var reversalEntry = {
        id: generateUniquePaymentId(),
        memberId: original.memberId,
        amount: -original.amount,
        receivedAt: new Date().toISOString(),
        note: 'Reversal of $' + original.amount.toFixed(2) + ' payment on ' + new Date(original.receivedAt).toLocaleDateString(),
        method: original.method || 'other',
        type: 'reversal',
        reversesPaymentId: paymentId
    };
    payments.push(reversalEntry);

    emitBillingEvent('PAYMENT_REVERSED', {
        paymentId: paymentId,
        reversalId: reversalEntry.id,
        memberId: original.memberId,
        memberName: (familyMembers.find(function(m) { return m.id === original.memberId; }) || {}).name || '',
        originalAmount: original.amount,
        method: original.method || 'other'
    });

    saveData();
    showPaymentHistory(memberId);
    updateSummary();
    showChangeToast('Payment reversed. Audit trail preserved. Balances recalculated.');
}

// ---------------------------------------------------------------------------
// Test helpers — expose internal state for the VM-based test harness
// ---------------------------------------------------------------------------
function _set(key, val) {
    switch(key) {
        case 'familyMembers': familyMembers = val; break;
        case 'bills': bills = val; break;
        case 'payments': payments = val; break;
        case 'billingEvents': billingEvents = val; break;
        case 'settings': settings = val; break;
        case 'currentUser': currentUser = val; break;
        case 'currentBillingYear': currentBillingYear = val; break;
        case 'billingYears': billingYears = val; break;
        case '_loadedDisputes': _loadedDisputes = val; break;
        case '_disputeStatusFilter': _disputeStatusFilter = val; break;
        case '_invoiceDialogState': _invoiceDialogState = val; break;
        case '_activeWorkspaceTab': _activeWorkspaceTab = val; break;
        case '_summaryFilter': _summaryFilter = val; break;
        case '_expandedSettlementIds': _expandedSettlementIds = val; break;
        case '_testAutoConfirmDialogs': _testAutoConfirmDialogs = val; break;
        case '_memberComposerOpen': _memberComposerOpen = val; break;
        case '_billComposerOpen': _billComposerOpen = val; break;
    }
}
function _get(key) {
    switch(key) {
        case 'familyMembers': return familyMembers;
        case 'bills': return bills;
        case 'payments': return payments;
        case 'billingEvents': return billingEvents;
        case 'settings': return settings;
        case 'currentUser': return currentUser;
        case 'currentBillingYear': return currentBillingYear;
        case 'billingYears': return billingYears;
        case '_loadedDisputes': return _loadedDisputes;
        case '_disputeStatusFilter': return _disputeStatusFilter;
        case '_invoiceDialogState': return _invoiceDialogState;
        case '_activeWorkspaceTab': return _activeWorkspaceTab;
        case '_summaryFilter': return _summaryFilter;
        case '_expandedSettlementIds': return _expandedSettlementIds;
        case '_memberComposerOpen': return _memberComposerOpen;
        case '_billComposerOpen': return _billComposerOpen;
        case 'EVIDENCE_MAX_SIZE': return EVIDENCE_MAX_SIZE;
        case 'EVIDENCE_MAX_COUNT': return EVIDENCE_MAX_COUNT;
        case 'EVIDENCE_ALLOWED_TYPES': return EVIDENCE_ALLOWED_TYPES;
        case 'DISPUTE_STATUS_LABELS': return DISPUTE_STATUS_LABELS;
        case 'BILLING_YEAR_STATUSES': return BILLING_YEAR_STATUSES;
        case 'PAYMENT_METHOD_TYPES': return PAYMENT_METHOD_TYPES;
        case 'BILLING_EVENT_LABELS': return BILLING_EVENT_LABELS;
        case 'CURRENT_MIGRATION_VERSION': return CURRENT_MIGRATION_VERSION;
    }
}

// ---------------------------------------------------------------------------
// Barrel export — every public function, constant, and test helper
// ---------------------------------------------------------------------------
export {
    // Constants
    CURRENT_MIGRATION_VERSION,
    PAYMENT_METHOD_LABELS,
    BILLING_YEAR_STATUSES,
    BILLING_EVENT_LABELS,
    PAYMENT_METHOD_ICONS,
    PAYMENT_METHOD_TYPES,
    DISPUTE_STATUS_LABELS,
    EVIDENCE_MAX_SIZE,
    EVIDENCE_MAX_COUNT,
    EVIDENCE_ALLOWED_TYPES,

    // Version checking
    checkForUpdate,
    showUpdateToast,
    dismissUpdateToast,
    startUpdateChecker,
    showChangeToast,

    // Persistence / data
    loadData,
    debugDataIntegrity,
    repairDuplicateIds,
    cleanupInvalidBillMembers,
    saveData,
    logout,
    migrateLegacyData,

    // Billing year lifecycle
    isArchivedYear,
    isClosedYear,
    isSettlingYear,
    isYearReadOnly,
    yearReadOnlyMessage,
    getBillingYearStatusLabel,
    setBillingYearStatus,
    loadBillingYearsList,
    loadBillingYearData,
    switchBillingYear,
    archiveCurrentYear,
    startNewYear,
    closeCurrentYear,
    confirmStartSettlement,
    confirmBackToOpen,
    confirmCloseYear,
    confirmArchiveYear,
    confirmReopenToSettling,
    confirmStartNewYear,
    showConfirmationDialog,
    closeConfirmationDialog,
    renderBillingYearSelector,
    renderStatusBanner,
    renderArchivedBanner,

    // Utilities
    escapeHtml,
    sanitizeImageSrc,
    isValidE164,
    getInitials,
    generateAvatar,
    generateLogo,
    uploadImage,
    uploadQrCode,
    generateUniqueId,
    generateUniqueBillId,
    getPaymentMethodLabel,

    // Family member management
    addFamilyMember,
    editFamilyMember,
    editMemberEmail,
    editMemberPhone,
    uploadAvatar,
    removeAvatar,
    manageLinkMembers,
    toggleMemberActionsMenu,
    isLinkedToAnyone,
    getParentMember,
    removeFamilyMember,
    renderFamilyMembers,

    // Billing event ledger
    generateEventId,
    emitBillingEvent,
    getBillingEventsForBill,
    getBillingEventsForMember,
    getBillingEventsForPayment,

    // Billing frequency helpers
    getBillAnnualAmount,
    getBillMonthlyAmount,
    getBillFrequencyLabel,
    setAddBillFrequency,
    getAddBillFrequency,
    updateBillAmountPreview,

    // Bill management
    addBill,
    editBillName,
    editBillAmount,
    toggleBillFrequency,
    editBillWebsite,
    showBillAuditHistory,
    uploadLogo,
    removeLogo,
    removeBill,
    toggleMember,
    renderBills,
    toggleBillSplit,
    toggleBillActionsMenu,
    openBillWebsite,

    // Calculations & summary
    calculateAnnualSummary,
    getCalculationBreakdown,
    toggleCalcBreakdown,
    getPaymentStatusBadge,
    calculateSettlementMetrics,
    toggleActionMenu,
    closeAllActionMenus,
    setSummaryFilter,
    toggleSettlementDetail,
    switchWorkspaceTab,
    renderWorkspaceTabs,
    toggleMemberComposer,
    toggleBillComposer,
    updateComposerVisibility,
    updateSummary,
    renderDashboardStatus,

    // Payments
    recordPayment,
    generateUniquePaymentId,
    getPaymentTotalForMember,
    getMemberPayments,
    migratePaymentReceivedToLedger,
    ensureDialogContainer,
    showAddPaymentDialog,
    updatePaymentPreview,
    toggleDistributePreview,
    submitPayment,
    closePaymentDialog,
    showPaymentHistory,
    deletePaymentEntry,

    // Email settings
    detectDuplicatePaymentText,
    renderEmailSettings,
    renderEmailTemplatePreview,
    handleEmailTemplateEditorInput,
    handleEmailTemplateEditorPaste,
    insertEmailTemplateToken,
    saveEmailMessage,

    // Payment methods
    migratePaymentLinksToMethods,
    getPaymentMethodIcon,
    renderPaymentMethodsSettings,
    getPaymentMethodDetail,
    addPaymentMethod,
    editPaymentMethod,
    uploadPaymentMethodQr,
    removePaymentMethodQr,
    savePaymentMethodEdit,
    togglePaymentMethodEnabled,
    removePaymentMethod,
    getEnabledPaymentMethods,
    formatPaymentOptionsHTML,
    formatPaymentOptionsText,

    // Disputes
    normalizeDisputeStatus,
    disputeStatusClass,
    setDisputeFilter,
    loadDisputes,
    renderDisputeFilterBar,
    renderDisputes,
    getDisputeRef,
    updateDispute,
    showDisputeDetail,
    doDisputeAction,
    emailDisputeResolution,
    textDisputeResolution,
    copyDisputeResolution,
    toggleUserReview,
    scrollToBill,
    scrollToMember,
    formatFileSize,
    uploadEvidence,
    viewEvidence,
    showEvidenceModal,
    closeEvidenceModal,
    removeEvidence,

    // Share links
    computeMemberSummaryForShare,
    buildPublicShareData,
    refreshPublicShares,
    hashToken,
    generateRawToken,
    generateShareLink,
    doGenerateShareLink,
    showShareLinkSuccess,
    copyShareLinkUrl,
    showShareLinks,
    revokeShareLink,

    // Invoicing
    generateInvoice,
    getInvoiceSummaryContext,
    buildInvoiceSubject,
    buildInvoiceBody,
    buildFullInvoiceText,
    buildSmsDeepLink,
    openSmsComposer,
    updateInvoiceVariant,
    sendIndividualInvoice,
    showTextInvoiceDialog,
    generateShareLinkForInvoiceDialog,
    doGenerateShareLinkForInvoice,
    copyTextInvoiceMessage,
    copyTextInvoiceLink,
    showEmailInvoiceDialog,
    copyEmailInvoiceMessage,
    generateInvoiceHTML,

    // Test helpers
    _set,
    _get,
};
