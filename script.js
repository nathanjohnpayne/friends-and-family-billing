// Data storage
let familyMembers = []; // Array of {id, name, email, avatar, paymentReceived, linkedMembers: [memberIds]}
let bills = []; // Array of {id, name, amount, logo, website, members: [memberIds]}
let payments = []; // Append-only ledger: [{id, memberId, amount, receivedAt, note, method}]
let settings = {
    emailMessage: 'I have attached your annual bill summary. Thank you for your prompt payment of %total via any of the payment services below.',
    paymentLinks: []
};

let currentUser = null;
let currentBillingYear = null;
let billingYears = [];

const CURRENT_MIGRATION_VERSION = 1;

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
            renderFamilyMembers();
            renderBills();
            updateSummary();
            renderEmailSettings();
            renderPaymentLinksSettings();
            loadDisputes();
            startUpdateChecker();
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
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                archivedAt: null,
                familyMembers: [],
                bills: [],
                payments: [],
                settings: settings,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
    if (isArchivedYear()) {
        console.warn('Cannot save: billing year is archived');
        return Promise.resolve();
    }

    _saveChain = _saveChain.then(async () => {
        try {
            const yearDocRef = db.collection('users').doc(currentUser.uid)
                .collection('billingYears').doc(currentBillingYear.id);
            await yearDocRef.set({
                label: currentBillingYear.label,
                status: currentBillingYear.status,
                createdAt: currentBillingYear.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                archivedAt: currentBillingYear.archivedAt || null,
                familyMembers: familyMembers,
                bills: bills,
                payments: payments,
                settings: settings,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('Data saved successfully');
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

async function migrateLegacyData(userDocRef, userData) {
    const yearId = String(new Date().getFullYear());
    const yearDocRef = userDocRef.collection('billingYears').doc(yearId);

    const existingYearDoc = await yearDocRef.get();
    if (!existingYearDoc.exists) {
        const yearData = {
            label: yearId,
            status: 'open',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            archivedAt: null,
            familyMembers: userData.familyMembers || [],
            bills: userData.bills || [],
            payments: userData.payments || [],
            settings: userData.settings || settings,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
            return b;
        });

        payments = yearData.payments || [];

        if (yearData.settings) {
            settings = yearData.settings;
            if (!settings.paymentLinks) settings.paymentLinks = [];
        }

        if (!isArchivedYear() && familyMembers.length > 0) {
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

        renderBillingYearSelector();
        renderArchivedBanner();
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();
        renderPaymentLinksSettings();
        loadDisputes();
    } catch (error) {
        console.error('Error switching billing year:', error);
        alert('Error switching billing year. Please try again.');
    }
}

async function archiveCurrentYear() {
    if (!currentBillingYear || isArchivedYear()) return;

    if (!confirm('Archive billing year ' + currentBillingYear.label + '? This will make it read-only.')) {
        return;
    }

    try {
        const yearDocRef = db.collection('users').doc(currentUser.uid)
            .collection('billingYears').doc(currentBillingYear.id);

        await yearDocRef.set({
            status: 'archived',
            archivedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        currentBillingYear.status = 'archived';
        currentBillingYear.archivedAt = new Date();

        const yearInList = billingYears.find(y => y.id === currentBillingYear.id);
        if (yearInList) yearInList.status = 'archived';

        renderBillingYearSelector();
        renderArchivedBanner();
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();
        renderPaymentLinksSettings();
        loadDisputes();

        if (confirm('Year archived successfully. Would you like to start a new billing year?')) {
            await startNewYear();
        }
    } catch (error) {
        console.error('Error archiving year:', error);
        alert('Error archiving billing year. Please try again.');
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
            logo: b.logo,
            website: b.website,
            members: b.members ? b.members.slice() : []
        }));

        const yearData = {
            label: yearId,
            status: 'open',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            archivedAt: null,
            familyMembers: clonedMembers,
            bills: clonedBills,
            payments: [],
            settings: {
                emailMessage: settings.emailMessage,
                paymentLinks: (settings.paymentLinks || []).map(l => ({...l}))
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await userDocRef.collection('billingYears').doc(yearId).set(yearData);
        await userDocRef.set({ activeBillingYear: yearId }, { merge: true });

        await loadBillingYearsList();
        await loadBillingYearData(yearId);

        renderBillingYearSelector();
        renderArchivedBanner();
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();
        renderPaymentLinksSettings();
        loadDisputes();

        alert('Billing year ' + yearId + ' created successfully!');
    } catch (error) {
        console.error('Error creating new year:', error);
        alert('Error creating new billing year. Please try again.');
    }
}

function renderBillingYearSelector() {
    const container = document.getElementById('billingYearControls');
    if (!container || !currentBillingYear) return;

    const options = billingYears.map(y => {
        const statusLabel = y.status === 'archived' ? 'Archived' : 'Open';
        const selected = y.id === currentBillingYear.id ? 'selected' : '';
        return '<option value="' + escapeHtml(y.id) + '" ' + selected + '>' + escapeHtml(y.label) + ' (' + statusLabel + ')</option>';
    }).join('');

    const archived = isArchivedYear();

    container.innerHTML = '<select id="billingYearSelect" onchange="switchBillingYear(this.value)">' + options + '</select>'
        + (archived ? '' : ' <button onclick="archiveCurrentYear()" class="btn btn-secondary btn-sm">Archive Year</button>')
        + ' <button onclick="startNewYear()" class="btn btn-primary btn-sm">Start New Year</button>';
}

function renderArchivedBanner() {
    const banner = document.getElementById('archivedBanner');
    if (!banner) return;

    banner.style.display = isArchivedYear() ? 'block' : 'none';
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();

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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const member = familyMembers.find(m => m.id === id);
    if (member) {
        member.avatar = '';
        saveData();
        renderFamilyMembers();
    }
}

function manageLinkMembers(parentId) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
}

// Render family members
function renderFamilyMembers() {
    const container = document.getElementById('familyMembersList');
    const archived = isArchivedYear();

    const addMemberSection = document.querySelector('.family-members-input');
    if (addMemberSection) {
        addMemberSection.style.display = archived ? 'none' : '';
    }

    if (familyMembers.length === 0) {
        container.innerHTML = '<p class="empty-state">No family members added yet</p>';
        return;
    }

    container.innerHTML = familyMembers.map(member => {
        const linkedNames = member.linkedMembers
            .map(id => {
                const linked = familyMembers.find(m => m.id === id);
                return linked ? escapeHtml(linked.name) : null;
            })
            .filter(name => name)
            .join(', ');

        return `
        <div class="member-card" data-member-id="${member.id}">
            <div class="member-avatar-container">
                ${generateAvatar(member)}
            </div>
            <div class="member-info">
                <div class="member-name" ${archived ? '' : `onclick="editFamilyMember(${member.id})" title="Click to edit name"`}>${escapeHtml(member.name)}</div>
                <div class="member-email" ${archived ? '' : `onclick="editMemberEmail(${member.id})" title="Click to edit email"`}>
                    ${escapeHtml(member.email) || 'No email'}
                </div>
                <div class="member-phone" ${archived ? '' : `onclick="editMemberPhone(${member.id})" title="Click to edit phone"`}>
                    ${escapeHtml(member.phone) || 'No phone'}
                </div>
                ${linkedNames ? `<div class="linked-members">Linked: ${linkedNames}</div>` : ''}
            </div>
            ${archived ? '' : `<div class="member-actions">
                <button class="btn-icon" onclick="uploadAvatar(${member.id})" title="Upload avatar">📷</button>
                ${member.avatar ? `<button class="btn-icon" onclick="removeAvatar(${member.id})" title="Remove avatar">🗑️</button>` : ''}
                <button class="btn-icon" onclick="manageLinkMembers(${member.id})" title="Link members">🔗</button>
                <button class="btn-icon remove" onclick="removeFamilyMember(${member.id})" title="Remove member">×</button>
            </div>`}
        </div>
    `}).join('');
}

// Add bill
function addBill() {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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

    const bill = {
        id: generateUniqueBillId(),
        name: name,
        amount: amount,
        logo: '',
        website: website,
        members: []
    };

    bills.push(bill);

    nameInput.value = '';
    amountInput.value = '';
    websiteInput.value = '';

    saveData();
    renderBills();
    updateSummary();

    // Analytics: Track bill added
    if (analytics) {
        analytics.logEvent('bill_added', {
            has_website: !!website,
            amount: amount,
            total_bills: bills.length
        });
    }
}

// Edit bill name
function editBillName(id) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newName = prompt('Enter new bill name:', bill.name);
    if (!newName || newName.trim() === '') return;

    bill.name = newName.trim();

    saveData();
    renderBills();
}

// Edit bill amount
function editBillAmount(id) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newAmount = prompt('Enter new monthly amount:', bill.amount);
    if (!newAmount || newAmount.trim() === '') return;

    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    bill.amount = amount;

    saveData();
    renderBills();
    updateSummary();
}

function editBillWebsite(id) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newWebsite = prompt('Enter website URL:', bill.website);
    if (newWebsite === null) return;

    const trimmed = newWebsite.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        alert('Please enter a URL starting with http:// or https://');
        return;
    }

    bill.website = trimmed;

    saveData();
    renderBills();
}

// Upload logo
function uploadLogo(id) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const bill = bills.find(b => b.id === id);
    if (bill) {
        bill.logo = '';
        saveData();
        renderBills();
    }
}

// Remove bill
function removeBill(id) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    if (!confirm('Remove this bill?')) return;

    bills = bills.filter(b => b.id !== id);

    saveData();
    renderBills();
    updateSummary();
}

// Toggle member for a bill
function toggleMember(billId, memberId) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;

    const index = bill.members.indexOf(memberId);

    if (index === -1) {
        bill.members.push(memberId);
    } else {
        bill.members.splice(index, 1);
    }

    saveData();
    updateSummary();
}

// Render bills
function renderBills() {
    const container = document.getElementById('billsList');
    const archived = isArchivedYear();

    const addBillSection = document.querySelector('.bill-input-section');
    if (addBillSection) {
        addBillSection.style.display = archived ? 'none' : '';
    }

    if (bills.length === 0) {
        container.innerHTML = '<p class="empty-state">No bills added yet</p>';
        return;
    }

    container.innerHTML = bills.map(bill => {
        const perPerson = bill.members.length > 0 ? (bill.amount / bill.members.length).toFixed(2) : '0.00';
        const safeWebsite = (bill.website && /^https?:\/\//i.test(bill.website)) ? escapeHtml(bill.website) : '';

        return `
            <div class="bill-item" data-bill-id="${bill.id}">
                <div class="bill-header-main">
                    <div class="bill-logo-container">
                        ${generateLogo(bill)}
                    </div>
                    <div class="bill-header">
                        <div>
                            <div class="bill-title${archived ? '' : ' editable'}" ${archived ? '' : `onclick="editBillName(${bill.id})" title="Click to edit name"`}>${escapeHtml(bill.name)}</div>
                            ${safeWebsite ? `<div class="bill-website"><a href="${safeWebsite}" target="_blank" rel="noopener noreferrer">${safeWebsite}</a></div>` : ''}
                            <div style="color: #666; font-size: 0.9rem; margin-top: 5px;">
                                ${bill.members.length > 0 ? `$${perPerson} per person (${bill.members.length} members)` : 'No members selected'}
                            </div>
                        </div>
                        <div class="bill-amount${archived ? '' : ' editable'}" ${archived ? '' : `onclick="editBillAmount(${bill.id})" title="Click to edit amount"`}>$${bill.amount.toFixed(2)}/mo</div>
                    </div>
                </div>

                <div class="bill-split-section">
                    <div class="split-header">Split with:</div>
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

                ${archived ? '' : `<div class="bill-actions">
                    <button class="btn btn-secondary" onclick="uploadLogo(${bill.id})">Upload Logo</button>
                    ${bill.logo ? `<button class="btn btn-secondary" onclick="removeLogo(${bill.id})">Remove Logo</button>` : ''}
                    <button class="btn btn-secondary" onclick="editBillWebsite(${bill.id})">Edit Website</button>
                    <button class="btn btn-danger" onclick="removeBill(${bill.id})">Remove Bill</button>
                </div>`}
            </div>
        `;
    }).join('');
}

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

    // Calculate each member's share
    bills.forEach(bill => {
        if (bill.members.length > 0) {
            const monthlyPerPerson = bill.amount / bill.members.length;
            const annualPerPerson = monthlyPerPerson * 12;

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

// Update summary display
function updateSummary() {
    const container = document.getElementById('annualSummary');
    const summary = calculateAnnualSummary();
    const archived = isArchivedYear();

    if (familyMembers.length === 0) {
        container.innerHTML = '<p class="empty-state">Add family members and bills to see the summary</p>';
        return;
    }

    let totalAnnual = 0;
    Object.values(summary).forEach(data => {
        totalAnnual += data.total;
    });

    let totalPayments = 0;

    // Only show parent members and independent members in main rows
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(m.id));

    const tableRows = mainMembers
        .map(member => {
            const data = summary[member.id];
            if (!data) return '';

            // Calculate combined total for parent and linked members
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

            let rows = `
            <tr class="parent-row">
                <td>
                    <div class="summary-member">
                        ${generateAvatar(data.member)}
                        <span>${escapeHtml(data.member.name)}</span>
                        ${member.linkedMembers.length > 0 ? `<span class="member-count">(+${member.linkedMembers.length})</span>` : ''}
                    </div>
                </td>
                <td>$${(combinedTotal / 12).toFixed(2)}</td>
                <td><strong>$${combinedTotal.toFixed(2)}</strong></td>
                <td class="payment-cell">
                    $${payment.toFixed(2)}
                    ${archived ? '' : `<button class="btn-icon payment-add-btn" onclick="showAddPaymentDialog(${data.member.id})" title="Record payment">+</button>`}
                    <button class="btn-icon payment-history-btn" onclick="showPaymentHistory(${data.member.id})" title="View payment history">📋</button>
                </td>
                <td class="${balance > 0 ? 'balance-owed' : 'balance-paid'}">
                    <strong>$${balance.toFixed(2)}</strong>
                </td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="sendIndividualInvoice(${data.member.id})">
                        Email Invoice
                    </button>
                    <button class="btn btn-sm btn-share" onclick="generateShareLink(${data.member.id})" title="Generate share link">
                        Share
                    </button>
                    <button class="btn-icon" onclick="showShareLinks(${data.member.id})" title="Manage share links" style="font-size:0.9rem;">🔗</button>
                </td>
            </tr>
            `;

            // Add child rows
            linkedData.forEach(linkedSummary => {
                const childPayment = getPaymentTotalForMember(linkedSummary.member.id);
                const childBalance = linkedSummary.total - childPayment;
                rows += `
                <tr class="child-row">
                    <td>
                        <div class="summary-member summary-child">
                            <span class="child-indicator">↳</span>
                            ${generateAvatar(linkedSummary.member)}
                            <span>${escapeHtml(linkedSummary.member.name)}</span>
                        </div>
                    </td>
                    <td>$${(linkedSummary.total / 12).toFixed(2)}</td>
                    <td>$${linkedSummary.total.toFixed(2)}</td>
                    <td class="payment-cell">
                        $${childPayment.toFixed(2)}
                        ${archived ? '' : `<button class="btn-icon payment-add-btn" onclick="showAddPaymentDialog(${linkedSummary.member.id})" title="Record payment">+</button>`}
                        <button class="btn-icon payment-history-btn" onclick="showPaymentHistory(${linkedSummary.member.id})" title="View payment history">📋</button>
                    </td>
                    <td class="${childBalance > 0 ? 'balance-owed' : 'balance-paid'}">
                        $${childBalance.toFixed(2)}
                    </td>
                    <td></td>
                </tr>
                `;
            });

            return rows;
        })
        .join('');

    const totalBalance = totalAnnual - totalPayments;

    container.innerHTML = `
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Family Member</th>
                    <th>Monthly Total</th>
                    <th>Annual Total</th>
                    <th>Payment Received</th>
                    <th>Balance</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
                <tr class="total-row">
                    <td>TOTAL</td>
                    <td>$${(totalAnnual / 12).toFixed(2)}</td>
                    <td><strong>$${totalAnnual.toFixed(2)}</strong></td>
                    <td><strong>$${totalPayments.toFixed(2)}</strong></td>
                    <td colspan="2"><strong>$${totalBalance.toFixed(2)}</strong></td>
                </tr>
            </tbody>
        </table>
    `;
}

// Record a payment in the ledger for a member (or distributed across linked members)
function recordPayment(memberId, amount, method, note, distribute) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
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

        payments.push({
            id: generateUniquePaymentId(),
            memberId: memberId,
            amount: parentShare,
            receivedAt: now,
            note: note || 'Distributed payment',
            method: method || 'other'
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
                payments.push({
                    id: generateUniquePaymentId(),
                    memberId: linkedId,
                    amount: childShare,
                    receivedAt: now,
                    note: note || 'Distributed from ' + member.name,
                    method: method || 'other'
                });
            }
        });
    } else {
        payments.push({
            id: generateUniquePaymentId(),
            memberId: memberId,
            amount: validAmount,
            receivedAt: now,
            note: note || '',
            method: method || 'other'
        });
    }

    saveData();
    updateSummary();
}

// Render email settings
function renderEmailSettings() {
    const container = document.getElementById('emailSettings');
    const archived = isArchivedYear();
    container.innerHTML = `
        <div class="form-group">
            <label for="emailMessage">Email Message (sent with all invoices)</label>
            <p style="color: #666; font-size: 0.9rem; margin-bottom: 8px;">
                Use <strong>%total</strong> to insert the combined annual total (e.g., "payment of %total")
            </p>
            <textarea id="emailMessageInput" rows="4" ${archived ? 'disabled' : ''}>${escapeHtml(settings.emailMessage)}</textarea>
            ${archived ? '' : '<button class="btn btn-primary" onclick="saveEmailMessage()" style="margin-top: 10px;">Save Message</button>'}
        </div>
    `;
}

// Save email message
function saveEmailMessage() {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const input = document.getElementById('emailMessageInput');
    settings.emailMessage = input.value;
    saveData();
    alert('Email message saved!');
}

// ──────────────── Payment Links Settings ────────────────

function renderPaymentLinksSettings() {
    const container = document.getElementById('paymentLinksSettings');
    if (!container) return;
    const archived = isArchivedYear();
    const links = settings.paymentLinks || [];

    let html = '';

    if (links.length > 0) {
        html += '<div class="payment-links-list">';
        links.forEach(link => {
            html += `<div class="payment-link-item">
                <div class="payment-link-info">
                    <strong>${escapeHtml(link.name)}</strong>
                    <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.url)}</a>
                </div>
                ${archived ? '' : `<div class="payment-link-actions">
                    <button class="btn-icon" onclick="editPaymentLink('${escapeHtml(link.id)}')" title="Edit">✏️</button>
                    <button class="btn-icon remove" onclick="removePaymentLink('${escapeHtml(link.id)}')" title="Remove">&times;</button>
                </div>`}
            </div>`;
        });
        html += '</div>';
    } else {
        html += '<p class="empty-state" style="padding: 20px;">No payment links configured yet</p>';
    }

    if (!archived) {
        html += `<div class="payment-link-add" style="margin-top: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 2fr auto; gap: 10px; align-items: end;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="paymentLinkName">Name</label>
                    <input type="text" id="paymentLinkName" placeholder="e.g., Venmo" />
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="paymentLinkUrl">URL</label>
                    <input type="text" id="paymentLinkUrl" placeholder="https://venmo.com/YourHandle" />
                </div>
                <button class="btn btn-primary" onclick="addPaymentLink()">Add Link</button>
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

function addPaymentLink() {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const nameInput = document.getElementById('paymentLinkName');
    const urlInput = document.getElementById('paymentLinkUrl');
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!name) { alert('Please enter a name for the payment link.'); return; }
    if (!url) { alert('Please enter a URL for the payment link.'); return; }

    if (!settings.paymentLinks) settings.paymentLinks = [];

    settings.paymentLinks.push({
        id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: name,
        url: url
    });

    saveData();
    renderPaymentLinksSettings();
}

function editPaymentLink(linkId) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const link = (settings.paymentLinks || []).find(l => l.id === linkId);
    if (!link) return;

    const newName = prompt('Payment link name:', link.name);
    if (newName === null) return;
    if (!newName.trim()) { alert('Name cannot be empty.'); return; }

    const newUrl = prompt('Payment link URL:', link.url);
    if (newUrl === null) return;
    if (!newUrl.trim()) { alert('URL cannot be empty.'); return; }

    link.name = newName.trim();
    link.url = newUrl.trim();

    saveData();
    renderPaymentLinksSettings();
}

function removePaymentLink(linkId) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    if (!confirm('Remove this payment link?')) return;

    settings.paymentLinks = (settings.paymentLinks || []).filter(l => l.id !== linkId);
    saveData();
    renderPaymentLinksSettings();
}

// ──────────────── Review Requests (Disputes) ────────────────

let _loadedDisputes = [];
let _disputeStatusFilter = 'all';

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
    } catch (error) {
        console.error('Error loading disputes:', error);
        container.innerHTML = '<p style="color: #f56565;">Error loading review requests.</p>';
    }
}

function renderDisputeFilterBar(disputes) {
    const bar = document.getElementById('disputeFilterBar');
    if (!bar) return;

    const counts = { all: disputes.length, open: 0, in_review: 0, resolved: 0, rejected: 0 };
    disputes.forEach(d => { if (counts[d.status] !== undefined) counts[d.status]++; });

    const filters = [
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

    const filtered = _disputeStatusFilter === 'all'
        ? disputes
        : disputes.filter(d => d.status === _disputeStatusFilter);

    if (filtered.length === 0) {
        const msg = _disputeStatusFilter === 'all'
            ? 'No review requests yet.'
            : 'No ' + (DISPUTE_STATUS_LABELS[_disputeStatusFilter] || _disputeStatusFilter).toLowerCase() + ' review requests.';
        container.innerHTML = '<p class="empty-state">' + escapeHtml(msg) + '</p>';
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

        html += `<div class="dispute-item ${sClass}" onclick="showDisputeDetail('${escapeHtml(d.id)}')" style="cursor:pointer;">
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
        userReviewSection = `<div class="form-group" style="margin-top:12px;">
            <label class="checkbox-label">
                <input type="checkbox" id="disputeUserReview" ${userReviewState === 'requested' ? 'checked' : ''} onchange="toggleUserReview('${escapeHtml(d.id)}', this.checked)" />
                Request user approval
            </label>
            <p style="color:#888;font-size:0.8rem;margin-top:4px;">Sends approve/reject decision to the member via their share link.</p>
        </div>`;
    } else if (userReviewState) {
        const urLabel = userReviewState === 'approved_by_user' ? 'Approved by user'
            : userReviewState === 'rejected_by_user' ? 'Rejected by user'
            : userReviewState;
        userReviewSection = `<div class="dispute-detail-user-review"><strong>User Decision:</strong> ${escapeHtml(urLabel)}${d.userReview.rejectionNote ? ' — ' + escapeHtml(d.userReview.rejectionNote) : ''}</div>`;
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
        evidenceHtml += '<p style="color:#999;font-size:0.9rem;">No evidence attached.</p>';
    }
    if (!isTerminal && evidenceList.length < 10) {
        evidenceHtml += `<button class="btn btn-sm btn-secondary" onclick="uploadEvidence('${escapeHtml(d.id)}')" style="margin-top:8px;">Upload Evidence</button>`;
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

    dialog.innerHTML = `
        <div class="dialog-header">
            <h3>${escapeHtml(d.billName)} <span class="dispute-status-badge ${sClass}" style="font-size:0.7rem;vertical-align:middle;">${escapeHtml(statusLabel)}</span></h3>
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
            <div class="form-group" style="margin-top:16px;">
                <label for="disputeResolutionNote">Resolution Note</label>
                <textarea id="disputeResolutionNote" rows="3" placeholder="Add a resolution note..." ${isTerminal ? 'disabled' : ''}>${escapeHtml(d.resolutionNote || '')}</textarea>
            </div>
            ${userReviewSection}
            ${evidenceHtml}
            ${statusActions}
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>
        </div>
    `;

    overlay.classList.add('visible');
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
    if (newStatus === 'resolved') updates.resolvedAt = firebase.firestore.FieldValue.serverTimestamp();
    if (newStatus === 'rejected') updates.rejectedAt = firebase.firestore.FieldValue.serverTimestamp();

    updateDispute(disputeId, updates).then(() => {
        closePaymentDialog();
    });
}

async function toggleUserReview(disputeId, checked) {
    const updates = checked
        ? { 'userReview.state': 'requested' }
        : { userReview: firebase.firestore.FieldValue.delete() };
    await updateDispute(disputeId, updates);
    showDisputeDetail(disputeId);
}

function scrollToBill(billId) {
    const el = document.querySelector(`#bill-${billId}, [data-bill-id="${billId}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '3px solid #667eea'; setTimeout(() => { el.style.outline = ''; }, 2000); }
}

function scrollToMember(memberId) {
    const el = document.querySelector(`[data-member-id="${memberId}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '3px solid #667eea'; setTimeout(() => { el.style.outline = ''; }, 2000); }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const EVIDENCE_MAX_SIZE = 20 * 1024 * 1024;
const EVIDENCE_MAX_COUNT = 10;
const EVIDENCE_ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

function uploadEvidence(disputeId) {
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
        progressEl.innerHTML = '<div class="dispute-evidence-progress-bar"><div class="dispute-evidence-progress-fill" style="width:0%"></div></div><p style="font-size:0.8rem;color:#666;margin-top:4px;">Uploading ' + escapeHtml(file.name) + '...</p>';
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

                const evidenceEntry = {
                    name: file.name,
                    storagePath: storagePath,
                    contentType: file.type,
                    size: file.size,
                    uploadedAt: new Date().toISOString()
                };

                try {
                    await getDisputeRef(disputeId).update({
                        evidence: firebase.firestore.FieldValue.arrayUnion(evidenceEntry)
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
        window.open(url, '_blank');
    } catch (error) {
        console.error('Error getting evidence URL:', error);
        alert('Could not load evidence. It may have been deleted.');
    }
}

async function removeEvidence(disputeId, index) {
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
            evidence: firebase.firestore.FieldValue.arrayRemove(ev)
        });
        await loadDisputes();
        showDisputeDetail(disputeId);
    } catch (err) {
        console.error('Error removing evidence metadata:', err);
        alert('Error removing evidence. Please try again.');
    }
}

// ──────────────── Share Link Functions ────────────────

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
            <div class="form-group" style="margin-top: 16px;">
                <label for="shareLinkExpiry">Link Expiry (optional)</label>
                <select id="shareLinkExpiry">
                    <option value="">No expiry</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                </select>
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="shareLinkDisputes" />
                    Allow member to request bill reviews
                </label>
                <p style="color:#888;font-size:0.8rem;margin-top:4px;">
                    Adds <code>disputes:create</code> scope so the member can flag bill line items for review.
                </p>
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="shareLinkDisputesRead" />
                    Allow member to view review requests &amp; evidence
                </label>
                <p style="color:#888;font-size:0.8rem;margin-top:4px;">
                    Adds <code>disputes:read</code> scope so the member can see their disputes, evidence, and approve/reject resolutions.
                </p>
            </div>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Cancel</button>
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
        const scopes = ['summary:read', 'paymentLinks:read'];
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
            expiresAt: expiresAt ? firebase.firestore.Timestamp.fromDate(expiresAt) : null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastAccessedAt: null,
            accessCount: 0,
            memberName: member.name
        };

        await db.collection('shareTokens').doc(tokenHash).set(tokenDoc);

        const shareUrl = window.location.origin + '/share.html?token=' + rawToken;

        await navigator.clipboard.writeText(shareUrl);

        closePaymentDialog();
        alert('Share link copied to clipboard!\n\n' + member.name + ' can open this link to view their billing summary without logging in.');

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
            <p style="color: #666;">Loading share links...</p>
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

        links.sort((a, b) => {
            const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
            const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
            return bTime - aTime;
        });

        let html = '';
        if (links.length === 0) {
            html = '<p class="empty-state" style="padding: 20px;">No share links generated yet for this member.</p>';
        } else {
            html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
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

                const accessInfo = link.accessCount > 0
                    ? link.accessCount + ' view' + (link.accessCount !== 1 ? 's' : '')
                    : 'Never viewed';

                html += `<div class="share-link-item">
                    <div class="share-link-meta">
                        <span>Year: <strong>${escapeHtml(yearLabel)}</strong></span>
                        <span class="share-link-date">Created: ${escapeHtml(created)}</span>
                        <span class="share-link-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                        <span class="share-link-access">${escapeHtml(accessInfo)}</span>
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
        if (body) body.innerHTML = '<p style="color: #f56565;">Error loading share links.</p>';
    }
}

async function revokeShareLink(tokenHash, memberId) {
    if (!confirm('Revoke this share link? Anyone with this link will no longer be able to view the billing summary.')) return;

    try {
        await db.collection('shareTokens').doc(tokenHash).update({ revoked: true });
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

// Send individual invoice via email (plain text)
function sendIndividualInvoice(memberId) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    if (!member.email) {
        alert(`${member.name} does not have an email address set. Please add one first.`);
        return;
    }

    const summary = calculateAnnualSummary();
    const memberData = summary[memberId];

    // Get linked members data
    const linkedMembersData = member.linkedMembers.map(linkedId => summary[linkedId]).filter(d => d);

    // Calculate combined total
    let combinedTotal = memberData ? memberData.total : 0;
    linkedMembersData.forEach(data => {
        combinedTotal += data.total;
    });

    if (combinedTotal === 0) {
        alert(`${member.name} has no bills to invoice.`);
        return;
    }

    const currentYear = currentBillingYear ? currentBillingYear.label : new Date().getFullYear();
    const firstName = member.name.split(' ')[0];
    const numMembers = 1 + member.linkedMembers.length;
    let payment = getPaymentTotalForMember(memberId);
    member.linkedMembers.forEach(linkedId => {
        payment += getPaymentTotalForMember(linkedId);
    });
    const paymentPerPerson = payment / numMembers;

    // Generate plain text invoice with %total placeholder replacement
    const emailMessage = settings.emailMessage.replace(/%total/g, `$${combinedTotal.toFixed(2)}`);
    let invoiceText = `Hello ${firstName},\n\n${emailMessage}\n\n`;
    invoiceText += `======================================\n`;
    invoiceText += `ANNUAL BILL INVOICE - ${currentYear}\n`;
    invoiceText += `======================================\n\n`;
    invoiceText += `Primary: ${member.name}\n`;

    if (linkedMembersData.length > 0) {
        invoiceText += `Linked Members: ${linkedMembersData.map(d => d.member.name).join(', ')}\n`;
    }
    invoiceText += `Invoice Date: ${new Date().toLocaleDateString()}\n\n`;

    // Bill breakdown for primary member
    if (memberData && memberData.bills.length > 0) {
        invoiceText += `${member.name.toUpperCase()}'S BILLS:\n`;
        invoiceText += `${'='.repeat(80)}\n`;
        invoiceText += `${'Bill'.padEnd(25)} ${'Monthly'.padEnd(12)} ${'Split'.padEnd(8)} ${'Your Share'.padEnd(12)} ${'Annual'}\n`;
        invoiceText += `${'-'.repeat(80)}\n`;

        let monthlyTotal = 0;
        memberData.bills.forEach(billData => {
            const billName = billData.bill.name.padEnd(25).substring(0, 25);
            const monthlyAmount = `$${billData.bill.amount.toFixed(2)}`.padEnd(12);
            const splitWith = `${billData.bill.members.length} ppl`.padEnd(8);
            const yourShare = `$${billData.monthlyShare.toFixed(2)}`.padEnd(12);
            const annual = `$${billData.annualShare.toFixed(2)}`;

            invoiceText += `${billName} ${monthlyAmount} ${splitWith} ${yourShare} ${annual}\n`;
            monthlyTotal += billData.monthlyShare;
        });

        invoiceText += `${'-'.repeat(80)}\n`;
        invoiceText += `SUBTOTAL: $${monthlyTotal.toFixed(2)}/mo = $${memberData.total.toFixed(2)}/year\n`;
        invoiceText += `${'='.repeat(80)}\n\n`;
    }

    // Bill breakdown for each linked member
    linkedMembersData.forEach(linkedData => {
        if (linkedData.bills.length > 0) {
            invoiceText += `${linkedData.member.name.toUpperCase()}'S BILLS:\n`;
            invoiceText += `${'='.repeat(80)}\n`;
            invoiceText += `${'Bill'.padEnd(25)} ${'Monthly'.padEnd(12)} ${'Split'.padEnd(8)} ${'Their Share'.padEnd(12)} ${'Annual'}\n`;
            invoiceText += `${'-'.repeat(80)}\n`;

            let monthlyTotal = 0;
            linkedData.bills.forEach(billData => {
                const billName = billData.bill.name.padEnd(25).substring(0, 25);
                const monthlyAmount = `$${billData.bill.amount.toFixed(2)}`.padEnd(12);
                const splitWith = `${billData.bill.members.length} ppl`.padEnd(8);
                const theirShare = `$${billData.monthlyShare.toFixed(2)}`.padEnd(12);
                const annual = `$${billData.annualShare.toFixed(2)}`;

                invoiceText += `${billName} ${monthlyAmount} ${splitWith} ${theirShare} ${annual}\n`;
                monthlyTotal += billData.monthlyShare;
            });

            invoiceText += `${'-'.repeat(80)}\n`;
            invoiceText += `SUBTOTAL: $${monthlyTotal.toFixed(2)}/mo = $${linkedData.total.toFixed(2)}/year\n`;
            invoiceText += `${'='.repeat(80)}\n\n`;
        }
    });

    // Combined payment summary
    const balance = combinedTotal - payment;

    invoiceText += `PAYMENT SUMMARY:\n`;
    invoiceText += `${'='.repeat(80)}\n`;
    invoiceText += `  Combined Annual Total:         $${combinedTotal.toFixed(2)}\n`;
    if (payment > 0) {
        invoiceText += `  Payment Received:              $${payment.toFixed(2)}\n`;
        invoiceText += `  Payment Per Person (${numMembers} members):   $${paymentPerPerson.toFixed(2)}\n`;
        invoiceText += `  Balance Remaining:             $${balance.toFixed(2)}\n`;
    } else {
        invoiceText += `  Payment Received:              $0.00\n`;
        invoiceText += `  Balance Remaining:             $${balance.toFixed(2)}\n`;
    }
    invoiceText += `${'='.repeat(80)}\n`;

    invoiceText += `\n\nThank you for your prompt payment!\n`;

    // Create mailto link with plain text invoice
    const subject = `Annual Bill Invoice ${currentYear}`;
    const mailtoLink = `mailto:${member.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(invoiceText)}`;

    // Open email client
    window.location.href = mailtoLink;

    // Analytics: Track invoice sent
    if (analytics) {
        analytics.logEvent('invoice_sent', {
            has_linked_members: linkedMembersData.length > 0,
            num_linked_members: linkedMembersData.length,
            total_amount: combinedTotal,
            has_payment: payment > 0
        });
    }
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
            <title>Annual Bill Invoice - ${currentYear}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 40px auto;
                    padding: 20px;
                }
                h1 {
                    color: #333;
                    border-bottom: 3px solid #667eea;
                    padding-bottom: 10px;
                }
                h2 {
                    color: #555;
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
                    background: #f7fafc;
                    font-weight: bold;
                }
                .total-row {
                    font-weight: bold;
                    background: #f0f0f0;
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
                    background: #667eea;
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
                    background: #f0f0f0;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    color: #333;
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
            <h1>Annual Bill Invoice - ${currentYear}</h1>
            <p>Generated on: ${new Date().toLocaleDateString()}</p>

            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 20px 0;">Print Invoice</button>

            <h2>Summary</h2>
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
                            <th>Monthly Amount</th>
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

            html += `
                        <tr>
                            <td>${logoHTML}${safeBillName}</td>
                            <td>$${billData.bill.amount.toFixed(2)}</td>
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

function showAddPaymentDialog(memberId) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    ensureDialogContainer();
    const overlay = document.getElementById('payment-dialog-overlay');
    const dialog = document.getElementById('payment-dialog');
    if (!overlay || !dialog) return;

    const hasLinked = member.linkedMembers && member.linkedMembers.length > 0;
    const summary = hasLinked ? calculateAnnualSummary() : null;

    let distributeSection = '';
    if (hasLinked) {
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
                    <input type="checkbox" id="distributePayment" checked onchange="toggleDistributePreview()" />
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
            <h3>Record Payment</h3>
            <button class="dialog-close" onclick="closePaymentDialog()">&times;</button>
        </div>
        <div class="dialog-body">
            <p>For: <strong>${escapeHtml(member.name)}</strong></p>
            ${distributeSection}
            <div class="form-group">
                <label for="paymentAmount">Amount ($)</label>
                <input type="number" id="paymentAmount" step="0.01" min="0.01" placeholder="0.00" />
            </div>
            <div class="form-group">
                <label for="paymentMethod">Method</label>
                <select id="paymentMethod">
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="venmo">Venmo</option>
                    <option value="zelle">Zelle</option>
                    <option value="paypal">PayPal</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="other">Other</option>
                </select>
            </div>
            <div class="form-group">
                <label for="paymentNote">Note (optional)</label>
                <input type="text" id="paymentNote" placeholder="e.g., Q1 payment" />
            </div>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" onclick="closePaymentDialog()">Cancel</button>
            <button class="btn btn-primary" onclick="submitPayment(${member.id})">Save Payment</button>
        </div>
    `;

    overlay.classList.add('visible');
    var amountInput = document.getElementById('paymentAmount');
    if (amountInput && amountInput.focus) amountInput.focus();
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
    closePaymentDialog();
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
    var archived = isArchivedYear();

    var paymentRows = memberPayments.length > 0
        ? memberPayments.map(function(p) {
            var date = new Date(p.receivedAt).toLocaleDateString();
            var methodLabel = p.method
                ? p.method.charAt(0).toUpperCase() + p.method.slice(1).replace(/_/g, ' ')
                : 'Other';
            return '<div class="payment-history-item">'
                + '<div class="payment-history-details">'
                + '<span class="payment-history-date">' + escapeHtml(date) + '</span>'
                + '<span class="payment-history-amount">$' + p.amount.toFixed(2) + '</span>'
                + '<span class="payment-history-method">' + escapeHtml(methodLabel) + '</span>'
                + '</div>'
                + (p.note ? '<div class="payment-history-note">' + escapeHtml(p.note) + '</div>' : '')
                + (archived ? '' : '<button class="btn-icon remove" onclick="deletePaymentEntry(\'' + escapeHtml(p.id) + '\', ' + memberId + ')" title="Delete payment">&times;</button>')
                + '</div>';
        }).join('')
        : '<p class="empty-state" style="padding:20px;">No payments recorded</p>';

    dialog.innerHTML = '<div class="dialog-header">'
        + '<h3>Payment History: ' + escapeHtml(member.name) + '</h3>'
        + '<button class="dialog-close" onclick="closePaymentDialog()">&times;</button>'
        + '</div>'
        + '<div class="dialog-body">'
        + '<div class="payment-history-total">Total Paid: <strong>$' + total.toFixed(2) + '</strong></div>'
        + '<div class="payment-history-list">' + paymentRows + '</div>'
        + '</div>'
        + '<div class="dialog-footer">'
        + '<button class="btn btn-secondary" onclick="closePaymentDialog()">Close</button>'
        + '</div>';

    overlay.classList.add('visible');
}

function deletePaymentEntry(paymentId, memberId) {
    if (isArchivedYear()) { alert('This billing year is archived and read-only.'); return; }
    if (!confirm('Delete this payment entry?')) return;

    payments = payments.filter(p => p.id !== paymentId);
    saveData();
    showPaymentHistory(memberId);
    updateSummary();
}

